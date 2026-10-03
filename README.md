# Word Jam Bus (working title)

A parking-jam word puzzle for phones and desktops. Each car in a jammed lot carries a letter. Drive the cars out so their letters board the bus in the order that spells the target word.

Plain HTML, CSS and JavaScript. There is no build step and no network or CDN dependency, so it can go straight onto a static host such as GitHub Pages.

## How to play

1. **Tap a car** and it drives straight ahead, the way its nose (windshield, headlights and the small white arrow) points.
   - If every cell between the car and the edge of the lot is empty, the car leaves. That counts as 1 move.
   - If something is in the way, the car **bumps** (it shakes and the blocker flashes red). A bump costs nothing.
2. **The bus at the top shows the target word.** The next seat to fill pulses.
   - If the leaving car's letter is the next one needed, it boards the bus.
   - If it isn't, it parks in the **holding bay** below the lot.
3. **Parked letters board automatically** once they become the next letter, and this can chain. Repeated letters are interchangeable: any P car can fill any P seat.
4. **You lose** if a car leaves while the bay is already full and its letter isn't the next one needed. A car that fills the next seat never loses, even when the bay is full.
5. **You win** when the bus is full. Stars compare your moves with **par** (the solver's fewest moves): 3 stars at or under par, 2 stars within par + 2, 1 star otherwise.

**Special vehicles**
- **Long trucks** take up 2 cells.
- The **TH truck** fills two seats at once.
- The **checkered `?` taxi** is a wildcard that fills whatever seat is next.
- Level 9 is a **two-stop route**: spell BUS, then STOP. The bay carries over between the two words.

**Helpers**
- **Undo:** 3 per level.
- **Hint:** 1 per level. It highlights the best next car.
- **Restart:** the circular-arrow button, or press `R` on desktop. `U` or Ctrl/Cmd+Z also undoes.
- **Dead end:** when the remaining cars can no longer finish the word, a "Dead end!" banner offers Undo or Retry.

**Progress** is saved in `localStorage` under `wordJamBus.progress.v1`: which levels are unlocked, your best stars and best moves, and the sound setting. Use **Reset progress** on the title screen to clear it.

## Levels

| # | Word | Grid | Bay | Par | What's new |
|---|------|------|-----|-----|------------|
| 1 | BUS | 5x5 | 5 | 3 | Tutorial: bump, bay, auto-board |
| 2 | CAR | 5x5 | 5 | 4 | First decoy letter (D) |
| 3 | PLANET | 5x5 | 5 | 8 | Two decoys and chained auto-boarding |
| 4 | APPLE | 5x5 | 4 | 7 | Repeated letters (3 P cars for 2 P seats) |
| 5 | GARDEN | 6x6 | 4 | 7 | Bigger lot, zero spare bay space |
| 6 | ROCKET | 6x6 | 3 | 7 | Deep chain; most first taps lose |
| 7 | TICKET | 6x6 | 4 | 10 | 2-cell trucks |
| 8 | MOTHER | 6x6 | 4 | 7 | TH chunk truck |
| 9 | BUS + STOP | 6x6 | 3 | 8 | Two-word route and `?` wildcard taxi |
| 10 | SCHOOL | 7x7 | 3 | 9 | Mastery: trucks, duplicate O, bay 3 |

The levels come from the design brief's solver-verified examples (`/workspace/research/game-ideas/word-jam-bus-levels.json`). Two of them got a light layout polish: GARDEN gained 2 free decoys and BUS + STOP gained 1, to fill empty rows. Both were re-verified afterwards, and their par and minimum bay size didn't change.

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
  "id": "ex3-planet",
  "word": "PLANET",
  "grid": [5, 5],
  "bay": 5,
  "par": 8,
  "tip": "Wrong letters wait in the bay...",
  "cars": [
    {"l": "O", "r": 1, "c": 3, "dir": "left"},
    {"l": "P", "r": 3, "c": 3, "dir": "up"}
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Unique id, used as the key for saved stars |
| `word` | Target word. Use `words: ["BUS", "STOP"]` for a multi-word route, filled in order |
| `grid` | `[rows, cols]` |
| `bay` | Holding-bay capacity |
| `par` | Fewest moves to win. It must equal the solver's result |
| `tip` | Optional player hint shown under the lot |
| `note`, `suggested_level` | Optional designer notes. The game ignores them |
| `cars[].l` | Letter. It can also be a 2-letter chunk such as `"TH"`, or `"?"` for the wildcard |
| `cars[].r`, `cars[].c` | The car's **front (head)** cell, 1-indexed. `r1` is the top row and `c1` the left column |
| `cars[].dir` | `up`, `down`, `left` or `right` |
| `cars[].len` | Optional length in cells (default 1). The body extends **behind** the head |

## Verify levels

After editing `levels/levels.json`, run:

```bash
node tools/verify-levels.js --write   # verify + regenerate js/levels.js
node tools/verify-levels.js --ascii   # verify + print each lot and a shortest solution
```

The Node verifier uses `js/engine.js`, the same rules code the game runs. It:
- checks the layout: cars are inside the grid, nothing overlaps, and no two cars block each other head-on;
- runs a BFS over every tap order to prove the level can be won within its bay size;
- checks that `par` equals the shortest solution;
- reports the minimum bay needed, reachable and dead-end states, and the first taps that lose;
- checks that `js/levels.js` is in sync with the JSON;
- cross-checks against the reference Python solver, `tools/wjb_solver.py` (it runs `--check` when `python3` is available).

It exits with code 1 if anything fails. To run the reference solver on its own: `python3 tools/wjb_solver.py levels/levels.json --check --ascii`.

## Tests (headless browser)

```bash
npm install                       # installs Playwright (dev only)
npx playwright install chromium   # once
python3 -m http.server 8765 &     # from this folder
node tests/e2e.js                 # phone 390x844 touch + desktop 1280x800 mouse
node tests/file-url.js            # opens index.html via file:// and wins level 1
```

`tests/e2e.js` plays with real taps and clicks. It covers:
- a bump on a blocked car;
- bay parking and auto-boarding;
- a win, with stars and localStorage progress checked;
- a "Bay full!" loss and Retry;
- the full-bay-but-correct-letter rule;
- the dead-end banner, Undo and Hint;
- layout fit and tap-target size;
- a full solve of all 10 levels through the UI;
- no console errors.

It saves screenshots to `screenshots/`.

## Files

```
index.html             game page (title/level select, game screen, overlays)
css/style.css          all visuals (cars are pure CSS, no image assets)
js/engine.js           rules + BFS solver (shared by game and Node verifier)
js/levels.js           GENERATED from levels/levels.json
js/game.js             UI, animation, input, sound (WebAudio), saving
levels/levels.json     level data (source of truth)
tools/verify-levels.js Node level verifier
tools/wjb_solver.py    reference Python solver from the design brief
tests/e2e.js           Playwright play-test (phone + desktop)
tests/file-url.js      file:// smoke test
screenshots/           test screenshots
```

## Notes

- **The name:** "Word Jam Bus" is a working title. Several store titles already use "Word Jam".
- **Assets:** all graphics are CSS and all sounds are generated with WebAudio. There are no third-party assets.
