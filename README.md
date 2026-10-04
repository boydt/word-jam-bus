# Word Jam Bus (working title)

A parking-jam word puzzle for phones and desktops. Every car in a packed lot carries a letter. Slide cars around to clear lanes, and drive them out so their letters board the bus in the order that spells the target word.

**v4** adds three things: **Scramble stops** (levels where letters board in any order), **coins and boosters** (Tow truck, Bay +1, Nudge), and **Bay Words** (junk letters in the bay that spell a 3-letter word clear for bonus coins). The campaign grows from 20 to 23 levels; see [v4 features](#v4-features).

**v6** gives the buses an old-style school-bus look (a lower hood with a bumper at the front, a tailpipe with a puff at the back), puts the boosters in an on-screen **booster bar** with a fourth booster, **Flip**, and adds a **Settings** panel (gear on the title screen) with **test / cheat options**; see [v6 changes](#v6-changes).

Plain HTML, CSS and JavaScript. There is no build step and no network or CDN dependency, so it can go straight onto a static host such as GitHub Pages.

Live: https://boydt.github.io/word-jam-bus/

## How to play (v2: slide-until-blocked)

1. **Cars slide like real cars.** A car only moves along its own axis (the way its nose points, or straight back). It keeps going until it touches another car or the edge of the lot.
   - **Forward:** if the whole lane in front of the nose is empty, the car **drives out** of the lot. Otherwise it stops right behind the first car in its way. A partial slide is a normal move: the car stays in the lot in its new spot.
   - **Reverse:** the car backs up until it touches a car or the wall. **Reversing never exits**; it only repositions the car (see "Exit rule" below).
   - If the car cannot move at all in that direction, it **shakes**, the blocker flashes red and a "Blocked!" / "Wall!" toast appears. A bump costs nothing.
   - **1 move = 1 slide or 1 exit**, however far the car travels.
2. **The bus at the top shows the target word.** On normal (in-order) levels the seats are numbered 1, 2, 3... and the next seat to fill glows.
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

**Cars leave the lot nose-first only.** Driving forward with a clear lane exits; reversing always stops at the wall. This keeps the arrow on each car meaningful (it tells you where that letter will leave from), it matches how parking lots work, and it makes the puzzles deeper: you often have to back a car up to open a gap for another, then drive it forward later. Every main in-order level is checked so that it cannot be won as quickly by only driving forward; the starter levels introduce reversing at level 3.

### Special vehicles

- **Long trucks** (from level 7) take up 2 or 3 cells and move as one piece.
- The **TH truck** (level 20) fills two seats at once.
- The **checkered `?` taxi** (level 21) is a wildcard that fills whatever seat is next.
- Level 21 is a **two-stop route**: spell BUS, then STOP. The bay carries over between the two words.

### Helpers

- **Undo:** 5 per level. It undoes any move, including a partial slide (the car slides back) or an exit (the car returns to the lot and its letter leaves the bus or bay).
- **Hint:** 3 per level. It highlights a car and shows a ghost of the move to make. The hint is always the next move of an **optimal** (fewest-moves) line from your current position, whatever you did before.
- **Dead end:** a background solver re-checks the position after every move (and after every booster). When the remaining cars can no longer finish the word, a "Dead end!" banner offers Undo, Boosters or Retry.
- **Restart:** the circular-arrow button, or `R` on desktop.

**Progress** is saved in `localStorage` under `wordJamBus.progress.v1`: `{ v: 4, unlocked, unlockedId, stars, best, sound, coins, seen }`. Stars and best moves are keyed by **level id**, so they survive re-ordering. Use **Settings → Reset progress** (it asks first) to clear it.

**Progress migration (v4).** v4 inserted three Scramble levels at positions 12, 17 and 22, which shifts every later level. All ids are unchanged, so stars and best moves carry over by id. A v4 save also stores `unlockedId` (the id of the furthest open level), so future re-orderings can migrate by id. On load:
- `v: 4` saves: `unlocked` is recomputed from `unlockedId`;
- `v: 3` saves: the old `unlocked` index is looked up in the v3 order (10 starters + 10 main levels) to get the id, then mapped to its v4 position. A v3 player who had APPLE open (v3 index 13, level 14) now has levels 1-15 open, including the new Scramble level 12, and **Continue** goes to APPLE (level 15);
- saves with no `v` (v2): the index is looked up in the v2 order (the 10 `lv*` levels) the same way;
- `coins` starts at 0 and `seen` at `{}` for migrated saves; the save is rewritten as `v: 4` once. A migrated player who has already beaten later levels gets the new Scramble levels open in the grid; **Continue** still goes to the first unbeaten open level after the furthest beaten one, so they may skip level 12 unless they tap it.

**Progress migration (v3, kept for v2 saves).** v3 inserted 10 starter levels in front of the 10 v2 levels, which moved the v2 levels from positions 1-10 to 11-20 (same ids). Saves from earlier builds have no `v` field and their `unlocked` index pointed into the old 10-level list, so on load:
- a save without `v` that has any progress (`unlocked > 0` or any stars) gets `unlocked += 10`, so the same v2 level stays open, and all 10 starter levels are open too (they sit before it). The save is then rewritten with `v: 3`, so this happens once;
- a level is also open whenever **it or any later level has stars**, so a level you have beaten can never be locked again;
- **Play / Continue** goes to the first unbeaten open level after the furthest level you have beaten. A v2 player who had beaten BUS, CAR and PLANET lands on level 14 (APPLE), not on starter level 1;
- a v2 save with no wins starts at the new level 1, as a new player does.
(v1 ids such as `ex1-bus` were already retired in v2; their leftover stars are ignored.)

## v4 features

### Scramble stops (levels 12, 17, 22)

- **Rules.** Any letter the word still needs boards **right away**, into the leftmost open seat for that letter, in any order. Only decoys and extra copies (for example a third Z in PIZZA) go to the bay, which is labelled **Junk bay** on these levels. Nothing in the bay ever boards later, so a junk letter just uses up a spot. You lose if a junk letter drives out while the junk bay is full. You win when every seat is filled.
- **Visuals.** The bus turns purple with a shuffle badge, the seats have no numbers and all open seats glow, a "Scramble stop! Letters board in ANY order" banner shows at the start, and the first Scramble level shows a one-time tip card (remembered in `seen.scramble`). The level select marks Scramble levels with a shuffle icon.
- **Lots.** Scramble lots use only single-letter cars (no `?` taxi, no chunk trucks), so "the leftmost open seat for that letter" is always well defined.
- **Pacing.** From level 8 the campaign runs in five-level cycles: three normal levels, one hard or new-mechanic level, then one Scramble breather:
  - levels 8-12: TRAIN, TIGER, HOUSE, **BUS** (first big lot), **PIZZA** (Scramble);
  - levels 13-17: CAR, PLANET, APPLE, **GARDEN** (first 6x6), **JUNGLE** (Scramble, introduces Bay Words);
  - levels 18-22: ROCKET, TICKET, MOTHER, **BUS + STOP** (two stops and the taxi), **DRAGONS** (Scramble);
  - level 23: SCHOOL, the 7x7 finale.
  The three Scramble levels were **inserted**, not converted. Levels 1-11 keep their positions, so the starter ramp and the BUS hand-off are unchanged, and every existing level keeps its id, layout and par. Each breather's par is 60-99% of the hard level before it (9 vs 10, 17 vs 24, 22 vs 30). Each Scramble lot is also checked to be impossible, or at least 2 moves slower, when played in order, so Scramble really changes the puzzle.

### Coins and boosters

- **Earning.** Every seat filled is a 1-coin fare and every Bay Word is +10. Fares collect in the fare box on the coin button (`+N`) during a level and are **banked only when you win**: a loss or restart banks nothing, and Undo takes a fare back. A win **at or under par with no booster doubles the fares** (par bonus). The **first clear** of a level adds +20. Coins are saved as `progress.coins`. Example: CAT at par first time = 3 + 3 + 20 = 26 coins; replaying it at par = 6.
- **Prices.** Tow truck **150**, Flip **120**, Bay +1 **100**, Nudge **60**. These are deliberately expensive: a first-time clear of a whole level at par earns roughly 26-44 coins, so one booster costs a few levels of play.
- **Tow truck.** Tap a glowing car to tow it out of the lot. Only single-letter cars the bus can do without (decoys, or spare copies where enough of that letter remain) can be towed; the towed letter never goes to the bay. Costs 1 move.
- **Bay +1.** Adds a gold spot to the bay for the rest of the level (once per level). Costs no move.
- **Nudge.** Tap or swipe a glowing car to move it exactly one cell forward or back into an empty cell inside the lot. It never drives a car out. Costs 1 move.
- **Flip** (v6). Tap a glowing car to turn it round in place: same cells, nose the other way, so it can leave from its former tail end. Any car in the lot can flip, including long trucks, the TH chunk truck and the taxi, since they stay in their cells. Costs 1 move.
- **Spending.** Each booster is a button in the booster bar along the bottom of the play screen, with its price. Tapping one goes straight to "Spend N coins on ...?" (Spend / Cancel), and Tow, Nudge and Flip then wait for you to pick a car, with a Cancel bar in place of the booster bar. Coins are taken only when the booster is actually applied, so cancelling or tapping a car that can't take it costs nothing.
- **Stars and records.** Boosters are never needed: the verifier proves every level winnable at par without them. A win that used any booster earns **at most 2 stars**, gets no par bonus, and doesn't record a best-moves score. Fares and the first-clear bonus still count.
- **Undo, hints, dead ends.** A booster is one step in the undo history: Undo reverts it and **refunds its coins** (using one of your 5 undos). Restart does not refund. After a booster, the hint and the dead-end check re-solve from the new position, so a hint is always optimal for the boosted lot, and a dead end can be rescued (for example with Bay +1) or created (a Tow or Nudge can block a lane). In that case the dead-end banner appears as usual and Undo gets your coins back.

### Bay Words

- If junk letters sitting in the bay can spell a **3-letter word** from the built-in list (`levels/baywords.json`, 321 common words, generated into `js/baywords.js`, no network), those three letters leave the bay with a "WORD!" flash, and you get **+10 coins**.
- **Order doesn't matter:** any three bay letters that form an anagram of a listed word count. The word shown follows the parked order if that order is itself a word (C, A, T shows CAT), otherwise the first listed anagram.
- **Only junk counts.** On normal levels a parked letter that a later seat still needs is never used; only letters beyond what the word still needs count. On Scramble levels every bay letter is junk.
- **Before the lose check.** The check runs right after a letter parks and **before** the bay-full check. A letter that completes a word therefore never loses, even into a full 3-spot bay: the bay just clears. A 3-spot bay that fills up with a word empties completely.
- **Why every listed word has a vowel (A E I O U).** With Y-only words such as DRY, BUS+STOP could be won in 17 moves instead of 30 by clearing the bay. With the vowel rule, no in-order level can form a Bay Word at all, and every existing par is unchanged. Bay Words can be formed on JUNGLE (FOR) and DRAGONS (HEY).
- **Solver.** The rule is part of `js/engine.js` and `tools/wjb_solver.py`, so par, hints and dead-end detection all account for it. The verifier also solves each level with the Bay Word rule turned off and requires the same par, so a Bay Word is never needed for 3 stars. "Winnable" and "can't be lost" claims are made with the rule on, which is how the game plays.

## v6 changes

### School-bus art
Every bus (the play bus, the purple Scramble bus, the title WORD bus, the win-card bus and the Scramble tip bus) has a **lower, shorter hood block** sticking out at the front with a headlight, a windshield above it and a dark **bumper**, and a **tailpipe** with two small puffs at the back (they hold still with `prefers-reduced-motion`). The front is on the right, the direction the bus drives off after a win, so it always moves hood-first. The hood is the bus colour (purple on Scramble), the bus reserves room for the hood and tailpipe, and the seat size is worked out with that room included, so a 7-letter word still fits at 375 px.

### Booster bar
The footer has the level tip on top and a bar below it: the coin balance (with the `+N` fare box), **Tow 150, Bay +1 100, Nudge 60, Flip 120** and **Hint**. Every button is at least 44 px, and the bar never covers the lot, the bay or the tip (checked at 390x844, 375x667 and 1280x800).
- A price turns **red** when you can't afford it; tapping it then just says "Need N coins" and nothing opens.
- **Bay +1** greys out and reads **Used** once used this level. Tow, Nudge or Flip grey out if no car can take them.
- Under **Unlimited coins** every booster reads **Free** and the balance shows **∞**.
- The dead-end banner's **Boosters** button closes the banner and highlights the bar.

**Flip price.** Flip is priced at **120**, between Nudge (60) and Tow (150). It is stronger than Nudge because it opens a whole new exit lane rather than shifting a car by one cell. It is weaker than Tow because the flipped car still sits in the lot, its letter still has to board or park in the bay, and the new lane may be blocked too. In the engine a flip returns a new game model with that one car reversed (positions are stored as each car's lowest cell, so the state doesn't change), and the undo history keeps the matching model, so the hint and dead-end search plan with the new direction and Undo turns the car back.

**v6b fix (Flip graphic).** A flipped car now stays drawn facing its new way: the chassis (nose arrow, headlights, windshield, tail lights) turns 180° and keeps that rotation. Before, the flip animation spun the whole car and ended back at 0°, and the chassis rotation was only ever set on a full relayout, so the car looked unflipped while it drove the new way. All car rotation now goes through one `orientCar()` that reads the current game model. The e2e measures where each car's arrow, headlights, windshield and tail lights actually sit on screen after a flip, a later move, a relayout, a hint, a press preview, Undo, Restart, the next level and with reduced motion, for every kind of car.

### Settings and test / cheat options
The gear on the title screen opens **Settings**: Sound and How to play, a clearly marked **Test / cheat options** section, and a separate **Reset progress** with its own confirm step. The toggles are a list (`TEST_TOGGLES` in `js/game.js`), so new ones only need an entry there:
- **Unlock all levels:** any level can be picked; levels opened only by this toggle get a dashed red outline.
- **Unlimited coins:** boosters are free and the coin counters show **∞**.
- **Unlimited hints** / **Unlimited undos:** the button never runs out and its badge shows **∞**.

The toggles are saved under `wordJamBus.test.v1`, apart from the real save, which they never write. While any is on, a red **TEST MODE** tag shows on the title and in the play HUD, and **Turn all test options off** clears them all. The rule is: **nothing a cheat makes possible is saved.**
- A level that is open **only** because of Unlock all is played off the record: no stars, best score, unlock, coins or "tip seen" flag. Wins on levels you had really unlocked count as normal.
- With Unlimited coins on, the real balance is never spent and earned fares are **not banked** (the win card says so). A win that used a free booster is not saved. A booster-free win on a really-unlocked level still saves its stars and unlock.
- With Unlimited hints or undos on, a win that used more than the normal 3 hints or 5 undos is not saved. An Undo that reverts a booster bought with real coins still refunds it.
- Cheats can only be changed on the title screen, so each level takes a snapshot of them when it starts. Turning one off gives the normal fresh 5 undos / 3 hints (and real coin rules) from the next level start. Your real unlocks, stars and coins are exactly as they were, because they were never touched.

## v7: keys and padlocked cars (Downtown, levels 24-28)

### Rules
- A car can carry a **key** (a key badge, top-left) and/or a **padlock** (top-right). A padlocked car **can't move at all**: no slide, no reverse, no exit. It opens when the **key car of its colour has left the lot** (driven out, into the bus or the bay).
- **One key opens every padlock of its colour**, for good. There is one key car per colour.
- **Chains:** a key car can itself be padlocked by another colour (the boss: the blue key car is padlocked gold). A key car is never locked by its own colour and chains never loop; `E.prepare` rejects such levels.
- Tapping or swiping a padlocked car **costs no move**: its padlock wiggles, the matching key car lights up and bounces, and a toast says which car to free ("Locked! Drive the gold circle key car (G) out first"). When the key car exits, every padlock of that colour pops open (shackle lifts, ring flash, "Unlocked!" with a chime) and the car loses its locked look.
- **Undo** of the key car's exit brings the car back and the padlocks snap shut again. The lock state is not stored anywhere: it is worked out from whether the key car is still in the lot, so Undo, Restart, hints and the solver can never disagree about it.
- **Colour-blind safe:** each colour also has its own shape, drawn as the bow of the key and on the face of the padlock: **gold = circle** (#e69f00), **blue = triangle** (#0072b2), **pink = square** (#cc79a7) (Okabe-Ito colours). The toast and the car's screen-reader label name colour and shape. A locked car is also desaturated and hatched, so "locked" never depends on colour.

### Boosters and padlocks
- **Tow** refuses padlocked cars (it is locked to the ground) **and key cars**: towing a key car would open its padlocks for 150 coins without solving anything, which would make every key level a coin purchase. The key car still has to drive out.
- **Nudge** and **Flip** refuse padlocked cars (they can't move). They **can** be used on a key car: it still has to drive out to open its padlocks, so it gives nothing away.
- **Bay +1** is unaffected.
- In pick-a-car mode the refused cars are greyed out; tapping one shows why and charges nothing. Undo of a booster restores the lot, so padlocks are always right afterwards.
- Hints and the dead-end check use the same engine, so they plan around padlocks (a locked car is simply never moved until its key is gone).

### The Downtown levels
They are appended after level 23, so every older level keeps its number, id, layout and par. Stage 2's city map can make them one district: debut, practice, two colours, a Scramble breather, then a boss.

| # | id | Word | Grid | Bay | Par | Par ignoring padlocks | Keys and padlocks |
|---|---|---|---|---|---|---|---|
| 24 | dt1-bank | BANK | 6x6 | 3 | 14 | 10 | gold key on a decoy G, one padlocked decoy M. One-line tip introduces keys |
| 25 | dt2-hotel | HOTEL | 6x6 | 3 | 20 | 10 | gold key on the L, padlocks on H and on a decoy (one key, two locks) |
| 26 | dt3-market | MARKET | 6x6 | 3 | 22 | 10 | gold (circle) and blue (triangle): two keys on decoys, one padlocked decoy each |
| 27 | sc4-subway | SUBWAY (Scramble) | 6x6 | 3 | 17 | 12 | gold key on a decoy F, two padlocked decoys (R, D), any boarding order; impossible in order |
| 28 | dt4-square | SQUARE | 6x6 | 3 | 33 | 14 | **boss chain:** gold key on a decoy K; the blue key car is S (the first letter) and is itself padlocked gold; also A padlocked gold, E and a decoy Y padlocked blue (par 19 if S weren't padlocked) |

**Save migration.** Saves still migrate by id. A save whose furthest open level was already won (for example someone who finished SCHOOL when it was the last level) now opens the next level, so they land on level 24.

### Verifier and lab
- Every level with padlocks is also solved with padlocks ignored, and par must be at least **2 moves lower** that way, so the keys really matter (see the table). The first padlock level must have `teaches: "keys"` and a tip mentioning keys. The verifier prints a `KEYS` line per key level.
- The 75% par ramp restarts at a core level that debuts a mechanic (`teaches`), so the gentle key debut after SCHOOL is allowed.
- `tools/wjb_solver.py` implements padlocks independently; `tests/rules.js` has a keys section (locked bumps, one key many locks, chains, validation, booster refusals, Bay +1) and the JS/Python fuzz now includes lots with padlocks and chains.
- `tools/level-lab.js`: `--keys gold:1,blue:2` (one key car per colour + that many padlocks), `--chain 1`, `--gain N` (padlocks must add N moves), `--locktries`, `--scramble 1`, `--lockfirst 1` / `--basestates`. Lab lots must now also have the same par with Bay Words off (two early key candidates only worked by clearing the bay with a Bay Word, which the verifier rejects). Padlocks go on cars the lock-free optimum moves early and keys on cars it moves late. `tools/level-improve.js --locks` also moves key badges and padlocks while hill-climbing (that is how the boss was made, from a lab lot with a chain: par 21 to 33).

Level JSON: `{"l": "S", "r": 3, "c": 2, "dir": "down", "key": "blue", "lock": "gold"}`.

## Levels

There are 28 levels: the 23 below plus the 5 Downtown key levels (24-28, see v7). The first 23 are **10 starter levels** that teach one idea at a time, then the **10 v2 main levels** (unchanged) with **3 Scramble breathers** inserted at 12, 17 and 22.

| # | id | Word | Mode | Par |
|---|---|---|---|---|
| 1 | st1-cat | CAT | in order | 3 |
| 2 | st2-dog | DOG | in order | 4 |
| 3 | st3-sun | SUN | in order | 5 |
| 4 | st4-hat | HAT | in order | 5 |
| 5 | st5-fish | FISH | in order | 6 |
| 6 | st6-milk | MILK | in order | 6 |
| 7 | st7-frog | FROG | in order | 7 |
| 8 | st8-train | TRAIN | in order | 8 |
| 9 | st9-tiger | TIGER | in order | 9 |
| 10 | st10-house | HOUSE | in order | 9 |
| 11 | lv1-bus | BUS | in order | 10 |
| 12 | sc1-pizza | PIZZA | **Scramble** | 9 |
| 13 | lv2-car | CAR | in order | 13 |
| 14 | lv3-planet | PLANET | in order | 17 |
| 15 | lv4-apple | APPLE | in order | 21 |
| 16 | lv5-garden | GARDEN | in order | 24 |
| 17 | sc2-jungle | JUNGLE | **Scramble** | 17 |
| 18 | lv6-rocket | ROCKET | in order | 26 |
| 19 | lv7-ticket | TICKET | in order | 27 |
| 20 | lv8-mother | MOTHER | in order | 26 |
| 21 | lv9-busstop | BUS + STOP | in order | 30 |
| 22 | sc3-dragons | DRAGONS | **Scramble** | 22 |
| 23 | lv10-school | SCHOOL | in order | 36 |

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

### Main levels (11-23)

| # | Word | Grid | Cars | Empty | Bay | Par | BFS states | What's new |
|---|------|------|------|-------|-----|-----|-----------|------------|
| 11 | BUS | 5x5 | 11 | 7 | 3 | 10 | 19,052 | First big lot: everything from the starter levels together |
| 12 | PIZZA (Scramble) | 5x5 | 15 | 7 | 3 | 9 | 30,696 | Scramble stop: any order; a third Z is spare junk. In order it is impossible |
| 13 | CAR | 5x5 | 16 | 6 | 3 | 13 | 3,808 | Backing up to open gaps (7 reverses in the best line) |
| 14 | PLANET | 5x5 | 16 | 5 | 3 | 17 | 15,711 | Bay management with 3 spots |
| 15 | APPLE | 5x5 | 15 | 5 | 3 | 21 | 4,189 | Repeated letters (any P fills any P) |
| 16 | GARDEN | 6x6 | 24 | 6 | 3 | 24 | 268,175 | 6x6 lot, 24 cars |
| 17 | JUNGLE (Scramble) | 6x6 | 18 | 9 | 3 | 17 | 85,604 | Bay Words (FOR can form); in order par would be 20 |
| 18 | ROCKET | 6x6 | 20 | 6 | 3 | 26 | 25,866 | Long chains of slides |
| 19 | TICKET | 6x6 | 22 | 5 | 3 | 27 | 32,741 | Truck-heavy lot: 8 long vehicles |
| 20 | MOTHER | 6x6 | 21 | 6 | 3 | 26 | 14,530 | TH chunk truck (fills 2 seats) |
| 21 | BUS + STOP | 6x6 | 25 | 5 | 3 | 30 | 251,382 | Two-word route + `?` wildcard taxi |
| 22 | DRAGONS (Scramble) | 6x6 | 18 | 5 | 3 | 22 | 6,736 | 7-letter Scramble, 8 reverses (HEY can form); impossible in order |
| 23 | SCHOOL | 7x7 | 16 | 10 | 3 | 36 | 115,915 | 7x7 finale: 9 three-cell trucks |

"Empty" counts free cells at the start; every main lot starts 72-86% full. "BFS states" is how many positions the solver expands to prove par from the start. In the main levels every word-letter car starts blocked, every level needs reverse moves to reach par, and in-order par rises from level to level (MOTHER is a deliberate breather after TICKET); the Scramble levels dip below the hard level before them on purpose.

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
| `mode` | Optional: `"scramble"` makes letters board in any order (single-letter cars only, word up to 12 letters). Default is in-order |
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
| `cars[].key`, `cars[].lock` | Optional (v7): `gold`, `blue` or `pink`. `key` = this car's exit opens every padlock of that colour; `lock` = the car can't move until that colour's key car is gone |

## Solver

`js/engine.js` holds the rules and the solver, and the same file runs in the game and in Node.

- **State** = each car's offset along its axis (or "gone"), the next seat to fill (in-order) or the bitmask of filled seats (Scramble), the bay contents and the bay capacity (Bay +1). Bay Words are swept after every exit, inside the rules, so the BFS covers them. From any state there are at most 2 moves per car (forward / reverse); a move that can't shift the car is skipped.
- **Search** = breadth-first search, so the first win found is a proven fewest-moves solution. States are packed into flat typed arrays (1 byte per car + seat + bay) and de-duplicated in an open-addressing hash table with exact comparison (no hash-collision false positives). Parent links rebuild the move list. Node expands roughly 0.5 million states per second, so the biggest level here is proven in about a second.
- **Incremental:** `E.createSearch(game, state).run(budget)` expands a bounded number of states per call. In the browser the game runs it in ~14 ms slices on the main thread after every move, so the page never freezes. The result gives both the hint (next move of an optimal line) and the dead-end check (the search is exhaustive, so "no win" is a proof). Following the hinted line keeps the cached plan valid, so later hints are instant.
- `E.solve(game, state?, opts?)` returns `{par, path, states, status}`; options `forwardOnly` (used by the verifier to show reverse moves matter) and `maxStates`.
- `tools/wjb_solver.py` is an **independent** Python implementation of the same rules (written separately, plain BFS with tuples and dicts; Scramble via a per-letter remaining count, Bay Words from `levels/baywords.json`, `--no-bayword` to turn them off), used only to cross-check every par.
- `tests/rules.js` (Node, no browser) unit-tests the rules: Scramble boarding, Bay Word clearing and its ordering against the lose check, each booster, and a fuzz of 60 random lots where the JS and Python solvers must agree.

## Verify levels

After editing `levels/levels.json`, run:

```bash
node tools/verify-levels.js --write   # verify + regenerate js/levels.js and js/baywords.js
node tools/verify-levels.js --ascii   # verify + print each lot and an optimal solution
node tools/verify-levels.js --no-py   # skip the (slower) Python cross-check
```

For **every** level the verifier checks:
- a valid layout: cars inside the grid, no overlaps, every car has a letter, unique ids;
- winnable within its bay: exhaustive BFS over every forward / reverse / exit sequence;
- `par` equals the fewest moves;

The design checks depend on the level's `tier`:
- **Bay Words:** each level is also solved with the Bay Word rule off and par must match, so a Bay Word is never needed for par; reachable Bay Words are listed.
- **Scramble** (`mode: "scramble"`): core tier, needs slides, in-order play of the same lot is impossible or at least 2 moves slower, junk exits are reported; pacing: after the starters, at least 3 in-order levels between Scramble levels, par 60-99% of the in-order level before it, and the first Scramble level has a tip.
- **`core`** in-order levels (default; 11-23 except the Scramble levels): every car carrying a word letter starts blocked; the optimal line needs slides; driving forward only is impossible or slower (except the first core level); par never falls below 75% of an earlier core level's.
- **`starter`** (levels 1-10): the mechanic named in `teaches` must really be needed: `exit` = the best line is taps only; `slide` = it can't be won as fast without partial slides, and needs no reverse and no bay; `reverse` = it can't be won as fast driving forward only, and needs no bay; `bay` = it can't be won as fast without parking a letter; `trucks` = has a long truck; `bay-limit` = a loss is reachable. `"safe": true` means no losing move exists anywhere. Every starter level needs a tip, starter par never goes down, stays below the first core level's par, and the last starter is within 2 of it.
- `js/levels.js` is in sync with the JSON, and `js/baywords.js` with `levels/baywords.json` (all 3 letters, each with a vowel);
- the Python solver (`python3 tools/wjb_solver.py levels/levels.json --check`) agrees on every par.

It also reports the minimum bay needed, how many positions are reachable and how many of those are dead ends, and how many first moves already lose. It exits with code 1 if anything fails.

### Level design tools (dev only)

- `tools/level-lab.js` generates random dense lots for a word (`--word`, `--grid`, `--empty`, `--par lo hi`, `--chunk TH`, `--wild 1`, `--words BUS,STOP`...), keeps only BFS-proven ones where reverse moves matter and word letters start blocked, and saves the best to `--out` as it goes.
- `tools/level-improve.js in.json out.json` hill-climbs a lot: it swaps which cars carry which letters and flips car directions, keeping a change only if the level stays valid and par goes up (with a cap on solver states so hints stay fast on phones). It writes `out.json` on every improvement.

- `tools/scramble-lab.js` / `tools/scramble-improve.js` generate and hill-climb Scramble lots (single-letter cars only), keeping candidates whose Scramble par is in range and whose in-order par is impossible or clearly higher.
- `tools/starter-lab.js gen spec.json out.json` makes small beginner lots: random layouts filtered by what the level should teach (for example "needs a partial slide but no reverse and no bay", "forward-only impossible", "can't be lost", "at most 2 bay parkings"). It writes candidates as it finds them.

The starter levels CAT and HAT were laid out by hand; the other eight were picked from `starter-lab.js` candidates. The v2 levels were made with `level-lab.js` and `level-improve.js` and then checked with the verifier. Decoy letters were finally spread over a varied set of non-word letters; decoys never fill a seat, so that doesn't change any move, and par was re-proven afterwards.

## Tests (headless browser)

```bash
npm install                       # installs Playwright (dev only)
npx playwright install chromium   # once
node tests/rules.js               # rule + solver unit tests (no browser)
python3 -m http.server 8765 &     # from this folder
node tests/e2e.js                 # phone 390x844 touch, 375x667 check, desktop 1280x800 mouse
node tests/file-url.js            # opens index.html via file:// and wins level 1
```

`tests/e2e.js` moves cars only with real input: touch taps and touch swipes (CDP touch events) on a 390x844 phone with mobile emulation, and mouse clicks, drags and right-clicks at 1280x800. It covers:
- the level select: 28 levels, Scramble levels marked, fits without scrolling on 390x844, 375x667 and desktop;
- numbered seats with exactly one glowing next seat that advances, and the fare box (+1, Undo back to +0);
- coins: 26 for a first par clear of CAT, saved across reload, +6 on replay, no par bonus over par, nothing banked on a loss;
- Scramble on level 12: the one-time tip card (and not on a second visit), the start banner, purple bus and badge, no seat numbers, out-of-order boarding, only junk to the bay, win at par with 3 stars;
- boosters (with seeded coins): shop prices, confirm, Cancel spends nothing; Tow refused on a needed car at no charge, Tow of a decoy (150, +1 move), dead-end re-check and an optimal hint after it, Undo refunds; Bay +1 (4 spots that really hold 4 letters), Undo refunds; Nudge exactly one cell, Undo refunds; a booster win capped at 2 stars with no par bonus or best score; a loss after a booster keeps the coins spent; a dead end rescued from the dead-end banner's Boosters button;
- Bay Word on level 17: three junk letters clear, +10 in the fare box, "Bay Word 10" on the win card, coins banked;
- v7 keys: badges with the right shape, the first-key tip, a padlocked car tapped and swiped (wiggle, key car call-out, toast, no move), the unlock animation when the key car exits, Undo re-locking, an optimal hint, Tow refusing padlocked and key cars, Nudge/Flip refusing padlocked cars (all greyed in pick mode, no coins charged), Flip on a key car, Bay +1 unaffected, the later key levels and the chain, a desktop click on a padlocked car;
- all 28 levels won through the UI at par with 3 stars and no boosters, on the phone (taps + swipes) and on desktop (clicks + drags);
- saved-progress migration with seeded `localStorage`: v3 saves (partial, through BUS, all 20, starters only), a v2 save, a v4 save with coins, and reloading a migrated save;
- 375x667: levels 17, 22 and 23, the booster bar and the confirm sheet fit; desktop right-click reverse, `R` restart and a click nudge;
- v6: bus hood/bumper/tailpipe on every bus and inside the screen on every layout check, the bus driving off hood-first; booster bar prices, red prices when poor, Bay +1 "Used", 44 px targets, clear of the lot/bay/tip at 390x844, 375x667 and desktop; Flip (pick mode, a car that then leaves from its former tail end, dead-end + optimal hint after it, Undo turns it back and refunds 120, a Flip win capped at 2 stars); Settings with 4 test toggles (saved apart from the real save, which stays byte-identical; Unlock all with test-opened levels off the record; Unlimited coins free boosters, no banking, ∞; Unlimited hints/undos ∞ badges, extra use keeps a win off the record, a booster refund still works, normal counts back after turning off; TEST MODE tag; Reset with confirm);
- no console errors, page errors or failed requests.

It saves screenshots to `screenshots/` (`v7-*.png` for keys, `v4-*.png`; the `v2-*` and `v3-*` files are from earlier rounds).

## Files

```
index.html               game page (title/level select, game screen, overlays)
css/style.css            all visuals (cars are pure CSS, no image assets)
js/engine.js             rules (in-order, Scramble, Bay Word, boosters) + BFS solver (shared by game and Node verifier)
js/baywords.js           GENERATED from levels/baywords.json (Bay Word list)
js/levels.js             GENERATED from levels/levels.json
js/game.js               UI, animation, touch/mouse input, sound (WebAudio), saving
levels/levels.json       level data (source of truth)
levels/baywords.json     321 three-letter Bay Words (each has a vowel)
tools/verify-levels.js   Node level verifier
tools/wjb_solver.py      independent Python reference solver (cross-check)
tools/level-lab.js       dense-lot generator (dev)
tools/level-improve.js   level hill-climber (dev)
tools/starter-lab.js     beginner-level generator/filter (dev)
tools/scramble-lab.js    Scramble lot generator (dev)
tools/scramble-improve.js Scramble lot hill-climber (dev)
tests/rules.js           Node rule/solver tests incl. JS-vs-Python fuzz
tests/e2e.js             Playwright play-test (phone + desktop): levels, Scramble, coins, booster bar, Flip, settings/cheats, bus art
tests/flip-orient.js     Playwright check that a flipped car is DRAWN facing its new way (phone + desktop; pass a URL to check the live site)
tests/file-url.js        file:// smoke test
screenshots/             test screenshots
```

## Notes

- **The name:** "Word Jam Bus" is a working title. Several store titles already use "Word Jam".
- **Assets:** all graphics are CSS and all sounds are generated with WebAudio. There are no third-party assets.
