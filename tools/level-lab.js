#!/usr/bin/env node
/*
 * Level design helper (dev only): proposes dense candidate lots for a spec,
 * proves each with the BFS solver and prints the best few as JSON + ASCII
 * so a designer can pick / hand-edit them into levels/levels.json.
 *
 *   node tools/level-lab.js --word ROCKET --grid 6 6 --bay 3 --empty 6 \
 *        --par 14 20 --tries 4000 --seed 7 [--chunk TH] [--wild 1] [--words BUS,STOP]
 *
 * v7 keys and padlocks:
 *   --keys gold:1,blue:2   one key car per colour + that many padlocked cars
 *   --chain 1              the second colour's key car is padlocked by the first
 *   --locktries 30         lock placements tried per lot
 *   --gain 3               the locks must add at least this many moves to par
 *   --scramble 1           solve as a Scramble level
 *   --lockfirst 1          place padlocks first and solve the locked lot; solve lock-free (--basestates) only for lots in range
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
var keySpec = (arg('keys', 1, '') || '').split(',').filter(Boolean).map(function (t) { var a = t.split(':'); return { color: a[0], locks: +(a[1] || 1) }; });
var chain = +arg('chain', 1, 0);
var lockTries = +arg('locktries', 1, 30);
var lockFirst = +arg('lockfirst', 1, 0), baseStates = +arg('basestates', 1, 2000000);
var minGain = +arg('gain', 1, 3);
var scramble = +arg('scramble', 1, 0);

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
  if (scramble) lv.mode = 'scramble';
  return lv;
}
/** A copy of lv with random key / padlock placements per --keys (and --chain). */
function withLocks(lv, early) {
  var o = JSON.parse(JSON.stringify(lv)), idx = o.cars.map(function (_, i) { return i; }).sort(function () { return rng() - 0.5; }), at = 0;
  if (early && rng() < 0.7) { // smart placement: padlocks on cars the lock-free optimum moves early, keys on cars it moves late (or never)
    var late = idx.slice().sort(function (a, b) { return (early[b] === undefined ? 99 : early[b]) - (early[a] === undefined ? 99 : early[a]) + (rng() - 0.5) * 6; });
    idx = [late[0]].concat(idx.filter(function (i) { return i !== late[0]; }).sort(function (a, b) { return (early[a] === undefined ? 99 : early[a]) - (early[b] === undefined ? 99 : early[b]) + (rng() - 0.5) * 4; }));
    if (keySpec.length > 1) { var k2 = late[1] === idx[1] ? late[2] : late[1]; idx = [idx[0], k2].concat(idx.slice(1).filter(function (i) { return i !== k2; })); }
  }
  var keyCar = {};
  keySpec.forEach(function (k) { keyCar[k.color] = idx[at++]; o.cars[keyCar[k.color]].key = k.color; });
  keySpec.forEach(function (k) {
    for (var q = 0; q < k.locks; q++) {
      if (at >= idx.length) return;
      o.cars[idx[at++]].lock = k.color;
    }
  });
  if (chain && keySpec.length > 1) { // the chained key car is locked by colour 1, and colour 1's key is free
    o.cars[keyCar[keySpec[1].color]].lock = keySpec[0].color;
  }
  return o;
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
  return { path: sol.path, par: sol.par, states: sol.states, slides: slides, rev: rev, exits: exits, empty: grid[0] * grid[1] - g.cars.reduce(function (a, c) { return a + c.len; }, 0), cars: g.n };
}

var best = [];
var why = { nocand: 0, free: 0, none: 0, limit: 0, par: 0, rev: 0, gain: 0 };
for (var i = 0; i < tries; i++) {
  if (process.env.LAB_LOG && i % 25 === 0) console.error('try ' + i + ' ' + JSON.stringify(why));
  var lv = candidate();
  if (!lv) { why.nocand++; continue; }
  var m;
  if (keySpec.length && lockFirst) { // padlocks first (the locked lot is cheap to solve), the lock-free solve only for lots in range
    m = null;
    for (var lf = 0; lf < lockTries && !m; lf++) {
      var lk2 = withLocks(lv, null), mk2;
      try { mk2 = metrics(lk2); } catch (e) { continue; }
      if (!mk2) continue;
      if (mk2.par < parRange[0] || mk2.par > parRange[1]) { why.par++; continue; }
      var nl = E.solve(E.prepare(lk2, { locks: false }), null, { maxStates: baseStates });
      if (nl.par === null) { why[nl.status]++; continue; }
      mk2.noLockPar = nl.par; mk2.gain = mk2.par - nl.par;
      if (mk2.gain < minGain) { why.gain++; continue; }
      m = mk2; lv = lk2;
    }
    if (!m) continue;
  } else if (keySpec.length) {
    var base;
    try { base = metrics(lv); } catch (e) { continue; }
    if (!base) continue;
    var bestLock = null, early = {};
    base.path.forEach(function (mv, k) { if (early[mv.car] === undefined) early[mv.car] = k; });
    for (var lt = 0; lt < lockTries; lt++) {
      var lk = withLocks(lv, early), mk;
      try { mk = metrics(lk); } catch (e) { continue; }
      if (!mk) continue;
      mk.gain = mk.par - base.par; mk.noLockPar = base.par;
      if (mk.gain < minGain) { why.gain++; continue; }
      if (mk.par < parRange[0] || mk.par > parRange[1]) { why.par++; continue; }
      if (!bestLock || mk.gain > bestLock.m.gain) bestLock = { m: mk, lv: lk };
    }
    if (!bestLock) continue;
    lv = bestLock.lv; m = bestLock.m;
  } else {
    try { m = metrics(lv); } catch (e) { continue; }
  }
  if (!m) continue;
  if (m.par < parRange[0] || m.par > parRange[1]) { why.par++; if (process.env.LAB_DEBUG) console.log('par', m.par); continue; }
  if (m.rev < minRev) { why.rev++; continue; }
  m.score = m.par + m.rev * 2 + m.slides - m.states / 50000 + (m.gain || 0) * 2;
  delete m.path;
  best.push({ m: m, lv: lv });
  if (process.env.LAB_LOG) console.error('found par ' + m.par + ' gain ' + m.gain + ' at try ' + i);
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
