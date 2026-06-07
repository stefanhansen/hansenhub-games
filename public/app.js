'use strict';
// HansenHub Games — landing, wordsearch puzzle list, play, leaderboard.

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const whoChip = $('#who-chip');
const HUB = 'https://hansenhub.net/';

async function api(path, opts) {
  const res = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts));
  if (res.status === 401) { window.location.href = HUB; throw new Error('unauth'); }
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (res.status === 409) { window.location.href = (data && data.hub) || HUB; throw new Error('noplayer'); }
  if (!res.ok) throw new Error('api ' + res.status);
  return data;
}
function el(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmt(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }

const WORD_COLORS = ['#ff6b5e', '#2ec4b6', '#f0ad26', '#9b6bff', '#3aa0ff', '#ff8fab', '#5ec26a', '#ff9f1c'];
const colorFor = (i) => WORD_COLORS[i % WORD_COLORS.length];

const state = { person: null };
let teardown = null;

// Games are additive — drop another entry here later.
const GAMES = [
  { key: 'ws', name: 'Word Search', emoji: '🔤', ready: true },
];

function renderWhoChip() {
  if (state.person) {
    whoChip.textContent = state.person.emoji + ' ' + state.person.name;
    whoChip.classList.remove('hidden');
    whoChip.onclick = () => { window.location.href = HUB; };
  } else whoChip.classList.add('hidden');
}

function go(fn) {
  if (teardown) { try { teardown(); } catch (_) {} teardown = null; }
  window.scrollTo(0, 0);
  fn();
}

// ---------------- Landing ----------------
function renderLanding() {
  view.innerHTML = '';
  const card = el(`<div class="card">
    <div class="section-title" style="margin:0 0 12px">🎮 Pick a game</div>
    <div class="tiles" id="tiles"></div>
  </div>`);
  const tiles = $('#tiles', card);
  GAMES.forEach((g) => {
    const node = el(`<div class="tile ${g.key} ${g.ready ? '' : 'locked'}">
      ${g.ready ? '' : '<span class="soon">coming soon</span>'}
      <span class="temoji">${g.emoji}</span><span class="tname">${esc(g.name)}</span></div>`);
    if (g.ready && g.key === 'ws') node.onclick = () => go(renderPuzzleList);
    tiles.appendChild(node);
  });
  view.appendChild(card);
  renderWhoChip();
}

// ---------------- Puzzle list ----------------
async function renderPuzzleList() {
  view.innerHTML = '';
  const card = el(`<div class="card">
    <div class="section-title" style="margin:0 0 12px">🔤 Word Search</div>
    <div id="list" class="center muted">Loading…</div>
    <div class="spacer"></div>
    <button class="btn ghost" id="back">← Games</button>
  </div>`);
  view.appendChild(card);
  $('#back', card).onclick = () => go(renderLanding);
  try {
    const puzzles = await api('/api/wordsearch/puzzles');
    const box = $('#list', card); box.innerHTML = ''; box.classList.remove('center', 'muted');
    if (!puzzles.length) { box.innerHTML = '<p class="center muted">No puzzles yet.</p>'; return; }
    puzzles.forEach((p) => {
      let badge = '<span class="pz-badge new">New!</span>';
      if (p.completed_at) badge = `<span class="pz-badge done">✓ ${fmt(p.best_seconds)}</span>`;
      else if (p.found > 0) badge = `<span class="pz-badge prog">${p.found}/${p.total}</span>`;
      const node = el(`<div class="pz">
        <div class="pz-ic">🧩</div>
        <div class="pz-main"><div class="pz-title">${esc(p.title)}</div>
          <div class="pz-sub">${p.total} words</div></div>
        ${badge}</div>`);
      node.onclick = () => go(() => renderPlay(p.id));
      box.appendChild(node);
    });
  } catch (e) { if (!/unauth|noplayer/.test(e.message)) $('#list', card).textContent = 'Could not load puzzles.'; }
}

// ---------------- Play ----------------
async function renderPlay(puzzleId) {
  view.innerHTML = '<div class="card center muted">Loading puzzle…</div>';
  let data;
  try { data = await api('/api/wordsearch/puzzle/' + puzzleId); }
  catch (e) { if (!/unauth|noplayer/.test(e.message)) view.innerHTML = '<div class="card center">Could not load puzzle.</div>'; return; }

  const size = data.size;
  const words = data.words;
  const colorByWord = {}; words.forEach((w, i) => (colorByWord[w] = colorFor(i)));
  const found = new Set(data.progress.found_words);
  const foundCells = data.progress.found_cells || {};
  let activeSeconds = data.progress.active_seconds || 0;
  let started = !!data.progress.started;
  let completed = !!data.progress.completed_at;

  view.innerHTML = '';
  const card = el(`<div class="card">
    <div class="play-head">
      <button class="btn ghost" id="back" style="width:auto;padding:8px 12px">← List</button>
      <span class="pill timer" id="timer">⏱ ${fmt(activeSeconds)}</span>
      <span class="pill" id="count">${found.size}/${words.length}</span>
    </div>
    <div class="ws-wrap" id="wrap">
      <div class="ws-grid" id="grid">
        <svg class="ws-svg" id="svg" viewBox="0 0 ${size} ${size}" preserveAspectRatio="none">
          <g id="locked"></g><g id="livewrap"></g>
        </svg>
      </div>
    </div>
    <div class="words" id="words"></div>
  </div>`);
  view.appendChild(card);
  $('#back', card).onclick = () => go(renderPuzzleList);

  // grid cells — explicit equal rows AND columns so the box is fully filled, square,
  // and the cell layout matches the SVG viewBox exactly (no clipping, accurate hits).
  const grid = $('#grid', card);
  grid.style.gridTemplateColumns = `repeat(${size}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${size}, 1fr)`;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
    const cell = el(`<div class="ws-cell" data-r="${r}" data-c="${c}">${data.grid[r][c]}</div>`);
    grid.appendChild(cell);
  }
  // size the letters to the actual cell width, and keep them right on resize/rotate
  let ro = null;
  function fitFont() { const w = grid.clientWidth; if (w) grid.style.fontSize = Math.max(10, Math.floor(w / size * 0.58)) + 'px'; }
  fitFont();
  if (window.ResizeObserver) { ro = new ResizeObserver(fitFont); ro.observe(grid); }
  const svg = $('#svg', card), lockedG = $('#locked', card), liveG = $('#livewrap', card);
  const SVGNS = 'http://www.w3.org/2000/svg';
  const center = (r, c) => [c + 0.5, r + 0.5];

  function makeLine(a, b, color, cls) {
    const [x1, y1] = center(a[0], a[1]), [x2, y2] = center(b[0], b[1]);
    const ln = document.createElementNS(SVGNS, 'line');
    ln.setAttribute('x1', x1); ln.setAttribute('y1', y1);
    ln.setAttribute('x2', x2); ln.setAttribute('y2', y2);
    ln.setAttribute('stroke', color); ln.setAttribute('stroke-width', '0.62');
    ln.setAttribute('class', 'ws-line ' + cls);
    return ln;
  }

  // word chips
  const wordsBox = $('#words', card);
  const chipByWord = {};
  words.forEach((w) => {
    const chip = el(`<span class="wchip ${found.has(w) ? 'found' : ''}">
      <span class="dot" style="${found.has(w) ? 'background:' + colorByWord[w] : ''}"></span>${esc(w)}</span>`);
    chipByWord[w] = chip; wordsBox.appendChild(chip);
  });

  // redraw saved finds
  Object.keys(foundCells).forEach((w) => {
    const cells = foundCells[w]; if (!cells || !cells.length) return;
    lockedG.appendChild(makeLine(cells[0], cells[cells.length - 1], colorByWord[w] || '#34303a', 'locked'));
  });

  // ----- timer -----
  const count = $('#count', card), timerEl = $('#timer', card);
  let tick = null, sync = null;
  function startTimers() {
    stopTimers();
    tick = setInterval(() => {
      if (started && !completed && document.visibilityState === 'visible') {
        activeSeconds++; timerEl.textContent = '⏱ ' + fmt(activeSeconds);
      }
    }, 1000);
    sync = setInterval(pushTime, 15000);
  }
  function stopTimers() { if (tick) clearInterval(tick); if (sync) clearInterval(sync); tick = sync = null; }
  function pushTime(beacon) {
    if (completed) return;
    const body = JSON.stringify({ active_seconds: activeSeconds });
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon('/api/wordsearch/' + puzzleId + '/time', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/wordsearch/' + puzzleId + '/time', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  }
  const onVis = () => { if (document.visibilityState === 'hidden') pushTime(true); };
  const onHide = () => pushTime(true);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('pagehide', onHide);

  // teardown for navigation
  teardown = () => {
    stopTimers(); pushTime(true);
    if (ro) ro.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp);
    window.removeEventListener('touchmove', onMove, { passive: false }); window.removeEventListener('touchend', onUp);
  };

  // ----- drag to select -----
  function cellFromPoint(x, y) {
    const elm = document.elementFromPoint(x, y);
    const cell = elm && elm.closest && elm.closest('.ws-cell');
    if (!cell || !grid.contains(cell)) return null;
    return [Number(cell.dataset.r), Number(cell.dataset.c)];
  }
  function snap(r0, c0, r1, c1) {
    let dr = r1 - r0, dc = c1 - c0;
    const adr = Math.abs(dr), adc = Math.abs(dc);
    if (adr === 0 && adc === 0) return [r0, c0];
    let sr, sc, n;
    if (adc < adr * 0.4) { sr = Math.sign(dr); sc = 0; n = adr; }
    else if (adr < adc * 0.4) { sr = 0; sc = Math.sign(dc); n = adc; }
    else { sr = Math.sign(dr) || 1; sc = Math.sign(dc) || 1; n = Math.round((adr + adc) / 2); }
    let er = r0 + sr * n, ec = c0 + sc * n;
    while ((er < 0 || ec < 0 || er >= size || ec >= size) && n > 0) { n--; er = r0 + sr * n; ec = c0 + sc * n; }
    return [er, ec];
  }

  let dragging = false, startCell = null, lastEnd = null, liveLine = null;
  function evtXY(e) { const t = e.touches && e.touches[0]; return t ? [t.clientX, t.clientY] : [e.clientX, e.clientY]; }

  function onDown(e) {
    if (completed || !started) return;
    const [x, y] = evtXY(e); const cell = cellFromPoint(x, y);
    if (!cell) return;
    e.preventDefault();
    dragging = true; startCell = cell; lastEnd = cell;
    liveLine = makeLine(cell, cell, '#2ec4b6', 'live'); liveG.appendChild(liveLine);
  }
  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const [x, y] = evtXY(e); const cur = cellFromPoint(x, y) || lastEnd;
    const end = snap(startCell[0], startCell[1], cur[0], cur[1]);
    lastEnd = end;
    const [x2, y2] = center(end[0], end[1]);
    liveLine.setAttribute('x2', x2); liveLine.setAttribute('y2', y2);
  }
  async function onUp() {
    if (!dragging) return;
    dragging = false;
    const start = startCell, end = lastEnd;
    if (liveLine) { liveLine.remove(); liveLine = null; }
    if (!start || !end) return;
    try {
      const r = await api('/api/wordsearch/' + puzzleId + '/find', {
        method: 'POST', body: JSON.stringify({ start, end, active_seconds: activeSeconds }),
      });
      if (r.hit && !r.already) {
        const ln = makeLine(start, end, colorByWord[r.word] || '#34303a', 'locked pop');
        lockedG.appendChild(ln);
        found.add(r.word);
        const chip = chipByWord[r.word];
        if (chip) { chip.classList.add('found'); $('.dot', chip).style.background = colorByWord[r.word]; }
        count.textContent = `${found.size}/${words.length}`;
        if (r.completed) finish(r);
      } else if (!r.hit) {
        // miss: bounce a transient line then drop it
        const ln = makeLine(start, end, '#ff6b5e', 'live bounce'); liveG.appendChild(ln);
        setTimeout(() => ln.remove(), 340);
      }
    } catch (_) {}
  }
  grid.addEventListener('mousedown', onDown);
  grid.addEventListener('touchstart', onDown, { passive: false });
  window.addEventListener('mousemove', onMove);
  window.addEventListener('touchmove', onMove, { passive: false });
  window.addEventListener('mouseup', onUp);
  window.addEventListener('touchend', onUp);

  function finish(r) {
    completed = true; stopTimers();
    const finalSecs = r.active_seconds != null ? r.active_seconds : activeSeconds;
    activeSeconds = finalSecs; timerEl.textContent = '⏱ ' + fmt(finalSecs);
    confetti();
    showCompletion(puzzleId, data.title, finalSecs, r.best_seconds);
  }

  // ----- intro gate -----
  startTimers();
  if (!started) showIntro();
  function showIntro() {
    const ov = el(`<div class="overlay"><div class="card">
      <div class="big">🔤</div>
      <h2>${esc(data.title)}</h2>
      <p class="muted">Find all ${words.length} words by dragging across the letters — any direction!</p>
      <p class="muted">The timer only runs while this page is open.</p>
      <div class="spacer"></div>
      <button class="btn coral" id="go">Ready? Start! ▶</button>
    </div></div>`);
    $('#go', ov).onclick = async () => {
      ov.remove(); started = true;
      try { await api('/api/wordsearch/' + puzzleId + '/start', { method: 'POST' }); } catch (_) {}
    };
    document.body.appendChild(ov);
  }

  // if already completed on load, show finished state with replay
  if (completed) {
    const finBtn = el(`<div style="margin-top:14px"><button class="btn gold" id="lbBtn">🏆 Leaderboard</button>
      <div class="spacer"></div><button class="btn coral" id="againBtn">↻ Play again</button></div>`);
    $('#lbBtn', finBtn).onclick = () => go(() => renderLeaderboard(puzzleId, data.title));
    $('#againBtn', finBtn).onclick = () => playAgain(puzzleId);
    card.appendChild(finBtn);
  }
}

function showCompletion(puzzleId, title, secs, best) {
  const isPB = best != null && secs <= best;
  const ov = el(`<div class="overlay"><div class="card pop">
    <div class="big">🎉</div>
    <h2>You did it!</h2>
    <p class="muted">${esc(title)}</p>
    <div class="tally" style="font-size:1.3rem;margin:6px 0"><b>⏱ ${fmt(secs)}</b>${isPB ? ' · 🏅 best yet!' : ''}</div>
    <div class="spacer"></div>
    <button class="btn gold" id="lb">🏆 See leaderboard</button>
    <div class="spacer"></div>
    <div class="btn-row">
      <button class="btn coral" id="again">↻ Play again</button>
      <button class="btn ghost" id="list">📋 Puzzles</button>
    </div>
  </div></div>`);
  $('#lb', ov).onclick = () => { ov.remove(); go(() => renderLeaderboard(puzzleId, title)); };
  $('#again', ov).onclick = () => { ov.remove(); playAgain(puzzleId); };
  $('#list', ov).onclick = () => { ov.remove(); go(renderPuzzleList); };
  document.body.appendChild(ov);
}

async function playAgain(puzzleId) {
  try { await api('/api/wordsearch/' + puzzleId + '/reset', { method: 'POST' }); } catch (_) {}
  go(() => renderPlay(puzzleId));
}

// ---------------- Leaderboard ----------------
async function renderLeaderboard(puzzleId, title) {
  view.innerHTML = '';
  const card = el(`<div class="card">
    <div class="section-title" style="margin:0 0 4px">🏆 Fastest times</div>
    <p class="muted" style="margin:0 0 12px">${esc(title || '')}</p>
    <div id="rows" class="center muted">Loading…</div>
    <div class="spacer"></div>
    <div class="btn-row">
      <button class="btn coral" id="play">▶ Play</button>
      <button class="btn ghost" id="list">📋 Puzzles</button>
    </div>
  </div>`);
  view.appendChild(card);
  $('#play', card).onclick = () => go(() => renderPlay(puzzleId));
  $('#list', card).onclick = () => go(renderPuzzleList);
  try {
    const data = await api('/api/wordsearch/' + puzzleId + '/leaderboard');
    const box = $('#rows', card); box.innerHTML = ''; box.classList.remove('center', 'muted');
    if (!data.rows.length) { box.innerHTML = '<p class="center muted">No finishers yet — be the first!</p>'; return; }
    data.rows.forEach((r, i) => {
      const medal = ['🥇', '🥈', '🥉'][i] || (i + 1);
      box.appendChild(el(`<div class="lb-row ${r.person_id === data.you ? 'you' : ''}">
        <div class="lb-rank">${medal}</div>
        <div class="lb-av av-gold">${esc(r.emoji || '⭐')}</div>
        <div class="lb-main"><div class="lb-name">${esc(r.name || 'Player')}</div>
          <div class="lb-sub">${new Date(r.completed_at).toLocaleDateString()}</div></div>
        <div class="lb-time">⏱ ${fmt(r.best_seconds)}</div></div>`));
    });
  } catch (e) { if (!/unauth|noplayer/.test(e.message)) $('#rows', card).textContent = 'Could not load.'; }
}

// ---------------- Confetti ----------------
function confetti() {
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = el('<canvas class="confetti-canvas"></canvas>');
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const W = cv.width = innerWidth, H = cv.height = innerHeight;
  const parts = Array.from({ length: 150 }, () => ({
    x: Math.random() * W, y: -20 - Math.random() * H * 0.3,
    vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4,
    s: 6 + Math.random() * 8, c: WORD_COLORS[Math.floor(Math.random() * WORD_COLORS.length)],
    rot: Math.random() * 6, vr: (Math.random() - .5) * .3,
  }));
  let t = 0;
  (function frame() {
    t++; ctx.clearRect(0, 0, W, H);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore();
    });
    if (t < 170) requestAnimationFrame(frame); else cv.remove();
  })();
}

// ---------------- Boot ----------------
(async function boot() {
  try {
    const me = await api('/api/me');
    if (!me.person) { window.location.href = me.hub || HUB; return; }
    state.person = me.person;
    renderWhoChip();
    go(renderLanding);
  } catch (e) {
    if (!/unauth|noplayer/.test(e.message)) {
      view.innerHTML = '<div class="card center">Could not load. <button class="btn coral" onclick="location.reload()">Reload</button></div>';
    }
  }
})();
