'use strict';
// HansenHub Games. Reads shared hh_auth + hh_who; redirects unauth to the hub.
// Owns its own DB (wordsearch progress + time leaderboards). Never touches others.
const path = require('path');
const fs = require('fs');
const express = require('express');
const Database = require('better-sqlite3');
const auth = require('./auth');
const ws = require('./wordsearch');

const PORT = process.env.PORT || 3020;
const HOST = process.env.HOST || '127.0.0.1';
const HUB_URL = process.env.HUB_URL || 'https://hansenhub.net/';

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'games.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS ws_progress (
    person_id      INTEGER NOT NULL,
    puzzle_id      TEXT NOT NULL,
    found_words    TEXT NOT NULL DEFAULT '[]',
    found_cells    TEXT NOT NULL DEFAULT '{}',
    active_seconds INTEGER NOT NULL DEFAULT 0,
    best_seconds   INTEGER,                 -- best completed time ever (survives replays)
    started        INTEGER NOT NULL DEFAULT 0,
    completed_at   TEXT,
    PRIMARY KEY (person_id, puzzle_id)
  );
  -- local identity cache for leaderboard display (fed from the signed hh_who cookie)
  CREATE TABLE IF NOT EXISTS people (
    id    INTEGER PRIMARY KEY,
    name  TEXT NOT NULL,
    emoji TEXT NOT NULL
  );
`);

// Seed the people cache so leaderboards have labels before everyone has visited.
if (db.prepare('SELECT COUNT(*) AS n FROM people').get().n === 0) {
  const ins = db.prepare('INSERT INTO people (id, name, emoji) VALUES (?,?,?)');
  ins.run(1, 'Sol', '🦊'); ins.run(2, 'Ida', '🐢');
  ins.run(3, 'Julia', '🌸'); ins.run(4, 'Stefan', '🚀');
}
const upsertPerson = db.prepare(
  `INSERT INTO people (id, name, emoji) VALUES (@id, @name, @emoji)
   ON CONFLICT(id) DO UPDATE SET name = @name, emoji = @emoji`
);

// Validate every puzzle is placeable at startup — fail loudly, not silently.
(function validatePuzzles() {
  const ids = ws.listPuzzleIds();
  if (!ids.length) { console.warn('[games] WARNING: no puzzles found in', ws.PUZZLE_DIR); return; }
  for (const id of ids) {
    try { ws.getPuzzle(id); console.log(`[games] puzzle OK: ${id}`); }
    catch (e) { console.error(`[games] PUZZLE ERROR: ${id}: ${e.message}`); }
  }
})();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ type: ['application/json', 'text/plain'] })); // text/plain for sendBeacon

const PUBLIC_DIR = path.join(__dirname, 'public');
const OPEN_PATHS = new Set([
  '/styles.css', '/manifest.webmanifest', '/sw.js',
  '/icon-180.png', '/icon-192.png', '/icon-512.png', '/favicon.ico',
]);

// --- gate: shared auth; unauth -> hub ---
app.use((req, res, next) => {
  if (OPEN_PATHS.has(req.path)) return next();
  if (auth.isAuthed(req)) {
    const who = auth.whoFrom(req);
    if (who) { try { upsertPerson.run(who); } catch (_) {} } // keep display cache fresh
    req.who = who;
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'Not authenticated' });
  return res.redirect(HUB_URL);
});

function requirePerson(req, res) {
  if (req.who && typeof req.who.id === 'number') return req.who;
  res.status(409).json({ ok: false, error: 'No player selected', hub: HUB_URL });
  return null;
}

// progress row helpers
const getRow = db.prepare('SELECT * FROM ws_progress WHERE person_id = ? AND puzzle_id = ?');
function ensureRow(personId, puzzleId) {
  let row = getRow.get(personId, puzzleId);
  if (!row) {
    db.prepare('INSERT INTO ws_progress (person_id, puzzle_id) VALUES (?, ?)').run(personId, puzzleId);
    row = getRow.get(personId, puzzleId);
  }
  return row;
}

// --- API ---
app.get('/api/me', (req, res) => res.json({ ok: true, person: req.who || null, hub: HUB_URL }));

// puzzle list with this person's status
app.get('/api/wordsearch/puzzles', (req, res) => {
  const who = requirePerson(req, res); if (!who) return;
  const out = ws.listPuzzleIds().map((id) => {
    let title = id, total = 0;
    try { const p = ws.getPuzzle(id); title = p.title; total = p.words.length; } catch (_) {}
    const row = getRow.get(who.id, id);
    const found = row ? JSON.parse(row.found_words).length : 0;
    return {
      id, title, total, found,
      started: row ? !!row.started : false,
      completed_at: row ? row.completed_at : null,
      best_seconds: row ? row.best_seconds : null,
    };
  });
  res.json(out);
});

// full puzzle + this person's saved progress
app.get('/api/wordsearch/puzzle/:id', (req, res) => {
  const who = requirePerson(req, res); if (!who) return;
  let puzzle;
  try { puzzle = ws.getPuzzle(req.params.id); }
  catch (e) { return res.status(404).json({ ok: false, error: 'Puzzle not found or invalid' }); }
  const row = getRow.get(who.id, puzzle.id);
  res.json({
    id: puzzle.id, title: puzzle.title, size: puzzle.size,
    grid: puzzle.grid, words: puzzle.words,
    progress: {
      found_words: row ? JSON.parse(row.found_words) : [],
      found_cells: row ? JSON.parse(row.found_cells) : {},
      active_seconds: row ? row.active_seconds : 0,
      started: row ? !!row.started : false,
      completed_at: row ? row.completed_at : null,
      best_seconds: row ? row.best_seconds : null,
    },
  });
});

app.post('/api/wordsearch/:id/start', (req, res) => {
  const who = requirePerson(req, res); if (!who) return;
  ensureRow(who.id, req.params.id);
  db.prepare('UPDATE ws_progress SET started = 1 WHERE person_id = ? AND puzzle_id = ?')
    .run(who.id, req.params.id);
  res.json({ ok: true });
});

// authoritative find validation
app.post('/api/wordsearch/:id/find', (req, res) => {
  const who = requirePerson(req, res); if (!who) return;
  const id = req.params.id;
  let puzzle;
  try { puzzle = ws.getPuzzle(id); } catch (_) { return res.status(404).json({ ok: false }); }

  const b = req.body || {};
  const start = b.start, end = b.end;
  const activeSeconds = Math.max(0, Math.floor(Number(b.active_seconds) || 0));
  if (!Array.isArray(start) || !Array.isArray(end)) {
    return res.status(400).json({ ok: false, error: 'bad coords' });
  }

  const result = ws.validateFind(id, start, end);
  const row = ensureRow(who.id, id);
  const found = JSON.parse(row.found_words);
  const cellsMap = JSON.parse(row.found_cells);
  let newActive = Math.max(row.active_seconds, activeSeconds);

  if (!result.hit) {
    if (newActive !== row.active_seconds && !row.completed_at) {
      db.prepare('UPDATE ws_progress SET active_seconds = ? WHERE person_id = ? AND puzzle_id = ?')
        .run(newActive, who.id, id);
    }
    return res.json({ ok: true, hit: false });
  }

  const already = found.includes(result.word);
  if (!already) { found.push(result.word); cellsMap[result.word] = result.cells; }

  const completed = found.length === puzzle.words.length;
  let completedAt = row.completed_at;
  let best = row.best_seconds;
  if (completed && !completedAt) {
    completedAt = new Date().toISOString();
    best = best == null ? newActive : Math.min(best, newActive);
  }
  db.prepare(
    `UPDATE ws_progress SET found_words = ?, found_cells = ?, active_seconds = ?,
       completed_at = ?, best_seconds = ? WHERE person_id = ? AND puzzle_id = ?`
  ).run(JSON.stringify(found), JSON.stringify(cellsMap), newActive, completedAt, best, who.id, id);

  res.json({
    ok: true, hit: true, already, word: result.word, cells: result.cells,
    found: found.length, total: puzzle.words.length,
    completed, completed_at: completedAt, best_seconds: best, active_seconds: newActive,
  });
});

// time sync (interval + sendBeacon). Only advances while not completed.
app.post('/api/wordsearch/:id/time', (req, res) => {
  const who = requirePerson(req, res); if (!who) return;
  const secs = Math.max(0, Math.floor(Number((req.body || {}).active_seconds) || 0));
  const row = getRow.get(who.id, req.params.id);
  if (row && !row.completed_at && secs > row.active_seconds) {
    db.prepare('UPDATE ws_progress SET active_seconds = ? WHERE person_id = ? AND puzzle_id = ?')
      .run(secs, who.id, req.params.id);
  }
  res.json({ ok: true });
});

// play again: clear progress for this person, keep best_seconds
app.post('/api/wordsearch/:id/reset', (req, res) => {
  const who = requirePerson(req, res); if (!who) return;
  ensureRow(who.id, req.params.id);
  db.prepare(
    `UPDATE ws_progress SET found_words='[]', found_cells='{}', active_seconds=0,
       started=0, completed_at=NULL WHERE person_id=? AND puzzle_id=?`
  ).run(who.id, req.params.id);
  res.json({ ok: true });
});

// per-puzzle time leaderboard: best time per person among completers, ascending
app.get('/api/wordsearch/:id/leaderboard', (req, res) => {
  const who = requirePerson(req, res); if (!who) return;
  const rows = db.prepare(
    `SELECT w.person_id, w.best_seconds, w.completed_at, p.name, p.emoji
       FROM ws_progress w LEFT JOIN people p ON p.id = w.person_id
      WHERE w.puzzle_id = ? AND w.best_seconds IS NOT NULL
      ORDER BY w.best_seconds ASC, w.completed_at ASC`
  ).all(req.params.id);
  res.json({ ok: true, you: who.id, rows });
});

// --- static + SPA fallback ---
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

app.listen(PORT, HOST, () => console.log(`Games listening on http://${HOST}:${PORT}`));
