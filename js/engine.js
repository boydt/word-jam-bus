/*
 * Word Jam Bus - core rules engine + solver (no DOM).
 * Shared by the browser game (window.WJBEngine) and the Node verifier
 * (require('./js/engine.js')).
 *
 * Rules (v2, "slide until blocked")
 *  - Grid [rows, cols], 1-indexed in level files: r1 = top row, c1 = left col.
 *  - Car {l, r, c, dir, len?}: (r,c) is the HEAD (front) cell; a car with
 *    len > 1 extends backwards, opposite to dir. A car only ever moves along
 *    its own axis.
 *  - Forward move: the car drives toward its nose. If every cell from its
 *    nose to the edge is empty it leaves the lot. Otherwise it slides forward
 *    until it touches the first car in the way and stops there.
 *  - Reverse move: the car backs up until it touches a car or the edge of
 *    the lot and stops. Cars never leave the lot backwards.
 *  - A move that cannot shift the car even one cell is a bump (no move).
 *  - Every slide or exit is 1 move.
 *  - The leaving unit is the car's letter(s): "?" wildcard fills the next
 *    slot; a unit matching the next slot(s) fills them; anything else parks
 *    in the holding bay. A wrong unit leaving while the bay is full LOSES.
 *  - After every fill, bay units that match the next slot(s) board too,
 *    chaining (longest match first). Identical letters are interchangeable.
 *  - WIN when every slot of the target (all words joined) is filled.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WJBEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  var FWD = 0, BACK = 1;

  function targetOf(level) {
    if (level.words && level.words.length) return level.words.join('').toUpperCase();
    return String(level.word || '').toUpperCase();
  }
  function wordsOf(level) {
    if (level.words && level.words.length) return level.words.map(function (w) { return w.toUpperCase(); });
    return [String(level.word || '').toUpperCase()];
  }

  /** Cells of a raw car (1-indexed), head first. */
  function carCells(car) {
    var d = DIRS[car.dir], n = car.len || 1, out = [];
    for (var k = 0; k < n; k++) out.push([car.r - d[0] * k, car.c - d[1] * k]);
    return out;
  }

  /** Build an immutable game model from a raw level. Throws if invalid. */
  function prepare(level) {
    var rows = level.grid[0], cols = level.grid[1];
    var target = targetOf(level);
    var errors = [];
    if (!target) errors.push('missing word');
    if (!(level.bay >= 0)) errors.push('missing bay size');
    var occ = {};
    var cars = (level.cars || []).map(function (raw, i) {
      if (!DIRS[raw.dir]) { errors.push('car ' + i + ' bad dir ' + raw.dir); return null; }
      var len = raw.len || 1;
      var horiz = raw.dir === 'left' || raw.dir === 'right';
      var sign = raw.dir === 'right' || raw.dir === 'down' ? 1 : -1;
      var cells = carCells({ r: raw.r, c: raw.c, dir: raw.dir, len: len });
      cells.forEach(function (rc) {
        var k = rc[0] + ',' + rc[1];
        if (rc[0] < 1 || rc[0] > rows || rc[1] < 1 || rc[1] > cols) errors.push('car ' + i + ' out of grid at r' + rc[0] + 'c' + rc[1]);
        else if (occ[k] !== undefined) errors.push('cars ' + occ[k] + ' and ' + i + ' overlap at r' + rc[0] + 'c' + rc[1]);
        else occ[k] = i;
      });
      var along = cells.map(function (rc) { return horiz ? rc[1] - 1 : rc[0] - 1; });
      return {
        id: i, l: String(raw.l == null ? '' : raw.l).toUpperCase(), dir: raw.dir, len: len,
        horiz: horiz, sign: sign, lane: horiz ? raw.r - 1 : raw.c - 1,
        span: horiz ? cols : rows, start: Math.min.apply(null, along),
        r: raw.r, c: raw.c
      };
    });
    cars.forEach(function (c, i) { if (c && !c.l) errors.push('car ' + i + ' has no letter'); });
    if (errors.length) throw new Error('Level ' + (level.id || target) + ' invalid: ' + errors.join('; '));
    return {
      level: level, rows: rows, cols: cols, target: target, words: wordsOf(level),
      cap: level.bay, cars: cars, n: cars.length
    };
  }

  function initialState(game) {
    return { pos: game.cars.map(function (c) { return c.start; }), idx: 0, bay: [], moves: 0 };
  }
  function cloneState(s) { return { pos: s.pos.slice(), idx: s.idx, bay: s.bay.slice(), moves: s.moves }; }

  /** Cell index of the k-th cell (0 = lowest coordinate) of car at axis position p. */
  function cellAt(game, car, p) { return car.horiz ? car.lane * game.cols + p : p * game.cols + car.lane; }

  /** Occupancy grid: car id per cell, -1 empty. */
  function buildGrid(game, pos, grid) {
    grid = grid || new Int16Array(game.rows * game.cols);
    grid.fill(-1);
    for (var i = 0; i < game.n; i++) {
      var p = pos[i];
      if (p < 0) continue;
      var car = game.cars[i];
      for (var k = 0; k < car.len; k++) grid[cellAt(game, car, p + k)] = i;
    }
    return grid;
  }

  /**
   * Where would car i go? Returns
   *   { kind:'exit' }                       forward, path fully clear
   *   { kind:'slide', dist, by }            slides dist cells, stops at car `by` (or edge, by = -1)
   *   { kind:'bump', by }                   cannot move at all
   * `which` is FWD (toward the nose) or BACK.
   */
  function probe(game, grid, pos, i, which) {
    var car = game.cars[i], p = pos[i];
    if (p < 0) return { kind: 'gone' };
    var s = which === FWD ? car.sign : -car.sign;
    var edgeCoord = s > 0 ? p + car.len - 1 : p;   // leading cell in the moving direction
    var x = edgeCoord + s, k = 0;
    while (x >= 0 && x < car.span) {
      var o = grid[cellAt(game, car, x)];
      if (o !== -1) return k ? { kind: 'slide', dist: k, by: o } : { kind: 'bump', by: o };
      k++; x += s;
    }
    if (which === FWD) return { kind: 'exit', dist: k };
    return k ? { kind: 'slide', dist: k, by: -1 } : { kind: 'bump', by: -1 };
  }

  /** Port of the bay auto-fill. Mutates state; returns the auto-filled units. */
  function autofill(game, state) {
    var filled = [];
    while (state.idx < game.target.length) {
      var best = -1;
      for (var b = 0; b < state.bay.length; b++) {
        var u = state.bay[b];
        if (u !== '?' && game.target.substr(state.idx, u.length) === u) {
          if (best === -1 || u.length > state.bay[best].length) best = b;
        }
      }
      if (best === -1) break;
      var unit = state.bay.splice(best, 1)[0];
      filled.push({ unit: unit, slot: state.idx, bayIndex: best });
      state.idx += unit.length;
    }
    return filled;
  }

  /**
   * Apply a move. Returns
   *   { result:'gone' } | { result:'bump', by }                 (state unchanged)
   *   { result:'slide', state, dist, by }
   *   { result:'lose', state, unit }                            (bay overflow)
   *   { result:'fill'|'bay', state, unit, slot, auto:[...], won, fillLetters }
   */
  function step(game, state, i, which, cap, grid) {
    cap = cap === undefined || cap === null ? game.cap : cap;
    which = which === BACK || which === 'back' ? BACK : FWD;
    if (state.pos[i] < 0) return { result: 'gone' };
    grid = grid || buildGrid(game, state.pos);
    var pr = probe(game, grid, state.pos, i, which);
    if (pr.kind === 'bump') return { result: 'bump', by: pr.by, which: which };
    var s = cloneState(state);
    s.moves++;
    var car = game.cars[i];
    if (pr.kind === 'slide') {
      s.pos[i] += (which === FWD ? car.sign : -car.sign) * pr.dist;
      return { result: 'slide', state: s, dist: pr.dist, by: pr.by, which: which };
    }
    // exit
    var u = car.l;
    s.pos[i] = -1;
    var out = { state: s, unit: u, slot: s.idx, auto: [], which: which, dist: pr.dist };
    if (u === '?' || game.target.substr(s.idx, u.length) === u) {
      out.result = 'fill';
      out.fillLetters = u === '?' ? game.target[s.idx] : u;
      s.idx += u === '?' ? 1 : u.length;
      out.auto = autofill(game, s);
    } else {
      if (s.bay.length >= cap) { out.result = 'lose'; return out; }
      out.result = 'bay';
      s.bay.push(u);
    }
    out.won = s.idx >= game.target.length;
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* Solver: breadth-first search over (car positions, word index, bay). */
  /* States live in flat typed arrays; the hash key is a compact string.  */
  /* ------------------------------------------------------------------ */

  // Compact exact key: word index, then car positions packed 5 per 16-bit
  // char (3 bits each; value = pos + 1, 0 = gone), then the sorted bay.
  function keyOf(pos, idx, bay) {
    var codes = [idx + 1], acc = 0, cnt = 0;
    for (var i = 0; i < pos.length; i++) {
      acc = acc * 8 + (pos[i] + 1); cnt++;
      if (cnt === 5) { codes.push(acc + 1); acc = 0; cnt = 0; }
    }
    if (cnt) codes.push(acc + 1);
    var k = String.fromCharCode.apply(null, codes);
    if (bay.length) k += '|' + (bay.length > 1 ? bay.slice().sort().join(',') : bay[0]);
    return k;
  }
  function stateKey(s) { return keyOf(s.pos, s.idx, s.bay); }

  /**
   * Incremental BFS. search.run(maxNewStates) -> 'win' | 'none' | 'running' | 'limit'.
   * After 'win', search.path is an optimal list of moves [{car, which}].
   * opts.cap overrides the bay size; opts.maxStates aborts with 'limit'.
   *
   * States are stored in flat typed arrays (car positions, word index, bay
   * id). Duplicate detection uses an open-addressing hash table of state
   * indices with an exact comparison, so there are no false merges.
   */
  function createSearch(game, from, opts) {
    opts = opts || {};
    var n = game.n, W = game.target.length, cols = game.cols;
    var cap = opts.cap === undefined || opts.cap === null ? game.cap : opts.cap;
    var maxStates = opts.maxStates || Infinity;
    var wMax = opts.forwardOnly ? 1 : 2;
    var s0 = from ? cloneState(from) : initialState(game);
    var cars = game.cars;
    var size = 4096;
    var posBuf = new Int8Array(size * n), idxBuf = new Uint8Array(size), bayBuf = new Uint16Array(size);
    var parent = new Int32Array(size), mv = new Int16Array(size);
    var bayIds = new Map(), bayList = [];
    function bayId(arr) {
      var k = arr.join(',');
      var id = bayIds.get(k);
      if (id === undefined) { id = bayList.length; bayIds.set(k, id); bayList.push(arr); }
      return id;
    }
    var tbits = 13, table = new Int32Array(1 << tbits), tmask = (1 << tbits) - 1;
    var count = 0, head = 0;
    function hashOf(pos, idx, bid) {
      var h = (idx * 31 + bid * 1009) | 0;
      for (var i = 0; i < n; i++) h = Math.imul(h ^ (pos[i] + 2), 0x9e3779b1) | 0;
      return (h ^ (h >>> 15)) | 0;
    }
    function same(e, pos, idx, bid) {
      if (idxBuf[e] !== idx || bayBuf[e] !== bid) return false;
      var b = e * n;
      for (var i = 0; i < n; i++) if (posBuf[b + i] !== pos[i]) return false;
      return true;
    }
    function find(pos, idx, bid, h) { // returns slot index; table[slot] = 0 if absent
      var slot = h & tmask;
      while (true) {
        var e = table[slot];
        if (e === 0 || same(e - 1, pos, idx, bid)) return slot;
        slot = (slot + 1) & tmask;
      }
    }
    function rehash() {
      tbits++; table = new Int32Array(1 << tbits); tmask = (1 << tbits) - 1;
      var tmp = new Int8Array(n);
      for (var e = 0; e < count; e++) {
        for (var i = 0; i < n; i++) tmp[i] = posBuf[e * n + i];
        var slot = hashOf(tmp, idxBuf[e], bayBuf[e]) & tmask;
        while (table[slot] !== 0) slot = (slot + 1) & tmask;
        table[slot] = e + 1;
      }
    }
    function grow() {
      size *= 2;
      var p2 = new Int8Array(size * n); p2.set(posBuf); posBuf = p2;
      var i2 = new Uint8Array(size); i2.set(idxBuf); idxBuf = i2;
      var b2 = new Uint16Array(size); b2.set(bayBuf); bayBuf = b2;
      var a2 = new Int32Array(size); a2.set(parent); parent = a2;
      var m2 = new Int16Array(size); m2.set(mv); mv = m2;
    }
    function add(pos, idx, bid, par, move, slot) {
      if (count >= size) grow();
      posBuf.set(pos, count * n);
      idxBuf[count] = idx; bayBuf[count] = bid; parent[count] = par; mv[count] = move;
      table[slot] = count + 1;
      count++;
      if (count * 2 > tmask) rehash();
      return count - 1;
    }
    var api = { status: 'running', path: null, states: 0 };
    var pos = new Int8Array(n);
    for (var z = 0; z < n; z++) pos[z] = s0.pos[z];
    var b0 = bayId(s0.bay.slice().sort());
    add(pos, s0.idx, b0, -1, -1, find(pos, s0.idx, b0, hashOf(pos, s0.idx, b0)));
    if (s0.idx >= W) { api.status = 'win'; api.path = []; api.states = 1; }
    var grid = new Int16Array(game.rows * cols);
    function finish(at) {
      var path = [];
      while (parent[at] !== -1) { var m = mv[at]; path.push({ car: m >> 1, which: m & 1 }); at = parent[at]; }
      path.reverse();
      api.path = path; api.status = 'win';
    }
    api.run = function (budget) {
      if (api.status !== 'running') return api.status;
      var limit = count + (budget || Infinity);
      while (head < count) {
        if (count >= limit) { api.states = count; return 'running'; }
        if (count >= maxStates) { api.status = 'limit'; api.states = count; return 'limit'; }
        var cur = head++, base = cur * n;
        for (var a = 0; a < n; a++) pos[a] = posBuf[base + a];
        var idx = idxBuf[cur], bid = bayBuf[cur], bay = bayList[bid];
        grid.fill(-1);
        for (var g = 0; g < n; g++) {
          var pg = pos[g]; if (pg < 0) continue;
          var cg = cars[g];
          for (var kk = 0; kk < cg.len; kk++) grid[cg.horiz ? cg.lane * cols + pg + kk : (pg + kk) * cols + cg.lane] = g;
        }
        for (var i = 0; i < n; i++) {
          var p = pos[i];
          if (p < 0) continue;
          var car = cars[i];
          for (var w = 0; w < wMax; w++) {
            var sgn = w === 0 ? car.sign : -car.sign;
            var x = (sgn > 0 ? p + car.len - 1 : p) + sgn, dist = 0, blocked = false;
            while (x >= 0 && x < car.span) {
              if (grid[car.horiz ? car.lane * cols + x : x * cols + car.lane] !== -1) { blocked = true; break; }
              dist++; x += sgn;
            }
            var nIdx = idx, nBid = bid;
            if (blocked || w === 1) {
              if (dist === 0) continue;               // bump
              pos[i] = p + sgn * dist;                // slide until blocked / edge
            } else {
              var u = car.l;                          // exit through the nose
              pos[i] = -1;
              if (u === '?' || game.target.substr(idx, u.length) === u) {
                var st = { idx: idx + (u === '?' ? 1 : u.length), bay: bay.slice() };
                if (bay.length) autofill(game, st);
                nIdx = st.idx; nBid = bayId(st.bay.sort());
              } else {
                if (bay.length >= cap) { pos[i] = p; continue; } // losing move: never part of a solution
                nBid = bayId(bay.concat([u]).sort());
              }
            }
            var slot = find(pos, nIdx, nBid, hashOf(pos, nIdx, nBid));
            if (table[slot] === 0) {
              var id = add(pos, nIdx, nBid, cur, (i << 1) | w, slot);
              if (nIdx >= W) { pos[i] = p; finish(id); api.states = count; return 'win'; }
            }
            pos[i] = p;
          }
        }
      }
      api.status = 'none'; api.states = count;
      return 'none';
    };
    return api;
  }

  /** Synchronous shortest solution. { par, path, states, status } (par null if none). */
  function solve(game, from, opts) {
    var s = createSearch(game, from, opts);
    var st = s.run(Infinity);
    return { par: st === 'win' ? s.path.length : null, path: st === 'win' ? s.path : null, states: s.states, status: st };
  }

  function minBay(game, opts) {
    for (var cap = 0; cap <= game.cap; cap++) {
      if (solve(game, null, { cap: cap, maxStates: (opts && opts.maxStates) || Infinity }).par !== null) return cap;
    }
    return null;
  }

  /**
   * Full reachable-state analysis (for the verifier): reachable count,
   * dead states (no way to win from there) and losing first moves.
   */
  function explore(game, maxStates) {
    maxStates = maxStates || 3000000;
    var n = game.n, W = game.target.length;
    var seen = new Map(), states = [], edgesFrom = [], won = [];
    function push(s) { var k = stateKey(s); if (seen.has(k)) return seen.get(k); seen.set(k, states.length); states.push(s); edgesFrom.push(null); return states.length - 1; }
    push(initialState(game));
    var grid = new Int16Array(game.rows * game.cols);
    for (var h = 0; h < states.length; h++) {
      if (states.length > maxStates) return { complete: false, reachable: states.length };
      var s = states[h], out = [];
      if (s.idx >= W) { won[h] = true; edgesFrom[h] = out; continue; }
      buildGrid(game, s.pos, grid);
      for (var i = 0; i < n; i++) for (var w = 0; w < 2; w++) {
        var t = step(game, s, i, w, null, grid);
        if (t.result === 'gone' || t.result === 'bump') continue;
        if (t.result === 'lose') { out.push({ car: i, which: w, to: -1 }); continue; }
        out.push({ car: i, which: w, to: push(t.state) });
      }
      edgesFrom[h] = out;
    }
    // backward propagation of "can still win"
    var N = states.length, good = new Uint8Array(N), rev = [];
    for (var a = 0; a < N; a++) rev.push([]);
    edgesFrom.forEach(function (es, from) { es.forEach(function (e) { if (e.to >= 0) rev[e.to].push(from); }); });
    var q = [];
    for (var b = 0; b < N; b++) if (won[b]) { good[b] = 1; q.push(b); }
    while (q.length) { var x = q.pop(); rev[x].forEach(function (p) { if (!good[p]) { good[p] = 1; q.push(p); } }); }
    var dead = 0; for (var c = 0; c < N; c++) if (!good[c]) dead++;
    var firstBad = edgesFrom[0].filter(function (e) { return e.to < 0 || !good[e.to]; }).length;
    return { complete: true, reachable: N, deadStates: dead, firstMoves: edgesFrom[0].length, firstMovesDead: firstBad };
  }

  /** ASCII picture of a state (or the start). */
  function ascii(game, pos) {
    var AR = { up: '^', down: 'v', left: '<', right: '>' };
    pos = pos || initialState(game).pos;
    var grid = [];
    for (var r = 0; r < game.rows; r++) { grid.push([]); for (var c = 0; c < game.cols; c++) grid[r].push(' . '); }
    game.cars.forEach(function (car, i) {
      if (pos[i] < 0) return;
      for (var k = 0; k < car.len; k++) {
        var cell = cellAt(game, car, pos[i] + k), rr = Math.floor(cell / game.cols), cc = cell % game.cols;
        var isHead = car.sign > 0 ? k === car.len - 1 : k === 0;
        grid[rr][cc] = isHead ? (car.l + AR[car.dir] + '  ').slice(0, 3) : (car.horiz ? ' = ' : ' | ');
        if (isHead && car.l.length > 1) grid[rr][cc] = car.l + AR[car.dir];
      }
    });
    var out = ['    '];
    for (var c2 = 1; c2 <= game.cols; c2++) out[0] += ' c' + c2;
    grid.forEach(function (row, r) { out.push(('r' + (r + 1) + '   ').slice(0, 4) + row.join('')); });
    return out.join('\n');
  }

  /** Head cell (1-indexed r,c) of car i at axis position p - for UI/tests. */
  function headCell(game, i, p) {
    var car = game.cars[i];
    var hp = car.sign > 0 ? p + car.len - 1 : p;
    return car.horiz ? { r: car.lane + 1, c: hp + 1 } : { r: hp + 1, c: car.lane + 1 };
  }

  return {
    DIRS: DIRS, FWD: FWD, BACK: BACK, targetOf: targetOf, prepare: prepare,
    initialState: initialState, cloneState: cloneState, buildGrid: buildGrid, probe: probe,
    step: step, createSearch: createSearch, solve: solve, explore: explore, minBay: minBay,
    stateKey: stateKey, ascii: ascii, cellAt: cellAt, headCell: headCell
  };
});
