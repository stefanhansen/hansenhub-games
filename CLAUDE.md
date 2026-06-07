# CLAUDE.md — HansenHub Games

Living source of truth for the **games** service. Update this file in the same change
whenever something significant changes.

## What it is
Games at **games.hansenhub.net**. First game: a drag-to-select **wordsearch**. Reads the
shared login + identity cookies; owns its own DB (wordsearch progress + **time**
leaderboards). Never calls the hub or learn at runtime.

Platform (3 services, share only login + identity cookies, not data):
- **hub** — hansenhub.net, 3010, identity (people)
- **learn** — learn.hansenhub.net, 3000, stars
- **games** (this) — games.hansenhub.net, 3020, `~/games/data/games.db`

## Stack
Node 22 + Express 4 + better-sqlite3. Static frontend, no build step. systemd `games`,
Caddy games.hansenhub.net → 127.0.0.1:3020.

## Auth/identity (`auth.js`, identical to hub/learn)
Reads `PASSCODE` + `SESSION_SECRET` from `/etc/hansenhub.env`. Verifies `hh_auth` (gate)
and `hh_who` (signed `{id,name,emoji}`). Unauth → redirect to `HUB_URL`
(https://hansenhub.net/). No `hh_who` selected → API returns 409 `{hub}` and the client
redirects to the hub picker. The gate upserts the verified `hh_who` into the local
`people` cache so leaderboards have fresh names/emoji without calling the hub.

## DB (`games.db`)
- `ws_progress(person_id, puzzle_id, found_words(JSON), found_cells(JSON map word→cells),
  active_seconds, best_seconds, started, completed_at, PRIMARY KEY(person_id,puzzle_id))`.
  `best_seconds` is the best completed time ever and **survives replays** (reset clears
  everything else but keeps it). Added beyond the brief's schema to support "best time,
  replays allowed".
- `people(id,name,emoji)` — local display cache, seeded with the 4 family members, kept
  fresh from `hh_who` on every authed request.

## Wordsearch engine (`wordsearch.js`)
- Grid is **server-generated, deterministic**: seeded mulberry32 PRNG from `hashSeed(id)`,
  so every device sees the identical grid and it's stable across restarts. Cached in
  memory per id; never stored.
- Placement: each word once, 8 directions incl. reversed, crossings only on matching
  letters; up to 250 tries/word, regenerate whole grid (bumped seed) up to 400× if needed;
  fill remainder with seeded random letters.
- `validateFind(id,start,end)`: reads the straight dragged line (H/V/diagonal only) and
  matches the spelled string against the word list **forward and reversed** (loose match).
  Server is authoritative for finds and time.

## API
| Method | Path | Notes |
|---|---|---|
| GET | /api/me | {person, hub} |
| GET | /api/wordsearch/puzzles | list + this person's status (found/total, best_seconds) |
| GET | /api/wordsearch/puzzle/:id | grid + words + this person's saved progress |
| POST | /api/wordsearch/:id/start | passes the intro gate (started=1) |
| POST | /api/wordsearch/:id/find | {start,end,active_seconds} → validates; records; completion |
| POST | /api/wordsearch/:id/time | {active_seconds} time sync (interval + sendBeacon) |
| POST | /api/wordsearch/:id/reset | play again — clears progress, keeps best_seconds |
| GET | /api/wordsearch/:id/leaderboard | best time per person, ascending, completers only |

## Frontend (`public/app.js`)
Vanilla JS, `el()`/`go()` router with a `teardown` for the play screen. Screens: landing
(`GAMES` array, additive), puzzle list (status badges), play, leaderboard.
Play: CSS-grid letter cells + absolute SVG overlay (`viewBox 0 0 size size`,
`preserveAspectRatio=none`); drag via `elementFromPoint` hit-test; `snap()` locks to the
nearest of 8 directions; correct→`pop`+locked colored line+strike chip, miss→`bounce`.
Timer ticks only while `visibilityState==='visible'`; syncs every 15s and on
visibilitychange/pagehide via `sendBeacon`. Completion → hero card + canvas confetti
(respects reduced-motion). Resume redraws saved lines and skips the intro if started.

## Adding a puzzle
Drop a JSON file in `~/games/puzzles/` (`{id,title,size,words[]}`; words uppercased,
letters-only, longest ≤ size). No DB row. `node scripts/check-puzzles.js` validates all
without starting the server; the server also validates every puzzle at startup and logs
errors loudly.

## Gotchas
- `data/` must exist before service start (systemd `ReadWritePaths`).
- Bump `sw.js` `CACHE` after changing app.js/styles.css.
- `express.json({type:['application/json','text/plain']})` so `sendBeacon` bodies parse.

## Changelog
- 2026-06-07: Initial games service — deterministic wordsearch engine, drag-to-select
  play, visibility-aware timer, per-puzzle time leaderboard, first puzzle 001-family.
  systemd `games`, Caddy games.hansenhub.net → 3020.
