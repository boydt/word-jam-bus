#!/usr/bin/env node
/*
 * Starter-level helper (dev only): random small lots filtered by what a
 * beginner level should teach. Writes candidates to out.json as it finds them.
 *
 *   node tools/starter-lab.js gen spec.json out.json
 *
 * spec: { word, grid:[r,c], bay, cars:[min,max], empty:[min,max]?, par:[lo,hi],
 *         tries, ms, seed, truck (share of 2-cell cars), truck3, prefer:"dense"?,
 *         req: { noSlideFails, noSlideNull, noRev, needRev, fwdNull, needBay, noBay,
 *                canLose: true|false, maxFreeWord, minRev, minTrucks, maxBayUses, maxDecoys } }
 * Everything it finds still has to pass tools/verify-levels.js.
 */
'use strict';
const E = require('../js/engine.js');
const fs = require('fs');

/** BFS with move filters. opts: {fwdOnly, noSlide, noBay}. Returns {par, path, loseReachable, reachable}. */
function rsolve(g, opts, full) {
  opts = opts || {};
  const s0 = E.initialState(g), seen = new Map([[E.stateKey(s0), null]]);
  let frontier = [s0], depth = 0, par = null, loseReachable = false, reachable = 1, winKey = null;
  const parent = new Map();
  while (frontier.length) {
    const next = [];
    for (const s of frontier) {
      const grid = E.buildGrid(g, s.pos);
      for (let i = 0; i < g.n; i++) for (let w = 0; w < 2; w++) {
        if (opts.fwdOnly && w === 1) continue;
        const r = E.step(g, s, i, w, null, grid);
        if (r.result === 'gone' || r.result === 'bump') continue;
        if (opts.noSlide && r.result === 'slide') continue;
        if (opts.noBay && r.result === 'bay') continue;
        if (r.result === 'lose') { loseReachable = true; continue; }
        const k = E.stateKey(r.state);
        if (seen.has(k)) continue;
        seen.set(k, true); reachable++;
        parent.set(k, { from: E.stateKey(s), car: i, which: w });
        if (r.won) { if (par === null) { par = depth + 1; winKey = k; } continue; }
        next.push(r.state);
      }
    }
    if (par !== null && !full) break;
    frontier = next; depth++;
    if (reachable > 150000) break;
  }
  let path = null;
  if (winKey) { path = []; let k = winKey; while (parent.has(k)) { const p = parent.get(k); path.unshift({ car: p.car, which: p.which }); k = p.from; } }
  return { par, path, loseReachable, reachable };
}

function analyze(lv) {
  const g = E.prepare(lv);
  const all = rsolve(g, {}, true);
  const best = E.solve(g, null, { maxStates: 300000 });
  const fwd = rsolve(g, { fwdOnly: true });
  const noSlide = rsolve(g, { noSlide: true });
  const noBay = rsolve(g, { noBay: true });
  let used = 0; g.cars.forEach(c => used += c.len);
  let slides = 0, rev = 0, bay = 0, st = E.initialState(g);
  for (const m of best.path || []) { const r = E.step(g, st, m.car, m.which); if (r.result === 'slide') { slides++; if (m.which) rev++; } if (r.result === 'bay') bay++; st = r.state; }
  const s0 = E.initialState(g), grid0 = E.buildGrid(g, s0.pos);
  const freeWord = g.cars.filter((c, i) => g.target.indexOf(c.l) !== -1 && E.probe(g, grid0, s0.pos, i, 0).kind === 'exit').length;
  return { par: best.par, states: best.states, fwd: fwd.par, noSlide: noSlide.par, noBay: noBay.par, canLose: all.loseReachable,
    reachable: all.reachable, cars: g.n, empty: g.rows * g.cols - used, slides, rev, bayUses: bay, freeWord, trucks: g.cars.filter(c => c.len > 1).length };
}

module.exports = { rsolve, analyze };

if (require.main === module && process.argv[2] === 'gen') {
  // node tut.js gen spec.json out.json
  const spec = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
  let seed = spec.seed || 1;
  const rng = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const word = (spec.words || [spec.word]).join('');
  const POOL = 'BDFGHKMNRWYZVJX'.split('').filter(c => word.indexOf(c) === -1);
  const [R, C] = spec.grid, DIRN = ['up', 'down', 'left', 'right'];
  const out = []; const t0 = Date.now();
  for (let tr = 0; tr < spec.tries && Date.now() - t0 < (spec.ms || 60000); tr++) {
    const ncars = spec.cars[0] + Math.floor(rng() * (spec.cars[1] - spec.cars[0] + 1));
    const occ = new Set(), cars = [];
    let guard = 0;
    while (cars.length < ncars && guard++ < 500) {
      const dir = DIRN[Math.floor(rng() * 4)], len = rng() < (spec.truck || 0) ? (rng() < (spec.truck3 || 0) ? 3 : 2) : 1;
      const r = 1 + Math.floor(rng() * R), c = 1 + Math.floor(rng() * C);
      const d = E.DIRS[dir], cells = [];
      for (let k = 0; k < len; k++) cells.push([r - d[0] * k, c - d[1] * k]);
      if (cells.some(([a, b]) => a < 1 || a > R || b < 1 || b > C || occ.has(a + ',' + b))) continue;
      cells.forEach(([a, b]) => occ.add(a + ',' + b));
      const car = { l: '', r, c, dir }; if (len > 1) car.len = len; cars.push(car);
    }
    if (cars.length < ncars) continue;
    const empty = R * C - occ.size;
    if (spec.empty && (empty < spec.empty[0] || empty > spec.empty[1])) continue;
    // letters: word letters + extras (spare copies) on random cars, rest decoys
    const units = word.split('').concat(spec.spare || []);
    if (units.length > cars.length) continue;
    const order = cars.map((_, i) => i).sort(() => rng() - 0.5);
    order.forEach((ci, k) => { cars[ci].l = k < units.length ? units[k] : POOL[Math.floor(rng() * POOL.length)]; });
    const lv = { word: spec.word, words: spec.words, grid: spec.grid, bay: spec.bay, cars };
    if (!spec.words) delete lv.words; else delete lv.word;
    // cheap pre-filter on the optimal line before the full analysis
    let g0; try { g0 = E.prepare(lv); } catch (e) { continue; }
    const q0 = spec.req || {};
    const b0 = E.solve(g0, null, { maxStates: spec.states || 200000 });
    if (b0.par === null || b0.par < spec.par[0] || b0.par > spec.par[1]) continue;
    { let st = E.initialState(g0), bu = 0, rv = 0; for (const m of b0.path) { const r = E.step(g0, st, m.car, m.which); if (r.result === 'bay') bu++; if (r.result === 'slide' && m.which) rv++; st = r.state; }
      if (q0.maxBayUses !== undefined && bu > q0.maxBayUses) continue; if (q0.minRev && rv < q0.minRev) continue; }
    let a; try { a = analyze(lv); } catch (e) { continue; }
    if (a.par === null || a.par < spec.par[0] || a.par > spec.par[1]) continue;
    const q = spec.req || {};
    if (q.noSlideFails && !(a.noSlide === null || a.noSlide > a.par)) continue;
    if (q.noRev && a.fwd !== a.par) continue;
    if (q.needRev && !(a.fwd === null || a.fwd > a.par)) continue;
    if (q.needBay && !(a.noBay === null || a.noBay > a.par)) continue;
    if (q.noBay && a.noBay !== a.par) continue;
    if (q.canLose === false && a.canLose) continue;
    if (q.canLose === true && !a.canLose) continue;
    if (q.maxFreeWord !== undefined && a.freeWord > q.maxFreeWord) continue;
    if (q.minRev && a.rev < q.minRev) continue;
    if (q.minTrucks && a.trucks < q.minTrucks) continue;
    if (q.maxBayUses !== undefined && a.bayUses > q.maxBayUses) continue;
    if (q.fwdNull && a.fwd !== null) continue;
    if (q.noSlideNull && a.noSlide !== null) continue;
    if (q.maxDecoys !== undefined && lv.cars.filter(c => word.indexOf(c.l) === -1).length > q.maxDecoys) continue;
    out.push({ a, lv });
    fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 1)); // save as we go
    if (out.length >= (spec.keep || 30)) break;
  }
  out.sort((x, y) => (spec.prefer === 'dense' ? y.a.cars - x.a.cars : x.a.cars - y.a.cars) || y.a.par - x.a.par);
  fs.writeFileSync(process.argv[4], JSON.stringify(out, null, 1));
  console.log(process.argv[4] + ': ' + out.length + ' candidates');
  out.slice(0, 5).forEach(o => { console.log(JSON.stringify(o.a)); console.log(E.ascii(E.prepare(o.lv))); });
}
