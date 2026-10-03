#!/usr/bin/env node
/*
 * Level design helper (dev only): proposes dense candidate lots for a spec,
 * proves each with the BFS solver and prints the best few as JSON + ASCII
 * so a designer can pick / hand-edit them into levels/levels.json.
 *
 *   node tools/level-lab.js --word ROCKET --grid 6 6 --bay 3 --empty 6 \
 *        --par 14 20 --tries 4000 --seed 7 [--chunk TH] [--wild 1] [--words BUS,STOP]
 *
 * Everything it prints still has to pass tools/verify-levels.js.
 */
'use strict';
var E = require('../js/engine.js');

function arg(name, n, def) {
  var i = process.argv.indexOf('--' + name);
  if (i === -1) return def;
  return n === 1 ? process.argv[i + 1] : process.argv.slice(i + 1, i + 1 + n);
}
var words = arg('words', 1, null);
var word = words ? words.split(',').join('') : arg('word', 1, 'BUS');
var grid = (arg('grid', 2, ['5', '5'])).map(Number);
var bay = +arg('bay', 1, 3);
var maxEmpty = +arg('empty', 1, 7);
var parRange = (arg('par', 2, ['6', '30'])).map(Number);
var tries = +arg('tries', 1, 2000);
var seed = +arg('seed', 1, 1);
var chunk = arg('chunk', 1, null);
var wild = +arg('wild', 1, 0);
var maxStates = +arg('states', 1, 400000);
var minRev = +arg('rev', 1, 1);
var long3 = +arg('long3', 1, 0.15);
var long2 = +arg('long2', 1, 0.4);
var keep = +arg('keep', 1, 3);

function rng() { // mulberry32
  seed = (seed + 0x6D2B79F5) | 0; var t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function pick(a) { return a[Math.floor(rng() * a.length)]; }
var DIRN = ['up', 'down', 'left', 'right'];
var POOL = 'BDFGHKMNRSTUWY'.split('').filter(function (ch) { return word.indexOf(ch) === -1; });

function units() {
  var u = word.split('');
  if (chunk) { var i = word.indexOf(chunk); u = word.slice(0, i).split('').concat([chunk], word.slice(i + chunk.length).split('')); }
  if (wild) { // replace one letter with a wildcard taxi
    var j = Math.floor(rng() * u.length);
    if (u[j].length === 1) u[j] = '?';
  }
  return u;
}

function candidate() {
  var rows = grid[0], cols = grid[1];
  var occ = new Set(), cars = [];
  var need = units();
  var guard = 0;
  while (rows * cols - occ.size > maxEmpty && guard++ < 4000) {
    var len = rng() < long3 ? 3 : rng() < long2 ? 2 : 1;
    var dir = pick(DIRN), d = E.DIRS[dir];
    var r = 1 + Math.floor(rng() * rows), c = 1 + Math.floor(rng() * cols);
    var cells = [];
    for (var k = 0; k < len; k++) cells.push([r - d[0] * k, c - d[1] * k]);
    if (!cells.every(function (x) { return x[0] >= 1 && x[0] <= rows && x[1] >= 1 && x[1] <= cols && !occ.has(x[0] + ',' + x[1]); })) continue;
    cells.forEach(function (x) { occ.add(x[0] + ',' + x[1]); });
    var car = { l: '', r: r, c: c, dir: dir };
    if (len > 1) car.len = len;
    cars.push(car);
  }
  if (cars.length < need.length) return null;
  // assign the word's units to random vehicles (chunks need a 2+ cell truck)
  // only cars that start blocked in front may carry the word's letters
  var probeLv = { word: 'X', grid: [rows, cols], bay: 1, cars: cars.map(function (c) { var o = Object.assign({}, c); o.l = 'X'; return o; }) };
  var pg = E.prepare(probeLv), ps = E.initialState(pg), pgrid = E.buildGrid(pg, ps.pos);
  var order = cars.map(function (_, i) { return i; })
    .filter(function (i) { return E.probe(pg, pgrid, ps.pos, i, E.FWD).kind !== 'exit'; })
    .sort(function () { return rng() - 0.5; });
  var used = {};
  for (var q = 0; q < need.length; q++) {
    var u = need[q], spot = -1;
    for (var t = 0; t < order.length; t++) {
      var ci = order[t];
      if (used[ci]) continue;
      if (u.length > 1 && !(cars[ci].len > 1)) continue;
      spot = ci; break;
    }
    if (spot < 0) return null;
    used[spot] = true; cars[spot].l = u;
  }
  var blockedSet = {}; order.forEach(function (i) { blockedSet[i] = true; });
  cars.forEach(function (car, i) {
    if (used[i]) return;
    // decoys: mostly letters not in the word; spare copies of word letters only on blocked cars
    car.l = blockedSet[i] && rng() < 0.2 ? pick(word.replace(/[^A-Z]/g, '').split('')) : pick(POOL);
  });
  var lv = { word: word, grid: [rows, cols], bay: bay, cars: cars };
  if (words) { delete lv.word; lv.words = words.split(','); }
  return lv;
}

function metrics(lv) {
  var g = E.prepare(lv);
  // every word-letter car must start blocked in front (you have to work to free it)
  var s0 = E.initialState(g), grid0 = E.buildGrid(g, s0.pos);
  var free = g.cars.filter(function (c, i) {
    return g.target.indexOf(c.l) !== -1 && E.probe(g, grid0, s0.pos, i, E.FWD).kind === 'exit';
  }).length;
  if (free > 0) { why.free++; return null; }
  var sol = E.solve(g, null, { maxStates: maxStates });
  if (sol.par === null) { why[sol.status]++; return null; }
  var st = E.initialState(g), slides = 0, rev = 0, exits = 0;
  sol.path.forEach(function (m) {
    var r = E.step(g, st, m.car, m.which);
    if (r.result === 'slide') { slides++; if (m.which === E.BACK) rev++; } else exits++;
    st = r.state;
  });
  return { par: sol.par, states: sol.states, slides: slides, rev: rev, exits: exits, empty: grid[0] * grid[1] - g.cars.reduce(function (a, c) { return a + c.len; }, 0), cars: g.n };
}

var best = [];
var why = { nocand: 0, free: 0, none: 0, limit: 0, par: 0, rev: 0 };
for (var i = 0; i < tries; i++) {
  var lv = candidate();
  if (!lv) { why.nocand++; continue; }
  var m;
  try { m = metrics(lv); } catch (e) { continue; }
  if (!m) continue;
  if (m.par < parRange[0] || m.par > parRange[1]) { why.par++; if (process.env.LAB_DEBUG) console.log('par', m.par); continue; }
  if (m.rev < minRev) { why.rev++; continue; }
  m.score = m.par + m.rev * 2 + m.slides - m.states / 50000;
  best.push({ m: m, lv: lv });
  best.sort(function (a, b) { return b.m.score - a.m.score; });
  best = best.slice(0, keep);
  var outFile = arg('out', 1, null);
  if (outFile) require('fs').writeFileSync(outFile, JSON.stringify(best, null, 1)); // save progress as we go
}
best.forEach(function (b) {
  console.log(JSON.stringify(b.m));
  console.log(E.ascii(E.prepare(b.lv)));
  console.log(JSON.stringify(b.lv));
  console.log('');
});
if (!best.length) console.log('no candidate met the spec');
console.log('rejections ' + JSON.stringify(why));
