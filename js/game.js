/* Word Jam Bus - browser game (UI, animation, input, saving). Rules live in engine.js. */
(function () {
  'use strict';
  var E = window.WJBEngine;
  var LEVELS = window.WJB_LEVELS || [];
  var $ = function (id) { return document.getElementById(id); };
  var PALETTE = ['#ff6b6b', '#4dabf7', '#51cf66', '#ff922b', '#cc5de8', '#20c997', '#f06595', '#5c7cfa', '#94d82d', '#e8590c', '#15aabf', '#be4bdb'];
  var ANGLE = { right: 0, down: 90, left: 180, up: -90 };
  var UNDOS_PER_LEVEL = 3, HINTS_PER_LEVEL = 1;
  var STORE_KEY = 'wordJamBus.progress.v1';

  /* ---------------- persistence ---------------- */
  function loadProgress() {
    var p = null;
    try { p = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { p = null; }
    if (!p || typeof p !== 'object') p = {};
    p.unlocked = Math.max(0, Math.min(LEVELS.length - 1, p.unlocked | 0));
    p.stars = p.stars || {};
    p.best = p.best || {};
    if (p.sound === undefined) p.sound = true;
    return p;
  }
  function saveProgress() { try { localStorage.setItem(STORE_KEY, JSON.stringify(progress)); } catch (e) { /* private mode */ } }
  var progress = loadProgress();

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
      var locked = i > progress.unlocked;
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
  function firstUnsolved() {
    for (var i = 0; i <= progress.unlocked; i++) if (!progress.stars[LEVELS[i].id]) return i;
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
      chain: Promise.resolve(), disp: { idx: 0, bay: [], wild: {} }, carEls: []
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
    lot.innerHTML = '';
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
        '<span class="lights"><i></i><i></i></span><i class="arrow"></i></div>' +
        '<div class="roof">' + car.l + '</div>';
      if (cur.state.removed[i]) el.style.display = 'none';
      lot.appendChild(el);
      return el;
    });
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
    g.cars.forEach(function (car, i) {
      var el = cur.carEls[i];
      var rs = car.cells.map(function (x) { return x[0]; }), cs = car.cells.map(function (x) { return x[1]; });
      var r0 = Math.min.apply(null, rs), c0 = Math.min.apply(null, cs);
      var hr = Math.max.apply(null, rs) - r0 + 1, wc = Math.max.apply(null, cs) - c0 + 1;
      el.style.left = (c0 - 1) * cell + 'px';
      el.style.top = (r0 - 1) * cell + 'px';
      el.style.width = wc * cell + 'px';
      el.style.height = hr * cell + 'px';
      var ch = el.querySelector('.chassis');
      ch.style.width = (car.len * cell - pad * 2) + 'px';
      ch.style.height = (cell - pad * 2) + 'px';
      ch.style.transform = 'translate(-50%, -50%) rotate(' + ANGLE[car.dir] + 'deg)';
    });
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

  function driveOut(i) {
    var car = cur.game.cars[i], el = cur.carEls[i], g = cur.game;
    var head = car.cells[0], dist;
    if (car.dir === 'right') dist = (g.cols - head[1] + car.len) * cell;
    else if (car.dir === 'left') dist = (head[1] - 1 + car.len) * cell;
    else if (car.dir === 'down') dist = (g.rows - head[0] + car.len) * cell;
    else dist = (head[0] - 1 + car.len) * cell;
    dist += cell * 0.3;
    var v = E.DIRS[car.dir];
    el.classList.add('leaving');
    el.classList.remove('hint');
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

  function onTap(i) {
    if (!cur || cur.ended) return;
    Sound.unlock();
    var el = cur.carEls[i];
    var res = E.step(cur.game, cur.state, i);
    if (res.result === 'gone') return;
    if (res.result === 'blocked') {
      cur.bumps++;
      var cls = 'bump-' + cur.game.cars[i].dir;
      el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
      var bl = cur.carEls[res.by];
      bl.classList.remove('blocker'); void bl.offsetWidth; bl.classList.add('blocker');
      setTimeout(function () { el.classList.remove(cls); bl.classList.remove('blocker'); }, 420);
      Sound.bump(); buzz(30);
      toast('Blocked!');
      return;
    }
    var from = rectCenter(el.querySelector('.roof'));
    clearHint();
    driveOut(i);
    Sound.exit();
    if (res.result === 'lose') {
      cur.ended = true;
      cur.state = res.state;
      renderHud();
      enqueue(function () {
        var slots = $('bay').querySelectorAll('.slot');
        return fly(res.unit, from, slots[slots.length - 1] || $('bay'), 300).then(function () {
          $('bay').classList.add('danger');
          Sound.lose(); buzz([60, 40, 60]);
          return wait(250);
        }).then(function () {
          $('lose-title').textContent = 'Bay full!';
          $('lose-detail').textContent = 'The ' + res.unit + ' car had nowhere to park. Plan which wrong letters you can afford to park in the bay.';
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
    // 3) end-of-move checks
    if (res.won) {
      cur.ended = true;
      enqueue(function () { syncDisplay(); renderHud(); return wait(150).then(winLevel); });
    } else if (E.solve(cur.game, cur.state).par === null) {
      cur.dead = true;
      enqueue(function () { syncDisplay(); renderHud(); $('deadend').classList.add('show'); Sound.bump(); });
    } else {
      cur.dead = false;
      enqueue(function () { syncDisplay(); renderHud(); });
    }
  }

  function clearHint() { cur.carEls.forEach(function (el) { el.classList.remove('hint'); }); }

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
    cur.chain = Promise.resolve();
    $('fly-layer').innerHTML = '';
    cur.state = cur.history.pop();
    cur.dead = false;
    $('deadend').classList.remove('show');
    syncDisplay();
    buildLot();
    layout();
    renderHud();
    toast('Undo');
  }

  function hint() {
    if (!cur || cur.ended || cur.hints <= 0) return;
    var sol = E.solve(cur.game, cur.state);
    if (sol.par === null) { $('deadend').classList.add('show'); return; }
    cur.hints--;
    clearHint();
    cur.carEls[sol.path[0]].classList.add('hint');
    renderHud();
  }

  /* ---------------- wiring ---------------- */
  $('lot').addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.car') : null;
    if (el && !el.classList.contains('leaving')) onTap(+el.getAttribute('data-id'));
  });
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
    progress = { unlocked: 0, stars: {}, best: {}, sound: progress.sound };
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
    solution: function () { return cur ? E.solve(cur.game, cur.state).path : null; },
    idle: function () { return cur ? cur.chain : Promise.resolve(); }
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
