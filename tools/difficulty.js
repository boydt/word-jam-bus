#!/usr/bin/env node
/*
 * Word Jam Bus difficulty tiers (v9; recalibrated in v9.1). Dev tool + shared module, no dependencies.
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
 * v9.1 recalibration (the v9 formula weighted the on-track penalty twice as much as par,
 * so a short but exacting lot such as BUS, par 10, came out Hard):
 *
 *   score = par * (1 + (1 - track)) + 3 * (1 - first)
 *
 * so a level where every move keeps you on track scores its par, and one where none do
 * scores at most double. Score bands:
 *   1 Very Easy  < 7     2 Easy  7 - < 10.5     3 Normal  10.5 - < 20
 *   4 Hard       20 - < 50                      5 Super Hard  >= 50
 * then par bands clamp the tier, because length is what makes a lot long and hard:
 *   par <= 8   at most Easy            par >= 9   at least Normal
 *   par <= 12  at most Normal (a short lot is never Hard, however exacting)
 *   par <= 25  at most Hard            par >= 20  at least Hard
 *   par >= 30  always Super Hard (a par floor)
 * so par 9-12 is always Normal, par 13-19 Normal or Hard, par 20-25 Hard, par 26-29 Hard
 * or Super Hard, and par 30+ Super Hard; within a band the score decides.
 * The score is stored rounded to 0.1; the score band uses the unrounded score, then the
 * par bands apply. Tiers may go up and down along the map. No per-level overrides exist.
 */
'use strict';
var E = require('../js/engine.js');

var TIERS = [
  { tier: 1, label: 'Very Easy', below: 7 },
  { tier: 2, label: 'Easy', below: 10.5 },
  { tier: 3, label: 'Normal', below: 20 },
  { tier: 4, label: 'Hard', below: 50 },
  { tier: 5, label: 'Super Hard', below: Infinity }
];
/** v9.1 par bands: the highest tier a par allows (first match), and the lowest it forces (first match). */
var PAR_MAX = [{ par: 8, max: 2 }, { par: 12, max: 3 }, { par: 25, max: 4 }, { par: Infinity, max: 5 }];
var PAR_MIN = [{ par: 30, min: 5 }, { par: 20, min: 4 }, { par: 9, min: 3 }, { par: 0, min: 1 }];
function scoreOf(par, first, track) { return par * (1 + (1 - track)) + 3 * (1 - first); }
/** Tier 1-5 from the unrounded score, clamped by the par bands. */
function tierOf(score, par) {
  var t = TIERS.filter(function (x) { return score < x.below; })[0].tier;
  var hi = PAR_MAX.filter(function (b) { return par <= b.par; })[0].max, lo = PAR_MIN.filter(function (b) { return par >= b.par; })[0].min;
  return Math.max(lo, Math.min(hi, t));
}

/** Metrics + score + tier for one level object. Returns null if unsolvable or the search capped. */
function rate(lv, opts) {
  var v = E.variety(E.prepare(lv), { slack: 2, maxStates: (opts && opts.maxStates) || 2500000 });
  if (!v || !v.complete) return v ? { complete: false, par: v.par, states: v.states } : null;
  var first = v.firstMoves ? v.firstOkBySlack[1] / v.firstMoves : 0, track = v.midBySlack[1];
  var score = scoreOf(v.par, first, track);
  var t = TIERS[tierOf(score, v.par) - 1];
  return {
    complete: true, v: v, first: first, track: track, score: score, tier: t.tier, label: t.label,
    stored: { tier: t.tier, label: t.label, score: Math.round(score * 10) / 10,
      par: v.par, first: v.firstOkBySlack[1] + '/' + v.firstMoves, track: Math.round(track * 1000) / 1000 }
  };
}

module.exports = { TIERS: TIERS, PAR_MAX: PAR_MAX, PAR_MIN: PAR_MIN, scoreOf: scoreOf, tierOf: tierOf, rate: rate };

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
