#!/usr/bin/env node
/*
 * Scramble-level helper (dev only): random lots solved under the Scramble
 * rule (js/engine.js, mode "scramble"), filtered for a breather level.
 * Writes the best candidates to out.json as it finds them.
 *
 *   node tools/scramble-lab.js spec.json out.json
 *
 * spec: { word, grid:[r,c], bay, empty:[min,max], par:[lo,hi], tries, seed, ms,
 *         long2, long3, decoys:"POOL", spares:{E:1}, plant:"OWL",
 *         routeGap: 2,        // in-order par of the same lot must be >= par + routeGap (or impossible)
 *         needBayWord: true,  // a Bay Word must be reachable (full explore) ...
 *         maxStates }         // ... but par must not depend on it (par with == par without)
 * Everything it finds still has to pass tools/verify-levels.js.
 */
'use strict';
const E = require('../js/engine.js');
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const OUT = process.argv[3];
const word = spec.word.toUpperCase();
const [rows, cols] = spec.grid;
let seed = spec.seed || 1;
function rng() { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const pick = a => a[Math.floor(rng() * a.length)];
const DIRN = ['up', 'down', 'left', 'right'];
const POOL = (spec.decoys || 'BDFGHKMNRSTWY').split('').filter(ch => word.indexOf(ch) === -1);

function candidate() {
  const occ = new Set(), cars = [];
  const minEmpty = spec.empty[0], maxEmpty = spec.empty[1];
  const goalEmpty = minEmpty + Math.floor(rng() * (maxEmpty - minEmpty + 1));
  let guard = 0;
  while (rows * cols - occ.size > goalEmpty && guard++ < 4000) {
    const len = rng() < (spec.long3 || 0.1) ? 3 : rng() < (spec.long2 || 0.35) ? 2 : 1;
    const dir = pick(DIRN), d = E.DIRS[dir];
    const r = 1 + Math.floor(rng() * rows), c = 1 + Math.floor(rng() * cols);
    const cells = [];
    for (let k = 0; k < len; k++) cells.push([r - d[0] * k, c - d[1] * k]);
    if (!cells.every(x => x[0] >= 1 && x[0] <= rows && x[1] >= 1 && x[1] <= cols && !occ.has(x[0] + ',' + x[1]))) continue;
    cells.forEach(x => occ.add(x[0] + ',' + x[1]));
    const car = { l: '', r, c, dir };
    if (len > 1) car.len = len;
    cars.push(car);
  }
  const need = word.split('');
  Object.entries(spec.spares || {}).forEach(([ch, k]) => { for (let i = 0; i < k; i++) need.push(ch); });
  const plant = (spec.plant || '').split('');
  if (cars.length < need.length + plant.length) return null;
  const probeLv = { word: 'X', grid: [rows, cols], bay: 1, cars: cars.map(c => Object.assign({}, c, { l: 'X' })) };
  const pg = E.prepare(probeLv), ps = E.initialState(pg), pgrid = E.buildGrid(pg, ps.pos);
  const blocked = cars.map((_, i) => i).filter(i => E.probe(pg, pgrid, ps.pos, i, E.FWD).kind !== 'exit').sort(() => rng() - 0.5);
  if (blocked.length < need.length) return null;
  const used = {};
  need.forEach((u, q) => { used[blocked[q]] = true; cars[blocked[q]].l = u; });
  const rest = cars.map((_, i) => i).filter(i => !used[i]).sort(() => rng() - 0.5);
  plant.forEach((u, q) => { used[rest[q]] = true; cars[rest[q]].l = u; });
  cars.forEach((car, i) => { if (!used[i]) car.l = pick(POOL); });
  return { word, mode: 'scramble', grid: [rows, cols], bay: spec.bay, cars };
}

function measure(lv) {
  const g = E.prepare(lv);
  const s0 = E.initialState(g), grid0 = E.buildGrid(g, s0.pos);
  if (g.cars.some((c, i) => word.indexOf(c.l) !== -1 && E.probe(g, grid0, s0.pos, i, E.FWD).kind === 'exit')) return { why: 'free' };
  const sol = E.solve(g, null, { maxStates: spec.maxStates || 300000 });
  if (sol.par === null) return { why: sol.status };
  if (sol.par < spec.par[0] || sol.par > spec.par[1]) return { why: 'par' };
  let st = E.initialState(g), slides = 0, rev = 0, junk = 0;
  sol.path.forEach(m => { const r = E.step(g, st, m.car, m.which); if (r.result === 'slide') { slides++; if (m.which) rev++; } if (r.result === 'bay') junk++; st = r.state; });
  if (!slides) return { why: 'noslide' };
  const noW = E.solve(E.prepare(lv, { bayWords: false }), null, { maxStates: spec.maxStates || 300000 }).par;
  if (noW !== sol.par) return { why: 'par-needs-bayword' };
  const route = E.solve(E.prepare(Object.assign({}, lv, { mode: 'route' })), null, { maxStates: spec.maxStates || 300000 });
  if (route.status === 'limit') return { why: 'route-limit' };
  if (route.par !== null && route.par < sol.par + (spec.routeGap || 2)) return { why: 'route-close' };
  let words = {}, reach = null;
  if (spec.needBayWord) {
    const ex = E.explore(g, spec.exploreCap || 600000);
    if (!ex.complete) return { why: 'explore-cap' };
    words = ex.bayWords; reach = ex.reachable;
    if (!Object.keys(words).length) return { why: 'no-bayword' };
  }
  return { par: sol.par, states: sol.states, slides, rev, junk, routePar: route.par, words, reach, cars: g.n,
    empty: rows * cols - g.cars.reduce((a, c) => a + c.len, 0) };
}

const why = {}, best = [];
const t0 = Date.now();
for (let i = 0; i < (spec.tries || 1000) && Date.now() - t0 < (spec.ms || 120000); i++) {
  const lv = candidate();
  if (!lv) { why.nocand = (why.nocand || 0) + 1; continue; }
  let m; try { m = measure(lv); } catch (e) { why.err = (why.err || 0) + 1; continue; }
  if (m.why) { why[m.why] = (why[m.why] || 0) + 1; continue; }
  m.score = m.slides + m.rev * 2 + m.junk + (m.routePar === null ? 6 : Math.min(6, m.routePar - m.par)) - m.states / 100000;
  best.push({ m, lv }); best.sort((a, b) => b.m.score - a.m.score); best.splice(spec.keep || 5);
  fs.writeFileSync(OUT, JSON.stringify(best, null, 1));
  console.log('found', JSON.stringify(m));
}
console.log('rejections', JSON.stringify(why), 'in', Date.now() - t0, 'ms');
best.forEach(b => { console.log(JSON.stringify(b.m)); console.log(E.ascii(E.prepare(b.lv))); });
