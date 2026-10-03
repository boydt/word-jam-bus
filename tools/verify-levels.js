#!/usr/bin/env node
/*
 * Word Jam Bus level verifier (Node, no dependencies) - v2 slide rules, tiered checks.
 *
 *   node tools/verify-levels.js            verify levels/levels.json
 *   node tools/verify-levels.js --write    also regenerate js/levels.js from it
 *   node tools/verify-levels.js --ascii    print each lot and an optimal solution
 *   node tools/verify-levels.js --no-py    skip the Python cross-check
 *
 * Every level (any tier):
 *  - valid layout (in grid, no overlaps, every car has a letter), unique id;
 *  - winnable within its bay: exhaustive BFS over every slide / reverse /
 *    exit sequence, using js/engine.js (the code the game runs);
 *  - "par" equals the fewest moves (1 move = 1 slide or 1 exit).
 * Checks depend on the level's tier:
 *  - tier "starter" (the beginner levels, "tier": "starter" in the JSON):
 *    the mechanic named in "teaches" really is needed -
 *      exit:    the optimal line is taps only (no slides needed);
 *      slide:   cannot be won as fast without partial slides, and needs no
 *               reverse and no bay;
 *      reverse: cannot be won as fast driving forward only, and needs no bay;
 *      bay:     cannot be won as fast without parking a letter in the bay;
 *      trucks:  has a long truck;  bay-limit: a loss is reachable;
 *    "safe": true means no losing move exists anywhere in the level;
 *    par never decreases from one starter level to the next and stays below
 *    the first core level's par (the last starter sits within 2 of it).
 *  - tier "core" (default; the original v2 levels): every word-letter car
 *    starts blocked; the optimal solution needs slides; reverse moves matter
 *    (forward-only is impossible or slower, except the first core level);
 *    par of each core level >= 75% of the previous core max.
 * It reports cars, empty cells, min bay needed, reachable / dead states.
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

/** Plain BFS with move filters, for the starter checks: {fwdOnly, noSlide, noBay}. Returns {par, loseReachable}. */
function restricted(g, opts, full) {
  var s0 = E.initialState(g), seen = new Set([E.stateKey(s0)]), frontier = [s0], depth = 0, par = null, lose = false;
  while (frontier.length && seen.size < 2000000) {
    var next = [];
    for (var f = 0; f < frontier.length; f++) {
      var st = frontier[f], grid = E.buildGrid(g, st.pos);
      for (var i = 0; i < g.n; i++) for (var w = 0; w < 2; w++) {
        if (opts.fwdOnly && w === E.BACK) continue;
        var r = E.step(g, st, i, w, null, grid);
        if (r.result === 'gone' || r.result === 'bump') continue;
        if (opts.noSlide && r.result === 'slide') continue;
        if (opts.noBay && r.result === 'bay') continue;
        if (r.result === 'lose') { lose = true; continue; }
        var k = E.stateKey(r.state);
        if (seen.has(k)) continue;
        seen.add(k);
        if (r.won) { if (par === null) par = depth + 1; continue; }
        next.push(r.state);
      }
    }
    if (par !== null && !full) break;
    frontier = next; depth++;
  }
  return { par: par, loseReachable: lose, complete: seen.size < 2000000 };
}
function worse(p, par) { return p === null || p > par; }

var seenIds = {};
var coreSeen = 0;
levels.forEach(function (lv, n) {
  var problems = [];
  var name = (lv.words ? lv.words.join('+') : lv.word);
  if (!lv.id) problems.push('missing id'); else if (seenIds[lv.id]) problems.push('duplicate id'); seenIds[lv.id] = true;
  var g = null;
  try { g = E.prepare(lv); } catch (e) { problems.push(e.message); }
  var tier = lv.tier || 'core';
  var row = { n: n + 1, id: lv.id, word: name, grid: lv.grid.join('x'), bay: lv.bay, tier: tier, teaches: lv.teaches || '' };
  var coreIdx = tier === 'core' ? coreSeen++ : -1;
  if (g) {
    var t0 = Date.now();
    var cells = g.rows * g.cols, used = g.cars.reduce(function (a, c) { return a + c.len; }, 0);
    row.cars = g.n; row.empty = cells - used;
    var s0 = E.initialState(g), grid0 = E.buildGrid(g, s0.pos);
    var freeLetters = g.cars.filter(function (c, i) {
      return (c.l === '?' || g.target.indexOf(c.l) !== -1) && E.probe(g, grid0, s0.pos, i, E.FWD).kind === 'exit';
    });
    if (tier === 'core' && freeLetters.length) problems.push('word-letter car(s) can exit on move 1: ' + freeLetters.map(function (c) { return c.l; }).join(','));
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
      var fwd = E.solve(g, null, { forwardOnly: true });
      row.fwdOnlyPar = fwd.par === null ? 'impossible' : fwd.par;
      if (tier === 'core') {
        if (slides < 1) problems.push('trivial: optimal solution needs no slides');
        if (coreIdx > 0 && fwd.par !== null && fwd.par <= sol.par) problems.push('reverse moves not needed (forward-only par ' + fwd.par + ')');
      } else if (tier === 'starter') {
        var any = restricted(g, {}, true), noSlide = restricted(g, { noSlide: true }), noBay = restricted(g, { noBay: true });
        row.canLose = any.loseReachable; row.noSlidePar = noSlide.par; row.noBayPar = noBay.par;
        var t = lv.teaches;
        if (t === 'exit' && slides > 0) problems.push('teaches exit, but the optimal line needs slides');
        if (t === 'slide') {
          if (!worse(noSlide.par, sol.par)) problems.push('teaches slide, but it can be won as fast without slides (' + noSlide.par + ')');
          if (fwd.par !== sol.par) problems.push('teaches slide, but needs reverse moves');
          if (noBay.par !== sol.par) problems.push('teaches slide, but needs the bay');
        }
        if (t === 'reverse') {
          if (!worse(fwd.par, sol.par)) problems.push('teaches reverse, but forward-only is as fast (' + fwd.par + ')');
          if (noBay.par !== sol.par) problems.push('teaches reverse, but needs the bay');
        }
        if (t === 'bay' && !worse(noBay.par, sol.par)) problems.push('teaches bay, but it can be won as fast without the bay (' + noBay.par + ')');
        if (t === 'trucks' && !g.cars.some(function (c) { return c.len > 1; })) problems.push('teaches trucks, but has none');
        if (t === 'bay-limit' && !any.loseReachable) problems.push('teaches the bay limit, but no loss is reachable');
        if (lv.safe && any.loseReachable) problems.push('marked safe, but a losing move is reachable');
        if (!lv.tip) problems.push('starter level without a tip');
      } else problems.push('unknown tier ' + tier);
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
  console.log('[' + (row.ok ? 'OK' : 'FAIL') + '] L' + row.n + ' ' + (tier === 'starter' ? '(starter: ' + row.teaches + ') ' : '') + row.word + ' ' + row.grid + ' cars ' + row.cars + ' empty ' + row.empty +
    ' bay ' + row.bay + ' (min ' + row.minBay + ') par ' + row.par + ' [slides ' + row.slides + ', reverse ' + row.reverse + ', exits ' + row.exits +
    '] fwd-only ' + row.fwdOnlyPar + ' | reachable ' + (row.reachable || '?') + ', dead ' + (row.dead === undefined ? '?' : row.dead) +
    ', losing first moves ' + (row.losingFirstMoves || '?') + (tier === 'starter' ? ', loss possible ' + (row.canLose ? 'yes' : 'no') + ', no-slide par ' + row.noSlidePar + ', no-bay par ' + row.noBayPar : '') +
    ' | BFS-to-win states ' + row.states + ' (' + row.ms + ' ms)');
  problems.forEach(function (p) { console.log('   PROBLEM: ' + p); });
});

// difficulty should rise.
// core tier: par of each level >= 75% of the previous core max (small dips allowed)
var maxPar = 0;
table.filter(function (r) { return r.tier === 'core'; }).forEach(function (r) {
  if (r.par && r.par < Math.floor(maxPar * 0.75)) { failures++; console.log('[FAIL] L' + r.n + ' par ' + r.par + ' drops far below earlier par ' + maxPar); }
  maxPar = Math.max(maxPar, r.par || 0);
});
// starter tier: par never decreases, stays below the first core level, and the last one hands off within 2
var starters = table.filter(function (r) { return r.tier === 'starter'; });
var firstCore = table.filter(function (r) { return r.tier === 'core'; })[0];
starters.forEach(function (r, k) {
  if (k && r.par < starters[k - 1].par) { failures++; console.log('[FAIL] starter L' + r.n + ' par ' + r.par + ' is below the previous starter par ' + starters[k - 1].par); }
  if (firstCore && r.par >= firstCore.par) { failures++; console.log('[FAIL] starter L' + r.n + ' par ' + r.par + ' is not below the first core level par ' + firstCore.par); }
});
if (starters.length && firstCore) {
  var lastS = starters[starters.length - 1];
  if (lastS.par < firstCore.par - 2) { failures++; console.log('[FAIL] last starter par ' + lastS.par + ' is more than 2 below the first core par ' + firstCore.par); }
  else console.log('[OK] starter ramp: par ' + starters.map(function (r) { return r.par; }).join(' -> ') + ', then core L' + firstCore.n + ' par ' + firstCore.par);
}
if (starters.length && table.indexOf(starters[starters.length - 1]) > table.indexOf(firstCore)) { failures++; console.log('[FAIL] starter levels must come before the core levels'); }

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
