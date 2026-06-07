'use strict';
// Deterministic wordsearch engine. Same puzzle id -> identical grid on every
// device and across restarts (seeded PRNG, regenerated on demand, cached in mem).
const fs = require('fs');
const path = require('path');

const PUZZLE_DIR = path.join(__dirname, 'puzzles');
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIRS = [
  [0, 1], [0, -1], [1, 0], [-1, 0], // H/V both ways
  [1, 1], [1, -1], [-1, 1], [-1, -1], // 4 diagonals
];

// --- seeded PRNG (mulberry32) ---
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }

// --- puzzle loading ---
function sanitizeWords(words) {
  return words
    .map((w) => String(w).toUpperCase().replace(/[^A-Z]/g, ''))
    .filter((w) => w.length > 0);
}

function loadPuzzleFile(id) {
  const file = path.join(PUZZLE_DIR, id + '.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const size = Number(raw.size);
  const words = sanitizeWords(raw.words || []);
  return { id: raw.id || id, title: raw.title || id, size, words };
}

function listPuzzleIds() {
  if (!fs.existsSync(PUZZLE_DIR)) return [];
  return fs.readdirSync(PUZZLE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}

// --- grid generation ---
function startRange(dir, len, size) {
  // valid [min,max] for a starting coordinate so the word stays in bounds
  if (dir > 0) return [0, size - len];
  if (dir < 0) return [len - 1, size - 1];
  return [0, size - 1];
}

function placeWord(grid, word, rng, size) {
  const len = word.length;
  for (let t = 0; t < 250; t++) {
    const [dr, dc] = DIRS[randInt(rng, 0, DIRS.length - 1)];
    const [r0min, r0max] = startRange(dr, len, size);
    const [c0min, c0max] = startRange(dc, len, size);
    if (r0min > r0max || c0min > c0max) continue;
    const r0 = randInt(rng, r0min, r0max);
    const c0 = randInt(rng, c0min, c0max);
    const cells = [];
    let fits = true;
    for (let i = 0; i < len; i++) {
      const r = r0 + dr * i, c = c0 + dc * i;
      const ch = grid[r][c];
      if (ch !== null && ch !== word[i]) { fits = false; break; }
      cells.push([r, c]);
    }
    if (!fits) continue;
    for (let i = 0; i < len; i++) grid[cells[i][0]][cells[i][1]] = word[i];
    return cells;
  }
  return null;
}

function buildGrid(puzzle) {
  const size = puzzle.size;
  const base = hashSeed(puzzle.id);
  // longest first packs better
  const words = [...puzzle.words].sort((a, b) => b.length - a.length);

  for (let attempt = 0; attempt < 400; attempt++) {
    const rng = mulberry32((base + attempt * 2654435761) >>> 0);
    const grid = Array.from({ length: size }, () => Array(size).fill(null));
    const placements = {};
    let ok = true;
    for (const w of words) {
      const cells = placeWord(grid, w, rng, size);
      if (!cells) { ok = false; break; }
      placements[w] = cells;
    }
    if (!ok) continue;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === null) grid[r][c] = LETTERS[randInt(rng, 0, 25)];
      }
    }
    return { grid, placements };
  }
  throw new Error(`Could not place all words for puzzle "${puzzle.id}" in a ${size}x${size} grid`);
}

// in-memory cache keyed by id
const cache = new Map();
function getPuzzle(id) {
  if (cache.has(id)) return cache.get(id);
  const puzzle = loadPuzzleFile(id);
  const longest = puzzle.words.reduce((m, w) => Math.max(m, w.length), 0);
  if (longest > puzzle.size) {
    throw new Error(`Puzzle "${id}": word longer (${longest}) than grid size (${puzzle.size})`);
  }
  const built = buildGrid(puzzle);
  const full = { ...puzzle, grid: built.grid, placements: built.placements };
  cache.set(id, full);
  return full;
}

// --- validation: read the dragged straight line, match a word forward/reversed ---
function lineCells(start, end, size) {
  const [r0, c0] = start, [r1, c1] = end;
  const lenR = Math.abs(r1 - r0), lenC = Math.abs(c1 - c0);
  if (!(lenR === 0 || lenC === 0 || lenR === lenC)) return null; // not H, V, or pure diagonal
  const steps = Math.max(lenR, lenC);
  if (steps === 0) return null;
  const dr = Math.sign(r1 - r0), dc = Math.sign(c1 - c0);
  const cells = [];
  for (let i = 0; i <= steps; i++) {
    const r = r0 + dr * i, c = c0 + dc * i;
    if (r < 0 || c < 0 || r >= size || c >= size) return null;
    cells.push([r, c]);
  }
  return cells;
}

function validateFind(id, start, end) {
  const puzzle = getPuzzle(id);
  const cells = lineCells(start, end, puzzle.size);
  if (!cells) return { hit: false };
  const s = cells.map(([r, c]) => puzzle.grid[r][c]).join('');
  const rev = [...s].reverse().join('');
  for (const w of puzzle.words) {
    if (w === s || w === rev) return { hit: true, word: w, cells };
  }
  return { hit: false };
}

module.exports = {
  PUZZLE_DIR,
  listPuzzleIds,
  loadPuzzleFile,
  getPuzzle,
  buildGrid,
  validateFind,
  hashSeed,
};
