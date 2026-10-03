#!/usr/bin/env node
/*
 * Word Jam Bus level verifier (Node, no dependencies).
 *
 *   node tools/verify-levels.js          verify levels/levels.json
 *   node tools/verify-levels.js --write  also regenerate js/levels.js from it
 *   node tools/verify-levels.js --ascii  print each lot and its solution
 *
 * For every level it checks: valid layout (in grid, no overlaps), solvable
 * within its bay size (BFS over every tap order, using js/engine.js - the
 * same rules code the game runs), and that "par" equals the solver's fewest
 * moves. It also checks js/levels.js (what the browser loads) matches
 * levels/levels.json, and, if python3 is available, cross-checks par with
 * tools/wjb_solver.py. Exits 1 on any failure.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var Engine = require('../js/engine.js');

var ROOT = path.join(__dirname, '..');
var JSON_PATH = path.join(ROOT, 'levels', 'levels.json');
var JS_PATH = path.join(ROOT, 'js', 'levels.js');
var args = process.argv.slice(2);
var data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
var levels = Array.isArray(data) ? data : data.levels;
var AR = { up: '↑', down: '↓', left: '←', right: '→' };
var failures = 0;

function jsFileFor(d) {
  return '/* GENERATED from levels/levels.json by `node tools/verify-levels.js --write`. Do not edit by hand. */\n' +
    'window.WJB_LEVELS = ' + JSON.stringify(d.levels || d, null, 1) + ';\n';
}

if (args.indexOf('--write') !== -1) {
  fs.writeFileSync(JS_PATH, jsFileFor(data));
  console.log('wrote ' + path.relative(ROOT, JS_PATH));
}

var seen = {};
levels.forEach(function (lv, n) {
  var problems = [];
  var label = 'Level ' + (n + 1) + ' [' + lv.id + '] ' + (lv.words ? lv.words.join(' + ') : lv.word);
  if (!lv.id) problems.push('missing id');
  else if (seen[lv.id]) problems.push('duplicate id');
  seen[lv.id] = true;
  var game;
  try { game = Engine.prepare(lv); } catch (e) { problems.push(e.message); }
  if (game) {
    // A car facing a car that faces it head-on can never move.
    game.cars.forEach(function (car) {
      car.blockers.forEach(function (b) {
        if (game.cars[b].blockers.indexOf(car.id) !== -1 && b > car.id) problems.push('blocking cycle between cars ' + car.id + ' and ' + b);
      });
    });
    var sol = Engine.solve(game);
    if (sol.par === null) problems.push('UNSOLVABLE with bay ' + lv.bay);
    else if (lv.par !== undefined && lv.par !== sol.par) problems.push('par mismatch: file ' + lv.par + ', solver ' + sol.par);
    if (sol.par !== null) {
      var ex = Engine.explore(game), mb = Engine.minBay(game);
      console.log('[' + (problems.length ? 'FAIL' : 'OK') + '] ' + label + ': ' + game.rows + 'x' + game.cols +
        ', cars ' + game.cars.length + ', bay ' + lv.bay + ' (min needed ' + mb + '), par ' + sol.par +
        ', reachable ' + ex.reachable + ', dead states ' + ex.deadStates +
        ', losing first taps [' + ex.firstMovesDead.join(',') + ']');
      if (args.indexOf('--ascii') !== -1) {
        console.log(Engine.ascii(game));
        console.log('  solution: ' + sol.path.map(function (i) {
          var c = game.cars[i]; return c.l + '@r' + c.r + 'c' + c.c + AR[c.dir];
        }).join('  '));
      }
    }
  }
  if (problems.length) {
    failures++;
    if (!game || Engine.solve(game).par === null) console.log('[FAIL] ' + label);
    problems.forEach(function (p) { console.log('   PROBLEM: ' + p); });
  }
});

// js/levels.js must match levels.json (the browser loads the .js so the game works from file://).
try {
  var src = fs.readFileSync(JS_PATH, 'utf8');
  var sandbox = { window: {} };
  new Function('window', src)(sandbox.window);
  if (JSON.stringify(sandbox.window.WJB_LEVELS) !== JSON.stringify(levels)) {
    failures++; console.log('[FAIL] js/levels.js is out of date: run node tools/verify-levels.js --write');
  } else console.log('[OK] js/levels.js matches levels/levels.json');
} catch (e) { failures++; console.log('[FAIL] cannot read js/levels.js: ' + e.message); }

// Optional cross-check with the reference Python solver.
var py = cp.spawnSync('python3', [path.join(__dirname, 'wjb_solver.py'), JSON_PATH, '--check'], { encoding: 'utf8' });
if (py.error) console.log('[SKIP] python3 not found; reference solver cross-check skipped');
else if (py.status !== 0) { failures++; console.log('[FAIL] tools/wjb_solver.py --check failed:\n' + py.stdout + py.stderr); }
else console.log('[OK] tools/wjb_solver.py --check agrees (exit 0)');

console.log(failures ? '\n' + failures + ' problem(s) found' : '\nAll ' + levels.length + ' levels verified solvable; par matches solver.');
process.exit(failures ? 1 : 0);
