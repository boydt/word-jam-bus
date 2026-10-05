#!/usr/bin/env node
/*
 * Normal-level helper (v9, dev only): random lots filtered for the "normal" tier -
 * forgiving, multi-path levels with par in a range, rated by tools/difficulty.js.
 *
 *   node tools/normal-lab.js spec.json out.json
 *
 * spec: { word, grid:[r,c], bay, cars:[min,max], truck (share of long cars), truck3,
 *         par:[lo,hi], score:[lo,hi], minTrack, minFirst, minOptimal, decoys:[lo,hi],
 *         maxFree (word letters that can exit on move 1), canLose, minRev, tries, ms, seed, keep }
 * Every candidate still has to pass tools/verify-levels.js.
 */
'use strict';
const E = require('../js/engine.js');
const D = require('./difficulty.js');
const { rsolve } = require('./starter-lab.js');
const fs = require('fs');

const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let seed = spec.seed || 1;
const rng = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const word = spec.word;
const POOL = 'BDFGHKMNRWYZVJXQ'.split('').filter(c => word.indexOf(c) === -1);
const [R, C] = spec.grid, DIRN = ['up', 'down', 'left', 'right'];
const out = [], t0 = Date.now();
let tried = 0, parOk = 0;
for (let tr = 0; tr < (spec.tries || 1e9) && Date.now() - t0 < (spec.ms || 60000); tr++) {
  tried++;
  const ncars = spec.cars[0] + Math.floor(rng() * (spec.cars[1] - spec.cars[0] + 1));
  const occ = new Set(), cars = [];
  let guard = 0;
  while (cars.length < ncars && guard++ < 600) {
    const dir = DIRN[Math.floor(rng() * 4)], len = rng() < (spec.truck || 0) ? (rng() < (spec.truck3 || 0) ? 3 : 2) : 1;
    const r = 1 + Math.floor(rng() * R), c = 1 + Math.floor(rng() * C);
    const d = E.DIRS[dir], cells = [];
    for (let k = 0; k < len; k++) cells.push([r - d[0] * k, c - d[1] * k]);
    if (cells.some(([a, b]) => a < 1 || a > R || b < 1 || b > C || occ.has(a + ',' + b))) continue;
    cells.forEach(([a, b]) => occ.add(a + ',' + b));
    const car = { l: '', r, c, dir }; if (len > 1) car.len = len; cars.push(car);
  }
  if (cars.length < ncars) continue;
  const units = word.split('');
  if (units.length > cars.length) continue;
  const order = cars.map((_, i) => i).sort(() => rng() - 0.5);
  order.forEach((ci, k) => { cars[ci].l = k < units.length ? units[k] : POOL[Math.floor(rng() * POOL.length)]; });
  const decoys = cars.length - units.length;
  if (spec.decoys && (decoys < spec.decoys[0] || decoys > spec.decoys[1])) continue;
  if (spec.minTrucks && cars.filter(c => c.len > 1).length < spec.minTrucks) continue;
  const lv = { word, grid: spec.grid, bay: spec.bay, cars };
  let g; try { g = E.prepare(lv); } catch (e) { continue; }
  const s0 = E.initialState(g), grid0 = E.buildGrid(g, s0.pos);
  const free = g.cars.filter((c, i) => word.indexOf(c.l) !== -1 && E.probe(g, grid0, s0.pos, i, E.FWD).kind === 'exit').length;
  if (spec.maxFree !== undefined && free > spec.maxFree) continue;
  const b0 = E.solve(g, null, { maxStates: spec.states || 300000 });
  if (b0.par === null || b0.par < spec.par[0] || b0.par > spec.par[1]) continue;
  parOk++;
  let rev = 0, slides = 0, bayUses = 0; { let st = s0; for (const m of b0.path) { const r = E.step(g, st, m.car, m.which); if (r.result === 'slide') { slides++; if (m.which) rev++; } if (r.result === 'bay') bayUses++; st = r.state; } }
  if (slides < 1 || (spec.minRev && rev < spec.minRev)) continue;
  const rt = D.rate(lv, { maxStates: spec.maxStates || 800000 });
  if (!rt || !rt.complete) continue;
  if (spec.score && (rt.score < spec.score[0] || rt.score >= spec.score[1])) continue;
  if (spec.minTrack && rt.track < spec.minTrack) continue;
  if (spec.minFirst && rt.first < spec.minFirst) continue;
  if (spec.minOptimal && rt.v.optimal < spec.minOptimal) continue;
  if (spec.canLose !== undefined) { const all = rsolve(g, {}, true); if (all.loseReachable !== spec.canLose) continue; }
  out.push({ a: { par: rt.v.par, score: +rt.score.toFixed(2), tier: rt.label, first: rt.stored.first, track: +rt.track.toFixed(3), first2: rt.v.firstOk + '/' + rt.v.firstMoves,
    optimal: rt.v.optimal, seqWithin: rt.v.seqWithin, states: rt.v.states, cars: cars.length, trucks: cars.filter(c => c.len > 1).length, decoys, free, slides, rev, bayUses }, lv });
  fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
  console.log('#' + out.length + ' ' + JSON.stringify(out[out.length - 1].a));
  if (out.length >= (spec.keep || 12)) break;
}
console.log('done: tried ' + tried + ', par-ok ' + parOk + ', kept ' + out.length + ' in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
