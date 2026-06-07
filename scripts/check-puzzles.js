'use strict';
// Validate every puzzle JSON is loadable and placeable, without starting the server.
//   node scripts/check-puzzles.js
const ws = require('../wordsearch');

const ids = ws.listPuzzleIds();
if (ids.length === 0) { console.error('No puzzles found in', ws.PUZZLE_DIR); process.exit(1); }

let failed = 0;
for (const id of ids) {
  try {
    const p = ws.loadPuzzleFile(id);
    const longest = p.words.reduce((m, w) => Math.max(m, w.length), 0);
    if (longest > p.size) throw new Error(`longest word ${longest} > size ${p.size}`);
    const built = ws.buildGrid(p);
    // sanity: every word is actually placed
    for (const w of p.words) if (!built.placements[w]) throw new Error(`word not placed: ${w}`);
    console.log(`OK   ${id}  (${p.size}x${p.size}, ${p.words.length} words)`);
  } catch (e) {
    failed++;
    console.error(`FAIL ${id}: ${e.message}`);
  }
}
if (failed) { console.error(`\n${failed} puzzle(s) failed.`); process.exit(1); }
console.log(`\nAll ${ids.length} puzzle(s) OK.`);
