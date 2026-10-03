# Word Jam Bus (working title)

A parking-jam word puzzle for phones and desktops. Every car in a packed lot carries a letter. Slide cars around to clear lanes, and drive them out so their letters board the bus in the order that spells the target word.

Plain HTML, CSS and JavaScript. There is no build step and no network or CDN dependency, so it can go straight onto a static host such as GitHub Pages.

Live: https://boydt.github.io/word-jam-bus/

## How to play (v2: slide-until-blocked)

1. **Cars slide like real cars.** A car only moves along its own axis (the way its nose points, or straight back). It keeps going until it touches another car or the edge of the lot.
   - **Forward:** if the whole lane in front of the nose is empty, the car **drives out** of the lot. Otherwise it stops right behind the first car in its way. A partial slide is a normal move: the car stays in the lot in its new spot.
   - **Reverse:** the car backs up until it touches a car or the wall. **Reversing never exits**; it only repositions the car (see "Exit rule" below).
   - If the car cannot move at all in that direction, it **shakes**, the blocker flashes red and a "Blocked!" / "Wall!" toast appears. A bump costs nothing.
   - **1 move = 1 slide or 1 exit**, however far the car travels.
2. **The bus at the top shows the target word.** The next seat to fill pulses.
   - When a car drives out and its letter is the next one needed, it boards the bus.
   - If it isn't, it parks in the **holding bay** below the lot (4 spots on starter levels 1-5, 3 from level 6 on).
3. **Parked letters board automatically** once they become the next letter, and this can chain. Repeated letters are interchangeable: any P car can fill any P seat.
4. **You lose** if a car drives out while the bay is already full and its letter isn't the next one needed. A car that fills the next seat never loses, even when the bay is full. Decoys are best slid aside, not driven out.
5. **You win** when the bus is full. Stars compare your moves with **par** (the solver's proven fewest moves): 3 stars at or under par, 2 stars within par + 2, 1 star otherwise.

### Controls

| Input | Phone | Desktop |
|---|---|---|
| Drive forward (toward the nose) | **Tap** the car, or **swipe** it toward its nose | **Click**, or drag toward the nose |
| Reverse (toward the tail) | **Swipe** the car toward its tail | **Right-click** or **Shift+click**, or drag toward the tail |
| Cancel a press | Drag sideways before letting go | Drag sideways |
| Undo / Restart | Buttons at the top | Buttons, `U` / Ctrl+Z, `R` |

**Why this scheme.** A tap is the most common action (driving out), so it stays one touch. Reversing needs a direction, and a swipe along the car's own axis is unambiguous: the car can only go two ways, so the swipe's sign along that axis picks one, and sideways jitter is ignored. A swipe can start anywhere on the car, which matters on the 7x7 lot where cars are about 51 px. Splitting a car into "front half / back half" tap zones was rejected because a 1-cell car would leave ~25 px targets. The swipe threshold is max(10 px, 20% of a cell), so a sloppy tap is still a tap.

**It is always clear which way a car will go.** Every car has a windshield, headlights and a white arrow at its nose and red tail lights at the back. While your finger (or mouse button) is down, a **ghost preview** shows exactly where the car will stop: a highlighted lane strip and a dashed outline at the destination, a **green exit arrow** at the edge when the car will drive out, or a **red** lane when it would bump. Swiping the other way flips the preview before you let go.

### Exit rule

**Cars leave the lot nose-first only.** Driving forward with a clear lane exits; reversing always stops at the wall. This keeps the arrow on each car meaningful (it tells you where that letter will leave from), it matches how parking lots work, and it makes the puzzles deeper: you often have to back a car up to open a gap for another, then drive it forward later. Every main level (11-20) is checked so that it cannot be won as quickly by only driving forward; the starter levels introduce reversing at level 3.

### Special vehicles

- **Long trucks** (from level 7) take up 2 or 3 cells and move as one piece.
- The **TH truck** (level 18) fills two seats at once.
- The **checkered `?` taxi** (level 19) is a wildcard that fills whatever seat is next.
- Level 19 is a **two-stop route**: spell BUS, then STOP. The bay carries over between the two words.

### Helpers

- **Undo:** 5 per level. It undoes any move, including a partial slide (the car slides back) or an exit (the car returns to the lot and its letter leaves the bus or bay).
- **Hint:** 3 per level. It highlights a car and shows a ghost of the move to make. The hint is always the next move of an **optimal** (fewest-moves) line from your current position, whatever you did before.
- **Dead end:** a background solver re-checks the position after every move. When the remaining cars can no longer finish the word, a "Dead end!" banner offers Undo or Retry.
- **Restart:** the circular-arrow button, or `R` on desktop.

**Progress** is saved in `localStorage` under `wordJamBus.progress.v1`: `{ v, unlocked, stars, best, sound }`. Stars and best moves are keyed by **level id**, so they survive re-ordering. Use **Reset progress** on the title screen to clear it.

**Progress migration (v3).** v3 inserted 10 starter levels in front of the 10 v2 levels, which moved the v2 levels from positions 1-10 to 11-20 (same ids). Saves from earlier builds have no `v` field and their `unlocked` index pointed into the old 10-level list, so on load:
- a save without `v` that has any progress (`unlocked > 0` or any stars) gets `unlocked += 10`, so the same v2 level stays open, and all 10 starter levels are open too (they sit before it). The save is then rewritten with `v: 3`, so this happens once;
- a level is also open whenever **it or any later level has stars**, so a level you have beaten can never be locked again;
- **Play / Continue** goes to the first unbeaten open level after the furthest level you have beaten. A v2 player who had beaten BUS, CAR and PLANET lands on level 14 (APPLE), not on starter level 1;
- a v2 save with no wins starts at the new level 1, as a new player does.
(v1 ids such as `ex1-bus` were already retired in v2; their leftover stars are ignored.)

## Levels

There are 20 levels: **10 starter levels** that teach one idea at a time, then the **10 original v2 levels** unchanged (same layouts, ids and par; only the old level 1 tip was reworded, since it no longer opens the game).

### Starter levels (1-10)

| # | Word | Grid | Cars | Empty | Bay | Par | Introduces | Tip |
|---|------|------|------|-------|-----|-----|-----------|-----|
| 1 | CAT | 3x3 | 3 | 6 | 4 | 3 | Tap to drive out | Tap a car to drive it out the way its nose points. Letters board in order: C, A, T. |
| 2 | DOG | 3x3 | 4 | 5 | 4 | 4 | Partial slide that stops on a bump | A blocked car still rolls forward until it bumps into something. Use that to clear a lane! |
| 3 | SUN | 4x4 | 5 | 11 | 4 | 5 | Swipe to reverse | Swipe a car toward its tail (or right-click) to back it up. Cars only leave nose-first. |
| 4 | HAT | 4x4 | 5 | 11 | 4 | 5 | Holding bay (out-of-order letter parks) | Wrong letter in the way? Drive it out: it waits in the holding bay and hops on when its turn comes. |
| 5 | FISH | 4x4 | 6 | 10 | 4 | 6 | Longer word (4 letters) | A four-letter word! Work out which car is in the way of the F first. |
| 6 | MILK | 4x4 | 8 | 8 | 3 | 6 | Bay limit: losing becomes possible | The bay holds 3 now. If a wrong letter drives out while it is full, you lose! |
| 7 | FROG | 5x5 | 8 | 14 | 3 | 7 | Long trucks | Long trucks move as one piece and slide just like cars. |
| 8 | TRAIN | 5x5 | 10 | 11 | 3 | 8 | Busier 5x5 lot | A busier lot. Back cars up to make room before you drive out. |
| 9 | TIGER | 5x5 | 11 | 10 | 3 | 9 | Five letters, more decoys | Plan ahead: which letter can leave first, and what is blocking the next one? |
| 10 | HOUSE | 5x5 | 12 | 9 | 3 | 9 | Hand-off to level 11 | Last warm-up! Next come the big jammed lots. |

Levels 1-5 have a roomy 4-spot bay and **cannot be lost** at all (checked by the verifier). Level 6 shrinks the bay to 3 and is the first level where a wrong letter can lose; from there on the bay stays at 3. Par climbs 3, 4, 5, 5, 6, 6, 7, 8, 9, 9 and then hands off to level 11 (BUS, par 10).

### Main levels (11-20, the v2 set)

| # | Word | Grid | Cars | Empty | Bay | Par | BFS states | What's new |
|---|------|------|------|-------|-----|-----|-----------|------------|
| 11 | BUS | 5x5 | 11 | 7 | 3 | 10 | 19,052 | First big lot: everything from the starter levels together |
| 12 | CAR | 5x5 | 16 | 6 | 3 | 13 | 3,808 | Backing up to open gaps (7 reverses in the best line) |
| 13 | PLANET | 5x5 | 16 | 5 | 3 | 17 | 15,711 | Bay management with 3 spots |
| 14 | APPLE | 5x5 | 15 | 5 | 3 | 21 | 4,189 | Repeated letters (any P fills any P) |
| 15 | GARDEN | 6x6 | 24 | 6 | 3 | 24 | 268,175 | 6x6 lot, 24 cars |
| 16 | ROCKET | 6x6 | 20 | 6 | 3 | 26 | 25,866 | Long chains of slides |
| 17 | TICKET | 6x6 | 22 | 5 | 3 | 27 | 32,741 | Truck-heavy lot: 8 long vehicles |
| 18 | MOTHER | 6x6 | 21 | 6 | 3 | 26 | 14,530 | TH chunk truck (fills 2 seats) |
| 19 | BUS + STOP | 6x6 | 25 | 5 | 3 | 30 | 251,382 | Two-word route + `?` wildcard taxi |
| 20 | SCHOOL | 7x7 | 16 | 10 | 3 | 36 | 115,915 | 7x7 finale: 9 three-cell trucks |

"Empty" counts free cells at the start; every main lot starts 72-86% full. "BFS states" is how many positions the solver expands to prove par from the start. In the main levels every word-letter car starts blocked, every level needs reverse moves to reach par, and par rises from level to level (level 18 is a deliberate breather after level 17).

## Run it

- **Open directly:** double-click `index.html`. It works from `file://` because the levels are loaded through a script tag, not `fetch`.
- **Serve it statically:**
  ```bash
  cd word-jam-bus
  python3 -m http.server 8765
  # open http://localhost:8765/
  ```
- **Deep link:** `index.html#level-7` opens a level directly, even a locked one. This is handy for testing.

## Level format

The source of truth is `levels/levels.json` (`{ "format": "...", "levels": [ ... ] }`). The game itself loads `js/levels.js`, which is a generated copy (see below).

```json
{
  "id": "lv1-bus",
  "word": "BUS",
  "grid": [5, 5],
  "bay": 3,
  "par": 10,
  "tip": "Tap a car to drive it forward; swipe it along its lane to back it up...",
  "cars": [
    {"l": "S", "r": 4, "c": 5, "dir": "down", "len": 2},
    {"l": "B", "r": 1, "c": 4, "dir": "down"}
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Unique id, used as the key for saved stars |
| `word` | Target word. Use `words: ["BUS", "STOP"]` for a multi-word route, filled in order |
| `grid` | `[rows, cols]` |
| `bay` | Holding-bay capacity |
| `par` | Fewest moves to win (1 slide or 1 exit = 1 move). It must equal the solver's result |
| `tip` | Optional player hint shown under the lot |
| `suggested_level`, `note` | Optional designer notes. The game ignores them |
| `tier`, `teaches`, `safe` | Optional: `"starter"` marks a beginner level (default `"core"`); `teaches` names the mechanic it introduces; `safe` asserts it can't be lost. They select the verifier's checks; the game only uses `tier` for the save migration |
| `cars[].l` | Letter. It can also be a 2-letter chunk such as `"TH"`, or `"?"` for the wildcard |
| `cars[].r`, `cars[].c` | The car's **front (head)** cell, 1-indexed. `r1` is the top row and `c1` the left column |
| `cars[].dir` | `up`, `down`, `left` or `right` (the way the nose points, i.e. the exit direction) |
| `cars[].len` | Optional length in cells (default 1). The body extends **behind** the head |

## Solver

`js/engine.js` holds the rules and the solver, and the same file runs in the game and in Node.

- **State** = each car's offset along its axis (or "gone"), the next seat to fill and the bay contents. From any state there are at most 2 moves per car (forward / reverse); a move that can't shift the car is skipped.
- **Search** = breadth-first search, so the first win found is a proven fewest-moves solution. States are packed into flat typed arrays (1 byte per car + seat + bay) and de-duplicated in an open-addressing hash table with exact comparison (no hash-collision false positives). Parent links rebuild the move list. Node expands roughly 0.5 million states per second, so the biggest level here is proven in about a second.
- **Incremental:** `E.createSearch(game, state).run(budget)` expands a bounded number of states per call. In the browser the game runs it in ~14 ms slices on the main thread after every move, so the page never freezes. The result gives both the hint (next move of an optimal line) and the dead-end check (the search is exhaustive, so "no win" is a proof). Following the hinted line keeps the cached plan valid, so later hints are instant.
- `E.solve(game, state?, opts?)` returns `{par, path, states, status}`; options `forwardOnly` (used by the verifier to show reverse moves matter) and `maxStates`.
- `tools/wjb_solver.py` is an **independent** Python implementation of the same rules (written separately, plain BFS with tuples and dicts) used only to cross-check every par.

## Verify levels

After editing `levels/levels.json`, run:

```bash
node tools/verify-levels.js --write   # verify + regenerate js/levels.js
node tools/verify-levels.js --ascii   # verify + print each lot and an optimal solution
node tools/verify-levels.js --no-py   # skip the (slower) Python cross-check
```

For **every** level the verifier checks:
- a valid layout: cars inside the grid, no overlaps, every car has a letter, unique ids;
- winnable within its bay: exhaustive BFS over every forward / reverse / exit sequence;
- `par` equals the fewest moves;

The design checks depend on the level's `tier`:
- **`core`** (default; levels 11-20): every car carrying a word letter starts blocked; the optimal line needs slides; driving forward only is impossible or slower (except the first core level); par never falls below 75% of an earlier core level's.
- **`starter`** (levels 1-10): the mechanic named in `teaches` must really be needed: `exit` = the best line is taps only; `slide` = it can't be won as fast without partial slides, and needs no reverse and no bay; `reverse` = it can't be won as fast driving forward only, and needs no bay; `bay` = it can't be won as fast without parking a letter; `trucks` = has a long truck; `bay-limit` = a loss is reachable. `"safe": true` means no losing move exists anywhere. Every starter level needs a tip, starter par never goes down, stays below the first core level's par, and the last starter is within 2 of it.
- `js/levels.js` is in sync with the JSON;
- the Python solver (`python3 tools/wjb_solver.py levels/levels.json --check`) agrees on every par.

It also reports the minimum bay needed, how many positions are reachable and how many of those are dead ends, and how many first moves already lose. It exits with code 1 if anything fails.

### Level design tools (dev only)

- `tools/level-lab.js` generates random dense lots for a word (`--word`, `--grid`, `--empty`, `--par lo hi`, `--chunk TH`, `--wild 1`, `--words BUS,STOP`...), keeps only BFS-proven ones where reverse moves matter and word letters start blocked, and saves the best to `--out` as it goes.
- `tools/level-improve.js in.json out.json` hill-climbs a lot: it swaps which cars carry which letters and flips car directions, keeping a change only if the level stays valid and par goes up (with a cap on solver states so hints stay fast on phones). It writes `out.json` on every improvement.

- `tools/starter-lab.js gen spec.json out.json` makes small beginner lots: random layouts filtered by what the level should teach (for example "needs a partial slide but no reverse and no bay", "forward-only impossible", "can't be lost", "at most 2 bay parkings"). It writes candidates as it finds them.

The starter levels CAT and HAT were laid out by hand; the other eight were picked from `starter-lab.js` candidates. The v2 levels were made with `level-lab.js` and `level-improve.js` and then checked with the verifier. Decoy letters were finally spread over a varied set of non-word letters; decoys never fill a seat, so that doesn't change any move, and par was re-proven afterwards.

## Tests (headless browser)

```bash
npm install                       # installs Playwright (dev only)
npx playwright install chromium   # once
python3 -m http.server 8765 &     # from this folder
node tests/e2e.js                 # phone 390x844 touch + desktop 1280x800 mouse
node tests/file-url.js            # opens index.html via file:// and wins level 1
```

`tests/e2e.js` moves cars only with real input: touch taps and touch swipes (CDP touch events) on a 390x844 phone with mobile emulation, and mouse clicks, drags and right-clicks at 1280x800. It covers:
- 20 levels listed, the level select fits all 20 on the phone and desktop screens without scrolling, "Level N of 20" in the HUD;
- every level shows its own tip;
- level 2: a tap that slides a car partway and stops at a blocker (1 move, car still in the lot), Undo of it, and a bump (shake, no move used);
- level 3: the first reverse by swiping toward the tail, with the ghost preview captured mid-swipe;
- level 4: an out-of-order letter parked in the bay, auto-boarding, win;
- Hint from a mid-game state (level 11), checked to be on an optimal path;
- the dead-end banner and its Undo, a "Bay full!" loss;
- layout fit and 7x7 car size (at least 40 px);
- all 20 levels won through the UI at par with 3 stars, on the phone (taps + swipes) and on desktop (clicks + drags);
- saved-progress migration with seeded `localStorage`: v2 saves (partial, complete, deep-link-only, no wins), an already-migrated save, reloading twice, replaying a starter level;
- desktop right-click reverse and `R` restart;
- no console errors, page errors or failed requests.

It saves screenshots to `screenshots/` (`v3-*.png`; the `v2-*.png` files are from the previous round).

## Files

```
index.html               game page (title/level select, game screen, overlays)
css/style.css            all visuals (cars are pure CSS, no image assets)
js/engine.js             rules + BFS solver (shared by game and Node verifier)
js/levels.js             GENERATED from levels/levels.json
js/game.js               UI, animation, touch/mouse input, sound (WebAudio), saving
levels/levels.json       level data (source of truth)
tools/verify-levels.js   Node level verifier
tools/wjb_solver.py      independent Python reference solver (cross-check)
tools/level-lab.js       dense-lot generator (dev)
tools/level-improve.js   level hill-climber (dev)
tools/starter-lab.js     beginner-level generator/filter (dev)
tests/e2e.js             Playwright play-test (phone + desktop)
tests/file-url.js        file:// smoke test
screenshots/             test screenshots
```

## Notes

- **The name:** "Word Jam Bus" is a working title. Several store titles already use "Word Jam".
- **Assets:** all graphics are CSS and all sounds are generated with WebAudio. There are no third-party assets.
