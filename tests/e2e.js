#!/usr/bin/env node
/*
 * Headless browser play-test for Word Jam Bus v2 (slide-until-blocked rules).
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

(async () => {
  const browser = await chromium.launch();

  /* ------------------------------ PHONE ------------------------------ */
  console.log('\n# Phone 390x844 (touch, isMobile)');
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const p = await phone.newPage();
  watch(p, 'phone');
  const T = { touch: true, cdp: await phone.newCDPSession(p) };
  await p.goto(URL);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForSelector('#screen-title.active');
  check(await p.locator('.lvl').count() === 10, '10 levels listed');
  check(await p.locator('.lvl.locked').count() === 9, 'only level 1 unlocked on a fresh save');
  check(await p.evaluate(() => getComputedStyle(document.getElementById('lot')).touchAction) === 'none', 'lot has touch-action:none (swipes never scroll/zoom)');
  await shot(p, 'v2-01-phone-title.png');
  await p.touchscreen.tap(...await p.locator('#btn-play').boundingBox().then(b => [b.x + b.width / 2, b.y + b.height / 2]));
  await p.waitForSelector('#screen-game.active');
  await p.waitForTimeout(750);
  check((await p.textContent('#hud-level')).includes('Level 1'), 'Play opens level 1');
  await layoutOk(p, 'phone L1');
  await shot(p, 'v2-02-phone-level1-start.png');

  // --- partial forward slide that stops at a blocker (tap) ---
  let c = await findCar(p, 0, 'slide');
  check(c >= 0, 'level 1 has a car that can slide forward partway');
  let pr = await probe(p, c, 0), before = await S(p);
  await inputMove(p, T, c, 0, 'tap'); await settle(p);
  let after = await S(p);
  const fsign = await p.evaluate(id => window.WJB.session.game.cars[id].sign, c);
  check(after.pos[c] === before.pos[c] + fsign * pr.dist && after.pos[c] >= 0, 'tap: car slid forward ' + pr.dist + ' cell(s) and stopped at the blocker (still in the lot)');
  check(after.moves === before.moves + 1, 'a partial slide counts as 1 move');
  await shot(p, 'v2-03-phone-midplay-partial-slide.png');

  // --- undo of the partial slide ---
  await p.locator('#btn-undo').tap(); await settle(p);
  let u = await S(p);
  check(u.pos[c] === before.pos[c] && u.moves === before.moves && u.undos === after.undos - 1, 'Undo puts the slid car back and refunds the move (1 undo used)');

  // --- reverse slide by swiping toward the tail (with ghost preview captured mid-swipe) ---
  c = await findCar(p, 1, 'slide');
  check(c >= 0, 'level 1 has a car that can reverse');
  pr = await probe(p, c, 1); before = await S(p);
  T.holdShot = 'v2-04-phone-swipe-preview.png';
  await inputMove(p, T, c, 1, 'swipe'); await settle(p);
  after = await S(p);
  const rsign = await p.evaluate(id => -window.WJB.session.game.cars[id].sign, c);
  check(after.pos[c] === before.pos[c] + rsign * pr.dist, 'swipe toward the tail: car reversed ' + pr.dist + ' cell(s) and stopped');
  // and swipe it forward again (both directions)
  pr = await probe(p, c, 0); before = after;
  await inputMove(p, T, c, 0, 'swipe'); await settle(p);
  after = await S(p);
  check(pr.kind !== 'bump' && (after.pos[c] !== before.pos[c]), 'swipe toward the nose moves the same car forward again (' + pr.kind + ')');
  await p.locator('#btn-restart').tap(); await p.waitForTimeout(400);

  // --- bump: a car that cannot move either way shakes, no move used ---
  c = await findCar(p, 0, 'bump', { bothBump: true });
  if (c < 0) c = await findCar(p, 0, 'bump');
  check(c >= 0, 'level 1 has a car that cannot move forward');
  before = await S(p);
  await inputMove(p, T, c, 0, 'tap'); await p.waitForTimeout(120);
  check(await p.locator('.car[data-id="' + c + '"]').evaluate(e => /bump-/.test(e.className)), 'blocked tap: car shakes');
  check(await p.locator('#toast.show').count() === 1, 'blocked tap: toast shown');
  check((await S(p)).moves === before.moves, 'a bump is not a move');
  await settle(p);

  // --- hint points to a move on an optimal path from the current state ---
  // make one non-optimal-ish move first so the hint is computed from a mid-game state
  c = await findCar(p, 1, 'slide');
  if (c >= 0) { await inputMove(p, T, c, 1, 'swipe'); await settle(p); }
  await p.locator('#btn-hint').tap();
  await p.waitForFunction(() => document.querySelector('.car.hint'), null, { timeout: 15000 });
  const hintOk = await hintCheck(p);
  check(hintOk.ok, 'hint move is on an optimal path (moves to win ' + hintOk.d0 + ' -> ' + hintOk.d1 + ')');
  check(await p.locator('#ghost.show').count() === 1, 'hint shows a ghost of where the car will go');

  // --- win level 1 by real input (optimal from here) ---
  const solA = await p.evaluate(() => window.WJB.solution());
  await playPath(p, T, solA);
  await p.waitForSelector('#ov-win.show', { timeout: 5000 });
  check(true, 'level 1 won with taps + swipes');
  await p.waitForTimeout(500);
  await shot(p, 'v2-05-phone-win.png');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1')));
  check(saved && saved.unlocked >= 1 && saved.stars['lv1-bus'] >= 1, 'progress saved (level 2 unlocked)');

  // --- dead end warning ---
  let deadDone = false;
  for (const n of [3, 4, 2, 5, 6]) {
    await openLevel(p, n);
    const dp = await pathTo(p, 'dead');
    if (!dp) continue;
    await playPath(p, T, dp);
    await p.waitForSelector('#deadend.show', { timeout: 15000 }).catch(() => {});
    check(await p.locator('#deadend.show').count() === 1, 'dead-end banner on level ' + n + ' after ' + dp.length + ' move(s)');
    await shot(p, 'v2-06-phone-dead-end.png');
    await p.locator('#btn-dead-undo').tap(); await settle(p);
    check(await p.locator('#deadend.show').count() === 0, 'Undo from the dead-end banner clears it');
    deadDone = true; break;
  }
  check(deadDone, 'found and triggered a dead end');

  // --- lose: wrong letter leaves with a full bay ---
  let loseDone = false;
  for (const n of [2, 3, 4, 1]) {
    await openLevel(p, n);
    const lp = await pathTo(p, 'lose');
    if (!lp) continue;
    await playPath(p, T, lp);
    await p.waitForSelector('#ov-lose.show', { timeout: 5000 }).catch(() => {});
    check(await p.locator('#ov-lose.show').count() === 1 && (await p.textContent('#lose-title')).includes('Bay full'), 'lose screen "Bay full!" on level ' + n + ' after ' + lp.length + ' moves');
    await p.waitForTimeout(400);
    await shot(p, 'v2-07-phone-lose.png');
    await p.locator('#btn-retry').tap(); await p.waitForTimeout(300);
    check((await S(p)).moves === 0 && !(await S(p)).ended, 'Retry restarts the level');
    loseDone = true; break;
  }
  check(loseDone, 'found and triggered a loss');

  // --- congested later level on phone ---
  await openLevel(p, 10);
  const L10 = await layoutOk(p, 'phone L10 (7x7)');
  check(L10.minCar >= 40, '7x7 cars are >= 40px tap/swipe targets (' + Math.round(L10.minCar) + 'px)');
  await shot(p, 'v2-08-phone-level10-start.png');
  // hint on the biggest level: the background solver must answer quickly
  const th = Date.now();
  await p.locator('#btn-hint').tap();
  await p.waitForFunction(() => document.querySelector('.car.hint'), null, { timeout: 20000 });
  const h10 = await hintCheck(p);
  check(h10.ok, 'level 10 hint is on an optimal path (' + h10.d0 + ' -> ' + h10.d1 + '), shown ' + (Date.now() - th) + ' ms after tapping Hint on a fresh level');
  const sol10 = await p.evaluate(() => window.WJB.solution());
  await playPath(p, T, sol10.slice(0, Math.floor(sol10.length / 2)));
  await shot(p, 'v2-09-phone-level10-midplay.png');

  // --- every level winnable through real input ---
  console.log('\n# Solving all 10 levels with phone taps + swipes');
  for (let n = 1; n <= 10; n++) {
    await openLevel(p, n);
    const t0 = Date.now();
    const sol = await p.evaluate(() => window.WJB.solution());
    await playPath(p, T, sol);
    await p.waitForSelector('#ov-win.show', { timeout: 6000 }).catch(() => {});
    const won = await p.locator('#ov-win.show').count() === 1;
    const st = await p.getAttribute('#win-stars', 'data-stars');
    const par = await p.evaluate(() => window.WJB.session.level.par);
    check(won && st === '3' && sol.length === par, 'level ' + n + ' won in ' + sol.length + ' moves (= par ' + par + ', ' +
      sol.filter(m => m.which === 1).length + ' swipes back), 3 stars [' + (Date.now() - t0) + ' ms]');
  }
  await phone.close();

  /* ------------------------------ DESKTOP ------------------------------ */
  console.log('\n# Desktop 1280x800 (mouse)');
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const d = await desk.newPage();
  watch(d, 'desktop');
  const M = { touch: false };
  await d.goto(URL);
  await d.evaluate(() => localStorage.clear());
  await d.reload();
  await d.waitForSelector('#screen-title.active');
  await shot(d, 'v2-10-desktop-title.png');
  await d.click('#btn-play'); await d.waitForTimeout(750);
  await layoutOk(d, 'desktop L1');
  // right-click reverses
  c = await findCar(d, 1, 'slide');
  pr = await probe(d, c, 1); before = await S(d);
  await inputMove(d, M, c, 1, 'rightclick'); await settle(d);
  after = await S(d);
  check(after.pos[c] === before.pos[c] - (await d.evaluate(id => window.WJB.session.game.cars[id].sign, c)) * pr.dist, 'desktop: right-click reverses a car');
  await d.keyboard.press('r'); await d.waitForTimeout(300);
  check((await S(d)).moves === 0, 'desktop: R restarts');
  const solD = await d.evaluate(() => window.WJB.solution());
  for (const m of solD) { await inputMove(d, M, m.car, m.which, m.which === 1 ? 'drag' : 'click'); await settle(d); }
  await d.waitForSelector('#ov-win.show', { timeout: 5000 }).catch(() => {});
  check(await d.locator('#ov-win.show').count() === 1, 'desktop: level 1 won with clicks + mouse drags');
  await openLevel(d, 7);
  await layoutOk(d, 'desktop L7');
  const sol7 = await d.evaluate(() => window.WJB.solution());
  for (const m of sol7.slice(0, 6)) { await inputMove(d, M, m.car, m.which, m.which === 1 ? 'drag' : 'click'); await settle(d); }
  const nxt = await d.evaluate(() => window.WJB.solution()[0]);
  M.holdShot = 'v2-11-desktop-level7-midplay.png';
  await inputMove(d, M, nxt.car, nxt.which, 'drag'); await settle(d);
  await desk.close();
  await browser.close();

  console.log('\n# Console / page errors');
  errors.forEach(e => console.log('  ' + e));
  check(errors.length === 0, 'no console errors, page errors or failed requests');
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
