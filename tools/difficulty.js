#!/usr/bin/env node
/*
 * Word Jam Bus difficulty tiers (v9). Dev tool + shared module, no dependencies.
 *
 *   node tools/difficulty.js            print every level's metrics, score and tier
 *   node tools/difficulty.js --write    store the result in levels/levels.json as the
 *                                       generated "difficulty" field (then run
 *                                       node tools/verify-levels.js --write)
 *   node tools/difficulty.js --check    exit 1 if a stored difficulty does not match
 *
 * Inputs come from the solver (js/engine.js variety(), slack 2, so every state within
 * par + 2 moves is searched), never from a level's position:
 *   par    fewest moves to win;
 *   first  "first-move slack": the share of legal first moves after which the level can
 *          still be won within par + 1 moves (one spare move);
 *   track  "mid-game forgiveness": walking the solver's optimal line, the average share of
 *          legal moves at each step that still allow a win within par + 1 moves.
 * Why par + 1 and not par + 2: in these lots almost every slide can be undone by the
 * reverse slide, so a wasted move costs exactly 2 and nearly every non-losing move is
 * "fine" within par + 2 (the par + 2 shares are ~100% on easy and hard levels alike; they
 * are still measured and reported). One spare move only forgives moves that belong to
 * another real winning line, which is what makes a level forgiving or exacting.
 *
 *   score = par * (1 + 2 * (1 - track)) + 3 * (1 - first)
 *
 * so a level where every move keeps you on track scores its par, and one where only half
 * of the moves do scores double. Tiers (score ranges):
 *   1 Very Easy  < 7     2 Easy  7 - < 12     3 Normal  12 - < 18
 *   4 Hard       18 - < 60                    5 Super Hard  >= 60
 * The score is stored rounded to 0.1 and the tier is computed from the unrounded score.
 * Tiers may go up and down along the map. No overrides exist.
 */
'use strict';
var E = require('../js/engine.js');

var TIERS = [
  { tier: 1, label: 'Very Easy', below: 7 },
  { tier: 2, label: 'Easy', below: 12 },
  { tier: 3, label: 'Normal', below: 18 },
  { tier: 4, label: 'Hard', below: 60 },
  { tier: 5, label: 'Super Hard', below: Infinity }
];

/** Metrics + score + tier for one level object. Returns null if unsolvable or the search capped. */
function rate(lv, opts) {
  var v = E.variety(E.prepare(lv), { slack: 2, maxStates: (opts && opts.maxStates) || 2500000 });
  if (!v || !v.complete) return v ? { complete: false, par: v.par, states: v.states } : null;
  var first = v.firstMoves ? v.firstOkBySlack[1] / v.firstMoves : 0, track = v.midBySlack[1];
  var score = v.par * (1 + 2 * (1 - track)) + 3 * (1 - first);
  var t = TIERS.filter(function (x) { return score < x.below; })[0];
  return {
    complete: true, v: v, first: first, track: track, score: score, tier: t.tier, label: t.label,
    stored: { tier: t.tier, label: t.label, score: Math.round(score * 10) / 10,
      par: v.par, first: v.firstOkBySlack[1] + '/' + v.firstMoves, track: Math.round(track * 1000) / 1000 }
  };
}

module.exports = { TIERS: TIERS, rate: rate };

if (require.main === module) {
  var fs = require('fs'), path = require('path');
  var FILE = path.join(__dirname, '..', 'levels', 'levels.json');
  var raw = fs.readFileSync(FILE, 'utf8'), data = JSON.parse(raw), levels = data.levels;
  var write = process.argv.indexOf('--write') !== -1, check = process.argv.indexOf('--check') !== -1, bad = 0;
  levels.forEach(function (lv, i) {
    var r = rate(lv);
    if (!r || !r.complete) { bad++; console.log('[FAIL] L' + (i + 1) + ' ' + lv.id + ': cannot rate (' + (r ? 'search capped' : 'unsolvable') + ')'); return; }
    var same = JSON.stringify(lv.difficulty) === JSON.stringify(r.stored);
    if (check && !same) { bad++; console.log('[FAIL] L' + (i + 1) + ' ' + lv.id + ' stored ' + JSON.stringify(lv.difficulty) + ' but the formula gives ' + JSON.stringify(r.stored)); }
    console.log(('L' + (i + 1)).padEnd(4) + lv.id.padEnd(13) + 'par ' + String(r.v.par).padStart(2) + '  first ' + r.stored.first.padStart(5) + '  track ' + r.track.toFixed(3) +
      '  (par+2: first ' + r.v.firstOk + '/' + r.v.firstMoves + ', track ' + r.v.midForgive.toFixed(2) + '; optimal ' + r.v.optimal + ', within par+2 ' + r.v.seqWithin + ')  score ' + r.stored.score.toFixed(1).padStart(5) + '  ' + r.label);
    if (write) lv.difficulty = r.stored;
  });
  if (write) { fs.writeFileSync(FILE, JSON.stringify(data, null, 1) + '\n'); console.log('wrote levels/levels.json difficulty fields'); }
  process.exit(bad ? 1 : 0);
}
