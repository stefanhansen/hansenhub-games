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
Play: CSS-grid letter cells + SVG overlay. **Grid geometry (critical for hit-testing):**
the grid sets BOTH `grid-template-columns` and `grid-template-rows` to `repeat(N,1fr)` on
an `aspect-ratio:1/1` box (cells `min-width/height:0; overflow:hidden`), so all N rows fill
the box square with no clipping. The `<svg>` overlay (`viewBox 0 0 N N`,
`preserveAspectRatio=none`) is a **child of the grid** so it shares the exact content-box
coordinate space the cells occupy (inside the 4px border) — cell center `(c+0.5,r+0.5)`
maps precisely onto the DOM cell. Letters are sized to the measured cell width via a
`ResizeObserver` (disconnected in teardown). Drag via `elementFromPoint` hit-test; `snap()`
locks to the nearest of 8 directions; correct→`pop`+locked colored line+strike chip, miss→`bounce`.
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

## Platform status (2026-06-07) — read this first if picking up cold
Applies to all 3 services (hub `~/hub`, learn `~/hansenhub`, games `~/games`); each has
its own copy of this section.

**Done & live** (HTTPS, systemd-enabled, Caddy):
- hub → hansenhub.net:3010 (login, people picker w/ editable emoji+name, app chooser).
- learn → learn.hansenhub.net:3000 (math + stars; refactored onto shared auth).
- games → games.hansenhub.net:3020 (deterministic wordsearch, drag-select, time board; puzzle `001-family`).
- Shared login/identity working across all three (one passcode `220585`, cookies `hh_auth`+`hh_who` on `.hansenhub.net`, secrets in `/etc/hansenhub.env`). Verified end-to-end.
- All DBs pristine (0 scores/progress). Learn DB backed up at `~/hansenhub/data/backups/` before its schema migration.
- learn pushed to GitHub (`stefanhansen/hansenhub`); hub + games committed to **local** git only.

**Left / pending:**
- Host hub + games on GitHub: create private repos `hansenhub-hub` + `hansenhub-games`, add the per-repo deploy keys (aliases `github-hub`/`github-games` + remotes already set on `~/hub` and `~/games`), then `git push -u origin main` from each. Public keys: `~/.ssh/hub_deploy.pub`, `~/.ssh/games_deploy.pub`.
- Content gaps by design: learn has only Math live (Language/Science/Arts are "coming soon"); games has only Word Search. Both are additive (`SUBJECTS` / `GAMES` arrays; puzzles = drop JSON in `~/games/puzzles/`).

**Key decisions:**
- Separate DBs + separate leaderboards (learn=stars, games=time) per the brief's "Supersedes" (overrides any earlier unified-DB plan). Apps share only login + identity, never data; they never call the hub at runtime (they read the signed cookie + a local `people` cache).
- Generated a NEW shared `SESSION_SECRET` (never read the old learn secret) → invalidated old `lq_auth` cookies; one-time re-login at the hub is expected.
- Person ids: 1 Sol, 2 Ida, 3 Julia, 4 Stefan. (Differs from learn's original profiles order Ida=1/Sol=2 — mattered for migration, but 0 score rows existed.)
- `auth.js` is **copied** into all 3 services (kept identical); if you change it, change all three.

**Gotchas:**
- Secrets live only in `/etc/hansenhub.env` (+ `/etc/learning-quest.env` for learn's PORT). Never read/print/commit them; auto-mode denies reading `/etc/**`, so append to the Caddyfile with `sudo tee -a` (don't try to read it).
- Each service's `data/` dir must exist before its systemd unit starts (`ReadWritePaths`).
- Bump `sw.js` `CACHE` after frontend changes (learn `lq-v2`, hub `hub-v1`, games `games-v1`).
- **Don't use broad `pkill` patterns:** `pkill -f "hub/server.js"` also matches `hansen`**`hub/server.js`** and killed live Learn once. Use full paths or PIDs.
- Between Bash calls the cwd can reset to `~/hansenhub`; run one-off `node` with absolute paths.

## Changelog
- 2026-06-07 (fix): Leaderboard "you" highlight alignment. Replaced the `outline` +
  `outline-offset` (drew outside the card, overlapped rounded corners, clipped at the right
  edge) with an inset dashed `::after` ring (`inset:4px`, `border-radius:13px`) contained
  inside the row, following its corners. Bumped sw → games-v4. (Identity audit confirmed
  per-request via `req.who`/`hh_who` — no shared "current person" state, no change.)
- 2026-06-07 (fix): Cleared stray highlight from taps/incomplete drags. `onDown` created a
  live line and only tracked the latest `liveLine` ref, so rapid taps / a 2nd finger left
  orphaned teal lines stuck. Now `liveG` holds only the single in-progress line: `clearLive()`
  empties it on down and on release; the live line is created only once a drag forms a line
  of length ≥1 (a pure tap shows nothing); extra touch points are ignored. Found words
  (lockedG) are never touched. Verified headless: 10 taps + 3 wiggles leave 0 stray lines,
  correct drag still locks, only found words stay lit. Bumped sw → games-v3.
- 2026-06-07 (content): Added two puzzles — `002-family-names` (Family Names, 15×15, 22
  words) and `003-places` (Places We've Been, 16×16, 15 words). Both pass
  `check-puzzles.js` on the first try (incl. WINDSORHEIGHTS, 14, in 16×16 — no size bump
  needed) and appear live on the list without a restart (dir is read per request).
- 2026-06-07 (fix): Wordsearch grid geometry + selection accuracy. Root cause: the grid
  was square via `aspect-ratio` but only had explicit columns, so auto-height rows
  overflowed (bottom rows clipped) and the SVG overlay's even `viewBox` no longer lined up
  with the taller cell layout, so `elementFromPoint` mapped touches to the wrong cells.
  Fix: explicit equal rows+cols filling the box, and moved the SVG inside the grid so it
  shares the cells' content-box coords. Verified in headless Chromium at 800px: 225/225
  cells hit-test correct (incl. after scroll), no clipping, all 15 words selectable incl.
  a reverse drag. Validator (forward/reversed, 8 directions) unchanged. Bumped sw → games-v2.
- 2026-06-07: Initial games service — deterministic wordsearch engine, drag-to-select
  play, visibility-aware timer, per-puzzle time leaderboard, first puzzle 001-family.
  systemd `games`, Caddy games.hansenhub.net → 3020.
