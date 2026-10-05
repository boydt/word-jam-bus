#!/usr/bin/env node
/*
 * Normal-level hill climb (v9, dev only): random edits to a seed lot (move, turn, grow or
 * shrink a car, add or drop a decoy, swap letters) that keep it inside the normal-tier
 * limits, collecting every lot that hits the target par and passes the normal checks.
 *
 *   node tools/normal-improve.js spec.json out.json
 *
 * spec: { seed: level object (or {file, index}), word? (relabel the seed's word cars),
 *         par:[lo,hi] (target), walk:[lo,hi] (par allowed while walking), score:[lo,hi],
 *         minTrack, minFirst, minOptimal, decoys:[lo,hi], maxFree, cars:[min,max], steps, ms, rng, keep,
 *         burn (edits before anything is kept, so the lot drifts away from the seed) }
 */
'use strict';
const E = require('../js/engine.js');
const D = require('./difficulty.js');
const { rsolve } = require('./starter-lab.js');
const fs = require('fs');
const spec = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let seed = spec.rng || 7;
const rnd = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = a => a[Math.floor(rnd() * a.length)];
let base = spec.seed.file ? JSON.parse(fs.readFileSync(spec.seed.file, 'utf8'))[spec.seed.index || 0].lv : spec.seed;
base = JSON.parse(JSON.stringify(base));
const word = spec.word || base.word;
const POOL = 'BDFGHKMNRWYZVJXQ'.split('').filter(c => word.indexOf(c) === -1);
const orig = JSON.parse(JSON.stringify(base));
function relabel() {
  base = JSON.parse(JSON.stringify(orig));
  // relabel: the old word's cars (in word order) get the new word's letters; the rest become decoys
  const old = base.word.split(''), used = new Set(), wc = [];
  old.forEach(ch => { const i = base.cars.findIndex((c, k) => !used.has(k) && c.l === ch); if (i >= 0) { used.add(i); wc.push(i); } });
  base.cars.forEach((c, k) => { if (!used.has(k)) c.l = pick(POOL); });
  const others = base.cars.map((_, k) => k).filter(k => !used.has(k)).sort(() => rnd() - 0.5);
  word.split('').forEach((ch, j) => { const k = j < wc.length ? wc[j] : others.pop(); base.cars[k].l = ch; });
  wc.slice(word.length).forEach(k => { base.cars[k].l = pick(POOL); });
  base.word = word;
}
if (spec.word && spec.word !== orig.word) relabel();
const [R, C] = base.grid, DIRN = ['up', 'down', 'left', 'right'];
function cellsOf(car) { const d = E.DIRS[car.dir], out = []; for (let k = 0; k < (car.len || 1); k++) out.push([car.r - d[0] * k, car.c - d[1] * k]); return out; }
function valid(lv) {
  const occ = new Set();
  for (const car of lv.cars) for (const [a, b] of cellsOf(car)) { if (a < 1 || a > R || b < 1 || b > C || occ.has(a + ',' + b)) return false; occ.add(a + ',' + b); }
  return true;
}
function mutate(lv) {
  const m = JSON.parse(JSON.stringify(lv)), k = Math.floor(rnd() * m.cars.length), car = m.cars[k], op = rnd();
  const isWord = word.indexOf(car.l) !== -1;
  if (op < 0.25) car.dir = pick(DIRN);
  else if (op < 0.5) { car.r = 1 + Math.floor(rnd() * R); car.c = 1 + Math.floor(rnd() * C); }
  else if (op < 0.62) { const L = (car.len || 1) + (rnd() < 0.5 ? 1 : -1); if (L < 1 || L > 3) return null; if (L === 1) delete car.len; else car.len = L; }
  else if (op < 0.74) { m.cars.push({ l: pick(POOL), r: 1 + Math.floor(rnd() * R), c: 1 + Math.floor(rnd() * C), dir: pick(DIRN) }); }
  else if (op < 0.84) { if (isWord) return null; m.cars.splice(k, 1); }
  else if (op < 0.94) { const j = Math.floor(rnd() * m.cars.length); const t = m.cars[j].l; m.cars[j].l = car.l; car.l = t; }
  else { if (isWord) return null; car.l = pick(POOL); }
  return valid(m) ? m : null;
}
function quick(lv) {
  let g; try { g = E.prepare(lv); } catch (e) { return null; }
  const dec = lv.cars.length - word.length;
  if (spec.decoys && (dec < spec.decoys[0] || dec > spec.decoys[1])) return null;
  if (spec.cars && (lv.cars.length < spec.cars[0] || lv.cars.length > spec.cars[1])) return null;
  const s0 = E.initialState(g), grid0 = E.buildGrid(g, s0.pos);
  const free = g.cars.filter((c, i) => word.indexOf(c.l) !== -1 && E.probe(g, grid0, s0.pos, i, E.FWD).kind === 'exit').length;
  if (spec.maxFree !== undefined && free > spec.maxFree) return null;
  const s = E.solve(g, null, { maxStates: spec.states || 400000 });
  if (s.par === null) return null;
  let slides = 0; { let st = s0; for (const m of s.path) { const r = E.step(g, st, m.car, m.which); if (r.result === 'slide') slides++; st = r.state; } }
  if (slides < 1) return null;
  return { g, par: s.par, free };
}
function full(lv, q) {
  const rt = D.rate(lv, { maxStates: spec.maxStates || 1200000 });
  if (!rt || !rt.complete) return null;
  const okS = !spec.score || (rt.score >= spec.score[0] && rt.score < spec.score[1]);
  const ok = okS && rt.track >= (spec.minTrack || 0) && rt.first >= (spec.minFirst || 0) && rt.v.optimal >= (spec.minOptimal || 0);
  return { rt, ok };
}
let q0 = quick(base);
for (let t = 0; !q0 && spec.word && spec.word !== orig.word && t < 300; t++) { relabel(); q0 = quick(base); }
let cur = base;
if (!q0) { console.log('seed is not usable (par null, free letters, or decoys)'); process.exit(1); }
let curPar = q0.par;
const out = [], seen = new Set(), t0 = Date.now(), lo = spec.par[0], hi = spec.par[1], walk = spec.walk || [lo - 2, hi];
console.log('seed par ' + curPar);
let steps = 0;
while (steps++ < (spec.steps || 1e9) && Date.now() - t0 < (spec.ms || 300000)) {
  const m = mutate(cur); if (!m) continue;
  const key = JSON.stringify(m.cars); if (seen.has(key)) continue; seen.add(key);
  const q = quick(m); if (!q || q.par < walk[0] || q.par > walk[1]) continue;
  // walk toward the target: accept if par is no further from [lo,hi] than now (or randomly)
  const dist = p => p < lo ? lo - p : p > hi ? p - hi : 0;
  if (dist(q.par) > dist(curPar) && rnd() > 0.15) continue;
  if (q.par >= lo && q.par <= hi) {
    const f = full(m, q);
    if (!f) continue;
    if (spec.minTrack && f.rt.track < spec.minTrack - 0.08 && rnd() > 0.2) continue;   // don't wander into exacting lots
    cur = m; curPar = q.par;
    if (f.ok && steps >= (spec.burn || 0)) {
      if (spec.canLose !== undefined && rsolve(q.g, {}, true).loseReachable !== spec.canLose) continue;
      const a = { par: q.par, score: +f.rt.score.toFixed(2), tier: f.rt.label, first: f.rt.stored.first, track: +f.rt.track.toFixed(3), optimal: f.rt.v.optimal, seqWithin: f.rt.v.seqWithin, states: f.rt.v.states, cars: m.cars.length, trucks: m.cars.filter(c => c.len > 1).length, decoys: m.cars.length - word.length, free: q.free };
      out.push({ a, lv: m }); fs.writeFileSync(process.argv[3], JSON.stringify(out, null, 1));
      console.log('#' + out.length + ' step ' + steps + ' ' + JSON.stringify(a));
      if (out.length >= (spec.keep || 8)) break;
    }
  } else { cur = m; curPar = q.par; }
}
console.log('done: ' + steps + ' steps, kept ' + out.length + ' in ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
