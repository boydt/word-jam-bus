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
  var STORE_KEY = 'wordJamBus.progress.v1';

  /* ---------------- persistence ---------------- */
  // Saved progress: { v, unlocked, unlockedId, stars{id:n}, best{id:moves}, sound, coins, seen{} }.
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
    if (p.sound === undefined) p.sound = true;
    p.coins = Math.max(0, p.coins | 0);
    p.seen = p.seen || {};
    return p;
  }
  function saveProgress() {
    progress.unlockedId = LEVELS[progress.unlocked] ? LEVELS[progress.unlocked].id : undefined;
    try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* private mode */ }
  }
  var progress = loadProgress();
  saveProgress(); // persist a migrated save right away

  /* ---------------- coins + boosters ---------------- */
  // Fares: 1 coin per seat filled and 10 per Bay Word, banked when the level is
  // won (the fare box is part of the game state, so Undo keeps it honest).
  // A win at or under par without boosters doubles the fares; the first clear of
  // a level adds 20. Boosters are never needed: every par is proven without them.
  var FARE = 1, BAYWORD_COINS = 10, FIRST_CLEAR = 20;
  var BOOSTERS = {
    tow: { price: 150, name: 'Tow truck', desc: 'Tow away one car the bus can do without (a wrong letter or a spare copy).', how: 'Tap a glowing car to tow it away.' },
    bay: { price: 100, name: 'Bay +1', desc: 'One extra holding-bay spot for the rest of this level.', how: '' },
    nudge: { price: 60, name: 'Nudge', desc: 'Move one car exactly one cell, then it stays put.', how: 'Tap a car to inch it forward, or swipe it back one cell.' }
  };
  function purseOf(st) { return (st.idx || 0) * FARE + (st.words || 0) * BAYWORD_COINS; }
  function spentOf(st) { var u = st.used || {}, t = 0; Object.keys(BOOSTERS).forEach(function (k) { t += (u[k] || 0) * BOOSTERS[k].price; }); return t; }

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
    lose: function () { this.tone(330, 0.5, 'sawtooth', 0.07, 110); }
  };
  function buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } }

  /* ---------------- screens ---------------- */
  function show(id) {
    ['screen-title', 'screen-game'].forEach(function (s) { $(s).classList.toggle('active', s === id); });
  }
  function overlay(id, on) {
    $(id).classList.toggle('show', on);
    $(id).setAttribute('aria-hidden', on ? 'false' : 'true');
  }
  function hideOverlays() { ['ov-win', 'ov-lose', 'ov-shop', 'ov-coach', 'ov-howto'].forEach(function (id) { overlay(id, false); }); $('deadend').classList.remove('show'); }

  function starText(n) { return '\u2605\u2605\u2605'.slice(0, n) + '\u2606\u2606\u2606'.slice(0, 3 - n); }

  function renderLevelGrid() {
    var grid = $('level-grid');
    grid.innerHTML = '';
    LEVELS.forEach(function (lv, i) {
      var b = document.createElement('button');
      var locked = !isUnlocked(i);
      var stars = progress.stars[lv.id] || 0;
      var scr = lv.mode === 'scramble';
      b.className = 'lvl' + (locked ? ' locked' : '') + (stars ? ' done' : '') + (i === firstUnsolved() ? ' current' : '') + (scr ? ' scr' : '');
      b.setAttribute('data-level', i + 1);
      b.innerHTML = '<span>' + (locked ? '\uD83D\uDD12' : (i + 1)) + '</span><small>' + (locked ? '' : starText(stars)) + '</small>' + (scr ? SHUFFLE_SVG.replace('<svg', '<svg class="lvl-scr"') : '');
      b.setAttribute('aria-label', 'Level ' + (i + 1) + (scr ? ' (Scramble: any order)' : '') + (locked ? ' (locked)' : ''));
      if (locked) b.disabled = true;
      b.addEventListener('click', function () { Sound.unlock(); startLevel(i); });
      grid.appendChild(b);
    });
    $('btn-sound').textContent = 'Sound: ' + (progress.sound ? 'on' : 'off');
    $('btn-play').textContent = Object.keys(progress.stars).length ? 'Continue' : 'Play';
    $('title-coins').textContent = progress.coins;
  }
  var SHUFFLE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h3.5c2 0 3 1 4.2 2.6l2.6 4.8C14.5 16 15.5 17 17.5 17H21"/><path d="M3 17h3.5c2 0 3-1 4.2-2.6"/><path d="M13.3 9.6C14.5 8 15.5 7 17.5 7H21"/><path d="M18 4l3 3-3 3"/><path d="M18 14l3 3-3 3"/></svg>';
  /** A level is open if it is within the unlock frontier or it (or any later level) was ever completed. */
  function isUnlocked(i) {
    if (i <= progress.unlocked) return true;
    for (var j = i; j < LEVELS.length; j++) if (progress.stars[LEVELS[j].id]) return true;
    return false;
  }
  /** Where "Play/Continue" goes: the first unsolved open level after the furthest completed one. */
  function firstUnsolved() {
    var last = -1, i;
    for (i = 0; i < LEVELS.length; i++) if (progress.stars[LEVELS[i].id]) last = i;
    for (i = last + 1; i < LEVELS.length; i++) if (isUnlocked(i) && !progress.stars[LEVELS[i].id]) return i;
    for (i = 0; i < LEVELS.length; i++) if (isUnlocked(i) && !progress.stars[LEVELS[i].id]) return i;
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
      scramble: game.scramble, boostMode: null
    };
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
    } else hideBanner();
  }

  /* ---------------- Scramble: start banner + first-time coach card ---------------- */
  function showBanner() {
    var b = $('banner');
    b.innerHTML = '<div class="bn-title">' + SHUFFLE_SVG + ' Scramble stop!</div><div class="bn-sub">Letters board in <b>ANY</b> order</div><div class="bn-letters">' +
      cur.game.target.split('').map(function (ch, k) { return '<span style="animation-delay:' + (k * 60) + 'ms">' + ch + '</span>'; }).join('') + '</div>';
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
      el.setAttribute('aria-label', (wild ? 'wildcard taxi' : 'car ' + car.l) + ' facing ' + car.dir);
      el.style.setProperty('--c', PALETTE[(i * 5 + car.r * 3 + car.c) % PALETTE.length]);
      el.innerHTML = '<div class="chassis"><i class="rear"></i><i class="stripe"></i><i class="glass"></i>' +
        '<span class="lights"><i></i><i></i></span><i class="arrow"></i><i class="tail"></i></div>' +
        '<div class="roof">' + car.l + '</div>';
      if (cur.state.pos[i] < 0) el.style.display = 'none';
      lot.appendChild(el);
      return el;
    });
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

  function layout() {
    if (!cur) return;
    var g = cur.game;
    // word tiles
    var appW = Math.min(document.getElementById('app').clientWidth, 620);
    var n = g.target.length, gaps = g.words.length - 1;
    tileSize = Math.max(26, Math.min(46, Math.floor((appW - 60 - 5 * (n - 1) - gaps * 30) / n)));
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
      ch.style.transform = 'translate(-50%, -50%) rotate(' + ANGLE[car.dir] + 'deg)';
    });
    void lot.offsetWidth;
    lot.classList.remove('no-anim');
  }

  /* ---------------- HUD rendering (from the display state) ---------------- */
  function renderHud() {
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
    $('undo-count').textContent = cur.undos;
    $('btn-undo').disabled = cur.undos <= 0 || !cur.history.length || cur.ended;
    $('hint-count').textContent = cur.hints;
    $('btn-hint').disabled = cur.hints <= 0 || cur.ended;
    renderCoins();
  }
  function renderCoins() {
    $('coin-count').textContent = progress.coins;
    var d = cur ? cur.disp : null, purse = d ? (scrCount(d) * FARE + (d.words || 0) * BAYWORD_COINS) : 0;
    $('purse').textContent = '+' + purse;
    $('purse').classList.toggle('show', purse > 0 && !!cur && !cur.banked);
    $('btn-shop').disabled = !cur || cur.ended;
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
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg;
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
    if (res.result === 'bump') { bump(i, which, res.by); return; }
    clearHint();
    advancePlan(i, which);
    if (res.result === 'slide') {
      cur.history.push(cur.state);
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
    cur.history.push(cur.state);
    cur.state = res.state;
    $('deadend').classList.remove('show');
    renderHud();
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
      var coinBtn = $('btn-shop');
      var trips = els.map(function (e, k) { return e ? fly(cw.letters[k], rectCenter(e), coinBtn, 420) : Promise.resolve(); });
      cw.at.slice().sort(function (x, y) { return y - x; }).forEach(function (i) { cur.disp.bay.splice(i, 1); });
      cur.disp.words = (cur.disp.words || 0) + 1;
      els.forEach(function (e) { if (e) e.classList.remove('word'); });
      renderHud();
      return Promise.all(trips);
    }).then(function () {
      $('bay-zone').classList.remove('bayword');
      coinPop($('btn-shop'), '+' + BAYWORD_COINS);
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
    progress.coins += earned;
    cur.banked = true;
    progress.stars[lv.id] = Math.max(progress.stars[lv.id] || 0, stars);
    if (!assisted && (!progress.best[lv.id] || moves < progress.best[lv.id])) progress.best[lv.id] = moves;
    progress.unlocked = Math.max(progress.unlocked, Math.min(cur.index + 1, LEVELS.length - 1));
    saveProgress();
    renderCoins();
    Sound.win(); buzz([20, 30, 20]);
    $('bus').classList.add('drive-off');
    return wait(700).then(function () {
      $('win-word').textContent = cur.game.words.join(' \u2192 ');
      $('win-stars').innerHTML = [1, 2, 3].map(function (n) { return '<span class="' + (n <= stars ? 'on' : '') + '">\u2605</span>'; }).join('');
      $('win-stars').setAttribute('data-stars', stars);
      $('win-detail').textContent = 'Moves ' + moves + ' \u00b7 Par ' + par + (assisted ? ' \u00b7 Booster used (max 2\u2605)' : stars === 3 ? ' \u00b7 Perfect route!' : stars === 2 ? ' \u00b7 Close to par!' : ' \u00b7 Try for fewer moves.');
      var parts = ['fares ' + fares];
      if (parBonus) parts.push('par bonus ' + parBonus);
      if (words) parts.push('Bay Word ' + words);
      if (first) parts.push('first clear ' + first);
      $('win-coins').innerHTML = '<b>+' + earned + '</b> coins <small>(' + parts.join(' + ') + ')</small>';
      $('win-coins').setAttribute('data-earned', earned);
      var last = cur.index >= LEVELS.length - 1;
      $('btn-next').textContent = last ? 'All levels done!' : 'Next level';
      overlay('ov-win', true);
    });
  }

  function undo() {
    if (!cur || cur.ended || cur.undos <= 0 || !cur.history.length) return;
    cur.undos--;
    cur.token++;
    cancelSearch();
    cur.chain = Promise.resolve();
    $('fly-layer').innerHTML = '';
    var prev = cur.history.pop();
    var refund = spentOf(cur.state) - spentOf(prev);   // undoing a booster gives its coins back
    if (refund > 0) { progress.coins += refund; saveProgress(); }
    setBoostMode(null);
    var revived = [];
    prev.pos.forEach(function (p, i) { if (p >= 0 && cur.state.pos[i] < 0) revived.push(i); });
    cur.state = prev;
    cur.dead = false;
    cur.plan = null; cur.planOptimal = false;
    $('deadend').classList.remove('show');
    clearHint();
    syncDisplay();
    if (revived.length) { buildLot(); layout(); }
    else cur.game.cars.forEach(function (c, i) { placeCar(i); }); // animated slide back
    renderHud();
    toast(refund > 0 ? 'Undo · ' + refund + ' coins back' : 'Undo');
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
    cur.hints--;
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
  function boosterBlock(kind) { // why a booster can't be bought right now ('' = it can)
    if (!cur || cur.ended) return 'Level over';
    if (kind === 'bay' && cur.state.used.bay) return 'Used';
    if (kind === 'tow' && !cur.game.cars.some(function (c, i) { return E.towable(cur.game, cur.state, i); })) return 'No spare car';
    if (kind === 'nudge' && !cur.game.cars.some(function (c, i) { return E.nudgeTo(cur.game, cur.state, i, FWD) !== null || E.nudgeTo(cur.game, cur.state, i, BACK) !== null; })) return 'No room';
    if (progress.coins < BOOSTERS[kind].price) return 'Need ' + BOOSTERS[kind].price;
    return '';
  }
  function openShop() {
    if (!cur || cur.ended) return;
    setBoostMode(null);
    clearHint();
    $('shop-balance').textContent = progress.coins;
    $('shop-confirm').classList.remove('show');
    $('shop-list').classList.remove('hide');
    Object.keys(BOOSTERS).forEach(function (k) {
      var why = boosterBlock(k), btn = $('buy-' + k);
      btn.disabled = !!why;
      btn.innerHTML = why ? why : '<i class="coin"></i>' + BOOSTERS[k].price;
    });
    overlay('ov-shop', true);
  }
  function closeShop() { overlay('ov-shop', false); }
  function askBuy(kind) {
    if (boosterBlock(kind)) return;
    var b = BOOSTERS[kind];
    $('confirm-title').textContent = 'Spend ' + b.price + ' coins on ' + b.name + '?';
    $('confirm-detail').textContent = (b.how ? b.how + ' ' : '') + 'This level can then earn at most 2\u2605. Undo gives the coins back.';
    $('btn-confirm').innerHTML = 'Spend <i class="coin"></i>' + b.price;
    $('btn-confirm').setAttribute('data-kind', kind);
    $('shop-list').classList.add('hide');
    $('shop-confirm').classList.add('show');
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
        : kind === 'nudge' ? (E.nudgeTo(cur.game, cur.state, i, FWD) !== null || E.nudgeTo(cur.game, cur.state, i, BACK) !== null) : false;
      el.classList.toggle('can-boost', !!kind && ok);
      el.classList.toggle('no-boost', !!kind && !ok);
    });
  }
  function applyBoost(kind, i, which) {
    if (!cur || cur.ended) return false;
    var b = BOOSTERS[kind], ns = E.applyBooster(cur.game, cur.state, kind, i, which);
    if (!ns) {
      if (i !== undefined && cur.carEls[i]) { var el0 = cur.carEls[i]; el0.classList.remove('bump-' + cur.game.cars[i].dir); void el0.offsetWidth; el0.classList.add('bump-' + cur.game.cars[i].dir); setTimeout(function () { el0.classList.remove('bump-' + cur.game.cars[i].dir); }, 420); }
      toast(kind === 'tow' ? 'The bus still needs that letter' : 'No room to nudge that way', 1200);
      Sound.bump();
      return false;
    }
    if (progress.coins < b.price) { toast('Not enough coins'); setBoostMode(null); return false; }
    progress.coins -= b.price;
    saveProgress();
    clearHint();
    cur.plan = null; cur.planOptimal = false; cur.pendingHint = false;
    $('btn-hint').classList.remove('thinking');
    cur.history.push(cur.state);
    cur.state = ns;
    cur.dead = false;
    $('deadend').classList.remove('show');
    setBoostMode(null);
    if (kind === 'tow') {
      var el = cur.carEls[i];
      el.classList.add('towed');
      Sound.exit();
      setTimeout(function () { el.style.display = 'none'; el.classList.remove('towed'); }, 520);
      toast('Towed away!');
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
    if (cur.boostMode === 'tow') { drag = { id: id, x: e.clientX, y: e.clientY, pid: e.pointerId, which: FWD, swiped: false, cancel: false, boost: 'tow' }; el.classList.add('pressed'); return; }
    drag = { id: id, x: e.clientX, y: e.clientY, pid: e.pointerId, which: back ? BACK : FWD, swiped: false, cancel: false, forced: back, boost: cur.boostMode };
    try { lotEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    clearHint();
    el.classList.add('pressed');
    showGhost(id, drag.which, false, drag.boost);
  });
  lotEl.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pid || drag.boost === 'tow') return;
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

  $('btn-play').addEventListener('click', function () { Sound.unlock(); startLevel(firstUnsolved()); });
  $('btn-menu').addEventListener('click', function () { if (cur) cur.token++; hideOverlays(); renderLevelGrid(); show('screen-title'); });
  $('btn-restart').addEventListener('click', function () { if (cur) startLevel(cur.index); });
  $('btn-undo').addEventListener('click', undo);
  $('btn-hint').addEventListener('click', hint);
  $('btn-shop').addEventListener('click', function () { Sound.unlock(); openShop(); });
  $('btn-dead-shop').addEventListener('click', function () { openShop(); });
  $('btn-shop-close').addEventListener('click', closeShop);
  Object.keys(BOOSTERS).forEach(function (k) { $('buy-' + k).addEventListener('click', function () { askBuy(k); }); });
  $('btn-confirm').addEventListener('click', confirmBuy);
  $('btn-confirm-cancel').addEventListener('click', function () { $('shop-confirm').classList.remove('show'); $('shop-list').classList.remove('hide'); });
  $('btn-boost-cancel').addEventListener('click', function () { setBoostMode(null); toast('No coins spent'); });
  $('btn-coach').addEventListener('click', function () { progress.seen.scramble = true; saveProgress(); overlay('ov-coach', false); if (cur && cur.scramble) showBanner(); });
  $('btn-howto').addEventListener('click', function () { overlay('ov-howto', true); });
  $('btn-howto-close').addEventListener('click', function () { overlay('ov-howto', false); });
  $('btn-dead-undo').addEventListener('click', function () {
    if (cur.undos > 0 && cur.history.length) undo(); else startLevel(cur.index);
  });
  $('btn-dead-retry').addEventListener('click', function () { startLevel(cur.index); });
  $('btn-retry').addEventListener('click', function () { startLevel(cur.index); });
  $('btn-replay').addEventListener('click', function () { startLevel(cur.index); });
  $('btn-next').addEventListener('click', function () {
    if (cur.index >= LEVELS.length - 1) { hideOverlays(); renderLevelGrid(); show('screen-title'); }
    else startLevel(cur.index + 1);
  });
  ['btn-win-menu', 'btn-lose-menu'].forEach(function (id) {
    $(id).addEventListener('click', function () { hideOverlays(); renderLevelGrid(); show('screen-title'); });
  });
  $('btn-sound').addEventListener('click', function () { progress.sound = !progress.sound; saveProgress(); Sound.unlock(); renderLevelGrid(); });
  $('btn-reset').addEventListener('click', function () {
    if (!window.confirm('Reset all level progress?')) return;
    progress = { v: PROGRESS_VERSION, unlocked: 0, stars: {}, best: {}, sound: progress.sound, coins: 0, seen: {} };
    saveProgress(); renderLevelGrid();
  });
  document.addEventListener('keydown', function (e) {
    if (!cur || !$('screen-game').classList.contains('active')) return;
    if (e.key === 'Escape') { if (cur.boostMode) setBoostMode(null); closeShop(); return; }
    if ($('ov-shop').classList.contains('show') || $('ov-coach').classList.contains('show')) return;
    if (e.key === 'r' || e.key === 'R') startLevel(cur.index);
    else if (e.key === 'u' || e.key === 'U' || ((e.ctrlKey || e.metaKey) && e.key === 'z')) undo();
  });
  // No double-tap / pinch zoom on mobile.
  document.addEventListener('dblclick', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
  document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', function () { setTimeout(layout, 200); });

  // Test / debug hook (read-only helpers).
  window.WJB = {
    levels: LEVELS,
    get session() { return cur; },
    get progress() { return progress; },
    startLevel: startLevel,
    /** optimal remaining moves from the current state: [{car, which: 0 fwd | 1 back}] */
    solution: function () { return cur ? E.solve(cur.game, cur.state).path : null; },
    boosters: BOOSTERS,
    idle: function () { return cur ? cur.chain : Promise.resolve(); },
    searching: function () { return !!(cur && cur.search); }
  };

  // Boot: #level-N or ?level=N opens that level directly (handy for testing), otherwise the title screen.
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
  else show('screen-title');
})();
