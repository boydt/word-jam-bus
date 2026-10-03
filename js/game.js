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
  // Saved progress: { v, unlocked, stars{id:n}, best{id:moves}, sound }.
  // Stars are keyed by level id, so they survive level re-ordering. `unlocked`
  // is an index into LEVELS: saves without `v` come from builds before the 10
  // starter levels were inserted at the front, so their index is shifted past
  // the starter levels (which are unlocked for anyone with earlier progress).
  var PROGRESS_VERSION = 3;
  var STARTER_COUNT = LEVELS.filter(function (lv) { return lv.tier === 'starter'; }).length;
  function loadProgress() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { p = null; }
    if (!p || typeof p !== 'object') p = {};
    p.stars = p.stars || {};
    p.best = p.best || {};
    if (p.v === undefined && ((p.unlocked | 0) > 0 || Object.keys(p.stars).length)) p.unlocked = (p.unlocked | 0) + STARTER_COUNT;
    p.v = PROGRESS_VERSION;
    p.unlocked = Math.max(0, Math.min(LEVELS.length - 1, p.unlocked | 0));
    if (p.sound === undefined) p.sound = true;
    return p;
  }
  function saveProgress() { try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* private mode */ } }
  var progress = loadProgress();
  saveProgress(); // persist a migrated save right away

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
  function hideOverlays() { overlay('ov-win', false); overlay('ov-lose', false); $('deadend').classList.remove('show'); }

  function starText(n) { return '\u2605\u2605\u2605'.slice(0, n) + '\u2606\u2606\u2606'.slice(0, 3 - n); }

  function renderLevelGrid() {
    var grid = $('level-grid');
    grid.innerHTML = '';
    LEVELS.forEach(function (lv, i) {
      var b = document.createElement('button');
      var locked = !isUnlocked(i);
      var stars = progress.stars[lv.id] || 0;
      b.className = 'lvl' + (locked ? ' locked' : '') + (stars ? ' done' : '') + (i === firstUnsolved() ? ' current' : '');
      b.setAttribute('data-level', i + 1);
      b.innerHTML = '<span>' + (locked ? '\uD83D\uDD12' : (i + 1)) + '</span><small>' + (locked ? '' : starText(stars)) + '</small>';
      b.setAttribute('aria-label', 'Level ' + (i + 1) + (locked ? ' (locked)' : ''));
      if (locked) b.disabled = true;
      b.addEventListener('click', function () { Sound.unlock(); startLevel(i); });
      grid.appendChild(b);
    });
    $('btn-sound').textContent = 'Sound: ' + (progress.sound ? 'on' : 'off');
    $('btn-play').textContent = Object.keys(progress.stars).length ? 'Continue' : 'Play';
  }
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
      chain: Promise.resolve(), disp: { idx: 0, bay: [], wild: {} }, carEls: [],
      plan: null, planOptimal: false, search: null, serial: 0, pendingHint: false
    };
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
    var g = cur.game, d = cur.disp;
    $('hud-moves').textContent = cur.state.moves;
    var tiles = $('word').querySelectorAll('.tile');
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i], filled = i < d.idx, was = t.classList.contains('filled');
      t.classList.toggle('filled', filled);
      t.classList.toggle('wild', !!d.wild[i] && filled);
      t.classList.toggle('next', i === d.idx && !cur.ended);
      if (filled && !was) { t.style.animation = 'none'; void t.offsetWidth; t.style.animation = ''; }
    }
    var groups = $('word').querySelectorAll('.word-group');
    for (var k = 0; k < groups.length; k++) {
      var s = +groups[k].getAttribute('data-start'), e = +groups[k].getAttribute('data-end');
      groups[k].classList.toggle('inactive', !(d.idx >= s && d.idx < e) && d.idx < e);
    }
    var slots = $('bay').querySelectorAll('.slot');
    for (var j = 0; j < slots.length; j++) {
      var u = d.bay[j];
      slots[j].textContent = u || '';
      slots[j].classList.toggle('full', !!u);
      slots[j].classList.toggle('chunk', !!u && u.length > 1);
    }
    var free = g.cap - d.bay.length;
    $('bay').classList.toggle('warn', free === 1);
    $('bay').classList.toggle('danger', free <= 0);
    $('bay-count').textContent = '(' + d.bay.length + '/' + g.cap + ')';
    $('undo-count').textContent = cur.undos;
    $('btn-undo').disabled = cur.undos <= 0 || !cur.history.length || cur.ended;
    $('hint-count').textContent = cur.hints;
    $('btn-hint').disabled = cur.hints <= 0 || cur.ended;
  }

  function syncDisplay() {
    var s = cur.state, d = { idx: s.idx, bay: s.bay.slice(), wild: {} };
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
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 900);
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
          $('lose-detail').textContent = 'The ' + res.unit + ' car had nowhere to park. Slide decoys out of the way instead of driving them out.';
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
      else target = $('bay').querySelector('.slot[data-bay="' + cur.disp.bay.length + '"]');
      var label = res.unit === '?' ? res.fillLetters : res.unit;
      return fly(label, from, target || $('bay')).then(function () {
        if (res.result === 'fill') {
          if (res.unit === '?') cur.disp.wild[res.slot] = true;
          cur.disp.idx = res.slot + (res.unit === '?' ? 1 : res.unit.length);
          Sound.fill(0); buzz(15);
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
          renderHud();
        });
      });
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
    var lv = cur.level, moves = cur.state.moves, par = lv.par;
    var stars = par === undefined ? 3 : moves <= par ? 3 : moves <= par + 2 ? 2 : 1;
    progress.stars[lv.id] = Math.max(progress.stars[lv.id] || 0, stars);
    if (!progress.best[lv.id] || moves < progress.best[lv.id]) progress.best[lv.id] = moves;
    progress.unlocked = Math.max(progress.unlocked, Math.min(cur.index + 1, LEVELS.length - 1));
    saveProgress();
    Sound.win(); buzz([20, 30, 20]);
    $('bus').classList.add('drive-off');
    return wait(700).then(function () {
      $('win-word').textContent = cur.game.words.join(' \u2192 ');
      $('win-stars').innerHTML = [1, 2, 3].map(function (n) { return '<span class="' + (n <= stars ? 'on' : '') + '">\u2605</span>'; }).join('');
      $('win-stars').setAttribute('data-stars', stars);
      $('win-detail').textContent = 'Moves ' + moves + ' \u00b7 Par ' + par + (stars === 3 ? ' \u00b7 Perfect route!' : stars === 2 ? ' \u00b7 Close to par!' : ' \u00b7 Try for fewer moves.');
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
    toast('Undo');
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

  /* ---------------- move preview (which way will it go?) ---------------- */
  function showGhost(i, which, sticky) {
    var g = cur.game, car = g.cars[i], p = cur.state.pos[i];
    var ghost = $('ghost'), lane = $('lane'), mark = $('exit-mark');
    if (!ghost || p < 0) return;
    var grid = E.buildGrid(g, cur.state.pos);
    var pr = E.probe(g, grid, cur.state.pos, i, which);
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
    drag = { id: id, x: e.clientX, y: e.clientY, pid: e.pointerId, which: back ? BACK : FWD, swiped: false, cancel: false, forced: back };
    try { lotEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    clearHint();
    el.classList.add('pressed');
    showGhost(id, drag.which);
  });
  lotEl.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pid) return;
    var car = cur.game.cars[drag.id];
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    var along = car.horiz ? dx : dy, perp = car.horiz ? dy : dx;
    var th = Math.max(10, cell * 0.2);
    if (Math.abs(along) >= th && Math.abs(along) >= Math.abs(perp)) {
      var w = (along > 0 ? 1 : -1) === car.sign ? FWD : BACK;
      drag.swiped = true; drag.cancel = false;
      if (w !== drag.which || !$('ghost').classList.contains('show')) { drag.which = w; showGhost(drag.id, w); }
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
    if (commit && !d.cancel) doMove(d.id, d.which);
  }
  lotEl.addEventListener('pointerup', function (e) { endDrag(e, true); });
  lotEl.addEventListener('pointercancel', function (e) { endDrag(e, false); });
  lotEl.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  $('btn-play').addEventListener('click', function () { Sound.unlock(); startLevel(firstUnsolved()); });
  $('btn-menu').addEventListener('click', function () { if (cur) cur.token++; hideOverlays(); renderLevelGrid(); show('screen-title'); });
  $('btn-restart').addEventListener('click', function () { if (cur) startLevel(cur.index); });
  $('btn-undo').addEventListener('click', undo);
  $('btn-hint').addEventListener('click', hint);
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
    progress = { v: PROGRESS_VERSION, unlocked: 0, stars: {}, best: {}, sound: progress.sound };
    saveProgress(); renderLevelGrid();
  });
  document.addEventListener('keydown', function (e) {
    if (!cur || !$('screen-game').classList.contains('active')) return;
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
