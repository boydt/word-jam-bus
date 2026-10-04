#!/usr/bin/env node
/*
 * Headless browser play-test for Word Jam Bus (v2 slide-until-blocked rules;
 * v4 level set: 10 starter levels, the 10 v2 levels and 3 Scramble breathers = 23;
 * coins + boosters; Bay Word; v7: 5 Downtown levels with keys and padlocks = 28).
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
/* v6b: RENDERED orientation of a car (not just state): which side of the car's centre its nose arrow, headlights and
   windshield sit on, and the opposite of where its tail lights sit, measured from getBoundingClientRect (so every CSS
   transform, animation and inline rotation is included). game = the direction the current game model says it faces. */
const ORIENT_FN = id => {
  const el = document.querySelector('.car[data-id="' + id + '"]'), c = el.getBoundingClientRect(), cc = [c.left + c.width / 2, c.top + c.height / 2];
  const opp = { right: 'left', left: 'right', up: 'down', down: 'up' };
  const side = sel => { const r = el.querySelector(sel).getBoundingClientRect(), dx = r.left + r.width / 2 - cc[0], dy = r.top + r.height / 2 - cc[1];
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); };
  const car = window.WJB.session.game.cars[id];
  return { id: id, game: car.dir, dataDir: el.getAttribute('data-dir'), arrow: side('.arrow'), lights: side('.lights'), glass: side('.glass'), tail: opp[side('.tail')],
    kind: (car.l === '?' ? 'taxi' : car.l.length > 1 ? 'chunk' : car.len + '-cell') + (car.horiz ? ' horizontal' : ' vertical'), flipped: !!car.flipped };
};
const orientOk = o => !!o && o.arrow === o.game && o.lights === o.game && o.glass === o.game && o.tail === o.game && o.dataDir === o.game;
const orientOf = (page, id) => page.evaluate(ORIENT_FN, id);
/** Every visible car's graphic must face the way the game model says; returns the cars that don't. */
const orientBad = page => page.evaluate(fn => { const f = eval('(' + fn + ')'), s = window.WJB.session, bad = [];
  s.game.cars.forEach((c, i) => { const el = document.querySelector('.car[data-id="' + i + '"]'); if (s.state.pos[i] < 0 || !el || el.style.display === 'none' || el.classList.contains('leaving')) return;
    const o = f(i); if (!(o.arrow === o.game && o.lights === o.game && o.glass === o.game && o.tail === o.game && o.dataDir === o.game)) bad.push(o); });
  return bad; }, ORIENT_FN.toString());
const ostr = o => o ? o.kind + ' car ' + o.id + ': model ' + o.game + ', arrow ' + o.arrow + ', headlights ' + o.lights + ', windshield ' + o.glass + ', tail-lights opposite ' + o.tail : 'n/a';
/** Where the preview ghost / exit mark points relative to car i: the exit-mark class for an exit, else the side the ghost moved to. */
const ghostSide = (page, i) => page.evaluate(id => {
  const g = document.getElementById('ghost'), m = document.getElementById('exit-mark'), el = document.querySelector('.car[data-id="' + id + '"]');
  if (!g.classList.contains('show')) return { kind: 'none' };
  if (g.classList.contains('bump')) return { kind: 'bump' };
  const gr = g.getBoundingClientRect(), cr = el.getBoundingClientRect(), dx = gr.left + gr.width / 2 - (cr.left + cr.width / 2), dy = gr.top + gr.height / 2 - (cr.top + cr.height / 2);
  const ghostDir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  if (g.classList.contains('exit')) { const mr = m.getBoundingClientRect(), mx = mr.left + mr.width / 2 - (cr.left + cr.width / 2), my = mr.top + mr.height / 2 - (cr.top + cr.height / 2);
    const markSide = Math.abs(mx) > Math.abs(my) ? (mx > 0 ? 'right' : 'left') : (my > 0 ? 'down' : 'up');
    return { kind: 'exit', dir: [...m.classList].find(k => ['up', 'down', 'left', 'right'].includes(k)), markSide: markSide, ghostDir: (Math.abs(dx) + Math.abs(dy) < 2) ? null : ghostDir }; }
  return { kind: 'slide', dir: ghostDir };
}, i);
/** Press (finger down, no release) on car i so the move preview shows, read it, then cancel the press. */
async function pressPreview(page, i) {
  await page.evaluate(id => { const el = document.querySelector('.car[data-id="' + id + '"]'), r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 77, pointerType: 'touch', isPrimary: true, button: 0 })); }, i);
  await page.waitForTimeout(120);
  const g = await ghostSide(page, i);
  await page.evaluate(id => { document.getElementById('lot').dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 77, pointerType: 'touch' })); }, i);
  await page.waitForTimeout(120);
  return g;
}
/** Flip car i via the booster bar (confirm, pick) and wait past the 0.5 s turn. */
async function flipVia(page, ctx, i, wait) {
  await buy(page, ctx, 'flip');
  await inputMove(page, ctx, i, 0, 'tap');
  await page.waitForTimeout(wait === undefined ? 900 : wait);
}
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
/* v7 keys and padlocks: read the lot's key / lock setup and what the page shows for it. */
const lockInfo = page => page.evaluate(() => {
  const s = window.WJB.session, g = s.game, E = window.WJBEngine;
  return g.cars.map((c, i) => {
    const el = document.querySelector('.car[data-id="' + i + '"]'), kb = el.querySelector('.kb-key'), lb = el.querySelector('.kb-lock');
    const vis = b => !!b && getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0;
    const shape = b => b ? (b.querySelector('svg polygon') ? 'triangle' : b.querySelector('svg rect:not([x="4"])') ? 'square' : 'circle') : null;
    return { i, l: c.l, key: c.key, lock: c.lock, lockBy: c.lockBy, on: s.state.pos[i] >= 0, locked: E.isLocked(g, s.state.pos, i), cls: el.className,
      keyBadge: vis(kb), lockBadge: vis(lb), keyShape: c.key ? shape(kb) : null, lockShape: c.lock ? shape(lb) : null, aria: el.getAttribute('aria-label') };
  });
});
/** Index in the optimal line where key car k drives out (or -1). */
const keyExitAt = (page, sol, k) => page.evaluate(([sol, k]) => { const E = window.WJBEngine, g = window.WJB.session.game; let st = window.WJB.session.state;
  for (let j = 0; j < sol.length; j++) { st = E.step(g, st, sol[j].car, sol[j].which).state; if (st.pos[k] < 0) return j; } return -1; }, [sol, k]);
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
    const boosting = document.getElementById('screen-game').classList.contains('boosting');
    const ids = ['bus', 'lot', 'bay', 'btn-restart', 'btn-undo', 'btn-menu'].concat(boosting ? [] : ['btn-hint', 'coin-box', 'bst-tow', 'bst-bay', 'bst-nudge', 'bst-flip']);
    const vis = ids.every(id => {
      const b = document.getElementById(id).getBoundingClientRect(); return b.width > 0 && b.top >= 0 && b.bottom <= innerHeight + 1 && b.left >= 0 && b.right <= innerWidth + 1;
    });
    // bus art: hood + bumper (front) and tailpipe (back) stay on screen and clear of the lot
    const art = ['#bus .hood', '#bus .bumper', '#bus .pipe'].map(q => document.querySelector(q).getBoundingClientRect());
    const artOk = art.every(b => b.width > 0 && b.left >= 0 && b.right <= innerWidth + 1 && b.bottom <= lot.top + 1);
    return { inLot, vis, artOk, minCar: Math.min(...cars.map(c => Math.min(c.width, c.height))), scroll: document.documentElement.scrollHeight <= innerHeight + 1 };
  });
  check(r.inLot && r.vis && r.scroll && r.artOk, label + ': lot, bus (with hood, bumper, tailpipe), bay, booster bar and buttons fit without scrolling');
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
    stars: [...document.querySelectorAll('.lvl')].map(b => { const sm = b.querySelector('small'), n = sm.hasAttribute('data-stars') ? +sm.getAttribute('data-stars') : -1;
      if (n < 0) return ''; if (sm.querySelectorAll('svg.st.on').length !== n || sm.querySelectorAll('svg.st').length !== 3) return 'MISMATCH';
      return '\u2605\u2605\u2605'.slice(0, n) + '\u2606\u2606\u2606'.slice(0, 3 - n); }),
    play: document.getElementById('btn-play').textContent,
    stored: JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))
  }));
}
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);

const LVS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'levels', 'levels.json'), 'utf8')).levels;
const NLEV = LVS.length;
const SCR = LVS.map((l, i) => l.mode === 'scramble' ? i + 1 : 0).filter(Boolean);
const KEYS = LVS.map((l, i) => l.cars.some(c => c.lock) ? i + 1 : 0).filter(Boolean);   // levels with padlocks
const LAST_ID = LVS[NLEV - 1].id;
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
    const noBoost = !lv.used.tow && !lv.used.bay && !lv.used.nudge && !lv.used.flip;
    check(won && st === '3' && sol.length === lv.par && noBoost, label + ' level ' + n + ' (' + lv.id + (lv.mode === 'scramble' ? ', Scramble' : '') + ') won in ' + sol.length + ' moves (= par ' + lv.par + ', ' +
      sol.filter(m => m.which === 1).length + ' reverses), no boosters, 3 stars [' + (Date.now() - t0) + ' ms]');
  }
}
const v4save = extra => Object.assign({ v: 4, unlocked: 22, unlockedId: 'lv10-school', stars: {}, best: {}, sound: false, coins: 0, seen: { scramble: true } }, extra || {});
async function buy(page, ctx, kind) {
  await tapEl(page, ctx, '#bst-' + kind); await page.waitForSelector('#ov-shop.show'); await page.waitForTimeout(350);
  await tapEl(page, ctx, '#btn-confirm'); await page.waitForTimeout(250);
}
/** Booster bar: 4 boosters + coins + Hint, each >= 44px, on screen, not covering the lot, bay or tip. */
async function barCheck(page, label) {
  const r = await page.evaluate(() => {
    const R = id => document.getElementById(id).getBoundingClientRect();
    const btns = ['coin-box', 'bst-tow', 'bst-bay', 'bst-nudge', 'bst-flip', 'btn-hint'].map(R);
    const keep = ['lot', 'bay-zone', 'tip'].map(R);
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    return { min: Math.round(Math.min(...btns.slice(1).map(b => Math.min(b.width, b.height)))), onScreen: btns.every(b => b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight),
      clear: btns.every(b => keep.every(k => !hit(b, k))), apart: btns.every((a, i) => btns.every((b, j) => i === j || !hit(a, b))), tipH: Math.round(keep[2].height) };
  });
  check(r.min >= 44 && r.onScreen && r.clear && r.apart, label + ': booster bar (coins, Tow, Bay +1, Nudge, Flip, Hint) fits, targets >= 44px (' + r.min + 'px), clear of the lot, bay and tip');
  return r;
}
/** A car whose flip lets it drive straight out of its former tail end (and that can't leave forward now). */
/** Element shot of the play bus including the hood, bumper, tailpipe and wheels (they hang outside the body box). */
async function busShot(page, name) {
  const clip = await page.evaluate(() => {
    const rs = ['#bus', '#bus .hood', '#bus .bumper', '#bus .pipe', '#bus .wheel', '#bus .shuffle-badge'].flatMap(q => [...document.querySelectorAll(q)]).map(e => e.getBoundingClientRect()).filter(r => r.width > 0);
    const x0 = Math.min(...rs.map(r => r.left)) - 22, y0 = Math.min(...rs.map(r => r.top)) - 10, x1 = Math.max(...rs.map(r => r.right)) + 10, y1 = Math.max(...rs.map(r => r.bottom)) + 8;
    return { x: Math.max(0, x0), y: Math.max(0, y0), width: Math.min(innerWidth, x1) - Math.max(0, x0), height: y1 - Math.max(0, y0) };
  });
  await page.screenshot({ path: path.join(SHOTS, name), clip });
  console.log('  shot screenshots/' + name);
}
const findFlipExit = page => page.evaluate(() => {
  const s = window.WJB.session, E = window.WJBEngine, g = s.game;
  for (let i = 0; i < g.n; i++) {
    if (s.state.pos[i] < 0) continue;
    const leaves = r => r && r.state && r.state.pos[i] === -1 && r.result !== 'lose';
    if (leaves(E.step(g, s.state, i, 0))) continue;   // it can't leave nose-first right now...
    const g2 = E.flipCar(g, i), st = E.applyBooster(g, s.state, 'flip', i), r = E.step(g2, st, i, 0);
    if (leaves(r) && !r.won) return { car: i, dir: g.cars[i].dir, to: g2.cars[i].dir, result: r.result };   // ...but flipped it drives straight out
  }
  return null;
});
async function fitCheck(page, label) {
  return page.evaluate(() => {
    const r = [...document.querySelectorAll('.lvl')].map(b => b.getBoundingClientRect());
    const foot = [...document.querySelectorAll('#btn-settings')].map(b => b.getBoundingClientRect());
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
    await p.locator('.lvl.scr .lvl-scr').count() === SCR.length, 'level select marks the Scramble levels ' + SCR.join(', ') + ' with a shuffle icon');
  let sel = await fitCheck(p);
  check(sel.fits && sel.footFits && sel.scroll && sel.minH >= 44, 'level select: all ' + NLEV + ' buttons + footer fit on 390x844 without scrolling (' + sel.rows + ' rows, buttons ' + Math.round(sel.minW) + 'x' + Math.round(sel.minH) + 'px)');
  check((await p.textContent('#title-coins')).trim() === '0' && t.stored.coins === 0 && t.stored.v === 4, 'fresh save: coin counter 0, stored as v4');
  check(await p.evaluate(() => getComputedStyle(document.getElementById('lot')).touchAction) === 'none', 'lot has touch-action:none (swipes never scroll/zoom)');

  // --- coins: fares banked on a win, doubled at par, +20 first clear; saved ---
  await tapEl(p, T, '#btn-play'); await p.waitForSelector('#screen-game.active'); await p.waitForTimeout(700);
  check((await p.textContent('#hud-level')).trim() === 'Level 1 of ' + NLEV, 'Play opens "Level 1 of ' + NLEV + '"');
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
  const drive = await p.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.getElementById('bus')).transform).m41);
  check(drive > 0, 'on a win the bus drives off to the right, hood first (translateX ' + Math.round(drive) + 'px)');
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
  // bus art: hood + bumper at the front (right, the driving direction), tailpipe at the back
  for (const [n, name] of [[11, 'v6-bus-closeup.png'], [12, 'v6-bus-scramble-closeup.png']]) {
    await openLevel(p, n);
    const art = await p.evaluate(() => { const R = q => document.querySelector(q).getBoundingClientRect(), b = R('#bus'), h = R('#bus .hood'), u = R('#bus .bumper'), t = R('#bus .pipe');
      return { front: h.left > b.left + b.width / 2 && u.right >= h.right - 1 && h.height < b.height && h.bottom >= b.bottom - 1, back: t.right <= b.left + 3, hoodBg: getComputedStyle(document.querySelector('#bus .hood')).backgroundColor, busBg: getComputedStyle(document.getElementById('bus')).backgroundColor, puff: document.querySelectorAll('#bus .puff').length,
        title: !!document.querySelector('.logo-bus .hood') && !!document.querySelector('.logo-bus .pipe'), mini: !!document.querySelector('.mini-bus .hood'), coach: !!document.querySelector('.coach-bus .hood') }; });
    check(art.front && art.back && art.hoodBg === art.busBg && art.puff === 2 && art.title && art.mini && art.coach, 'level ' + n + ' bus: lower, shorter hood + bumper at the front, tailpipe + puff at the back, hood in the bus colour (' + art.busBg + '); title, win-card and tip buses have them too');
    await busShot(p, name);
  }

  // --- boosters (coins seeded) ---
  console.log('\n# Boosters');
  await seeded(p, v4save({ coins: 1000 }));
  await openLevel(p, 13);
  const prices = await p.evaluate(() => ['tow', 'bay', 'nudge', 'flip'].map(k => document.querySelector('#bst-' + k + ' .bst-price').textContent.trim()).join(','));
  check((await p.textContent('#coin-count')).trim() === '1000' && prices === '150,100,60,120', 'booster bar shows the balance (1000) and Tow 150, Bay +1 100, Nudge 60, Flip 120 (' + prices + ')');
  await barCheck(p, 'phone 390x844 L13');
  await shot(p, 'v6-play-booster-bar-390x844.png');
  await tapEl(p, T, '#bst-tow'); await p.waitForSelector('#ov-shop.show'); await p.waitForTimeout(300);
  check(/Spend 150 coins on Tow truck\?/.test(await p.textContent('#confirm-title')), 'tapping Tow in the bar goes straight to "Spend 150 coins on Tow truck?"');
  await shot(p, 'v6-booster-confirm-from-bar.png');
  await tapEl(p, T, '#btn-confirm-cancel'); await p.waitForTimeout(200);
  check((await S(p)).coins === 1000 && await p.locator('#ov-shop.show').count() === 0 && await p.locator('#boost-bar.show').count() === 0, 'Cancel closes the confirm and spends nothing');
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
  await tapEl(p, T, '#btn-dead-shop'); await p.waitForTimeout(300);
  check(await p.locator('#deadend.show').count() === 0 && await p.locator('#booster-bar.attention').count() === 1, 'dead-end banner\'s Boosters button reveals and highlights the booster bar');
  await buy(p, T, 'bay'); await p.waitForTimeout(100);
  await p.waitForFunction(() => !window.WJB.searching(), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(400);
  const rescued = await p.evaluate(() => window.WJBEngine.solve(window.WJB.session.game, window.WJB.session.state, { maxStates: 2000000 }).par !== null);
  cs = await S(p);
  check(cs.dead === !rescued && (await p.locator('#deadend.show').count() === 1) === !rescued, 'after Bay +1 in a dead end the dead-end check re-ran: ' + (rescued ? 'rescued, banner gone' : 'still dead, banner stays'));
  await layoutOk(p, 'phone L13 with boosters');

  // --- Bay Word on level 17 (JUNGLE): junk letters spell a word, clear, pay 10 ---
  // --- booster bar states: red price when too poor, Bay +1 "Used" ---
  console.log('\n# Booster bar states + Flip');
  await seeded(p, v4save({ coins: 80 }));
  await openLevel(p, 13);
  const poor = await p.evaluate(() => ['tow', 'bay', 'nudge', 'flip'].map(k => document.getElementById('bst-' + k).classList.contains('poor') ? 1 : 0).join(''));
  const red = await p.evaluate(() => getComputedStyle(document.querySelector('#bst-tow .bst-price')).color);
  check(poor === '1101' && red === 'rgb(224, 49, 49)', 'with 80 coins: Tow, Bay +1 and Flip show their price in red, Nudge (60) does not (' + poor + ', ' + red + ')');
  await tapEl(p, T, '#bst-tow'); await p.waitForTimeout(350);
  check(await p.locator('#ov-shop.show').count() === 0 && (await S(p)).coins === 80 && /Need 150 coins/.test(await p.textContent('#toast')), 'tapping an unaffordable booster: no confirm, "Need 150 coins" toast, nothing spent');
  await seeded(p, v4save({ coins: 1000 }));
  await openLevel(p, 13);
  await buy(p, T, 'bay');
  check(await p.locator('#bst-bay.off').count() === 1 && (await p.textContent('#bst-bay .bst-price')).trim() === 'Used', 'after Bay +1 its button greys out and reads "Used"');
  await tapEl(p, T, '#bst-bay'); await p.waitForTimeout(300);
  check(await p.locator('#ov-shop.show').count() === 0 && (await S(p)).coins === 900, 'tapping a used Bay +1 does nothing (no confirm, no charge)');
  // --- Flip: a car turns round and drives out of its former tail end ---
  let flipLv = 0, fx = null;
  for (const n of [13, 14, 11, 15, 16, 18, 19, 20, 23, 9, 10, 8]) { await openLevel(p, n); fx = await findFlipExit(p); if (fx) { flipLv = n; break; } }
  check(!!fx, 'found a car on level ' + flipLv + ' that can only leave the other way (car ' + (fx && fx.car) + ', facing ' + (fx && fx.dir) + ')');
  const fb = await S(p);
  await tapEl(p, T, '#bst-flip'); await p.waitForSelector('#ov-shop.show'); await p.waitForTimeout(300);
  check(/Spend 120 coins on Flip\?/.test(await p.textContent('#confirm-title')), 'Flip confirm: "Spend 120 coins on Flip?"');
  await tapEl(p, T, '#btn-confirm'); await p.waitForTimeout(300);
  const flipPick = await p.evaluate(() => ({ glow: document.querySelectorAll('.car.can-boost').length, cars: [...document.querySelectorAll('.car')].filter(e => e.style.display !== 'none').length, bar: document.getElementById('boost-bar').classList.contains('show') }));
  check(flipPick.bar && flipPick.glow === flipPick.cars && (await S(p)).coins === fb.coins, 'flip pick mode: every car in the lot glows (trucks too), Cancel bar shown, nothing charged yet');
  await shot(p, 'v6-flip-pick.png');
  await inputMove(p, T, fx.car, 0, 'tap'); await p.waitForTimeout(650); await settle(p);
  let fa = await S(p);
  const fdir = await p.evaluate(id => ({ game: window.WJB.session.game.cars[id].dir, el: document.querySelector('.car[data-id="' + id + '"]').getAttribute('data-dir') }), fx.car);
  check(fdir.game === fx.to && fdir.el === fx.to && fa.coins === fb.coins - 120 && fa.moves === fb.moves + 1 && fa.used.flip === 1 && fa.pos[fx.car] === fb.pos[fx.car],
    'Flip: car ' + fx.car + ' now faces ' + fx.to + ' (was ' + fx.dir + '), same cells, 120 coins, +1 move');
  await shot(p, 'v6-flip-done.png');
  await p.waitForFunction(() => !window.WJB.searching(), null, { timeout: 20000 }).catch(() => {});
  fa = await S(p);
  check(fa.dead === (await p.evaluate(() => window.WJBEngine.solve(window.WJB.session.game, window.WJB.session.state).par === null)), 'dead-end check re-ran with the flipped direction (dead = ' + fa.dead + ')');
  if (!fa.dead) {
    await tapEl(p, T, '#btn-hint');
    await p.waitForFunction(() => document.querySelector('.car.hint'), null, { timeout: 20000 }).catch(() => {});
    const fh = await p.locator('.car.hint').count() ? await hintCheck(p) : { ok: false };
    check(fh.ok, 'hint after Flip is optimal for the flipped lot (' + fh.d0 + ' -> ' + fh.d1 + ')');
    await p.evaluate(() => { document.querySelectorAll('.car.hint').forEach(e => e.classList.remove('hint')); });
  }
  const pre2 = await S(p);
  await inputMove(p, T, fx.car, 0, 'tap'); await settle(p);
  fa = await S(p);
  check(fa.pos[fx.car] === -1 && fa.moves === pre2.moves + 1, 'tapping the flipped car drives it out of its former tail end (' + fx.to + ')');
  await tapEl(p, T, '#btn-undo'); await settle(p);
  await tapEl(p, T, '#btn-undo'); await settle(p);
  fa = await S(p);
  const fu = await p.evaluate(id => ({ game: window.WJB.session.game.cars[id].dir, el: document.querySelector('.car[data-id="' + id + '"]').getAttribute('data-dir') }), fx.car);
  check(fu.game === fx.dir && fu.el === fx.dir && fa.coins === fb.coins && fa.used.flip === 0 && fa.pos[fx.car] === fb.pos[fx.car] && fa.moves === fb.moves, 'Undo x2: the car is back and faces ' + fx.dir + ' again; Flip\'s 120 coins refunded (' + fa.coins + ')');
  // a win that used Flip is capped at 2 stars
  await openLevel(p, 11);
  await buy(p, T, 'flip');
  const fc = await p.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine; let best = -1, bp = 99; for (let i = 0; i < s.game.n; i++) { if (s.state.pos[i] < 0) continue; const g2 = E.flipCar(s.game, i), st = E.applyBooster(s.game, s.state, 'flip', i), q = E.solve(g2, st).par; if (q !== null && q < bp) { bp = q; best = i; } } return best; });
  await inputMove(p, T, fc, 0, 'tap'); await p.waitForTimeout(600); await settle(p);
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 8000 }).catch(() => {});
  check(await p.locator('#ov-win.show').count() === 1 && +(await p.getAttribute('#win-stars', 'data-stars')) <= 2 && /Booster used/.test(await p.textContent('#win-detail')), 'a win that used Flip is capped at 2 stars ("Booster used")');

  // --- v6b: the Flip must stay flipped ON SCREEN (the graphic used to turn, then snap back to the old direction) ---
  console.log('\n# Flip: rendered orientation (graphic, not just state)');
  await seeded(p, v4save({ coins: 100000 }));
  await openLevel(p, 13);
  const oc = fx ? fx.car : 0, o0 = await orientOf(p, oc);
  check(orientOk(o0) && (await orientBad(p)).length === 0, 'before Flip: every car\'s graphic matches its direction (' + ostr(o0) + ')');
  await flipVia(p, T, oc);
  let o1 = await orientOf(p, oc);
  check(orientOk(o1) && o1.arrow !== o0.arrow && o1.arrow === { right: 'left', left: 'right', up: 'down', down: 'up' }[o0.arrow], 'after the Flip settles (0.9 s > 0.5 s turn): nose arrow, headlights, windshield and tail lights all face the new way and stay there (' + ostr(o1) + ')');
  await p.waitForTimeout(1200);
  o1 = await orientOf(p, oc);
  check(orientOk(o1) && o1.game !== o0.game, 'still flipped 2 s later (no snap-back)');
  const pv = await pressPreview(p, oc);
  check(pv.kind === 'exit' && pv.dir === o1.arrow && pv.markSide === o1.arrow, 'press preview on the flipped car: exit lane + exit mark on its new nose side (' + JSON.stringify(pv) + ')');
  // a hint after the flip: the hinted car's ghost goes the way its RENDERED nose (fwd) or tail (back) says
  await tapEl(p, T, '#btn-hint');
  await p.waitForFunction(() => document.querySelector('.car.hint'), null, { timeout: 20000 }).catch(() => {});
  const hc = await p.evaluate(() => { const e = document.querySelector('.car.hint'); return e ? { id: +e.getAttribute('data-id'), w: e.getAttribute('data-hint') } : null; });
  if (hc) {
    const ho = await orientOf(p, hc.id), hg = await ghostSide(p, hc.id), want = hc.w === 'fwd' ? ho.arrow : { right: 'left', left: 'right', up: 'down', down: 'up' }[ho.arrow];
    check(orientOk(ho) && (hg.kind === 'bump' || hg.dir === want), 'hint after Flip: car ' + hc.id + ' (' + hc.w + ') ghost/arrow goes ' + hg.dir + ', matching its on-screen ' + (hc.w === 'fwd' ? 'nose' : 'tail'));
    await p.evaluate(() => { document.querySelectorAll('.car.hint').forEach(e => e.classList.remove('hint')); });
  } else check(false, 'hint after Flip shows a car');
  // rerender caused by another move, then by a relayout (resize)
  const other = await p.evaluate(fc => { const s = window.WJB.session, E = window.WJBEngine, gr = E.buildGrid(s.game, s.state.pos);
    for (const k of ['slide', 'exit']) for (let i = 0; i < s.game.n; i++) if (i !== fc && s.state.pos[i] >= 0 && E.probe(s.game, gr, s.state.pos, i, 0).kind === k) return i; return -1; }, oc);
  if (other >= 0) { await inputMove(p, T, other, 0, 'tap'); await settle(p); await p.waitForTimeout(400); }
  o1 = await orientOf(p, oc);
  check(other >= 0 && orientOk(o1) && o1.game !== o0.game && (await orientBad(p)).length === 0, 'after another car\'s move (car ' + other + '): the flipped car still shows the new direction, all cars match');
  await p.setViewportSize({ width: 391, height: 844 }); await p.waitForTimeout(400);
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
  o1 = await orientOf(p, oc);
  check(orientOk(o1) && o1.game !== o0.game && (await orientBad(p)).length === 0, 'after a relayout (resize): still flipped on screen');
  if (other >= 0) { await tapEl(p, T, '#btn-undo'); await settle(p); }
  await tapEl(p, T, '#btn-undo'); await settle(p); await p.waitForTimeout(300);
  const o2 = await orientOf(p, oc);
  check(orientOk(o2) && o2.arrow === o0.arrow && (await orientBad(p)).length === 0, 'after Undo: the car is back to its original look (' + ostr(o2) + ')');
  await shot(p, 'v6b-after-flip-e2e-undo.png');
  // restart after a flip
  await flipVia(p, T, oc);
  await tapEl(p, T, '#btn-restart'); await p.waitForTimeout(700);
  const o3 = await orientOf(p, oc);
  check(orientOk(o3) && o3.arrow === o0.arrow && (await orientBad(p)).length === 0, 'after Restart: original look (' + ostr(o3) + ')');
  // flip, then move on to the next level: a fresh lot, every car drawn the way it faces
  await flipVia(p, T, oc);
  await openLevel(p, 14);
  check((await orientBad(p)).length === 0, 'next level after a Flip: every car\'s graphic matches its direction');
  // every kind of car: horizontal / vertical, 1-, 2-, 3-cell trucks, chunk trucks, the taxi
  const kinds = {};
  for (const n of [13, 15, 16, 20, 21]) { // between them: 1/2/3-cell both ways, the TH chunk truck (20) and the taxi (21)
    await openLevel(p, n);
    const list = await p.evaluate(() => { const s = window.WJB.session; return s.game.cars.map((c, i) => ({ i: i, k: (c.l === '?' ? 'taxi' : c.l.length > 1 ? 'chunk' : c.len + '-cell') + (c.horiz ? ' horizontal' : ' vertical'), on: s.state.pos[i] >= 0 })); });
    const todo = list.filter(c => c.on && !kinds[c.k]);
    const seen = {};
    for (const c of todo) {
      if (seen[c.k]) continue; seen[c.k] = 1;
      const a = await orientOf(p, c.i);
      await flipVia(p, T, c.i);
      await p.evaluate(() => document.getElementById('deadend').classList.remove('show')); // a flip can make a dead end; keep the lot tappable
      const b2 = await orientOf(p, c.i);
      kinds[c.k] = { ok: orientOk(a) && orientOk(b2) && b2.arrow !== a.arrow && b2.game !== a.game, level: n, car: c.i, from: a.arrow, to: b2.arrow };
    }
    if (todo.length) check((await orientBad(p)).length === 0, 'level ' + n + ' after flipping ' + Object.keys(seen).join(', ') + ': all cars drawn the way they face');
  }
  for (const k of Object.keys(kinds).sort()) check(kinds[k].ok, 'Flip graphic, ' + k + ' (level ' + kinds[k].level + ', car ' + kinds[k].car + '): ' + kinds[k].from + ' -> ' + kinds[k].to + ' and it stays');
  const needKinds = ['1-cell horizontal', '1-cell vertical', '2-cell horizontal', '2-cell vertical', '3-cell horizontal', '3-cell vertical', 'chunk', 'taxi'];
  check(needKinds.every(k => Object.keys(kinds).some(x => x.indexOf(k) === 0)), 'covered every kind of car: ' + Object.keys(kinds).sort().join(', '));
  // reduced motion: no turn animation, the new look is there at once
  {
    const rc = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
    const rp = await rc.newPage(); watch(rp, 'reduced-motion');
    await seeded(rp, v4save({ coins: 1000 }));
    await openLevel(rp, 13);
    const r0 = await orientOf(rp, oc);
    await flipVia(rp, T, oc, 60);
    const r1 = await orientOf(rp, oc);
    await rp.waitForTimeout(1000);
    const r2 = await orientOf(rp, oc);
    check(orientOk(r1) && orientOk(r2) && r1.arrow !== r0.arrow && r2.arrow === r1.arrow, 'reduced motion: flipped look shows at once (60 ms) and stays (' + ostr(r2) + ')');
    await rc.close();
  }

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
  {  /* ----------------------- v7: KEYS AND PADLOCKS ----------------------- */
  console.log('\n# Keys and padlocks');
  check(KEYS.length >= 4 && KEYS[0] === 24 && LVS[KEYS[0] - 1].teaches === 'keys', 'padlocks appear on ' + KEYS.length + ' levels (' + KEYS.join(', ') + '), introduced on level ' + KEYS[0] + ' after the 23 earlier levels');
  await seeded(p, v4save({ coins: 1000, unlocked: NLEV - 1, unlockedId: LAST_ID }));
  await openLevel(p, KEYS[0]);
  let li = await lockInfo(p);
  const tip1 = (await p.textContent('#tip')).trim();
  check(/key/i.test(tip1) && /padlock/i.test(tip1), 'first key level has a one-line tip about keys and padlocks ("' + tip1 + '")');
  const keyCars = li.filter(c => c.key), lockCars = li.filter(c => c.lock);
  const SHAPE = { gold: 'circle', blue: 'triangle', pink: 'square' };
  check(keyCars.length >= 1 && keyCars.every(c => c.keyBadge && c.keyShape === SHAPE[c.key] && /carries the \w+ \w+ key/.test(c.aria)), 'key cars carry a key badge in their colour with its shape (' + keyCars.map(c => c.l + ': ' + c.key + ' ' + c.keyShape).join(', ') + ')');
  check(lockCars.every(c => c.locked && c.lockBadge && c.lockShape === SHAPE[c.lock] && / locked\b|padlocked/.test(c.aria) && /\blocked\b/.test(c.cls)), 'padlocked cars show a padlock of the same colour + shape and a locked look (' + lockCars.map(c => c.l + ': ' + c.lock + ' ' + c.lockShape).join(', ') + ')');
  await shot(p, 'v7-key-first-level-tip.png');
  const L1 = lockCars[0].i, K1 = lockCars[0].lockBy;
  let kb0 = await S(p);
  await inputMove(p, T, L1, 0, 'tap'); await p.waitForTimeout(220);
  const fb = await p.evaluate(([l, k]) => { const le = document.querySelector('.car[data-id="' + l + '"]'), ke = document.querySelector('.car[data-id="' + k + '"]');
    return { wig: le.classList.contains('lock-wiggle'), lockAnim: getComputedStyle(le.querySelector('.kb-lock')).animationName, call: ke.classList.contains('key-call'), keyAnim: getComputedStyle(ke.querySelector('.chassis')).animationName, toast: document.getElementById('toast').textContent }; }, [L1, K1]);
  let kb1 = await S(p);
  check(fb.wig && fb.lockAnim === 'lockwiggle' && fb.call && fb.keyAnim === 'keycall' && /Locked/.test(fb.toast) && kb1.moves === kb0.moves && same(kb1.pos, kb0.pos),
    'tapping a padlocked car: padlock wiggles, the matching key car lights up, "' + fb.toast + '", no move used');
  await shot(p, 'v7-locked-tap-key-highlight.png');
  await p.waitForTimeout(1800);
  await inputMove(p, T, L1, 1, 'swipe'); await p.waitForTimeout(200);
  kb1 = await S(p);
  check(kb1.moves === kb0.moves && same(kb1.pos, kb0.pos), 'swiping it backwards does nothing either (no reverse while locked)');
  // the unlock moment: play the optimal line up to the key car's exit
  const solk = await p.evaluate(() => window.WJB.solution());
  const kAt = await keyExitAt(p, solk, K1);
  check(kAt >= 0 && solk.length === LVS[KEYS[0] - 1].par, 'the optimal line drives the key car out at move ' + (kAt + 1) + ' of ' + solk.length);
  await playPath(p, T, solk.slice(0, kAt));
  check((await lockInfo(p))[L1].locked, 'still locked before the key car leaves');
  await inputMove(p, T, K1, solk[kAt].which, solk[kAt].which ? 'swipe' : 'tap'); await p.waitForTimeout(160);
  const um = await p.evaluate(l => { const e = document.querySelector('.car[data-id="' + l + '"]'); return { unlocking: e.classList.contains('unlocking'), locked: e.classList.contains('locked'), anim: getComputedStyle(e.querySelector('.kb-lock')).animationName, toast: document.getElementById('toast').textContent }; }, L1);
  check(um.unlocking && !um.locked && um.anim === 'lockpop' && /nlocked/.test(um.toast), 'key car drives out: its padlock(s) pop open with an unlock animation ("' + um.toast + '")');
  await shot(p, 'v7-unlock-moment.png');
  await settle(p); await p.waitForTimeout(1100);
  li = await lockInfo(p);
  check(li.filter(c => c.lockBy === K1).every(c => !c.locked && !c.lockBadge && /unlocked/.test(c.aria)), 'after the animation every lock of that colour is gone (one key opens all of its colour)');
  // Undo of the key car's exit re-locks
  await tapEl(p, T, '#btn-undo'); await p.waitForTimeout(120);
  const rl = await p.evaluate(l => document.querySelector('.car[data-id="' + l + '"]').classList.contains('relock'), L1);
  await settle(p); await p.waitForTimeout(400);
  li = await lockInfo(p);
  check(rl && li[K1].on && li.filter(c => c.lockBy === K1).every(c => c.locked && c.lockBadge), 'Undo of the key car\'s exit: the key car is back and its padlocks snap shut again');
  kb0 = await S(p);
  await inputMove(p, T, L1, 0, 'tap'); await p.waitForTimeout(200);
  check(same((await S(p)).pos, kb0.pos) && (await S(p)).moves === kb0.moves, 're-locked car is really locked again (tap = no move)');
  // hint understands locks
  await p.waitForTimeout(1600);
  await tapEl(p, T, '#btn-hint');
  await p.waitForFunction(() => document.querySelector('.car.hint'), null, { timeout: 20000 }).catch(() => {});
  const kh = await hintCheck(p);
  check(kh.ok, 'hint with padlocks is on an optimal line (' + kh.d0 + ' -> ' + kh.d1 + ')');
  await p.evaluate(() => { document.querySelectorAll('.car.hint').forEach(e => e.classList.remove('hint')); });
  // boosters: Tow, Nudge, Flip refuse padlocked cars; Tow refuses key cars; they are grayed in pick-a-car
  const coins0 = (await S(p)).coins;
  await buy(p, T, 'tow');
  let pk = await p.evaluate(([l, k]) => ({ l: document.querySelector('.car[data-id="' + l + '"]').className, k: document.querySelector('.car[data-id="' + k + '"]').className,
    op: +getComputedStyle(document.querySelector('.car[data-id="' + l + '"]')).opacity }), [L1, K1]);
  check(/no-boost/.test(pk.l) && !/can-boost/.test(pk.l) && /no-boost/.test(pk.k) && !/can-boost/.test(pk.k) && pk.op < 0.6, 'Tow pick: the padlocked car and the key car are grayed out (opacity ' + pk.op + ')');
  await shot(p, 'v7-booster-pick-locked-grayed.png');
  await inputMove(p, T, L1, 0, 'tap'); await p.waitForTimeout(250);
  let tt = await p.textContent('#toast');
  check(/Padlocked cars can't be towed/.test(tt) && (await S(p)).coins === coins0 && (await S(p)).pos[L1] >= 0, 'tapping it in Tow pick: "' + tt + '", nothing charged');
  await inputMove(p, T, K1, 0, 'tap'); await p.waitForTimeout(250);
  tt = await p.textContent('#toast');
  check(/Key cars can't be towed/.test(tt) && (await S(p)).coins === coins0 && (await S(p)).pos[K1] >= 0, 'tapping the key car in Tow pick: "' + tt + '" (no free unlock), nothing charged');
  await tapEl(p, T, '#btn-boost-cancel'); await p.waitForTimeout(250);
  await buy(p, T, 'nudge');
  pk = await p.evaluate(l => document.querySelector('.car[data-id="' + l + '"]').className, L1);
  await inputMove(p, T, L1, 0, 'tap'); await p.waitForTimeout(250);
  tt = await p.textContent('#toast');
  check(/no-boost/.test(pk) && /Padlocked cars can't be nudged/.test(tt) && (await S(p)).coins === coins0, 'Nudge pick: padlocked car grayed, refused ("' + tt + '")');
  await tapEl(p, T, '#btn-boost-cancel'); await p.waitForTimeout(250);
  await buy(p, T, 'flip');
  pk = await p.evaluate(([l, k]) => [document.querySelector('.car[data-id="' + l + '"]').className, document.querySelector('.car[data-id="' + k + '"]').className], [L1, K1]);
  await inputMove(p, T, L1, 0, 'tap'); await p.waitForTimeout(250);
  tt = await p.textContent('#toast');
  check(/no-boost/.test(pk[0]) && /can-boost/.test(pk[1]) && /Padlocked cars can't be flipped/.test(tt) && (await S(p)).coins === coins0, 'Flip pick: padlocked car grayed + refused, the key car can flip (it still has to drive out)');
  await tapEl(p, T, '#btn-boost-cancel'); await p.waitForTimeout(250);
  check(await p.locator('#bst-bay.off').count() === 0, 'Bay +1 is unaffected by padlocks');
  // Undo after a key-car exit + flip etc. keeps locks right: flip the key car, undo it, still locked
  await buy(p, T, 'flip'); await inputMove(p, T, K1, 0, 'tap'); await p.waitForTimeout(800);
  await tapEl(p, T, '#btn-undo'); await settle(p); await p.waitForTimeout(300);
  li = await lockInfo(p);
  check(li[L1].locked && li[L1].lockBadge && (await S(p)).coins === coins0, 'flip the key car, then Undo: refunded, its padlocks still shut');
  // later mixed key levels: two colours, a chain, a Scramble stop with a padlock
  for (const n of KEYS.slice(1)) {
    await openLevel(p, n);
    li = await lockInfo(p);
    const cols = [...new Set(li.filter(c => c.key).map(c => c.key))], chain = li.some(c => c.key && c.lock);
    const okBadges = li.every(c => (!c.key || (c.keyBadge && c.keyShape === SHAPE[c.key])) && (!c.lock || (c.lockBadge && c.locked && c.lockShape === SHAPE[c.lock])));
    const lv = LVS[n - 1];
    check(okBadges, 'level ' + n + ' (' + lv.id + (lv.mode === 'scramble' ? ', Scramble' : '') + '): ' + cols.map(k => k + ' ' + SHAPE[k]).join(' + ') + ' key(s), ' + li.filter(c => c.lock).length + ' padlock(s)' + (chain ? ', a padlocked key car (chain)' : '') + ', badges shown');
    if (n === KEYS[2]) await shot(p, 'v7-key-mixed-level.png');
    if (n === KEYS[KEYS.length - 1]) await shot(p, 'v7-key-boss-level.png');
  }
  const chainLv = KEYS.find(n => LVS[n - 1].cars.some(c => c.key && c.lock));
  check(!!chainLv && KEYS.some(n => new Set(LVS[n - 1].cars.filter(c => c.key).map(c => c.key)).size >= 2), 'the mix includes a two-colour level and a chain (level ' + chainLv + ')');
  if (chainLv) {   // a chained key car is itself locked until the first key leaves
    await openLevel(p, chainLv);
    li = await lockInfo(p);
    const ck = li.find(c => c.key && c.lock);
    kb0 = await S(p);
    await inputMove(p, T, ck.i, 0, 'tap'); await p.waitForTimeout(220);
    const cc = await p.evaluate(k => document.querySelector('.car[data-id="' + k + '"]').classList.contains('key-call'), ck.lockBy);
    check(ck.locked && cc && same((await S(p)).pos, kb0.pos), 'chain: the padlocked key car (' + ck.l + ', ' + ck.key + ' key, ' + ck.lock + ' padlock) is locked too; tapping it calls the ' + ck.lock + ' key car');
  }
  }

  console.log('\n# Phone: all ' + NLEV + ' levels with taps + swipes, no boosters');
  await seeded(p, null);
  await winAll(p, T, 'phone');
  t = await seeded(p, await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))));
  check(t.open.length === NLEV && t.stars.every(s => s === '\u2605\u2605\u2605'), 'after winning all ' + NLEV + ': everything open with 3 stars, coins ' + t.stored.coins);
  await shot(p, 'v4-12-phone-level-select.png');

  /* ----------------------- PROGRESS MIGRATION ----------------------- */
  console.log('\n# Saved-progress migration (seeded localStorage)');
  const v3ids = LV.slice(0, 23).filter(l => l.mode !== 'scramble').map(l => l.id);   // the 20 levels a v3 save knew
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
  check(same(t.open, range(1, KEYS[0])) && t.current === 12, 'v3 save with all 20 beaten: the old 23 open plus the first new level ' + KEYS[0] + ', Continue = the first unplayed Scramble level (12)');
  // F2: a v4 save that finished the old last level (lv10-school, then the end of the list) gets the first new level
  t = await seeded(p, v4save({ unlocked: 22, unlockedId: 'lv10-school', stars: starsFor(LVS.slice(0, 23).map(l => l.id)) }));
  check(same(t.open, range(1, KEYS[0])) && t.current === KEYS[0] && t.stored.unlockedId === LVS[KEYS[0] - 1].id, 'v4 save that beat all 23 old levels: level ' + KEYS[0] + ' (new) opens and is Continue; migrated by id (' + t.stored.unlockedId + ')');
  t = await seeded(p, v4save({ unlocked: 22, unlockedId: 'lv10-school', stars: starsFor(LVS.slice(0, 22).map(l => l.id)) }));
  check(same(t.open, range(1, 23)) && t.current === 23, 'v4 save that has NOT beaten level 23 yet: still stops at 23');
  // D: v3 starter-only player
  t = await seeded(p, { v: 3, unlocked: 2, stars: { 'st1-cat': 3, 'st2-dog': 3 }, best: {}, sound: true });
  check(same(t.open, [1, 2, 3]) && t.current === 3, 'v3 save (beat starters 1-2): levels 1-3 open, Continue = level 3');
  // E: v2 save (no version): beat BUS, CAR, PLANET
  t = await seeded(p, { unlocked: 3, stars: { 'lv1-bus': 3, 'lv2-car': 2, 'lv3-planet': 1 }, best: {}, sound: true });
  check(same(t.open, range(1, 15)) && t.current === 15, 'v2 save (beat BUS, CAR, PLANET): levels 1-15 open, Continue = APPLE (15)');
  // F: v4 save keeps coins and the seen flag
  t = await seeded(p, v4save({ unlocked: 5, coins: 321, stars: starsFor(v3ids.slice(0, 5)), unlockedId: 'st6-milk', seen: {} }));
  check(same(t.open, range(1, 6)) && t.stored.coins === 321 && (await p.textContent('#title-coins')).trim() === '321', 'v4 save: coins (321) and progress load unchanged');
  /* ----------------------- SETTINGS + TEST MODE ----------------------- */
  console.log('\n# Settings / test (cheat) options');
  const REAL = { v: 4, unlocked: 2, unlockedId: 'st3-sun', stars: { 'st1-cat': 3, 'st2-dog': 2 }, best: { 'st1-cat': 3 }, sound: false, coins: 345, seen: {} };
  t = await seeded(p, REAL);
  const real0 = await p.evaluate(() => localStorage.getItem('wordJamBus.progress.v1'));
  const testStore = () => p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.test.v1') || 'null'));
  check(same(t.open, [1, 2, 3]) && (await p.textContent('#title-coins')).trim() === '345' && !(await p.locator('#screen-title .test-badge').isVisible()), 'real save: levels 1-3 open, 345 coins, no TEST MODE tag');
  const gear = await p.locator('#btn-settings').boundingBox();
  check(gear.width >= 44 && gear.height >= 44, 'gear button on the title screen is a 44px target');
  await tapEl(p, T, '#btn-settings'); await p.waitForSelector('#ov-settings.show'); await p.waitForTimeout(300);
  const TKEYS = ['unlockAll', 'unlimitedCoins', 'unlimitedHints', 'unlimitedUndos'];
  const offState = await p.evaluate(keys => ({ on: keys.filter(k => document.getElementById('test-' + k).checked).length, h: document.querySelector('.set-test h3').textContent, n: document.querySelectorAll('#test-toggles .set-row').length,
    labels: [...document.querySelectorAll('#test-toggles .set-label b')].map(e => e.textContent).join(', ') }), TKEYS);
  check(offState.on === 0 && /Test \/ cheat options/i.test(offState.h) && offState.n === 4, 'settings: "Test / cheat options" section with 4 toggles, all off (' + offState.labels + ')');
  await shot(p, 'v6-settings-toggles-off.png');
  const sw = await p.evaluate(() => [...document.querySelectorAll('.switch')].map(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height); }));
  check(Math.min(...sw) >= 44, 'toggle switches are >= 44px targets');
  for (let k = 1; k <= 4; k++) { await p.locator('#test-toggles .set-row:nth-child(' + k + ') .switch').scrollIntoViewIfNeeded(); await tapEl(p, T, '#test-toggles .set-row:nth-child(' + k + ') .switch'); await p.waitForTimeout(150); }
  let ts = await testStore();
  check(ts && TKEYS.every(k => ts[k] === true), 'all 4 toggles on, saved separately under wordJamBus.test.v1');
  await p.evaluate(() => { document.querySelector('.settings-card').scrollTop = 0; });
  check(await p.evaluate(() => localStorage.getItem('wordJamBus.progress.v1')) === real0, 'turning cheats on does not touch the real save');
  await shot(p, 'v6-settings-toggles-on.png');
  await tapEl(p, T, '#btn-settings-close'); await p.waitForTimeout(250);
  t = await p.evaluate(() => ({ open: [...document.querySelectorAll('.lvl')].filter(b => !b.disabled).length, cheat: [...document.querySelectorAll('.lvl.cheat')].map(b => +b.getAttribute('data-level')), coins: document.getElementById('title-coins').textContent }));
  check(t.open === NLEV && same(t.cheat, range(4, NLEV)) && t.coins === '\u221e' && await p.locator('#screen-title .test-badge').isVisible(), 'unlock all: all ' + NLEV + ' open (4-' + NLEV + ' marked as test-opened), coins show \u221e, TEST MODE tag on the title');
  sel = await fitCheck(p);
  check(sel.fits && sel.scroll, 'level select with unlock-all still fits without scrolling');
  await shot(p, 'v6-level-select-unlock-all.png');
  // a test-opened level: playable, but off the record
  await tapEl(p, T, '.lvl[data-level="12"]'); await p.waitForTimeout(800);
  check(await p.locator('#ov-coach.show').count() === 1 && await p.locator('.hud-mid .test-badge').isVisible(), 'test-opened level 12 starts (Scramble tip shows); TEST MODE tag in the HUD');
  await tapEl(p, T, '#btn-coach'); await p.waitForTimeout(300);
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 8000 }).catch(() => {});
  check(await p.locator('#ov-win.show').count() === 1 && /TEST MODE: not saved/.test(await p.textContent('#win-detail')) && (await p.getAttribute('#win-coins', 'data-earned')) === '0',
    'winning a test-opened level: "TEST MODE: not saved", 0 coins banked');
  check(await p.evaluate(() => localStorage.getItem('wordJamBus.progress.v1')) === real0, 'real save unchanged after that win (no stars, unlock, coins or tip flag)');
  // a free booster on a really-unlocked level, then win: also off the record
  await openLevel(p, 3);
  check((await p.textContent('#coin-count')).trim() === '\u221e' && await p.evaluate(() => ['tow', 'bay', 'nudge', 'flip'].every(k => document.querySelector('#bst-' + k + ' .bst-price').textContent.trim() === 'Free')), 'unlimited coins: bar shows \u221e and every booster reads "Free"');
  await tapEl(p, T, '#bst-bay'); await p.waitForSelector('#ov-shop.show'); await p.waitForTimeout(300);
  check(/Use Bay \+1 for free\?/.test(await p.textContent('#confirm-title')), 'confirm under unlimited coins: "Use Bay +1 for free?"');
  await tapEl(p, T, '#btn-confirm'); await p.waitForTimeout(300);
  cs = await S(p);
  check(cs.used.bay === 1 && cs.cap === 5 && cs.coins === 345, 'free Bay +1 applied; real balance untouched (345)');
  await tapEl(p, T, '#btn-undo'); await settle(p);
  check((await S(p)).coins === 345 && (await S(p)).used.bay === 0, 'Undo of a free booster refunds nothing (still 345)');
  await buy(p, T, 'nudge');
  const nf = await p.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine; let best = -1, bp = 99; for (let i = 0; i < s.game.n; i++) for (const w of [0, 1]) { const to = E.nudgeTo(s.game, s.state, i, w); if (to === null) continue; const st = E.applyBooster(s.game, s.state, 'nudge', i, w), q = E.solve(s.game, st).par; if (q !== null && q < bp) { bp = q; best = [i, w]; } } return best; });
  await inputMove(p, T, nf[0], nf[1], nf[1] ? 'swipe' : 'tap'); await settle(p);
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 8000 }).catch(() => {});
  check(await p.locator('#ov-win.show').count() === 1 && /not saved/.test(await p.textContent('#win-detail')), 'a win with a free booster is off the record');
  check(await p.evaluate(() => localStorage.getItem('wordJamBus.progress.v1')) === real0, 'real save still byte-identical');
  // turn everything off: the real state returns exactly
  await p.goto(URL); await p.waitForSelector('#screen-title.active');
  await tapEl(p, T, '#btn-settings'); await p.waitForSelector('#ov-settings.show'); await p.waitForTimeout(300);
  await tapEl(p, T, '#btn-test-off'); await p.waitForTimeout(200);
  ts = await testStore();
  check(ts.unlockAll === false && ts.unlimitedCoins === false && await p.locator('#btn-test-off[disabled]').count() === 1, '"Turn all test options off" clears both toggles');
  await tapEl(p, T, '#btn-settings-close'); await p.waitForTimeout(200);
  t = await (async () => { await p.goto(URL); await p.evaluate(sv => { localStorage.setItem('wordJamBus.progress.v1', sv); localStorage.setItem('wordJamBus.test.v1', JSON.stringify({ unlockAll: false, unlimitedCoins: false })); }, real0); await p.reload(); await p.waitForSelector('#screen-title.active');
    return p.evaluate(() => ({ open: [...document.querySelectorAll('.lvl')].filter(b => !b.disabled).map(b => +b.getAttribute('data-level')), coins: document.getElementById('title-coins').textContent, cheat: document.querySelectorAll('.lvl.cheat').length, badge: getComputedStyle(document.querySelector('#screen-title .test-badge')).display })); })();
  check(same(t.open, [1, 2, 3]) && t.coins === '345' && t.cheat === 0 && t.badge === 'none', 'cheats off: levels 1-3 open again, 345 coins, no TEST MODE tag');
  // a real win while unlimited coins is on: stars count, fares are not banked
  await p.evaluate(() => localStorage.setItem('wordJamBus.test.v1', JSON.stringify({ unlimitedCoins: true })));
  await p.reload(); await p.waitForSelector('#screen-title.active');
  await openLevel(p, 3);
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 8000 }).catch(() => {});
  let stored = await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1')));
  check(stored.stars['st3-sun'] === 3 && stored.coins === 345 && stored.unlocked === 3 && /not banked/.test(await p.textContent('#win-coins')), 'real level won with unlimited coins on (no booster): 3 stars + unlock saved, coins not banked (345)');
  await p.evaluate(() => localStorage.setItem('wordJamBus.test.v1', JSON.stringify({ unlimitedCoins: false })));
  await p.goto(URL); await p.reload(); await p.waitForSelector('#screen-title.active');
  check((await p.textContent('#title-coins')).trim() === '345', 'unlimited off: the real 345 coins are back');
  // unlimited hints + undos: never run out, \u221e badges; using more than the normal count keeps the win off the record
  await p.evaluate(() => localStorage.setItem('wordJamBus.test.v1', JSON.stringify({ unlimitedHints: true, unlimitedUndos: true })));
  await p.reload(); await p.waitForSelector('#screen-title.active');
  check(await p.locator('#screen-title .test-badge').isVisible(), 'unlimited hints/undos alone light the TEST MODE tag');
  await openLevel(p, 4);
  check((await p.textContent('#undo-count')).trim() === '\u221e' && (await p.textContent('#hint-count')).trim() === '\u221e' && await p.locator('#undo-count.inf').count() === 1 && await p.locator('.hud-mid .test-badge').isVisible(), 'undo and hint buttons show an \u221e badge; TEST MODE in the HUD');
  const m1 = (await p.evaluate(() => window.WJB.solution()))[0];
  for (let k = 0; k < 7; k++) { await inputMove(p, T, m1.car, m1.which, m1.which ? 'swipe' : 'tap'); await settle(p); await tapEl(p, T, '#btn-undo'); await settle(p); }
  cs = await S(p);
  check(cs.moves === 0 && cs.undos === 5 && await p.evaluate(() => window.WJB.session.undosUsed) === 7, 'unlimited undos: 7 undos used, the count never drops');
  for (let k = 0; k < 4; k++) {
    await tapEl(p, T, '#btn-hint');
    await p.waitForFunction(() => document.querySelector('.car.hint'), null, { timeout: 15000 }).catch(() => {});
    await p.evaluate(() => document.querySelectorAll('.car.hint').forEach(e => e.classList.remove('hint')));
    await p.waitForTimeout(150);
  }
  check(await p.evaluate(() => window.WJB.session.hintsUsed) === 4 && (await S(p)).hints === 3 && !(await p.locator('#btn-hint').isDisabled()), 'unlimited hints: 4 hints shown, still available');
  await buy(p, T, 'bay');
  check((await S(p)).coins === 245, 'a real-coin booster under unlimited undos: Bay +1 costs 100 (245 left)');
  await tapEl(p, T, '#btn-undo'); await settle(p);
  check((await S(p)).coins === 345 && (await S(p)).used.bay === 0, 'undoing it under unlimited undos still refunds the 100 coins (345)');
  await playPath(p, T, await p.evaluate(() => window.WJB.solution()));
  await p.waitForSelector('#ov-win.show', { timeout: 8000 }).catch(() => {});
  stored = await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1')));
  check(/not saved/.test(await p.textContent('#win-detail')) && !stored.stars['st4-hat'] && stored.coins === 345, 'a win that needed more than 5 undos / 3 hints is not saved (no stars, coins 345)');
  await p.evaluate(() => localStorage.setItem('wordJamBus.test.v1', JSON.stringify({ unlimitedHints: false, unlimitedUndos: false })));
  await p.reload(); await p.waitForTimeout(300);
  await openLevel(p, 4);
  check((await p.textContent('#undo-count')).trim() === '5' && (await p.textContent('#hint-count')).trim() === '3' && await p.locator('.badge.inf').count() === 0 && !(await p.locator('.hud-mid .test-badge').isVisible()), 'toggles off: the next level starts with the normal 5 undos and 3 hints');
  await p.goto(URL); await p.waitForSelector('#screen-title.active');
  // How to play + Sound live in settings; Reset is separate and asks first
  await tapEl(p, T, '#btn-settings'); await p.waitForSelector('#ov-settings.show'); await p.waitForTimeout(300);
  await tapEl(p, T, '#btn-reset'); await p.waitForTimeout(150);
  check(await p.locator('#reset-confirm.show').count() === 1, 'Reset asks for confirmation first');
  await tapEl(p, T, '#btn-reset-cancel'); await p.waitForTimeout(150);
  stored = await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1')));
  check(stored.coins === 345 && stored.stars['st3-sun'] === 3, 'Cancel keeps the progress');
  await tapEl(p, T, '#btn-reset'); await p.waitForTimeout(150); await tapEl(p, T, '#btn-reset-yes'); await p.waitForTimeout(200);
  stored = await p.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1')));
  check(stored.coins === 0 && Object.keys(stored.stars).length === 0 && stored.unlocked === 0, 'Yes, reset: progress and coins cleared');
  await tapEl(p, T, '#btn-howto'); await p.waitForSelector('#ov-howto.show');
  check(true, 'How to play opens from settings');
  await tapEl(p, T, '#btn-howto-close'); await p.waitForTimeout(150);
  await tapEl(p, T, '#btn-settings-close');
  await phone.close();

  /* ------------------------------ SMALL PHONE 375x667 ------------------------------ */
  console.log('\n# Small phone 375x667 (touch)');
  const small = await browser.newContext({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const sp = await small.newPage();
  watch(sp, 'small');
  const ST = { touch: true, cdp: await small.newCDPSession(sp) };
  await seeded(sp, v4save({ coins: 400, stars: starsFor(v3ids.slice(0, 12)) }));
  sel = await fitCheck(sp);
  check(sel.fits && sel.footFits && sel.scroll && sel.minH >= 40, '375x667: all ' + NLEV + ' level buttons + footer fit without scrolling (' + sel.rows + ' rows, buttons ' + Math.round(sel.minW) + 'x' + Math.round(sel.minH) + 'px)');
  await shot(sp, 'v4-14-small-phone-375x667-level-select.png');
  await seeded(sp, v4save({ coins: 400, stars: starsFor(v3ids.slice(0, 12)), unlocked: NLEV - 1, unlockedId: LAST_ID }));
  for (const n of [17, 22, 23].concat(KEYS)) {
    await openLevel(sp, n);
    const r = await layoutOk(sp, '375x667 L' + n);
    if (n === 23) await shot(sp, 'v4-13-small-phone-375x667-level23.png');
    check(r.minCar >= 34, '375x667 L' + n + ': cars are >= 34px targets (' + Math.round(r.minCar) + 'px)');
  }
  for (const n of [22, 23]) { await openLevel(sp, n); await barCheck(sp, '375x667 L' + n); }
  await shot(sp, 'v6-play-booster-bar-375x667.png');
  await tapEl(sp, ST, '#bst-flip'); await sp.waitForSelector('#ov-shop.show'); await sp.waitForTimeout(300);
  check(await sp.evaluate(() => { const r = document.querySelector('.shop-card').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), '375x667: booster confirm sheet fits on screen');
  await tapEl(sp, ST, '#btn-confirm'); await sp.waitForTimeout(300);
  check(await sp.evaluate(() => { const b = document.getElementById('btn-boost-cancel').getBoundingClientRect(); return b.height >= 44 && b.bottom <= innerHeight; }), "375x667: pick-a-car Cancel bar replaces the booster bar (Cancel >= 44px)");
  await tapEl(sp, ST, '#btn-boost-cancel'); await sp.waitForTimeout(250);
  check(await sp.locator('#boost-bar.show').count() === 0 && (await S(sp)).coins === 400, 'Cancel leaves pick mode with no charge');
  await seeded(sp, v4save({}));
  await sp.waitForTimeout(300);
  await sp.goto(URL + '#level-1'); await sp.reload(); await sp.waitForTimeout(800);
  await layoutOk(sp, '375x667 L1');
  await small.close();

  /* ------------------------------ DESKTOP ------------------------------ */
  console.log('\n# Desktop 1280x800 (mouse)');
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const d = await desk.newPage();
  watch(d, 'desktop');
  const M = { touch: false };
  t = await seeded(d, null);
  sel = await fitCheck(d);
  check(sel.fits && sel.scroll && t.open.length === 1, 'desktop level select shows all ' + NLEV + ' levels without scrolling');
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
  {  // v7: keys on desktop (mouse)
  await seeded(d, v4save({ coins: 500, unlocked: NLEV - 1, unlockedId: LAST_ID }));
  await openLevel(d, KEYS[1]);
  let dl = await lockInfo(d);
  const dL = dl.find(c => c.locked);
  const dkb = await S(d);
  await inputMove(d, M, dL.i, 0, 'click'); await d.waitForTimeout(220);
  const dfb = await d.evaluate(([l, k]) => ({ wig: document.querySelector('.car[data-id="' + l + '"]').classList.contains('lock-wiggle'), call: document.querySelector('.car[data-id="' + k + '"]').classList.contains('key-call') }), [dL.i, dL.lockBy]);
  check(dfb.wig && dfb.call && same((await S(d)).pos, dkb.pos), 'desktop: clicking a padlocked car wiggles its padlock and calls the key car, no move');
  await layoutOk(d, 'desktop key level ' + KEYS[1]);
  await shot(d, 'v7-desktop-key-level.png');
  }
  console.log('\n# Desktop: all ' + NLEV + ' levels with clicks + mouse drags, no boosters');
  await winAll(d, M, 'desktop');
  t = await seeded(d, await d.evaluate(() => JSON.parse(localStorage.getItem('wordJamBus.progress.v1'))));
  await shot(d, 'v4-15-desktop-level-select.png');
  await openLevel(d, 22);
  const sol22 = await d.evaluate(() => window.WJB.solution());
  for (const m of sol22.slice(0, 6)) { await inputMove(d, M, m.car, m.which, m.which === 1 ? 'drag' : 'click'); await settle(d); }
  await shot(d, 'v4-16-desktop-scramble-midplay.png');
  await barCheck(d, 'desktop L22');
  await shot(d, 'v6-play-booster-bar-desktop.png');
  await d.click('#bst-nudge'); await d.waitForSelector('#ov-shop.show');
  await shot(d, 'v4-17-desktop-booster-confirm.png');
  await d.click('#btn-confirm'); await d.waitForTimeout(200);
  const dn = await d.evaluate(() => { const s = window.WJB.session, E = window.WJBEngine; for (let i = 0; i < s.game.n; i++) if (s.state.pos[i] >= 0 && E.nudgeTo(s.game, s.state, i, 0) !== null) return i; return -1; });
  const dnb = await S(d);
  await inputMove(d, M, dn, 0, 'click'); await settle(d);
  const dna = await S(d);
  check(dna.pos[dn] === dnb.pos[dn] + (await d.evaluate(id => window.WJB.session.game.cars[id].sign, dn)) && dna.coins === dnb.coins - 60, 'desktop: a click nudges a car exactly one cell forward (60 coins)');
  // v6b: desktop Flip keeps its new look too (mouse)
  await seeded(d, v4save({ coins: 1000 }));
  await openLevel(d, 13);
  const dq0 = await orientOf(d, 0);
  await flipVia(d, M, 0);
  const dq1 = await orientOf(d, 0);
  await tapEl(d, M, '#btn-undo'); await settle(d); await d.waitForTimeout(300);
  const dq2 = await orientOf(d, 0);
  check(orientOk(dq1) && dq1.arrow !== dq0.arrow && orientOk(dq2) && dq2.arrow === dq0.arrow, 'desktop: flipped car stays flipped on screen (' + dq0.arrow + ' -> ' + dq1.arrow + '), Undo turns it back (' + dq2.arrow + ')');
  await desk.close();
  await browser.close();

  console.log('\n# Console / page errors');
  errors.forEach(e => console.log('  ' + e));
  check(errors.length === 0, 'no console errors, page errors or failed requests');
  console.log('\n' + passes + ' passed, ' + failures + ' failed');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
