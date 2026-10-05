/* Word Jam Bus - browser game (UI, animation, input, saving). Rules live in engine.js. */
(function () {
  'use strict';
  var E = window.WJBEngine;
  var LEVELS = window.WJB_LEVELS || [];
  var $ = function (id) { return document.getElementById(id); };
  var PALETTE = ['#ff6b6b', '#4dabf7', '#51cf66', '#ff922b', '#cc5de8', '#20c997', '#f06595', '#5c7cfa', '#94d82d', '#e8590c', '#15aabf', '#be4bdb'];
  var ANGLE = { right: 0, down: 90, left: 180, up: -90 };
  var OPP = { right: 'left', left: 'right', up: 'down', down: 'up' };
  var UNDOS_PER_LEVEL = 5, HINTS_PER_LEVEL = 3;
  var FWD = E.FWD, BACK = E.BACK;
  /* v7 keys and padlocks: each colour also has its own SHAPE (on the key's bow and the padlock's face),
     so the pairs never depend on colour alone (Okabe-Ito colours, safe for the common colour-blind types). */
  var KEY_STYLE = {
    gold: { name: 'gold', shape: 'circle', hex: '#e69f00' },
    blue: { name: 'blue', shape: 'triangle', hex: '#0072b2' },
    pink: { name: 'pink', shape: 'square', hex: '#cc79a7' }
  };
  function shapeSvg(shape, cx, cy, r, extra) {
    if (shape === 'triangle') return '<polygon points="' + cx + ',' + (cy - r) + ' ' + (cx + r * 0.95) + ',' + (cy + r * 0.75) + ' ' + (cx - r * 0.95) + ',' + (cy + r * 0.75) + '" ' + extra + '/>';
    if (shape === 'square') return '<rect x="' + (cx - r * 0.8) + '" y="' + (cy - r * 0.8) + '" width="' + (r * 1.6) + '" height="' + (r * 1.6) + '" rx="1" ' + extra + '/>';
    return '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" ' + extra + '/>';
  }
  /** Key badge: a key whose bow is the colour's shape. */
  function keySvg(color) {
    var k = KEY_STYLE[color];
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + shapeSvg(k.shape, 7.5, 12, 5.6, 'fill="' + k.hex + '"') + shapeSvg(k.shape, 7.5, 12.2, 2, 'fill="#fff"') +
      '<path d="M12.5 12H22M18.5 12v4M21.5 12v3" stroke="' + k.hex + '" stroke-width="3" stroke-linecap="round" fill="none"/></svg>';
  }
  /** Padlock badge: shackle + body in the colour, the colour's shape in white on its face. */
  function lockSvg(color) {
    var k = KEY_STYLE[color];
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="shackle" d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" stroke="' + k.hex + '" stroke-width="2.8" fill="none" stroke-linecap="round"/>' +
      '<rect x="4" y="10" width="16" height="12" rx="2.6" fill="' + k.hex + '"/>' + shapeSvg(k.shape, 12, 16.2, 3.3, 'fill="#fff"') + '</svg>';
  }
  function keyName(color) { var k = KEY_STYLE[color]; return k.name + ' ' + k.shape; }
  var STORE_KEY = 'wordJamBus.progress.v1';

  /* ---------------- persistence ---------------- */
  // Saved progress: { v, unlocked, unlockedId, stars{id:n}, best{id:moves}, sound, coins, seen{},
  //   v8: inv{tow,bay,nudge,flip} (free boosters from chests), chests{districtId:true} (opened), paints[], paint, busAt,
  //   v9.1: lastStop (id of the level last played or opened; the map parks the bus there) }.
  // Stars and best moves are keyed by level id, so they survive re-ordering.
  // `unlocked` is the index of the furthest open level; v4 also stores its id
  // (`unlockedId`) so later re-orderings can migrate by id. Older saves stored
  // only an index into an older level list, so they are mapped through that
  // list's ids: no `v` = the 10 v2 levels, v3 = 10 starters + those 10.
  var PROGRESS_VERSION = 4;
  var V2_ORDER = ['lv1-bus', 'lv2-car', 'lv3-planet', 'lv4-apple', 'lv5-garden', 'lv6-rocket', 'lv7-ticket', 'lv8-mother', 'lv9-busstop', 'lv10-school'];
  var V3_ORDER = ['st1-cat', 'st2-dog', 'st3-sun', 'st4-hat', 'st5-fish', 'st6-milk', 'st7-frog', 'st8-train', 'st9-tiger', 'st10-house'].concat(V2_ORDER);
  function indexOfId(id) { for (var i = 0; i < LEVELS.length; i++) if (LEVELS[i].id === id) return i; return -1; }
  function loadProgress() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { p = null; }
    if (!p || typeof p !== 'object') p = {};
    p.stars = p.stars || {};
    p.best = p.best || {};
    var u = p.unlocked | 0, mapped = -1;
    if (p.v === undefined) { if (u > 0 || Object.keys(p.stars).length) mapped = indexOfId(V2_ORDER[Math.min(u, V2_ORDER.length - 1)]); }
    else if (p.v === 3) mapped = indexOfId(V3_ORDER[Math.min(u, V3_ORDER.length - 1)]);
    else if (p.unlockedId) mapped = indexOfId(p.unlockedId);
    if (mapped >= 0) u = mapped;
    p.v = PROGRESS_VERSION;
    p.unlocked = Math.max(0, Math.min(LEVELS.length - 1, u));
    // the furthest open level was already won (e.g. it was the last level before new ones were added): open the next
    while (p.unlocked + 1 < LEVELS.length && p.stars[LEVELS[p.unlocked].id]) p.unlocked++;
    // v9: levels can move (Scramble stops were spread over the districts), so a won level always opens the one after it
    for (var w = LEVELS.length - 2; w >= 0; w--) if (p.stars[LEVELS[w].id]) { if (p.unlocked < w + 1) p.unlocked = w + 1; break; }
    if (p.sound === undefined) p.sound = true;
    p.coins = Math.max(0, p.coins | 0);
    p.seen = p.seen || {};
    // v8 (additive, so older saves just get the defaults): free boosters from chests, opened chests,
    // owned bus paints + the one in use, and where the bus is parked on the map (cosmetic)
    var inv = p.inv && typeof p.inv === 'object' ? p.inv : {};
    p.inv = {};
    ['tow', 'bay', 'nudge', 'flip'].forEach(function (k) { p.inv[k] = Math.max(0, inv[k] | 0); });
    p.chests = p.chests && typeof p.chests === 'object' ? p.chests : {};
    p.paints = Array.isArray(p.paints) ? p.paints.filter(function (x) { return typeof x === 'string'; }) : [];
    if (p.paints.indexOf('classic') === -1) p.paints.unshift('classic');
    if (!p.paint || p.paints.indexOf(p.paint) === -1) p.paint = 'classic';
    return p;
  }
  function saveProgress() {
    progress.unlockedId = LEVELS[progress.unlocked] ? LEVELS[progress.unlocked].id : undefined;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* private mode */ }
  }
  var progress = loadProgress();
  saveProgress(); // persist a migrated save right away

  /* ---------------- test / cheat options ---------------- */
  // Stored apart from the real save (wordJamBus.test.v1), so the real save is never
  // rewritten by a cheat. Add a toggle here and it shows up in Settings.
  // Rules: anything a cheat makes possible is not saved:
  //  - unlockAll: every level can be picked; a level that is open ONLY because of the
  //    cheat is played "off the record" (no stars, best, unlock or coins are saved).
  //    Wins on levels you had really unlocked count normally.
  //  - unlimitedCoins: boosters cost nothing and never touch the real balance; fares
  //    earned meanwhile are not banked; a win that used a free booster is not saved.
  //  - unlimitedHints / unlimitedUndos: the per-level count never drops (badge shows
  //    \u221e); a win that used more than the normal 3 hints / 5 undos is not saved.
  //  Toggles can only change on the title screen, so each level session snapshots them
  //  when it starts; turning one off gives the normal fresh count on the next level start.
  var TEST_KEY = 'wordJamBus.test.v1';
  var TEST_TOGGLES = [
    { key: 'unlockAll', label: 'Unlock all levels', desc: 'Pick any level, whatever its lock.' },
    { key: 'unlimitedCoins', label: 'Unlimited coins', desc: 'Boosters are free (\u221e); real coins untouched.' },
    { key: 'unlimitedHints', label: 'Unlimited hints', desc: 'Hint never runs out (\u221e).' },
    { key: 'unlimitedUndos', label: 'Unlimited undos', desc: 'Undo never runs out (\u221e).' }
  ];
  function loadTest() {
    var p = null, t = {};
    try { p = JSON.parse(localStorage.getItem(TEST_KEY)); } catch (e) { p = null; }
    TEST_TOGGLES.forEach(function (o) { t[o.key] = !!(p && p[o.key]); });
    return t;
  }
  var test = loadTest();
  function saveTest() { try { localStorage.setItem(TEST_KEY, JSON.stringify(test)); } catch (e) { /* private mode */ } }
  function testOn() { return TEST_TOGGLES.some(function (o) { return test[o.key]; }); }
  function renderTestMode() { document.body.classList.toggle('test-mode', testOn()); }

  /* ---------------- coins + boosters ---------------- */
  // Fares: 1 coin per seat filled and 10 per Bay Word, banked when the level is
  // won (the fare box is part of the game state, so Undo keeps it honest).
  // A win at or under par without boosters doubles the fares; the first clear of
  // a level adds 20. Boosters are never needed: every par is proven without them.
  var FARE = 1, BAYWORD_COINS = 10, FIRST_CLEAR = 20;
  var BOOSTERS = {
    tow: { price: 150, name: 'Tow truck', desc: 'Tow away one car the bus can do without (a wrong letter or a spare copy).', how: 'Tap a glowing car to tow it away.' },
    bay: { price: 100, name: 'Bay +1', desc: 'One extra holding-bay spot for the rest of this level.', how: '' },
    nudge: { price: 60, name: 'Nudge', desc: 'Move one car exactly one cell, then it stays put.', how: 'Tap a car to inch it forward, or swipe it back one cell.' },
    flip: { price: 120, name: 'Flip', desc: 'Turn one car around in place, so its nose points the other way and it can leave from the other end.', how: 'Tap a glowing car to turn it around.' }
  };
  var BOOSTER_ORDER = ['tow', 'bay', 'nudge', 'flip'];
  function purseOf(st) { return (st.idx || 0) * FARE + (st.words || 0) * BAYWORD_COINS; }
  function spentOf(st) { var u = st.used || {}, t = 0; Object.keys(BOOSTERS).forEach(function (k) { t += (u[k] || 0) * BOOSTERS[k].price; }); return t; }

  /* ================= v8: the city route map (replaces the level grid) =================
   * Districts come from levels/districts.json (generated into js/levels.js as WJB_MAP).
   * Each district is a stretch of stops (levels) ending in a boss lot, then a treasure chest.
   * A district is FINISHED when its boss stop is won. Stops open one at a time, so that means
   * every stop in it has been won; it opens the next district and makes its chest claimable.
   * The road is a smooth curve through the stops; the bus is drawn on it with transforms only
   * (translate + rotate per frame), so it stays at 60 fps. Lengths along the road come from a
   * sampled table of the curve (no SVG geometry calls, so it works while the map is hidden). */
  var MAPDATA = window.WJB_MAP || { paints: [], districts: [] };
  var PAINTS = {};
  (MAPDATA.paints || []).forEach(function (p) { PAINTS[p.id] = p; });
  if (!PAINTS.classic) PAINTS.classic = { id: 'classic', name: 'School Yellow', body: '#f6c026', dark: '#d99d0b' };
  var DISTRICTS = (MAPDATA.districts || []).filter(function (d) { return indexOfId(d.levels[0]) >= 0 && indexOfId(d.boss) >= 0; });
  if (!DISTRICTS.length) DISTRICTS = [{ id: 'city', name: 'Word Jam City', theme: 'school', teaches: 'basics', intro: '', levels: LEVELS.map(function (l) { return l.id; }), boss: LEVELS[LEVELS.length - 1].id, chest: { coins: 0, boosters: {} } }];
  var DIST_OF = [];
  DISTRICTS.forEach(function (d, k) { d.k = k; d.first = indexOfId(d.levels[0]); d.last = indexOfId(d.boss); for (var i = d.first; i <= d.last; i++) DIST_OF[i] = k; });
  for (var dl = 0; dl < LEVELS.length; dl++) if (DIST_OF[dl] === undefined) DIST_OF[dl] = DISTRICTS.length - 1;
  var MECH = { basics: 'Driving basics', trucks: 'Long trucks', scramble: 'Scramble stops', specials: 'Chunk trucks and the taxi', keys: 'Keys and padlocks', mixed: 'Many ways to win + Scramble', biglots: 'Big jammed lots + Bay Words' };

  /* v9 difficulty tiers: generated per level by tools/difficulty.js from solver data (levels.json "difficulty").
     Shown as a coloured badge with 1-5 filled pips (so it never relies on colour alone). */
  var TIER_NAMES = ['', 'Very Easy', 'Easy', 'Normal', 'Hard', 'Super Hard'];
  function tierOf(lv) { var d = lv && lv.difficulty; return d && d.tier >= 1 && d.tier <= 5 ? d.tier : 0; }
  function tierText(lv) { var t = tierOf(lv); return t ? 'Difficulty: ' + TIER_NAMES[t] + ' (' + t + ' of 5)' : ''; }
  /** kind: 'stop' (pips only, the stop's own label carries the words), 'banner' or 'hud' (pips + name). */
  function tierBadge(lv, kind) {
    var t = tierOf(lv);
    if (!t) return '';
    var pips = '';
    for (var k = 1; k <= 5; k++) pips += '<i class="pip' + (k <= t ? ' on' : '') + '"></i>';
    return '<span class="tier tier-' + kind + ' t' + t + '" data-tier="' + t + '" data-tier-label="' + TIER_NAMES[t] + '"' +
      (kind === 'stop' ? ' aria-hidden="true"' : ' role="img" aria-label="' + tierText(lv) + '"') + '><span class="pips" aria-hidden="true">' + pips + '</span>' +
      (kind === 'stop' ? '' : '<b class="tier-name" aria-hidden="true">' + TIER_NAMES[t] + '</b>') + '</span>';
  }

  function applyPaint() {
    var p = PAINTS[progress.paint] || PAINTS.classic, r = document.documentElement.style;
    r.setProperty('--bus', p.body); r.setProperty('--bus-dark', p.dark);
    document.body.setAttribute('data-paint', p.id);
  }
  function districtDone(k) { return !!progress.stars[DISTRICTS[k].boss]; }
  function districtOpen(k) { return realUnlocked(DISTRICTS[k].first); }
  /** 'claimed' (opened for real), 'ready' (boss beaten, not opened yet) or 'locked'. */
  function chestState(k) { return progress.chests[DISTRICTS[k].id] ? 'claimed' : districtDone(k) ? 'ready' : 'locked'; }
  function readyChests() { var r = []; DISTRICTS.forEach(function (d, k) { if (chestState(k) === 'ready') r.push(k); }); return r; }
  function districtStars(k) { var s = 0; DISTRICTS[k].levels.forEach(function (id) { s += progress.stars[id] || 0; }); return s; }
  function rewardList(c) {
    var out = [];
    if (c.coins) out.push({ kind: 'coins', n: c.coins });
    BOOSTER_ORDER.forEach(function (b) { if (c.boosters && c.boosters[b]) out.push({ kind: b, n: c.boosters[b] }); });
    if (c.paint) out.push({ kind: 'paint', id: c.paint });
    return out;
  }
  function rewardText(c) {
    return rewardList(c).map(function (r) {
      return r.kind === 'coins' ? r.n + ' coins' : r.kind === 'paint' ? (PAINTS[r.id] ? PAINTS[r.id].name : r.id) + ' paint' : BOOSTERS[r.kind].name + (r.n > 1 ? ' x' + r.n : '');
    }).join(', ');
  }
  function reduceMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  // nodes along the road: every stop, and a chest after each district's boss
  var mapNodes = [], nodeOfLevel = [], nodeOfChest = [];
  DISTRICTS.forEach(function (d, k) {
    for (var i = d.first; i <= d.last; i++) { nodeOfLevel[i] = mapNodes.length; mapNodes.push({ type: 'stop', i: i, k: k }); }
    nodeOfChest[k] = mapNodes.length; mapNodes.push({ type: 'chest', k: k });
  });
  function nodeKey(n) { var nd = mapNodes[n]; return nd.type === 'chest' ? 'chest:' + DISTRICTS[nd.k].id : LEVELS[nd.i].id; }
  function nodeFromKey(v) {
    if (!v) return null;
    for (var n = 0; n < mapNodes.length; n++) if (nodeKey(n) === v) return n;
    return null;
  }
  /** Can the bus really be parked here (without test options)? */
  function nodeReal(n) { var nd = mapNodes[n]; return nd.type === 'chest' ? districtDone(nd.k) : realUnlocked(nd.i); }
  var M = { W: 0, H: 0, pts: [], lens: [], gates: [], secs: [], samp: null, total: 0, busNode: null, busLen: 0, driving: null, angle: 90 };
  M.busNode = nodeFromKey(progress.busAt);
  if (M.busNode !== null && !nodeReal(M.busNode)) M.busNode = null;
  /** The bus parks at a node. Saved (cosmetic) only when the node is really open and no test option is on,
   *  so the real save never changes because of a cheat. v9.1: parking at a stop (playing it, opening it,
   *  or arriving there) also records it as progress.lastStop, the stop the map shows the bus at. */
  function setBusNode(n) {
    M.busNode = n;
    var bus = $('map-bus');
    if (bus) bus.setAttribute('data-at', n === null ? '' : nodeKey(n));
    if (n === null || !nodeReal(n) || testOn()) return;
    var key = nodeKey(n), stop = mapNodes[n].type === 'stop', dirty = false;
    if (progress.busAt !== key) { progress.busAt = key; dirty = true; }
    if (stop && progress.lastStop !== key) { progress.lastStop = key; dirty = true; }
    if (dirty) saveProgress();
  }

  var HEAD_H = 92, STEP = 104, PARK = 46;
  function mapWidth() { return Math.max(300, Math.min(window.innerWidth || 390, 820)); }
  function bez(p0, c1, c2, p1, t) {
    var u = 1 - t;
    return { x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x, y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y };
  }
  function layoutMap() {
    var W = mapWidth(), cx = W / 2, A = Math.min(W * 0.27, 210), y = 0, g = 0, route = [];
    M.W = W; M.pts = []; M.secs = []; M.gates = []; M.decos = [];
    DISTRICTS.forEach(function (d, k) {
      var top = y, first = top + HEAD_H + (k ? 84 : 64), n0 = nodeOfLevel[d.first];
      var gx = cx + A * Math.sin((g - 0.5) * 0.95 + 0.3);
      if (k === 0) route.push({ x: cx + A * Math.sin(-0.95 + 0.3), y: top + HEAD_H + 4, depot: true });
      else { var gate = { x: gx, y: top + HEAD_H + 30, k: k }; M.gates[k] = gate; route.push(gate); }
      for (var n = n0; n <= nodeOfChest[k]; n++) {
        var p = { x: cx + A * Math.sin(g * 0.95 + 0.3), y: first + (n - n0) * STEP, n: n };
        M.pts[n] = p; route.push(p); g++;
      }
      y = M.pts[nodeOfChest[k]].y + 66;
      M.secs[k] = { top: top, h: y - top };
    });
    M.H = y + 20;
    M.depot = route[0];
    // Catmull-Rom through the route points -> cubic segments; sample them for lengths and points
    var segs = [], sx = [], sy = [], sl = [], L = 0, ri = {};
    for (var i = 0; i < route.length - 1; i++) {
      var p0 = route[Math.max(0, i - 1)], p1 = route[i], p2 = route[i + 1], p3 = route[Math.min(route.length - 1, i + 2)];
      var c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }, c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
      segs.push({ a: p1, c1: c1, c2: c2, b: p2 });
    }
    sx.push(route[0].x); sy.push(route[0].y); sl.push(0);
    segs.forEach(function (s, j) {
      for (var t = 1; t <= 24; t++) {
        var q = bez(s.a, s.c1, s.c2, s.b, t / 24), dx = q.x - sx[sx.length - 1], dy = q.y - sy[sy.length - 1];
        L += Math.sqrt(dx * dx + dy * dy); sx.push(q.x); sy.push(q.y); sl.push(L);
      }
      if (s.b.n !== undefined) M.lens[s.b.n] = L;
      if (s.b.k !== undefined && s.b.n === undefined) s.b.len = L;
    });
    M.segs = segs; M.route = route; M.samp = { x: sx, y: sy, l: sl }; M.total = L;
  }
  function pointAt(L) {
    var s = M.samp, lo = 0, hi = s.l.length - 1;
    L = Math.max(0, Math.min(M.total, L));
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (s.l[mid] < L) lo = mid; else hi = mid; }
    var f = s.l[hi] > s.l[lo] ? (L - s.l[lo]) / (s.l[hi] - s.l[lo]) : 0;
    return { x: s.x[lo] + (s.x[hi] - s.x[lo]) * f, y: s.y[lo] + (s.y[hi] - s.y[lo]) * f };
  }
  /** Road path for district k: from its gate (or the depot) to its chest. */
  function roadD(k) {
    var d = '', on = false;
    M.segs.forEach(function (s) {
      var bk = s.b.n !== undefined ? mapNodes[s.b.n].k : s.b.k;
      if (bk !== k) return;
      if (!on) { d += 'M' + s.a.x.toFixed(1) + ' ' + s.a.y.toFixed(1); on = true; }
      d += 'C' + [s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.b.x, s.b.y].map(function (v) { return v.toFixed(1); }).join(' ');
    });
    return d;
  }

  /* --- little landmarks, pure SVG (viewBox 0 0 64 64) --- */
  var DECO = {
    school: [
      '<rect x="8" y="26" width="48" height="30" fill="#d9573f"/><polygon points="4,28 32,10 60,28" fill="#8e2f22"/><rect x="27" y="2" width="10" height="12" fill="#f3e3b5"/><path d="M37 3h9l-3 3 3 3h-9" fill="#ef4b4b"/><rect x="14" y="33" width="9" height="8" fill="#fff6d0"/><rect x="41" y="33" width="9" height="8" fill="#fff6d0"/><rect x="27" y="40" width="10" height="16" fill="#5a3a26"/>',
      '<rect x="29" y="38" width="6" height="20" fill="#7a5230"/><circle cx="32" cy="28" r="17" fill="#3fae4a"/><circle cx="24" cy="24" r="8" fill="#5cc760"/>',
      '<rect x="29" y="22" width="6" height="36" fill="#555"/><rect x="22" y="4" width="20" height="40" rx="5" fill="#2f3642"/><circle cx="32" cy="12" r="5" fill="#ef4b4b"/><circle cx="32" cy="24" r="5" fill="#f6c026"/><circle cx="32" cy="36" r="5" fill="#2fbf71"/>',
      '<polygon points="32,4 60,32 32,60 4,32" fill="#f6c026" stroke="#333" stroke-width="2"/><circle cx="26" cy="22" r="4" fill="#333"/><circle cx="38" cy="22" r="4" fill="#333"/><path d="M24 28l-5 14M26 28l3 14M38 28l-3 14M40 28l5 14" stroke="#333" stroke-width="3"/>',
      '<rect x="20" y="4" width="14" height="50" rx="2" fill="#f6c026" transform="rotate(18 27 30)"/><polygon points="20,52 34,52 27,63" fill="#f3d2a2" transform="rotate(18 27 30)"/><rect x="20" y="4" width="14" height="7" fill="#ef7f9a" transform="rotate(18 27 30)"/>'
    ],
    suburbs: [
      '<rect x="10" y="28" width="44" height="28" fill="#f5e6c8"/><polygon points="6,30 32,10 58,30" fill="#4a6fb5"/><rect x="28" y="40" width="9" height="16" fill="#8a5a3a"/><rect x="14" y="34" width="9" height="8" fill="#bfe3ff"/><rect x="42" y="34" width="9" height="8" fill="#bfe3ff"/><rect x="44" y="12" width="6" height="12" fill="#a55"/>',
      '<rect x="29" y="38" width="6" height="20" fill="#6b4226"/><path d="M32 6l6 9 9-3-3 9 9 4-9 5 3 9-9-3-6 9-6-9-9 3 3-9-9-5 9-4-3-9 9 3z" fill="#e8622c"/>',
      '<rect x="10" y="26" width="44" height="30" fill="#ffd3c2"/><polygon points="6,28 32,8 58,28" fill="#b8473a"/><rect x="27" y="40" width="10" height="16" fill="#5f8f3e"/><rect x="14" y="32" width="10" height="8" fill="#e6f6ff"/><rect x="40" y="32" width="10" height="8" fill="#e6f6ff"/>',
      '<path d="M4 34h56M4 46h56" stroke="#fff" stroke-width="4"/><path d="M8 26v28M20 26v28M32 26v28M44 26v28M56 26v28" stroke="#fff" stroke-width="5" stroke-linecap="round"/>',
      '<rect x="30" y="30" width="4" height="28" fill="#6b4226"/><rect x="18" y="16" width="28" height="16" rx="8" fill="#3a7bd5"/><rect x="40" y="10" width="3" height="10" fill="#ef4b4b"/>'
    ],
    mainst: [
      '<rect x="6" y="22" width="52" height="36" fill="#f3e2c3"/><rect x="6" y="16" width="52" height="8" fill="#b8473a"/><path d="M6 24h52l-4 9H10z" fill="#fff"/><path d="M10 24h8l-1 9h-6zM26 24h8v9h-8zM42 24h8l1 9h-8z" fill="#1f8a70"/><rect x="12" y="38" width="16" height="12" fill="#bfe3ff"/><rect x="36" y="38" width="10" height="20" fill="#7a4a2a"/><rect x="48" y="38" width="6" height="8" fill="#bfe3ff"/>',
      '<rect x="22" y="18" width="20" height="40" fill="#c96b4a"/><polygon points="20,18 32,4 44,18" fill="#1f8a70"/><circle cx="32" cy="28" r="7" fill="#fff" stroke="#3b2a20" stroke-width="2"/><path d="M32 24v4l3 2" stroke="#3b2a20" stroke-width="2" fill="none" stroke-linecap="round"/><rect x="28" y="44" width="8" height="14" fill="#5a3a26"/>',
      '<path d="M8 14h48" stroke="#555" stroke-width="2"/><path d="M32 14l-6 8" stroke="#555" stroke-width="3"/><rect x="6" y="22" width="52" height="26" rx="7" fill="#1f8a70"/><rect x="6" y="40" width="52" height="5" fill="#f08c00"/><rect x="11" y="27" width="9" height="9" rx="2" fill="#e6f6ff"/><rect x="23" y="27" width="9" height="9" rx="2" fill="#e6f6ff"/><rect x="35" y="27" width="9" height="9" rx="2" fill="#e6f6ff"/><rect x="47" y="27" width="7" height="9" rx="2" fill="#e6f6ff"/><circle cx="18" cy="50" r="5" fill="#333"/><circle cx="46" cy="50" r="5" fill="#333"/>',
      '<rect x="30" y="16" width="4" height="42" fill="#2f3642"/><rect x="24" y="54" width="16" height="5" rx="2" fill="#2f3642"/><path d="M24 16h16l-3-8H27z" fill="#2f3642"/><circle cx="32" cy="12" r="5" fill="#ffe27a"/><path d="M20 30h24l-3 9H23z" fill="#8a5a3a"/><circle cx="25" cy="29" r="4" fill="#ef7f9a"/><circle cx="32" cy="27" r="4" fill="#ffd43b"/><circle cx="39" cy="29" r="4" fill="#ef4b4b"/>',
      '<path d="M8 26a24 12 0 0 1 48 0z" fill="#e8573f"/><path d="M20 26a12 12 0 0 1 24 0z" fill="#fff"/><path d="M32 26v24" stroke="#555" stroke-width="3"/><ellipse cx="32" cy="50" rx="14" ry="4" fill="#8a5a3a"/><path d="M22 50l-3 9M42 50l3 9" stroke="#8a5a3a" stroke-width="3"/><circle cx="10" cy="52" r="5" fill="#3fae4a"/><circle cx="54" cy="52" r="5" fill="#3fae4a"/>'
    ],
    beach: [
      '<path d="M33 60c-2-18 0-30 6-42" stroke="#a0703c" stroke-width="5" fill="none"/><path d="M39 18c-10-8-22-6-28 2 10-4 18-3 28-2zM39 18c4-10 14-14 22-12-9 2-16 6-22 12zM39 18c10-2 18 4 20 12-6-6-13-9-20-12zM39 18c-6 4-10 12-10 20 2-8 5-14 10-20z" fill="#2faa5a"/>',
      '<path d="M32 22v36" stroke="#666" stroke-width="3"/><path d="M6 24a26 18 0 0 1 52 0z" fill="#ef4b4b"/><path d="M19 24a13 18 0 0 1 26 0z" fill="#fff"/><rect x="14" y="52" width="36" height="8" rx="3" fill="#4dabf7"/>',
      '<rect x="12" y="34" width="40" height="24" fill="#e9c27a"/><rect x="8" y="26" width="12" height="32" fill="#dcb168"/><rect x="44" y="26" width="12" height="32" fill="#dcb168"/><rect x="26" y="20" width="12" height="38" fill="#e9c27a"/><path d="M30 48h4v10h-4z" fill="#a37b3c"/><path d="M32 8v12M32 8l9 4-9 4" stroke="#ef4b4b" stroke-width="2" fill="#ef4b4b"/>',
      '<circle cx="32" cy="32" r="13" fill="#ffd43b"/><g stroke="#ffd43b" stroke-width="4" stroke-linecap="round"><path d="M32 6v6M32 52v6M6 32h6M52 32h6M14 14l4 4M46 46l4 4M14 50l4-4M46 18l4-4"/></g>',
      '<path d="M8 46l6-30h36l6 30" fill="none" stroke="#c2402f" stroke-width="4"/><rect x="12" y="10" width="40" height="14" fill="#ef4b4b"/><rect x="18" y="13" width="28" height="7" fill="#fff"/><path d="M14 34h36" stroke="#c2402f" stroke-width="4"/>'
    ],
    harbor: [
      '<polygon points="24,58 40,58 37,14 27,14" fill="#fff"/><rect x="25" y="22" width="14" height="6" fill="#ef4b4b"/><rect x="25" y="38" width="14" height="6" fill="#ef4b4b"/><rect x="23" y="6" width="18" height="9" fill="#2f3642"/><circle cx="32" cy="10" r="3.5" fill="#ffd43b"/><path d="M32 10L4 2M32 10L60 2" stroke="rgba(255,240,150,.7)" stroke-width="3"/>',
      '<path d="M14 58V10h6v48M20 12h38M20 12l10 10M50 12v22" stroke="#f6c026" stroke-width="4" fill="none"/><rect x="44" y="34" width="12" height="9" fill="#ef7f2c"/><rect x="6" y="54" width="22" height="6" fill="#555"/>',
      '<rect x="4" y="38" width="28" height="18" fill="#2f9e6a"/><rect x="32" y="38" width="28" height="18" fill="#ef7f2c"/><rect x="18" y="20" width="28" height="18" fill="#3a7bd5"/><path d="M10 40v14M16 40v14M22 40v14M38 40v14M44 40v14M50 40v14M24 22v14M30 22v14M36 22v14M42 22v14" stroke="rgba(0,0,0,.18)" stroke-width="2"/>',
      '<path d="M6 44h52l-8 12H14z" fill="#c2402f"/><path d="M32 44V6l18 34z" fill="#fff"/><path d="M30 44V12L14 40z" fill="#f2f2f2"/><path d="M2 60c6-4 10-4 16 0s10 4 16 0 10-4 16 0 10 4 14 0" stroke="#fff" stroke-width="3" fill="none"/>',
      '<circle cx="32" cy="14" r="6" fill="none" stroke="#2f3642" stroke-width="4"/><path d="M32 20v36M20 30h24M12 42c2 10 10 14 20 14s18-4 20-14" stroke="#2f3642" stroke-width="5" fill="none" stroke-linecap="round"/>'
    ],
    downtown: [
      '<rect x="14" y="6" width="24" height="54" fill="#3b4a8c"/><rect x="38" y="20" width="16" height="40" fill="#2c376e"/><g fill="#ffe27a"><rect x="18" y="10" width="5" height="5"/><rect x="28" y="10" width="5" height="5"/><rect x="18" y="20" width="5" height="5"/><rect x="28" y="28" width="5" height="5"/><rect x="18" y="36" width="5" height="5"/><rect x="28" y="44" width="5" height="5"/><rect x="42" y="26" width="4" height="4"/><rect x="42" y="40" width="4" height="4"/></g>',
      '<rect x="8" y="34" width="48" height="24" fill="#e8e2d0"/><path d="M14 34a18 16 0 0 1 36 0z" fill="#d4a93a"/><rect x="30" y="8" width="4" height="12" fill="#888"/><g fill="#bdb49a"><rect x="12" y="40" width="5" height="18"/><rect x="22" y="40" width="5" height="18"/><rect x="37" y="40" width="5" height="18"/><rect x="47" y="40" width="5" height="18"/></g><rect x="4" y="56" width="56" height="4" fill="#bdb49a"/>',
      '<circle cx="20" cy="20" r="12" fill="#e69f00"/><circle cx="20" cy="20" r="5" fill="#2b2a5a"/><path d="M30 26l24 24M44 40l6-6M50 46l6-6" stroke="#e69f00" stroke-width="6" stroke-linecap="round"/>',
      '<rect x="30" y="18" width="4" height="40" fill="#555"/><path d="M32 18c0-8 14-8 16 0" stroke="#555" stroke-width="4" fill="none"/><circle cx="48" cy="22" r="5" fill="#ffe27a"/><circle cx="48" cy="22" r="12" fill="rgba(255,226,122,.25)"/>',
      '<rect x="6" y="14" width="52" height="22" rx="6" fill="#1d1b3e" stroke="#ff4fd8" stroke-width="3"/><text x="32" y="31" text-anchor="middle" font-size="14" font-weight="900" fill="#7ff3ff" font-family="Arial">OPEN</text><path d="M14 36v22M50 36v22" stroke="#555" stroke-width="3"/>'
    ]
  };
  function decoSvg(theme, j, size) {
    var set = DECO[theme] || DECO.school;
    return '<svg class="deco" viewBox="0 0 64 64" width="' + size + '" height="' + size + '" aria-hidden="true">' + set[j % set.length] + '</svg>';
  }
  var LOCK_SVG = '<svg class="stop-lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V8a4.5 4.5 0 0 1 9 0v3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><rect x="5" y="10.5" width="14" height="10.5" rx="2.4" fill="currentColor"/></svg>';
  var CHEST_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h18v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#c8812f"/><path d="M3 10a9 5 0 0 1 18 0z" fill="#e39b3d"/><rect x="3" y="10" width="18" height="2.4" fill="#f6c026"/><rect x="10" y="11" width="4" height="5" rx="1" fill="#f6c026"/></svg>';

  function renderMap() {
    layoutMap();
    var host = $('level-grid'), world = $('map-world'), W = M.W, cx = W / 2, cf = firstUnsolved();
    world.style.width = W + 'px'; world.style.height = M.H + 'px';
    var html = '';
    DISTRICTS.forEach(function (d, k) {
      var sec = M.secs[k], open = districtOpen(k) || !!test.unlockAll, cheatOpen = !districtOpen(k) && !!test.unlockAll;
      var cs = chestState(k), stars = districtStars(k), max = d.levels.length * 3, won = d.levels.filter(function (id) { return progress.stars[id]; }).length;
      var deco = '';
      for (var n = nodeOfLevel[d.first]; n < nodeOfChest[k]; n++) {   // landmarks in the free space beside the road
        var a = M.pts[n], b = M.pts[n + 1], lo = Math.min(a.x, b.x) - 40, hi = Math.max(a.x, b.x) + 40, left = lo, right = W - hi;
        var side = left >= right ? 'l' : 'r', room = Math.max(left, right), sz = Math.min(W > 600 ? 92 : 64, room - 6);
        if (sz < 34) continue;
        var x = side === 'l' ? lo / 2 : hi + right / 2, yy = (a.y + b.y) / 2 - sec.top;
        deco += '<i class="dk" style="left:' + (x - sz / 2).toFixed(0) + 'px;top:' + (yy - sz / 2).toFixed(0) + 'px">' + decoSvg(d.theme, n * 3 + k, sz) + '</i>';
        if (W > 600 && room > 220) deco += '<i class="dk dk2" style="left:' + ((side === 'l' ? lo / 4 : hi + right * 0.78) - 30).toFixed(0) + 'px;top:' + (yy + 6).toFixed(0) + 'px">' + decoSvg(d.theme, n * 3 + k + 2, 60) + '</i>';
      }
      var chip = cs === 'claimed' ? '<span class="dh-chest claimed">' + CHEST_SVG + ' Opened</span>'
        : cs === 'ready' ? '<button class="dh-chest ready" data-chest="' + k + '">' + CHEST_SVG + (testOn() ? ' Preview' : ' Open!') + '</button>'
        : '<button class="dh-chest locked" data-chest="' + k + '">' + CHEST_SVG + ' Boss chest</button>';
      html += '<section class="d-sec th-' + d.theme + (open ? '' : ' locked') + (cheatOpen ? ' cheat' : '') + (districtDone(k) ? ' done' : '') + '" data-district="' + d.id + '" style="height:' + sec.h + 'px">' +
        '<div class="d-bg" aria-hidden="true">' + deco + '</div>' +
        '<header class="d-head" aria-label="District ' + (k + 1) + ': ' + d.name + ', ' + stars + ' of ' + max + ' stars, chest ' + cs + '">' +
          '<span class="dh-badge">' + (k + 1) + '</span>' +
          '<span class="dh-text"><b class="dh-name">' + d.name + '</b><small class="dh-intro">' + (open ? (newsDistrict() === d ? 'New: ' + newStops(d).length + ' new stops! ' + (MECH[d.teaches] || d.intro) : 'New: ' + (MECH[d.teaches] || d.intro)) : LOCK_SVG + ' Win stop ' + (DISTRICTS[k - 1].last + 1) + ' (boss) to open') + '</small>' +
          '<span class="dh-bar"><i style="transform:scaleX(' + (won / d.levels.length).toFixed(3) + ')"></i></span></span>' +
          '<span class="dh-side"><span class="dh-stars" data-stars="' + stars + '" data-max="' + max + '">' + starSvg(true) + ' ' + stars + '/' + max + '</span>' + chip + '</span>' +
        '</header></section>';
    });
    // the roads, one themed path per district
    var svg = '<svg class="map-roads" width="' + W + '" height="' + M.H + '" viewBox="0 0 ' + W + ' ' + M.H + '" aria-hidden="true">';
    DISTRICTS.forEach(function (d, k) {
      var dd = roadD(k);
      svg += '<g class="road th-' + d.theme + (districtOpen(k) || test.unlockAll ? '' : ' locked') + '"><path class="rd-edge" d="' + dd + '"/><path class="rd-top" d="' + dd + '"/><path class="rd-mid" d="' + dd + '"/></g>';
    });
    svg += '</svg>';
    var nodes = '<div class="map-nodes">';
    nodes += '<div class="depot" style="left:' + M.depot.x.toFixed(0) + 'px;top:' + M.depot.y.toFixed(0) + 'px" aria-hidden="true"><b>BUS DEPOT</b></div>';
    M.gates.forEach(function (gt, k) {
      if (!gt) return;
      var open = districtOpen(k) || !!test.unlockAll;
      nodes += '<div class="gate' + (open ? ' open' : '') + '" data-k="' + k + '" style="left:' + gt.x.toFixed(0) + 'px;top:' + gt.y.toFixed(0) + 'px" aria-hidden="true"><i class="g-post"></i><i class="g-arm"></i><i class="g-post g-r"></i>' + (open ? '' : '<i class="g-lock">' + LOCK_SVG + '</i>') + '</div>';
    });
    nodes += '</div>';
    host.innerHTML = html + svg + nodes;
    var layer = host.querySelector('.map-nodes');
    LEVELS.forEach(function (lv, i) {
      var p = M.pts[nodeOfLevel[i]], d = DISTRICTS[DIST_OF[i]];
      var b = document.createElement('button');
      var locked = !isUnlocked(i), cheatOpen = !locked && !realUnlocked(i);
      var stars = progress.stars[lv.id] || 0, scr = lv.mode === 'scramble', keys = lv.cars.some(function (c) { return c.lock; }), boss = i === d.last;
      b.className = 'lvl stop' + (locked ? ' locked' : '') + (stars ? ' done' : '') + (i === cf ? ' current' : '') + (scr ? ' scr' : '') + (keys ? ' keys' : '') + (boss ? ' boss' : '') + (cheatOpen ? ' cheat' : '');
      b.setAttribute('data-level', i + 1);
      b.style.left = p.x.toFixed(1) + 'px'; b.style.top = p.y.toFixed(1) + 'px';
      b.innerHTML = '<span class="stop-n">' + (locked ? LOCK_SVG : (i + 1)) + '</span>' + (locked ? '<small class="lvl-stars"></small>' : '<small class="lvl-stars" data-stars="' + stars + '">' + starIcons(stars) + '</small>') +
        (scr ? SHUFFLE_SVG.replace('<svg', '<svg class="lvl-scr"') : '') + (keys ? '<i class="lvl-key">' + keySvg('gold') + '</i>' : '') + (boss ? '<b class="boss-tag">BOSS</b>' : '') + tierBadge(lv, 'stop');
      if (tierOf(lv)) b.setAttribute('data-tier', tierOf(lv));
      b.setAttribute('aria-label', 'Level ' + (i + 1) + ', ' + d.name + (boss ? ' boss lot' : '') + (tierOf(lv) ? ', ' + TIER_NAMES[tierOf(lv)].toLowerCase() : '') + (scr ? ' (Scramble: any order)' : '') + (keys ? ' (keys and padlocks)' : '') + (locked ? ' (locked)' : ', ' + stars + ' of 3 stars') + (cheatOpen ? ', opened by test mode' : ''));
      if (locked) b.disabled = true;
      b.addEventListener('click', function () { Sound.unlock(); goToStop(i); });
      layer.appendChild(b);
    });
    DISTRICTS.forEach(function (d, k) {
      var p = M.pts[nodeOfChest[k]], cs = chestState(k), c = document.createElement('button');
      c.className = 'chest-node cs-' + cs + ' th-' + d.theme;
      c.setAttribute('data-chest', k); c.setAttribute('data-district', d.id);
      c.style.left = p.x.toFixed(1) + 'px'; c.style.top = p.y.toFixed(1) + 'px';
      c.innerHTML = '<span class="cn-glow"></span><span class="cn-lid"></span><span class="cn-box"><i></i></span>' + (cs === 'locked' ? '<i class="cn-lock">' + LOCK_SVG + '</i>' : '');
      c.setAttribute('aria-label', d.name + ' chest: ' + (cs === 'claimed' ? 'opened' : cs === 'ready' ? 'ready to open' : 'beat the boss lot to open') + ' (' + rewardText(d.chest) + ')');
      c.addEventListener('click', function () { Sound.unlock(); chestTap(k); });
      layer.appendChild(c);
    });
    host.querySelectorAll('.dh-chest[data-chest]').forEach(function (btn) {
      btn.addEventListener('click', function () { var k = +btn.getAttribute('data-chest'); scrollMapTo(nodeOfChest[k]); chestTap(k); });
    });
    if (!$('map-bus')) {
      var bus = document.createElement('div');
      bus.id = 'map-bus'; bus.className = 'map-bus'; bus.setAttribute('aria-hidden', 'true');
      bus.innerHTML = '<div class="mb-car"><i class="mb-win"></i><i class="mb-roof"></i><i class="mb-front"></i><i class="mb-lights"></i><i class="mb-puff"></i><i class="mb-puff p2"></i></div>';
      world.appendChild(bus);
    }
    if (M.busNode !== null && !nodeReal(M.busNode) && !test.unlockAll) M.busNode = null;   // a test-only spot: back to the real route
    if (!M.driving) placeBus(M.busNode !== null ? M.busNode : nodeOfLevel[cf], true);
    renderMapChrome();
  }
  /** v9: a district added in an update that the player skipped past (open, none of its new stops won yet, but a later stop is). */
  function newStops(d) { return d.levels.filter(function (id) { var l = LEVELS[indexOfId(id)]; return l && l.tier === 'normal'; }); }
  function newsDistrict() {
    for (var k = 0; k < DISTRICTS.length; k++) {
      var d = DISTRICTS[k];
      if (d.teaches !== 'mixed' || !districtOpen(k) || newStops(d).some(function (id) { return progress.stars[id]; })) continue;
      for (var j = d.last + 1; j < LEVELS.length; j++) if (progress.stars[LEVELS[j].id]) return d;
    }
    return null;
  }
  /** Top bar, foot buttons and the title-screen route line. */
  function renderMapChrome() {
    var cf = firstUnsolved(), d = DISTRICTS[DIST_OF[cf]], total = 0, max = LEVELS.length * 3;
    LEVELS.forEach(function (lv) { total += progress.stars[lv.id] || 0; });
    $('map-coins').textContent = test.unlimitedCoins ? '\u221e' : progress.coins;
    $('map-sub').textContent = 'Stop ' + (cf + 1) + ' of ' + LEVELS.length + ' \u00b7 \u2605 ' + total + '/' + max;
    var allDone = LEVELS.every(function (lv) { return progress.stars[lv.id]; });
    $('btn-map-play').textContent = allDone ? 'Replay stop ' + (cf + 1) : (cf === d.last ? 'Play the boss lot' : 'Play stop ' + (cf + 1)) + ' \u25b6';
    var rc = readyChests(), cbtn = $('btn-map-chest');
    cbtn.hidden = !rc.length || testOn();
    cbtn.innerHTML = CHEST_SVG + ' ' + (rc.length > 1 ? rc.length + ' chests' : 'Chest') + ' to open!';
    $('title-route').innerHTML = '<b>' + d.name + '</b> \u00b7 district ' + (d.k + 1) + ' of ' + DISTRICTS.length + ' \u00b7 stop ' + (cf + 1) + (rc.length && !testOn() ? '<br><span class="tr-chest">' + CHEST_SVG + ' ' + rc.length + ' chest' + (rc.length > 1 ? 's' : '') + ' to open on the map!</span>' : '') +
      (newsDistrict() ? '<br><span class="tr-news">New: ' + newsDistrict().name + ', ' + newStops(newsDistrict()).length + ' new stops!</span>' : '');
  }
  function drawBus(L, dir) {
    var p = pointAt(L), q = pointAt(L + (dir || 1) * 4), bus = $('map-bus');
    if (!bus) return;
    var dx = q.x - p.x, dy = q.y - p.y;
    if (Math.abs(dx) + Math.abs(dy) > 0.01) M.angle = Math.atan2(dy, dx) * 180 / Math.PI;
    bus.style.transform = 'translate(' + p.x.toFixed(1) + 'px,' + p.y.toFixed(1) + 'px) rotate(' + M.angle.toFixed(1) + 'deg)';
    bus.setAttribute('data-len', Math.round(L));
  }
  function parkLen(n) { return Math.max(0, M.lens[n] - PARK); }
  /** Park the bus at node n (quiet = just draw it there, don't save a new parking spot). */
  function placeBus(n, quiet) {
    if (n === null || n === undefined) return;
    M.busLen = parkLen(n); drawBus(M.busLen, 1);
    $('map-bus').classList.remove('driving');   // a drive cut short (screen left mid-way) must not keep bobbing
    if (quiet) { M.busNode = n; $('map-bus').setAttribute('data-at', nodeKey(n)); } else setBusNode(n);
    markHere();
  }
  function markHere() {
    var host = $('level-grid');
    host.querySelectorAll('.here').forEach(function (e) { e.classList.remove('here'); });
    var nd = mapNodes[M.busNode];
    if (!nd) return;
    var el = nd.type === 'chest' ? host.querySelector('.chest-node[data-chest="' + nd.k + '"]') : host.querySelector('.lvl[data-level="' + (nd.i + 1) + '"]');
    if (el) el.classList.add('here');
  }
  /** Drive the bus along the road to node n (transforms only; ~0.5-1.7 s). */
  function driveBus(n) {
    var from = M.busLen, to = parkLen(n), dir = to >= from ? 1 : -1, bus = $('map-bus');
    return new Promise(function (done) {
      if (reduceMotion() || Math.abs(to - from) < 1) { M.busLen = to; drawBus(to, dir); setBusNode(n); markHere(); follow(true); done(); return; }
      var dur = Math.max(520, Math.min(1700, Math.abs(to - from) * 2.3)), t0 = performance.now();
      M.driving = { to: n, toKey: nodeKey(n), from: from, toLen: to, dur: dur, t: 0 };
      bus.classList.add('driving');
      Sound.drive();
      (function frame(now) {
        var d = M.driving;
        if (!d) return;
        var t = d.skip ? 1 : Math.max(0, Math.min(1, (now - t0) / dur)), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        M.busLen = from + (to - from) * e; d.t = t;
        drawBus(M.busLen, dir);
        follow(false);
        if (t < 1) requestAnimationFrame(frame);
        else { M.driving = null; bus.classList.remove('driving'); setBusNode(n); markHere(); Sound.arrive(); done(); }
      })(t0);
    });
  }
  /** Camera: while the bus drives, scroll just enough to keep it in view (below the sticky header, above the foot). */
  function follow(centre) {
    var sc = $('map-scroll'), h = sc.clientHeight, y = pointAt(M.busLen).y, top = sc.scrollTop;
    if (!h) return;
    if (centre) { if (y < top + 120 || y > top + h - 90) sc.scrollTop = Math.max(0, Math.min(M.H - h, y - h * 0.55)); return; }
    if (y > top + h - 90) sc.scrollTop = Math.min(M.H - h, y - (h - 90));
    else if (y < top + 120) sc.scrollTop = Math.max(0, y - 120);
  }
  /** Show nodes a and b (both if they fit; else start at a and let the camera follow the bus). */
  function scrollMapTo(a, b) {
    var sc = $('map-scroll'), h = sc.clientHeight || (window.innerHeight - 140), ya = M.pts[a] ? M.pts[a].y : 0, yb = b === undefined || !M.pts[b] ? ya : M.pts[b].y;
    var y = Math.abs(ya - yb) < h - 220 ? (ya + yb) / 2 : ya;
    sc.scrollTop = Math.max(0, Math.min(M.H - h, y - h * 0.55));
  }
  /** Which node the bus heads for when the map opens (v9.1: never the furthest stop just because it is the furthest):
   *  - opts.stay (Map from inside a level, or after a loss): the stop being played; the bus stays put;
   *  - a just-finished district's chest (the bus is at a boss whose chest is ready; not with opts.stay);
   *  - opts.next (after a win: Next stop, or Map from the win card): the stop right after the level just won;
   *  - opts.won: the level just won, if the stop after it can't be driven to;
   *  - otherwise (title Play / Continue, #map) the saved last-played stop, progress.lastStop;
   *  - a save without lastStop (before v9.1) keeps the old behaviour: the Continue stop (firstUnsolved). */
  function mapTarget(opts) {
    opts = opts || {};
    var b = M.busNode, nd = b !== null ? mapNodes[b] : null;
    if (opts.stay === undefined && nd && nd.type === 'stop' && nd.i === DISTRICTS[nd.k].last && chestState(nd.k) === 'ready' && !testOn()) return nodeOfChest[nd.k];
    if (opts.next !== undefined && opts.next < LEVELS.length && isUnlocked(opts.next)) return nodeOfLevel[opts.next];
    var at = opts.stay !== undefined ? opts.stay : opts.won !== undefined ? opts.won : indexOfId(progress.lastStop);
    if (at >= 0 && at < LEVELS.length && isUnlocked(at)) return nodeOfLevel[at];
    return nodeOfLevel[firstUnsolved()];
  }
  /** Open the map; the bus drives from where it was parked to mapTarget(opts) (often it just stays put).
   *  opts.stay: the level being left; opts.won / opts.next: the level just won and the stop after it;
   *  opts.autoStart: start the target level when the bus gets there. */
  function showMap(opts) {
    opts = opts || {};
    if (cur) { cur.token++; cancelSearch(); }
    hideOverlays();
    $('toast').classList.remove('show');
    M.driving = null;
    renderMap();
    show('screen-map');
    try { history.replaceState(null, '', '#map'); } catch (e) { /* file:// */ }
    var target = mapTarget(opts), from = M.busNode === null ? target : M.busNode;
    placeBus(from, true);
    scrollMapTo(from, target);
    if (from === target) { arrived(target, opts); return; }
    setTimeout(function () {
      if (!$('screen-map').classList.contains('active') || M.driving) return;
      gateThen(from, target, function () { driveBus(target).then(function () { arrived(target, opts); }); });
    }, reduceMotion() ? 0 : 380);
  }
  /** If the drive crosses a district gate for the first time, raise its barrier first. */
  function gateThen(from, to, fn) {
    var gk = null;
    DISTRICTS.forEach(function (d, k) { if (k && M.gates[k] && from < nodeOfLevel[d.first] && to >= nodeOfLevel[d.first] && !progress.seen['gate-' + d.id] && districtOpen(k)) gk = k; });
    if (gk === null || testOn()) { fn(); return; }
    progress.seen['gate-' + DISTRICTS[gk].id] = true; saveProgress();
    var el = $('level-grid').querySelector('.gate[data-k="' + gk + '"]');
    if (el) { el.classList.add('open', 'opening'); var lk = el.querySelector('.g-lock'); if (lk) lk.remove(); }
    var sec = $('level-grid').querySelector('.d-sec[data-district="' + DISTRICTS[gk].id + '"]');
    if (sec) sec.classList.add('unlocking');
    Sound.gate(); toast(DISTRICTS[gk].name + ' is open!', 1400);
    setTimeout(fn, reduceMotion() ? 0 : 700);
  }
  function arrived(n, opts) {
    setBusNode(n); markHere();
    var nd = mapNodes[n];
    if (nd.type === 'chest') {
      if (chestState(nd.k) === 'ready' && !testOn()) setTimeout(function () { if ($('screen-map').classList.contains('active')) openChest(nd.k, {}); }, reduceMotion() ? 0 : 260);
      return;
    }
    var el = $('level-grid').querySelector('.lvl[data-level="' + (nd.i + 1) + '"]');
    if (el) { el.classList.remove('arrive'); void el.offsetWidth; el.classList.add('arrive'); }
    if (opts && opts.autoStart) setTimeout(function () { if ($('screen-map').classList.contains('active') && !M.driving && M.busNode === n) startLevel(nd.i); }, reduceMotion() ? 150 : 520);
  }
  /** Tap a stop: the bus drives there, then the level starts (tap it again to skip the drive). */
  function goToStop(i) {
    if (!isUnlocked(i)) return;
    var n = nodeOfLevel[i];
    if (M.driving) { if (M.driving.to === n) M.driving.skip = true; return; }
    if (M.busNode === n || M.busNode === null) { placeBus(n); setTimeout(function () { if ($('screen-map').classList.contains('active')) startLevel(i); }, 140); return; }
    scrollMapTo(M.busNode, n);
    gateThen(M.busNode, n, function () { driveBus(n).then(function () { if ($('screen-map').classList.contains('active')) startLevel(i); }); });
  }

  /* --- chests --- */
  var chestCtx = null;
  function chestTap(k) {
    var d = DISTRICTS[k], cs = chestState(k);
    if (testOn()) { openChest(k, { preview: true }); return; }
    if (cs === 'claimed') { toast('Already opened: ' + rewardText(d.chest), 1900); return; }
    if (cs === 'locked') {
      toast('Beat the boss lot (stop ' + (d.last + 1) + ') to open: ' + rewardText(d.chest), 2200);
      var el = $('level-grid').querySelector('.chest-node[data-chest="' + k + '"]');
      if (el) { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); }
      Sound.bump(); return;
    }
    openChest(k, {});
  }
  /** Show the chest (closed). With test options on it is only a preview: nothing is granted or saved. */
  function openChest(k, o) {
    var d = DISTRICTS[k];
    chestCtx = { k: k, preview: !!o.preview || testOn() || chestState(k) !== 'ready', state: 'closed', granted: false };
    var ov = $('ov-chest');
    ov.className = 'overlay chest-ov closed th-' + d.theme + (chestCtx.preview ? ' preview' : '');
    $('chest-h').textContent = d.name + ' chest';
    $('chest-sub').textContent = chestCtx.preview ? 'TEST MODE preview: opening it adds nothing and it stays unclaimed.' : 'District complete! Tap the chest to open it.';
    $('chest-rewards').innerHTML = ''; $('chest-note').textContent = ''; $('chest-confetti').innerHTML = '';
    $('btn-chest-collect').textContent = chestCtx.preview ? 'Close preview' : 'Collect';
    overlay('ov-chest', true);
  }
  function rewardHtml(r) {
    if (r.kind === 'coins') return '<span class="rw-ico"><i class="coin"></i></span><b>+' + r.n + '</b><small>coins</small>';
    if (r.kind === 'paint') { var p = PAINTS[r.id] || PAINTS.classic; return '<span class="rw-ico"><span class="paint-bus" style="--pb:' + p.body + ';--pd:' + p.dark + '"></span></span><b>' + p.name + '</b><small>bus paint</small>'; }
    return '<span class="rw-ico">' + $('bst-' + r.kind).querySelector('svg').outerHTML + '</span><b>' + BOOSTERS[r.kind].name + ' \u00d7' + r.n + '</b><small>free booster</small>';
  }
  function crackChest() {
    if (!chestCtx || chestCtx.state !== 'closed') return;
    var k = chestCtx.k, d = DISTRICTS[k], c = d.chest, ov = $('ov-chest');
    var real = !chestCtx.preview && !testOn() && chestState(k) === 'ready';
    chestCtx.state = 'opening';
    if (real) {   // claim at once, one time only (a reload mid-animation can't claim it twice)
      progress.chests[d.id] = true;
      progress.coins += c.coins || 0;
      Object.keys(c.boosters || {}).forEach(function (b) { progress.inv[b] = (progress.inv[b] || 0) + c.boosters[b]; });
      if (c.paint && progress.paints.indexOf(c.paint) === -1) { progress.paints.push(c.paint); progress.paint = c.paint; }
      saveProgress();
    }
    chestCtx.granted = real;
    ov.classList.remove('closed'); ov.classList.add('opening');
    Sound.rattle(); buzz([15, 40, 15, 40, 15]);
    setTimeout(function () {
      if (!chestCtx) return;
      ov.classList.remove('opening'); ov.classList.add('open'); chestCtx.state = 'open';
      $('chest-sub').textContent = real ? 'Your haul for clearing ' + d.name + ':' : 'TEST MODE preview of the ' + d.name + ' haul:';
      if (real) applyPaint();
      Sound.chest(); buzz(30);
      var conf = $('chest-confetti'), cols = ['#ffc21a', '#ef4b4b', '#4dabf7', '#2fbf71', '#cc5de8', '#fff'];
      if (!reduceMotion()) for (var j = 0; j < 26; j++) {
        var s = document.createElement('i'), ang = (j / 26) * Math.PI * 2, dist = 90 + (j * 37) % 70;
        s.style.setProperty('--tx', (Math.cos(ang) * dist).toFixed(0) + 'px'); s.style.setProperty('--ty', (Math.sin(ang) * dist - 40).toFixed(0) + 'px');
        s.style.setProperty('--rot', ((j * 97) % 360) + 'deg'); s.style.background = cols[j % cols.length]; s.style.animationDelay = (j % 5) * 30 + 'ms';
        conf.appendChild(s);
      }
      var box = $('chest-rewards');
      rewardList(c).forEach(function (r, j) {
        var el = document.createElement('div');
        el.className = 'reward rw-' + r.kind; el.style.animationDelay = (120 + j * 170) + 'ms';
        el.innerHTML = rewardHtml(r);
        box.appendChild(el);
      });
      $('chest-note').textContent = real ? (c.paint ? 'Your bus wears its new paint (change it in Settings). ' : '') + (Object.keys(c.boosters || {}).length ? 'Free boosters are used before coins.' : '')
        : 'TEST MODE preview: nothing was added. ' + (chestState(k) === 'claimed' ? 'This chest was already claimed for real.' : 'Turn test options off and beat the boss lot to claim it.');
      renderMapChrome();
      if (cur) renderCoins();
    }, reduceMotion() ? 0 : 950);
  }
  function closeChest() {
    var ctx = chestCtx;
    chestCtx = null;
    overlay('ov-chest', false);
    $('chest-confetti').innerHTML = '';
    if (!$('screen-map').classList.contains('active')) return;
    renderMap();
    if (ctx && ctx.granted) {   // on to the first stop of the newly opened district
      var t = nodeOfLevel[firstUnsolved()];
      if (t !== M.busNode) setTimeout(function () {
        if (!$('screen-map').classList.contains('active') || M.driving) return;
        scrollMapTo(M.busNode, t);
        gateThen(M.busNode, t, function () { driveBus(t).then(function () { arrived(t, {}); }); });
      }, reduceMotion() ? 0 : 250);
    }
  }
  function renderPaints() {
    var row = $('paint-row');
    row.innerHTML = '';
    Object.keys(PAINTS).forEach(function (id) {
      var p = PAINTS[id], own = progress.paints.indexOf(id) !== -1, from = DISTRICTS.filter(function (d) { return d.chest && d.chest.paint === id; })[0];
      var b = document.createElement('button');
      b.className = 'paint-sw' + (progress.paint === id ? ' on' : '') + (own ? '' : ' locked');
      b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', progress.paint === id ? 'true' : 'false');
      b.setAttribute('data-paint', id);
      b.setAttribute('aria-label', p.name + (own ? '' : ' (from the ' + (from ? from.name : '') + ' chest)'));
      b.title = b.getAttribute('aria-label');
      b.innerHTML = '<span class="paint-bus" style="--pb:' + p.body + ';--pd:' + p.dark + '"></span>' + (own ? '' : LOCK_SVG);
      if (!own) b.disabled = true;
      b.addEventListener('click', function () { progress.paint = id; saveProgress(); applyPaint(); renderPaints(); });
      row.appendChild(b);
    });
  }

  /* ---------------- sound + haptics (generated, no assets) ---------------- */
  var Sound = {
    ctx: null,
    unlock: function () {
      if (!this.ctx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) { try { this.ctx = new AC(); } catch (e) { this.ctx = null; } } }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    },
    tone: function (f, dur, type, vol, f2, delay) {
      if (!progress.sound || !this.ctx) return;
      var t = this.ctx.currentTime + (delay || 0);
      var o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(f, t);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(vol || 0.12, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination);
      o.start(t); o.stop(t + dur + 0.02);
    },
    exit: function () { this.tone(180, 0.22, 'square', 0.05, 420); },
    slide: function () { this.tone(140, 0.12, 'triangle', 0.08, 200); },
    fill: function (k) { this.tone(620 + (k || 0) * 90, 0.16, 'sine', 0.16, 980 + (k || 0) * 90); },
    bay: function () { this.tone(330, 0.14, 'triangle', 0.14, 260); },
    bump: function () { this.tone(120, 0.18, 'sine', 0.3, 60); },
    pop: function () { var s = this, f = [523, 587, 659, 698, 784, 880][Math.floor(Math.random() * 6)]; s.tone(f, 0.14, 'sine', 0.14, f * 1.5); s.tone(f * 1.25, 0.14, 'sine', 0.08, f * 1.9, 0.03); },
    word: function () { var s = this; [784, 988, 1175].forEach(function (f, i) { s.tone(f, 0.16, 'triangle', 0.13, null, i * 0.08); }); },
    coin: function () { this.tone(1320, 0.08, 'square', 0.04, 1760); },
    win: function () { var s = this; [523, 659, 784, 1047].forEach(function (f, i) { s.tone(f, 0.22, 'triangle', 0.15, null, i * 0.11); }); },
    lose: function () { this.tone(330, 0.5, 'sawtooth', 0.07, 110); },
    drive: function () { this.tone(110, 0.35, 'sawtooth', 0.025, 150); },
    arrive: function () { this.tone(880, 0.09, 'sine', 0.08, 990); this.tone(660, 0.12, 'sine', 0.06, null, 0.08); },
    gate: function () { this.tone(392, 0.18, 'triangle', 0.1, 523); this.tone(523, 0.2, 'triangle', 0.1, 784, 0.12); },
    rattle: function () { var s = this; [0, 0.12, 0.24, 0.36].forEach(function (d) { s.tone(150 + d * 200, 0.07, 'square', 0.04, 110, d); }); },
    chest: function () { var s = this; [523, 659, 784, 1047, 1319].forEach(function (f, i) { s.tone(f, 0.25, 'triangle', 0.13, f * 1.01, i * 0.07); }); s.tone(2093, 0.4, 'sine', 0.05, 2637, 0.35); },
    unlockLocks: function () { var s = this; s.tone(1046, 0.09, 'square', 0.05, 1568); s.tone(1568, 0.16, 'triangle', 0.12, 2093, 0.09); }
  };
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } }

  /* ---------------- screens ---------------- */
  function show(id) {
    ['screen-title', 'screen-game', 'screen-map'].forEach(function (s) { $(s).classList.toggle('active', s === id); });
    document.body.classList.toggle('on-map', id === 'screen-map');
    if (id !== 'screen-map') M.driving = null;
  }
  function overlay(id, on) {
    $(id).classList.toggle('show', on);
    $(id).setAttribute('aria-hidden', on ? 'false' : 'true');
  }
  function hideOverlays() { chestCtx = null; ['ov-win', 'ov-lose', 'ov-shop', 'ov-coach', 'ov-howto', 'ov-settings', 'ov-chest'].forEach(function (id) { overlay(id, false); }); $('deadend').classList.remove('show'); }

  function starText(n) { return '\u2605\u2605\u2605'.slice(0, n) + '\u2606\u2606\u2606'.slice(0, 3 - n); }
  // Crisp SVG stars (same shape on the level select and the win card): solid gold
  // with a darker edge when earned, a dim outline when not.
  var STAR_PATH = 'M12 2.4l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.2l-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9z';
  function starSvg(on) { return '<svg class="st ' + (on ? 'on' : 'off') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + STAR_PATH + '"/></svg>'; }
  function starIcons(n) { return [1, 2, 3].map(function (k) { return starSvg(k <= n); }).join(''); }

  /** Title screen + the city map (the level select). */
  function renderLevelGrid() {
    $('btn-play').textContent = Object.keys(progress.stars).length ? 'Continue' : 'Play';
    $('title-coins').textContent = test.unlimitedCoins ? '\u221e' : progress.coins;
    renderMap();
    renderTestMode();
  }
  var SHUFFLE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c2 0 3 1 4.2 2.6l2.6 4.8C14.5 16 15.5 17 17.5 17H21"/><path d="M3 17h3.5c2 0 3-1 4.2-2.6"/><path d="M13.3 9.6C14.5 8 15.5 7 17.5 7H21"/><path d="M18 4l3 3-3 3"/><path d="M18 14l3 3-3 3"/></svg>';
  /** A level is open if it is within the unlock frontier or it (or any later level) was ever completed. */
  function realUnlocked(i) {
    if (i <= progress.unlocked) return true;
    for (var j = i; j < LEVELS.length; j++) if (progress.stars[LEVELS[j].id]) return true;
    return false;
  }
  function isUnlocked(i) { return realUnlocked(i) || !!test.unlockAll; }
  /** Where "Play/Continue" goes: the first unsolved open level after the furthest completed one. */
  function firstUnsolved() {
    var last = -1, i;
    for (i = 0; i < LEVELS.length; i++) if (progress.stars[LEVELS[i].id]) last = i;
    for (i = last + 1; i < LEVELS.length; i++) if (realUnlocked(i) && !progress.stars[LEVELS[i].id]) return i;
    for (i = 0; i < LEVELS.length; i++) if (realUnlocked(i) && !progress.stars[LEVELS[i].id]) return i;
    return progress.unlocked;
  }

  /* ---------------- game state ---------------- */
  var cur = null;   // current level session
  var cell = 60, tileSize = 44, slotSize = 44;

  function startLevel(index) {
    index = Math.max(0, Math.min(LEVELS.length - 1, index));
    var level = LEVELS[index];
    var game = E.prepare(level);
    cur = {
      index: index, level: level, game: game, state: E.initialState(game),
      history: [], undos: UNDOS_PER_LEVEL, hints: HINTS_PER_LEVEL, bumps: 0,
      ended: false, dead: false, token: (cur ? cur.token + 1 : 1),
      chain: Promise.resolve(), disp: { idx: 0, mask: 0, bay: [], wild: {}, words: 0 }, carEls: [],
      plan: null, planOptimal: false, search: null, serial: 0, pendingHint: false,
      scramble: game.scramble, boostMode: null, gameHist: [],
      cheatOnly: !!test.unlockAll && !realUnlocked(index),   // open only because of "Unlock all"
      free: !!test.unlimitedCoins,                           // boosters free, fares not banked
      freeHints: !!test.unlimitedHints, freeUndos: !!test.unlimitedUndos, hintsUsed: 0, undosUsed: 0,
      pay: {}   // v8: history length -> how a booster was paid ('coins' | 'inv' | 'free'), so Undo refunds the right thing
    };
    var dist = DISTRICTS[DIST_OF[index]];
    $('screen-game').setAttribute('data-theme', dist ? dist.theme : '');
    setBusNode(nodeOfLevel[index]);   // the bus is parked at the stop being played
    renderTestMode();
    $('bus').classList.toggle('scr', game.scramble);
    $('screen-game').classList.toggle('scr', game.scramble);
    $('bay-name').textContent = game.scramble ? 'Junk bay' : 'Holding bay';
    setBoostMode(null);
    hideOverlays();
    $('toast').classList.remove('show');
    var bus = $('bus');
    if (bus.classList.contains('drive-off')) {
      // the previous bus left; the next one pulls in from the left
      bus.style.transition = 'none';
      bus.classList.remove('drive-off');
      bus.style.transform = 'translateX(-120vw)';
      void bus.offsetWidth;
      bus.style.transition = '';
      bus.classList.add('arrive');
      bus.style.transform = '';
      setTimeout(function () { bus.classList.remove('arrive'); }, 650);
    }
    $('fly-layer').innerHTML = '';
    show('screen-game');
    $('hud-level').textContent = 'Level ' + (index + 1) + ' of ' + LEVELS.length;
    $('hud-tier').innerHTML = tierBadge(level, 'hud');
    $('hud-par').textContent = level.par !== undefined ? level.par : '?';
    $('tip').textContent = level.tip || '';
    buildWord();
    buildBay();
    buildLot();
    layout();
    renderHud();
    try { history.replaceState(null, '', '#level-' + (index + 1)); } catch (e) { /* file:// in some browsers */ }
    $('btn-hint').classList.remove('thinking');
    setTimeout(ensureSearch, 60); // precompute an optimal plan so the first hint is instant
    if (game.scramble) {
      if (!progress.seen.scramble) showCoach();
      else showBanner();
    } else showIntro();
  }

  /* v9: a short level-intro banner (level, district, par and the difficulty tier) for route levels */
  function showIntro() {
    var b = $('banner'), lv = cur.level, d = DISTRICTS[DIST_OF[cur.index]];
    b.className = 'banner intro';
    b.innerHTML = '<div class="bn-title">Level ' + (cur.index + 1) + '</div><div class="bn-sub">' + (d ? d.name + ' &middot; ' : '') + 'Par ' + lv.par + '</div>' +
      (tierOf(lv) ? '<div class="bn-tier">' + tierBadge(lv, 'banner') + '</div>' : '');
    void b.offsetWidth; b.classList.add('show');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(hideBanner, 1800);
  }

  /* ---------------- Scramble: start banner + first-time coach card ---------------- */
  function showBanner() {
    var b = $('banner');
    b.className = 'banner';
    b.innerHTML = '<div class="bn-title">' + SHUFFLE_SVG + ' Scramble stop!</div><div class="bn-sub">Letters board in <b>ANY</b> order</div><div class="bn-letters">' +
      cur.game.target.split('').map(function (ch, k) { return '<span style="animation-delay:' + (k * 60) + 'ms">' + ch + '</span>'; }).join('') + '</div>' +
      (tierOf(cur.level) ? '<div class="bn-tier">' + tierBadge(cur.level, 'banner') + '</div>' : '');
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
    clearTimeout(showBanner._t);
    showBanner._t = setTimeout(hideBanner, 2200);
  }
  function hideBanner() { $('banner').classList.remove('show'); }
  function showCoach() {
    hideBanner();
    $('coach-word').innerHTML = cur.game.target.split('').map(function (ch) { return '<span>' + ch + '</span>'; }).join('');
    overlay('ov-coach', true);
  }

  function buildWord() {
    var w = $('word');
    w.innerHTML = '';
    var slot = 0;
    cur.game.words.forEach(function (word, wi) {
      if (wi > 0) { var gap = document.createElement('div'); gap.className = 'gap'; w.appendChild(gap); }
      var g = document.createElement('div');
      g.className = 'word-group';
      g.setAttribute('data-start', slot);
      g.setAttribute('data-end', slot + word.length);
      for (var i = 0; i < word.length; i++) {
        var t = document.createElement('div');
        t.className = 'tile';
        t.setAttribute('data-slot', slot);
        t.textContent = word[i];
        if (!cur.game.scramble) { var num = document.createElement('i'); num.className = 'seat-n'; num.textContent = slot + 1; t.appendChild(num); }
        g.appendChild(t);
        slot++;
      }
      w.appendChild(g);
    });
  }

  function buildBay() {
    var b = $('bay');
    b.innerHTML = '';
    for (var i = 0; i < cur.game.cap; i++) {
      var s = document.createElement('div');
      s.className = 'slot';
      s.setAttribute('data-bay', i);
      b.appendChild(s);
    }
  }

  function buildLot() {
    var lot = $('lot');
    lot.innerHTML = '<div id="lane" class="lane"></div><div id="ghost" class="ghost"></div><div id="exit-mark" class="exit-mark"></div>';
    cur.carEls = cur.game.cars.map(function (car, i) {
      var el = document.createElement('div');
      var chunk = car.l.length > 1, wild = car.l === '?';
      el.className = 'car' + (car.len > 1 ? ' long' : '') + (chunk ? ' chunk' : '') + (wild ? ' wild' : '');
      el.setAttribute('data-id', i);
      el.setAttribute('data-letter', car.l);
      el.setAttribute('data-dir', car.dir);
      el.setAttribute('role', 'button');
      el.style.setProperty('--c', PALETTE[(i * 5 + car.r * 3 + car.c) % PALETTE.length]);
      el.innerHTML = '<div class="chassis"><i class="rear"></i><i class="stripe"></i><i class="glass"></i>' +
        '<span class="lights"><i></i><i></i></span><i class="arrow"></i><i class="tail"></i></div>' +
        '<div class="roof">' + car.l + '</div>' +
        (car.key ? '<i class="kb kb-key k-' + car.key + '" data-key="' + car.key + '">' + keySvg(car.key) + '</i>' : '') +
        (car.lock ? '<i class="kb kb-lock k-' + car.lock + '" data-lock="' + car.lock + '">' + lockSvg(car.lock) + '</i>' : '');
      if (car.key) { el.classList.add('has-key'); el.style.setProperty('--kc', KEY_STYLE[car.key].hex); }
      if (car.lock) { el.classList.add('has-lock'); el.style.setProperty('--lc', KEY_STYLE[car.lock].hex); }
      if (car.lock && E.isLocked(cur.game, cur.state.pos, i)) el.classList.add('locked');
      el.setAttribute('aria-label', carLabel(i, el));
      if (cur.state.pos[i] < 0) el.style.display = 'none';
      lot.appendChild(el);
      return el;
    });
  }

  function carLabel(i, el) {
    var car = cur.game.cars[i];
    el = el || cur.carEls[i];
    var locked = car.lock && E.isLocked(cur.game, cur.state.pos, i);
    return (car.l === '?' ? 'wildcard taxi' : 'car ' + car.l) + ' facing ' + car.dir +
      (car.key ? ', carries the ' + keyName(car.key) + ' key' : '') +
      (car.lock ? (locked ? ', padlocked (' + keyName(car.lock) + ')' : ', unlocked') : '');
  }
  /** Padlocks follow the state (a lock is shut while its key car is in the lot). With animate, an opening
   *  lock pops open (the unlock moment when the key car drives out) and a closing one (Undo) snaps shut. */
  function renderLocks(animate) {
    if (!cur || !cur.game.hasLocks || !cur.carEls) return [];
    var opened = [];
    cur.game.cars.forEach(function (c, i) {
      var el = cur.carEls[i];
      if (!c.lock || !el) return;
      var on = E.isLocked(cur.game, cur.state.pos, i), was = el.classList.contains('locked');
      if (on === was) return;
      el.classList.toggle('locked', on);
      el.setAttribute('aria-label', carLabel(i, el));
      if (!on) opened.push(i);
      if (!animate) return;
      var cls = on ? 'relock' : 'unlocking';
      el.classList.remove('relock', 'unlocking'); void el.offsetWidth; el.classList.add(cls);
      clearTimeout(el._lockT);
      el._lockT = setTimeout(function () { el.classList.remove(cls); }, 1000);
    });
    return opened;
  }
  /** Tapped a padlocked car: the padlock wiggles and the matching key car lights up. No move is used. */
  function lockedBump(i, key) {
    var el = cur.carEls[i], kel = cur.carEls[key], car = cur.game.cars[i];
    cur.bumps++;
    el.classList.remove('lock-wiggle'); void el.offsetWidth; el.classList.add('lock-wiggle');
    setTimeout(function () { el.classList.remove('lock-wiggle'); }, 650);
    if (kel) {
      kel.classList.remove('key-call'); void kel.offsetWidth; kel.classList.add('key-call');
      clearTimeout(kel._kcT);
      kel._kcT = setTimeout(function () { kel.classList.remove('key-call'); }, 1700);
    }
    Sound.bump(); buzz([20, 30, 20]);
    toast('Locked! Drive the ' + keyName(car.lock) + ' key car (' + cur.game.cars[key].l + ') out first', 1700, true);
  }

  /** Pixel box of car i at axis position p. */
  function carBox(i, p) {
    var car = cur.game.cars[i];
    return car.horiz
      ? { left: p * cell, top: car.lane * cell, width: car.len * cell, height: cell }
      : { left: car.lane * cell, top: p * cell, width: cell, height: car.len * cell };
  }
  function placeCar(i) {
    var el = cur.carEls[i], p = cur.state.pos[i];
    if (p < 0) { el.style.display = 'none'; return; }
    var b = carBox(i, p);
    el.style.display = '';
    el.style.left = b.left + 'px'; el.style.top = b.top + 'px';
    el.style.width = b.width + 'px'; el.style.height = b.height + 'px';
  }

  /** Point car i's graphic (nose arrow, headlights, windshield, tail lights) the way the CURRENT game model says it faces.
   *  The only place the chassis rotation is set, so a rerender after a Flip can't fall back to an old direction. */
  function orientCar(i, angle) {
    var el = cur.carEls[i], ch = el && el.querySelector('.chassis');
    if (!ch) return;
    var a = angle === undefined ? ANGLE[cur.game.cars[i].dir] : angle;
    ch.style.transform = 'translate(-50%, -50%) rotate(' + a + 'deg)';
    el.setAttribute('data-dir', cur.game.cars[i].dir);
  }

  function layout() {
    if (!cur) return;
    var g = cur.game;
    // word tiles
    var appW = Math.min(document.getElementById('app').clientWidth, 620);
    var n = g.target.length, gaps = g.words.length - 1;
    tileSize = Math.max(26, Math.min(46, Math.floor((appW - 90 - 5 * (n - 1) - gaps * 30) / n))); // 90 = bus padding + hood + tailpipe
    $('bus').style.setProperty('--bs', Math.max(.6, Math.min(1, tileSize / 44)).toFixed(3));
    document.documentElement.style.setProperty('--tile', tileSize + 'px');
    slotSize = Math.max(30, Math.min(48, Math.floor((appW - 60) / Math.max(g.cap, 1)) - 6));
    document.documentElement.style.setProperty('--slot', slotSize + 'px');
    // lot
    var wrap = $('lot-wrap');
    var w = wrap.clientWidth - 32;
    var h = $('play').clientHeight - $('bus-zone').offsetHeight - $('bay-zone').offsetHeight - 28;
    cell = Math.max(28, Math.floor(Math.min(w / g.cols, h / g.rows, 86)));
    var lot = $('lot');
    lot.style.width = cell * g.cols + 'px';
    lot.style.height = cell * g.rows + 'px';
    lot.style.setProperty('--cell', cell + 'px');
    document.documentElement.style.setProperty('--cell', cell + 'px');
    var pad = Math.round(cell * 0.07);
    lot.classList.add('no-anim');
    g.cars.forEach(function (car, i) {
      var el = cur.carEls[i];
      if (!el.classList.contains('leaving')) placeCar(i);
      var ch = el.querySelector('.chassis');
      ch.style.width = (car.len * cell - pad * 2) + 'px';
      ch.style.height = (cell - pad * 2) + 'px';
      orientCar(i);
    });
    void lot.offsetWidth;
    lot.classList.remove('no-anim');
  }

  /* ---------------- HUD rendering (from the display state) ---------------- */
  function renderHud() {
    renderLocks(true);
    var g = cur.game, d = cur.disp, scr = g.scramble;
    $('hud-moves').textContent = cur.state.moves;
    var tiles = $('word').querySelectorAll('.tile');
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i], filled = scr ? !!(d.mask & (1 << i)) : i < d.idx, was = t.classList.contains('filled');
      t.classList.toggle('filled', filled);
      t.classList.toggle('wild', !!d.wild[i] && filled);
      t.classList.toggle('next', !scr && i === d.idx && !cur.ended);
      t.classList.toggle('open', scr && !filled && !cur.ended);
      if (filled && !was) { t.style.animation = 'none'; void t.offsetWidth; t.style.animation = ''; }
    }
    var groups = $('word').querySelectorAll('.word-group');
    for (var k = 0; k < groups.length; k++) {
      var s = +groups[k].getAttribute('data-start'), e = +groups[k].getAttribute('data-end');
      groups[k].classList.toggle('inactive', !scr && !(d.idx >= s && d.idx < e) && d.idx < e);
    }
    // bay: one slot per spot (Bay +1 spots are gold); a letter that completes a Bay Word in a full bay briefly shows in an extra slot
    var cap = E.capOf(g, cur.state), bayEl = $('bay');
    var want = Math.max(cap, d.bay.length), have = bayEl.children.length;
    for (; have < want; have++) { var ns = document.createElement('div'); ns.className = 'slot'; ns.setAttribute('data-bay', have); bayEl.appendChild(ns); }
    for (; have > want; have--) bayEl.removeChild(bayEl.lastChild);
    var slots = bayEl.querySelectorAll('.slot');
    for (var j = 0; j < slots.length; j++) {
      var u = d.bay[j];
      slots[j].textContent = u || '';
      slots[j].classList.toggle('full', !!u);
      slots[j].classList.toggle('chunk', !!u && u.length > 1);
      slots[j].classList.toggle('plus', j >= g.cap && j < cap);
      slots[j].classList.toggle('over', j >= cap);
    }
    var free = cap - d.bay.length;
    bayEl.classList.toggle('warn', free === 1);
    bayEl.classList.toggle('danger', free <= 0);
    $('bay-count').textContent = '(' + Math.min(d.bay.length, cap) + '/' + cap + ')';
    $('undo-count').textContent = cur.freeUndos ? '\u221e' : cur.undos;
    $('undo-count').classList.toggle('inf', cur.freeUndos);
    $('btn-undo').disabled = cur.undos <= 0 || !cur.history.length || cur.ended;
    $('hint-count').textContent = cur.freeHints ? '\u221e' : cur.hints;
    $('hint-count').classList.toggle('inf', cur.freeHints);
    $('btn-hint').disabled = cur.hints <= 0 || cur.ended;
    renderCoins();
  }
  function renderCoins() {
    var free = cur ? cur.free : !!test.unlimitedCoins;
    $('coin-count').textContent = free ? '\u221e' : progress.coins;
    $('coin-box').classList.toggle('free', free);
    var d = cur ? cur.disp : null, purse = d ? (scrCount(d) * FARE + (d.words || 0) * BAYWORD_COINS) : 0;
    $('purse').textContent = '+' + purse;
    $('purse').classList.toggle('show', purse > 0 && !!cur && !cur.banked && !free);
    renderBoosters();
  }
  /** Booster bar: price, "Free" (unlimited coins), red price when you can't afford it, greyed when it can't be used. */
  function renderBoosters() {
    BOOSTER_ORDER.forEach(function (k) {
      var btn = $('bst-' + k), b = BOOSTERS[k], why = cur ? boosterBlock(k) : 'Level over';
      var have = cur && !cur.free ? progress.inv[k] || 0 : 0;   // v8: free boosters from chests are used before coins
      var poor = !why && cur && !cur.free && !have && progress.coins < b.price;
      btn.classList.toggle('off', !!why);
      btn.classList.toggle('poor', !!poor);
      btn.classList.toggle('has-inv', have > 0);
      btn.disabled = !cur || cur.ended;
      var ib = btn.querySelector('.inv-badge');
      ib.hidden = !have; ib.textContent = have > 9 ? '9+' : have;
      btn.querySelector('.bst-price').innerHTML = why === 'Used' ? 'Used' : cur && cur.free ? 'Free' : have ? 'Free' : '<i class="coin"></i>' + b.price;
      btn.setAttribute('aria-label', b.name + ': ' + (why === 'Used' ? 'used this level' : cur && cur.free ? 'free (test mode)' : have ? have + ' free from chests' : b.price + ' coins' + (poor ? ', not enough coins' : '')) + (why && why !== 'Used' ? ' (' + why + ')' : ''));
    });
  }
  function scrCount(d) { if (!cur.game.scramble) return d.idx; var c = 0, m = d.mask; while (m) { m &= m - 1; c++; } return c; }

  function syncDisplay() {
    var s = cur.state, d = { idx: s.idx, mask: s.mask || 0, bay: s.bay.slice(), wild: {}, words: s.words || 0 };
    Object.keys(cur.disp.wild).forEach(function (k) { if (+k < s.idx) d.wild[k] = true; });
    cur.disp = d;
  }

  /* ---------------- animation queue ---------------- */
  function enqueue(fn) {
    var token = cur.token;
    cur.chain = cur.chain.then(function () { if (cur && token === cur.token) return fn(); });
    return cur.chain;
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function rectCenter(el) { var r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height }; }

  function fly(text, from, toEl, ms) {
    var to = rectCenter(toEl);
    var el = document.createElement('div');
    el.className = 'fly';
    var size = Math.max(from.w || 0, 30);
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.fontSize = Math.round(size * (text.length > 1 ? 0.45 : 0.62)) + 'px';
    el.textContent = text;
    el.style.transitionDuration = (ms || 340) + 'ms';
    el.style.transform = 'translate(' + (from.x - size / 2) + 'px,' + (from.y - size / 2) + 'px)';
    $('fly-layer').appendChild(el);
    void el.offsetWidth;
    var sc = to.w / size;
    el.style.transform = 'translate(' + (to.x - size / 2) + 'px,' + (to.y - size / 2) + 'px) scale(' + sc + ')';
    return wait(ms || 340).then(function () { el.remove(); });
  }

  function driveOut(i, fromPos) {
    var car = cur.game.cars[i], el = cur.carEls[i];
    // distance from the nose to the edge, plus the car's own length
    var nose = car.sign > 0 ? fromPos + car.len - 1 : fromPos;
    var dist = (car.sign > 0 ? car.span - 1 - nose : nose) + car.len + 0.3;
    dist *= cell;
    var v = E.DIRS[car.dir];
    el.classList.add('leaving');
    el.querySelector('.roof').style.opacity = '0';
    el.style.transform = 'translate(' + v[1] * dist + 'px,' + v[0] * dist + 'px)';
    setTimeout(function () { el.style.display = 'none'; }, 300);
  }

  /* ---------------- input ---------------- */
  function toast(msg, ms, low) {
    var t = $('toast'), scr = document.querySelector('.screen.active');
    if (scr && t.parentNode !== scr) scr.appendChild(t);
    t.textContent = msg;
    // low: over the bay instead of the lot (padlock messages, so the glowing key car stays visible)
    var bz = low && $('bay-zone'), sec = $('screen-game');
    if (bz && sec.classList.contains('active')) { var br = bz.getBoundingClientRect(), sr = sec.getBoundingClientRect(); t.style.top = Math.round(br.top + br.height / 2 - sr.top) + 'px'; t.classList.add('low'); }
    else { t.style.top = ''; t.classList.remove('low'); }
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, ms || 900);
  }

  function bump(i, which, by) {
    var car = cur.game.cars[i], el = cur.carEls[i];
    cur.bumps++;
    var dir = which === FWD ? car.dir : OPP[car.dir];
    var cls = 'bump-' + dir;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
    var bl = by >= 0 ? cur.carEls[by] : null;
    if (bl) { bl.classList.remove('blocker'); void bl.offsetWidth; bl.classList.add('blocker'); }
    setTimeout(function () { el.classList.remove(cls); if (bl) bl.classList.remove('blocker'); }, 420);
    Sound.bump(); buzz(30);
    toast(by >= 0 ? 'Blocked!' : 'Wall!');
  }

  /** Perform a move: which = FWD (toward the nose) or BACK (reverse). */
  function doMove(i, which) {
    if (!cur || cur.ended) return;
    Sound.unlock();
    var el = cur.carEls[i];
    if (!el || el.classList.contains('leaving')) return;
    var fromPos = cur.state.pos[i];
    var res = E.step(cur.game, cur.state, i, which);
    if (res.result === 'gone') return;
    if (res.result === 'bump') { if (res.locked) lockedBump(i, res.key); else bump(i, which, res.by); return; }
    clearHint();
    advancePlan(i, which);
    if (res.result === 'slide') {
      pushHist();
      cur.state = res.state;
      Sound.slide();
      placeCar(i);
      $('deadend').classList.remove('show');
      renderHud();
      afterMove();
      return;
    }
    var from = rectCenter(el.querySelector('.roof'));
    driveOut(i, fromPos);
    Sound.exit();
    if (res.result === 'lose') {
      cur.ended = true;
      cur.state = res.state;
      cancelSearch();
      renderHud();
      enqueue(function () {
        var slots = $('bay').querySelectorAll('.slot');
        return fly(res.unit, from, slots[slots.length - 1] || $('bay'), 300).then(function () {
          $('bay').classList.add('danger');
          Sound.lose(); buzz([60, 40, 60]);
          return wait(250);
        }).then(function () {
          $('deadend').classList.remove('show');
          $('lose-title').textContent = 'Bay full!';
          $('lose-detail').textContent = 'The ' + res.unit + ' car had nowhere to park. ' + (cur.game.scramble ? 'In Scramble only wrong letters (and extra copies) park, so slide those out of the way instead of driving them out.' : 'Slide decoys out of the way instead of driving them out.');
          overlay('ov-lose', true);
        });
      });
      return;
    }
    pushHist();
    cur.state = res.state;
    $('deadend').classList.remove('show');
    renderHud();
    if (res.unlocked && res.unlocked.length) {   // the key car left: its padlocks pop open
      Sound.unlockLocks();
      toast(res.unlocked.length > 1 ? res.unlocked.length + ' cars unlocked!' : 'Unlocked!', 1100, true);
    }
    // 1) the car's own letter flies to the bus seat or to the bay
    enqueue(function () {
      var target;
      if (res.result === 'fill') target = $('word').querySelector('.tile[data-slot="' + res.slot + '"]');
      else target = $('bay').querySelector('.slot[data-bay="' + Math.min(cur.disp.bay.length, E.capOf(cur.game, cur.state) - 1) + '"]');
      var label = res.unit === '?' ? res.fillLetters : res.unit;
      return fly(label, from, target || $('bay')).then(function () {
        if (res.result === 'fill') {
          if (res.unit === '?') cur.disp.wild[res.slot] = true;
          if (cur.game.scramble) { cur.disp.mask |= 1 << res.slot; Sound.pop(); }
          else { cur.disp.idx = res.slot + (res.unit === '?' ? 1 : res.unit.length); Sound.fill(0); }
          buzz(15);
          coinPop(target, '+' + (res.unit === '?' ? 1 : res.unit.length));
        } else {
          cur.disp.bay.push(res.unit);
          Sound.bay();
        }
        renderHud();
      });
    });
    // 2) chained auto-fill from the bay
    res.auto.forEach(function (a, k) {
      enqueue(function () {
        var src = $('bay').querySelector('.slot[data-bay="' + a.bayIndex + '"]');
        var dst = $('word').querySelector('.tile[data-slot="' + a.slot + '"]');
        var from2 = rectCenter(src);
        cur.disp.bay.splice(a.bayIndex, 1);
        renderHud();
        return fly(a.unit, from2, dst, 260).then(function () {
          cur.disp.idx = a.slot + a.unit.length;
          Sound.fill(k + 1); buzz(15);
          coinPop(dst, '+' + a.unit.length);
          renderHud();
        });
      });
    });
    // 3) Bay Words: three junk letters that spell a word leave the bay together
    (res.cleared || []).forEach(function (cw) {
      enqueue(function () { return bayWordClear(cw); });
    });
    if (res.won) {
      cur.ended = true;
      cancelSearch();
      enqueue(function () { syncDisplay(); renderHud(); return wait(150).then(winLevel); });
    } else {
      enqueue(function () { syncDisplay(); renderHud(); });
      afterMove();
    }
  }

  /** A "+N" coin that pops off a seat (fares) or the bay (Bay Word). */
  function coinPop(nearEl, text) {
    if (!nearEl) return;
    var r = rectCenter(nearEl), el = document.createElement('div');
    el.className = 'coin-pop';
    el.textContent = text;
    el.style.left = r.x + 'px'; el.style.top = (r.y - r.h / 2) + 'px';
    $('fly-layer').appendChild(el);
    setTimeout(function () { el.remove(); }, 900);
  }
  function bayWordClear(cw) {
    var slots = $('bay').querySelectorAll('.slot'), els = cw.at.map(function (i) { return slots[i]; });
    els.forEach(function (e) { if (e) e.classList.add('word'); });
    $('bay-zone').classList.add('bayword');
    Sound.word(); buzz([20, 30, 20]);
    toast(cw.word + '! Bay Word +' + BAYWORD_COINS, 1400);
    return wait(650).then(function () {
      var coinBtn = $('coin-box');
      var trips = els.map(function (e, k) { return e ? fly(cw.letters[k], rectCenter(e), coinBtn, 420) : Promise.resolve(); });
      cw.at.slice().sort(function (x, y) { return y - x; }).forEach(function (i) { cur.disp.bay.splice(i, 1); });
      cur.disp.words = (cur.disp.words || 0) + 1;
      els.forEach(function (e) { if (e) e.classList.remove('word'); });
      renderHud();
      return Promise.all(trips);
    }).then(function () {
      $('bay-zone').classList.remove('bayword');
      coinPop($('coin-box'), '+' + BAYWORD_COINS);
      Sound.coin();
      renderHud();
    });
  }

  /* ---------- solver in the background: dead-end warning + hints ---------- */
  // cur.plan: a known winning move list from the current state (optimal if
  // cur.planOptimal). Following it keeps it valid; any other move drops it.
  function advancePlan(i, which) {
    if (cur.plan && cur.plan.length && cur.plan[0].car === i && cur.plan[0].which === which) cur.plan = cur.plan.slice(1);
    else { cur.plan = null; cur.planOptimal = false; }
    cur.pendingHint = false;
    $('btn-hint').classList.remove('thinking');
  }
  function cancelSearch() { if (cur && cur.search) { cur.search.cancelled = true; cur.search = null; } }

  /** Run a BFS from the current state in small time slices; cb(status, api). */
  function searchAsync(cb) {
    cancelSearch();
    var token = cur.token, serial = cur.serial;
    var job = { cancelled: false, serial: serial, api: E.createSearch(cur.game, cur.state) };
    cur.search = job;
    (function slice() {
      if (job.cancelled || !cur || cur.token !== token || cur.serial !== serial) return;
      var t0 = Date.now(), st;
      do { st = job.api.run(3000); } while (st === 'running' && Date.now() - t0 < 14);
      if (st === 'running') { setTimeout(slice, 0); return; }
      if (cur.search === job) cur.search = null;
      cb(st, job.api);
    })();
  }

  /** Make sure we know a winning line from the current state (or that none exists). */
  function ensureSearch() {
    if (!cur || cur.ended) return;
    if (cur.plan) { if (cur.pendingHint) deliverHint(); return; }
    if (cur.search && cur.search.serial === cur.serial) return; // already working on it
    var serial = cur.serial;
    searchAsync(function (st, api) {
      if (cur.serial !== serial || cur.ended) return;
      if (st === 'win') {
        cur.plan = api.path; cur.planOptimal = true; cur.dead = false;
        if (cur.pendingHint) deliverHint();
      } else if (st === 'none') {
        cur.dead = true; cur.pendingHint = false;
        $('btn-hint').classList.remove('thinking');
        enqueue(function () { if (cur.ended) return; $('deadend').classList.add('show'); Sound.bump(); });
      }
    });
  }
  function afterMove() { cur.serial++; ensureSearch(); }

  function winLevel() {
    var lv = cur.level, st = cur.state, moves = st.moves, par = lv.par;
    var assisted = E.boosted(st);
    var stars = par === undefined ? 3 : moves <= par ? 3 : moves <= par + 2 ? 2 : 1;
    if (assisted) stars = Math.min(stars, 2);           // boosters cap a win at 2 stars
    var fares = st.idx * FARE, words = (st.words || 0) * BAYWORD_COINS;
    var parBonus = !assisted && par !== undefined && moves <= par ? fares : 0;
    var first = progress.stars[lv.id] ? 0 : FIRST_CLEAR;
    var earned = fares + parBonus + words + first;
    // Test mode: a level opened only by "Unlock all", or won with a free booster, is off
    // the record; with "Unlimited coins" on, fares are not banked.
    var saveable = !cur.cheatOnly && !(cur.free && assisted) && cur.hintsUsed <= HINTS_PER_LEVEL && cur.undosUsed <= UNDOS_PER_LEVEL;
    var bank = saveable && !cur.free;
    cur.banked = true;
    if (saveable) {
      if (bank) progress.coins += earned;
      progress.stars[lv.id] = Math.max(progress.stars[lv.id] || 0, stars);
      if (!assisted && (!progress.best[lv.id] || moves < progress.best[lv.id])) progress.best[lv.id] = moves;
      progress.unlocked = Math.max(progress.unlocked, Math.min(cur.index + 1, LEVELS.length - 1));
      saveProgress();
    }
    renderCoins();
    Sound.win(); buzz([20, 30, 20]);
    $('bus').classList.add('drive-off');
    return wait(700).then(function () {
      $('win-word').textContent = cur.game.words.join(' \u2192 ');
      $('win-stars').innerHTML = starIcons(stars);
      $('win-stars').setAttribute('aria-label', stars + ' of 3 stars');
      $('win-stars').setAttribute('data-stars', stars);
      $('win-detail').textContent = 'Moves ' + moves + ' \u00b7 Par ' + par + (assisted ? ' \u00b7 Booster used (max 2\u2605)' : stars === 3 ? ' \u00b7 Perfect route!' : stars === 2 ? ' \u00b7 Close to par!' : ' \u00b7 Try for fewer moves.') +
        (saveable ? '' : ' \u00b7 TEST MODE: not saved');
      var parts = ['fares ' + fares];
      if (parBonus) parts.push('par bonus ' + parBonus);
      if (words) parts.push('Bay Word ' + words);
      if (first) parts.push('first clear ' + first);
      if (bank) $('win-coins').innerHTML = '<b>+' + earned + '</b> coins <small>(' + parts.join(' + ') + ')</small>';
      else $('win-coins').innerHTML = '<b>+0</b> coins <small>(test mode: ' + earned + ' not banked)</small>';
      $('win-coins').setAttribute('data-earned', bank ? earned : 0);
      $('win-coins').classList.toggle('test', !bank);
      var last = cur.index >= LEVELS.length - 1, dk = DIST_OF[cur.index], dd = DISTRICTS[dk], boss = cur.index === dd.last;
      var chestNow = boss && saveable && chestState(dk) === 'ready' && !testOn();
      $('win-district').innerHTML = boss ? (saveable ? '<b>' + dd.name + ' complete!</b> ' + (chestNow ? 'Its chest is waiting on the map.' : chestState(dk) === 'claimed' ? 'Chest already opened.' : '') : '<b>Boss lot beaten</b> (test mode: chest not unlocked)')
        : dd.name + ' \u00b7 stop ' + (cur.index - dd.first + 1) + ' of ' + dd.levels.length;
      $('win-district').classList.toggle('boss', boss);
      $('btn-next').textContent = chestNow ? 'Open the chest!' : last ? 'Back to the map' : 'Next stop';
      overlay('ov-win', true);
    });
  }

  function undo() {
    if (!cur || cur.ended || cur.undos <= 0 || !cur.history.length) return;
    if (!cur.freeUndos) cur.undos--;
    cur.undosUsed++;
    cur.token++;
    cancelSearch();
    cur.chain = Promise.resolve();
    $('fly-layer').innerHTML = '';
    var rec = cur.pay[cur.history.length];   // how the move being undone was paid for (boosters only)
    delete cur.pay[cur.history.length];
    var prev = cur.history.pop(), prevGame = cur.gameHist.pop() || cur.game;
    var refund = 0, refundInv = null;   // undoing a booster gives back what it cost: coins, or the free booster (test-mode free ones cost nothing)
    if (rec && rec.src === 'coins') { refund = rec.price; progress.coins += refund; saveProgress(); }
    else if (rec && rec.src === 'inv') { progress.inv[rec.kind] = (progress.inv[rec.kind] || 0) + 1; refundInv = rec.kind; saveProgress(); }
    var unflip = prevGame !== cur.game;   // undoing a Flip: the car faces its old way again
    cur.game = prevGame;
    setBoostMode(null);
    var revived = [];
    prev.pos.forEach(function (p, i) { if (p >= 0 && cur.state.pos[i] < 0) revived.push(i); });
    cur.state = prev;
    cur.dead = false;
    cur.plan = null; cur.planOptimal = false;
    $('deadend').classList.remove('show');
    clearHint();
    syncDisplay();
    var wasLocked = (cur.carEls || []).map(function (el) { return !!el && el.classList.contains('locked'); });
    if (revived.length || unflip) {
      buildLot(); layout();
      cur.carEls.forEach(function (el, i) {   // a lock that came back with Undo snaps shut again
        if (el.classList.contains('locked') && !wasLocked[i]) { el.classList.add('relock'); setTimeout(function () { el.classList.remove('relock'); }, 1000); }
      });
    }
    else cur.game.cars.forEach(function (c, i) { placeCar(i); }); // animated slide back
    renderHud();
    toast(refund > 0 ? 'Undo \u00b7 ' + refund + ' coins back' : refundInv ? 'Undo \u00b7 free ' + BOOSTERS[refundInv].name + ' back' : 'Undo');
    afterMove();
  }

  function clearHint() {
    if (!cur || !cur.carEls) return;
    cur.carEls.forEach(function (el) { el.classList.remove('hint'); el.removeAttribute('data-hint'); });
    hideGhost(true);
  }

  function showHint(m) {
    clearHint();
    var el = cur.carEls[m.car];
    el.classList.add('hint');
    el.setAttribute('data-hint', m.which === FWD ? 'fwd' : 'back');
    showGhost(m.car, m.which, true);
  }

  function deliverHint() {
    cur.pendingHint = false;
    $('btn-hint').classList.remove('thinking');
    if (!cur.plan || !cur.plan.length || cur.hints <= 0) return;
    if (!cur.freeHints) cur.hints--;
    cur.hintsUsed++;
    renderHud();
    showHint(cur.plan[0]);
  }

  function hint() {
    if (!cur || cur.ended || cur.hints <= 0) return;
    if (cur.dead) { $('deadend').classList.add('show'); return; }
    if (cur.plan && cur.planOptimal) { cur.pendingHint = true; deliverHint(); return; }
    cur.pendingHint = true;
    $('btn-hint').classList.add('thinking');
    ensureSearch();
  }

  /* ---------------- boosters: shop, confirm, pick a car, apply ---------------- */
  function boosterBlock(kind) { // why a booster can't be used right now ('' = it can; coins are checked separately)
    if (!cur || cur.ended) return 'Level over';
    var g = cur.game, st = cur.state;
    if (kind === 'bay' && st.used.bay) return 'Used';
    if (kind === 'tow' && !g.cars.some(function (c, i) { return E.towable(g, st, i); })) return 'No spare car';
    if (kind === 'nudge' && !g.cars.some(function (c, i) { return E.nudgeTo(g, st, i, FWD) !== null || E.nudgeTo(g, st, i, BACK) !== null; })) return 'No room';
    if (kind === 'flip' && !g.cars.some(function (c, i) { return E.flippable(g, st, i); })) return 'No car';
    return '';
  }
  function closeShop() { overlay('ov-shop', false); }
  /** Booster bar tap: straight to the confirm-before-spend sheet. */
  function askBuy(kind) {
    if (!cur || cur.ended) return;
    setBoostMode(null);
    clearHint();
    var b = BOOSTERS[kind], why = boosterBlock(kind);
    if (why) { toast(why === 'Used' ? b.name + ' is used up for this level' : b.name + ': ' + why.toLowerCase() + ' right now', 1400); Sound.bump(); return; }
    var have = cur.free ? 0 : progress.inv[kind] || 0;
    if (!cur.free && !have && progress.coins < b.price) { toast('Need ' + b.price + ' coins for ' + b.name + ' (you have ' + progress.coins + ')', 1600); Sound.bump(); return; }
    $('confirm-icon').innerHTML = $('bst-' + kind).querySelector('svg').outerHTML;
    $('confirm-title').textContent = cur.free ? 'Use ' + b.name + ' for free?' : have ? 'Use a free ' + b.name + '?' : 'Spend ' + b.price + ' coins on ' + b.name + '?';
    $('confirm-detail').textContent = b.desc + (b.how ? ' ' + b.how : '') + (cur.free ? ' (Test mode: unlimited coins.)' : have ? ' You have ' + have + ' free from district chests; no coins are spent.' : '');
    $('btn-confirm').innerHTML = cur.free ? 'Use free' : have ? 'Use free (' + have + ' left)' : 'Spend <i class="coin"></i>' + b.price;
    $('btn-confirm').setAttribute('data-kind', kind);
    overlay('ov-shop', true);
  }
  function confirmBuy() {
    var kind = $('btn-confirm').getAttribute('data-kind');
    closeShop();
    if (kind === 'bay') applyBoost('bay');
    else setBoostMode(kind);
  }
  /** Tow / nudge wait for a car: glowing cars can take the booster; coins are only spent when it is applied. */
  function setBoostMode(kind) {
    if (!cur) return;
    cur.boostMode = kind || null;
    var bar = $('boost-bar');
    bar.classList.toggle('show', !!kind);
    $('screen-game').classList.toggle('boosting', !!kind);
    if (kind) $('boost-text').textContent = BOOSTERS[kind].name + ': ' + BOOSTERS[kind].how;
    (cur.carEls || []).forEach(function (el, i) {
      var ok = kind === 'tow' ? E.towable(cur.game, cur.state, i)
        : kind === 'flip' ? E.flippable(cur.game, cur.state, i)
        : kind === 'nudge' ? (E.nudgeTo(cur.game, cur.state, i, FWD) !== null || E.nudgeTo(cur.game, cur.state, i, BACK) !== null) : false;
      el.classList.toggle('can-boost', !!kind && ok);
      el.classList.toggle('no-boost', !!kind && !ok);
    });
  }
  function pushHist() { cur.history.push(cur.state); cur.gameHist.push(cur.game); }
  function applyBoost(kind, i, which) {
    if (!cur || cur.ended) return false;
    var b = BOOSTERS[kind], ns = E.applyBooster(cur.game, cur.state, kind, i, which);
    if (!ns) {
      if (i !== undefined && cur.carEls[i]) { var el0 = cur.carEls[i]; el0.classList.remove('bump-' + cur.game.cars[i].dir); void el0.offsetWidth; el0.classList.add('bump-' + cur.game.cars[i].dir); setTimeout(function () { el0.classList.remove('bump-' + cur.game.cars[i].dir); }, 420); }
      var lk = i !== undefined && E.isLocked(cur.game, cur.state.pos, i), kc = i !== undefined && cur.game.cars[i] && cur.game.cars[i].key;
      toast(lk ? 'Padlocked cars can\'t be ' + (kind === 'tow' ? 'towed' : kind === 'flip' ? 'flipped' : 'nudged') + ' (drive the ' + keyName(cur.game.cars[i].lock) + ' key car out first)'
        : kind === 'tow' && kc ? 'Key cars can\'t be towed: drive it out to open its locks'
        : kind === 'tow' ? 'The bus still needs that letter' : kind === 'flip' ? 'That car can\'t flip' : 'No room to nudge that way', 1500, lk || kc);
      Sound.bump();
      return false;
    }
    // unlimited coins (test mode): free, the real balance and inventory are never touched;
    // otherwise a free booster from a chest is used before coins
    var src = cur.free ? 'free' : (progress.inv[kind] || 0) > 0 ? 'inv' : 'coins';
    if (src === 'coins') {
      if (progress.coins < b.price) { toast('Not enough coins'); setBoostMode(null); return false; }
      progress.coins -= b.price;
      saveProgress();
    } else if (src === 'inv') { progress.inv[kind]--; saveProgress(); }
    clearHint();
    cur.plan = null; cur.planOptimal = false; cur.pendingHint = false;
    $('btn-hint').classList.remove('thinking');
    pushHist();
    cur.pay[cur.history.length] = { kind: kind, src: src, price: b.price };
    cur.state = ns;
    if (kind === 'flip') cur.game = E.flipCar(cur.game, i);   // hint + dead-end search use the new direction
    cur.dead = false;
    $('deadend').classList.remove('show');
    setBoostMode(null);
    if (kind === 'tow') {
      var el = cur.carEls[i];
      el.classList.add('towed');
      Sound.exit();
      setTimeout(function () { el.style.display = 'none'; el.classList.remove('towed'); }, 520);
      toast('Towed away!');
    } else if (kind === 'flip') {
      // v6b: the chassis itself turns 180deg and STAYS turned (the old keyframe spun the whole car and ended back at 0deg,
      // while the chassis rotation was only ever set in layout(), so the graphic snapped back to the old direction).
      var fe = cur.carEls[i], fc = cur.game.cars[i], fromA = ANGLE[OPP[fc.dir]], fch = fe.querySelector('.chassis');
      fe.setAttribute('aria-label', carLabel(i, fe));
      fe.classList.remove('flipping');
      orientCar(i, fromA);                       // start from the old look, no transition
      void fe.offsetWidth;
      fe.classList.add('flipping');              // .flipping .chassis has the rotate transition
      orientCar(i, fromA + 180);                 // turn half a circle (same look as ANGLE[new dir])
      var flipDone = function () {
        if (cur && cur.carEls[i] === fe) { fe.classList.remove('flipping'); orientCar(i); }  // settle on the canonical angle, no visual change
      };
      if (fch) fch.addEventListener('transitionend', function te(ev) { if (ev.propertyName === 'transform') { fch.removeEventListener('transitionend', te); flipDone(); } });
      setTimeout(flipDone, 650);
      Sound.slide(); toast('Flipped! Now facing ' + fc.dir);
    } else if (kind === 'nudge') {
      placeCar(i); Sound.slide(); toast('Nudged 1 cell');
    } else {
      Sound.coin(); toast('Bay +1: ' + E.capOf(cur.game, ns) + ' spots');
    }
    syncDisplay();
    renderHud();
    if (kind === 'bay') { var sl = $('bay').lastChild; if (sl) { sl.classList.add('pop-in'); } }
    afterMove();
    return true;
  }

  /* ---------------- move preview (which way will it go?) ---------------- */
  function showGhost(i, which, sticky, boost) {
    var g = cur.game, car = g.cars[i], p = cur.state.pos[i];
    var ghost = $('ghost'), lane = $('lane'), mark = $('exit-mark');
    if (!ghost || p < 0) return;
    var grid = E.buildGrid(g, cur.state.pos);
    var pr = E.probe(g, grid, cur.state.pos, i, which);
    if (boost === 'nudge') { // a nudge goes exactly one cell (or nowhere)
      var nt = E.nudgeTo(g, cur.state, i, which);
      pr = nt === null ? { kind: 'bump' } : { kind: 'slide', dist: 1 };
    }
    var s = which === FWD ? car.sign : -car.sign;
    ghost.className = 'ghost'; lane.className = 'lane'; mark.className = 'exit-mark';
    var b0 = carBox(i, p), dest;
    if (pr.kind === 'bump') {
      ghost.className = 'ghost show bump' + (sticky ? ' sticky' : '');
      dest = b0;
    } else if (pr.kind === 'slide') {
      dest = carBox(i, p + s * pr.dist);
      ghost.className = 'ghost show' + (sticky ? ' sticky' : '');
    } else {
      // exit: lane highlight to the edge + exit arrow
      var edgeP = s > 0 ? car.span - car.len : 0;
      dest = carBox(i, edgeP);
      ghost.className = 'ghost show exit' + (sticky ? ' sticky' : '');
      var dir = car.dir;
      mark.className = 'exit-mark show ' + dir;
      var mx = dest.left + dest.width / 2, my = dest.top + dest.height / 2;
      if (dir === 'right') mx = g.cols * cell - cell * 0.22; if (dir === 'left') mx = cell * 0.22;
      if (dir === 'down') my = g.rows * cell - cell * 0.22; if (dir === 'up') my = cell * 0.22;
      mark.style.left = mx + 'px'; mark.style.top = my + 'px';
    }
    ghost.style.left = dest.left + 'px'; ghost.style.top = dest.top + 'px';
    ghost.style.width = dest.width + 'px'; ghost.style.height = dest.height + 'px';
    // lane strip covering start..dest
    var L = Math.min(b0.left, dest.left), T = Math.min(b0.top, dest.top);
    var R = Math.max(b0.left + b0.width, dest.left + dest.width), B = Math.max(b0.top + b0.height, dest.top + dest.height);
    lane.style.left = L + 'px'; lane.style.top = T + 'px'; lane.style.width = (R - L) + 'px'; lane.style.height = (B - T) + 'px';
    lane.className = 'lane show' + (pr.kind === 'bump' ? ' bump' : '') + (car.horiz ? ' h' : ' v');
  }
  function hideGhost(force) {
    var ghost = $('ghost');
    if (!ghost) return;
    if (!force && ghost.classList.contains('sticky')) return;
    ghost.className = 'ghost'; $('lane').className = 'lane'; $('exit-mark').className = 'exit-mark';
  }

  /* ---------------- wiring ---------------- */
  /*
   * Controls: TAP a car = drive forward (toward its nose). SWIPE / DRAG a car
   * along its axis = move it that way (toward the nose = forward, toward the
   * tail = reverse). Desktop extras: right-click or Shift+click = reverse.
   * While the finger is down, a ghost shows exactly where the car will stop.
   */
  var drag = null;
  var lotEl = $('lot');
  lotEl.addEventListener('pointerdown', function (e) {
    if (!cur || cur.ended) return;
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    var el = e.target.closest ? e.target.closest('.car') : null;
    if (!el || el.classList.contains('leaving')) return;
    e.preventDefault();
    var id = +el.getAttribute('data-id');
    var back = e.pointerType === 'mouse' && (e.button === 2 || e.shiftKey);
    if (cur.boostMode === 'tow' || cur.boostMode === 'flip') { drag = { id: id, x: e.clientX, y: e.clientY, pid: e.pointerId, which: FWD, swiped: false, cancel: false, boost: cur.boostMode, tapOnly: true }; el.classList.add('pressed'); return; }
    drag = { id: id, x: e.clientX, y: e.clientY, pid: e.pointerId, which: back ? BACK : FWD, swiped: false, cancel: false, forced: back, boost: cur.boostMode };
    try { lotEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    clearHint();
    el.classList.add('pressed');
    showGhost(id, drag.which, false, drag.boost);
  });
  lotEl.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pid || drag.tapOnly) return;
    var car = cur.game.cars[drag.id];
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    var along = car.horiz ? dx : dy, perp = car.horiz ? dy : dx;
    var th = Math.max(10, cell * 0.2);
    if (Math.abs(along) >= th && Math.abs(along) >= Math.abs(perp)) {
      var w = (along > 0 ? 1 : -1) === car.sign ? FWD : BACK;
      drag.swiped = true; drag.cancel = false;
      if (w !== drag.which || !$('ghost').classList.contains('show')) { drag.which = w; showGhost(drag.id, w, false, drag.boost); }
    } else if (Math.abs(perp) >= th * 1.5 && Math.abs(perp) > Math.abs(along) * 1.5) {
      drag.cancel = true; hideGhost(true);   // sideways drag = cancel
    }
  });
  function endDrag(e, commit) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    var d = drag; drag = null;
    var el = cur.carEls[d.id];
    if (el) el.classList.remove('pressed');
    hideGhost(true);
    if (!commit || d.cancel) return;
    if (d.boost) applyBoost(d.boost, d.id, d.which);
    else doMove(d.id, d.which);
  }
  lotEl.addEventListener('pointerup', function (e) { endDrag(e, true); });
  lotEl.addEventListener('pointercancel', function (e) { endDrag(e, false); });
  lotEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // v8: Play / Continue opens the city map; the bus drives on to the stop to play next
  $('btn-play').addEventListener('click', function () { Sound.unlock(); showMap({}); });
  // v9.1: Map from inside a level keeps the bus on that level (it no longer drives on to the Continue stop)
  $('btn-menu').addEventListener('click', function () { showMap(cur ? { stay: cur.index } : {}); });
  $('btn-map-home').addEventListener('click', function () { M.driving = null; renderLevelGrid(); show('screen-title'); try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// */ } });
  $('btn-map-play').addEventListener('click', function () { Sound.unlock(); goToStop(firstUnsolved()); });
  $('btn-map-chest').addEventListener('click', function () { var rc = readyChests(); if (!rc.length) return; Sound.unlock(); scrollMapTo(nodeOfChest[rc[0]]); openChest(rc[0], {}); });
  $('chest-big').addEventListener('click', crackChest);
  $('btn-chest-open').addEventListener('click', crackChest);
  $('btn-chest-later').addEventListener('click', closeChest);
  $('btn-chest-collect').addEventListener('click', closeChest);
  $('btn-restart').addEventListener('click', function () { if (cur) startLevel(cur.index); });
  $('btn-undo').addEventListener('click', undo);
  $('btn-hint').addEventListener('click', hint);
  BOOSTER_ORDER.forEach(function (k) { $('bst-' + k).addEventListener('click', function () { Sound.unlock(); askBuy(k); }); });
  $('btn-dead-shop').addEventListener('click', function () {   // show the booster bar under the dead-end banner
    $('deadend').classList.remove('show');
    var bar = $('booster-bar'); bar.classList.remove('attention'); void bar.offsetWidth; bar.classList.add('attention');
    setTimeout(function () { bar.classList.remove('attention'); }, 1600);
  });
  $('btn-confirm').addEventListener('click', confirmBuy);
  $('btn-confirm-cancel').addEventListener('click', function () { closeShop(); toast('No coins spent'); });
  $('btn-boost-cancel').addEventListener('click', function () { setBoostMode(null); toast('No coins spent'); });
  $('btn-coach').addEventListener('click', function () { if (!(cur && cur.cheatOnly)) { progress.seen.scramble = true; saveProgress(); } overlay('ov-coach', false); if (cur && cur.scramble) showBanner(); });
  $('btn-howto').addEventListener('click', function () { overlay('ov-howto', true); });
  $('btn-howto-close').addEventListener('click', function () { overlay('ov-howto', false); });
  $('btn-dead-undo').addEventListener('click', function () {
    if (cur.undos > 0 && cur.history.length) undo(); else startLevel(cur.index);
  });
  $('btn-dead-retry').addEventListener('click', function () { startLevel(cur.index); });
  $('btn-retry').addEventListener('click', function () { startLevel(cur.index); });
  $('btn-replay').addEventListener('click', function () { startLevel(cur.index); });
  // after a win the bus drives on to the next stop and the level starts (or to the district chest after a boss)
  $('btn-next').addEventListener('click', function () {
    if (cur.index >= LEVELS.length - 1) showMap({});
    else showMap({ next: cur.index + 1, autoStart: true });
  });
  // v9.1: Map after a win: the bus may move on only to the stop right after the level just won (or a boss's chest);
  // Map after a loss: it stays on the level
  $('btn-win-menu').addEventListener('click', function () {
    if (!cur) { showMap({}); return; }
    showMap(cur.index < LEVELS.length - 1 ? { won: cur.index, next: cur.index + 1 } : { won: cur.index });
  });
  $('btn-lose-menu').addEventListener('click', function () { showMap(cur ? { stay: cur.index } : {}); });
  /* ---------------- settings ---------------- */
  function renderSettings() {
    $('set-sound').checked = !!progress.sound;
    var box = $('test-toggles');
    if (!box.firstChild) {
      TEST_TOGGLES.forEach(function (o) {
        var row = document.createElement('div');
        row.className = 'set-row';
        row.innerHTML = '<span class="set-label"><b>' + o.label + '</b><small>' + o.desc + '</small></span><label class="switch"><input type="checkbox" role="switch" id="test-' + o.key + '" aria-label="' + o.label + '"><i></i></label>';
        box.appendChild(row);
        row.querySelector('input').addEventListener('change', function (e) { test[o.key] = e.target.checked; saveTest(); renderSettings(); renderLevelGrid(); });
      });
    }
    TEST_TOGGLES.forEach(function (o) { $('test-' + o.key).checked = !!test[o.key]; });
    $('btn-test-off').disabled = !testOn();
    renderPaints();
    $('ov-settings').classList.toggle('test-on', testOn());
    renderTestMode();
  }
  function openSettings() { $('reset-confirm').classList.remove('show'); renderSettings(); overlay('ov-settings', true); }
  $('btn-settings').addEventListener('click', function () { Sound.unlock(); openSettings(); });
  $('btn-settings-close').addEventListener('click', function () { overlay('ov-settings', false); renderLevelGrid(); });
  $('set-sound').addEventListener('change', function (e) { progress.sound = e.target.checked; saveProgress(); Sound.unlock(); });
  $('btn-test-off').addEventListener('click', function () { TEST_TOGGLES.forEach(function (o) { test[o.key] = false; }); saveTest(); renderSettings(); renderLevelGrid(); });
  $('btn-reset').addEventListener('click', function () {
    $('reset-confirm').classList.add('show');
    // v9: the settings card grew (5 paints); make sure the Yes / Cancel buttons are on screen
    var c = $('reset-confirm'); if (c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
  });
  $('btn-reset-cancel').addEventListener('click', function () { $('reset-confirm').classList.remove('show'); });
  $('btn-reset-yes').addEventListener('click', function () {
    progress = { v: PROGRESS_VERSION, unlocked: 0, stars: {}, best: {}, sound: progress.sound, coins: 0, seen: {}, inv: { tow: 0, bay: 0, nudge: 0, flip: 0 }, chests: {}, paints: ['classic'], paint: 'classic' };
    M.busNode = null;
    saveProgress(); applyPaint(); $('reset-confirm').classList.remove('show'); renderLevelGrid(); renderSettings(); toast('Progress reset');
  });
  document.addEventListener('keydown', function (e) {
    if (!cur || !$('screen-game').classList.contains('active')) return;
    if (e.key === 'Escape') { if (cur.boostMode) setBoostMode(null); else if ($('ov-shop').classList.contains('show')) toast('No coins spent'); closeShop(); return; }
    if ($('ov-shop').classList.contains('show') || $('ov-coach').classList.contains('show')) return;
    if (e.key === 'r' || e.key === 'R') startLevel(cur.index);
    else if (e.key === 'u' || e.key === 'U' || ((e.ctrlKey || e.metaKey) && e.key === 'z')) undo();
  });
  // No double-tap / pinch zoom on mobile.
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  window.addEventListener('resize', function () {
    if ($('screen-map').classList.contains('active')) { if (!M.driving) { var keep = M.busNode; renderMap(); if (keep !== null) placeBus(keep, true); } }
    else if (cur) layout();
  });
  window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });

  // Test / debug hook (read-only helpers).
  window.WJB = {
    levels: LEVELS,
    /** v9.1: the release (index.html <meta name="wjb-version">, same as package.json) */
    version: (function () { var m = document.querySelector('meta[name="wjb-version"]'); return m ? m.getAttribute('content') : ''; })(),
    get session() { return cur; },
    get progress() { return progress; },
    startLevel: startLevel,
    /** optimal remaining moves from the current state: [{car, which: 0 fwd | 1 back}] */
    solution: function () { return cur ? E.solve(cur.game, cur.state).path : null; },
    boosters: BOOSTERS,
    get test() { return test; },
    idle: function () { return cur ? cur.chain : Promise.resolve(); },
    /** v8 city map (read-only): districts, the bus, where stops and chests sit */
    map: {
      districts: DISTRICTS, paints: PAINTS,
      get busNode() { return M.busNode; }, get busAt() { return M.busNode === null ? null : nodeKey(M.busNode); },
      get driving() { return M.driving ? { to: nodeKey(M.driving.to), t: M.driving.t } : null; },
      chestState: chestState, districtOf: function (n) { return DISTRICTS[DIST_OF[n - 1]].id; },
      nodeKey: nodeKey, nodeOfLevel: function (n) { return nodeOfLevel[n - 1]; }, nodeOfChest: function (k) { return nodeOfChest[k]; },
      point: function (n) { return M.pts[n]; }, parkPoint: function (n) { return pointAt(parkLen(n)); }
    },
    showMap: showMap,
    searching: function () { return !!(cur && cur.search); }
  };

  // Boot: #level-N or ?level=N opens that level directly (handy for testing), #map the city map, otherwise the title screen.
  applyPaint();
  renderLevelGrid();
  function levelFromUrl() {
    var m = /level[-=](\d+)/.exec(location.hash + ' ' + location.search);
    return m && LEVELS[+m[1] - 1] ? +m[1] - 1 : -1;
  }
  window.addEventListener('hashchange', function () {
    var n = levelFromUrl();
    if (n >= 0) startLevel(n);
  });
  var first = levelFromUrl();
  if (first >= 0) startLevel(first);
  else if (/^#map$/.test(location.hash)) showMap({});
  else show('screen-title');
})();
