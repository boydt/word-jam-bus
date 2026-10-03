#!/usr/bin/env node
/*
 * Headless browser play-test for Word Jam Bus (v2 slide-until-blocked rules,
 * v3 level set: 10 starter levels + the 10 original v2 levels = 20).
 *   python3 -m http.server 8765   (in the game folder, or set WJB_URL)
 *   node tests/e2e.js
 * Uses REAL input only to move cars: touch taps + touch swipes (CDP touch
 * events) at phone size 390x844 with mobile emulation, mouse clicks / drags /
 * right-clicks at desktop 1280x800. The page's engine is only *read* to pick
 * which car to move and to check results.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const URL = process.env.WJB_URL || 'http://127.0.0.1:8765/index.html';
const SHOTS = path.join(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0, passes = 0;
const errors = [];
function check(cond, msg) {
  if (cond) { passes++; console.log('  PASS ' + msg); } else { failures++; console.log('  FAIL ' + msg); }
}
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(label + ' console.' + m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push(label + ' requestfailed: ' + r.url()));
}
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) }).then(() => console.log('  shot screenshots/' + name));
const settle = async page => { await page.evaluate(() => window.WJB.idle()); await page.waitForTimeout(260); };
const S = page => page.evaluate(() => { const s = window.WJB.session; return { pos: s.state.pos.slice(), moves: s.state.moves, idx: s.state.idx, bay: s.state.bay.slice(), undos: s.undos, hints: s.hints, ended: s.ended }; });

/** What would move (car, which) do right now? (reads the engine; no input) */
const probe = (page, car, which) => page.evaluate(([car, which]) => {
  const s = window.WJB.session, E = window.WJBEngine;
  return E.probe(s.game, E.buildGrid(s.game, s.state.pos), s.state.pos, car, which);
}, [car, which]);

/** Find a car whose move `which` has the given probe kind (and optional letter filter). */
const findCar = (page, which, kind, opts) => page.evaluate(([which, kind, opts]) => {
  const s = window.WJB.session, E = window.WJBEngine, g = s.game;
  const grid = E.buildGrid(g, s.state.pos);
  for (let i = 0; i < g.n; i++) {
    if (s.state.pos[i] < 0) continue;
    const p = E.probe(g, grid, s.state.pos, i, which);
    if (p.kind !== kind) continue;
    if (opts && opts.bothBump && E.probe(g, grid, s.state.pos, i, 1 - which).kind !== 'bump') continue;
    return i;
  }
  return -1;
}, [which, kind, opts || null]);

/** Real input: forward = tap/click; reverse = swipe/drag toward the tail (or right-click). */
async function inputMove(page, ctx, car, which, how) {
  const info = await page.evaluate(id => {
    const g = window.WJB.session.game, c = g.cars[id];
    const r = document.querySelector('.car[data-id="' + id + '"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, horiz: c.horiz, sign: c.sign, cell: r.width / (c.horiz ? c.len : 1) };
  }, car);
  if (which === 0 && how !== 'swipe' && how !== 'drag') {
    if (ctx.touch) await page.touchscreen.tap(info.x, info.y); else await page.mouse.click(info.x, info.y);
    return;
  }
  if (how === 'rightclick') { await page.mouse.click(info.x, info.y, { button: 'right' }); return; }
  const s = which === 0 ? info.sign : -info.sign;
  const d = Math.max(28, info.cell * 0.7) * s;
  const tx = info.x + (info.horiz ? d : 0), ty = info.y + (info.horiz ? 0 : d);
  if (ctx.touch) {
    await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: info.x, y: info.y }] });
    for (let k = 1; k <= 4; k++) {
      await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: info.x + (tx - info.x) * k / 4, y: info.y + (ty - info.y) * k / 4 }] });
    }
    if (ctx.holdShot) { await page.waitForTimeout(120); await shot(page, ctx.holdShot); ctx.holdShot = null; }
    await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(info.x, info.y); await page.mouse.down();
    await page.mouse.move(tx, ty, { steps: 5 });
    if (ctx.holdShot) { await page.waitForTimeout(120); await shot(page, ctx.holdShot); ctx.holdShot = null; }
    await page.mouse.up();
  }
}
async function playPath(page, ctx, moves) {
  for (const m of moves) { await inputMove(page, ctx, m.car, m.which, m.which === 1 ? 'swipe' : 'tap'); await settle(page); }
}
async function openLevel(page, n) {
  await page.goto(URL + '#level-' + n);
  await page.waitForSelector('#screen-game.active');
  await page.waitForTimeout(750);
}
/** Shortest move list (from the current state) that reaches a state matching `goal`, via the page's engine. */
const pathTo = (page, goal) => page.evaluate(goal => {
  const s = window.WJB.session, E = window.WJBEngine, g = s.game;
  const start = E.cloneState(s.state), seen = new Set([E.stateKey(start)]);
  const q = [{ st: start, path: [] }];
  while (q.length) {
    const { st, path } = q.shift();
    const grid = E.buildGrid(g, st.pos);
    for (let i = 0; i < g.n; i++) for (let w = 0; w < 2; w++) {
      const r = E.step(g, st, i, w, null, grid);
      if (r.result === 'gone' || r.result === 'bump') continue;
      const p2 = path.concat([{ car: i, which: w }]);
      if (goal === 'lose' && r.result === 'lose') return p2;
      if (r.result === 'lose') continue;
      if (goal === 'dead' && !r.won && E.solve(g, r.state, { maxStates: 200000 }).status === 'none') return p2;
      const k = E.stateKey(r.state);
      if (!seen.has(k) && path.length < 8) { seen.add(k); q.push({ st: r.state, path: p2 }); }
    }
  }
  return null;
}, goal);
/** Is the highlighted hint move the first move of an optimal line from the current state? */
const hintCheck = page => page.evaluate(() => {
    const s = window.WJB.session, E = window.WJBEngine, el = document.querySelector('.car.hint');
    const car = +el.getAttribute('data-id'), which = el.getAttribute('data-hint') === 'fwd' ? 0 : 1;
    const d0 = E.solve(s.game, s.state).par;
    const r = E.step(s.game, s.state, car, which);
    const d1 = r.won ? 0 : E.solve(s.game, r.state).par;
    return { ok: d1 === d0 - 1, d0, d1 };
  });
async function layoutOk(page, label) {
  const r = await page.evaluate(() => {
    const lot = document.getElementById('lot').getBoundingClientRect();
    const cars = [...document.querySelectorAll('.car')].filter(e => e.style.display !== 'none').map(e => e.getBoundingClientRect());
    const inLot = cars.every(c => c.left >= lot.left - 1 && c.right <= lot.right + 1 && c.top >= lot.top - 1 && c.bottom <= lot.bottom + 1);
    const vis = ['bus', 'lot', 'bay', 'btn-hint', 'btn-restart', 'btn-undo', 'btn-menu'].every(id => {
      const b = document.getElementById(id).getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 1 && b.left >= 0 && b.right <= innerWidth + 1;
    });
    return { inLot, vis, minCar: Math.min(...cars.map(c => Math.min(c.width, c.height))), scroll: document.documentElement.scrollHeight <= innerHeight + 1 };
  });
  check(r.inLot && r.vis && r.scroll, label + ': lot, bus, bay and buttons fit without scrolling');
  return r;
}

const tapEl = async (page, ctx, sel) => {
  const b = await page.locator(sel).boundingBox();
  if (ctx.touch) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
};
/** Seed localStorage with a saved-progress object, reload, and read what the title screen shows. */
async function seeded(page, save) {
  await page.goto(URL);
  await page.evaluate(sv => { localStorage.clear(); if (sv) localStorage.setItem('wordJamBus.progress.v1', JSON.stringify(sv)); }, save);
  await page.reload();
  await page.waitForSelector('#screen-title.active');
  return page.evaluate(() => ({
    open: [...document.querySelectorAll('.lvl')].filter(b => !b.disabled).map(b => +b.getAttribute('data-level')),
    current: +(document.querySelector('.lvl.current') || { getAttribute: () => 0 }).getAttribute('data-level'),
    stars: [...document.querySelectorAll('.lvl')].map(b => b.querySelector('small').textContent),
    play: document.getElementById('btn-play').textContent,
    stored: JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))
  }));
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

async function winAll(page, ctx, label) {
  for (let n = 1; n <= 20; n++) {
    await openLevel(page, n);
    const t0 = Date.now();
    const sol = await page.evaluate(() => window.WJB.solution());
    for (const m of sol) {
      await inputMove(page, ctx, m.car, m.which, m.which === 1 ? (ctx.touch ? 'swipe' : 'drag') : (ctx.touch ? 'tap' : 'click'));
      await settle(page);
    }
    await page.waitForSelector('#ov-win.show', { timeout: 6000 }).catch(() => {});
    const won = await page.locator('#ov-win.show').count() === 1;
    const st = await page.getAttribute('#win-stars', 'data-stars');
    const lv = await page.evaluate(() => ({ par: window.WJB.session.level.par, id: window.WJB.session.level.id }));
    check(won && st === '3' && sol.length === lv.par, label + ' level ' + n + ' (' + lv.id + ') won in ' + sol.length + ' moves (= par ' + lv.par + ', ' +
      sol.filter(m => m.which === 1).length + ' reverses), 3 stars [' + (Date.now() - t0) + ' ms]');
  }
}

(async () => {
  const browser = await chromium.launch();
  const LV = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'levels.json'), 'utf8')).levels;

  /* ------------------------------ PHONE ------------------------------ */
  console.log('\n# Phone 390x844 (touch, isMobile)');
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const p = await phone.newPage();
  watch(p, 'phone');
  const T = { touch: true, cdp: await phone.newCDPSession(p) };
  let t = await seeded(p, null);
  check(await p.locator('.lvl').count() === 20, '20 levels listed');
  check(same(t.open, [1]), 'fresh save: only level 1 unlocked');
  const sel = await p.evaluate(() => {
    const r = [...document.querySelectorAll('.lvl')].map(b => b.getBoundingClientRect());
    return { fits: r.every(b => b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth), rows: new Set(r.map(b => Math.round(b.top))).size, min: Math.min(...r.map(b => Math.min(b.width, b.height))) };
  });
  check(sel.fits && sel.min >= 44, 'level select: all 20 buttons visible on the phone screen without scrolling (' + sel.rows + ' rows, buttons >= ' + Math.round(sel.min) + 'px)');
  check(await p.evaluate(() => getComputedStyle(document.getElementById('lot')).touchAction) === 'none', 'lot has touch-action:none (swipes never scroll/zoom)');
  await shot(p, 'v3-05-phone-level-select.png');

  await tapEl(p, T, '#btn-play');
  await p.waitForSelector('#screen-game.active');
  await p.waitForTimeout(750);
  check((await p.textContent('#hud-level')).trim() === 'Level 1 of 20', 'Play opens "Level 1 of 20"');
  check((await p.textContent('#tip')).trim() === LV[0].tip, 'level 1 shows its tip: "' + LV[0].tip + '"');
  await layoutOk(p, 'phone L1');
  await shot(p, 'v3-01-phone-level1-tip.png');

  // tips appear on the right levels
  let tipsOk = true;
  for (let n = 1; n <= 20; n++) {
    await p.goto(URL + '#level-' + n); await p.waitForSelector('#screen-game.active');
    const shown = (await p.textContent('#tip')).trim();
    const hud = (await p.textContent('#hud-level')).trim();
    if (shown !== (LV[n - 1].tip || '') || hud !== 'Level ' + n + ' of 20') { tipsOk = false; console.log('    level ' + n + ': tip "' + shown + '" hud "' + hud + '"'); }
  }
  check(tipsOk, 'every level shows its own tip and "Level N of 20"');
  check(LV.slice(0, 10).every(l => l.tip && l.tier === 'starter') && LV.slice(10).every(l => !l.tier), 'levels 1-10 are starter levels with tips, 11-20 are the original v2 levels');

  // --- level 2: partial slide that stops at a blocker (the level that teaches it) ---
  await openLevel(p, 2);
  // the slide the level is built around: the first move of its optimal line
  const first2 = (await p.evaluate(() => window.WJB.solution()))[0];
  let c = (await probe(p, first2.car, 0)).kind === 'slide' && first2.which === 0 ? first2.car : await findCar(p, 0, 'slide');
  check(c >= 0, 'level 2 has a car that slides forward partway');
  let pr = await probe(p, c, 0), before = await S(p);
  await inputMove(p, T, c, 0, 'tap'); await settle(p);
  let after = await S(p);
  const fsign = await p.evaluate(id => window.WJB.session.game.cars[id].sign, c);
  check(after.pos[c] === before.pos[c] + fsign * pr.dist && after.pos[c] >= 0, 'tap: car slid ' + pr.dist + ' cell(s) and stopped at the blocker (still in the lot)');
  check(after.moves === before.moves + 1, 'a partial slide counts as 1 move');
  await shot(p, 'v3-02-phone-level2-partial-slide.png');
  await tapEl(p, T, '#btn-undo'); await settle(p);
  let u = await S(p);
  check(u.pos[c] === before.pos[c] && u.moves === before.moves && u.undos === after.undos - 1, 'Undo puts the slid car back and refunds the move');
  // bump: a blocked car shakes, no move used
  c = await findCar(p, 0, 'bump');
  before = await S(p);
  await inputMove(p, T, c, 0, 'tap'); await p.waitForTimeout(120);
  check(await p.locator('.car[data-id="' + c + '"]').evaluate(e => /bump-/.test(e.className)) && (await S(p)).moves === before.moves, 'blocked tap: car shakes, no move used');
  await settle(p);

  // --- level 3: first reverse (swipe toward the tail), ghost preview captured mid-swipe ---
  await openLevel(p, 3);
  const sol3 = await p.evaluate(() => window.WJB.solution());
  const ri = sol3.findIndex(m => m.which === 1);
  check(ri >= 0, 'level 3 optimal line includes a reverse move');
  await playPath(p, T, sol3.slice(0, ri));
  before = await S(p);
  pr = await probe(p, sol3[ri].car, 1);
  T.holdShot = 'v3-03-phone-level3-first-reverse.png';
  await inputMove(p, T, sol3[ri].car, 1, 'swipe'); await settle(p);
  after = await S(p);
  const rsign = await p.evaluate(id => -window.WJB.session.game.cars[id].sign, sol3[ri].car);
  check(after.pos[sol3[ri].car] === before.pos[sol3[ri].car] + rsign * pr.dist, 'swipe toward the tail reversed the car ' + pr.dist + ' cell(s)');
  // and forward again on another car (both directions work)
  c = await findCar(p, 0, 'exit');
  check(c >= 0, 'after the reverse a car can drive out');

  // --- level 4: first holding-bay level ---
  await openLevel(p, 4);
  check((await p.textContent('#tip')).toLowerCase().includes('bay'), 'level 4 tip teaches the holding bay');
  const sol4 = await p.evaluate(() => window.WJB.solution());
  let parked = false;
  for (const m of sol4) {
    await inputMove(p, T, m.car, m.which, m.which ? 'swipe' : 'tap'); await settle(p);
    if (!parked && (await S(p)).bay.length) { parked = true; await shot(p, 'v3-04-phone-level4-holding-bay.png'); }
  }
  await p.waitForSelector('#ov-win.show', { timeout: 5000 }).catch(() => {});
  check(parked && await p.locator('#ov-win.show').count() === 1, 'level 4: an out-of-order letter parked in the bay, auto-boarded, level won');

  // --- hint from a mid-game state on level 11 (the old v2 level 1) ---
  await openLevel(p, 11);
  c = await findCar(p, 1, 'slide');
  if (c >= 0) { await inputMove(p, T, c, 1, 'swipe'); await settle(p); }
  await tapEl(p, T, '#btn-hint');
  await p.waitForFunction(() => document.querySelector('.car.hint'), null, { timeout: 15000 });
  const hintOk = await hintCheck(p);
  check(hintOk.ok, 'level 11 hint (mid-game) is on an optimal path (' + hintOk.d0 + ' -> ' + hintOk.d1 + ')');

  // --- dead end + lose ---
  let deadDone = false;
  for (const n of [2, 3, 6, 13]) {
    await openLevel(p, n);
    const dp = await pathTo(p, 'dead');
    if (!dp) continue;
    await playPath(p, T, dp);
    await p.waitForSelector('#deadend.show', { timeout: 15000 }).catch(() => {});
    check(await p.locator('#deadend.show').count() === 1, 'dead-end banner on level ' + n + ' after ' + dp.length + ' move(s)');
    await tapEl(p, T, '#btn-dead-undo'); await settle(p);
    check(await p.locator('#deadend.show').count() === 0, 'Undo from the dead-end banner clears it');
    deadDone = true; break;
  }
  check(deadDone, 'found and triggered a dead end');
  let loseDone = false;
  for (const n of [6, 7, 8, 12]) {
    await openLevel(p, n);
    const lp = await pathTo(p, 'lose');
    if (!lp) continue;
    await playPath(p, T, lp);
    await p.waitForSelector('#ov-lose.show', { timeout: 5000 }).catch(() => {});
    check(await p.locator('#ov-lose.show').count() === 1, 'lose screen "Bay full!" on level ' + n + ' after ' + lp.length + ' moves');
    loseDone = true; break;
  }
  check(loseDone, 'found and triggered a loss on a bay-limit level');

  // --- new level 10 (hand-off level) and the 7x7 finale layout ---
  await openLevel(p, 10);
  await layoutOk(p, 'phone L10');
  await shot(p, 'v3-06-phone-level10.png');
  await openLevel(p, 20);
  const L20 = await layoutOk(p, 'phone L20 (7x7)');
  check(L20.minCar >= 40, '7x7 cars are >= 40px tap/swipe targets (' + Math.round(L20.minCar) + 'px)');

  // --- every level winnable through real touch input at par ---
  console.log('\n# Phone: all 20 levels with taps + swipes');
  await p.goto(URL); await p.evaluate(() => localStorage.clear());
  await winAll(p, T, 'phone');
  t = await seeded(p, await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))));
  check(t.open.length === 20 && t.stars.every(s => s === '\u2605\u2605\u2605'), 'after winning all 20: everything open with 3 stars');

  /* ----------------------- PROGRESS MIGRATION ----------------------- */
  console.log('\n# Saved-progress migration (seeded localStorage)');
  // A: a v2 player who beat v2 levels 1-3 (BUS, CAR, PLANET); their unlock index 3 pointed at APPLE
  t = await seeded(p, { unlocked: 3, stars: { 'lv1-bus': 3, 'lv2-car': 2, 'lv3-planet': 1 }, best: { 'lv1-bus': 10, 'lv2-car': 15, 'lv3-planet': 25 }, sound: true });
  check(same(t.open, range(1, 14)), 'v2 save (beat BUS, CAR, PLANET): levels 1-14 open = all 10 starters + the 3 beaten + APPLE (got ' + t.open.join(',') + ')');
  check(t.stars[10] === '\u2605\u2605\u2605' && t.stars[11] === '\u2605\u2605\u2606' && t.stars[12] === '\u2605\u2606\u2606', 'v2 stars kept on levels 11-13 (keyed by id)');
  check(t.current === 14 && t.play === 'Continue', 'Continue points at level 14 (APPLE), the next unbeaten v2 level');
  check(t.stored.v === 3 && t.stored.unlocked === 13 && t.stored.best['lv3-planet'] === 25, 'migrated save stored as v3 (unlocked index 13, best moves kept)');
  await shot(p, 'v3-09-phone-level-select-migrated.png');
  await tapEl(p, T, '#btn-play'); await p.waitForTimeout(700);
  check((await p.textContent('#hud-level')).trim() === 'Level 14 of 20', 'Continue opens level 14');
  // reload: migration must not apply twice
  t = await seeded(p, await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))));
  check(same(t.open, range(1, 14)), 'reloading a migrated save does not shift it again');
  // B: a v2 player who finished all 10 v2 levels
  const all = {}; LV.slice(10).forEach(l => { all[l.id] = 3; });
  t = await seeded(p, { unlocked: 9, stars: all, best: {}, sound: false });
  check(t.open.length === 20, 'v2 save with all 10 beaten: all 20 levels open');
  // C: a player with stars only on a v2 level reached by deep link (unlock index 0)
  t = await seeded(p, { unlocked: 0, stars: { 'lv5-garden': 2 }, best: {}, sound: true });
  check(same(t.open, range(1, 15)), 'stars on lv5-garden only: it and every level before it are open (1-15)');
  // D: v2 save that never won anything: starts at the new level 1
  t = await seeded(p, { unlocked: 0, stars: {}, best: {}, sound: true });
  check(same(t.open, [1]) && t.current === 1, 'v2 save without wins: starts at new level 1');
  // E: an already-v3 save is not shifted
  t = await seeded(p, { v: 3, unlocked: 2, stars: { 'st1-cat': 3, 'st2-dog': 3 }, best: {}, sound: true });
  check(same(t.open, [1, 2, 3]) && t.current === 3, 'v3 save (beat starters 1-2): levels 1-3 open, Continue = level 3');
  // F: winning a starter level on a migrated save does not lock anything
  t = await seeded(p, { unlocked: 3, stars: { 'lv1-bus': 3, 'lv2-car': 3, 'lv3-planet': 3 }, best: {}, sound: true });
  await openLevel(p, 1);
  const s1 = await p.evaluate(() => window.WJB.solution());
  await playPath(p, T, s1);
  await p.waitForSelector('#ov-win.show', { timeout: 5000 });
  t = await seeded(p, await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))));
  check(same(t.open, range(1, 14)) && t.stars[0] === '\u2605\u2605\u2605', 'migrated player replays starter 1: it gets stars, 1-14 still open');
  await phone.close();

  /* ------------------------------ DESKTOP ------------------------------ */
  console.log('\n# Desktop 1280x800 (mouse)');
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const d = await desk.newPage();
  watch(d, 'desktop');
  const M = { touch: false };
  t = await seeded(d, null);
  const dsel = await d.evaluate(() => [...document.querySelectorAll('.lvl')].every(b => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; }));
  check(dsel && t.open.length === 1, 'desktop level select shows all 20 levels without scrolling');
  await shot(d, 'v3-07-desktop-level-select.png');
  await d.click('#btn-play'); await d.waitForTimeout(750);
  await layoutOk(d, 'desktop L1');
  // right-click reverses (level 3 teaches reverse)
  await openLevel(d, 3);
  c = await findCar(d, 1, 'slide');
  pr = await probe(d, c, 1); before = await S(d);
  await inputMove(d, M, c, 1, 'rightclick'); await settle(d);
  after = await S(d);
  check(after.pos[c] === before.pos[c] - (await d.evaluate(id => window.WJB.session.game.cars[id].sign, c)) * pr.dist, 'desktop: right-click reverses a car');
  await d.keyboard.press('r'); await d.waitForTimeout(300);
  check((await S(d)).moves === 0, 'desktop: R restarts');
  console.log('\n# Desktop: all 20 levels with clicks + mouse drags');
  await winAll(d, M, 'desktop');
  await openLevel(d, 10);
  const sol10 = await d.evaluate(() => window.WJB.solution());
  for (const m of sol10.slice(0, 3)) { await inputMove(d, M, m.car, m.which, m.which === 1 ? 'drag' : 'click'); await settle(d); }
  const nxt = await d.evaluate(() => window.WJB.solution()[0]);
  M.holdShot = 'v3-08-desktop-level10-midplay.png';
  await inputMove(d, M, nxt.car, nxt.which, 'drag'); await settle(d);
  await desk.close();
  await browser.close();

  console.log('\n# Console / page errors');
  errors.forEach(e => console.log('  ' + e));
  check(errors.length === 0, 'no console errors, page errors or failed requests');
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
