#!/usr/bin/env node
/*
 * Headless browser play-test for Word Jam Bus (Playwright + Chromium).
 *   python3 -m http.server 8765   (in the game folder, or set WJB_URL)
 *   node tests/e2e.js
 * Plays real taps at phone size (390x844, touch, mobile emulation) and
 * desktop size (1280x800, mouse), checks win/lose/dead-end/undo/progress,
 * solves every level through the UI, fails on console errors, and saves
 * screenshots to screenshots/.
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
const idle = page => page.evaluate(() => window.WJB.idle()).then(() => page.waitForTimeout(80));
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name) }).then(() => console.log('  shot screenshots/' + name));
async function carId(page, letter, r, c) {
  return page.evaluate(([l, r, c]) => window.WJB.session.game.cars.find(x => x.l === l && x.r === r && x.c === c).id, [letter, r, c]);
}
async function tapCar(page, id, useTouch) {
  const loc = page.locator('.car[data-id="' + id + '"]');
  if (useTouch) await loc.tap(); else await loc.click();
}
async function openLevel(page, n) {
  await page.goto(URL + '#level-' + n);
  await page.waitForSelector('#screen-game.active');
  await page.waitForTimeout(150);
}
async function layoutOk(page, label) {
  await page.waitForTimeout(700); // let the bus finish pulling in
  const r = await page.evaluate(() => {
    const lot = document.getElementById('lot').getBoundingClientRect();
    const cars = [...document.querySelectorAll('.car')].filter(e => e.style.display !== 'none').map(e => e.getBoundingClientRect());
    const inLot = cars.every(c => c.left >= lot.left - 1 && c.right <= lot.right + 1 && c.top >= lot.top - 1 && c.bottom <= lot.bottom + 1);
    const ids = ['bus', 'lot', 'bay', 'btn-hint', 'btn-restart', 'btn-undo', 'btn-menu'];
    const vis = ids.every(id => { const b = document.getElementById(id).getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight + 1 && b.left >= 0 && b.right <= innerWidth + 1; });
    const minCar = Math.min(...cars.map(c => Math.min(c.width, c.height)));
    return { inLot, vis, minCar, scroll: document.documentElement.scrollHeight <= innerHeight + 1 };
  });
  check(r.inLot && r.vis && r.scroll, label + ': lot, bus, bay and buttons fit the viewport without scrolling');
  return r;
}

(async () => {
  const browser = await chromium.launch();

  /* ------------------------- PHONE ------------------------- */
  console.log('\n# Phone 390x844 (touch, isMobile)');
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  });
  const p = await phone.newPage();
  watch(p, 'phone');
  await p.goto(URL);
  await p.evaluate(() => localStorage.clear());
  await p.reload();
  await p.waitForSelector('#screen-title.active');
  check(await p.locator('.lvl').count() === 10, '10 levels listed on title screen');
  check(await p.locator('.lvl.locked').count() === 9, 'only level 1 unlocked on a fresh save');
  const meta = await p.getAttribute('meta[name=viewport]', 'content');
  check(/width=device-width/.test(meta) && /user-scalable=no/.test(meta), 'viewport meta set (no zoom)');
  check(await p.evaluate(() => getComputedStyle(document.body).touchAction) === 'manipulation', 'touch-action: manipulation (no double-tap zoom)');
  await shot(p, '01-phone-title.png');

  await p.locator('#btn-play').tap();
  await p.waitForSelector('#screen-game.active');
  await p.waitForTimeout(200);
  check((await p.textContent('#hud-level')).includes('Level 1'), 'Play opens level 1');
  await layoutOk(p, 'phone L1');
  await shot(p, '02-phone-level1-start.png');

  // Level 1 BUS: U@r3c3 is blocked by S@r2c3.
  const U = await carId(p, 'U', 3, 3), S = await carId(p, 'S', 2, 3), B = await carId(p, 'B', 4, 2);
  await tapCar(p, U, true);
  await p.waitForTimeout(120);
  check(await p.locator('.car[data-id="' + U + '"]').evaluate(e => /bump-/.test(e.className)), 'blocked tap: car bumps (shake class)');
  check(await p.locator('#toast.show').count() === 1, 'blocked tap: "Blocked!" toast shown');
  check(await p.evaluate(() => window.WJB.session.state.moves) === 0, 'blocked tap does not cost a move');
  await idle(p);
  await tapCar(p, B, true); await idle(p);
  check(await p.locator('.tile.filled').count() === 1, 'B fills the first seat');
  await tapCar(p, S, true); await idle(p);
  check(await p.locator('.slot.full').count() === 1 && (await p.textContent('.slot.full')) === 'S', 'S (not next) parks in the holding bay');
  await p.waitForTimeout(300);
  await shot(p, '03-phone-mid-play.png');
  await tapCar(p, U, true); await idle(p);
  await p.waitForSelector('#ov-win.show', { timeout: 4000 });
  check(await p.locator('.tile.filled').count() === 3, 'U fills, S auto-fills from bay: BUS complete');
  check(await p.locator('.slot.full').count() === 0, 'bay emptied by auto-fill');
  check(await p.getAttribute('#win-stars', 'data-stars') === '3', 'win screen shows 3 stars at par');
  await p.waitForTimeout(500);
  await shot(p, '04-phone-win.png');
  const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1')));
  check(saved && saved.unlocked >= 1 && saved.stars['ex1-bus'] === 3, 'progress saved to localStorage (level 2 unlocked, 3 stars)');
  await p.locator('#btn-next').tap();
  await p.waitForTimeout(200);
  check((await p.textContent('#hud-level')).includes('Level 2'), 'Next level button opens level 2');
  await p.reload();
  await p.goto(URL);
  await p.waitForSelector('#screen-title.active');
  check(await p.locator('.lvl.locked').count() === 8, 'after reload, level select shows level 2 unlocked');

  // Lose: level 3 PLANET (bay 5). Park O, L, S, T, E (bay full), then N (not next) overflows.
  await openLevel(p, 3);
  for (const [l, r, c] of [['O', 1, 3], ['L', 2, 4], ['S', 2, 3], ['T', 3, 2], ['E', 4, 2]]) {
    await tapCar(p, await carId(p, l, r, c), true); await idle(p);
  }
  check(await p.locator('.slot.full').count() === 5, 'bay holds 5 parked letters');
  check(await p.locator('#bay.danger').count() === 1, 'full bay is shown in red');
  await tapCar(p, await carId(p, 'N', 4, 4), true); await idle(p);
  await p.waitForSelector('#ov-lose.show', { timeout: 4000 });
  check((await p.textContent('#lose-title')).includes('Bay full'), 'lose screen: "Bay full!"');
  await p.waitForTimeout(400);
  await shot(p, '05-phone-lose.png');
  await p.locator('#btn-retry').tap();
  await p.waitForTimeout(200);
  check(await p.evaluate(() => window.WJB.session.state.moves === 0 && !window.WJB.session.ended), 'Retry restarts the level');

  // Rule check: a car that fills the word never loses even with a full bay (PLANET: P is next).
  for (const [l, r, c] of [['O', 1, 3], ['L', 2, 4], ['S', 2, 3], ['T', 3, 2], ['E', 4, 2]]) {
    await tapCar(p, await carId(p, l, r, c), true); await idle(p);
  }
  await tapCar(p, await carId(p, 'P', 3, 3), true); await idle(p);
  check(await p.locator('#ov-lose.show').count() === 0 && await p.locator('.tile.filled').count() === 2, 'full bay + correct letter: fills (P, then L auto-fills), no loss');

  // Dead end + undo: ROCKET (bay 3), tapping E first makes it unwinnable.
  await openLevel(p, 6);
  await tapCar(p, await carId(p, 'E', 5, 3), true); await idle(p);
  check(await p.locator('#deadend.show').count() === 1, 'dead-end banner after a losing first tap');
  await shot(p, '07-phone-dead-end.png');
  await p.locator('#btn-dead-undo').tap(); await p.waitForTimeout(200);
  check(await p.evaluate(() => window.WJB.session.state.moves === 0 && window.WJB.session.undos === 2), 'Undo reverts the move and uses one undo charge');
  check(await p.locator('#deadend.show').count() === 0 && await p.locator('.slot.full').count() === 0, 'dead-end cleared, bay empty after undo');
  // Hint highlights a car
  await p.locator('#btn-hint').tap(); await p.waitForTimeout(100);
  check(await p.locator('.car.hint').count() === 1, 'Hint highlights the next optimal car');

  // Harder later level on phone (level 10, 7x7) + two-word/wildcard level 9 mid-play.
  await openLevel(p, 10);
  const L10 = await layoutOk(p, 'phone L10 (7x7)');
  check(L10.minCar >= 40, 'phone 7x7 cars are at least 40px tap targets (' + Math.round(L10.minCar) + 'px)');
  await shot(p, '06-phone-level10-start.png');
  await openLevel(p, 9);
  const sol9 = await p.evaluate(() => window.WJB.solution());
  for (const id of sol9.slice(0, 4)) { await tapCar(p, id, true); await idle(p); }
  check(await p.locator('.tile.filled.wild').count() === 1, 'wildcard taxi fills a seat (shown as wild)');
  await p.waitForTimeout(300);
  await shot(p, '08-phone-level9-midplay.png');

  // Solve EVERY level through the UI with touch taps, using the in-game solver's path.
  console.log('\n# Solving all levels via phone taps');
  for (let n = 1; n <= 10; n++) {
    await openLevel(p, n);
    const sol = await p.evaluate(() => window.WJB.solution());
    for (const id of sol) { await tapCar(p, id, true); await idle(p); }
    await p.waitForSelector('#ov-win.show', { timeout: 5000 }).catch(() => {});
    const won = await p.locator('#ov-win.show').count() === 1;
    const st = await p.getAttribute('#win-stars', 'data-stars');
    check(won && st === '3', 'level ' + n + ' won in ' + sol.length + ' taps with 3 stars');
    if (n === 10) { await p.waitForTimeout(400); await shot(p, '09-phone-level10-win.png'); }
  }
  await phone.close();

  /* ------------------------- DESKTOP ------------------------- */
  console.log('\n# Desktop 1280x800 (mouse)');
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const d = await desk.newPage();
  watch(d, 'desktop');
  await d.goto(URL);
  await d.evaluate(() => localStorage.clear());
  await d.reload();
  await d.waitForSelector('#screen-title.active');
  await shot(d, '10-desktop-title.png');
  await d.click('#btn-play');
  await d.waitForTimeout(200);
  for (const id of await d.evaluate(() => window.WJB.solution())) { await tapCar(d, id, false); await idle(d); }
  await d.waitForSelector('#ov-win.show', { timeout: 4000 });
  check(true, 'desktop: level 1 solved with mouse clicks');
  await openLevel(d, 7);
  await layoutOk(d, 'desktop L7');
  const sol7 = await d.evaluate(() => window.WJB.solution());
  for (const id of sol7.slice(0, 4)) { await tapCar(d, id, false); await idle(d); }
  await d.waitForTimeout(300);
  await shot(d, '11-desktop-level7-midplay.png');
  // keyboard restart
  await d.keyboard.press('r'); await d.waitForTimeout(150);
  check(await d.evaluate(() => window.WJB.session.state.moves) === 0, 'desktop: R key restarts');
  await desk.close();
  await browser.close();

  console.log('\n# Console / page errors');
  if (errors.length) errors.forEach(e => console.log('  ' + e));
  check(errors.length === 0, 'no console errors, page errors or failed requests');
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
