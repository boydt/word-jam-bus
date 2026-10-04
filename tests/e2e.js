#!/usr/bin/env node
/*
 * Headless browser play-test for Word Jam Bus (v2 slide-until-blocked rules;
 * v4 level set: 10 starter levels, the 10 v2 levels and 3 Scramble breathers = 23;
 * coins + boosters; Bay Word).
 *   python3 -m http.server 8765   (in the game folder, or set WJB_URL)
 *   node tests/e2e.js
 * Uses REAL input only to move cars: touch taps + touch swipes (CDP touch
 * events) at phone size 390x844 with mobile emulation, mouse clicks / drags /
 * right-clicks at desktop 1280x800, plus a layout check at 375x667. The page's
 * engine is only *read* to pick which car to move and to check results; boosters
 * are bought and used through the real buttons and car taps/swipes.
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
const S = page => page.evaluate(() => { const s = window.WJB.session; return { pos: s.state.pos.slice(), moves: s.state.moves, idx: s.state.idx, mask: s.state.mask, bay: s.state.bay.slice(), cap: s.state.cap, words: s.state.words, used: Object.assign({}, s.state.used), undos: s.undos, hints: s.hints, ended: s.ended, coins: window.WJB.progress.coins, dead: s.dead }; });

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
async function openLevel(page, n, keepCoach) {
  const was = await page.evaluate(() => location.href).catch(() => '');
  await page.goto(URL + '#level-' + n);
  if (was === URL + '#level-' + n) await page.reload();
  await page.waitForSelector('#screen-game.active');
  await page.waitForTimeout(750);
  const hud = (await page.textContent('#hud-level')).trim();
  if (hud.indexOf('Level ' + n + ' of') !== 0) throw new Error('openLevel(' + n + ') shows "' + hud + '"');
  if (!keepCoach && await page.locator('#ov-coach.show').count()) { await page.locator('#btn-coach').click(); await page.waitForTimeout(200); }
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
      if (goal === 'bayword' && r.cleared && r.cleared.length) return p2;
      if (goal === 'dead' && !r.won && E.solve(g, r.state, { maxStates: 200000 }).status === 'none') return p2;
      const k = E.stateKey(r.state);
      if (!seen.has(k) && path.length < (goal === 'bayword' ? 14 : 8)) { seen.add(k); q.push({ st: r.state, path: p2 }); }
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

const NLEV = 23;
const SCR = [12, 17, 22];
async function winAll(page, ctx, label) {
  for (let n = 1; n <= NLEV; n++) {
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
    const lv = await page.evaluate(() => ({ par: window.WJB.session.level.par, id: window.WJB.session.level.id, mode: window.WJB.session.level.mode || 'route', used: window.WJB.session.state.used }));
    const noBoost = !lv.used.tow && !lv.used.bay && !lv.used.nudge;
    check(won && st === '3' && sol.length === lv.par && noBoost, label + ' level ' + n + ' (' + lv.id + (lv.mode === 'scramble' ? ', Scramble' : '') + ') won in ' + sol.length + ' moves (= par ' + lv.par + ', ' +
      sol.filter(m => m.which === 1).length + ' reverses), no boosters, 3 stars [' + (Date.now() - t0) + ' ms]');
  }
}
const v4save = extra => Object.assign({ v: 4, unlocked: 22, unlockedId: 'lv10-school', stars: {}, best: {}, sound: false, coins: 0, seen: { scramble: true } }, extra || {});
async function buy(page, ctx, kind) {
  await tapEl(page, ctx, '#btn-shop'); await page.waitForSelector('#ov-shop.show'); await page.waitForTimeout(350);
  await tapEl(page, ctx, '#buy-' + kind); await page.waitForSelector('#shop-confirm.show'); await page.waitForTimeout(250);
  await tapEl(page, ctx, '#btn-confirm'); await page.waitForTimeout(250);
}
async function fitCheck(page, label) {
  return page.evaluate(() => {
    const r = [...document.querySelectorAll('.lvl')].map(b => b.getBoundingClientRect());
    const foot = [...document.querySelectorAll('.title-foot .btn')].map(b => b.getBoundingClientRect());
    return { fits: r.every(b => b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth), footFits: foot.every(b => b.bottom <= innerHeight),
      rows: new Set(r.map(b => Math.round(b.top))).size, minW: Math.min(...r.map(b => b.width)), minH: Math.min(...r.map(b => b.height)),
      scroll: document.getElementById('screen-title').scrollHeight <= innerHeight + 1 };
  });
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
  check(await p.locator('.lvl').count() === NLEV, NLEV + ' levels listed');
  check(same(t.open, [1]), 'fresh save: only level 1 unlocked');
  check(same(await p.evaluate(() => [...document.querySelectorAll('.lvl.scr')].map(b => +b.getAttribute('data-level'))), SCR) &&
    await p.locator('.lvl.scr .lvl-scr').count() === 3, 'level select marks the Scramble levels 12, 17, 22 with a shuffle icon');
  let sel = await fitCheck(p);
  check(sel.fits && sel.footFits && sel.scroll && sel.minH >= 44, 'level select: all 23 buttons + footer fit on 390x844 without scrolling (' + sel.rows + ' rows, buttons ' + Math.round(sel.minW) + 'x' + Math.round(sel.minH) + 'px)');
  check((await p.textContent('#title-coins')).trim() === '0' && t.stored.coins === 0 && t.stored.v === 4, 'fresh save: coin counter 0, stored as v4');
  check(await p.evaluate(() => getComputedStyle(document.getElementById('lot')).touchAction) === 'none', 'lot has touch-action:none (swipes never scroll/zoom)');

  // --- coins: fares banked on a win, doubled at par, +20 first clear; saved ---
  await tapEl(p, T, '#btn-play'); await p.waitForSelector('#screen-game.active'); await p.waitForTimeout(700);
  check((await p.textContent('#hud-level')).trim() === 'Level 1 of 23', 'Play opens "Level 1 of 23"');
  check(await p.locator('#word .tile .seat-n').count() === 3 && (await p.locator('#word .tile.next').count()) === 1 &&
    await p.locator('#word .tile[data-slot="0"].next').count() === 1, 'in-order level: seats numbered 1-3, seat 1 glows as next');
  await layoutOk(p, 'phone L1');
  let sol = await p.evaluate(() => window.WJB.solution());
  await inputMove(p, T, sol[0].car, sol[0].which, sol[0].which ? 'swipe' : 'tap'); await settle(p);
  check(await p.locator('#word .tile[data-slot="1"].next').count() === 1 && (await p.textContent('#purse')).trim() === '+1', 'after C boards: seat 2 glows, the fare box shows +1');
  await tapEl(p, T, '#btn-undo'); await settle(p);
  check((await p.textContent('#purse')).trim() === '+0' && await p.locator('#word .tile[data-slot="0"].next').count() === 1, 'Undo takes the fare back out of the fare box (+0)');
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 5000 });
  let cs = await S(p);
  check(cs.coins === 26 && (await p.getAttribute('#win-coins', 'data-earned')) === '26', 'win at par: 3 fares x2 (par bonus) + 20 first clear = 26 coins banked (' + (await p.textContent('#win-coins')).trim() + ')');
  t = await seeded(p, await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))));
  check(t.stored.coins === 26 && (await p.textContent('#title-coins')).trim() === '26', 'coins saved in localStorage and shown on the title after reload (26)');
  await openLevel(p, 1);
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 5000 });
  check((await S(p)).coins === 32, 'replaying level 1 at par: +6 (no second first-clear bonus)');
  // over par: no par bonus
  await openLevel(p, 2);
  let c = await findCar(p, 1, 'slide'); if (c < 0) c = await findCar(p, 0, 'slide');
  const extra = c >= 0 ? [{ car: c, which: (await probe(p, c, 1)).kind === 'slide' ? 1 : 0 }] : [];
  await playPath(p, T, extra);
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 5000 });
  cs = await S(p);
  check(cs.moves > LV[1].par && cs.coins === 32 + 3 + 20, 'level 2 over par (' + cs.moves + ' moves): fares 3, no par bonus, +20 first clear');
  // a loss banks nothing
  await openLevel(p, 7);
  const lp7 = await pathTo(p, 'lose');
  const before7 = (await S(p)).coins;
  if (lp7) { await playPath(p, T, lp7); await p.waitForSelector('#ov-lose.show', { timeout: 5000 }).catch(() => {}); }
  check(lp7 && await p.locator('#ov-lose.show').count() === 1 && (await S(p)).coins === before7, 'a lost level banks no fares (coins unchanged at ' + before7 + ')');

  // --- Scramble: first-time coach card, banner, purple bus, unnumbered seats, any-order boarding ---
  await seeded(p, v4save({ coins: (await S(p)).coins, seen: {} }));
  await openLevel(p, 12, true);
  check(await p.locator('#ov-coach.show').count() === 1, 'first Scramble level: one-time coach card "Scramble stop!" shows');
  await shot(p, 'v4-01-phone-first-scramble-tip.png');
  await tapEl(p, T, '#btn-coach'); await p.waitForTimeout(450);
  check(await p.locator('#banner.show').count() === 1 && /ANY/.test(await p.textContent('#banner')), 'start banner "Scramble stop! Letters board in ANY order" after the tip');
  await shot(p, 'v4-02-phone-scramble-banner.png');
  const vis = await p.evaluate(() => ({ purple: getComputedStyle(document.getElementById('bus')).backgroundColor, badge: getComputedStyle(document.querySelector('#bus .shuffle-badge')).display,
    nums: document.querySelectorAll('#word .seat-n').length, open: document.querySelectorAll('#word .tile.open').length, next: document.querySelectorAll('#word .tile.next').length,
    bay: document.getElementById('bay-name').textContent, seen: JSON.parse(localStorage.getItem('wordJamBus.progress.v1')).seen }));
  check(vis.purple === 'rgb(139, 92, 246)' && vis.badge !== 'none', 'Scramble bus is purple with a shuffle badge');
  check(vis.nums === 0 && vis.next === 0 && vis.open === 5, 'Scramble seats: no numbers, no single "next" seat, all 5 open seats glow');
  check(vis.bay === 'Junk bay' && vis.seen && vis.seen.scramble === true, 'bay is labelled "Junk bay"; the tip is remembered (seen.scramble saved)');
  await p.waitForTimeout(2000);
  check(await p.locator('#banner.show').count() === 0, 'banner hides by itself');
  const sol12 = await p.evaluate(() => window.WJB.solution());
  let outOfOrder = false, junked = false;
  for (const m of sol12) {
    const b0 = await S(p);
    await inputMove(p, T, m.car, m.which, m.which ? 'swipe' : 'tap'); await settle(p);
    const a0 = await S(p);
    if (a0.mask !== b0.mask) { const seat = Math.log2(a0.mask ^ b0.mask); const firstOpen = [0, 1, 2, 3, 4].find(k => !(b0.mask & (1 << k))); if (seat !== firstOpen) outOfOrder = true; }
    if (a0.bay.length > b0.bay.length) junked = true;
    if (outOfOrder && junked && !(await p.evaluate(() => window.WJB.session.ended)) && !p._shot12) { p._shot12 = true; await shot(p, 'v4-03-phone-scramble-midplay.png'); }
  }
  await p.waitForSelector('#ov-win.show', { timeout: 5000 }).catch(() => {});
  check(outOfOrder, 'Scramble: a letter boarded a later seat while an earlier seat was still open (any order)');
  check(junked && (await S(p)).bay.every(u => 'PIZA'.indexOf(u) === -1 || u === 'Z'), 'Scramble: only wrong letters / extra copies went to the junk bay');
  check(await p.locator('#ov-win.show').count() === 1 && await p.getAttribute('#win-stars', 'data-stars') === '3', 'Scramble level 12 won at par (' + sol12.length + ') with 3 stars');
  await openLevel(p, 12, true);
  check(await p.locator('#ov-coach.show').count() === 0 && await p.locator('#banner.show').count() === 1, 'second visit: no coach card, just the start banner');

  // --- in-order level: numbered seats with the next seat glowing ---
  let seat13 = null, lv13 = 0;
  for (const n of [14, 11, 18, 19]) {
    await openLevel(p, n);
    const sol13 = await p.evaluate(() => window.WJB.solution()), wl = await p.evaluate(() => window.WJB.session.game.target.length);
    for (const m of sol13) { await inputMove(p, T, m.car, m.which, m.which ? 'swipe' : 'tap'); await settle(p); const q = await S(p); if (q.idx >= wl || q.ended) break; if (q.idx >= 2) { lv13 = n; break; } }
    if (lv13) { seat13 = await p.evaluate(() => ({ nums: [...document.querySelectorAll('#word .seat-n')].map(e => e.textContent).join(','), n: document.querySelectorAll('#word .tile.next').length, next: document.querySelector('#word .tile.next').getAttribute('data-slot'), idx: window.WJB.session.state.idx, glow: getComputedStyle(document.querySelector('#word .tile.next')).boxShadow, len: window.WJB.session.game.target.length })); break; }
  }
  check(seat13 && seat13.nums === range(1, seat13.len).join(',') && seat13.n === 1 && +seat13.next === seat13.idx && seat13.glow !== 'none', 'in-order level ' + lv13 + ': seats numbered ' + (seat13 && seat13.nums) + '; exactly one seat glows, the next one (' + (seat13 && seat13.idx + 1) + ')');
  await shot(p, 'v4-04-phone-route-numbered-seats.png');

  // --- boosters (coins seeded) ---
  console.log('\n# Boosters');
  await seeded(p, v4save({ coins: 1000 }));
  await openLevel(p, 13);
  await tapEl(p, T, '#btn-shop'); await p.waitForSelector('#ov-shop.show');
  check((await p.textContent('#shop-balance')).trim() === '1000' && /150/.test(await p.textContent('#buy-tow')) && /100/.test(await p.textContent('#buy-bay')) && /60/.test(await p.textContent('#buy-nudge')),
    'shop lists Tow 150, Bay +1 100, Nudge 60 with the coin balance');
  await shot(p, 'v4-05-phone-booster-shop.png');
  await tapEl(p, T, '#buy-tow'); await p.waitForSelector('#shop-confirm.show');
  check(/Spend 150 coins on Tow truck\?/.test(await p.textContent('#confirm-title')), 'confirm-before-spend: "Spend 150 coins on Tow truck?"');
  await shot(p, 'v4-06-phone-confirm-spend.png');
  await tapEl(p, T, '#btn-confirm-cancel'); await tapEl(p, T, '#btn-shop-close'); await p.waitForTimeout(200);
  check((await S(p)).coins === 1000, 'Cancel spends nothing');
  // Tow
  await buy(p, T, 'tow');
  check(await p.locator('#boost-bar.show').count() === 1 && await p.locator('.car.can-boost').count() > 0, 'tow mode: banner + glowing towable cars');
  await shot(p, 'v4-07-phone-tow-truck-pick.png');
  const needed = await p.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine; for (let i = 0; i < s.game.n; i++) if (s.state.pos[i] >= 0 && !E.towable(s.game, s.state, i)) return i; return -1; });
  await inputMove(p, T, needed, 0, 'tap'); await p.waitForTimeout(300);
  cs = await S(p);
  check(cs.coins === 1000 && cs.pos[needed] >= 0 && await p.locator('#boost-bar.show').count() === 1, 'tapping a car the bus still needs: refused, no coins spent, still picking');
  const towc = await p.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine; for (let i = 0; i < s.game.n; i++) if (s.state.pos[i] >= 0 && E.towable(s.game, s.state, i) && 'CAR'.indexOf(s.game.cars[i].l) === -1) return i; return -1; });
  const pre = await S(p);
  await inputMove(p, T, towc, 0, 'tap'); await settle(p);
  cs = await S(p);
  check(cs.pos[towc] === -1 && cs.coins === 850 && cs.moves === pre.moves + 1 && cs.used.tow === 1 && cs.bay.length === pre.bay.length, 'Tow truck: decoy towed away (no bay use), 150 coins spent, +1 move');
  await p.waitForFunction(() => !window.WJB.searching(), null, { timeout: 15000 });
  cs = await S(p);
  const deadNow = await p.evaluate(() => window.WJBEngine.solve(window.WJB.session.game, window.WJB.session.state).par === null);
  check(cs.dead === deadNow, 'dead-end detection re-ran after the tow (dead = ' + deadNow + ')');
  await tapEl(p, T, '#btn-hint');
  await p.waitForFunction(() => document.querySelector('.car.hint'), null, { timeout: 15000 });
  const hb = await hintCheck(p);
  check(hb.ok, 'hint after a booster is on an optimal path from the boosted state (' + hb.d0 + ' -> ' + hb.d1 + ')');
  await tapEl(p, T, '#btn-undo'); await settle(p);
  cs = await S(p);
  check(cs.pos[towc] >= 0 && cs.coins === 1000 && cs.moves === pre.moves && cs.used.tow === 0 && await p.locator('.car[data-id="' + towc + '"]').isVisible(), 'Undo after the tow: car back, move back, 150 coins refunded');
  // Bay +1
  await buy(p, T, 'bay');
  cs = await S(p);
  check(cs.cap === 4 && cs.coins === 900 && cs.moves === pre.moves && await p.locator('#bay .slot').count() === 4 && await p.locator('#bay .slot.plus').count() === 1 && /\/4\)/.test(await p.textContent('#bay-count')),
    'Bay +1: a 4th (gold) bay spot, 100 coins, no move');
  await openLevel(p, 13); // fresh lot, then fill the bay past 3 with the extra spot
  await buy(p, T, 'bay');
  const four = await p.evaluate(() => { // a line that parks 4 letters (needs the 4th spot)
    const s = window.WJB.session, E = window.WJBEngine, g = s.game, q = [{ st: s.state, path: [] }], seen = new Set([E.stateKey(s.state)]);
    while (q.length) { const { st, path } = q.shift(); const grid = E.buildGrid(g, st.pos);
      for (let i = 0; i < g.n; i++) for (let w = 0; w < 2; w++) { const r = E.step(g, st, i, w, null, grid); if (['gone', 'bump', 'lose'].includes(r.result)) continue;
        const p2 = path.concat([{ car: i, which: w }]); if (r.state.bay.length === 4) return p2; const k = E.stateKey(r.state); if (!seen.has(k) && path.length < 9) { seen.add(k); q.push({ st: r.state, path: p2 }); } } }
    return null; });
  if (four) await playPath(p, T, four);
  cs = await S(p);
  check(four && cs.bay.length === 4 && !cs.ended, 'the extra spot really holds a 4th parked letter');
  await shot(p, 'v4-08-phone-bay-plus-one.png');
  await openLevel(p, 13);
  await buy(p, T, 'bay');
  await tapEl(p, T, '#btn-undo'); await settle(p);
  cs = await S(p);
  check(cs.cap === 3 && await p.locator('#bay .slot').count() === 3 && cs.used.bay === 0, 'Undo after Bay +1: back to 3 spots, coins refunded (' + cs.coins + ')');
  // Nudge (swipe back one cell), with the preview mid-swipe
  await openLevel(p, 13);
  await buy(p, T, 'nudge');
  const nud = await p.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine, g = s.game, grid = E.buildGrid(g, s.state.pos);
    for (let i = 0; i < g.n; i++) { if (s.state.pos[i] < 0) continue; const to = E.nudgeTo(g, s.state, i, 1), pr = E.probe(g, grid, s.state.pos, i, 1); if (to !== null && pr.kind === 'slide' && pr.dist >= 2) return i; }
    for (let i = 0; i < g.n; i++) if (s.state.pos[i] >= 0 && E.nudgeTo(g, s.state, i, 1) !== null) return i; return -1; });
  const nb = await S(p);
  await shot(p, 'v4-09-phone-nudge-pick.png');
  await inputMove(p, T, nud, 1, 'swipe'); await settle(p);
  cs = await S(p);
  const nsign = await p.evaluate(id => -window.WJB.session.game.cars[id].sign, nud);
  check(cs.pos[nud] === nb.pos[nud] + nsign && cs.coins === nb.coins - 60 && cs.moves === nb.moves + 1 && cs.used.nudge === 1, 'Nudge: swipe moved the car back exactly 1 cell (a normal reverse would slide further), 60 coins, +1 move');
  await tapEl(p, T, '#btn-undo'); await settle(p);
  cs = await S(p);
  check(cs.pos[nud] === nb.pos[nud] && cs.coins === nb.coins, 'Undo after the nudge: car back, 60 coins refunded');
  // booster win: at most 2 stars, no par bonus, best moves not recorded
  await seeded(p, v4save({ coins: 500 }));
  await openLevel(p, 11);
  await buy(p, T, 'tow');
  const tw = await p.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine; for (let i = 0; i < s.game.n; i++) if (s.state.pos[i] >= 0 && E.towable(s.game, s.state, i)) return i; return -1; });
  await inputMove(p, T, tw, 0, 'tap'); await settle(p);
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 6000 }).catch(() => {});
  cs = await S(p);
  const st11 = await p.getAttribute('#win-stars', 'data-stars'), stored11 = await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1')));
  check(await p.locator('#ov-win.show').count() === 1 && st11 === '2' && /Booster used/.test(await p.textContent('#win-detail')) && cs.moves <= LV[10].par,
    'win with a booster at/under par (' + cs.moves + ' moves): capped at 2 stars, "Booster used"');
  check(cs.coins === 500 - 150 + 3 + 20 && stored11.best['lv1-bus'] === undefined, 'booster win: fares 3 + first clear 20, no par bonus, best moves not recorded');
  // lose after a booster: coins stay spent, nothing banked
  await seeded(p, v4save({ coins: 500 }));
  await openLevel(p, 13);
  await buy(p, T, 'bay');
  const lb = await pathTo(p, 'lose');
  if (lb) { await playPath(p, T, lb); await p.waitForSelector('#ov-lose.show', { timeout: 5000 }).catch(() => {}); }
  check(lb && await p.locator('#ov-lose.show').count() === 1 && (await S(p)).coins === 400 && (await S(p)).bay.length === 4, 'Bay +1 then a 5th junk letter: "Bay full!" loss, coins stay spent (400)');
  // dead end -> boosters button in the banner
  await openLevel(p, 13);
  const dp = await pathTo(p, 'dead');
  if (dp) await playPath(p, T, dp);
  await p.waitForSelector('#deadend.show', { timeout: 15000 }).catch(() => {});
  check(dp && await p.locator('#deadend.show').count() === 1, 'dead-end banner after ' + (dp ? dp.length : '?') + ' moves');
  await tapEl(p, T, '#btn-dead-shop'); await p.waitForSelector('#ov-shop.show');
  check(true, 'dead-end banner has a Boosters button that opens the shop');
  await tapEl(p, T, '#buy-bay'); await p.waitForSelector('#shop-confirm.show'); await tapEl(p, T, '#btn-confirm'); await p.waitForTimeout(300);
  await p.waitForFunction(() => !window.WJB.searching(), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(400);
  const rescued = await p.evaluate(() => window.WJBEngine.solve(window.WJB.session.game, window.WJB.session.state, { maxStates: 2000000 }).par !== null);
  cs = await S(p);
  check(cs.dead === !rescued && (await p.locator('#deadend.show').count() === 1) === !rescued, 'after Bay +1 in a dead end the dead-end check re-ran: ' + (rescued ? 'rescued, banner gone' : 'still dead, banner stays'));
  await layoutOk(p, 'phone L13 with boosters');

  // --- Bay Word on level 17 (JUNGLE): junk letters spell a word, clear, pay 10 ---
  console.log('\n# Bay Word');
  await seeded(p, v4save({ coins: 0 }));
  await openLevel(p, 17);
  check((await p.textContent('#tip')).includes('Bay Word'), 'level 17 tip introduces the Bay Word');
  const bw = await pathTo(p, 'bayword');
  check(!!bw, 'found a line to a Bay Word on level 17 (' + (bw ? bw.length : '-') + ' moves)');
  await playPath(p, T, bw.slice(0, -1));
  const bwBefore = await S(p);
  const lastM = bw[bw.length - 1];
  await inputMove(p, T, lastM.car, lastM.which, lastM.which ? 'swipe' : 'tap');
  await p.waitForSelector('#bay .slot.word', { timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(150);
  const wordShown = await p.locator('#bay .slot.word').count();
  await shot(p, 'v4-10-phone-bay-word-clear.png');
  await settle(p); await p.waitForTimeout(500);
  cs = await S(p);
  check(wordShown === 3 && cs.words === 1 && cs.bay.length === bwBefore.bay.length + 1 - 3 && !cs.ended, 'Bay Word: 3 junk letters light up and leave the bay (bay ' + bwBefore.bay.length + ' -> ' + cs.bay.length + ')' + (bwBefore.bay.length === 3 ? ', checked before the bay-full loss' : ''));
  check((await p.textContent('#purse')).trim() === '+' + (cs.idx + 10), 'fare box shows the +10 Bay Word bonus (' + (await p.textContent('#purse')).trim() + ')');
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 6000 }).catch(() => {});
  const wc = await p.textContent('#win-coins');
  check(/Bay Word 10/.test(wc) && (await S(p)).coins === +(await p.getAttribute('#win-coins', 'data-earned')), 'win card lists "Bay Word 10" and the coins are banked (' + wc.trim() + ')');
  await shot(p, 'v4-11-phone-win-coins.png');

  // --- every level winnable through real touch input at par, no boosters ---
  console.log('\n# Phone: all ' + NLEV + ' levels with taps + swipes, no boosters');
  await seeded(p, null);
  await winAll(p, T, 'phone');
  t = await seeded(p, await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))));
  check(t.open.length === NLEV && t.stars.every(s => s === '\u2605\u2605\u2605'), 'after winning all 23: everything open with 3 stars, coins ' + t.stored.coins);
  await shot(p, 'v4-12-phone-level-select.png');

  /* ----------------------- PROGRESS MIGRATION ----------------------- */
  console.log('\n# Saved-progress migration (seeded localStorage)');
  const v3ids = LV.filter(l => l.mode !== 'scramble').map(l => l.id);
  const starsFor = ids => { const o = {}; ids.forEach(id => { o[id] = 3; }); return o; };
  // A: v3 player who beat the 10 starters + BUS, CAR, PLANET; v3 index 13 = APPLE
  t = await seeded(p, { v: 3, unlocked: 13, stars: starsFor(v3ids.slice(0, 13)), best: { 'lv3-planet': 25 }, sound: true });
  check(same(t.open, range(1, 15)), 'v3 save (beat 1-13 of the old 20): levels 1-15 open = up to APPLE, incl. Scramble 12 (got ' + t.open.join(',') + ')');
  check(t.stars[13] === '\u2605\u2605\u2605' && t.stars[11] === '\u2606\u2606\u2606' && t.current === 15 && t.play === 'Continue', 'stars kept by id (PLANET now level 14); Continue = level 15 (APPLE); Scramble 12 open, unplayed');
  check(t.stored.v === 4 && t.stored.unlocked === 14 && t.stored.unlockedId === 'lv4-apple' && t.stored.coins === 0 && t.stored.best['lv3-planet'] === 25, 'stored as v4: unlocked 14 / unlockedId lv4-apple, coins 0, best moves kept');
  t = await seeded(p, await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))));
  check(same(t.open, range(1, 15)), 'reloading a migrated save does not shift it again');
  // B: v3 player who beat up to BUS: next is the new Scramble level 12
  t = await seeded(p, { v: 3, unlocked: 11, stars: starsFor(v3ids.slice(0, 11)), best: {}, sound: true });
  check(same(t.open, range(1, 13)) && t.current === 12, 'v3 save that beat BUS: levels 1-13 open, Continue = the new Scramble level 12');
  // C: v3 player who finished all 20
  t = await seeded(p, { v: 3, unlocked: 19, stars: starsFor(v3ids), best: {}, sound: true });
  check(t.open.length === NLEV && t.current === 12, 'v3 save with all 20 beaten: all 23 open, Continue = the first unplayed Scramble level (12)');
  // D: v3 starter-only player
  t = await seeded(p, { v: 3, unlocked: 2, stars: { 'st1-cat': 3, 'st2-dog': 3 }, best: {}, sound: true });
  check(same(t.open, [1, 2, 3]) && t.current === 3, 'v3 save (beat starters 1-2): levels 1-3 open, Continue = level 3');
  // E: v2 save (no version): beat BUS, CAR, PLANET
  t = await seeded(p, { unlocked: 3, stars: { 'lv1-bus': 3, 'lv2-car': 2, 'lv3-planet': 1 }, best: {}, sound: true });
  check(same(t.open, range(1, 15)) && t.current === 15, 'v2 save (beat BUS, CAR, PLANET): levels 1-15 open, Continue = APPLE (15)');
  // F: v4 save keeps coins and the seen flag
  t = await seeded(p, v4save({ unlocked: 5, coins: 321, stars: starsFor(v3ids.slice(0, 5)), unlockedId: 'st6-milk', seen: {} }));
  check(same(t.open, range(1, 6)) && t.stored.coins === 321 && (await p.textContent('#title-coins')).trim() === '321', 'v4 save: coins (321) and progress load unchanged');
  await phone.close();

  /* ------------------------------ SMALL PHONE 375x667 ------------------------------ */
  console.log('\n# Small phone 375x667 (touch)');
  const small = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const sp = await small.newPage();
  watch(sp, 'small');
  const ST = { touch: true, cdp: await small.newCDPSession(sp) };
  await seeded(sp, v4save({ coins: 400, stars: starsFor(v3ids.slice(0, 12)) }));
  sel = await fitCheck(sp);
  check(sel.fits && sel.footFits && sel.scroll && sel.minH >= 40, '375x667: all 23 level buttons + footer fit without scrolling (' + sel.rows + ' rows, buttons ' + Math.round(sel.minW) + 'x' + Math.round(sel.minH) + 'px)');
  await shot(sp, 'v4-14-small-phone-375x667-level-select.png');
  for (const n of [17, 22, 23]) {
    await openLevel(sp, n);
    const r = await layoutOk(sp, '375x667 L' + n);
    if (n === 23) await shot(sp, 'v4-13-small-phone-375x667-level23.png');
    check(r.minCar >= 34, '375x667 L' + n + ': cars are >= 34px targets (' + Math.round(r.minCar) + 'px)');
  }
  const sbtn = await sp.evaluate(() => ['btn-shop', 'btn-hint'].map(id => document.getElementById(id).getBoundingClientRect()).every(b => b.bottom <= innerHeight && b.height >= 40));
  check(sbtn, '375x667: coin/booster and hint buttons visible, >= 40px tall');
  await tapEl(sp, ST, '#btn-shop'); await sp.waitForSelector('#ov-shop.show');
  check(await sp.evaluate(() => { const r = document.querySelector('.shop-card').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), '375x667: booster shop sheet fits on screen');
  await small.close();

  /* ------------------------------ DESKTOP ------------------------------ */
  console.log('\n# Desktop 1280x800 (mouse)');
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const d = await desk.newPage();
  watch(d, 'desktop');
  const M = { touch: false };
  t = await seeded(d, null);
  sel = await fitCheck(d);
  check(sel.fits && sel.scroll && t.open.length === 1, 'desktop level select shows all 23 levels without scrolling');
  await d.click('#btn-play'); await d.waitForTimeout(750);
  await layoutOk(d, 'desktop L1');
  await openLevel(d, 3);
  c = await findCar(d, 1, 'slide');
  let pr = await probe(d, c, 1), before = await S(d);
  await inputMove(d, M, c, 1, 'rightclick'); await settle(d);
  let after = await S(d);
  check(after.pos[c] === before.pos[c] - (await d.evaluate(id => window.WJB.session.game.cars[id].sign, c)) * pr.dist, 'desktop: right-click reverses a car');
  await d.keyboard.press('r'); await d.waitForTimeout(300);
  check((await S(d)).moves === 0, 'desktop: R restarts');
  console.log('\n# Desktop: all ' + NLEV + ' levels with clicks + mouse drags, no boosters');
  await winAll(d, M, 'desktop');
  t = await seeded(d, await d.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))));
  await shot(d, 'v4-15-desktop-level-select.png');
  await openLevel(d, 22);
  const sol22 = await d.evaluate(() => window.WJB.solution());
  for (const m of sol22.slice(0, 6)) { await inputMove(d, M, m.car, m.which, m.which === 1 ? 'drag' : 'click'); await settle(d); }
  await shot(d, 'v4-16-desktop-scramble-midplay.png');
  await d.click('#btn-shop'); await d.waitForSelector('#ov-shop.show');
  await d.click('#buy-nudge'); await d.waitForSelector('#shop-confirm.show');
  await shot(d, 'v4-17-desktop-booster-confirm.png');
  await d.click('#btn-confirm'); await d.waitForTimeout(200);
  const dn = await d.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine; for (let i = 0; i < s.game.n; i++) if (s.state.pos[i] >= 0 && E.nudgeTo(s.game, s.state, i, 0) !== null) return i; return -1; });
  const dnb = await S(d);
  await inputMove(d, M, dn, 0, 'click'); await settle(d);
  const dna = await S(d);
  check(dna.pos[dn] === dnb.pos[dn] + (await d.evaluate(id => window.WJB.session.game.cars[id].sign, dn)) && dna.coins === dnb.coins - 60, 'desktop: a click nudges a car exactly one cell forward (60 coins)');
  await desk.close();
  await browser.close();

  console.log('\n# Console / page errors');
  errors.forEach(e => console.log('  ' + e));
  check(errors.length === 0, 'no console errors, page errors or failed requests');
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
