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
 *
 * v4 additions
 *  - mode "scramble" (level.mode): any letter the bus still needs boards at
 *    once, into the leftmost open seat for that letter. Only decoys and extra
 *    copies go to the bay, and the bay never boards (a junk letter can never
 *    become needed). Scramble lots may not use "?" taxis or chunk trucks.
 *  - Bay Word: after every exit, if three bay letters the bus will never need
 *    (decoys, or copies beyond what the rest of the word needs) spell a word
 *    from js/baywords.js in any order, those three leave the bay (bonus).
 *    A wrong letter is parked first and the Bay Word check runs BEFORE the
 *    bay-full check, so a letter that completes a Bay Word never loses.
 *    The solver models this rule, so par / hints / dead ends include it.
 *  - Boosters (UI-only helpers, never needed to win): tow a spare car away,
 *    +1 bay spot for the level, nudge a car exactly one cell. They change
 *    the state (state.cap, state.used) and every search re-runs from there.
 *
 * v7: keys and padlocks
 *  - A car may carry a key ("key": colour) and/or a padlock ("lock": colour);
 *    colours are KEY_COLORS (gold / blue / pink; the UI also gives each its own
 *    shape: circle / triangle / square, so colour is never the only cue).
 *  - A padlocked car cannot move at all (no slide, reverse or exit) while the
 *    key car of its colour is still in the lot. When the key car exits, every
 *    lock of that colour opens for good. One key car per colour; it opens all
 *    locks of its colour. A key car may itself be padlocked by another colour
 *    (a chain), never by its own colour and never in a cycle.
 *  - Lock state is derived from "has the key car left?" (its pos is -1), so it
 *    adds no solver state, and undoing the key car's exit re-locks.
 *  - Tapping a locked car is a bump: { result:'bump', locked:true, key }.
 *  - Boosters: Tow, Nudge and Flip refuse a locked car; Tow also refuses a key
 *    car (towing it would open its locks for free). Bay +1 is unaffected.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WJBEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  var KEY_COLORS = ['gold', 'blue', 'pink'];
  var FWD = 0, BACK = 1;
  var BAYWORDS = (typeof module === 'object' && module.exports) ? require('./baywords.js')
    : (typeof self !== 'undefined' && self.WJB_BAYWORDS) || [];
  /** sorted-letters key -> its words, alphabetical (CAT and ACT share the key ACT). */
  var DICT = buildDict(BAYWORDS);
  function buildDict(list) {
    var d = new Map();
    list.slice().sort().forEach(function (w) { w = String(w).toUpperCase(); var k = w.split('').sort().join(''); if (!d.has(k)) d.set(k, []); d.get(k).push(w); });
    return d;
  }

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
  function prepare(level, opts) {
    opts = opts || {};
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
        r: raw.r, c: raw.c,
        key: raw.key || null, lock: opts.locks === false ? null : (raw.lock || null), lockBy: -1
      };
    });
    cars.forEach(function (c, i) { if (c && !c.l) errors.push('car ' + i + ' has no letter'); });
    // keys and padlocks
    var keys = {};
    cars.forEach(function (c, i) {
      if (!c) return;
      if (c.key) {
        if (KEY_COLORS.indexOf(c.key) === -1) errors.push('car ' + i + ' bad key colour ' + c.key);
        else if (keys[c.key] !== undefined) errors.push('two ' + c.key + ' key cars (' + keys[c.key] + ' and ' + i + ')');
        else keys[c.key] = i;
      }
      if (c.lock && KEY_COLORS.indexOf(c.lock) === -1) errors.push('car ' + i + ' bad lock colour ' + c.lock);
    });
    cars.forEach(function (c, i) {
      if (!c || !c.lock || KEY_COLORS.indexOf(c.lock) === -1) return;
      if (keys[c.lock] === undefined) errors.push('car ' + i + ' has a ' + c.lock + ' padlock but there is no ' + c.lock + ' key car');
      else if (keys[c.lock] === i) errors.push('car ' + i + ' is locked by its own key');
      else c.lockBy = keys[c.lock];
    });
    cars.forEach(function (c, i) { // no cycles: follow lockBy from each car
      if (!c) return;
      var seen = {}, x = i;
      while (x >= 0 && cars[x]) { if (seen[x]) { errors.push('padlock cycle through car ' + i); break; } seen[x] = 1; x = cars[x].lockBy; }
    });
    var mode = level.mode === 'scramble' ? 'scramble' : 'route';
    if (level.mode && level.mode !== 'scramble' && level.mode !== 'route') errors.push('unknown mode ' + level.mode);
    if (mode === 'scramble') {
      if (target.length > 12) errors.push('scramble words are limited to 12 letters');
      cars.forEach(function (c, i) { if (c && (c.l === '?' || c.l.length > 1)) errors.push('car ' + i + ': scramble levels take single-letter cars only'); });
    }
    if (errors.length) throw new Error('Level ' + (level.id || target) + ' invalid: ' + errors.join('; '));
    // seats of each letter, left to right (scramble boarding + need counts)
    var seats = {};
    for (var t = 0; t < target.length; t++) (seats[target[t]] = seats[target[t]] || []).push(t);
    return {
      level: level, rows: rows, cols: cols, target: target, words: wordsOf(level),
      cap: level.bay, cars: cars, n: cars.length, mode: mode, scramble: mode === 'scramble',
      keys: keys, hasLocks: cars.some(function (c) { return c && c.lockBy >= 0; }),
      seats: seats, full: (1 << target.length) - 1,
      dict: opts.bayWords === false ? null : (opts.dict ? buildDict(opts.dict) : DICT)
    };
  }

  /** Remaining need per letter: route = the unfilled tail; scramble = unset seats. */
  function needOf(game, idx, mask) {
    var need = {}, t = game.target;
    if (game.scramble) { for (var j = 0; j < t.length; j++) if (!(mask & (1 << j))) need[t[j]] = (need[t[j]] || 0) + 1; }
    else for (var k = idx; k < t.length; k++) need[t[k]] = (need[t[k]] || 0) + 1;
    return need;
  }
  /** Indices of bay entries a Bay Word may use: single letters beyond the remaining need (earliest copies stay reserved). */
  function eligibleBay(game, bay, idx, mask) {
    var need = needOf(game, idx, mask), seen = {}, out = [];
    for (var b = 0; b < bay.length; b++) {
      var u = bay[b];
      if (u.length !== 1 || u === '?') continue;
      seen[u] = (seen[u] || 0) + 1;
      if (seen[u] > (need[u] || 0)) out.push(b);
    }
    return out;
  }
  /**
   * Bay Word sweep. Mutates state.bay; returns [{word, at:[bay indices before removal], letters}].
   * Among several possible words the alphabetically first wins (then the lowest indices),
   * so the result only depends on the bay multiset.
   */
  function sweepBay(game, state) {
    var cleared = [];
    if (!game.dict) return cleared;
    while (state.bay.length >= 3) {
      var el = eligibleBay(game, state.bay, state.idx, state.mask || 0);
      if (el.length < 3) break;
      var best = null;
      for (var a = 0; a < el.length; a++) for (var b = a + 1; b < el.length; b++) for (var c = b + 1; c < el.length; c++) {
        var k = [state.bay[el[a]], state.bay[el[b]], state.bay[el[c]]].sort().join('');
        var ws = game.dict.get(k);
        if (ws && (!best || ws[0] < best.key)) best = { key: ws[0], words: ws, at: [el[a], el[b], el[c]] };
      }
      if (!best) break;
      best.letters = best.at.map(function (i) { return state.bay[i]; });
      // which letters leave only depends on the multiset; the name shown follows the bay order when it is a word (C,A,T -> CAT, not ACT)
      var asParked = best.letters.join('');
      best.word = best.words.indexOf(asParked) !== -1 ? asParked : best.words[0];
      delete best.words; delete best.key;
      for (var r = 2; r >= 0; r--) state.bay.splice(best.at[r], 1);
      cleared.push(best);
    }
    return cleared;
  }

  /**
   * State: pos (axis position per car, -1 = gone), idx (seats filled; in route
   * mode also the next seat), mask (scramble: filled seats bitmask), bay,
   * moves, cap (bay size now; Bay +1 raises it), words (Bay Words cleared),
   * used (boosters used this run: {tow, bay, nudge, flip}).
   */
  function initialState(game) {
    return { pos: game.cars.map(function (c) { return c.start; }), idx: 0, mask: 0, bay: [], moves: 0, cap: game.cap, words: 0, used: { tow: 0, bay: 0, nudge: 0, flip: 0 } };
  }
  function cloneState(s) {
    var u = s.used || {};
    return { pos: s.pos.slice(), idx: s.idx, mask: s.mask || 0, bay: s.bay.slice(), moves: s.moves, cap: s.cap, words: s.words || 0,
      used: { tow: u.tow || 0, bay: u.bay || 0, nudge: u.nudge || 0, flip: u.flip || 0 } };
  }
  function capOf(game, s) { return s && s.cap !== undefined && s.cap !== null ? s.cap : game.cap; }
  function isWon(game, s) { return game.scramble ? (s.mask || 0) === game.full : s.idx >= game.target.length; }
  function progOf(game, s) { return game.scramble ? (s.mask || 0) : s.idx; }
  /** Scramble: the seat a letter would take (leftmost open seat for it), or -1 = junk. */
  function seatFor(game, mask, u) {
    var list = game.seats[u];
    if (!list) return -1;
    for (var q = 0; q < list.length; q++) if (!(mask & (1 << list[q]))) return list[q];
    return -1;
  }
  function popcount(m) { var c = 0; while (m) { m &= m - 1; c++; } return c; }

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

  /** Padlocked right now? (its key car is still in the lot) */
  function isLocked(game, pos, i) { var k = game.cars[i].lockBy; return k >= 0 && pos[k] >= 0; }
  /** Cars car i unlocks when it exits (padlocks of its key colour still in the lot). */
  function locksOf(game, pos, i) {
    var out = [], c = game.cars[i];
    if (!c.key) return out;
    for (var j = 0; j < game.n; j++) if (game.cars[j].lockBy === i && pos[j] >= 0) out.push(j);
    return out;
  }

  /**
   * Where would car i go? Returns
   *   { kind:'exit' }                       forward, path fully clear
   *   { kind:'slide', dist, by }            slides dist cells, stops at car `by` (or edge, by = -1)
   *   { kind:'bump', by }                   cannot move at all
   *   { kind:'bump', by:-1, locked:true, key } padlocked (key car `key` is still in the lot)
   * `which` is FWD (toward the nose) or BACK.
   */
  function probe(game, grid, pos, i, which) {
    var car = game.cars[i], p = pos[i];
    if (p < 0) return { kind: 'gone' };
    if (car.lockBy >= 0 && pos[car.lockBy] >= 0) return { kind: 'bump', by: -1, locked: true, key: car.lockBy };
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
    cap = cap === undefined || cap === null ? capOf(game, state) : cap;
    which = which === BACK || which === 'back' ? BACK : FWD;
    if (state.pos[i] < 0) return { result: 'gone' };
    grid = grid || buildGrid(game, state.pos);
    var pr = probe(game, grid, state.pos, i, which);
    if (pr.kind === 'bump') return pr.locked ? { result: 'bump', by: -1, which: which, locked: true, key: pr.key } : { result: 'bump', by: pr.by, which: which };
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
    var out = { state: s, unit: u, slot: s.idx, auto: [], cleared: [], which: which, dist: pr.dist, unlocked: locksOf(game, state.pos, i) };
    var seat = game.scramble ? seatFor(game, s.mask, u) : -1;
    if (game.scramble ? seat >= 0 : (u === '?' || game.target.substr(s.idx, u.length) === u)) {
      out.result = 'fill';
      if (game.scramble) {
        out.slot = seat; out.fillLetters = u;
        s.mask |= 1 << seat; s.idx++;
      } else {
        out.fillLetters = u === '?' ? game.target[s.idx] : u;
        s.idx += u === '?' ? 1 : u.length;
        out.auto = autofill(game, s);
      }
      out.cleared = sweepBay(game, s);
    } else {
      // park first, clear any Bay Word, THEN check the bay size
      out.bayIndex = s.bay.length;
      s.bay.push(u);
      out.cleared = sweepBay(game, s);
      if (s.bay.length > cap) { out.result = 'lose'; s.bay.pop(); return out; }
      out.result = 'bay';
    }
    s.words += out.cleared.length;
    out.won = isWon(game, s);
    return out;
  }

  /* ---------------------------- boosters ---------------------------- */
  /** Tow truck: only a single-letter car the bus can do without (a decoy or a spare copy);
   *  never a padlocked car, and never a key car (that would open its locks for free). */
  function towable(game, state, i) {
    var car = game.cars[i];
    if (state.pos[i] < 0 || car.l.length !== 1 || car.l === '?') return false;
    if (car.key || isLocked(game, state.pos, i)) return false;
    var need = needOf(game, state.idx, state.mask || 0)[car.l] || 0;
    if (!need) return true;
    var supply = 0;
    for (var j = 0; j < game.n; j++) if (j !== i && state.pos[j] >= 0 && game.cars[j].l === car.l) supply++;
    for (var b = 0; b < state.bay.length; b++) if (state.bay[b] === car.l) supply++;
    return supply >= need;
  }
  /**
   * Flip booster: car i turns round in place (same cells), so its nose points the
   * other way. A car's direction is part of the game model, not the state, so a
   * flip returns a NEW game (cars copied, car i reversed) to pair with the state
   * from applyBooster(game, state, 'flip', i). Positions are stored as the car's
   * lowest cell along its axis, so they don't change. Any car in the lot can flip
   * (1-cell cars, long trucks, chunk trucks and the taxi alike).
   */
  var OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  function flippable(game, state, i) { return state.pos[i] >= 0 && !!game.cars[i] && !isLocked(game, state.pos, i); }
  function flipCar(game, i) {
    var g = {}, k;
    for (k in game) if (Object.prototype.hasOwnProperty.call(game, k)) g[k] = game[k];
    g.cars = game.cars.slice();
    var c = {}, o = game.cars[i];
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) c[k] = o[k];
    c.dir = OPPOSITE[o.dir]; c.sign = -o.sign; c.flipped = !o.flipped;
    g.cars[i] = c;
    return g;
  }
  /** Apply a booster; returns the new state or null if not allowed. kind: 'tow' | 'bay' | 'nudge' | 'flip'. */
  function applyBooster(game, state, kind, i, which) {
    var s = cloneState(state);
    if (kind === 'bay') {
      if (s.used.bay) return null;
      s.cap = capOf(game, state) + 1; s.used.bay++;
      return s;
    }
    if (kind === 'tow') {
      if (!towable(game, state, i)) return null;
      s.pos[i] = -1; s.moves++; s.used.tow++;
      return s;
    }
    if (kind === 'flip') {
      if (!flippable(game, state, i)) return null;
      s.moves++; s.used.flip++;
      return s;
    }
    if (kind === 'nudge') {
      var to = nudgeTo(game, state, i, which);
      if (to === null) return null;
      s.pos[i] = to; s.moves++; s.used.nudge++;
      return s;
    }
    return null;
  }
  /** Nudge: exactly one cell along the car's axis into an empty cell of the lot (never exits). */
  function nudgeTo(game, state, i, which) {
    var p = state.pos[i];
    if (p < 0 || isLocked(game, state.pos, i)) return null;
    var car = game.cars[i], sg = (which === BACK || which === 'back') ? -car.sign : car.sign;
    var lead = sg > 0 ? p + car.len - 1 : p, x = lead + sg;
    if (x < 0 || x >= car.span) return null;
    var grid = buildGrid(game, state.pos);
    if (grid[cellAt(game, car, x)] !== -1) return null;
    return p + sg;
  }
  function boosted(state) { var u = state.used || {}; return (u.tow || 0) + (u.bay || 0) + (u.nudge || 0) + (u.flip || 0) > 0; }

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
  function stateKey(s) { return keyOf(s.pos, s.mask ? s.mask + 64 : s.idx, s.bay) + (s.cap !== undefined ? '#' + s.cap : ''); }

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
    var n = game.n, W = game.target.length, cols = game.cols, scr = game.scramble;
    var s0 = from ? cloneState(from) : initialState(game);
    var cap = opts.cap === undefined || opts.cap === null ? capOf(game, s0) : opts.cap;
    var maxStates = opts.maxStates || Infinity;
    var wMax = opts.forwardOnly ? 1 : 2;
    var cars = game.cars;
    var lockBy = new Int16Array(n);
    for (var lb = 0; lb < n; lb++) lockBy[lb] = cars[lb].lockBy;
    var size = 4096;
    // prog = word index (route) or filled-seat mask (scramble)
    var posBuf = new Int8Array(size * n), progBuf = new Uint16Array(size), bayBuf = new Uint16Array(size);
    var parent = new Int32Array(size), mv = new Int16Array(size);
    var bayIds = new Map(), bayList = [];
    function bayId(arr) {
      var k = arr.join(',');
      var id = bayIds.get(k);
      if (id === undefined) { id = bayList.length; bayIds.set(k, id); bayList.push(arr); }
      return id;
    }
    // exit transitions (prog, bay, unit) -> packed result, memoised; -1 = losing move
    var unitIds = {}, unitList = [];
    cars.forEach(function (c) { if (unitIds[c.l] === undefined) { unitIds[c.l] = unitList.length; unitList.push(c.l); } });
    var NU = unitList.length, exitMemo = new Map();
    var nProgOut = 0, nBidOut = 0;
    function exitTo(prog, bid, ui) {
      var key = (bid * 65536 + prog) * NU + ui, hit = exitMemo.get(key);
      if (hit === undefined) {
        var u = unitList[ui], bay = bayList[bid];
        var st = { idx: scr ? popcount(prog) : prog, mask: scr ? prog : 0, bay: bay.slice() };
        var seat = scr ? seatFor(game, prog, u) : -1, lose = false;
        if (scr ? seat >= 0 : (u === '?' || game.target.substr(prog, u.length) === u)) {
          if (scr) { st.mask |= 1 << seat; st.idx++; }
          else { st.idx += u === '?' ? 1 : u.length; if (st.bay.length) autofill(game, st); }
          if (st.bay.length >= 3) sweepBay(game, st);
        } else {
          st.bay.push(u);
          sweepBay(game, st);
          if (st.bay.length > cap) lose = true;
        }
        hit = lose ? -1 : (scr ? st.mask : st.idx) * 65536 + bayId(st.bay.sort());
        exitMemo.set(key, hit);
      }
      if (hit < 0) return false;
      nProgOut = Math.floor(hit / 65536); nBidOut = hit % 65536;
      return true;
    }
    function won(prog) { return scr ? prog === game.full : prog >= W; }
    var tbits = 13, table = new Int32Array(1 << tbits), tmask = (1 << tbits) - 1;
    var count = 0, head = 0;
    function hashOf(pos, prog, bid) {
      var h = (prog * 31 + bid * 1009) | 0;
      for (var i = 0; i < n; i++) h = Math.imul(h ^ (pos[i] + 2), 0x9e3779b1) | 0;
      return (h ^ (h >>> 15)) | 0;
    }
    function same(e, pos, prog, bid) {
      if (progBuf[e] !== prog || bayBuf[e] !== bid) return false;
      var b = e * n;
      for (var i = 0; i < n; i++) if (posBuf[b + i] !== pos[i]) return false;
      return true;
    }
    function find(pos, prog, bid, h) { // returns slot index; table[slot] = 0 if absent
      var slot = h & tmask;
      while (true) {
        var e = table[slot];
        if (e === 0 || same(e - 1, pos, prog, bid)) return slot;
        slot = (slot + 1) & tmask;
      }
    }
    function rehash() {
      tbits++; table = new Int32Array(1 << tbits); tmask = (1 << tbits) - 1;
      var tmp = new Int8Array(n);
      for (var e = 0; e < count; e++) {
        for (var i = 0; i < n; i++) tmp[i] = posBuf[e * n + i];
        var slot = hashOf(tmp, progBuf[e], bayBuf[e]) & tmask;
        while (table[slot] !== 0) slot = (slot + 1) & tmask;
        table[slot] = e + 1;
      }
    }
    function grow() {
      size *= 2;
      var p2 = new Int8Array(size * n); p2.set(posBuf); posBuf = p2;
      var i2 = new Uint16Array(size); i2.set(progBuf); progBuf = i2;
      var b2 = new Uint16Array(size); b2.set(bayBuf); bayBuf = b2;
      var a2 = new Int32Array(size); a2.set(parent); parent = a2;
      var m2 = new Int16Array(size); m2.set(mv); mv = m2;
    }
    function add(pos, prog, bid, par, move, slot) {
      if (count >= size) grow();
      posBuf.set(pos, count * n);
      progBuf[count] = prog; bayBuf[count] = bid; parent[count] = par; mv[count] = move;
      table[slot] = count + 1;
      count++;
      if (count * 2 > tmask) rehash();
      return count - 1;
    }
    var api = { status: 'running', path: null, states: 0 };
    var pos = new Int8Array(n);
    for (var z = 0; z < n; z++) pos[z] = s0.pos[z];
    var p0 = progOf(game, s0), b0 = bayId(s0.bay.slice().sort());
    add(pos, p0, b0, -1, -1, find(pos, p0, b0, hashOf(pos, p0, b0)));
    if (won(p0)) { api.status = 'win'; api.path = []; api.states = 1; }
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
        var prog = progBuf[cur], bid = bayBuf[cur];
        grid.fill(-1);
        for (var g = 0; g < n; g++) {
          var pg = pos[g]; if (pg < 0) continue;
          var cg = cars[g];
          for (var kk = 0; kk < cg.len; kk++) grid[cg.horiz ? cg.lane * cols + pg + kk : (pg + kk) * cols + cg.lane] = g;
        }
        for (var i = 0; i < n; i++) {
          var p = pos[i];
          if (p < 0) continue;
          if (lockBy[i] >= 0 && pos[lockBy[i]] >= 0) continue;   // padlocked: its key car is still here
          var car = cars[i];
          for (var w = 0; w < wMax; w++) {
            var sgn = w === 0 ? car.sign : -car.sign;
            var x = (sgn > 0 ? p + car.len - 1 : p) + sgn, dist = 0, blocked = false;
            while (x >= 0 && x < car.span) {
              if (grid[car.horiz ? car.lane * cols + x : x * cols + car.lane] !== -1) { blocked = true; break; }
              dist++; x += sgn;
            }
            var nProg = prog, nBid = bid;
            if (blocked || w === 1) {
              if (dist === 0) continue;               // bump
              pos[i] = p + sgn * dist;                // slide until blocked / edge
            } else {
              if (!exitTo(prog, bid, unitIds[car.l])) continue; // losing move: never part of a solution
              pos[i] = -1;                            // exit through the nose
              nProg = nProgOut; nBid = nBidOut;
            }
            var slot = find(pos, nProg, nBid, hashOf(pos, nProg, nBid));
            if (table[slot] === 0) {
              var id = add(pos, nProg, nBid, cur, (i << 1) | w, slot);
              if (won(nProg)) { pos[i] = p; finish(id); api.states = count; return 'win'; }
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
    var n = game.n;
    var seen = new Map(), states = [], edgesFrom = [], won = [], bayWords = {};
    function push(s) { var k = stateKey(s); if (seen.has(k)) return seen.get(k); seen.set(k, states.length); states.push(s); edgesFrom.push(null); return states.length - 1; }
    push(initialState(game));
    var grid = new Int16Array(game.rows * game.cols);
    for (var h = 0; h < states.length; h++) {
      if (states.length > maxStates) return { complete: false, reachable: states.length, bayWords: bayWords };
      var s = states[h], out = [];
      if (isWon(game, s)) { won[h] = true; edgesFrom[h] = out; continue; }
      buildGrid(game, s.pos, grid);
      for (var i = 0; i < n; i++) for (var w = 0; w < 2; w++) {
        var t = step(game, s, i, w, null, grid);
        if (t.result === 'gone' || t.result === 'bump') continue;
        if (t.result === 'lose') { out.push({ car: i, which: w, to: -1 }); continue; }
        if (t.cleared && t.cleared.length) t.cleared.forEach(function (c) { bayWords[c.word] = (bayWords[c.word] || 0) + 1; });
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
    return { complete: true, reachable: N, deadStates: dead, firstMoves: edgesFrom[0].length, firstMovesDead: firstBad, bayWords: bayWords };
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
    game.cars.forEach(function (car, i) {
      if (pos[i] < 0 || !(car.key || car.lock)) return;
      var h = headCell(game, i, pos[i]);
      out.push('    ' + car.l + '@r' + h.r + 'c' + h.c + (car.key ? ' carries the ' + car.key + ' key' : '') + (car.key && car.lock ? ',' : '') + (car.lock ? ' padlocked ' + car.lock : ''));
    });
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
    stateKey: stateKey, ascii: ascii, cellAt: cellAt, headCell: headCell,
    isWon: isWon, sweepBay: sweepBay, eligibleBay: eligibleBay, needOf: needOf, seatFor: seatFor,
    towable: towable, applyBooster: applyBooster, nudgeTo: nudgeTo, boosted: boosted, capOf: capOf,
    flippable: flippable, flipCar: flipCar,
    KEY_COLORS: KEY_COLORS, isLocked: isLocked, locksOf: locksOf,
    BAYWORDS: BAYWORDS
  };
});
