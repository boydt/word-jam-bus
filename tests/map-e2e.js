#!/usr/bin/env node
/*
 * v8 city route map e2e for Word Jam Bus (real input: touch taps at 390x844 and 375x667, mouse at 1280x800).
 *   python3 -m http.server 8765   (in the game folder, or set WJB_URL)
 *   node tests/map-e2e.js
 * Covers: map render (districts, stops, icons, headers, sizes, no overflow), tapping a stop to play,
 * district lock / unlock (gate), the bus drive ending at the right stop (after a win, on return to
 * the map, on a tap), the boss -> chest flow, a chest opening once and granting coins / boosters /
 * paint, the free-booster inventory (badge, used before coins, refunded on Undo, 2-star cap),
 * cheats (unlock all: everything open, bus anywhere; chests only preview; real save byte-identical),
 * migration of older saves (right stop, catch-up chests claimable once), reduced motion, #map.
 * Writes the v8-* screenshots.
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
function check(cond, msg) { if (cond) { passes++; console.log('  PASS ' + msg); } else { failures++; console.log('  FAIL ' + msg); } }
function watch(page, label) {
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(label + ' console.' + m.type() + ': ' + m.text()); });
  page.on('pageerror', e => errors.push(label + ' pageerror: ' + e.message));
  page.on('requestfailed', r => errors.push(label + ' requestfailed: ' + r.url()));
}
const shot = (page, name, opts) => page.screenshot(Object.assign({ path: path.join(SHOTS, name) }, opts || {})).then(() => console.log('  shot screenshots/' + name));
const settle = async page => { await page.evaluate(() => window.WJB.idle()); await page.waitForTimeout(240); };
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const LVS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'levels.json'), 'utf8')).levels;
const MAP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'districts.json'), 'utf8'));
const NLEV = LVS.length, D = MAP.districts;
const SCR = LVS.map((l, i) => l.mode === 'scramble' ? i + 1 : 0).filter(Boolean);
const KEYS = LVS.map((l, i) => l.cars.some(c => c.lock) ? i + 1 : 0).filter(Boolean);
const idx = id => LVS.findIndex(l => l.id === id);
const FIRST = D.map(d => idx(d.levels[0]) + 1), BOSS = D.map(d => idx(d.boss) + 1);
const KEY = 'wordJamBus.progress.v1', TKEY = 'wordJamBus.test.v1';
// v9: Main Street (10 normal levels) sits at stops 11-20; the v8 stops 11-28 moved up by 10
const DK = id => D.findIndex(d => d.id === id), MSK = DK('mainst'), BEACH = DK('beach');
const NORMAL = LVS.map((l, i) => l.tier === 'normal' ? i + 1 : 0).filter(Boolean);
const AT = id => idx(id) + 1;
const V8 = ['st1-cat', 'st2-dog', 'st3-sun', 'st4-hat', 'st5-fish', 'st6-milk', 'st7-frog', 'st8-train', 'st9-tiger', 'st10-house', 'lv1-bus', 'sc1-pizza', 'lv2-car', 'lv3-planet',
  'lv4-apple', 'lv5-garden', 'sc2-jungle', 'lv6-rocket', 'lv7-ticket', 'lv8-mother', 'lv9-busstop', 'sc3-dragons', 'lv10-school', 'dt1-bank', 'dt2-hotel', 'dt3-market', 'sc4-subway', 'dt4-square']
  .map(id => LVS.find(l => l.id === id));   // the 28 levels a v8 save knew, in v8 order
/** A save from before v9: won the first n of the v8 levels (no Main Street stars). */
const wonV8 = (n, extra) => { const st = {}, be = {}; V8.slice(0, n).forEach(l => { st[l.id] = 3; be[l.id] = l.par; });
  const next = V8[Math.min(n, V8.length - 1)];
  return Object.assign({ v: 4, unlocked: Math.min(n, V8.length - 1), unlockedId: next.id, stars: st, best: be, sound: false, coins: 0, seen: { scramble: true } }, extra || {}); };
const CLOSED = Array(D.length - 1).fill(false), ALL_LOCKED = Array(D.length).fill('locked');
/** A v4 save that has won the first n levels (3 stars each, at par). */
const won = (n, extra) => { const st = {}, be = {}; LVS.slice(0, n).forEach(l => { st[l.id] = 3; be[l.id] = l.par; });
  return Object.assign({ v: 4, unlocked: Math.min(n, NLEV - 1), unlockedId: LVS[Math.min(n, NLEV - 1)].id, stars: st, best: be, sound: false, coins: 0, seen: { scramble: true } }, extra || {}); };

async function tapEl(page, ctx, sel) {
  const loc = page.locator(sel).first();
  await loc.scrollIntoViewIfNeeded();
  const b = await loc.boundingBox();
  if (ctx.touch) await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2); else await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
}
async function inputMove(page, ctx, car, which) {
  const info = await page.evaluate(id => { const g = window.WJB.session.game, c = g.cars[id], r = document.querySelector('.car[data-id="' + id + '"]').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, horiz: c.horiz, sign: c.sign, cell: r.width / (c.horiz ? c.len : 1) }; }, car);
  if (which === 0) { if (ctx.touch) await page.touchscreen.tap(info.x, info.y); else await page.mouse.click(info.x, info.y); return; }
  if (!ctx.touch) { await page.mouse.click(info.x, info.y, { button: 'right' }); return; }
  const d = Math.max(28, info.cell * 0.7) * -info.sign, tx = info.x + (info.horiz ? d : 0), ty = info.y + (info.horiz ? 0 : d);
  await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: info.x, y: info.y }] });
  for (let k = 1; k <= 4; k++) await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: info.x + (tx - info.x) * k / 4, y: info.y + (ty - info.y) * k / 4 }] });
  await ctx.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function dismissCoach(page) { if (await page.locator('#ov-coach.show').count()) { await page.locator('#btn-coach').click(); await page.waitForTimeout(250); } }
/** Win the level on screen with real input along the optimal line. */
async function solve(page, ctx) {
  await dismissCoach(page);
  for (const m of await page.evaluate(() => window.WJB.solution())) { await inputMove(page, ctx, m.car, m.which); await settle(page); }
  await page.waitForSelector('#ov-win.show', { timeout: 8000 }).catch(() => {});
  return page.locator('#ov-win.show').count().then(n => n === 1);
}
/** Fresh page state: a save (or none) + test options (or none), then the title screen. */
async function boot(page, save, test, hash) {
  await page.goto(URL);
  await page.evaluate(([sv, ts, K, TK]) => { localStorage.clear(); if (sv) localStorage.setItem(K, JSON.stringify(sv)); if (ts) localStorage.setItem(TK, JSON.stringify(ts)); }, [save, test, KEY, TKEY]);
  await page.goto(URL + (hash || '')); await page.reload();
  await page.waitForTimeout(350);
}
const stored = page => page.evaluate(K => JSON.parse(localStorage.getItem(K)), KEY);
const rawSave = page => page.evaluate(K => localStorage.getItem(K), KEY);
const mapOpen = page => page.waitForSelector('#screen-map.active', { timeout: 4000 });
const notDriving = page => page.waitForFunction(() => !window.WJB.map.driving, null, { timeout: 6000 });
/** Bus: which node it is parked at, and how far its drawn position is from that stop's parking point. */
const busInfo = page => page.evaluate(() => {
  const m = window.WJB.map, bus = document.getElementById('map-bus'), tr = new DOMMatrixReadOnly(getComputedStyle(bus).transform);
  const at = bus.getAttribute('data-at'), n = m.busNode, pp = n === null ? null : m.parkPoint(n);
  return { at, n, x: tr.m41, y: tr.m42, off: pp ? Math.hypot(tr.m41 - pp.x, tr.m42 - pp.y) : 99, driving: m.driving, inView: (() => { const r = bus.getBoundingClientRect(), s = document.getElementById('map-scroll').getBoundingClientRect(); return r.top >= s.top - 4 && r.bottom <= s.bottom + 4; })() };
});
/** Layout facts of the map at this viewport. */
const mapFacts = page => page.evaluate(() => {
  const R = e => e.getBoundingClientRect(), sc = document.getElementById('map-scroll');
  const stops = [...document.querySelectorAll('.lvl.stop')], chests = [...document.querySelectorAll('.chest-node')];
  const heads = [...document.querySelectorAll('.d-head')], foot = ['btn-map-play', 'btn-map-home'].map(id => R(document.getElementById(id)));
  const cur = document.querySelector('.lvl.stop.current'), cr = cur && R(cur), sr = R(sc);
  return {
    stops: stops.length, chests: chests.length, secs: document.querySelectorAll('.d-sec').length,
    minStop: Math.round(Math.min(...stops.map(b => Math.min(R(b).width, R(b).height)))), minChest: Math.round(Math.min(...chests.map(b => Math.min(R(b).width, R(b).height)))),
    stopsInside: stops.concat(chests).every(b => { const r = R(b), w = R(document.getElementById('map-world')); return r.left >= w.left - 1 && r.right <= w.right + 1; }),
    noHScroll: sc.scrollWidth <= sc.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
    head: heads.length && (() => { const h = heads.find(x => R(x).bottom > sr.top + 10 && R(x).top < sr.top + 10) || heads[0]; const r = R(h); return { top: Math.round(r.top - sr.top), h: Math.round(r.height), left: r.left >= 0, right: r.right <= innerWidth + 1, text: h.textContent }; })(),
    footOk: foot.every(r => r.height >= 44 && r.bottom <= innerHeight + 1 && r.top >= 0),
    current: cur ? +cur.getAttribute('data-level') : 0, currentInView: !!cr && cr.top >= sr.top + 70 && cr.bottom <= sr.bottom,
    worldW: Math.round(R(document.getElementById('map-world')).width), worldL: Math.round(R(document.getElementById('map-world')).left),
    open: stops.filter(b => !b.disabled).map(b => +b.getAttribute('data-level')), cheat: stops.filter(b => b.classList.contains('cheat')).map(b => +b.getAttribute('data-level')),
    lockedSecs: [...document.querySelectorAll('.d-sec.locked')].map(s => s.getAttribute('data-district')),
    gatesOpen: [...document.querySelectorAll('.gate')].map(g => g.classList.contains('open')),
    chestStates: chests.map(c => [...c.classList].find(k => k.startsWith('cs-')).slice(3))
  };
});
const scrollToDistrict = (page, k) => page.evaluate(k => { const s = document.querySelectorAll('.d-sec')[k]; document.getElementById('map-scroll').scrollTop = s.offsetTop; }, k);

async function mapBasics(page, ctx, label) {
  await boot(page, null);
  await tapEl(page, ctx, '#btn-play'); await mapOpen(page); await page.waitForTimeout(500);
  const f = await mapFacts(page);
  check(f.stops === NLEV && f.chests === D.length && f.secs === D.length, label + ': Play opens the city map: ' + f.secs + ' districts, ' + f.stops + ' stops, ' + f.chests + ' chests');
  check(f.minStop >= 44 && f.minChest >= 44 && f.footOk, label + ': stops (' + f.minStop + 'px), chests (' + f.minChest + 'px) and the foot buttons are >= 44px targets');
  check(f.noHScroll && f.stopsInside && f.head.left && f.head.right, label + ': no horizontal overflow; every stop and chest inside the map (map ' + f.worldW + 'px wide)');
  check(f.head.top <= 2 && f.head.h >= 60 && /School Street/.test(f.head.text) && /0\/18/.test(f.head.text), label + ': sticky district header at the top with name and progress ("' + f.head.text.replace(/\s+/g, ' ').trim().slice(0, 60) + '")');
  check(f.current === 1 && f.currentInView && same(f.open, [1]), label + ': fresh save: stop 1 is current and in view (auto-scroll); only stop 1 open');
  check(same(f.lockedSecs, D.slice(1).map(d => d.id)) && same(f.gatesOpen, CLOSED) && same(f.chestStates, ALL_LOCKED), label + ': districts 2-' + D.length + ' locked behind closed gates; all chests locked');
  return f;
}

(async () => {
  const browser = await chromium.launch();

  /* ------------------------------ PHONE 390x844 ------------------------------ */
  console.log('\n# Phone 390x844 (touch): the city map');
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const p = await phone.newPage(); watch(p, 'phone');
  const T = { touch: true, cdp: await phone.newCDPSession(p) };
  await mapBasics(p, T, 'phone');
  const icons = await p.evaluate(() => ({ scr: [...document.querySelectorAll('.lvl.stop.scr')].filter(b => b.querySelector('.lvl-scr')).map(b => +b.getAttribute('data-level')),
    keys: [...document.querySelectorAll('.lvl.stop.keys')].filter(b => b.querySelector('.lvl-key svg')).map(b => +b.getAttribute('data-level')),
    boss: [...document.querySelectorAll('.lvl.stop.boss')].filter(b => /BOSS/.test(b.querySelector('.boss-tag').textContent)).map(b => +b.getAttribute('data-level')),
    themes: [...document.querySelectorAll('.d-sec')].map(s => [...s.classList].find(k => k.startsWith('th-'))) }));
  check(same(icons.scr, SCR) && same(icons.keys, KEYS) && same(icons.boss, BOSS), 'stops: Scramble icon on ' + SCR.join(',') + '; key icon on ' + KEYS.join(',') + '; BOSS tag on ' + BOSS.join(','));
  check(same(icons.themes, D.map(d => 'th-' + d.theme)), 'each district has its own theme (' + icons.themes.join(', ') + ')');
  // a locked stop does nothing; tapping stop 1 plays it
  await p.evaluate(() => { document.getElementById('map-scroll').scrollTop = 0; });
  check(await p.locator('.lvl[data-level="2"]').isDisabled(), 'locked stop 2 is disabled (not tappable)');
  await tapEl(p, T, '.lvl[data-level="1"]'); await p.waitForSelector('#screen-game.active', { timeout: 4000 });
  check((await p.textContent('#hud-level')).trim() === 'Level 1 of ' + NLEV, 'tapping stop 1 on the map plays level 1');
  check(await solve(p, T), 'level 1 won by real input');
  check(/School Street/.test(await p.textContent('#win-district')) && /stop 1 of 6/.test(await p.textContent('#win-district')) && (await p.textContent('#btn-next')).trim() === 'Next stop', 'win card: "School Street · stop 1 of 6", button "Next stop"');
  // after a win the bus drives on to the next stop, then that level starts
  await tapEl(p, T, '#btn-next'); await mapOpen(p);
  await p.waitForFunction(() => window.WJB.map.driving && window.WJB.map.driving.t > 0.3, null, { timeout: 3000 }).catch(() => {});
  let bi = await busInfo(p);
  check(bi.driving && bi.driving.to === LVS[1].id, 'Next stop: back on the map the bus is driving from stop 1 to stop 2 (' + JSON.stringify(bi.driving) + ')');
  await p.waitForSelector('#screen-game.active', { timeout: 5000 });
  check((await p.textContent('#hud-level')).trim() === 'Level 2 of ' + NLEV && (await stored(p)).busAt === LVS[1].id, '...it parks at stop 2 and level 2 starts by itself (busAt saved: ' + (await stored(p)).busAt + ')');
  // back to the map from a level: the bus drives from the last stop played to the next
  await boot(p, won(4));
  await p.goto(URL + '#level-2'); await p.waitForSelector('#screen-game.active'); await p.waitForTimeout(500);
  await tapEl(p, T, '#btn-menu'); await mapOpen(p);
  await p.waitForFunction(() => window.WJB.map.driving && window.WJB.map.driving.t > 0.25, null, { timeout: 3000 }).catch(() => {});
  bi = await busInfo(p);
  const midT = bi.driving ? bi.driving.t : 0;
  await shot(p, 'v8-bus-mid-drive.png');
  check(bi.driving && bi.driving.to === LVS[4].id && midT > 0 && midT < 1, 'HUD map button after replaying stop 2: the bus drives from stop 2 on to the current stop 5 (t=' + midT.toFixed(2) + ')');
  await notDriving(p); await p.waitForTimeout(200);
  bi = await busInfo(p);
  check(bi.at === LVS[4].id && bi.off < 2 && bi.inView && !(await p.locator('#screen-game.active').count()), 'the drive ends parked at stop 5 (' + bi.off.toFixed(1) + 'px from its spot, in view); no auto-start without a win');
  check(await p.evaluate(() => { const b = document.getElementById('map-bus'); return /translate/.test(b.style.transform) && b.style.left === '' && b.style.top === ''; }), 'the bus moves by transform only (translate + rotate)');
  // tap a stop further on: the bus drives there first, then the level starts; tap it again to skip
  await tapEl(p, T, '.lvl[data-level="3"]');
  await p.waitForFunction(() => window.WJB.map.driving, null, { timeout: 2000 }).catch(() => {});
  const goingTo = (await busInfo(p)).driving;
  await tapEl(p, T, '.lvl[data-level="3"]');
  await p.waitForSelector('#screen-game.active', { timeout: 3000 });
  check(goingTo && goingTo.to === LVS[2].id && (await p.textContent('#hud-level')).trim() === 'Level 3 of ' + NLEV, 'tapping stop 3: the bus drives back to it (a second tap skips the drive), then level 3 starts');

  // the boss lot -> chest -> gate -> next district
  console.log('\n# Boss, chest, gate, next district');
  await boot(p, won(BOSS[0] - 1, { coins: 50 }));
  await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
  let f = await mapFacts(p);
  check(f.current === BOSS[0] && /Play the boss lot/.test(await p.textContent('#btn-map-play')), 'stops 1-5 won: the current stop is the School Street boss (6); foot says "Play the boss lot"');
  await tapEl(p, T, '#btn-map-play'); await p.waitForSelector('#screen-game.active', { timeout: 4000 });
  check(await solve(p, T), 'boss lot 6 won by real input');
  check(/School Street complete/.test(await p.textContent('#win-district')) && (await p.textContent('#btn-next')).trim() === 'Open the chest!', 'boss win: "School Street complete!", button "Open the chest!"');
  const coinsBefore = (await stored(p)).coins;
  await tapEl(p, T, '#btn-next'); await mapOpen(p);
  await p.waitForSelector('#ov-chest.show', { timeout: 5000 });
  bi = await busInfo(p);
  check(bi.at === 'chest:school' && await p.locator('#ov-chest.closed').count() === 1, 'the bus drives on to the district chest and it pops up, closed');
  await shot(p, 'v8-chest-closed.png');
  await tapEl(p, T, '#chest-big');
  await p.waitForTimeout(420);
  check(await p.locator('#ov-chest.opening').count() === 1, 'tap the chest: it rattles open');
  await shot(p, 'v8-chest-opening.png');
  let sv = await stored(p);
  check(sv.chests.school === true && sv.coins === coinsBefore + 100 && sv.inv.nudge === 1 && sv.inv.tow === 1, 'claimed (and saved) once, at the start of the opening: +100 coins, Nudge x1, Tow x1 into the inventory');
  await p.waitForSelector('#ov-chest.open', { timeout: 3000 }); await p.waitForTimeout(900);
  const rw = await p.evaluate(() => [...document.querySelectorAll('#chest-rewards .reward')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(rw.length === 3 && /\+100/.test(rw[0]) && /Nudge/.test(rw.join()) && /Tow/.test(rw.join()), 'rewards shown: ' + rw.join(' | '));
  await shot(p, 'v8-chest-rewards.png');
  await tapEl(p, T, '#btn-chest-collect');
  await p.waitForFunction(() => window.WJB.map.driving, null, { timeout: 2500 }).catch(() => {});
  await page_wait_gate(p);
  await notDriving(p); await p.waitForTimeout(300);
  bi = await busInfo(p); f = await mapFacts(p); sv = await stored(p);
  check(bi.at === LVS[FIRST[1] - 1].id && f.gatesOpen[0] && !f.lockedSecs.includes('suburbs') && sv.seen['gate-suburbs'] === true, 'Collect: the gate barrier lifts and the bus drives into Maple Suburbs, parking at stop ' + FIRST[1]);
  check(f.chestStates[0] === 'claimed' && /Opened/.test(await p.textContent('.d-sec[data-district="school"] .dh-chest')), 'School Street chest now shows as opened (map + header chip)');
  await tapEl(p, T, '.chest-node[data-chest="0"]'); await p.waitForTimeout(400);
  check(await p.locator('#ov-chest.show').count() === 0 && /Already opened/.test(await p.textContent('#toast')) && (await stored(p)).coins === coinsBefore + 100, 'tapping the opened chest again: "Already opened", nothing granted twice');
  await p.reload(); await mapOpen(p); await notDriving(p);
  check((await mapFacts(p)).chestStates[0] === 'claimed' && await p.locator('#btn-map-chest').isHidden(), 'after a reload (#map opens the map) the chest stays claimed (no "Chest to open" button)');
  const locked = await p.evaluate(() => [...document.querySelectorAll('.d-sec')].map(s => ({ id: s.getAttribute('data-district'), locked: s.classList.contains('locked'), txt: s.querySelector('.dh-intro').textContent })));
  check(locked[MSK].locked && new RegExp('Win stop ' + BOSS[MSK - 1] + ' ').test(locked[MSK].txt) && locked[BEACH].locked && new RegExp('Win stop ' + BOSS[BEACH - 1] + ' ').test(locked[BEACH].txt),
    'Main Street and Sunny Beach still locked: "' + locked[MSK].txt.trim() + '", "' + locked[BEACH].txt.trim() + '"');
  await scrollToDistrict(p, 2); await p.waitForTimeout(200);
  await shot(p, 'v8-district-locked.png');
  await tapEl(p, T, '.chest-node[data-chest="2"]'); await p.waitForTimeout(300);
  check(await p.locator('#ov-chest.show').count() === 0 && /Beat the boss lot/.test(await p.textContent('#toast')), 'a locked chest only explains how to earn it');

  // the free-booster inventory: badge, used before coins, refunded to the inventory on Undo, 2-star cap
  console.log('\n# Free-booster inventory');
  await p.goto(URL + '#level-' + FIRST[1]); await p.reload(); await p.waitForSelector('#screen-game.active'); await p.waitForTimeout(600); await dismissCoach(p);
  let bar = await p.evaluate(() => ['tow', 'bay', 'nudge', 'flip'].map(k => { const b = document.getElementById('bst-' + k), ib = b.querySelector('.inv-badge'); return { k, badge: ib.hidden ? '' : ib.textContent, price: b.querySelector('.bst-price').textContent.trim() }; }));
  check(bar[0].badge === '1' && bar[2].badge === '1' && bar[0].price === 'Free' && bar[1].badge === '' && /\d/.test(bar[1].price), 'booster bar: Tow and Nudge show a "1" badge and "Free"; Bay +1 still shows its coin price');
  await p.evaluate(() => { const r = document.querySelector('.foot').getBoundingClientRect(); window.scrollTo(0, 0); return r; });
  await shot(p, 'v8-booster-inventory-badge.png', { clip: await p.evaluate(() => { const r = document.querySelector('.foot').getBoundingClientRect(); return { x: 0, y: Math.max(0, r.top - 8), width: innerWidth, height: Math.min(innerHeight, r.bottom + 4) - Math.max(0, r.top - 8) }; }) });
  const c0 = (await stored(p)).coins;
  await tapEl(p, T, '#bst-nudge'); await p.waitForSelector('#ov-shop.show'); await p.waitForTimeout(300);
  check(/Use a free Nudge\?/.test(await p.textContent('#confirm-title')) && /1 left/.test(await p.textContent('#btn-confirm')), 'confirm: "Use a free Nudge?" (1 left), no coin price');
  await tapEl(p, T, '#btn-confirm'); await p.waitForTimeout(250);
  const nf = await p.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine; for (let i = 0; i < s.game.n; i++) if (s.state.pos[i] >= 0 && E.nudgeTo(s.game, s.state, i, 0) !== null) return i; return -1; });
  await inputMove(p, T, nf, 0); await settle(p);
  sv = await stored(p);
  check(sv.inv.nudge === 0 && sv.coins === c0 && await p.evaluate(() => window.WJB.session.state.used.nudge) === 1 && await p.locator('#bst-nudge .inv-badge').isHidden(), 'the free Nudge is used before coins: inventory 1 -> 0, coins unchanged (' + c0 + '), badge gone');
  await tapEl(p, T, '#btn-undo'); await settle(p);
  sv = await stored(p);
  check(sv.inv.nudge === 1 && sv.coins === c0 && /free Nudge back/.test(await p.textContent('#toast')) && (await p.textContent('#bst-nudge .inv-badge')).trim() === '1', 'Undo gives the free Nudge back to the inventory ("Undo · free Nudge back"), coins still ' + c0);
  await tapEl(p, T, '#bst-tow'); await p.waitForSelector('#ov-shop.show'); await p.waitForTimeout(300); await tapEl(p, T, '#btn-confirm'); await p.waitForTimeout(250);
  const tw = await p.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine; let best = -1, bp = 99; for (let i = 0; i < s.game.n; i++) { if (s.state.pos[i] < 0) continue; const st = E.applyBooster(s.game, s.state, 'tow', i); const q = st && E.solve(s.game, st).par; if (q !== null && q !== undefined && q < bp) { bp = q; best = i; } } return best; });
  await inputMove(p, T, tw, 0); await settle(p);
  check((await stored(p)).inv.tow === 0 && (await stored(p)).coins === c0, 'a free Tow used (inventory 1 -> 0, no coins spent)');
  check(await solve(p, T), 'level won after the free Tow');
  check(+(await p.getAttribute('#win-stars', 'data-stars')) <= 2, 'free boosters follow the same rule as bought ones: at most 2 stars (' + (await p.getAttribute('#win-stars', 'data-stars')) + ')');
  // coins again once the inventory is empty
  await p.goto(URL + '#level-' + FIRST[1]); await p.reload(); await p.waitForSelector('#screen-game.active'); await p.waitForTimeout(600); await dismissCoach(p);
  check(await p.locator('#bst-tow .inv-badge').isHidden() && /\d/.test(await p.textContent('#bst-tow .bst-price')), 'inventory empty: Tow shows its coin price again');

  // paints from chests
  console.log('\n# Chest paint + catch-up chests (migration)');
  await boot(p, wonV8(11, { coins: 120 }));   // a v8 save that beat the old districts 1 and 2 (starters + BUS; no chests field)
  const tr = await p.textContent('#title-route');
  check(/2 chests to open/.test(tr) && /Sunny Beach/.test(tr) && /New: Main Street, 10 new stops!/.test(tr), 'migrated v8 save (won 1-10 + BUS): title says Sunny Beach, "2 chests to open on the map!" and "New: Main Street, 10 new stops!"');
  await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
  f = await mapFacts(p); bi = await busInfo(p);
  check(bi.at === 'lv2-car' && f.current === AT('lv2-car') && same(f.lockedSecs, ['harbor', 'downtown']) && same(f.chestStates, ['ready', 'ready', 'locked', 'locked', 'locked', 'locked']),
    'map: the v8 save waited at PIZZA (now stop ' + AT('sc1-pizza') + ' in Main Street), so the bus goes on to stop ' + AT('lv2-car') + ' (CAR, Sunny Beach); School Street and Maple Suburbs (boss now HOUSE) chests ready; the Main Street chest locked until its boss is won (bus at ' + bi.at + ')');
  check(NORMAL.every(n => f.open.includes(n)) && /New: 10 new stops!/.test(await p.textContent('.d-sec[data-district="mainst"] .dh-intro')), 'v9: Main Street is open to a player past BUS (offered, not forced): its header says "New: 10 new stops! ..."');
  check(/2 chests to open/.test(await p.textContent('#btn-map-chest')) && await p.locator('#btn-map-chest').isVisible(), 'foot button: "2 chests to open!"');
  await tapEl(p, T, '#btn-map-chest'); await p.waitForSelector('#ov-chest.show'); await tapEl(p, T, '#chest-big'); await p.waitForSelector('#ov-chest.open', { timeout: 3000 }); await p.waitForTimeout(500);
  await tapEl(p, T, '#btn-chest-collect'); await p.waitForTimeout(300);
  check(/1 chest/.test(await p.textContent('#btn-map-chest')) || /Chest to open/.test(await p.textContent('#btn-map-chest')), 'one claimed, one left');
  await tapEl(p, T, '#btn-map-chest'); await p.waitForSelector('#ov-chest.show'); await tapEl(p, T, '#btn-chest-open'); await p.waitForSelector('#ov-chest.open', { timeout: 3000 }); await p.waitForTimeout(500);
  sv = await stored(p);
  const paint = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bus').trim());
  check(sv.chests.school && sv.chests.suburbs && sv.coins === 120 + 100 + 150 && sv.inv.tow === 1 && sv.inv.nudge === 1 && sv.inv.bay === 1 && sv.inv.flip === 1, 'both catch-up chests claimed once: 370 coins, Tow/Nudge/Bay +1/Flip x1 each');
  check(sv.paints.includes('maple') && sv.paint === 'maple' && paint.toLowerCase() === '#ec5a3c', 'the Maple Red paint is unlocked and the bus wears it (--bus ' + paint + ')');
  await tapEl(p, T, '#btn-chest-collect'); await p.waitForTimeout(600);
  check(await p.locator('#btn-map-chest').isHidden() && (await mapFacts(p)).chestStates.slice(0, 2).every(s => s === 'claimed'), 'no more chests to open');
  await tapEl(p, T, '#btn-map-home'); await p.waitForSelector('#screen-title.active');
  await tapEl(p, T, '#btn-settings'); await p.waitForSelector('#ov-settings.show'); await p.waitForTimeout(250);
  const paints = await p.evaluate(() => [...document.querySelectorAll('.paint-sw')].map(b => b.getAttribute('data-paint') + (b.disabled ? ':locked' : '') + (b.classList.contains('on') ? ':on' : '')));
  check(same(paints, ['classic', 'maple:on', 'trolley:locked', 'surf:locked', 'neon:locked']), 'Settings > Bus paint: ' + paints.join(', '));
  await p.locator('.paint-sw[data-paint="classic"]').scrollIntoViewIfNeeded(); await tapEl(p, T, '.paint-sw[data-paint="classic"]'); await p.waitForTimeout(150);
  check((await stored(p)).paint === 'classic' && (await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bus').trim())).toLowerCase() === '#f6c026', 'switching back to School Yellow works');
  await tapEl(p, T, '#btn-settings-close'); await p.waitForTimeout(200);
  // v9: the Main Street chest (175 coins, Tow, Nudge, Trolley Green paint) after its boss
  console.log('\n# Main Street (v9)');
  await boot(p, won(BOSS[MSK] - 1, { coins: 40, chests: { school: true, suburbs: true }, paints: ['classic', 'maple'], paint: 'maple' }));
  await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
  f = await mapFacts(p);
  const msHead = await p.textContent('.d-sec[data-district="mainst"] .d-head');
  check(f.current === BOSS[MSK] && /Main Street/.test(msHead) && /New: Many ways to win/.test(msHead) && /Play the boss lot/.test(await p.textContent('#btn-map-play')), 'Main Street: stops ' + FIRST[MSK] + '-' + BOSS[MSK] + ', header "New: Many ways to win", the boss (' + LVS[BOSS[MSK] - 1].word + ', par ' + LVS[BOSS[MSK] - 1].par + ') is next');
  await scrollToDistrict(p, MSK); await p.waitForTimeout(250);
  await shot(p, 'v9-mainst-district.png');
  await tapEl(p, T, '#btn-map-play'); await p.waitForSelector('#screen-game.active', { timeout: 4000 });
  check(await solve(p, T), 'Main Street boss lot won by real input at par');
  check(/Main Street complete/.test(await p.textContent('#win-district')) && (await p.textContent('#btn-next')).trim() === 'Open the chest!', 'boss win: "Main Street complete!", "Open the chest!"');
  const msCoins = (await stored(p)).coins;
  await tapEl(p, T, '#btn-next'); await mapOpen(p); await p.waitForSelector('#ov-chest.show', { timeout: 5000 });
  await tapEl(p, T, '#chest-big'); await p.waitForSelector('#ov-chest.open', { timeout: 3000 }); await p.waitForTimeout(900);
  sv = await stored(p);
  const msRw = await p.evaluate(() => [...document.querySelectorAll('#chest-rewards .reward')].map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  check(sv.chests.mainst === true && sv.coins === msCoins + 175 && sv.inv.tow === 1 && sv.inv.nudge === 1 && sv.paints.includes('trolley') && sv.paint === 'trolley' && msRw.length === 4 && /Trolley Green/.test(msRw.join()),
    'Main Street chest claimed once: +175 coins, Tow x1, Nudge x1, Trolley Green paint (worn): ' + msRw.join(' | '));
  await shot(p, 'v9-mainst-chest-rewards.png');
  await tapEl(p, T, '#btn-chest-collect');
  await p.waitForFunction(() => window.WJB.map.driving, null, { timeout: 2500 }).catch(() => {});
  await page_wait_gate(p);
  await notDriving(p); await p.waitForTimeout(300);
  bi = await busInfo(p);
  check(bi.at === LVS[FIRST[BEACH] - 1].id && !(await mapFacts(p)).lockedSecs.includes('beach'), 'Collect: the bus drives into Sunny Beach, parking at stop ' + FIRST[BEACH] + ' (BUS) (bus at ' + bi.at + ')');

  // v9 Scramble spread: the first Scramble stop (PIZZA, inside Main Street) with its one-time tip, and a hard-stretch one (DRAGONS, Harbor Docks)
  console.log('\n# Scramble stops on the map (v9)');
  const PZ = AT('sc1-pizza'), DG = AT('sc3-dragons');
  await boot(p, won(PZ - 1, { seen: {}, chests: { school: true, suburbs: true } }));
  await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
  f = await mapFacts(p);
  check(f.current === PZ && D[MSK].levels.includes('sc1-pizza'), 'the first Scramble stop is ' + PZ + ' (PIZZA), inside Main Street; it is next (current ' + f.current + ')');
  await tapEl(p, T, '#btn-map-play'); await p.waitForSelector('#screen-game.active', { timeout: 5000 });
  await p.waitForSelector('#ov-coach.show', { timeout: 4000 }).catch(() => {});
  check(await p.locator('#ov-coach.show').count() === 1 && /any order/i.test(await p.textContent('#ov-coach')), 'first Scramble stop: the one-time Scramble tip card shows ("' + (await p.textContent('#ov-coach')).replace(/\s+/g, ' ').trim().slice(0, 70) + '...")');
  await p.waitForTimeout(400);
  await shot(p, 'v9-first-scramble-tip-390x844.png');
  await tapEl(p, T, '#btn-coach'); await p.waitForSelector('#banner.show', { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(300);
  check(await p.locator('#banner.show .tier').count() === 1 && await p.getAttribute('#banner .tier', 'data-tier') === String(LVS[PZ - 1].difficulty.tier), 'after the tip: the Scramble banner carries the ' + LVS[PZ - 1].difficulty.label + ' badge');
  await shot(p, 'v9-first-scramble-banner-390x844.png');
  await boot(p, won(DG - 1, { chests: { school: true, suburbs: true, mainst: true, beach: true } }));
  await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
  f = await mapFacts(p);
  check(f.current === DG && D[DK('harbor')].levels.includes('sc3-dragons'), 'hard stretch: Scramble DRAGONS is stop ' + DG + ' in Harbor Docks, between MOTHER and BUS + STOP (current ' + f.current + ')');
  await tapEl(p, T, '#btn-map-play'); await p.waitForSelector('#screen-game.active', { timeout: 5000 });
  await p.waitForSelector('#banner.show', { timeout: 3000 }).catch(() => {});
  await p.waitForTimeout(300);
  check(await p.locator('#ov-coach.show').count() === 0 && await p.locator('#banner.show .tier').count() === 1 && await p.getAttribute('#banner .tier', 'data-tier') === String(LVS[DG - 1].difficulty.tier) && /scramble/i.test(await p.textContent('#banner')),
    'DRAGONS: no tip card the second time; the Scramble banner carries the ' + LVS[DG - 1].difficulty.label + ' badge (par ' + LVS[DG - 1].par + ')');
  await shot(p, 'v9-hard-scramble-dragons-banner-390x844.png');
  await p.waitForFunction(() => !document.querySelector('#banner.show'), null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(300);
  check(await p.getAttribute('#hud-tier .tier', 'data-tier') === String(LVS[DG - 1].difficulty.tier), 'DRAGONS header: "Level ' + DG + ' of ' + NLEV + '" with the ' + LVS[DG - 1].difficulty.label + ' badge');
  await shot(p, 'v9-hard-scramble-dragons-header-390x844.png');

  // other migrations: v2 / v3 saves land on the right district and stop
  for (const [label, save, stop] of [['v3 save (beat 1-2)', { v: 3, unlocked: 2, stars: { 'st1-cat': 3, 'st2-dog': 3 }, best: {}, sound: true }, 3],
    ['v2 save (beat BUS, CAR, PLANET; next is JUNGLE, the stop after PLANET since v9)', { unlocked: 3, stars: { 'lv1-bus': 3, 'lv2-car': 2, 'lv3-planet': 1 }, best: {}, sound: true }, AT('sc2-jungle')],
    ['v8 save waiting at BUS (unlockedId lv1-bus)', wonV8(10), NORMAL[0]],
    ['v8 save that won all 28 (Main Street new)', wonV8(28), NORMAL[0]],
    ['v9 save that won all ' + NLEV, won(NLEV), NLEV]]) {
    await boot(p, save); await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
    f = await mapFacts(p); bi = await busInfo(p);
    const dk = D.findIndex(d => d.levels.includes(LVS[stop - 1].id));
    check(f.current === stop && bi.at === LVS[stop - 1].id && f.currentInView && !f.lockedSecs.includes(D[dk].id), label + ': the bus is at stop ' + stop + ' in ' + D[dk].name + ', in view; ready chests ' + f.chestStates.filter(s => s === 'ready').length);
  }
  await shot(p, 'v8-map-all-won.png');

  // cheats: unlock all opens everything and the bus goes anywhere; chests are only previews; nothing real is saved
  console.log('\n# Cheats on the map');
  const REAL = won(2, { coins: 345 });
  await boot(p, REAL);
  const real0 = await rawSave(p);
  await p.evaluate(TK => localStorage.setItem(TK, JSON.stringify({ unlockAll: true })), TKEY); await p.reload(); await p.waitForTimeout(300);
  await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
  f = await mapFacts(p);
  check(same(f.open, range(1, NLEV)) && same(f.cheat, range(4, NLEV)) && f.lockedSecs.length === 0 && f.gatesOpen.every(Boolean) && await p.locator('.d-sec.cheat').count() === D.length - 1 && await p.locator('#screen-map .test-badge').isVisible(),
    'unlock all: every district and stop open (4-' + NLEV + ' dashed as test-opened), gates up, TEST MODE tag on the map');
  await shot(p, 'v8-map-unlock-all.png');
  const DT = FIRST[DK('downtown')] + 2;
  await tapEl(p, T, '.lvl[data-level="' + DT + '"]');
  await p.waitForFunction(() => window.WJB.map.driving, null, { timeout: 2000 }).catch(() => {});
  const cheatDrive = (await busInfo(p)).driving;
  await p.waitForSelector('#screen-game.active', { timeout: 5000 });
  check(cheatDrive && cheatDrive.to === LVS[DT - 1].id && (await p.textContent('#hud-level')).trim() === 'Level ' + DT + ' of ' + NLEV, 'the bus drives anywhere: from stop 3 to stop ' + DT + ' (Downtown), then it starts');
  await tapEl(p, T, '#btn-menu'); await mapOpen(p); await notDriving(p);
  bi = await busInfo(p);
  check(await rawSave(p) === real0, 'real save byte-identical after test-driving (no busAt, no gate flags)');
  await tapEl(p, T, '.d-sec[data-district="beach"] .dh-chest'); await p.waitForSelector('#ov-chest.show');
  check(await p.locator('#ov-chest.preview').count() === 1 && /TEST MODE preview/.test(await p.textContent('#chest-sub')), 'a chest under cheats opens as a TEST MODE preview');
  await tapEl(p, T, '#chest-big'); await p.waitForSelector('#ov-chest.open', { timeout: 3000 }); await p.waitForTimeout(600);
  check(await p.locator('#chest-rewards .reward').count() === 4 && /nothing was added/.test(await p.textContent('#chest-note')), 'the preview shows the 4 Sunny Beach rewards but "nothing was added"');
  await shot(p, 'v8-chest-preview-test-mode.png');
  await tapEl(p, T, '#btn-chest-collect'); await p.waitForTimeout(300);
  check(await rawSave(p) === real0, 'real save byte-identical after the preview (no chest, coins, boosters or paint)');
  // a chest that is really ready, opened while a cheat is on (unlimited coins): preview only, still claimable later
  await boot(p, won(BOSS[0], { coins: 10 }), { unlimitedCoins: true });
  const realB = await rawSave(p);
  await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
  check(await p.locator('#btn-map-chest').isHidden() && (await mapFacts(p)).chestStates[0] === 'ready', 'unlimited coins on: no "chest to open" button; the ready chest can still be tapped');
  await tapEl(p, T, '.chest-node[data-chest="0"]'); await p.waitForSelector('#ov-chest.preview.show');
  await tapEl(p, T, '#chest-big'); await p.waitForSelector('#ov-chest.open', { timeout: 3000 }); await tapEl(p, T, '#btn-chest-collect'); await p.waitForTimeout(300);
  check(await rawSave(p) === realB, 'opening a really-ready chest with a cheat on: preview only, real save byte-identical');
  // a boss won only because of unlock-all: no chest
  await boot(p, won(4), { unlockAll: true });
  const realC = await rawSave(p);
  await p.goto(URL + '#level-' + BOSS[0]); await p.reload(); await p.waitForSelector('#screen-game.active'); await p.waitForTimeout(500);
  check(await solve(p, T) && /test mode: chest not unlocked/.test(await p.textContent('#win-district')), 'a boss lot won while it was test-opened: "Boss lot beaten (test mode: chest not unlocked)"');
  check(await rawSave(p) === realC, '...nothing saved');
  // cheats off: real progress returns exactly
  await p.evaluate(TK => localStorage.setItem(TK, JSON.stringify({ unlockAll: false, unlimitedCoins: false })), TKEY);
  await boot(p, null); await p.evaluate(([K, sv]) => localStorage.setItem(K, sv), [KEY, real0]); await p.reload(); await p.waitForTimeout(300);
  await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
  f = await mapFacts(p); bi = await busInfo(p);
  check(same(f.open, [1, 2, 3]) && f.cheat.length === 0 && f.lockedSecs.length === D.length - 1 && same(f.chestStates, ALL_LOCKED) && bi.at === LVS[2].id && (await p.textContent('#map-coins')).trim() === '345' && await (async () => { const s = await stored(p), r = JSON.parse(real0);
      return same(s.stars, r.stars) && same(s.best, r.best) && s.unlocked === r.unlocked && s.coins === 345 && same(s.chests, {}) && same(s.inv, { tow: 0, bay: 0, nudge: 0, flip: 0 }) && s.paint === 'classic'; })(),
    'cheats off: stops 1-3 open, districts 2-' + D.length + ' locked, all chests locked, the bus back at stop 3, 345 coins; stars, chests, inventory and paint exactly as before');
  // the gate: first entry into a district lifts its barrier
  await boot(p, won(BOSS[0], { chests: { school: true } }));
  await tapEl(p, T, '#btn-play'); await mapOpen(p); await notDriving(p);
  check((await busInfo(p)).at === LVS[FIRST[1] - 1].id, 'boss already won and chest opened: the bus starts at stop ' + FIRST[1]);
  // #map deep link + reduced motion
  await boot(p, won(3), null, '#map');
  check(await p.locator('#screen-map.active').count() === 1, '#map opens the city map at boot');
  await phone.close();

  console.log('\n# Reduced motion');
  const rm = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const rp = await rm.newPage(); watch(rp, 'reduced');
  const RT = { touch: true, cdp: await rm.newCDPSession(rp) };
  await boot(rp, won(1));
  await rp.goto(URL + '#level-2'); await rp.waitForSelector('#screen-game.active'); await rp.waitForTimeout(400);
  check(await solve(rp, RT), 'reduced motion: level 2 won');
  await tapEl(rp, RT, '#btn-next'); await rp.waitForSelector('#screen-game.active', { timeout: 3000 });
  check((await rp.textContent('#hud-level')).trim() === 'Level 3 of ' + NLEV && (await stored(rp)).busAt === LVS[2].id, 'reduced motion: "Next stop" jumps the bus to stop 3 (no drive) and starts it');
  await boot(rp, won(BOSS[0]));
  await tapEl(rp, RT, '#btn-play'); await mapOpen(rp);
  await tapEl(rp, RT, '#btn-map-chest'); await rp.waitForSelector('#ov-chest.show'); await tapEl(rp, RT, '#chest-big'); await rp.waitForTimeout(150);
  check(await rp.locator('#ov-chest.open').count() === 1 && await rp.locator('#chest-confetti i').count() === 0 && await rp.evaluate(() => getComputedStyle(document.querySelector('.chest-rays')).animationName) === 'none', 'reduced motion: the chest opens at once, no confetti, no spinning rays');
  await rm.close();

  /* ------------------------------ SMALL PHONE 375x667 ------------------------------ */
  console.log('\n# Small phone 375x667 (touch)');
  const small = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const sp = await small.newPage(); watch(sp, 'small');
  const ST = { touch: true, cdp: await small.newCDPSession(sp) };
  await mapBasics(sp, ST, '375x667');
  await boot(sp, won(13, { coins: 80, chests: { school: true } }));
  await tapEl(sp, ST, '#btn-play'); await mapOpen(sp); await notDriving(sp);
  f = await mapFacts(sp);
  check(f.current === 14 && f.currentInView && f.footOk && f.noHScroll, '375x667: mid-game save: stop 14 current and in view, foot buttons fit');
  await shot(sp, 'v8-375x667-map.png');
  await tapEl(sp, ST, '#btn-map-chest'); await sp.waitForSelector('#ov-chest.show'); await tapEl(sp, ST, '#chest-big'); await sp.waitForSelector('#ov-chest.open', { timeout: 3000 }); await sp.waitForTimeout(900);
  check(await sp.evaluate(() => { const r = document.querySelector('.chest-card').getBoundingClientRect(), b = document.getElementById('btn-chest-collect').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && b.height >= 44; }), '375x667: the opened chest card (4 rewards) and Collect (>= 44px) fit on screen');
  await shot(sp, 'v8-375x667-chest-rewards.png');
  await tapEl(sp, ST, '#btn-chest-collect'); await sp.waitForTimeout(400);
  await tapEl(sp, ST, '#btn-map-play'); await sp.waitForSelector('#screen-game.active', { timeout: 4000 });
  check((await sp.textContent('#hud-level')).trim() === 'Level 14 of ' + NLEV, '375x667: "Play stop 14" starts level 14');
  await small.close();

  /* ------------------------------ DESKTOP 1280x800 ------------------------------ */
  console.log('\n# Desktop 1280x800 (mouse)');
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const d = await desk.newPage(); watch(d, 'desktop');
  const M = { touch: false };
  f = await mapBasics(d, M, 'desktop');
  check(f.worldW === 820 && f.worldL === 230, 'desktop: the map is wider (820px) and centred');
  await d.click('.lvl[data-level="1"]'); await d.waitForSelector('#screen-game.active', { timeout: 4000 });
  check(await solve(d, M), 'desktop: stop 1 clicked and won with mouse input');
  await d.click('#btn-next'); await mapOpen(d);
  await d.waitForSelector('#screen-game.active', { timeout: 5000 });
  check((await d.textContent('#hud-level')).trim() === 'Level 2 of ' + NLEV, 'desktop: Next stop drives on and starts level 2');
  await boot(d, won(16, { coins: 260, chests: { school: true, suburbs: true }, paints: ['classic', 'maple'], paint: 'maple' }));
  await d.click('#btn-play'); await mapOpen(d); await notDriving(d);
  await shot(d, 'v8-desktop-map.png');
  f = await mapFacts(d);
  check(f.current === 17 && D[MSK].levels.includes(LVS[16].id) && f.currentInView, 'desktop: a save on stop 17 shows Main Street with stop 17 current and in view');
  await shot(d, 'v9-desktop-map.png');
  await desk.close();

  /* ------------------------------ SCREENSHOTS: themes + full overview ------------------------------ */
  console.log('\n# Screenshots: district themes and the full map');
  const cam = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const cp = await cam.newPage(); watch(cp, 'shots');
  const CT = { touch: true, cdp: await cam.newCDPSession(cp) };
  const tour = won(NLEV, { coins: 980, chests: { school: true, suburbs: true, beach: true }, paints: ['classic', 'maple', 'surf'], paint: 'surf' });
  LVS.forEach((l, i) => { tour.stars[l.id] = [3, 2, 3, 1, 3][i % 5]; });
  delete tour.stars[LVS[NLEV - 1].id]; delete tour.stars[LVS[NLEV - 2].id]; tour.unlocked = NLEV - 2; tour.unlockedId = LVS[NLEV - 2].id;
  await boot(cp, tour);
  await tapEl(cp, CT, '#btn-play'); await mapOpen(cp); await notDriving(cp);
  for (let k = 0; k < D.length; k++) {
    await scrollToDistrict(cp, k); await cp.waitForTimeout(200);
    const h = await cp.evaluate(k => document.querySelectorAll('.d-head')[k].textContent.replace(/\s+/g, ' ').trim(), k);
    check(new RegExp(D[k].name).test(h) && /\d+\/\d+/.test(h), 'district ' + (k + 1) + ' header: "' + h + '"');
    await shot(cp, 'v9-district-' + (k + 1) + '-' + D[k].id + '.png');
  }
  const full = await cp.evaluate(() => document.getElementById('map-world').offsetHeight);
  await cp.setViewportSize({ width: 390, height: full + 160 }); await cp.waitForTimeout(600);
  await cp.evaluate(() => { document.getElementById('map-scroll').scrollTop = 0; });
  await shot(cp, 'v9-map-overview-full.png');
  await cam.close();
  await browser.close();

  console.log('\n# Console / page errors');
  errors.forEach(e => console.log('  ' + e));
  check(errors.length === 0, 'no console errors, page errors or failed requests');
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

/** While a drive crosses a gate, the barrier lifts first (just give it time). */
async function page_wait_gate(page) { await page.waitForTimeout(900); }
