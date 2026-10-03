#!/usr/bin/env node
/*
 * Word Jam Bus level verifier (Node, no dependencies) - v2 slide rules.
 *
 *   node tools/verify-levels.js            verify levels/levels.json
 *   node tools/verify-levels.js --write    also regenerate js/levels.js from it
 *   node tools/verify-levels.js --ascii    print each lot and an optimal solution
 *   node tools/verify-levels.js --no-py    skip the Python cross-check
 *
 * For every level it checks:
 *  - valid layout (in grid, no overlaps, every car has a letter);
 *  - every car carrying a word letter starts blocked (you must work to free it);
 *  - the level is winnable within its bay: exhaustive BFS over every slide /
 *    reverse / exit sequence, using js/engine.js (the code the game runs);
 *  - "par" equals the fewest moves (1 move = 1 slide or 1 exit);
 *  - not trivial: the optimal solution needs slides (par > exits) and the level
 *    cannot be won as fast by only driving forward (reverse moves matter);
 * and reports cars, empty cells, min bay needed, reachable / dead states.
 * It also checks js/levels.js matches levels/levels.json and cross-checks par
 * with the independent Python solver tools/wjb_solver.py.
 * Exits 1 on any failure.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var E = require('../js/engine.js');

var ROOT = path.join(__dirname, '..');
var JSON_PATH = path.join(ROOT, 'levels', 'levels.json');
var JS_PATH = path.join(ROOT, 'js', 'levels.js');
var args = process.argv.slice(2);
var data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
var levels = Array.isArray(data) ? data : data.levels;
var AR = { up: '↑', down: '↓', left: '←', right: '→' };
var failures = 0;
var table = [];

if (args.indexOf('--write') !== -1) {
  fs.writeFileSync(JS_PATH, '/* GENERATED from levels/levels.json by `node tools/verify-levels.js --write`. Do not edit by hand. */\n' +
    'window.WJB_LEVELS = ' + JSON.stringify(levels, null, 1) + ';\n');
  console.log('wrote ' + path.relative(ROOT, JS_PATH));
}

var seenIds = {};
levels.forEach(function (lv, n) {
  var problems = [];
  var name = (lv.words ? lv.words.join('+') : lv.word);
  if (!lv.id) problems.push('missing id'); else if (seenIds[lv.id]) problems.push('duplicate id'); seenIds[lv.id] = true;
  var g = null;
  try { g = E.prepare(lv); } catch (e) { problems.push(e.message); }
  var row = { n: n + 1, id: lv.id, word: name, grid: lv.grid.join('x'), bay: lv.bay };
  if (g) {
    var t0 = Date.now();
    var cells = g.rows * g.cols, used = g.cars.reduce(function (a, c) { return a + c.len; }, 0);
    row.cars = g.n; row.empty = cells - used;
    var s0 = E.initialState(g), grid0 = E.buildGrid(g, s0.pos);
    var freeLetters = g.cars.filter(function (c, i) {
      return (c.l === '?' || g.target.indexOf(c.l) !== -1) && E.probe(g, grid0, s0.pos, i, E.FWD).kind === 'exit';
    });
    if (freeLetters.length) problems.push('word-letter car(s) can exit on move 1: ' + freeLetters.map(function (c) { return c.l; }).join(','));
    var sol = E.solve(g);
    row.states = sol.states;
    if (sol.par === null) problems.push('UNSOLVABLE (exhaustive BFS, ' + sol.states + ' states)');
    else {
      row.par = sol.par;
      if (lv.par !== sol.par) problems.push('par mismatch: file ' + lv.par + ', solver ' + sol.par);
      var st = E.initialState(g), slides = 0, rev = 0, exits = 0, steps = [];
      sol.path.forEach(function (m) {
        var r = E.step(g, st, m.car, m.which), c = g.cars[m.car];
        var hc = E.headCell(g, m.car, st.pos[m.car]);
        steps.push(c.l + '@r' + hc.r + 'c' + hc.c + (m.which === E.FWD ? AR[c.dir] : '(rev)') + (r.result === 'slide' ? r.dist : 'out'));
        if (r.result === 'slide') { slides++; if (m.which === E.BACK) rev++; } else exits++;
        st = r.state;
      });
      row.slides = slides; row.reverse = rev; row.exits = exits;
      if (slides < 1) problems.push('trivial: optimal solution needs no slides');
      var fwd = E.solve(g, null, { forwardOnly: true });
      row.fwdOnlyPar = fwd.par === null ? 'impossible' : fwd.par;
      if (n > 0 && fwd.par !== null && fwd.par <= sol.par) problems.push('reverse moves not needed (forward-only par ' + fwd.par + ')');
      row.minBay = E.minBay(g);
      var ex = E.explore(g, 1500000);
      if (ex.complete) { row.reachable = ex.reachable; row.dead = ex.deadStates; row.losingFirstMoves = ex.firstMovesDead + '/' + ex.firstMoves; }
      row.ms = Date.now() - t0;
      if (args.indexOf('--ascii') !== -1) {
        console.log('\n' + E.ascii(g));
        console.log('  optimal: ' + steps.join('  '));
      }
    }
  }
  row.ok = problems.length === 0;
  if (!row.ok) failures++;
  table.push(row);
  console.log('[' + (row.ok ? 'OK' : 'FAIL') + '] L' + row.n + ' ' + row.word + ' ' + row.grid + ' cars ' + row.cars + ' empty ' + row.empty +
    ' bay ' + row.bay + ' (min ' + row.minBay + ') par ' + row.par + ' [slides ' + row.slides + ', reverse ' + row.reverse + ', exits ' + row.exits +
    '] fwd-only ' + row.fwdOnlyPar + ' | reachable ' + (row.reachable || '?') + ', dead ' + (row.dead === undefined ? '?' : row.dead) +
    ', losing first moves ' + (row.losingFirstMoves || '?') + ' | BFS-to-win states ' + row.states + ' (' + row.ms + ' ms)');
  problems.forEach(function (p) { console.log('   PROBLEM: ' + p); });
});

// difficulty should rise (allowing small dips): par of each level >= 75% of the previous max
var maxPar = 0;
table.forEach(function (r) {
  if (r.par && r.par < Math.floor(maxPar * 0.75)) { failures++; console.log('[FAIL] L' + r.n + ' par ' + r.par + ' drops far below earlier par ' + maxPar); }
  maxPar = Math.max(maxPar, r.par || 0);
});

try {
  var src = fs.readFileSync(JS_PATH, 'utf8'), win = {};
  new Function('window', src)(win);
  if (JSON.stringify(win.WJB_LEVELS) !== JSON.stringify(levels)) { failures++; console.log('[FAIL] js/levels.js is out of date: run with --write'); }
  else console.log('[OK] js/levels.js matches levels/levels.json');
} catch (e) { failures++; console.log('[FAIL] cannot read js/levels.js: ' + e.message); }

if (args.indexOf('--no-py') === -1) {
  var py = cp.spawnSync('python3', [path.join(__dirname, 'wjb_solver.py'), JSON_PATH, '--check'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (py.error) console.log('[SKIP] python3 not found; independent cross-check skipped');
  else if (py.status !== 0) { failures++; console.log('[FAIL] tools/wjb_solver.py --check:\n' + py.stdout + py.stderr); }
  else console.log('[OK] independent Python solver agrees on every par (tools/wjb_solver.py --check)');
}

if (args.indexOf('--json') !== -1) console.log(JSON.stringify(table, null, 1));
console.log(failures ? '\n' + failures + ' problem(s) found' : '\nAll ' + levels.length + ' levels proven winnable; par = fewest moves.');
process.exit(failures ? 1 : 0);
