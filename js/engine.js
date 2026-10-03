/*
 * Word Jam Bus - core rules engine (no DOM).
 * Used by the browser game (window.WJBEngine) and by the Node verifier
 * (tools/verify-levels.js). It is a 1:1 port of Level.step()/autofill() in
 * tools/wjb_solver.py, so the game and both solvers agree.
 *
 * Rules
 *  - Grid [rows, cols], 1-indexed, r1 = top row, c1 = left column.
 *  - Car {l, r, c, dir, len?}. (r,c) is the HEAD (front) cell; a car with
 *    len > 1 extends backwards, opposite to dir.
 *  - Tap: if every cell from the head to the edge (in dir) is empty, the car
 *    leaves the lot (1 move). Otherwise it bumps (no move, no penalty).
 *  - The leaving unit is the car's letter(s):
 *      "?"            wildcard: fills the next slot
 *      matches next   fills those slots (a 2-letter chunk fills two)
 *      otherwise      parks in the holding bay; if the bay is already full
 *                     the level is LOST
 *  - After every fill, bay units that match the next slot(s) auto-fill,
 *    chaining (longest match first). Identical letters are interchangeable.
 *  - WIN when every slot of the target (all words joined) is filled.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WJBEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  function targetOf(level) {
    if (level.words && level.words.length) return level.words.join('').toUpperCase();
    return String(level.word || '').toUpperCase();
  }
  function wordsOf(level) {
    if (level.words && level.words.length) return level.words.map(function (w) { return w.toUpperCase(); });
    return [String(level.word || '').toUpperCase()];
  }

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
      if (!DIRS[raw.dir]) errors.push('car ' + i + ' bad dir ' + raw.dir);
      var car = { id: i, l: String(raw.l).toUpperCase(), r: raw.r, c: raw.c, dir: raw.dir, len: raw.len || 1 };
      car.cells = DIRS[raw.dir] ? carCells(car) : [];
      car.cells.forEach(function (rc) {
        var k = rc[0] + ',' + rc[1];
        if (rc[0] < 1 || rc[0] > rows || rc[1] < 1 || rc[1] > cols) errors.push('car ' + i + ' out of grid at r' + rc[0] + 'c' + rc[1]);
        else if (occ[k] !== undefined) errors.push('cars ' + occ[k] + ' and ' + i + ' overlap at r' + rc[0] + 'c' + rc[1]);
        else occ[k] = i;
      });
      return car;
    });
    if (errors.length) throw new Error('Level ' + (level.id || target) + ' invalid: ' + errors.join('; '));
    cars.forEach(function (car) {
      var d = DIRS[car.dir], path = [], blockers = [];
      var r = car.r + d[0], c = car.c + d[1];
      while (r >= 1 && r <= rows && c >= 1 && c <= cols) {
        path.push([r, c]);
        var o = occ[r + ',' + c];
        if (o !== undefined && blockers.indexOf(o) === -1) blockers.push(o);
        r += d[0]; c += d[1];
      }
      car.path = path;
      car.blockers = blockers;
    });
    return {
      level: level, rows: rows, cols: cols, target: target, words: wordsOf(level),
      cap: level.bay, cars: cars, occ: occ
    };
  }

  function initialState(game) {
    return { removed: game.cars.map(function () { return false; }), idx: 0, bay: [], moves: 0 };
  }

  function cloneState(s) {
    return { removed: s.removed.slice(), idx: s.idx, bay: s.bay.slice(), moves: s.moves };
  }

  /** First car still on the lot that blocks car i, or -1 if clear. */
  function firstBlocker(game, i, removed) {
    var car = game.cars[i];
    for (var p = 0; p < car.path.length; p++) {
      var o = game.occ[car.path[p][0] + ',' + car.path[p][1]];
      if (o !== undefined && !removed[o]) return o;
    }
    return -1;
  }

  /** Port of Level.autofill. Mutates state; returns list of auto-filled units. */
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
   * Port of Level.step. Returns
   *   { result: 'gone' | 'blocked', by }        (state unchanged)
   *   { result: 'lose', state, unit }            (bay overflow)
   *   { result: 'fill' | 'bay', state, unit, slot, auto:[...], won }
   */
  function step(game, state, i, cap) {
    cap = cap === undefined ? game.cap : cap;
    if (state.removed[i]) return { result: 'gone' };
    var b = firstBlocker(game, i, state.removed);
    if (b !== -1) return { result: 'blocked', by: b };
    var s = cloneState(state);
    var u = game.cars[i].l;
    s.removed[i] = true;
    s.moves++;
    var out = { state: s, unit: u, slot: s.idx, auto: [] };
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

  function stateKey(s) {
    var k = '';
    for (var i = 0; i < s.removed.length; i++) k += s.removed[i] ? '1' : '0';
    return k + '|' + s.idx + '|' + s.bay.slice().sort().join(',');
  }

  /** BFS for the fewest moves to win from `from` (default: start). */
  function solve(game, from, cap) {
    var s0 = from ? cloneState(from) : initialState(game);
    s0.moves = 0;
    var prev = new Map();
    prev.set(stateKey(s0), null);
    var queue = [s0], head = 0, win = null;
    if (s0.idx >= game.target.length) return { par: 0, path: [], states: 1 };
    while (head < queue.length && !win) {
      var s = queue[head++];
      var sk = stateKey(s);
      for (var i = 0; i < game.cars.length; i++) {
        var t = step(game, s, i, cap);
        if (t.result !== 'fill' && t.result !== 'bay') continue;
        var tk = stateKey(t.state);
        if (prev.has(tk)) continue;
        prev.set(tk, { prev: sk, car: i });
        if (t.won) { win = tk; break; }
        queue.push(t.state);
      }
    }
    if (!win) return { par: null, path: null, states: prev.size };
    var path = [], k = win;
    while (prev.get(k)) { path.unshift(prev.get(k).car); k = prev.get(k).prev; }
    return { par: path.length, path: path, states: prev.size };
  }

  /** Full reachable-state analysis (port of Level.explore). */
  function explore(game) {
    var s0 = initialState(game);
    var k0 = stateKey(s0);
    var nodes = new Map();
    nodes.set(k0, { s: s0, edges: [] });
    var queue = [k0], head = 0;
    while (head < queue.length) {
      var k = queue[head++], node = nodes.get(k);
      if (node.s.idx >= game.target.length) continue;
      for (var i = 0; i < game.cars.length; i++) {
        var t = step(game, node.s, i);
        if (t.result === 'gone' || t.result === 'blocked') continue;
        if (t.result === 'lose') { node.edges.push({ car: i, to: 'LOSE' }); continue; }
        var tk = stateKey(t.state);
        node.edges.push({ car: i, to: tk });
        if (!nodes.has(tk)) { nodes.set(tk, { s: t.state, edges: [] }); queue.push(tk); }
      }
    }
    var good = new Set();
    nodes.forEach(function (n, k) { if (n.s.idx >= game.target.length) good.add(k); });
    var changed = true;
    while (changed) {
      changed = false;
      nodes.forEach(function (n, k) {
        if (good.has(k)) return;
        if (n.edges.some(function (e) { return e.to !== 'LOSE' && good.has(e.to); })) { good.add(k); changed = true; }
      });
    }
    var firstBad = nodes.get(k0).edges
      .filter(function (e) { return e.to === 'LOSE' || !good.has(e.to); })
      .map(function (e) { return game.cars[e.car].l; });
    return { reachable: nodes.size, deadStates: nodes.size - good.size, firstMovesDead: firstBad };
  }

  function minBay(game) {
    for (var cap = 0; cap <= game.cars.length; cap++) if (solve(game, null, cap).par !== null) return cap;
    return null;
  }

  function ascii(game) {
    var AR = { up: '↑', down: '↓', left: '←', right: '→' };
    var grid = [];
    for (var r = 0; r < game.rows; r++) { grid.push([]); for (var c = 0; c < game.cols; c++) grid[r].push('  . '); }
    game.cars.forEach(function (car) {
      var head = car.l + AR[car.dir];
      grid[car.cells[0][0] - 1][car.cells[0][1] - 1] = ('    ' + head).slice(-4);
      car.cells.slice(1).forEach(function (rc) {
        grid[rc[0] - 1][rc[1] - 1] = car.dir === 'left' || car.dir === 'right' ? '  = ' : '  ‖ ';
      });
    });
    var out = ['     '];
    for (var c2 = 1; c2 <= game.cols; c2++) out[0] += ' c' + (c2 + ' ').slice(0, 2);
    grid.forEach(function (row, r) { out.push(('r' + (r + 1) + '   ').slice(0, 5) + row.join('')); });
    return out.join('\n');
  }

  return {
    DIRS: DIRS, targetOf: targetOf, prepare: prepare, initialState: initialState,
    cloneState: cloneState, firstBlocker: firstBlocker, step: step, solve: solve,
    explore: explore, minBay: minBay, stateKey: stateKey, ascii: ascii
  };
});
