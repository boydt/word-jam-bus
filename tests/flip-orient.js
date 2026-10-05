// Flip orientation check (v6b): flips level-23 (CAR, level 13 before v9) car 0 at phone 390x844 (touch) and desktop 1280x800 (mouse) and measures the
// RENDERED direction of its nose arrow, headlights, windshield and tail lights before, mid-turn, settled, and after Undo.
// Usage: node tests/flip-orient.js [baseURL, default http://127.0.0.1:8765/index.html] [screenshot prefix, or - for none]
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/index.html', PRE = process.argv[3] || '-';
const ORIENT = id => { const el = document.querySelector('.car[data-id="' + id + '"]'), c = el.getBoundingClientRect();
  const ctr = r => [r.left + r.width / 2, r.top + r.height / 2], cc = ctr(c);
  const side = sel => { const [x, y] = ctr(el.querySelector(sel).getBoundingClientRect()), dx = x - cc[0], dy = y - cc[1];
    return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'); };
  const opp = { right: 'left', left: 'right', up: 'down', down: 'up' };
  return { dataDir: el.getAttribute('data-dir'), arrow: side('.arrow'), lights: side('.lights'), glass: side('.glass'), tail: opp[side('.tail')], game: window.WJB.session.game.cars[id].dir }; };
(async () => {
  const b = await chromium.launch();
  for (const mode of ['phone', 'desktop']) {
    const c = await b.newContext(mode === 'phone' ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 800 } });
    const p = await c.newPage(), errs = []; p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(BASE); await p.evaluate(() => localStorage.setItem('wordJamBus.progress.v1', JSON.stringify({ v: 4, unlocked: 22, unlockedId: 'lv10-school', stars: {}, best: {}, sound: false, coins: 1000, seen: { 'sc1-pizza': 1, 'sc2-jungle': 1, 'sc3-dragons': 1 } })));
    await p.goto(BASE + '#level-23'); await p.reload(); await p.waitForSelector('#screen-game.active'); await p.waitForTimeout(900);
    if (await p.locator('#ov-coach.show').count()) await p.click('#btn-coach');
    const act = async sel => mode === 'phone' ? p.tap(sel) : p.click(sel);
    const before = await p.evaluate(ORIENT, 0);
    const clip = await p.evaluate(() => { const r = document.getElementById('lot').getBoundingClientRect(); return { x: r.left - 6, y: r.top - 6, width: r.width + 12, height: r.height + 12 }; });
    if (PRE !== '-') await p.screenshot({ path: PRE + mode + '-1-before.png', clip });
    await act('#bst-flip'); await p.waitForSelector('#ov-shop.show'); await p.waitForTimeout(300); await act('#btn-confirm'); await p.waitForTimeout(300);
    await act('.car[data-id="0"]'); await p.waitForTimeout(210);
    const mid = await p.evaluate(ORIENT, 0);
    if (PRE !== '-') await p.screenshot({ path: PRE + mode + '-2-mid-animation.png', clip });
    await p.waitForTimeout(1000);
    const settled = await p.evaluate(ORIENT, 0);
    if (PRE !== '-') await p.screenshot({ path: PRE + mode + '-3-settled.png', clip });
    await act('#btn-undo'); await p.waitForTimeout(800);
    const undone = await p.evaluate(ORIENT, 0);
    if (PRE !== '-') await p.screenshot({ path: PRE + mode + '-4-after-undo.png', clip });
    console.log(mode, JSON.stringify({ before, mid, settled, undone, errs }));
    const ok = o => o.arrow === o.game && o.lights === o.game && o.glass === o.game && o.tail === o.game && o.dataDir === o.game;
    const opp = { right: 'left', left: 'right', up: 'down', down: 'up' };
    const pass = ok(before) && ok(settled) && settled.arrow === opp[before.arrow] && ok(undone) && undone.arrow === before.arrow && !errs.length;
    console.log((pass ? 'PASS ' : 'FAIL ') + mode + ': before ' + before.arrow + ', settled after flip ' + settled.arrow + ' (model ' + settled.game + '), after undo ' + undone.arrow + ', errors ' + errs.length);
    if (!pass) process.exitCode = 1;
    await c.close();
  }
  await b.close();
})();
