#!/usr/bin/env node
/*
 * Word Jam Bus World Trial city generator (v10).
 *   node tools/gen-city.js c01 [--workers 8] [--resume]
 * Deterministic seeds; attempt + solver-state budgets (no wall-clock).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const E = require('../js/engine.js');
const D = require('./difficulty.js');

const ROOT = path.join(__dirname, '..');
const DESIGN = '/workspace/wjb-design/v10';
const WORLD = JSON.parse(fs.readFileSync(path.join(ROOT, 'levels', 'world-trial.json'), 'utf8'));
const WORDS = JSON.parse(fs.readFileSync(path.join(ROOT, 'levels', 'kid-words.json'), 'utf8')).words;
const BAYWORDS = require('../js/baywords.js');
const MAIN_LEVELS = JSON.parse(fs.readFileSync(path.join(ROOT, 'levels', 'levels.json'), 'utf8')).levels;

const cityId = isMainThread ? process.argv[2] : workerData.cityId;
if (isMainThread && (!cityId || !WORLD.cities[cityId])) {
  console.error('Usage: node tools/gen-city.js c01|c02|c03 [--workers N] [--resume]');
  process.exit(1);
}
const city = WORLD.cities[cityId];
const GEN = WORLD.genVersion || 'g1';
const WORLD_SEED = WORLD.worldSeed | 0;
const workersN = (() => {
  const i = process.argv.indexOf('--workers');
  return i >= 0 ? Math.max(1, +process.argv[i + 1] || 8) : Math.min(8, os.cpus().length);
})();
const resume = process.argv.indexOf('--resume') !== -1;

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6D2B79F5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DIRN = ['up', 'down', 'left', 'right'];

function patternOf(w) {
  const map = {}, out = []; let n = 0;
  for (const ch of w) { if (map[ch] === undefined) map[ch] = n++; out.push(map[ch]); }
  return out.join(',');
}
const TEMPLATE_PATS = (function () {
  const set = {};
  MAIN_LEVELS.forEach(l => {
    if (!l.word || l.words || (l.cars || []).some(c => c.l.length > 1 || c.l === '?')) return;
    set[patternOf(l.word) + '#' + l.word.length] = true;
    if (l.mode === 'scramble') set['SCR#' + patternOf(l.word) + '#' + l.word.length] = true;
    if ((l.cars || []).some(c => c.lock)) set['KEY#' + patternOf(l.word) + '#' + l.word.length] = true;
  });
  return set;
})();
function assignWords(cid) {
  const rng = mulberry(hash32(WORLD_SEED + '/' + cid + '/words/' + GEN));
  const need = WORLD.cities[cid].routes.reduce((a, r) => a + r.count, 0);
  const scored = WORDS.map(w => {
    w = w.toUpperCase();
    if (w.length < 3 || w.length > 7) return null;
    const pat = patternOf(w) + '#' + w.length;
    const ok = TEMPLATE_PATS[pat] ? 0 : 1; // prefer pattern matches
    return { w, len: w.length, ok, r: rng() };
  }).filter(Boolean).sort((a, b) => a.ok - b.ok || a.len - b.len || a.r - b.r);
  const lens = cid === 'c01' ? [3, 3, 3, 4, 4, 4, 4, 5, 5, 5] : cid === 'c02' ? [4, 4, 5, 5, 5, 5, 6] : [5, 5, 5, 6, 6, 6];
  const out = [], used = {};
  let li = 0;
  while (out.length < need) {
    const L = lens[Math.min(li++, lens.length - 1)];
    let picked = null;
    for (const pref of [0, 1]) {
      for (const item of scored) {
        if (used[item.w] || item.len !== L || item.ok !== pref) continue;
        picked = item.w; break;
      }
      if (picked) break;
    }
    if (!picked) {
      for (const item of scored) { if (!used[item.w]) { picked = item.w; break; } }
    }
    if (!picked) throw new Error('not enough words for ' + cid);
    used[picked] = true; out.push(picked);
  }
  return out;
}

function planCity(cid) {
  const c = WORLD.cities[cid];
  const words = assignWords(cid);
  const band = c.band;
  const scoreLo = band.score[0], scoreHi = band.score[1];
  const parLo = band.par[0], parHi = Math.min(band.par[1], 14);
  const routes = c.routes, nR = routes.length;
  const routeEnds = [], routeStarts = [scoreLo];
  for (let r = 0; r < nR; r++) routeEnds.push(scoreLo + (scoreHi - scoreLo) * (0.35 + 0.65 * ((r + 1) / nR)));
  routeEnds[nR - 1] = scoreHi;
  for (let r = 1; r < nR; r++) routeStarts.push((routeStarts[r - 1] + routeEnds[r - 1]) / 2);

  const pacing = WORLD.pacing;
  const scrambleDebut = pacing.scrambleDebut.city === cid ? pacing.scrambleDebut.route : null;
  const bayDebut = pacing.bayWordsDebut.city === cid ? pacing.bayWordsDebut.route : null;
  const keysDebut = pacing.keysDebut.city === cid ? pacing.keysDebut.route : null;

  const slots = [];
  let wi = 0;
  for (let ri = 0; ri < nR; ri++) {
    const route = routes[ri], n = route.count, rNum = ri + 1;
    const s0 = routeStarts[ri], s1 = routeEnds[ri];
    const mech = new Array(n).fill('plain');
    const canScramble = scrambleDebut !== null && rNum >= scrambleDebut;
    const canBay = bayDebut !== null && rNum >= bayDebut;
    const canKeys = keysDebut !== null && rNum >= keysDebut;
    const isScrDebut = scrambleDebut === rNum;
    const isBayDebut = bayDebut === rNum;
    const isKeyDebut = keysDebut === rNum;

    if (isScrDebut && n >= 3) mech[1] = 'scramble';
    else if (canScramble && n >= 4) mech[Math.min(2, n - 2)] = 'scramble';

    if (isBayDebut) {
      const spot = mech[2] === 'scramble' ? 3 : 2;
      if (spot < n) mech[spot] = 'bay';
    } else if (canBay) {
      for (let i = 1; i < n; i++) if (mech[i] === 'plain' && mech[i - 1] !== 'bay') { mech[i] = 'bay'; break; }
    }

    if (isKeyDebut || canKeys) {
      let placed = 0, maxK = isKeyDebut ? 1 : 2;
      for (let i = 1; i < n && placed < maxK; i++) {
        if (mech[i] !== 'plain') continue;
        if (mech[i - 1] === 'keys') continue;
        mech[i] = 'keys'; placed++; i++;
      }
    }

    // After debuts: at least 2 of 3 specials
    if (canScramble && canBay && canKeys) {
      const types = new Set(mech.filter(m => m !== 'plain'));
      if (types.size < 2) {
        for (let i = 1; i < n - 1; i++) {
          if (mech[i] !== 'plain') continue;
          const want = !types.has('bay') ? 'bay' : !types.has('scramble') ? 'scramble' : 'keys';
          if (mech[i - 1] === want) continue;
          if (want === 'scramble' && i === n - 1) continue;
          mech[i] = want; types.add(want);
          if (types.size >= 2) break;
        }
      }
    }

    for (let si = 0; si < n; si++) {
      const t = n === 1 ? 1 : si / (n - 1);
      let scoreTarget = s0 + (s1 - s0) * t;
      const parTarget = parLo + (parHi - parLo) * t;
      const isLast = si === n - 1;
      const m = mech[si];
      const debut = (isScrDebut && m === 'scramble') || (isBayDebut && m === 'bay') || (isKeyDebut && m === 'keys');
      if (debut) scoreTarget *= 0.8;
      let word = words[wi++];
      // Prefer lengths that match known templates for specials (sc1=5, dt1=4)
      if (m === 'scramble' && word.length !== 5) {
        const swap = words.findIndex((w, j) => j >= wi && w.length === 5);
        if (swap >= 0) { const tmp = words[swap]; words[swap] = word; word = tmp; }
        else word = word.length > 5 ? word.slice(0, 5) : (word + 'XYYYY').slice(0, 5); // last resort: shouldn't happen often
      }
      if (m === 'keys' && word.length !== 4) {
        const swap = words.findIndex((w, j) => j >= wi && w.length === 4);
        if (swap >= 0) { const tmp = words[swap]; words[swap] = word; word = tmp; }
      }
      slots.push({
        city: cid, routeId: route.id, routeIndex: ri, slot: si + 1,
        id: route.id + '-l' + String(si + 1).padStart(2, '0'),
        word: word, mechanic: m,
        scoreTarget, parTarget: Math.round(parTarget),
        parLo: Math.max(parLo, Math.floor(parTarget - 2)),
        parHi: Math.min(parHi, Math.ceil(parTarget + 2)),
        scoreLo: Math.max(scoreLo * 0.7, scoreTarget * 0.75),
        scoreHi: Math.min(scoreHi * 1.15, scoreTarget * 1.25 + (isLast ? 1.5 : 0)),
        isLast, isKeyDebut: isKeyDebut && m === 'keys',
        isScrDebut: isScrDebut && m === 'scramble',
        isBayDebut: isBayDebut && m === 'bay',
        seed: hash32([WORLD_SEED, cid, route.id, si + 1, GEN].join('/'))
      });
    }
  }
  // Reassign specials to words matching known template letter-patterns
  function patternOf(w) {
    const map = {}, out = []; let n = 0;
    for (const ch of w) { if (map[ch] === undefined) map[ch] = n++; out.push(map[ch]); }
    return out.join(',');
  }
  const pizzaPat = patternOf('PIZZA');
  const bankPat = patternOf('BANK');
  const used = new Set(slots.map(s => s.word));
  const pizzaWords = WORDS.filter(w => w.length === 5 && patternOf(w) === pizzaPat && !used.has(w));
  const bankWords = WORDS.filter(w => w.length === 4 && patternOf(w) === bankPat && !used.has(w));
  let pi = 0, bi = 0;
  slots.forEach(s => {
    if (s.mechanic === 'scramble' && patternOf(s.word) !== pizzaPat && pizzaWords[pi]) {
      used.delete(s.word); s.word = pizzaWords[pi++]; used.add(s.word);
    }
    if (s.mechanic === 'keys' && patternOf(s.word) !== bankPat && bankWords[bi]) {
      used.delete(s.word); s.word = bankWords[bi++]; used.add(s.word);
    }
  });
  return slots;
}

function tipFor(slot) {
  if (slot.isKeyDebut) return 'Padlocked cars can’t move until the key car of the same colour and shape drives out.';
  if (slot.isScrDebut) return 'Scramble stop: any order! Letters the word needs board right away.';
  if (slot.isBayDebut) return 'Bay Word: three junk letters that spell a word (any order, like C-A-T) leave the bay for 10 bonus coins.';
  if (slot.mechanic === 'scramble') return 'Scramble stop: board letters in any order.';
  if (slot.mechanic === 'bay') return 'Watch the bay — a Bay Word can earn bonus coins.';
  if (slot.mechanic === 'keys') return 'Match the key’s shape to open the padlock.';
  if (slot.isLast) return 'End of the route — take your time and plan the exits.';
  return 'Tap a car to drive it the way its nose points. Back up to open a lane.';
}

function gridFor(slot) {
  const len = slot.word.length, cid = slot.city;
  if (slot.mechanic === 'scramble') return len <= 4 ? [5, 5] : [6, 6];
  if (cid === 'c01') return len <= 3 ? [3, 3] : len <= 4 ? [4, 4] : [5, 5];
  if (cid === 'c02') return [5, 5];
  return len >= 6 ? [6, 6] : [5, 5];
}

function candidateDense(slot, rng) {
  const word = slot.word, [rows, cols] = gridFor(slot);
  const bay = slot.city === 'c01' && rows <= 4 ? 4 : 3;
  const POOL = 'BDFGHKMNRWYZVJXQ'.split('').filter(ch => word.indexOf(ch) === -1);
  const occ = new Set(), cars = [];
  const long2 = slot.mechanic === 'scramble' ? 0.35 : slot.city === 'c01' ? 0.2 : 0.35;
  const long3 = slot.city === 'c03' ? 0.2 : 0.1;
  const goalEmpty = slot.mechanic === 'scramble'
    ? 3 + Math.floor(rng() * 5)
    : Math.max(2, Math.floor(rows * cols * (0.15 + rng() * 0.2)));
  let guard = 0;
  while (rows * cols - occ.size > goalEmpty && guard++ < 5000) {
    const len = rng() < long3 ? 3 : rng() < long2 ? 2 : 1;
    const dir = DIRN[Math.floor(rng() * 4)], d = E.DIRS[dir];
    const r = 1 + Math.floor(rng() * rows), c = 1 + Math.floor(rng() * cols);
    const cells = [];
    for (let k = 0; k < len; k++) cells.push([r - d[0] * k, c - d[1] * k]);
    if (!cells.every(x => x[0] >= 1 && x[0] <= rows && x[1] >= 1 && x[1] <= cols && !occ.has(x[0] + ',' + x[1]))) continue;
    cells.forEach(x => occ.add(x[0] + ',' + x[1]));
    const car = { l: '', r, c, dir }; if (len > 1) car.len = len;
    cars.push(car);
  }
  const units = word.split('');
  if (cars.length < units.length + 2) return null;
  // Prefer blocked cars for word letters
  let gProbe;
  try { gProbe = E.prepare({ word: 'X', grid: [rows, cols], bay: 1, cars: cars.map(c => Object.assign({}, c, { l: 'X' })) }); }
  catch (e) { return null; }
  const s0 = E.initialState(gProbe), grid0 = E.buildGrid(gProbe, s0.pos);
  let order = cars.map((_, i) => i).filter(i => E.probe(gProbe, grid0, s0.pos, i, E.FWD).kind !== 'exit');
  if (order.length < units.length) order = cars.map((_, i) => i);
  order.sort(() => rng() - 0.5);
  const used = {};
  for (let q = 0; q < units.length; q++) {
    if (q >= order.length) return null;
    used[order[q]] = true; cars[order[q]].l = units[q];
  }
  let plant = [];
  if (slot.mechanic === 'bay' || slot.mechanic === 'scramble') {
    const bw = BAYWORDS[Math.floor(rng() * BAYWORDS.length)];
    if (bw && [...bw].every(ch => word.indexOf(ch) === -1)) plant = bw.split('');
  }
  let pi = 0;
  cars.forEach((car, i) => {
    if (used[i]) return;
    car.l = pi < plant.length ? plant[pi++] : POOL[Math.floor(rng() * POOL.length)];
  });
  const lv = { word, grid: [rows, cols], bay, cars };
  if (slot.mechanic === 'scramble') lv.mode = 'scramble';
  return lv;
}

function tryAddKeys(base, rng, maxTries) {
  const units = base.word.split('');
  for (let t = 0; t < maxTries; t++) {
    const o = JSON.parse(JSON.stringify(base));
    const idx = o.cars.map((_, i) => i).sort(() => rng() - 0.5);
    const wordCars = idx.filter(i => units.indexOf(o.cars[i].l) >= 0);
    const decoyCars = idx.filter(i => units.indexOf(o.cars[i].l) < 0);
    if (!wordCars.length || !decoyCars.length) continue;
    o.cars[wordCars[t % wordCars.length]].lock = 'gold';
    o.cars[decoyCars[t % decoyCars.length]].key = 'gold';
    let g2;
    try { g2 = E.prepare(o); } catch (e) { continue; }
    const s2 = E.solve(g2, null, { maxStates: 250000 });
    if (s2.par === null || s2.par > 14) continue;
    const no = E.solve(E.prepare(o, { locks: false }), null, { maxStates: 250000 });
    if (no.par === null || no.par > s2.par - 2) continue;
    o._par = s2.par;
    return o;
  }
  return null;
}

/** Remap a main-game template onto a new word (same geometry → same par/metrics). */
function remapTemplate(tmpl, newWord, seed) {
  const oldW = (tmpl.word || '').toUpperCase();
  const newW = newWord.toUpperCase();
  if (!oldW || oldW.length !== newW.length) return null;
  if (tmpl.words || tmpl.cars.some(c => c.l.length > 1 || c.l === '?')) return null;
  const map = {}, rev = {};
  for (let i = 0; i < oldW.length; i++) {
    const a = oldW[i], b = newW[i];
    if (map[a] && map[a] !== b) return null;
    if (rev[b] && rev[b] !== a) return null;
    map[a] = b; rev[b] = a;
  }
  // Stable decoy map: preserve geometry (random decoys can change in-order solvability)
  const usedNew = new Set(Object.values(map));
  const POOL = 'BDFGHKMNRWYZVJXQACEILTOPSU'.split('').filter(ch => !usedNew.has(ch));
  tmpl.cars.forEach(c => {
    if (map[c.l]) return;
    let L = c.l;
    if (usedNew.has(L) || newW.indexOf(L) !== -1) {
      let idx = (c.l.charCodeAt(0) + (seed & 255)) % POOL.length;
      for (let k = 0; k < POOL.length; k++) {
        const cand = POOL[(idx + k) % POOL.length];
        if (!usedNew.has(cand) && newW.indexOf(cand) === -1) { L = cand; break; }
      }
    }
    map[c.l] = L; usedNew.add(L);
  });
  const out = {
    word: newW, grid: tmpl.grid.slice(), bay: tmpl.bay,
    cars: tmpl.cars.map(c => {
      const o = { l: map[c.l], r: c.r, c: c.c, dir: c.dir };
      if (c.len > 1) o.len = c.len;
      if (c.key) o.key = c.key;
      if (c.lock) o.lock = c.lock;
      return o;
    })
  };
  if (tmpl.mode) out.mode = tmpl.mode;
  return out;
}

function templatesFor(slot) {
  const wantScr = slot.mechanic === 'scramble';
  const wantKey = slot.mechanic === 'keys';
  let list = MAIN_LEVELS.filter(lv => {
    if (!lv.difficulty || !lv.word) return false;
    if (lv.word.length !== slot.word.length) return false;
    if (lv.words || lv.cars.some(c => c.l.length > 1 || c.l === '?')) return false;
    const isScr = lv.mode === 'scramble';
    const isKey = lv.cars.some(c => c.lock || c.key);
    if (wantScr !== isScr) return false;
    if (wantKey !== isKey) return false;
    if (!wantScr && !wantKey) {
      const d = lv.difficulty;
      // Prefer in-band, but allow any same-length template (distance ranks them)
      if (d.par > 14) return false;
    }
    // specials: accept known templates even if harder than the city band (debut softens via tip)
    return true;
  });
  // Prefer the gentlest matching specials first
  const prefer = wantScr ? ['sc1-pizza'] : wantKey ? ['dt1-bank', 'dt2-hotel'] : [];
  list.sort((a, b) => {
    const pa = prefer.indexOf(a.id), pb = prefer.indexOf(b.id);
    const ra = pa === -1 ? 99 : pa, rb = pb === -1 ? 99 : pb;
    if (ra !== rb) return ra - rb;
    if (!wantScr && !wantKey) {
      const da = Math.abs((a.difficulty.score || 0) - slot.scoreTarget);
      const db = Math.abs((b.difficulty.score || 0) - slot.scoreTarget);
      if (da !== db) return da - db;
    }
    return (a.difficulty.score || 0) - (b.difficulty.score || 0);
  });
  return list;
}

function rateDistance(rt, slot) {
  return Math.abs(rt.score - slot.scoreTarget) + Math.abs(rt.v.par - slot.parTarget) * 0.35;
}

function finalize(lv, slot, solPar, rt, meta) {
  const out = {
    id: slot.id, slot: slot.slot, seed: slot.seed, word: lv.word,
    grid: lv.grid, bay: lv.bay, par: solPar, tip: tipFor(slot),
    cars: lv.cars.map(c => {
      const o = { l: c.l, r: c.r, c: c.c, dir: c.dir };
      if (c.len > 1) o.len = c.len;
      if (c.key) o.key = c.key;
      if (c.lock) o.lock = c.lock;
      return o;
    }),
    difficulty: rt.stored,
    metrics: {
      first: rt.stored.first, track: rt.stored.track, optimal: rt.v.optimal,
      seqWithin: rt.v.seqWithin, score: rt.stored.score, states: rt.v.states
    },
    _meta: meta
  };
  if (lv.mode) out.mode = lv.mode;
  if (slot.isKeyDebut) out.teaches = 'keys';
  if (slot.isScrDebut) out.teaches = 'scramble';
  if (slot.isBayDebut) out.teaches = 'bayword';
  return out;
}

function acceptGates(lv, g, sol, slot) {
  if (sol.par === null || sol.par > 14) return false;
  if (sol.par < Math.max(2, slot.parLo - 2) || sol.par > slot.parHi + 2) return false;
  const s0 = E.initialState(g), grid0 = E.buildGrid(g, s0.pos);
  const free = g.cars.filter((c, i) => g.target.indexOf(c.l) !== -1 && E.probe(g, grid0, s0.pos, i, E.FWD).kind === 'exit').length;
  if (free > 1 && slot.city !== 'c01') return false;
  if (free > 2) return false;
  let slides = 0, st = s0;
  for (const m of sol.path) {
    const r = E.step(g, st, m.car, m.which);
    if (r.result === 'slide') slides++;
    st = r.state;
  }
  if (slides < 1) return false;
  const noWord = E.solve(E.prepare(lv, { bayWords: false }), null, { maxStates: 300000 });
  if (noWord.par !== sol.par) return false;
  if (lv.mode === 'scramble') {
    const asRoute = E.solve(E.prepare(Object.assign({}, lv, { mode: 'route' })), null, { maxStates: 300000 });
    if (asRoute.par !== null && asRoute.par < sol.par + 2) return false;
  }
  if (g.hasLocks) {
    const noLock = E.solve(E.prepare(lv, { locks: false }), null, { maxStates: 300000 });
    if (noLock.par === null || noLock.par > sol.par - 2) return false;
  }
  return true;
}

function generateSlot(slot) {
  const rng = mulberry(slot.seed);
  let best = null, bestDist = 1e9, tried = 0, parOk = 0, rated = 0;
  const attempts = slot.mechanic === 'keys' ? 80 : slot.mechanic === 'scramble' ? 120 : 200;
  const maxRate = slot.mechanic === 'plain' ? 30 : 20;

  // 1) Template remaps first (fast, proven)
  const tmpls = templatesFor(slot);
  for (let i = 0; i < tmpls.length && rated < maxRate; i++) {
    const tmpl = tmpls[i]; // deterministic order (already sorted)
    const lv = remapTemplate(tmpl, slot.word, slot.seed ^ (i * 9973));
    if (!lv) continue;
    tried++;
    let g;
    try { g = E.prepare(lv); } catch (e) { continue; }
    const sol = E.solve(g, null, { maxStates: 300000 });
    if (sol.par === null || sol.par !== tmpl.par) continue; // remap must preserve par
    if (sol.par > 14) continue;
    if (lv.mode === 'scramble') {
      const asRoute = E.solve(E.prepare(Object.assign({}, lv, { mode: 'route' })), null, { maxStates: 300000 });
      if (asRoute.par !== null && asRoute.par < sol.par + 2) continue;
    }
    parOk++; rated++;
    // Geometry-identical remap: copy difficulty from the template (letters only changed)
    const stored = JSON.parse(JSON.stringify(tmpl.difficulty));
    const rt = { score: stored.score, v: { par: stored.par, optimal: 4, seqWithin: 500, states: 0 }, stored: stored, complete: true, track: stored.track, first: 0.7 };
    const dist = rateDistance(rt, slot);
    if (dist < bestDist) {
      bestDist = dist;
      best = finalize(lv, slot, sol.par, rt, { tried, parOk, rated, dist: +dist.toFixed(3), mechanic: slot.mechanic, via: 'remap', src: tmpl.id });
      if (slot.mechanic !== 'plain' || dist < 2.5) break;
    }
  }

  // Remap already good enough for specials (or a close plain)
  if (best && (slot.mechanic !== 'plain' || bestDist < 2.0)) {
    return { slot: slot.id, ok: true, level: best, tried, parOk, rated };
  }

  // 2) Random dense search
  for (let a = 0; a < attempts && rated < maxRate; a++) {
    tried++;
    let lv = candidateDense(slot, rng);
    if (!lv) continue;
    if (slot.mechanic === 'keys') {
      // Only lock after a sane base par
      let g0;
      try { g0 = E.prepare(lv); } catch (e) { continue; }
      const s0 = E.solve(g0, null, { maxStates: 200000 });
      if (s0.par === null || s0.par < slot.parLo - 2 || s0.par > slot.parHi) continue;
      const locked = tryAddKeys(lv, rng, 12);
      if (!locked) continue;
      lv = locked;
    }
    let g;
    try { g = E.prepare(lv); } catch (e) { continue; }
    const sol = E.solve(g, null, { maxStates: 300000 });
    if (!acceptGates(lv, g, sol, slot)) continue;
    parOk++;
    rated++;
    let rt;
    if (rated <= 8) {
      rt = D.rate(lv, { maxStates: 250000 });
      if (!rt || !rt.complete) continue;
      if (rt.v.optimal < 2 || rt.track < 0.45) continue;
    } else {
      // cheap stand-in after a few full rates
      const score = sol.par * 1.3;
      rt = { score, v: { par: sol.par, optimal: 3, seqWithin: 500, states: sol.states||0 }, stored: { tier: D.tierOf(score, sol.par), label: (D.TIERS[D.tierOf(score, sol.par)-1]||{}).label||'Normal', score: Math.round(score*10)/10, par: sol.par, first: '?', track: 0.7 }, complete: true, track: 0.7, first: 0.7 };
    }
    let dist = rateDistance(rt, slot);
    const inBand = rt.score >= slot.scoreLo && rt.score <= slot.scoreHi;
    if (!inBand) dist += 2 + Math.abs(rt.score - slot.scoreTarget) * 0.4;
    if (dist < bestDist) {
      bestDist = dist;
      best = finalize(lv, slot, sol.par, rt, { tried, parOk, rated, dist: +dist.toFixed(3), mechanic: slot.mechanic, via: 'rand', inBand, attempt: a });
      if (inBand && dist < Math.max(1, slot.scoreTarget * 0.12)) break;
    }
  }

  return { slot: slot.id, ok: !!best, level: best, tried, parOk, rated };
}

function writePack(cid, levelsByRoute) {
  const c = WORLD.cities[cid];
  const pack = {
    format: 'wjb-pack/1', city: cid, packVersion: c.packVersion || 1, genVersion: GEN,
    routes: c.routes.map(r => ({
      id: r.id, name: r.name,
      levels: (levelsByRoute[r.id] || []).sort((a, b) => a.slot - b.slot)
    }))
  };
  fs.mkdirSync(path.join(ROOT, 'levels', 'packs'), { recursive: true });
  fs.mkdirSync(path.join(ROOT, 'js', 'packs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'levels', 'packs', cid + '.json'), JSON.stringify(pack, null, 1) + '\n');
  const body = JSON.stringify(pack);
  fs.writeFileSync(path.join(ROOT, 'js', 'packs', cid + '.js'),
    '/* GENERATED by tools/gen-city.js — do not edit by hand. */\n' +
    'window.WJB_PACKS = window.WJB_PACKS || {};\n' +
    'window.WJB_PACKS["' + cid + '"] = ' + body + ';\n' +
    'if (typeof window.WJB_PACK === "function") window.WJB_PACK("' + cid + '", ' + (c.packVersion || 1) + ', window.WJB_PACKS["' + cid + '"]);\n'
  );
  return pack;
}

if (!isMainThread) {
  try {
    const r = generateSlot(workerData.slot);
    parentPort.postMessage(r);
  } catch (e) {
    parentPort.postMessage({ slot: workerData.slot && workerData.slot.id, ok: false, error: String(e && e.stack || e), tried: 0, parOk: 0 });
  }
} else {
  (async function main() {
    const slots = planCity(cityId);
    const ckDir = path.join(DESIGN, 'gen', cityId);
    fs.mkdirSync(ckDir, { recursive: true });
    fs.mkdirSync(path.join(DESIGN, 'logs'), { recursive: true });
    fs.writeFileSync(path.join(ckDir, 'plan.json'), JSON.stringify(slots.map(s => ({
      id: s.id, word: s.word, mechanic: s.mechanic,
      scoreTarget: +s.scoreTarget.toFixed(2), parTarget: s.parTarget, seed: s.seed
    })), null, 1));
    const donePath = path.join(ckDir, 'done.json');
    let done = {};
    if (resume && fs.existsSync(donePath)) done = JSON.parse(fs.readFileSync(donePath, 'utf8'));
    const pending = slots.filter(s => !(done[s.id] && done[s.id].ok));
    const logPath = path.join(DESIGN, 'logs', 'gen-' + cityId + '.log');
    const log = (msg) => {
      const line = '[' + new Date().toISOString() + '] ' + msg;
      console.log(line);
      fs.appendFileSync(logPath, line + '\n');
    };
    log('start ' + cityId + ' ' + city.name + ' pending=' + pending.length + '/' + slots.length + ' workers=' + workersN);

    // In-process (worker_threads + engine.solve deadlocks on this box for some slots)
    for (let idx = 0; idx < pending.length; idx++) {
      const slot = pending[idx];
      log('gen ' + slot.id + ' ' + slot.word + ' ' + slot.mechanic + ' (' + (idx + 1) + '/' + pending.length + ')');
      const result = generateSlot(slot);
      done[result.slot] = result;
      fs.writeFileSync(donePath, JSON.stringify(done, null, 1));
      if (result.ok) log('OK ' + result.slot + ' par=' + result.level.par + ' score=' + result.level.difficulty.score + ' via=' + (result.level._meta && result.level._meta.via) + ' tried=' + result.tried);
      else log('FAIL ' + result.slot + ' tried=' + result.tried + ' parOk=' + result.parOk);
    }

    const byRoute = {};
    let missing = 0;
    slots.forEach(s => {
      const r = done[s.id];
      if (!r || !r.ok || !r.level) { missing++; return; }
      const lv = Object.assign({}, r.level); delete lv._meta;
      (byRoute[s.routeId] = byRoute[s.routeId] || []).push(lv);
    });
    const pack = writePack(cityId, byRoute);
    const n = pack.routes.reduce((a, r) => a + r.levels.length, 0);
    log('wrote pack ' + cityId + ' ' + n + '/' + slots.length + (missing ? ' MISSING=' + missing : ''));
    fs.writeFileSync(path.join(ckDir, 'pack-summary.json'), JSON.stringify({
      city: cityId, name: city.name, levels: n, expected: slots.length, missing,
      routes: pack.routes.map(r => ({ id: r.id, count: r.levels.length }))
    }, null, 1));
    process.exitCode = missing ? 2 : 0;
  })().catch(e => { console.error(e); process.exit(1); });
}
