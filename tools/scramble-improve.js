#!/usr/bin/env node
/*
 * Scramble-level helper (dev only): hill-climbs a lot toward a target par under
 * the Scramble rule. Starts from a sparse random lot (easy to solve) and keeps
 * mutations - swap letters, flip a car, add / remove / move a decoy car - that
 * stay valid (every word letter starts blocked, BFS-solvable) and bring par
 * closer to the target while filling the lot up to the wanted density.
 * Saves every lot that meets the spec to out.json.
 *
 *   node tools/scramble-improve.js spec.json out.json
 *
 * spec: { word, grid:[r,c], bay, par:[lo,hi], empty:[min,max], decoys:"POOL", spares:{L:1}, plant:"OW",
 *         routeGap, needBayWord, exploreCap, maxStates, iters, restarts, ms, seed }
 * Everything it finds still has to pass tools/verify-levels.js.
 */
'use strict';
const E = require('../js/engine.js');
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const word = spec.word.toUpperCase(), [rows, cols] = spec.grid;
let seed = spec.seed || 1;
function rng() { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = a => a[Math.floor(rng() * a.length)];
const DIRN = ['up', 'down', 'left', 'right'], OPP = { up: 'down', down: 'up', left: 'right', right: 'left' };
const POOL = (spec.decoys || 'BDFGHKMNRSTWY').split('').filter(ch => word.indexOf(ch) === -1);
const fixedLetters = word.split('').concat(...Object.entries(spec.spares || {}).map(([ch, k]) => Array(k).fill(ch)), (spec.plant || '').split(''));
const cellsOf = c => { const d = E.DIRS[c.dir], out = []; for (let k = 0; k < (c.len || 1); k++) out.push([c.r - d[0] * k, c.c - d[1] * k]); return out; };
const inGrid = x => x[0] >= 1 && x[0] <= rows && x[1] >= 1 && x[1] <= cols;
function occupied(cars, skip) { const o = new Set(); cars.forEach((c, i) => { if (i !== skip) cellsOf(c).forEach(x => o.add(x + '')); }); return o; }
function tryPlace(cars, len, skip) {
  const occ = occupied(cars, skip);
  for (let t = 0; t < 60; t++) {
    const car = { l: '', r: 1 + Math.floor(rng() * rows), c: 1 + Math.floor(rng() * cols), dir: pick(DIRN) };
    if (len > 1) car.len = len;
    if (cellsOf(car).every(x => inGrid(x) && !occ.has(x + ''))) return car;
  }
  return null;
}
const emptyOf = cars => rows * cols - cars.reduce((a, c) => a + (c.len || 1), 0);
function start() {
  const cars = [];
  const goal = spec.empty[1] + 5;
  let guard = 0;
  while (emptyOf(cars) > goal && guard++ < 500) {
    const len = rng() < 0.1 ? 3 : rng() < 0.35 ? 2 : 1, c = tryPlace(cars, len);
    if (c) cars.push(c);
  }
  if (cars.length < fixedLetters.length) return null;
  const idx = cars.map((_, i) => i).sort(() => rng() - 0.5);
  idx.forEach((ci, k) => { cars[ci].l = k < fixedLetters.length ? fixedLetters[k] : pick(POOL); });
  return { word, mode: 'scramble', grid: [rows, cols], bay: spec.bay, cars };
}
function mutate(lv) {
  const L = JSON.parse(JSON.stringify(lv)), cars = L.cars, r = rng();
  const a = Math.floor(rng() * cars.length), b = Math.floor(rng() * cars.length);
  const decoys = cars.map((c, i) => i).filter(i => POOL.indexOf(cars[i].l) !== -1);
  if (r < 0.3) { const t = cars[a].l; cars[a].l = cars[b].l; cars[b].l = t; }
  else if (r < 0.5) { const c = cars[a], n = c.len || 1, d = E.DIRS[c.dir]; c.r -= d[0] * (n - 1); c.c -= d[1] * (n - 1); c.dir = OPP[c.dir]; }
  else if (r < 0.75 && emptyOf(cars) > spec.empty[0]) { const len = rng() < 0.12 ? 3 : rng() < 0.35 ? 2 : 1; if (emptyOf(cars) - len < spec.empty[0]) return null; const c = tryPlace(cars, len); if (!c) return null; c.l = pick(POOL); cars.push(c); }
  else if (r < 0.85 && decoys.length) { cars.splice(pick(decoys), 1); }
  else { const c = tryPlace(cars, cars[a].len || 1, a); if (!c) return null; c.l = cars[a].l; cars[a] = c; }
  return L;
}
function measure(lv, full) {
  let g; try { g = E.prepare(lv); } catch (e) { return null; }
  const s0 = E.initialState(g), grid = E.buildGrid(g, s0.pos);
  if (g.cars.some((c, i) => word.indexOf(c.l) !== -1 && E.probe(g, grid, s0.pos, i, E.FWD).kind === 'exit')) return null;
  const sol = E.solve(g, null, { maxStates: spec.maxStates || 150000 });
  if (sol.par === null) return null;
  const m = { par: sol.par, states: sol.states, empty: emptyOf(lv.cars), cars: g.n };
  if (!full) return m;
  let st = E.initialState(g); m.slides = 0; m.rev = 0; m.junk = 0;
  sol.path.forEach(mv => { const r = E.step(g, st, mv.car, mv.which); if (r.result === 'slide') { m.slides++; if (mv.which) m.rev++; } if (r.result === 'bay') m.junk++; st = r.state; });
  if (!m.slides) return Object.assign(m, { why: 'noslide' });
  const noW = E.solve(E.prepare(lv, { bayWords: false }), null, { maxStates: spec.maxStates || 150000 }).par;
  if (noW !== sol.par) return Object.assign(m, { why: 'needs-bayword' });
  const route = E.solve(E.prepare(Object.assign({}, lv, { mode: 'route' })), null, { maxStates: spec.routeStates || 400000 });
  m.routePar = route.status === 'limit' ? 'limit' : route.par;
  if (route.status === 'limit') return Object.assign(m, { why: 'route-limit' });
  if (route.par !== null && route.par < sol.par + (spec.routeGap || 2)) return Object.assign(m, { why: 'route-close' });
  if (spec.needBayWord) {
    const ex = E.explore(g, spec.exploreCap || 600000);
    if (!ex.complete) return Object.assign(m, { why: 'explore-cap' });
    m.words = ex.bayWords; m.reach = ex.reachable;
    if (!Object.keys(ex.bayWords).length) return Object.assign(m, { why: 'no-bayword' });
  }
  return m;
}
const target = (spec.par[0] + spec.par[1]) / 2;
const fit = m => -Math.abs(m.par - target) * 10 - Math.max(0, m.empty - spec.empty[1]) * 6 - m.states / 200000;
const found = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
const t0 = Date.now(), why = {};
for (let rs = 0; rs < (spec.restarts || 50) && Date.now() - t0 < (spec.ms || 300000); rs++) {
  let lv = null, m = null;
  for (let t = 0; t < 200 && !m; t++) { lv = start(); if (lv) m = measure(lv); }
  if (!m) continue;
  let f = fit(m);
  for (let it = 0; it < (spec.iters || 400) && Date.now() - t0 < (spec.ms || 300000); it++) {
    const c = mutate(lv); if (!c) continue;
    const cm = measure(c); if (!cm) continue;
    const cf = fit(cm);
    if (cf >= f) { lv = c; m = cm; f = cf; }
    if (m.par >= spec.par[0] && m.par <= spec.par[1] && m.empty >= spec.empty[0] && m.empty <= spec.empty[1]) {
      const full = measure(lv, true);
      if (full && !full.why) {
        found.push({ m: full, lv }); fs.writeFileSync(OUT, JSON.stringify(found, null, 1));
        console.log('FOUND', JSON.stringify(full)); console.log(E.ascii(E.prepare(lv)));
        break;
      }
      if (full) why[full.why] = (why[full.why] || 0) + 1;
    }
  }
  console.log('restart ' + rs + ' end par ' + m.par + ' empty ' + m.empty + ' states ' + m.states + ' | ' + JSON.stringify(why) + ' [' + Math.round((Date.now() - t0) / 1000) + 's]');
}
