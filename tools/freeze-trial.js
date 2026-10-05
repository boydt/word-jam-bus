#!/usr/bin/env node
/** Freeze trial pack level hashes into levels/shipped-trial.json */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const shipped = { format: 'wjb-shipped-trial/1', levels: {} };
['c01', 'c02', 'c03'].forEach(c => {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'levels', 'packs', c + '.json'), 'utf8'));
  pack.routes.forEach(r => r.levels.forEach(lv => {
    const copy = Object.assign({}, lv);
    delete copy.metrics; // metrics may be recomputed
    const h = crypto.createHash('sha256').update(JSON.stringify({
      id: lv.id, word: lv.word, grid: lv.grid, bay: lv.bay, par: lv.par, mode: lv.mode || null,
      cars: lv.cars, tip: lv.tip || null, teaches: lv.teaches || null
    })).digest('hex').slice(0, 16);
    shipped.levels[lv.id] = { hash: h, city: c, route: r.id, par: lv.par };
  }));
});
fs.writeFileSync(path.join(ROOT, 'levels', 'shipped-trial.json'), JSON.stringify(shipped, null, 1) + '\n');
console.log('froze', Object.keys(shipped.levels).length, 'trial levels');
