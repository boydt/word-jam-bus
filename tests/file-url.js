#!/usr/bin/env node
// Smoke test: the game runs when index.html is opened directly from disk (file://), no server.
// Wins level 1 with real mouse input: click = forward, right-click = reverse.
'use strict';
const path = require('path');
const { chromium } = require('playwright');
(async () => {
  const errors = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('file://' + path.join(__dirname, '..', 'index.html'));
  await page.click('#btn-play');                    // v8: Play opens the city map...
  await page.waitForSelector('#screen-map.active');
  const NLEV = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'levels', 'levels.json'), 'utf8')).levels.length;
  if (await page.locator('.lvl.stop').count() !== NLEV) errors.push('map does not list ' + NLEV + ' stops');
  if (await page.locator('.lvl.stop .tier-stop').count() !== NLEV) errors.push('map stops lack difficulty badges');
  await page.click('#btn-map-play');                // ...and "Play stop 1" starts level 1
  await page.waitForSelector('#screen-game.active');
  await page.waitForTimeout(700);
  for (const m of await page.evaluate(() => window.WJB.solution())) {
    await page.locator('.car[data-id="' + m.car + '"]').click(m.which === 1 ? { button: 'right' } : {});
    await page.evaluate(() => window.WJB.idle());
    await page.waitForTimeout(200);
  }
  await page.waitForSelector('#ov-win.show', { timeout: 4000 });
  await browser.close();
  console.log(errors.length ? 'FAIL file:// errors: ' + errors.join('; ') : 'PASS file:// opens and the city map opens, level 1 is winnable, no errors');
  process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
