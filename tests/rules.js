#!/usr/bin/env node
/*
 * Rule tests for js/engine.js (Node, no dependencies): Scramble boarding,
 * Bay Word clearing (incl. before the bay-full loss), boosters, keys and
 * padlocks, and a randomised JS-vs-Python par cross-check on small lots
 * with Bay Words and padlocks.
 *   node tests/rules.js            (add --no-py to skip the Python fuzz)
 */
'use strict';
const E = require('../js/engine.js');
const fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
let pass = 0, fail = 0;
function check(c, msg) { if (c) { pass++; console.log('  PASS ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
const lot = (word, cars, extra) => Object.assign({ id: 't', word, grid: [4, 4], bay: 3, cars }, extra || {});
const out = (g, s, i) => E.step(g, s, i, E.FWD);

console.log('# Scramble boarding');
{ // every car faces right in its own row, all lanes clear
  const g = E.prepare(lot('ABA', [{ l: 'B', r: 1, c: 4, dir: 'right' }, { l: 'A', r: 2, c: 4, dir: 'right' }, { l: 'A', r: 3, c: 4, dir: 'right' }, { l: 'A', r: 4, c: 4, dir: 'right' }], { mode: 'scramble' }));
  let s = E.initialState(g), r = out(g, s, 0);
  check(r.result === 'fill' && r.slot === 1 && r.state.mask === 2, 'B boards straight into seat 2 (any order)');
  r = out(g, r.state, 1); check(r.result === 'fill' && r.slot === 0, 'first A takes the leftmost open A seat');
  r = out(g, r.state, 2); check(r.result === 'fill' && r.slot === 2 && r.won, 'second A fills the last seat: won');
  r = out(g, E.step(g, E.step(g, E.step(g, s, 1, 0).state, 2, 0).state, 3, 0).state, 0, 0);
  check(r.result === 'fill' && r.won, 'surplus A cars: the extra copy...');
  const s3 = E.step(g, E.step(g, s, 1, 0).state, 2, 0).state, r3 = out(g, s3, 3);
  check(r3.result === 'bay' && r3.state.bay.join('') === 'A', '...an extra copy whose seats are full goes to the bay');
  check(E.step(g, r3.state, 0, 0).won && E.step(g, r3.state, 0, 0).state.bay.length === 1, 'the bay never boards in Scramble (junk stays junk)');
  let threw = false; try { E.prepare(lot('AB', [{ l: '?', r: 1, c: 4, dir: 'right' }], { mode: 'scramble' })); } catch (e) { threw = true; }
  check(threw, 'scramble levels reject "?" taxis');
}

console.log('# Bay Word');
{
  const cars = [{ l: 'C', r: 1, c: 4, dir: 'right' }, { l: 'A', r: 2, c: 4, dir: 'right' }, { l: 'T', r: 3, c: 4, dir: 'right' }, { l: 'X', r: 4, c: 4, dir: 'right' }, { l: 'Z', r: 4, c: 1, dir: 'up' }];
  const g = E.prepare(lot('XZ', cars, { bay: 3 }));
  let s = E.initialState(g);
  s = out(g, s, 0).state; s = out(g, s, 1).state;
  const r = out(g, s, 2);
  check(r.result === 'bay' && r.cleared.length === 1 && r.cleared[0].word === 'CAT' && r.state.bay.length === 0 && r.state.words === 1, 'T completes C-A-T in a 3-spot bay: the word clears and the bay is empty');
  const g2 = E.prepare(lot('XZ', cars, { bay: 2 }));
  let t = E.initialState(g2); t = out(g2, t, 0).state; t = out(g2, t, 1).state;
  const r2 = out(g2, t, 2);
  check(r2.result === 'bay' && r2.cleared[0].word === 'CAT', 'bay FULL (2/2) + T spells CAT: Bay Word is checked before the bay-full loss, no loss');
  const order = E.initialState(g); let o = out(g, order, 2).state; o = out(g, o, 1).state; const r3 = out(g, o, 0);
  check(r3.cleared.length === 1 && r3.state.bay.length === 0 && r3.cleared[0].word === 'ACT', 'order in the bay does not matter (T, A, C also clears; shown as ACT)');
  const gOff = E.prepare(lot('XZ', cars, { bay: 2 }), { bayWords: false });
  let u = E.initialState(gOff); u = out(gOff, u, 0).state; u = out(gOff, u, 1).state;
  check(out(gOff, u, 2).result === 'lose', 'same move with the Bay Word rule off is a loss');
  // a letter the word still needs is never used: word TXZ, T waits in the bay for its seat
  const g3 = E.prepare(lot('XTZ', cars, { bay: 3 }));
  let w = E.initialState(g3); w = out(g3, w, 2).state; w = out(g3, w, 0).state; const r4 = out(g3, w, 1);
  check(r4.result === 'bay' && r4.cleared.length === 0 && r4.state.bay.length === 3, 'a parked letter the word still needs (T of XTZ) is never used in a Bay Word');
  const g4 = E.prepare(lot('XTZ', cars.concat([{ l: 'T', r: 1, c: 1, dir: 'left' }]), { bay: 3 }));
  let v = E.initialState(g4); v = out(g4, v, 2).state; v = out(g4, v, 5).state; v = out(g4, v, 0).state;
  const r5 = out(g4, v, 1);
  check(r5.cleared.length === 1 && r5.state.bay.join('') === 'T', 'an EXTRA copy of a needed letter can be used (two Ts parked, one is spare): CAT clears, one T stays');
  check(E.solve(g2).par !== null, 'solver models it: the 2-spot level is solvable');
}

console.log('# Boosters');
{
  const lv = { id: 'b', word: 'AB', grid: [3, 3], bay: 1, cars: [{ l: 'A', r: 1, c: 2, dir: 'right' }, { l: 'X', r: 1, c: 3, dir: 'right' }, { l: 'B', r: 3, c: 1, dir: 'up' }, { l: 'A', r: 2, c: 1, dir: 'up' }] };
  const g = E.prepare(lv), s = E.initialState(g);
  check(E.towable(g, s, 1), 'tow: a decoy (X) can be towed');
  check(!E.towable(g, s, 2), 'tow: the only B cannot be towed');
  check(E.towable(g, s, 0) && E.towable(g, s, 3), 'tow: either A can be towed (a spare copy exists)');
  const t = E.applyBooster(g, s, 'tow', 1);
  check(t.pos[1] === -1 && t.moves === 1 && t.used.tow === 1 && t.bay.length === 0, 'towing removes the car, costs 1 move, never uses the bay');
  check(!E.towable(g, E.applyBooster(g, s, 'tow', 0), 3), 'after towing one A the other A is no longer spare');
  const b = E.applyBooster(g, s, 'bay');
  check(b.cap === 2 && b.moves === 0 && E.applyBooster(g, b, 'bay') === null, 'Bay +1: one extra spot, no move, once per level');
  check(E.applyBooster(g, s, 'nudge', 2, E.FWD) === null, 'nudge into an occupied cell is refused');
  check(E.applyBooster(g, s, 'nudge', 2, E.BACK) === null, 'nudge back into the wall is refused');
  const lv2 = { id: 'c', word: 'A', grid: [1, 4], bay: 1, cars: [{ l: 'A', r: 1, c: 1, dir: 'right' }, { l: 'X', r: 1, c: 4, dir: 'right' }] };
  const g2 = E.prepare(lv2), s2 = E.initialState(g2), n2 = E.applyBooster(g2, s2, 'nudge', 0, E.FWD);
  check(n2 && n2.pos[0] === 1 && n2.moves === 1, 'nudge moves exactly one cell (a normal slide would go 2)');
  check(E.step(g2, s2, 0, E.FWD).dist === 2, '(normal slide for comparison: 2 cells)');
  const g3 = E.prepare({ id: 'd', word: 'A', grid: [1, 2], bay: 1, cars: [{ l: 'A', r: 1, c: 2, dir: 'right' }] });
  check(E.applyBooster(g3, E.initialState(g3), 'nudge', 0, E.FWD) === null, 'nudge never drives a car out of the lot');
  check(E.solve(g, b).par !== null && E.createSearch(g, b).run(Infinity) === 'win', 'the solver re-plans from a boosted state (cap from the state)');
  // Flip: A faces right into X (which faces back at it from the wall), so A can never leave; flipped, it exits left.
  const gf = E.prepare({ id: 'f', word: 'A', grid: [1, 3], bay: 1, cars: [{ l: 'A', r: 1, c: 2, dir: 'right' }, { l: 'X', r: 1, c: 3, dir: 'left' }] });
  const sf = E.initialState(gf);
  check(E.solve(gf, sf).par === null, 'flip: the unflipped lot is unwinnable');
  const sf2 = E.applyBooster(gf, sf, 'flip', 0), gf2 = E.flipCar(gf, 0);
  check(sf2 && sf2.moves === 1 && sf2.used.flip === 1 && E.boosted(sf2) && sf2.pos[0] === sf.pos[0], 'flip: same cells, +1 move, counts as a booster');
  check(gf2.cars[0].dir === 'left' && gf2.cars[0].sign === -1 && gf.cars[0].dir === 'right' && gf2.cars[1] === gf.cars[1], 'flip returns a new game with only that car reversed (original untouched)');
  const ex = E.step(gf2, sf2, 0, E.FWD);
  check(ex.won && E.solve(gf2, sf2).par === 1, 'flipped car drives out of its former tail end; the solver re-plans with the new direction (par 1)');
  const gt = E.prepare({ id: 't', word: 'A', grid: [4, 1], bay: 1, cars: [{ l: 'TH', r: 3, c: 1, dir: 'down', len: 2 }, { l: 'A', r: 4, c: 1, dir: 'down' }] });
  const st = E.initialState(gt), gt2 = E.flipCar(gt, 0);
  check(String(E.buildGrid(gt, st.pos)) === String(E.buildGrid(gt2, st.pos)) && E.headCell(gt2, 0, st.pos[0]).r === 2, 'a 2-cell chunk truck flips in place (same cells, head moves to the old tail)');
  check(!E.flippable(gf2, ex.state, 0) && E.applyBooster(gf2, ex.state, 'flip', 0) === null, 'a car that has left the lot cannot be flipped');
}

console.log('# Keys and padlocks');
{
  // row 1: K (gold key) faces right, free to exit; row 2: L (gold padlock) faces right, free lane but locked
  const lv = { id: 'k', word: 'LK', grid: [3, 3], bay: 2, cars: [
    { l: 'K', r: 1, c: 3, dir: 'right', key: 'gold' }, { l: 'L', r: 2, c: 3, dir: 'right', lock: 'gold' },
    { l: 'M', r: 3, c: 2, dir: 'left', lock: 'gold' }, { l: 'X', r: 3, c: 1, dir: 'up' }] };
  const g = E.prepare(lv), s0 = E.initialState(g);
  check(g.cars[1].lockBy === 0 && g.cars[2].lockBy === 0 && g.hasLocks, 'prepare links each padlock to the key car of its colour');
  check(E.isLocked(g, s0.pos, 1) && E.isLocked(g, s0.pos, 2) && !E.isLocked(g, s0.pos, 0), 'locked while the key car is in the lot');
  const b = E.step(g, s0, 1, E.FWD), bb = E.step(g, s0, 1, E.BACK);
  check(b.result === 'bump' && b.locked && b.key === 0 && !b.state && bb.result === 'bump' && bb.locked, 'a padlocked car cannot exit or reverse (bump, locked, names the key car; no move)');
  check(E.probe(g, E.buildGrid(g, s0.pos), s0.pos, 1, E.FWD).locked === true, 'probe (preview) reports the padlock');
  const k = E.step(g, s0, 0, E.FWD);
  check(k.result === 'bay' && String(k.unlocked) === '1,2', 'the key car exits (to the bay) and reports the locks it opens: one key opens every lock of its colour');
  check(!E.isLocked(g, k.state.pos, 1) && !E.isLocked(g, k.state.pos, 2), 'after the key car leaves, both gold locks are open');
  const l = E.step(g, k.state, 1, E.FWD);
  check(l.result === 'fill' && l.state.idx === 2 && l.won, 'the unlocked car now drives out (L boards, K auto-boards from the bay: won)');
  check(E.isLocked(g, s0.pos, 1), 'undo = the previous state: the key car is back, so the lock is back');
  check(E.solve(g).par === 2 && E.solve(E.prepare(lv, { locks: false })).par === 2, 'solver: par 2 (key first)');
  // a chain: blue key car is itself padlocked gold
  const ch = { id: 'c', word: 'ABC', grid: [3, 3], bay: 3, cars: [
    { l: 'C', r: 1, c: 3, dir: 'right', key: 'gold' }, { l: 'B', r: 2, c: 3, dir: 'right', key: 'blue', lock: 'gold' }, { l: 'A', r: 3, c: 3, dir: 'right', lock: 'blue' }] };
  const gc = E.prepare(ch);
  const ignore = E.solve(E.prepare(ch, { locks: false })).par, real = E.solve(gc);
  check(ignore === 3 && real.par === 3 && String(real.path.map(m => m.car)) === '0,1,2', 'chain gold -> blue -> A: the only line is C, B, A (bay holds C and B)');
  const ch2 = Object.assign({}, ch, { bay: 1 });
  check(E.solve(E.prepare(ch2)).par === null && E.solve(E.prepare(ch2, { locks: false })).par === 3, 'with a 1-spot bay the chain is unwinnable, though ignoring locks it is 3: the solver respects locks');
  const bad = (cars, msg) => { let t = false; try { E.prepare({ id: 'x', word: 'A', grid: [3, 3], bay: 1, cars }); } catch (e) { t = /key|padlock|lock/.test(e.message); } check(t, msg); };
  bad([{ l: 'A', r: 1, c: 1, dir: 'up', lock: 'blue' }], 'a padlock with no key car of its colour is rejected');
  bad([{ l: 'A', r: 1, c: 1, dir: 'up', key: 'gold', lock: 'gold' }], 'a key car locked by its own key is rejected');
  bad([{ l: 'A', r: 1, c: 1, dir: 'up', key: 'gold', lock: 'blue' }, { l: 'B', r: 1, c: 2, dir: 'up', key: 'blue', lock: 'gold' }], 'a padlock cycle (gold <-> blue) is rejected');
  bad([{ l: 'A', r: 1, c: 1, dir: 'up', key: 'gold' }, { l: 'B', r: 1, c: 2, dir: 'up', key: 'gold' }], 'two key cars of one colour are rejected');
  bad([{ l: 'A', r: 1, c: 1, dir: 'up', key: 'red' }], 'an unknown key colour is rejected');
  // boosters
  check(!E.towable(g, s0, 1) && !E.towable(g, s0, 0) && E.towable(g, s0, 3), 'tow: refuses a padlocked car and the key car; a plain decoy is fine');
  const gn = E.prepare({ id: 'n', word: 'A', grid: [1, 4], bay: 1, cars: [{ l: 'K', r: 1, c: 4, dir: 'right', key: 'pink' }, { l: 'A', r: 1, c: 2, dir: 'left', lock: 'pink' }] });
  const sn = E.initialState(gn);
  check(E.nudgeTo(gn, sn, 1, E.BACK) === null && E.applyBooster(gn, sn, 'nudge', 1, E.BACK) === null, 'nudge: refused on a padlocked car (it has room)');
  check(!E.flippable(gn, sn, 1) && E.applyBooster(gn, sn, 'flip', 1) === null && E.flippable(gn, sn, 0), 'flip: refused on a padlocked car; the key car can flip');
  const sn2 = E.step(gn, sn, 0, E.FWD).state;
  check(E.nudgeTo(gn, sn2, 1, E.BACK) === 2 && E.flippable(gn, sn2, 1), 'once unlocked, nudge and flip work on it');
  check(E.applyBooster(gn, sn, 'bay') !== null, 'Bay +1 is unaffected by locks');
}

console.log('# JS vs Python on random small lots with Bay Words and padlocks');
if (process.argv.indexOf('--no-py') === -1) {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const lots = [];
  const words = ['TEN', 'MAP', 'SUN', 'BEE', 'TOOT'];
  for (let k = 0; lots.length < 90 && k < 6000; k++) {
    const word = words[k % words.length], occ = new Set(), cars = [];
    for (let q = 0; q < 40 && cars.length < 9; q++) {
      const dir = ['up', 'down', 'left', 'right'][Math.floor(rnd() * 4)], r = 1 + Math.floor(rnd() * 4), c = 1 + Math.floor(rnd() * 4), len = rnd() < 0.25 ? 2 : 1;
      const d = E.DIRS[dir], cells = [[r, c]]; if (len === 2) cells.push([r - d[0], c - d[1]]);
      if (!cells.every(x => x[0] >= 1 && x[0] <= 4 && x[1] >= 1 && x[1] <= 4 && !occ.has(x + ''))) continue;
      cells.forEach(x => occ.add(x + ''));
      const car = { l: 'AEOCTPDGN'[Math.floor(rnd() * 9)], r, c, dir }; if (len === 2) car.len = 2; cars.push(car);
    }
    word.split('').forEach((ch, i) => { if (cars[i]) cars[i].l = ch; });
    if (k % 3 !== 2 && cars.length >= 4) { // keys and padlocks on two lots in three: a gold key, 1-2 gold locks, sometimes a blue chain
      const order = cars.map((_, i) => i).sort(() => rnd() - 0.5);
      cars[order[0]].key = 'gold'; cars[order[1]].lock = 'gold'; if (rnd() < 0.5) cars[order[2]].lock = 'gold';
      if (rnd() < 0.4 && cars.length >= 5) { cars[order[1]].key = 'blue'; cars[order[3]].lock = 'blue'; }
    }
    const lv = { id: 'f' + k, word, grid: [4, 4], bay: 1 + (k % 3), cars };
    if (k % 2) lv.mode = 'scramble';
    try { const g = E.prepare(lv); const sol = E.solve(g, null, { maxStates: 200000 }); if (sol.status === 'limit') continue; lv.par = sol.par; lv.noLockPar = E.solve(E.prepare(lv, { locks: false }), null, { maxStates: 200000 }).par; lv.withWords = E.explore(g, 200000).bayWords; } catch (e) { continue; }
    lots.push(lv);
  }
  const tmp = path.join(os.tmpdir(), 'wjb-fuzz.json');
  fs.writeFileSync(tmp, JSON.stringify({ levels: lots }));
  const py = cp.spawnSync('python3', [path.join(__dirname, '..', 'tools', 'wjb_solver.py'), tmp], { encoding: 'utf8' });
  const lines = py.stdout.trim().split('\n');
  const parsePar = l => { const m = /par=(\w+)/.exec(l); return m ? (m[1] === 'None' ? null : +m[1]) : 'x'; };
  const agree = lots.every((lv, i) => parsePar(lines[i]) === lv.par);
  const withWord = lots.filter(lv => Object.keys(lv.withWords || {}).length).length;
  const locked = lots.filter(lv => lv.cars.some(c => c.lock)), lockMatters = locked.filter(lv => lv.par !== lv.noLockPar).length;
  check(lines.length === lots.length && agree, 'Python solver agrees with js/engine.js on ' + lots.length + ' random lots (' + locked.length + ' with padlocks, ' + lockMatters + ' where the locks change par, ' + lots.filter(l => l.mode).length + ' scramble, ' +
    withWord + ' with a reachable Bay Word, ' + lots.filter(l => l.par === null).length + ' unsolvable)');
  if (!agree) lots.forEach((lv, i) => { if (parsePar(lines[i]) !== lv.par) console.log('    ' + lv.id + ' js ' + lv.par + ' / ' + lines[i]); });
} else console.log('  (skipped)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
