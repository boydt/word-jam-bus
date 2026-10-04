#!/usr/bin/env node
/*
 * Level design helper (dev only): hill-climbs a hand-picked lot to make it
 * harder without changing its density - swaps which cars carry which letters
 * and flips car directions, keeping a change only if the level stays valid,
 * every word letter starts blocked, and par goes up (BFS-proven).
 *
 *   node tools/level-improve.js in.json out.json --iters 200 --states 600000 --maxpar 30 --seed 3 [--drift]
 *   (--drift also accepts equal-par changes, to wander across plateaus)
 *   --locks also moves key badges and padlocks to other cars (v7 key levels)
 */
'use strict';
var fs = require('fs');
var E = require('../js/engine.js');
var lv = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
var out = process.argv[3];
function arg(n, d) { var i = process.argv.indexOf('--' + n); return i === -1 ? d : +process.argv[i + 1]; }
var iters = arg('iters', 200), maxStates = arg('states', 600000), maxPar = arg('maxpar', 99), seed = arg('seed', 1), drift = process.argv.indexOf('--drift') !== -1;
var moveLocks = process.argv.indexOf('--locks') !== -1;
function rng() { seed = (seed + 0x6D2B79F5) | 0; var t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
var OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };

function score(level) {
  var g;
  try { g = E.prepare(level); } catch (e) { return null; }
  var s0 = E.initialState(g), grid = E.buildGrid(g, s0.pos);
  for (var i = 0; i < g.n; i++) {
    var c = g.cars[i];
    if ((c.l === '?' || g.target.indexOf(c.l) !== -1) && E.probe(g, grid, s0.pos, i, E.FWD).kind === 'exit') return null;
  }
  var sol = E.solve(g, null, { maxStates: maxStates });
  if (sol.par === null || sol.par > maxPar) return null;
  var fwd = E.solve(g, null, { forwardOnly: true, maxStates: maxStates });
  if (fwd.par !== null && fwd.par <= sol.par) return null; // reverse moves must matter
  return { par: sol.par, states: sol.states };
}
function mutate(level) {
  var L = JSON.parse(JSON.stringify(level)), cars = L.cars;
  var a = Math.floor(rng() * cars.length), b = Math.floor(rng() * cars.length);
  var r = rng();
  if (moveLocks && r < 0.3) {                                                           // move a key badge / padlock to another car
    var tagged = cars.map(function (c, i) { return i; }).filter(function (i) { return cars[i].key || cars[i].lock; });
    var from = cars[tagged[Math.floor(rng() * tagged.length)]], to = cars[b], f = from.lock && (!from.key || rng() < 0.6) ? 'lock' : 'key';
    if (to[f] || to === from) return L;
    to[f] = from[f]; delete from[f];
    return L;
  }
  if (r < 0.5) { var t = cars[a].l; cars[a].l = cars[b].l; cars[b].l = t; }          // swap letters
  else {                                                                                // flip direction
    var c = cars[a], n = c.len || 1, d = E.DIRS[c.dir];
    c.r -= d[0] * (n - 1); c.c -= d[1] * (n - 1); c.dir = OPP[c.dir];
  }
  return L;
}
var best = score(lv);
if (!best) { console.log('input level does not meet constraints'); process.exit(1); }
console.log('start par ' + best.par + ' states ' + best.states);
for (var k = 0; k < iters; k++) {
  var cand = mutate(lv), sc = score(cand);
  if (sc && (sc.par > best.par || (sc.par === best.par && (drift || sc.states < best.states)))) {
    var up = sc.par > best.par || sc.states < best.states; lv = cand; best = sc; if (up) console.log('iter ' + k + ': par ' + sc.par + ' states ' + sc.states);
    fs.writeFileSync(out, JSON.stringify(lv));
  }
}
fs.writeFileSync(out, JSON.stringify(lv));
console.log('final par ' + best.par + ' states ' + best.states);
console.log(E.ascii(E.prepare(lv)));
