#!/usr/bin/env node
/*
 * Word Jam Bus level verifier (Node, no dependencies) - v2 slide rules, tiered checks.
 *
 *   node tools/verify-levels.js            verify levels/levels.json
 *   node tools/verify-levels.js --write    also regenerate js/levels.js from it
 *   node tools/verify-levels.js --ascii    print each lot and an optimal solution
 *   node tools/verify-levels.js --no-py    skip the Python cross-check
 *   node tools/verify-levels.js --districts  only the city-map checks (fast)
 *
 * Every level (any tier):
 *  - valid layout (in grid, no overlaps, every car has a letter), unique id;
 *  - winnable within its bay: exhaustive BFS over every slide / reverse /
 *    exit sequence, using js/engine.js (the code the game runs);
 *  - "par" equals the fewest moves (1 move = 1 slide or 1 exit).
 * Checks depend on the level's tier:
 *  - tier "starter" (the beginner levels, "tier": "starter" in the JSON):
 *    the mechanic named in "teaches" really is needed -
 *      exit:    the optimal line is taps only (no slides needed);
 *      slide:   cannot be won as fast without partial slides, and needs no
 *               reverse and no bay;
 *      reverse: cannot be won as fast driving forward only, and needs no bay;
 *      bay:     cannot be won as fast without parking a letter in the bay;
 *      trucks:  has a long truck;  bay-limit: a loss is reachable;
 *    "safe": true means no losing move exists anywhere in the level;
 *    par never decreases from one starter level to the next and stays below
 *    the first core level's par (the last starter sits within 2 of it).
 *  - tier "core" (default; the original v2 levels): every word-letter car
 *    starts blocked; the optimal solution needs slides; reverse moves matter
 *    (forward-only is impossible or slower, except the first core level);
 *    par of each core level >= 75% of the previous core max.
 *  - mode "scramble" (v4 breather levels; any order): solved under the
 *    Scramble rule; single-letter cars only; word letters start blocked;
 *    the optimal line needs slides; any-order really matters (the same lot
 *    played in order is impossible or at least 2 moves slower); v9 "par in
 *    line": its par sits within 80%-120% of the range spanned by the route
 *    levels just before and after it (0.8 * min .. 1.2 * max), so a Scramble
 *    stop is neither a free pass nor a spike; at least 3 route levels sit
 *    between Scramble levels; the first one has a tip and comes after the
 *    starter levels; and (v9 spread) every district after the starter ramp
 *    has at least one Scramble stop.
 * Keys and padlocks (v7, any level with a "lock"): the locks really matter
 *    (ignoring them the lot is at least 2 moves faster, so the padlocks block
 *    the naive line); the first level with padlocks has teaches "keys" and a
 *    tip that mentions the key; a core level that teaches a new mechanic
 *    starts a new difficulty ramp (it is exempt from the 75% rule and the
 *    ramp continues from its par).
 *  - tier "normal" (v9, the Main Street levels between the starters and the
 *    hard set): forgiving, multi-path lots. par 9-12; slides needed; no keys,
 *    chunk trucks, taxis or Scramble; at most one word letter can leave on
 *    move 1; a loss is reachable (but rare); a tip; and the variety metrics
 *    below clear the NORMAL thresholds: first-move slack (par + 1) >= 60%,
 *    mid-game on-track share (par + 1) >= 72%, at least 4 optimal solutions
 *    and at least 1000 winning sequences within par + 2. From one normal
 *    level to the next par rises by at most 2 and never drops by more than 1.
 * Variety metrics (v9, every level; js/engine.js variety(), exhaustive search of
 *    every state within par + 2 moves):
 *    first-move slack  share of legal first moves after which the level can
 *                      still be won within par + 1 (and within par + 2);
 *    solutions         distinct winning move sequences of length <= par + 2,
 *                      and distinct optimal (par-length) solutions (both
 *                      saturate at 1,000,000; different orders count apart);
 *    on-track share    mid-game forgiveness: along the optimal line, the
 *                      average share of legal moves that still allow a win
 *                      within par + 1 (and par + 2).
 * Difficulty tier (v9, every level): the generated "difficulty" field must
 *    equal tools/difficulty.js (score = par * (1 + 2 * (1 - on-track)) +
 *    3 * (1 - first-move slack), both at par + 1; tiers Very Easy < 7 <= Easy
 *    < 12 <= Normal < 18 <= Hard < 60 <= Super Hard). Rewrite it with
 *    node tools/difficulty.js --write.
 * Bay Word (every level): par with the Bay Word rule equals par without it,
 * so a Bay Word is never needed for 3 stars; reachable Bay Words are listed.
 * Boosters are never part of these proofs: every par is booster-free.
 * It reports cars, empty cells, min bay needed, reachable / dead states.
 * City map (v8, levels/districts.json): every level sits in exactly one
 *    district, in levels.json order; each district has >= 3 stops and ends
 *    in its boss (the hardest par in the district, ties allowed); the
 *    mechanic it "teaches" debuts inside it (basics = level 1, trucks = the
 *    first long truck, scramble = the first Scramble level, specials = the
 *    first chunk truck and the first wildcard taxi, keys = every padlock
 *    level, mixed = every normal-tier level, biglots = the first core
 *    in-order level); chests give known boosters (1-3 each), coins >= 0 and a known
 *    paint. --districts runs only these checks (fast, no solving).
 * It also checks js/levels.js matches levels/levels.json, js/baywords.js
 * matches levels/baywords.json (every word 3 letters with a vowel), and
 * cross-checks par with the independent Python solver tools/wjb_solver.py.
 * Exits 1 on any failure.
 */
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');
var E = require('../js/engine.js');
var D = require('./difficulty.js');
var NORMAL = { par: [9, 12], first: 0.6, track: 0.72, optimal: 4, within: 1000, maxFree: 1 };

var ROOT = path.join(__dirname, '..');
var JSON_PATH = path.join(ROOT, 'levels', 'levels.json');
var JS_PATH = path.join(ROOT, 'js', 'levels.js');
var WORDS_JSON = path.join(ROOT, 'levels', 'baywords.json');
var WORDS_JS = path.join(ROOT, 'js', 'baywords.js');
var DIST_JSON = path.join(ROOT, 'levels', 'districts.json');
var map = JSON.parse(fs.readFileSync(DIST_JSON, 'utf8'));
var mapData = { paints: map.paints, districts: map.districts };
var bayWordList = JSON.parse(fs.readFileSync(WORDS_JSON, 'utf8')).words;
var args = process.argv.slice(2);
var data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
var levels = Array.isArray(data) ? data : data.levels;
var AR = { up: '↑', down: '↓', left: '←', right: '→' };
var failures = 0;
var table = [];

if (args.indexOf('--write') !== -1) {
  fs.writeFileSync(JS_PATH, '/* GENERATED from levels/levels.json by `node tools/verify-levels.js --write`. Do not edit by hand. */\n' +
    'window.WJB_LEVELS = ' + JSON.stringify(levels, null, 1) + ';\n' +
    '/* GENERATED from levels/districts.json (v8 city map). */\nwindow.WJB_MAP = ' + JSON.stringify(mapData, null, 1) + ';\n');
  console.log('wrote ' + path.relative(ROOT, JS_PATH));
  fs.writeFileSync(WORDS_JS, '/* GENERATED from levels/baywords.json by `node tools/verify-levels.js --write`. Do not edit by hand. */\n(function (root) {\n  var WORDS = ' +
    JSON.stringify(bayWordList) + ';\n  if (typeof module === \'object\' && module.exports) module.exports = WORDS;\n  else root.WJB_BAYWORDS = WORDS;\n})(typeof self !== \'undefined\' ? self : this);\n');
  console.log('wrote ' + path.relative(ROOT, WORDS_JS) + ' (restart node to use it)');
}

/** Plain BFS with move filters, for the starter checks: {fwdOnly, noSlide, noBay}. Returns {par, loseReachable}. */
function restricted(g, opts, full) {
  var s0 = E.initialState(g), seen = new Set([E.stateKey(s0)]), frontier = [s0], depth = 0, par = null, lose = false;
  while (frontier.length && seen.size < 2000000) {
    var next = [];
    for (var f = 0; f < frontier.length; f++) {
      var st = frontier[f], grid = E.buildGrid(g, st.pos);
      for (var i = 0; i < g.n; i++) for (var w = 0; w < 2; w++) {
        if (opts.fwdOnly && w === E.BACK) continue;
        var r = E.step(g, st, i, w, null, grid);
        if (r.result === 'gone' || r.result === 'bump') continue;
        if (opts.noSlide && r.result === 'slide') continue;
        if (opts.noBay && r.result === 'bay') continue;
        if (r.result === 'lose') { lose = true; continue; }
        var k = E.stateKey(r.state);
        if (seen.has(k)) continue;
        seen.add(k);
        if (r.won) { if (par === null) par = depth + 1; continue; }
        next.push(r.state);
      }
    }
    if (par !== null && !full) break;
    frontier = next; depth++;
  }
  return { par: par, loseReachable: lose, complete: seen.size < 2000000 };
}
function worse(p, par) { return p === null || p > par; }

/* ---------------- v8 city map: districts ---------------- */
function checkDistricts() {
  var bad = [], ids = levels.map(function (l) { return l.id; }), flat = [];
  var paintIds = (map.paints || []).map(function (p) { return p.id; });
  if (paintIds.indexOf('classic') === -1) bad.push('paints need "classic" (owned from the start)');
  (map.paints || []).forEach(function (p) { if (!/^#[0-9a-f]{6}$/i.test(p.body) || !/^#[0-9a-f]{6}$/i.test(p.dark) || !p.name) bad.push('paint ' + p.id + ' needs a name and #rrggbb body/dark'); });
  var seenD = {};
  map.districts.forEach(function (d, k) {
    var where = 'district ' + (k + 1) + ' ' + d.id;
    if (seenD[d.id]) bad.push(where + ': duplicate id'); seenD[d.id] = true;
    if (!d.name || !d.theme || !d.intro) bad.push(where + ': needs name, theme and intro');
    if (!d.levels || d.levels.length < 3) bad.push(where + ': needs at least 3 stops');
    d.levels.forEach(function (id) { if (ids.indexOf(id) === -1) bad.push(where + ': unknown level ' + id); flat.push(id); });
    if (d.boss !== d.levels[d.levels.length - 1]) bad.push(where + ': the boss must be its last stop');
    var pars = d.levels.map(function (id) { var l = levels[ids.indexOf(id)]; return l ? l.par : 0; });
    var bossPar = pars[pars.length - 1], maxP = Math.max.apply(null, pars);
    if (bossPar < maxP) bad.push(where + ': boss par ' + bossPar + ' is below the district max ' + maxP);
    var c = d.chest || {};
    if (!(c.coins >= 0)) bad.push(where + ': chest coins must be >= 0');
    Object.keys(c.boosters || {}).forEach(function (b) { if (['tow', 'bay', 'nudge', 'flip'].indexOf(b) === -1 || !(c.boosters[b] >= 1 && c.boosters[b] <= 3)) bad.push(where + ': chest booster ' + b + ' x' + c.boosters[b]); });
    if (c.paint && paintIds.indexOf(c.paint) === -1) bad.push(where + ': unknown paint ' + c.paint);
    if (!c.coins && !Object.keys(c.boosters || {}).length && !c.paint) bad.push(where + ': empty chest');
  });
  if (JSON.stringify(flat) !== JSON.stringify(ids)) bad.push('districts must list every level exactly once, in levels.json order');
  // the mechanic each district teaches debuts inside it
  var distOf = {}; map.districts.forEach(function (d) { d.levels.forEach(function (id) { distOf[id] = d; }); });
  function firstWhere(fn) { for (var i = 0; i < levels.length; i++) if (fn(levels[i])) return levels[i]; return null; }
  var debut = {
    basics: [levels[0]],
    trucks: [firstWhere(function (l) { return l.cars.some(function (c) { return c.len > 1; }); })],
    scramble: [firstWhere(function (l) { return l.mode === 'scramble'; })],
    specials: [firstWhere(function (l) { return l.cars.some(function (c) { return c.l.length > 1; }); }), firstWhere(function (l) { return l.cars.some(function (c) { return c.l === '?'; }); })],
    keys: levels.filter(function (l) { return l.cars.some(function (c) { return c.lock; }); }),
    mixed: levels.filter(function (l) { return l.tier === 'normal'; }),
    biglots: [firstWhere(function (l) { return (l.tier || 'core') === 'core' && l.mode !== 'scramble'; })]
  };
  map.districts.forEach(function (d) {
    var need = debut[d.teaches];
    if (!need) { bad.push(d.id + ': unknown mechanic "' + d.teaches + '"'); return; }
    need.forEach(function (l) { if (!l || distOf[l.id] !== d) bad.push(d.id + ' teaches ' + d.teaches + ', but ' + (l ? l.id + ' (where it debuts) is in ' + distOf[l.id].id : 'no level uses it')); });
  });
  // v9: Scramble spread - every district after the starter ramp has a Scramble stop
  map.districts.forEach(function (d) {
    var lv = d.levels.map(function (id) { return levels[ids.indexOf(id)]; }).filter(Boolean);
    var starterOnly = lv.every(function (l) { return l.tier === 'starter'; });
    if (!starterOnly && !lv.some(function (l) { return l.mode === 'scramble'; })) bad.push(d.id + ': no Scramble stop (every district after the starter ramp needs one)');
  });
  if (bad.length) { failures += bad.length; bad.forEach(function (b) { console.log('[FAIL] map: ' + b); }); }
  else map.districts.forEach(function (d, k) {
    var c = d.chest, parts = [c.coins + ' coins'].concat(Object.keys(c.boosters || {}).map(function (b) { return b + ' x' + c.boosters[b]; })).concat(c.paint ? ['paint ' + c.paint] : []);
    console.log('[OK] district ' + (k + 1) + ' ' + d.name + ' (' + d.theme + '): stops ' + (ids.indexOf(d.levels[0]) + 1) + '-' + (ids.indexOf(d.boss) + 1) + ', teaches ' + d.teaches + ', boss ' + d.boss + ' par ' + levels[ids.indexOf(d.boss)].par + ', chest ' + parts.join(', '));
  });
}
checkDistricts();
function checkSync() {
  try {
    var src = fs.readFileSync(JS_PATH, 'utf8'), win = {};
    new Function('window', src)(win);
    if (JSON.stringify(win.WJB_LEVELS) !== JSON.stringify(levels)) { failures++; console.log('[FAIL] js/levels.js is out of date: run with --write'); }
    else console.log('[OK] js/levels.js matches levels/levels.json');
    if (JSON.stringify(win.WJB_MAP) !== JSON.stringify(mapData)) { failures++; console.log('[FAIL] js/levels.js map data is out of date (levels/districts.json): run with --write'); }
    else console.log('[OK] js/levels.js matches levels/districts.json');
  } catch (e) { failures++; console.log('[FAIL] cannot read js/levels.js: ' + e.message); }
}
if (args.indexOf('--districts') !== -1) {
  checkSync();
  console.log(failures ? '\n' + failures + ' problem(s) found' : '\nCity map OK (' + map.districts.length + ' districts, ' + levels.length + ' stops).');
  process.exit(failures ? 1 : 0);
}

var seenIds = {};
var firstLockSeen = false;
var coreSeen = 0;
levels.forEach(function (lv, n) {
  var problems = [];
  var name = (lv.words ? lv.words.join('+') : lv.word);
  if (!lv.id) problems.push('missing id'); else if (seenIds[lv.id]) problems.push('duplicate id'); seenIds[lv.id] = true;
  var g = null;
  try { g = E.prepare(lv); } catch (e) { problems.push(e.message); }
  var tier = lv.tier || 'core';
  var scr = lv.mode === 'scramble';
  var row = { n: n + 1, id: lv.id, word: name, grid: lv.grid.join('x'), bay: lv.bay, tier: tier, mode: scr ? 'scramble' : 'route', teaches: lv.teaches || '', debut: tier === 'core' && !!lv.teaches };
  var coreIdx = tier === 'core' && !scr ? coreSeen++ : -1;
  if (g) {
    var t0 = Date.now();
    var cells = g.rows * g.cols, used = g.cars.reduce(function (a, c) { return a + c.len; }, 0);
    row.cars = g.n; row.empty = cells - used;
    var s0 = E.initialState(g), grid0 = E.buildGrid(g, s0.pos);
    var freeLetters = g.cars.filter(function (c, i) {
      return (c.l === '?' || g.target.indexOf(c.l) !== -1) && E.probe(g, grid0, s0.pos, i, E.FWD).kind === 'exit';
    });
    if (tier === 'core' && freeLetters.length) problems.push('word-letter car(s) can exit on move 1: ' + freeLetters.map(function (c) { return c.l; }).join(','));
    var sol = E.solve(g);
    row.states = sol.states;
    if (sol.par === null) problems.push('UNSOLVABLE (exhaustive BFS, ' + sol.states + ' states)');
    else {
      row.par = sol.par;
      if (lv.par !== sol.par) problems.push('par mismatch: file ' + lv.par + ', solver ' + sol.par);
      var st = E.initialState(g), slides = 0, rev = 0, exits = 0, steps = [];
      sol.path.forEach(function (m) {
        var r = E.step(g, st, m.car, m.which), c = g.cars[m.car];
        var hc = E.headCell(g, m.car, st.pos[m.car]);
        steps.push(c.l + '@r' + hc.r + 'c' + hc.c + (m.which === E.FWD ? AR[c.dir] : '(rev)') + (r.result === 'slide' ? r.dist : 'out'));
        if (r.result === 'slide') { slides++; if (m.which === E.BACK) rev++; } else exits++;
        st = r.state;
      });
      row.slides = slides; row.reverse = rev; row.exits = exits;
      var fwd = E.solve(g, null, { forwardOnly: true });
      row.fwdOnlyPar = fwd.par === null ? 'impossible' : fwd.par;
      // Bay Word is a bonus, never needed for par
      var noWord = E.solve(E.prepare(lv, { bayWords: false }));
      row.noBayWordPar = noWord.par;
      if (noWord.par !== sol.par) problems.push('par depends on the Bay Word rule (' + noWord.par + ' without it, ' + sol.par + ' with it)');
      if (g.hasLocks) {
        var noLock = E.solve(E.prepare(lv, { locks: false }));
        row.noLockPar = noLock.par;
        row.locks = Object.keys(g.keys).map(function (k) { var kc = g.cars[g.keys[k]]; return k + ' key ' + kc.l + (kc.lock ? ' (padlocked ' + kc.lock + ')' : '') + ' -> ' + g.cars.filter(function (c) { return c.lock === k; }).map(function (c) { return c.l; }).join(''); }).join('; ');
        if (noLock.par === null || noLock.par > sol.par - 2) problems.push('padlocks barely matter: ignoring them par is ' + noLock.par + ' (want <= ' + (sol.par - 2) + ')');
        if (!firstLockSeen) {
          firstLockSeen = true;
          if (lv.teaches !== 'keys') problems.push('the first level with padlocks should have teaches: "keys"');
          if (!lv.tip || !/key/i.test(lv.tip)) problems.push('the first level with padlocks needs a tip about the key');
        }
      }
      if (scr) {
        if (tier !== 'core') problems.push('scramble levels belong to the core tier');
        if (slides < 1) problems.push('trivial: optimal solution needs no slides');
        var asRoute = E.solve(E.prepare(Object.assign({}, lv, { mode: 'route' })));
        row.routePar = asRoute.par === null ? 'impossible' : asRoute.par;
        if (asRoute.par !== null && asRoute.par < sol.par + 2) problems.push('any-order barely matters: in order the same lot takes ' + asRoute.par);
        var junk = 0, s2 = E.initialState(g);
        sol.path.forEach(function (m) { var r = E.step(g, s2, m.car, m.which); if (r.result === 'bay') junk++; s2 = r.state; });
        row.junkExits = junk;
      } else if (tier === 'core') {
        if (slides < 1) problems.push('trivial: optimal solution needs no slides');
        if (coreIdx > 0 && fwd.par !== null && fwd.par <= sol.par) problems.push('reverse moves not needed (forward-only par ' + fwd.par + ')');
      } else if (tier === 'starter') {
        var any = restricted(g, {}, true), noSlide = restricted(g, { noSlide: true }), noBay = restricted(g, { noBay: true });
        row.canLose = any.loseReachable; row.noSlidePar = noSlide.par; row.noBayPar = noBay.par;
        var t = lv.teaches;
        if (t === 'exit' && slides > 0) problems.push('teaches exit, but the optimal line needs slides');
        if (t === 'slide') {
          if (!worse(noSlide.par, sol.par)) problems.push('teaches slide, but it can be won as fast without slides (' + noSlide.par + ')');
          if (fwd.par !== sol.par) problems.push('teaches slide, but needs reverse moves');
          if (noBay.par !== sol.par) problems.push('teaches slide, but needs the bay');
        }
        if (t === 'reverse') {
          if (!worse(fwd.par, sol.par)) problems.push('teaches reverse, but forward-only is as fast (' + fwd.par + ')');
          if (noBay.par !== sol.par) problems.push('teaches reverse, but needs the bay');
        }
        if (t === 'bay' && !worse(noBay.par, sol.par)) problems.push('teaches bay, but it can be won as fast without the bay (' + noBay.par + ')');
        if (t === 'trucks' && !g.cars.some(function (c) { return c.len > 1; })) problems.push('teaches trucks, but has none');
        if (t === 'bay-limit' && !any.loseReachable) problems.push('teaches the bay limit, but no loss is reachable');
        if (lv.safe && any.loseReachable) problems.push('marked safe, but a losing move is reachable');
        if (!lv.tip) problems.push('starter level without a tip');
      } else if (tier === 'normal') {
        var anyN = restricted(g, {}, true);
        row.canLose = anyN.loseReachable;
        if (lv.par < NORMAL.par[0] || lv.par > NORMAL.par[1]) problems.push('normal levels have par ' + NORMAL.par.join('-') + ' (this one ' + lv.par + ')');
        if (slides < 1) problems.push('trivial: optimal solution needs no slides');
        if (g.hasLocks || g.cars.some(function (c) { return c.l.length > 1 || c.l === '?'; })) problems.push('normal levels use no keys, chunk trucks or taxis');
        if (freeLetters.length > NORMAL.maxFree) problems.push(freeLetters.length + ' word letters can leave on move 1 (max ' + NORMAL.maxFree + ')');
        if (!anyN.loseReachable) problems.push('normal levels should be losable (no loss is reachable)');
        if (!lv.tip) problems.push('normal level without a tip');
      } else problems.push('unknown tier ' + tier);
      // v9 variety metrics and the difficulty tier
      var rt = D.rate(lv);
      if (!rt || !rt.complete) problems.push('variety search capped or failed: cannot rate difficulty');
      else {
        var vv = rt.v;
        row.variety = { firstMoves: vv.firstMoves, firstOk1: vv.firstOkBySlack[1], firstOk2: vv.firstOk, track1: +rt.track.toFixed(3), track2: +vv.midForgive.toFixed(3), optimal: vv.optimal, within2: vv.seqWithin, horizonStates: vv.states };
        row.difficulty = rt.stored;
        if (JSON.stringify(lv.difficulty) !== JSON.stringify(rt.stored)) problems.push('stored difficulty ' + JSON.stringify(lv.difficulty) + ' != formula ' + JSON.stringify(rt.stored) + ' (run node tools/difficulty.js --write)');
        if (tier === 'normal') {
          if (rt.first < NORMAL.first) problems.push('first-move slack ' + vv.firstOkBySlack[1] + '/' + vv.firstMoves + ' is below ' + NORMAL.first * 100 + '%');
          if (rt.track < NORMAL.track) problems.push('on-track share ' + rt.track.toFixed(2) + ' is below ' + NORMAL.track);
          if (vv.optimal < NORMAL.optimal) problems.push('only ' + vv.optimal + ' optimal solution(s) (want >= ' + NORMAL.optimal + ')');
          if (vv.seqWithin < NORMAL.within) problems.push('only ' + vv.seqWithin + ' winning sequences within par + 2 (want >= ' + NORMAL.within + ')');
        }
      }
      row.minBay = E.minBay(g);
      var ex = E.explore(g, 1500000);
      if (ex.complete) { row.reachable = ex.reachable; row.dead = ex.deadStates; row.losingFirstMoves = ex.firstMovesDead + '/' + ex.firstMoves; }
      row.bayWords = Object.keys(ex.bayWords || {}).sort().join(',') + (ex.complete ? '' : (Object.keys(ex.bayWords || {}).length ? ',' : '') + '(explore capped)');
      row.ms = Date.now() - t0;
      if (args.indexOf('--ascii') !== -1) {
        console.log('\n' + E.ascii(g));
        console.log('  optimal: ' + steps.join('  '));
      }
    }
  }
  row.ok = problems.length === 0;
  if (!row.ok) failures++;
  table.push(row);
  console.log('[' + (row.ok ? 'OK' : 'FAIL') + '] L' + row.n + ' ' + (tier === 'starter' ? '(starter: ' + row.teaches + ') ' : '') + (scr ? '(SCRAMBLE, in-order par ' + row.routePar + ', junk exits ' + row.junkExits + ') ' : '') + row.word + ' ' + row.grid + ' cars ' + row.cars + ' empty ' + row.empty +
    ' bay ' + row.bay + ' (min ' + row.minBay + ') par ' + row.par + ' [slides ' + row.slides + ', reverse ' + row.reverse + ', exits ' + row.exits +
    '] fwd-only ' + row.fwdOnlyPar + ' | reachable ' + (row.reachable || '?') + ', dead ' + (row.dead === undefined ? '?' : row.dead) +
    ', losing first moves ' + (row.losingFirstMoves || '?') + (tier === 'starter' ? ', loss possible ' + (row.canLose ? 'yes' : 'no') + ', no-slide par ' + row.noSlidePar + ', no-bay par ' + row.noBayPar : '') +
    (row.locks ? ' | KEYS ' + row.locks + ', par ignoring padlocks ' + row.noLockPar : '') +
    ' | Bay Words reachable: ' + (row.bayWords || 'none') + ', par without Bay Word ' + row.noBayWordPar +
    ' | BFS-to-win states ' + row.states +
    (row.variety ? ' | variety: first-move slack ' + row.variety.firstOk1 + '/' + row.variety.firstMoves + ' (par+1), ' + row.variety.firstOk2 + '/' + row.variety.firstMoves + ' (par+2); on-track ' + row.variety.track1 + ' (par+1), ' + row.variety.track2 +
      ' (par+2); optimal solutions ' + row.variety.optimal + ', winning sequences within par+2 ' + row.variety.within2 + ' | difficulty ' + row.difficulty.score + ' ' + row.difficulty.label : '') +
    ' (' + row.ms + ' ms)');
  problems.forEach(function (p) { console.log('   PROBLEM: ' + p); });
});

// difficulty should rise.
// core tier: par of each level >= 75% of the previous core max (small dips allowed)
var maxPar = 0;
table.filter(function (r) { return r.tier === 'core' && r.mode === 'route'; }).forEach(function (r) {
  if (r.debut && maxPar) { console.log('[OK] L' + r.n + ' ' + r.word + ' debuts "' + r.teaches + '": a new ramp starts at par ' + r.par + ' (after max ' + maxPar + ')'); maxPar = r.par || 0; return; }
  if (r.par && r.par < Math.floor(maxPar * 0.75)) { failures++; console.log('[FAIL] L' + r.n + ' par ' + r.par + ' drops far below earlier par ' + maxPar); }
  maxPar = Math.max(maxPar, r.par || 0);
});
// starter tier: par never decreases, stays below the first core level, and the last one hands off within 2
var starters = table.filter(function (r) { return r.tier === 'starter'; });
var firstCore = table.filter(function (r) { return r.tier === 'core' && r.mode === 'route'; })[0];
starters.forEach(function (r, k) {
  if (k && r.par < starters[k - 1].par) { failures++; console.log('[FAIL] starter L' + r.n + ' par ' + r.par + ' is below the previous starter par ' + starters[k - 1].par); }
  if (firstCore && r.par >= firstCore.par) { failures++; console.log('[FAIL] starter L' + r.n + ' par ' + r.par + ' is not below the first core level par ' + firstCore.par); }
});
if (starters.length && firstCore) {
  var lastS = starters[starters.length - 1];
  if (lastS.par < firstCore.par - 2) { failures++; console.log('[FAIL] last starter par ' + lastS.par + ' is more than 2 below the first core par ' + firstCore.par); }
  else console.log('[OK] starter ramp: par ' + starters.map(function (r) { return r.par; }).join(' -> ') + ', then core L' + firstCore.n + ' par ' + firstCore.par);
}
if (starters.length && table.indexOf(starters[starters.length - 1]) > table.indexOf(firstCore)) { failures++; console.log('[FAIL] starter levels must come before the core levels'); }

// normal tier: flat to gently rising
var normals = table.filter(function (r) { return r.tier === 'normal'; });
normals.forEach(function (r, k) {
  if (!k) return;
  var p = normals[k - 1].par;
  if (r.par > p + 2 || r.par < p - 1) { failures++; console.log('[FAIL] normal L' + r.n + ' par ' + r.par + ' jumps from the previous normal par ' + p + ' (allowed ' + (p - 1) + '..' + (p + 2) + ')'); }
});
if (normals.length) console.log('[OK] normal set: par ' + normals.map(function (r) { return r.par; }).join(' -> ') + ', tiers ' + normals.map(function (r) { return r.difficulty ? r.difficulty.label : '?'; }).join(', '));
console.log('[OK] difficulty tiers: ' + table.map(function (r) { return 'L' + r.n + ' ' + r.word + ' ' + (r.difficulty ? r.difficulty.tier : '?'); }).join(', '));

// scramble pacing: after the starter ramp, >= 3 route levels between them, par in line with the route levels around it
var lastScr = -1, scrCount = 0;
table.forEach(function (r, k) {
  if (r.mode !== 'scramble') return;
  var prev = null, next = null;
  for (var j = k - 1; j >= 0; j--) if (table[j].mode === 'route') { prev = table[j]; break; }
  for (var j2 = k + 1; j2 < table.length; j2++) if (table[j2].mode === 'route') { next = table[j2]; break; }
  var bad = [];
  if (!prev) bad.push('no route level before it');
  else {
    var lo = Math.min(prev.par, next ? next.par : prev.par), hi = Math.max(prev.par, next ? next.par : prev.par);
    r.inLine = [Math.ceil(lo * 0.8), Math.floor(hi * 1.2)];
    if (r.par < r.inLine[0] || r.par > r.inLine[1]) bad.push('par ' + r.par + ' is out of line with L' + prev.n + ' par ' + prev.par + (next ? ' and L' + next.n + ' par ' + next.par : '') + ' (want ' + r.inLine[0] + '..' + r.inLine[1] + ')');
  }
  if (starters.length && k <= table.indexOf(starters[starters.length - 1])) bad.push('comes before the end of the starter ramp');
  if (lastScr >= 0 && k - lastScr < 4) bad.push('only ' + (k - lastScr - 1) + ' route level(s) since the last Scramble level');
  if (scrCount === 0 && !levels[k].tip) bad.push('the first Scramble level needs a tip');
  if (bad.length) { failures++; console.log('[FAIL] Scramble L' + r.n + ': ' + bad.join('; ')); }
  else console.log('[OK] Scramble L' + r.n + ' ' + r.word + ' par ' + r.par + ' is in line with L' + prev.n + ' ' + prev.word + ' par ' + prev.par + (next ? ' and L' + next.n + ' ' + next.word + ' par ' + next.par : '') + ' (allowed ' + r.inLine.join('..') + '; ' + (lastScr >= 0 ? (k - lastScr - 1) + ' route levels since the last Scramble; ' : '') + 'in order this lot: ' + r.routePar + ')');
  lastScr = k; scrCount++;
});

try {
  var wsrc = fs.readFileSync(WORDS_JS, 'utf8'), wwin = {};
  new Function('self', 'module', wsrc)(wwin, undefined);
  var badWords = bayWordList.filter(function (w) { return !/^[A-Z]{3}$/.test(w) || !/[AEIOU]/.test(w); });
  if (badWords.length) { failures++; console.log('[FAIL] Bay Words must be 3 capital letters with a vowel: ' + badWords.join(',')); }
  if (JSON.stringify(wwin.WJB_BAYWORDS) !== JSON.stringify(bayWordList)) { failures++; console.log('[FAIL] js/baywords.js is out of date: run with --write'); }
  else console.log('[OK] js/baywords.js matches levels/baywords.json (' + bayWordList.length + ' Bay Words, all 3 letters with a vowel)');
} catch (e) { failures++; console.log('[FAIL] cannot read js/baywords.js: ' + e.message); }

checkSync();

if (args.indexOf('--no-py') === -1) {
  var py = cp.spawnSync('python3', [path.join(__dirname, 'wjb_solver.py'), JSON_PATH, '--check'], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (py.error) console.log('[SKIP] python3 not found; independent cross-check skipped');
  else if (py.status !== 0) { failures++; console.log('[FAIL] tools/wjb_solver.py --check:\n' + py.stdout + py.stderr); }
  else console.log('[OK] independent Python solver agrees on every par (tools/wjb_solver.py --check)');
}

if (args.indexOf('--json') !== -1) console.log(JSON.stringify(table, null, 1));
console.log(failures ? '\n' + failures + ' problem(s) found' : '\nAll ' + levels.length + ' levels proven winnable; par = fewest moves.');
process.exit(failures ? 1 : 0);
