# Word Jam Bus (working title)

A parking-jam word puzzle for phones and desktops. Every car in a packed lot carries a letter. Slide cars around to clear lanes, and drive them out so their letters board the bus in the order that spells the target word.

**v4** adds three things: **Scramble stops** (levels where letters board in any order), **coins and boosters** (Tow truck, Bay +1, Nudge), and **Bay Words** (junk letters in the bay that spell a 3-letter word clear for bonus coins). The campaign grows from 20 to 23 levels; see [v4 features](#v4-features).

**v6** gives the buses an old-style school-bus look (a lower hood with a bumper at the front, a tailpipe with a puff at the back), puts the boosters in an on-screen **booster bar** with a fourth booster, **Flip**, and adds a **Settings** panel (gear on the title screen) with **test / cheat options**; see [v6 changes](#v6-changes).

**v7** adds keys and padlocked cars (Downtown, levels 24-28). **v8** replaces the level select with a **city route map**: five themed districts the bus drives through, a treasure **chest** at the end of each one, a **free-booster inventory** and **bus paints**; see [v8: the city route map](#v8-the-city-route-map).

**v9** adds **Main Street**, a new district of 10 forgiving **normal** lots with many ways to win (stops 11-21), spreads the four **Scramble stops** so every district from Main Street on has one with a par in line with its neighbours, turns **Sunny Beach** into the "big jammed lots" district, and shows a five-tier **difficulty badge** (Very Easy to Super Hard, computed from solver data) on every map stop, the level-intro banner and the play-screen header; see [v9](#v9-main-street-scramble-spread-and-difficulty-tiers). There are now 38 levels in 6 districts.

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

### Scramble stops (levels 12, 17, 22 in v4; see v9 for today's stops 13, 25, 31 and 35)

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

## v7: keys and padlocked cars (Downtown, levels 24-28; stops 34-38 since v9)

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

## v8: the city route map

**Play / Continue** on the title screen opens the map (the level select). The bus drives along a winding road from district to district. Each stop is a level, and each district ends in a boss lot and a treasure chest. Everything is drawn with CSS and inline SVG, with no image files.

v8 table (v8 stop numbers; v9 added Main Street and moved stops, see [v9](#v9-main-street-scramble-spread-and-difficulty-tiers) for today's map):

| # | District | Theme (palette, landmarks, road) | Stops | Teaches | Boss lot | Chest |
|---|---|---|---|---|---|---|
| 1 | School Street | green lawns; schoolhouse, crossing sign, traffic light, pencil; grey asphalt with white dashes | 1-6 | driving basics (exit, slide, reverse, the bay) | 6 MILK (par 6) | 100 coins, Nudge ×1, Tow ×1 |
| 2 | Maple Suburbs | striped lawns; houses, maple trees, picket fence, mailbox; asphalt with a yellow centre line | 7-11 | long trucks | 11 BUS (par 10) | 150 coins, Bay +1 ×1, Flip ×1, **Maple Red** paint |
| 3 | Sunny Beach | sand between sea strips; palms, parasols, lifeguard tower, sandcastle, sun; a wooden boardwalk | 12-16 | Scramble stops | 16 GARDEN (par 24) | 200 coins, Nudge ×2, Bay +1 ×1, **Surf Teal** paint |
| 4 | Harbor Docks | quay between water; lighthouse, crane, containers, sailboat, anchor; cobblestones | 17-23 | Bay Words, chunk trucks, the wildcard taxi | 23 SCHOOL (par 36) | 250 coins, Tow ×1, Flip ×1, Bay +1 ×1 |
| 5 | Downtown | night sky with stars; towers, city hall, street lamps, neon sign, keys; dark asphalt with neon kerbs | 24-28 | keys and padlocks | 28 SQUARE (par 33) | 400 coins, Tow ×2, Flip ×2, **Midnight Neon** paint |

The level order and ids are unchanged (the 28 levels were already in this order), so saves keep working. The data is in `levels/districts.json`, which `tools/verify-levels.js --write` copies into `js/levels.js` as `window.WJB_MAP`.

- **The map:** a vertical, scrolling map, centred and wider (up to 820 px) on desktop. Each district has a sticky header with its number, name, "New: <mechanic>", a progress bar, stars (for example 7/15) and a chest chip (Boss chest / Open! / Opened). Stops show their stars, and are styled as current (a pulsing ring), done, locked (padlock), boss (bigger, gold, BOSS tag) and test-opened (dashed red). Scramble stops show a shuffle badge and key levels a key badge. A locked district sits under a fog behind a closed gate with a padlock. The map scrolls to the current stop when it opens.
- **The bus:** a top-down bus (in your chosen paint) parks just before the stop it is at. When you return to the map from a level it stays on that stop (v9.1; in v8/v9 it drove on to the Continue stop). After a win, **Next stop** drives on to the next stop and starts it. Tap any open stop and the bus drives there, then the level starts; tap it again to skip the drive. The camera follows the bus on long drives. The bus is moved only with `transform` (translate + rotate) in `requestAnimationFrame`, with an ease-in-out, a little bob and exhaust puffs. The first time the bus enters a district, its gate barrier lifts.
- **Play-screen tint:** each level's play screen gets a soft tint for its district (warm for School Street, sea and sand for Sunny Beach, deep blue for Harbor Docks, night purple for Downtown).
- **Reduced motion:** the bus jumps straight to the stop. There is no pulsing, bobbing, rattling, confetti or spinning rays, and the chest opens at once.

### Finishing a district

A district is **finished when its boss lot (its last stop) is won** for real (not with Unlock all). Stops open one at a time, so winning the boss also means every stop before it has been won. Finishing a district does two things:
- it opens the next district, using the same unlock rule as before (the next level opens), and its gate lifts the first time the bus drives through;
- its chest becomes **ready**.

Opening the chest is never needed to go on. A ready chest is waiting for you, never a lock.

### Chests

- After a boss win the button reads **Open the chest!**. The bus drives to the chest and it pops up. Tap the chest (or **Open!**): it rattles, the lid flies open, light rays spin, confetti bursts and the rewards pop in one by one. Then **Collect**: the bus drives through the gate into the next district.
- A ready chest can also be opened later, by tapping it on the map, by its header chip, or with the map's **Chest to open!** button. The title screen reminds you too.
- Each chest is **claimed once**. The claim happens and is saved the moment it starts opening, so reloading mid-animation can't claim it twice. Tapping an opened chest just shows "Already opened". A locked chest says which boss to beat and what is inside.
- **Rewards:** coins, free boosters (into the inventory), and in three chests a **bus paint**. A new paint is put on the bus straight away, and you can change paints in **Settings → Bus paint**.

### Free-booster inventory

- `progress.inv` holds counts of Tow, Bay +1, Nudge and Flip won from chests. In the booster bar a booster you hold shows a green **count badge** and **Free**. The confirm sheet says "Use a free Nudge? (1 left)".
- Free boosters are **used before coins**. When the count runs out, the booster goes back to its coin price.
- They follow the same rules as bought boosters: one of each kind per level, a win with any booster is **capped at 2 stars** (no par bonus or best score), and they are **never required** (every level is still winnable at par with none). **Undo** of a booster move gives back what it cost: coins if it was bought, or **the free booster back into the inventory** ("Undo · free Nudge back"). Restart refunds nothing, the same as for coins.
- The game records how each booster use was paid for (`free` under Unlimited coins, `inv`, or `coins`), so Undo refunds the right thing.

### Cheats on the map

- **Unlock all levels:** every district and stop opens, test-opened stops get a dashed red outline, the gates are up, and the bus can drive anywhere. Nothing about it is saved: the bus's spot and gate flags are saved only for really-open stops with no test option on.
- **Any test option on** (Unlock all, Unlimited coins, hints or undos): a chest opens only as a **TEST MODE preview**, with a red frame and ribbon. It shows its rewards, but nothing is granted or saved and the chest is not marked claimed. A boss won only because of Unlock all doesn't make its chest ready ("Boss lot beaten (test mode: chest not unlocked)"). Under Unlimited coins, boosters are free and the inventory isn't touched.
- Turn the options off and the real progress returns exactly: real stops, locked districts and chests, real coins and inventory, and the bus at its real stop. The tests check that the real save is byte-identical under cheats.

### Saves and migration

The save format is still `v: 4`, with new fields added: `inv`, `chests` (opened chests by district id), `paints`, `paint` and `busAt` (where the bus is parked; cosmetic). v9.1 adds `lastStop` (the level last played or opened). Older saves (v2, v3 and v4) load with defaults: nothing in the inventory, no chests opened, School Yellow paint. They land on the right district and stop, because the bus starts at the Continue stop.

For districts an older save has already finished, the chests are **claimable, one time each**, rather than auto-awarded, so players still get the chest-opening moment. The title says "N chests to open on the map!". The map shows the chests as ready, with a **N chests to open!** button that opens them one after another (the bus doesn't need to drive back). **Reset progress** clears the inventory, chests, paints and bus spot too.

## v9: Main Street, Scramble spread and difficulty tiers

Sections for v4-v8 above keep the stop numbers of their own release. Ids, layouts and par of every older level are unchanged; only positions moved.

### Main Street: 10 normal levels

The step from HOUSE (par 9, Easy) to BUS (par 10, but exacting) was the steepest on the route. v9 puts a new district between them: **Main Street** (stops 11-21), ten new lots with par 9-12 that are built to be **forgiving**: many first moves are fine, a slip or two still wins, and there are many different winning lines. They use only what the starter levels taught (slides, reverse, the bay and long trucks): no keys, chunk trucks or taxi. Each one is solver-proven winnable at par without boosters, and each has a tip.

| # | id | Word | Grid | Cars | Bay | Par | First-move slack (par+1 / par+2) | On-track share along the best line (par+1) | Distinct winning sequences within par+2 | Optimal solutions | Score | Tier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 11 | nm1-bread | BREAD | 6x6 | 16 | 3 | 9 | 10/10 / 10/10 | 0.796 | 293,386 | 96 | 12.7 | Normal |
| 12 | nm2-shop | SHOP | 5x5 | 13 | 3 | 9 | 9/10 / 10/10 | 0.767 | 147,090 | 202 | 13.5 | Normal |
| 14 | nm3-park | PARK | 5x5 | 13 | 3 | 10 | 9/10 / 10/10 | 0.856 | ≥1,000,000 | 9,125 | 13.2 | Normal |
| 15 | nm4-music | MUSIC | 6x6 | 16 | 3 | 10 | 12/13 / 13/13 | 0.739 | ≥1,000,000 | 378 | 15.4 | Normal |
| 16 | nm5-candy | CANDY | 5x5 | 15 | 3 | 10 | 11/11 / 11/11 | 0.733 | ≥1,000,000 | 576 | 15.3 | Normal |
| 17 | nm6-clock | CLOCK | 5x5 | 13 | 3 | 11 | 9/10 / 10/10 | 0.819 | ≥1,000,000 | 400 | 15.3 | Normal |
| 18 | nm7-tower | TOWER | 6x6 | 13 | 3 | 11 | 10/10 / 10/10 | 0.773 | ≥1,000,000 | 5,076 | 16.0 | Normal |
| 19 | nm8-cinema | CINEMA | 5x5 | 13 | 3 | 11 | 9/10 / 10/10 | 0.771 | 423,265 | 214 | 16.3 | Normal |
| 20 | nm9-bakery | BAKERY | 6x6 | 16 | 3 | 12 | 10/10 / 10/10 | 0.813 | 739,149 | 206 | 16.5 | Normal |
| 21 | nm10-street | STREET | 5x5 | 12 | 3 | 12 | 11/11 / 11/11 | 0.777 | ≥1,000,000 | 1,116 | 17.4 | Normal |

Score and tier here are the v9 values; v9.1 re-scored every level (all ten are still Normal, 10.8-14.7), see [Levels (v9 order)](#levels-v9-order). "≥1,000,000" means the count reached the solver's 1M cap. The lots were found with `tools/normal-lab.js` (random layouts filtered by the normal thresholds) and polished with `tools/normal-improve.js` (a random-edit hill-climb that keeps each lot inside the normal-tier limits), then checked by the verifier.

**Comparison** (par / first-move slack at par+1 / on-track share / score):

| Group | Par | First-move slack | On-track share | Score |
|---|---|---|---|---|
| Warm-ups FROG, TRAIN, TIGER, HOUSE (stops 7-10) | 7-9 | 91-100% (avg 97%) | 0.81-0.94 (avg 0.89) | 8.2-12.5 |
| **Main Street normal lots (10)** | 9-12 | 90-100% (avg 95%) | 0.73-0.86 (avg 0.78) | 12.7-17.4 |
| First big lots BUS, CAR, PLANET (22-24) | 10-17 | 25-87% (avg 47%) | 0.32-0.59 (avg 0.45) | 18.6-37.8 |
| All hard + super hard in-order levels (22-38) | 10-36 | 25-100% (avg 56%) | 0.24-0.69 (avg 0.46) | 18.6-78.9 |

So the normal lots sit between the warm-ups and the first big lots: about as long as BUS, but almost every first move is fine, and about four out of five moves along the way still keep a par+1 win open (BUS: 59%, CAR: 32%).

### Variety metrics

`E.variety(game, {slack: 2})` in `js/engine.js` runs a breadth-first search of every state within L = par + 2 moves of the start, then a backward pass for the fewest moves to a win from each of them, and returns (legal moves include losing ones, bumps don't count):
- **first-move slack**: of the legal first moves, how many still allow a win within par + 1 and within par + 2 (`firstOkBySlack`);
- **mid-game forgiveness**: walking the solver's optimal line, the average share of legal moves at each step that still allow a win within par + 1 / par + 2 (`midBySlack`);
- **distinct winning sequences** within par + 2 (`seqWithin`, capped at 1,000,000) and the number of **optimal** (par-move) solutions (`optimal`);
- the number of states searched.

Within par + 2 nearly every move is "fine" (a wasted slide can be undone with the reverse slide, so it costs exactly 2), on easy and hard levels alike, so the tiers use the **par + 1** figures, which only forgive moves that belong to another real winning line. The par + 2 figures are still reported.

**Normal-tier thresholds** (enforced by the verifier for every `"tier": "normal"` level): par 9-12; first-move slack at par + 1 ≥ 60%; on-track share at par + 1 ≥ 0.72; at least 4 optimal solutions; at least 1,000 winning sequences within par + 2; at most 1 word-letter car free on move 1; it needs slides; no padlocks, chunk trucks or `?` taxi; a loss is reachable (the bay matters); it has a tip; consecutive normal levels may raise par by at most 2 and lower it by at most 1.

### Difficulty tiers

Every level has a generated `difficulty` field (`tools/difficulty.js --write`; the verifier fails if it doesn't match the formula). **Recalibrated in v9.1** (see [v9.1](#v91-091-the-bus-stays-put-and-recalibrated-tiers)); the v9 formula was `score = par × (1 + 2 × (1 − track)) + 3 × (1 − first)` with bands 7 / 12 / 18 / 60, which made short exacting lots such as BUS (par 10) Hard. Today:

    score = par × (1 + (1 − track)) + 3 × (1 − first)

where `first` = first-move slack at par + 1 (as a share) and `track` = the on-track share at par + 1. A level where every move keeps you on track scores its par; one where no move does scores at most double. The score band gives a tier, then **par bands** clamp it:

| Tier | Badge | Score band | Par bands |
|---|---|---|---|
| 1 Very Easy | green, 1 pip | < 7 | |
| 2 Easy | teal, 2 pips | 7 to < 10.5 | par ≤ 8 is at most Easy |
| 3 Normal | blue, 3 pips | 10.5 to < 20 | par ≥ 9 is at least Normal; par ≤ 12 is at most Normal (never Hard) |
| 4 Hard | orange, 4 pips | 20 to < 50 | par ≥ 20 is at least Hard; par ≤ 25 is at most Hard |
| 5 Super Hard | red, 5 pips | ≥ 50 | par ≥ 30 is always Super Hard |

The tier is computed from the unrounded score and the par, and depends only on the lot, never on its position; there are no manual overrides. Since v9.1 tiers rise district by district (Downtown restarts at Hard for the keys ramp): Very Easy 1-5, Easy 6-8, Normal 9-22, Hard 23-31, Super Hard 32-33, Hard 34-37, Super Hard 38. The badge shows coloured pips (and the name on the banner and the HUD), so it never relies on colour alone, and has an aria label ("Difficulty: Normal (3 of 5)"). It shows:
- on **map stops**, as a small pip pill under each stop (the stop's aria label also says the tier);
- on the **level-intro banner** ("Level N · District · Par P" plus the badge, 1.8 s; on Scramble stops in the Scramble banner);
- in the **play-screen header**, under "Level N of 38".

### The map now (6 districts, 38 stops)

| # | District | Stops | Teaches | Scramble | Boss lot | Chest |
|---|---|---|---|---|---|---|
| 1 | School Street | 1-6 | driving basics | - | 6 MILK (par 6) | 100 coins, Nudge ×1, Tow ×1 |
| 2 | Maple Suburbs | 7-10 | long trucks | - | 10 HOUSE (par 9) | 150 coins, Bay +1 ×1, Flip ×1, **Maple Red** paint |
| 3 | Main Street | 11-21 | many ways to win (normal lots) + the first Scramble stop | PIZZA | 21 STREET (par 12) | 175 coins, Tow ×1, Nudge ×1, **Trolley Green** paint |
| 4 | Sunny Beach | 22-27 | big jammed lots + Bay Words | JUNGLE | 27 GARDEN (par 24) | 200 coins, Nudge ×2, Bay +1 ×1, **Surf Teal** paint |
| 5 | Harbor Docks | 28-33 | chunk trucks and the wildcard taxi | DRAGONS | 33 SCHOOL (par 36) | 250 coins, Tow ×1, Flip ×1, Bay +1 ×1 |
| 6 | Downtown | 34-38 | keys and padlocks | SUBWAY | 38 SQUARE (par 33) | 400 coins, Tow ×2, Flip ×2, **Midnight Neon** paint |

- **Main Street** has its own theme: brick-sidewalk edges and a green square, a grey street with trolley-track ties, landmarks drawn in SVG (a shop with an awning, a clock tower, a green trolley, a lamp post with flowers, a café umbrella), teal and orange header accents, and a soft green play-screen tint. Its chest has 175 coins, a Tow, a Nudge and the new **Trolley Green** paint. Its header says "New: Many ways to win + Scramble".
- **Maple Suburbs** now ends with HOUSE (stops 7-10, boss HOUSE); BUS opens **Sunny Beach**.
- **Sunny Beach, rethought:** in v8 it "taught" Scramble stops, but PIZZA was its only one and the rest were the first big in-order lots. It is now where the **big jammed lots** begin (BUS, CAR, PLANET, APPLE, GARDEN), with JUNGLE as its Scramble stop and the Bay Word debut ("New: Big jammed lots + Bay Words").
- **Harbor Docks** teaches chunk trucks and the taxi, with DRAGONS between MOTHER and BUS + STOP; **Downtown** has SUBWAY right after BANK (the first padlock level).

### Scramble spread and par in line

The Scramble stops used to be breathers that dipped well below the level before them. In v9 every district from Main Street on has one, and its par must be **in line** with its neighbours: within 0.8 × min to 1.2 × max of the in-order levels just before and after it. No Scramble par changed; they were moved instead:

| Scramble | Stop (v8 → v9) | Par | Neighbours (par) | Allowed |
|---|---|---|---|---|
| PIZZA | 12 → 13 (Main Street) | 9 | SHOP 9, PARK 10 | 8-12 |
| JUNGLE | 17 → 25 (Sunny Beach) | 17 | PLANET 17, APPLE 21 | 14-25 |
| DRAGONS | 22 → 31 (Harbor Docks) | 22 | MOTHER 26, BUS + STOP 30 | 21-36 |
| SUBWAY | 27 → 35 (Downtown) | 17 | BANK 14, HOTEL 20 | 12-24 |

The other Scramble rules stay: at least 3 in-order levels between Scramble stops, none in the starter ramp (School Street and Maple Suburbs stay Scramble-free as the teaching ramp), the first one has a tip, and each Scramble lot is impossible or at least 2 moves slower in order.

### Migration (v8 saves)

The save format is still `v: 4`. Stars, best scores and chests are kept **by level / district id**, so they follow the moved levels.
- **Chests:** each is claimed once, by id, never twice. A v8 player who beat HOUSE gets the Maple Suburbs chest as ready (its boss is now HOUSE); the Main Street chest stays locked until STREET (stop 21) is won.
- **Access:** players past BUS keep everything they had open. Main Street opens for them but is not forced: the title and the district header say "New: Main Street, 10 new stops!".
- **Continue:** a save waiting at BUS continues at stop 11 (BREAD). A level that was won always opens the stop after it (this keeps a v8 save that beat BUS and was waiting at PIZZA, now stop 13, moving on to CAR, stop 23). A save that beat everything continues at the first unplayed Main Street stop.

### Other v9 changes

- DRAGONS' tip no longer calls it a breather ("Harbor Scramble stop: any order again. Can your junk letters spell a word?").
- HOUSE's tip now hands off to Main Street ("Last warm-up! Next up: Main Street, with lots of ways to win.").
- Settings: with five bus paints the swatches get their own line under the label, and tapping Reset scrolls the confirm buttons into view on short screens.
- `package.json` is 0.9.0.

### v9 screenshots

`screenshots/v9-mainst-district.png`, `v9-mainst-chest-rewards.png`, `v9-map-overview-full.png` (the whole map), `v9-district-1-school.png` ... `v9-district-6-downtown.png`, `v9-desktop-map.png`, `v9-map-tier-badges-390x844.png`, `v9-map-tier-badges-375x667.png`, `v9-start-banner-tier-390x844.png`, `v9-start-banner-tier-desktop.png`, `v9-play-header-tier-390x844.png`, `v9-play-header-tier-375x667.png`, `v9-normal-nm1-bread-390x844.png`, `v9-normal-nm6-clock-390x844.png`, `v9-normal-nm10-street-390x844.png`, `v9-first-scramble-tip-390x844.png`, `v9-first-scramble-banner-390x844.png`, `v9-hard-scramble-dragons-banner-390x844.png`, `v9-hard-scramble-dragons-header-390x844.png`.

### Levels (v9 order)

Tier and score columns as of v9.1.

| # | District | id | Word | Mode | Par | Tier | First (par+1) | Track (par+1) | Score |
|---|---|---|---|---|---|---|---|---|---|
| 1 | School Street | st1-cat | CAT | in order | 3 | Very Easy | 6/6 | 1 | 3.0 |
| 2 | School Street | st2-dog | DOG | in order | 4 | Very Easy | 3/3 | 0.938 | 4.3 |
| 3 | School Street | st3-sun | SUN | in order | 5 | Very Easy | 6/6 | 0.92 | 5.4 |
| 4 | School Street | st4-hat | HAT | in order | 5 | Very Easy | 6/6 | 0.96 | 5.2 |
| 5 | School Street | st5-fish | FISH | in order | 6 | Very Easy | 8/8 | 0.983 | 6.1 |
| 6 | School Street | st6-milk | MILK | in order | 6 | Easy | 6/7 | 0.852 | 7.3 |
| 7 | Maple Suburbs | st7-frog | FROG | in order | 7 | Easy | 7/7 | 0.914 | 7.6 |
| 8 | Maple Suburbs | st8-train | TRAIN | in order | 8 | Easy | 8/8 | 0.939 | 8.5 |
| 9 | Maple Suburbs | st9-tiger | TIGER | in order | 9 | Normal | 8/8 | 0.806 | 10.7 |
| 10 | Maple Suburbs | st10-house | HOUSE | in order | 9 | Normal | 11/12 | 0.911 | 10.0 |
| 11 | Main Street | nm1-bread | BREAD | in order | 9 | Normal | 10/10 | 0.796 | 10.8 |
| 12 | Main Street | nm2-shop | SHOP | in order | 9 | Normal | 9/10 | 0.767 | 11.4 |
| 13 | Main Street | sc1-pizza | PIZZA | **Scramble** | 9 | Normal | 10/11 | 0.795 | 11.1 |
| 14 | Main Street | nm3-park | PARK | in order | 10 | Normal | 9/10 | 0.856 | 11.7 |
| 15 | Main Street | nm4-music | MUSIC | in order | 10 | Normal | 12/13 | 0.739 | 12.8 |
| 16 | Main Street | nm5-candy | CANDY | in order | 10 | Normal | 11/11 | 0.733 | 12.7 |
| 17 | Main Street | nm6-clock | CLOCK | in order | 11 | Normal | 9/10 | 0.819 | 13.3 |
| 18 | Main Street | nm7-tower | TOWER | in order | 11 | Normal | 10/10 | 0.773 | 13.5 |
| 19 | Main Street | nm8-cinema | CINEMA | in order | 11 | Normal | 9/10 | 0.771 | 13.8 |
| 20 | Main Street | nm9-bakery | BAKERY | in order | 12 | Normal | 10/10 | 0.813 | 14.2 |
| 21 | Main Street | nm10-street | STREET | in order | 12 | Normal | 11/11 | 0.777 | 14.7 |
| 22 | Sunny Beach | lv1-bus | BUS | in order | 10 | Normal | 7/8 | 0.59 | 14.5 |
| 23 | Sunny Beach | lv2-car | CAR | in order | 13 | Hard | 2/8 | 0.316 | 24.1 |
| 24 | Sunny Beach | lv3-planet | PLANET | in order | 17 | Hard | 2/7 | 0.451 | 28.5 |
| 25 | Sunny Beach | sc2-jungle | JUNGLE | **Scramble** | 17 | Hard | 7/9 | 0.618 | 24.2 |
| 26 | Sunny Beach | lv4-apple | APPLE | in order | 21 | Hard | 3/4 | 0.43 | 33.7 |
| 27 | Sunny Beach | lv5-garden | GARDEN | in order | 24 | Hard | 4/6 | 0.612 | 34.3 |
| 28 | Harbor Docks | lv6-rocket | ROCKET | in order | 26 | Hard | 2/7 | 0.363 | 44.7 |
| 29 | Harbor Docks | lv7-ticket | TICKET | in order | 27 | Hard | 2/3 | 0.555 | 40.0 |
| 30 | Harbor Docks | lv8-mother | MOTHER | in order | 26 | Hard | 5/5 | 0.685 | 34.2 |
| 31 | Harbor Docks | sc3-dragons | DRAGONS | **Scramble** | 22 | Hard | 3/4 | 0.581 | 32.0 |
| 32 | Harbor Docks | lv9-busstop | BUS + STOP | in order | 30 | Super Hard | 5/12 | 0.241 | 54.5 |
| 33 | Harbor Docks | lv10-school | SCHOOL | in order | 36 | Super Hard | 1/2 | 0.441 | 57.6 |
| 34 | Downtown | dt1-bank | BANK | in order | 14 | Hard | 5/10 | 0.41 | 23.8 |
| 35 | Downtown | sc4-subway | SUBWAY | **Scramble** | 17 | Hard | 3/5 | 0.682 | 23.6 |
| 36 | Downtown | dt2-hotel | HOTEL | in order | 20 | Hard | 5/11 | 0.473 | 32.2 |
| 37 | Downtown | dt3-market | MARKET | in order | 22 | Hard | 5/7 | 0.571 | 32.3 |
| 38 | Downtown | dt4-square | SQUARE | in order | 33 | Super Hard | 4/8 | 0.328 | 56.7 |

## v9.1 (0.9.1): the bus stays put, and recalibrated tiers

### The bus stays on the stop you were playing

A player at stop 23 who went back to an earlier stop and played forward one level at a time saw the bus drive back to 23 every time they tapped the map button in a level: the map always sent the bus to the Continue stop (the first unsolved stop after the furthest win). Now:
- The save has a new field, **`lastStop`**: the id of the level last played or opened. It is set when a level starts (from the map, Next stop or a `#level-N` link) and whenever the bus parks at a stop. Like `busAt`, it is saved only for really-open stops with no test option on, so cheats still never touch the real save.
- **Map from inside a level** (the HUD map button) and **Map after a loss**: the bus stays on that level.
- **After a win**, the bus may move on only as part of the won-level flow, to the **stop right after the level just won**: **Next stop** drives there and starts it (as before), and **Map** on the win card parks the bus there. After a boss win with a ready chest it still drives to the chest; after the last level it stays.
- **Title Play / Continue and `#map`** show the bus at `lastStop` instead of driving it to the furthest stop. That is the one change to Continue, because driving to the furthest stop is exactly the jump being fixed. The Continue *target* is unchanged: the pulsing current-stop ring and the map's foot button ("Play stop 23 ▶") still point at the first unsolved stop, so the furthest stop is one tap away.
- **Older saves** (no `lastStop`) keep the old behaviour once: the bus drives from `busAt` to the Continue stop, and from then on `lastStop` is saved. Nothing else in the save changes.

`tests/map-e2e.js` checks it with real taps (a save at stop 23): replaying stop 5 then the map button keeps the bus at 5, also after a reload and through the title's Continue; after winning a replayed stop 5 the win card's Map parks it at 6 and Next stop drives only to 6, never to 23; quitting stop 7 one move in and losing stop 7 both leave the bus at 7; and a save without `lastStop` still drives to the Continue stop.

### Tier recalibration

BUS (par 10) showed **Hard** (v9 score 18.6) but plays easy: the v9 formula weighted the on-track penalty twice as much as length, so a short lot with a few wrong turns crossed into Hard. v9.1 halves the on-track weight (par now counts at least as much as the penalty can add) and adds par bands, so a short lot can never be Hard and the longest lots are always Super Hard; see [Difficulty tiers](#difficulty-tiers) for the formula and bands. All 38 levels were re-rated; three changed:

| # | Word | Par | v9 tier (score) | v9.1 tier (score) | Why |
|---|---|---|---|---|---|
| 10 | HOUSE | 9 | Easy (10.8) | Normal (10.0) | par 9, as long as TIGER and the Main Street lots; the par ≥ 9 floor ends the dip after the Normal TIGER |
| 22 | BUS | 10 | Hard (18.6) | Normal (14.5) | par 10 can never be Hard; its score now sits with the Main Street lots (12.7-14.7) |
| 28 | ROCKET | 26 | Super Hard (61.3) | Hard (44.7) | with the on-track weight halved it scores in line with TICKET (27, 40.0) and MOTHER (26, 34.2); Harbor Docks now rises Hard → Super Hard at BUS + STOP and SCHOOL |

Sanity targets: CAT Very Easy (3.0); every Main Street normal lot (par 9-12) Normal; BUS Normal; SCHOOL (par 36, 57.6) and SQUARE (par 33, 56.7) Super Hard. Totals: **Very Easy 5, Easy 3, Normal 14, Hard 13, Super Hard 3**.

The verifier checks the stored `difficulty` against `tools/difficulty.js` and, separately, re-derives the tier and checks every par band, so any mismatch fails. `tests/rules.js` checks the targets above, `tierOf` on edge cases, and that tiers rise district by district.

### Other

- `index.html` carries `<meta name="wjb-version" content="0.9.1">` (also `window.WJB.version`); `package.json` is 0.9.1.
- Screenshots: `screenshots/v9.1-map-bus-on-replayed-stop-390x844.png` (bus on replayed stop 5 while stop 23 is the current stop), `v9.1-bus-banner-normal-390x844.png`, `v9.1-bus-header-normal-390x844.png` and `v9.1-map-tier-badges-390x844.png`.

## Levels

v9 has 38 levels; see [Levels (v9 order)](#levels-v9-order) for the current order with modes, par and tiers. The tables below describe the original sets with their v4 numbers: the **10 starter levels** that teach one idea at a time (still stops 1-10), and the **10 v2 main levels** with **3 Scramble stops** (today stops 22-33 in a new order, with JUNGLE and DRAGONS moved); the 5 Downtown key levels are in v7 and the 10 normal lots in v9.

v4 order:

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
| 10 | HOUSE | 5x5 | 12 | 9 | 3 | 9 | Hand-off to level 11 | Last warm-up! Next up: Main Street, with lots of ways to win. (v9; was "Next come the big jammed lots.") |

Levels 1-5 have a roomy 4-spot bay and **cannot be lost** at all (checked by the verifier). Level 6 shrinks the bay to 3 and is the first level where a wrong letter can lose; from there on the bay stays at 3. Par climbs 3, 4, 5, 5, 6, 6, 7, 8, 9, 9 and then hands off to level 11 (since v9 Main Street's BREAD, par 9; before that BUS, par 10).

### Main levels (v4 numbers 11-23; today 13 and 22-33)

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
| `tier`, `teaches`, `safe` | Optional: `"starter"` marks a beginner level, `"normal"` (v9) a forgiving Main Street lot (default `"core"`); `teaches` names the mechanic it introduces; `safe` asserts it can't be lost. They select the verifier's checks; the game only uses `tier` for the save migration and the "new stops" hint |
| `difficulty` | GENERATED by `tools/difficulty.js --write` (v9): `{tier 1-5, label, score, par, first "k/n", track}`. The game shows it as the difficulty badge; the verifier checks it matches the formula |
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
node tools/verify-levels.js --districts   # only the city map data (levels/districts.json), in under a second
```

For **every** level the verifier checks:
- a valid layout: cars inside the grid, no overlaps, every car has a letter, unique ids;
- winnable within its bay: exhaustive BFS over every forward / reverse / exit sequence;
- `par` equals the fewest moves;

The design checks depend on the level's `tier`:
- **Bay Words:** each level is also solved with the Bay Word rule off and par must match, so a Bay Word is never needed for par; reachable Bay Words are listed.
- **Scramble** (`mode: "scramble"`): core tier, needs slides, in-order play of the same lot is impossible or at least 2 moves slower, junk exits are reported; pacing: after the starters, at least 3 in-order levels between Scramble levels, par **in line** with the in-order levels just before and after it (0.8 × min to 1.2 × max; v9, replacing the old "60-99% breather" rule), every district after the starter ramp has a Scramble stop, and the first Scramble level has a tip.
- **`normal`** (v9, Main Street): the normal-tier thresholds in [v9](#variety-metrics) (par 9-12, first-move slack, on-track share, optimal and par+2 sequence counts, no keys/chunks/taxi, a reachable loss, a tip, gentle par steps).
- **Variety and difficulty** (v9, every level): the variety metrics are printed for every level, and the stored `difficulty` must match `tools/difficulty.js` (tier and score), and (v9.1) the tier is re-derived from the score and par and every par band is checked (par ≤ 12 never Hard, par ≥ 30 always Super Hard, and so on).
- **`core`** in-order levels (default; 11-23 except the Scramble levels): every car carrying a word letter starts blocked; the optimal line needs slides; driving forward only is impossible or slower (except the first core level); par never falls below 75% of an earlier core level's.
- **`starter`** (levels 1-10): the mechanic named in `teaches` must really be needed: `exit` = the best line is taps only; `slide` = it can't be won as fast without partial slides, and needs no reverse and no bay; `reverse` = it can't be won as fast driving forward only, and needs no bay; `bay` = it can't be won as fast without parking a letter; `trucks` = has a long truck; `bay-limit` = a loss is reachable. `"safe": true` means no losing move exists anywhere. Every starter level needs a tip, starter par never goes down, stays below the first core level's par, and the last starter is within 2 of it.
- `js/levels.js` is in sync with the JSON, and `js/baywords.js` with `levels/baywords.json` (all 3 letters, each with a vowel);
- the Python solver (`python3 tools/wjb_solver.py levels/levels.json --check`) agrees on every par;
- v8 map data (`levels/districts.json`): every level is in exactly one district, in levels.json order; each district has 3+ stops and ends with its boss; the boss has the highest par in its district; each district debuts its mechanic (basics = level 1, trucks = the first long truck, scramble = the first Scramble stop, specials = the first chunk truck and wildcard taxi, keys = every padlock level; v9: mixed = every normal-tier level, biglots = the first in-order core level); chest boosters are known kinds ×1-3; paints are known with valid colours; and `js/levels.js` carries the same data.

It also reports the minimum bay needed, how many positions are reachable and how many of those are dead ends, and how many first moves already lose. It exits with code 1 if anything fails.

### Level design tools (dev only)

- `tools/level-lab.js` generates random dense lots for a word (`--word`, `--grid`, `--empty`, `--par lo hi`, `--chunk TH`, `--wild 1`, `--words BUS,STOP`...), keeps only BFS-proven ones where reverse moves matter and word letters start blocked, and saves the best to `--out` as it goes.
- `tools/level-improve.js in.json out.json` hill-climbs a lot: it swaps which cars carry which letters and flips car directions, keeping a change only if the level stays valid and par goes up (with a cap on solver states so hints stay fast on phones). It writes `out.json` on every improvement.

- `tools/scramble-lab.js` / `tools/scramble-improve.js` generate and hill-climb Scramble lots (single-letter cars only), keeping candidates whose Scramble par is in range and whose in-order par is impossible or clearly higher.
- `tools/normal-lab.js` / `tools/normal-improve.js` (v9) generate and hill-climb normal-tier lots: random layouts from a spec (word, grid, cars, par and score range, forgiveness minimums) filtered by the normal thresholds, then random edits (move, turn, grow or shrink a car, add or drop a decoy, swap letters) that keep a lot inside the normal-tier limits.
- `tools/difficulty.js` (v9) prints every level's variety metrics, score and tier; `--write` stores the `difficulty` field, `--check` fails if a stored one is out of date.
- `tools/starter-lab.js gen spec.json out.json` makes small beginner lots: random layouts filtered by what the level should teach (for example "needs a partial slide but no reverse and no bay", "forward-only impossible", "can't be lost", "at most 2 bay parkings"). It writes candidates as it finds them.

The starter levels CAT and HAT were laid out by hand; the other eight were picked from `starter-lab.js` candidates. The v2 levels were made with `level-lab.js` and `level-improve.js` and then checked with the verifier. Decoy letters were finally spread over a varied set of non-word letters; decoys never fill a seat, so that doesn't change any move, and par was re-proven afterwards.

## Tests (headless browser)

```bash
npm install                       # installs Playwright (dev only)
npx playwright install chromium   # once
node tests/rules.js               # rule + solver unit tests (no browser)
python3 -m http.server 8765 &     # from this folder
node tests/e2e.js                 # phone 390x844 touch, 375x667 check, desktop 1280x800 mouse
node tests/map-e2e.js             # v8 city map: phone 390x844 touch, 375x667, desktop 1280x800, reduced motion
node tests/file-url.js            # opens index.html via file://, opens the map and wins level 1
node tests/flip-orient.js         # a flipped car is drawn facing its new way
node tools/verify-levels.js       # every level + map rules + the Python cross-check (about 10-15 min since v9)
```

`tests/map-e2e.js` covers the map:
- rendering: 6 themed districts, 38 stops, 6 chests; Scramble, key and BOSS markers; 44 px targets; no sideways overflow; the sticky header; the current stop in view;
- tapping a stop to play it; a locked stop can't be tapped;
- the bus: driving after **Next stop** (mid-drive check) and parking at the right stop, which then starts; the HUD map button keeping the bus on the stop being played (v9.1); a save without `lastStop` driving from `busAt` to the current stop, ending within 2 px of its spot; transform-only movement; a tap that drives back, with a second tap skipping;
- v9.1 bus regressions (replay an earlier stop then the map, a win on a replayed stop, quitting mid-level, a loss) and the BUS banner / header with its new Normal badge;
- the boss: "Open the chest!", the bus driving to the chest, closed, opening and open states, the claim saved once (coins and inventory), rewards shown, Collect, the gate lifting and the bus parking at the next district's first stop; an opened chest not paying twice (also after a reload); a locked district and a locked chest;
- the inventory: badges, "Free", the confirm text, used before coins, Undo refunding it to the inventory, a free Tow win capped at 2 stars, coin prices back when empty;
- migration: a v8 save that beat 1-10 + BUS gets two claimable catch-up chests (School Street, and Maple Suburbs whose boss is now HOUSE; paint unlocked and worn, Settings paint picker), the Main Street chest stays locked, the title says "New: Main Street, 10 new stops!" and the bus goes on to CAR; v8 saves waiting at BUS or with all 28 won continue at Main Street stop 11; v2 and v3 saves land on the right stop;
- v9 Main Street: header, boss win, chest (+175, Tow, Nudge, Trolley Green worn), Collect into Sunny Beach; desktop map; a tour of all 6 districts and the full map overview;
- cheats: Unlock all opens everything and the bus drives to stop 26; chest previews under Unlock all and under Unlimited coins; a boss won while test-opened gives no chest; the real save stays byte-identical; real progress returns when cheats are off;
- `#map` deep link, reduced motion (the bus jumps, the chest opens at once with no confetti or rays), the 375x667 chest card fit, and desktop centring (820 px);
- the v8/v9 screenshots, and no console errors.

`tests/e2e.js` moves cars only with real input: touch taps and touch swipes (CDP touch events) on a 390x844 phone with mobile emulation, and mouse clicks, drags and right-clicks at 1280x800. It covers:
- v9 difficulty badges: every map stop has a badge with the right tier and aria label, the level-intro banner and the HUD show the badge for one level of each tier, at 390x844 (fresh and on Main Street), 375x667 and 1280x800; three normal lots on the phone;
- the level select, which is now the city map: 38 stops, Scramble levels marked, Play goes to the map and then "Play stop 1", 44 px stops, no sideways overflow at 390x844, 375x667 and desktop;
- numbered seats with exactly one glowing next seat that advances, and the fare box (+1, Undo back to +0);
- coins: 26 for a first par clear of CAT, saved across reload, +6 on replay, no par bonus over par, nothing banked on a loss;
- Scramble on level 12: the one-time tip card (and not on a second visit), the start banner, purple bus and badge, no seat numbers, out-of-order boarding, only junk to the bay, win at par with 3 stars;
- boosters (with seeded coins): shop prices, confirm, Cancel spends nothing; Tow refused on a needed car at no charge, Tow of a decoy (150, +1 move), dead-end re-check and an optimal hint after it, Undo refunds; Bay +1 (4 spots that really hold 4 letters), Undo refunds; Nudge exactly one cell, Undo refunds; a booster win capped at 2 stars with no par bonus or best score; a loss after a booster keeps the coins spent; a dead end rescued from the dead-end banner's Boosters button;
- Bay Word on level 17: three junk letters clear, +10 in the fare box, "Bay Word 10" on the win card, coins banked;
- v7 keys: badges with the right shape, the first-key tip, a padlocked car tapped and swiped (wiggle, key car call-out, toast, no move), the unlock animation when the key car exits, Undo re-locking, an optimal hint, Tow refusing padlocked and key cars, Nudge/Flip refusing padlocked cars (all greyed in pick mode, no coins charged), Flip on a key car, Bay +1 unaffected, the later key levels and the chain, a desktop click on a padlocked car;
- all 38 levels won through the UI at par with 3 stars and no boosters, on the phone (taps + swipes) and on desktop (clicks + drags);
- saved-progress migration with seeded `localStorage`: v3 saves (partial, through BUS, all 20, starters only), a v2 save, a v4 save with coins, v8 saves waiting at BUS and at PIZZA, and reloading a migrated save (v8 stop numbers are mapped to today's stops by level id);
- 375x667: levels 17, 22 and 23, the booster bar and the confirm sheet fit; desktop right-click reverse, `R` restart and a click nudge;
- v6: bus hood/bumper/tailpipe on every bus and inside the screen on every layout check, the bus driving off hood-first; booster bar prices, red prices when poor, Bay +1 "Used", 44 px targets, clear of the lot/bay/tip at 390x844, 375x667 and desktop; Flip (pick mode, a car that then leaves from its former tail end, dead-end + optimal hint after it, Undo turns it back and refunds 120, a Flip win capped at 2 stars); Settings with 4 test toggles (saved apart from the real save, which stays byte-identical; Unlock all with test-opened levels off the record; Unlimited coins free boosters, no banking, ∞; Unlimited hints/undos ∞ badges, extra use keeps a win off the record, a booster refund still works, normal counts back after turning off; TEST MODE tag; Reset with confirm);
- no console errors, page errors or failed requests.

It saves screenshots to `screenshots/` (`v9-*.png` for Main Street, the normal lots and the difficulty badges, `v8-*.png` for the city map from `tests/map-e2e.js`, `v7-*.png` for keys, `v4-*.png`; the `v2-*` and `v3-*` files are from earlier rounds).

## Files

```
index.html               game page (title, city map, game screen, overlays incl. the chest)
css/style.css            all visuals (cars are pure CSS, no image assets)
js/engine.js             rules (in-order, Scramble, Bay Word, boosters) + BFS solver (shared by game and Node verifier)
js/baywords.js           GENERATED from levels/baywords.json (Bay Word list)
js/levels.js             GENERATED from levels/levels.json
js/game.js               UI, animation, touch/mouse input, sound (WebAudio), saving
levels/levels.json       level data (source of truth)
levels/baywords.json     321 three-letter Bay Words (each has a vowel)
levels/districts.json    city map (v8/v9): districts (stops, theme, mechanic, boss, chest) and bus paints
tools/verify-levels.js   Node level verifier
tools/wjb_solver.py      independent Python reference solver (cross-check)
tools/level-lab.js       dense-lot generator (dev)
tools/level-improve.js   level hill-climber (dev)
tools/starter-lab.js     beginner-level generator/filter (dev)
tools/scramble-lab.js    Scramble lot generator (dev)
tools/scramble-improve.js Scramble lot hill-climber (dev)
tools/normal-lab.js      normal-tier lot generator (dev, v9)
tools/normal-improve.js  normal-tier lot hill-climber (dev, v9)
tools/difficulty.js      variety metrics -> difficulty score and tier (v9; --write / --check)
tests/rules.js           Node rule/solver tests incl. JS-vs-Python fuzz
tests/e2e.js             Playwright play-test (phone + desktop): levels, Scramble, coins, booster bar, Flip, settings/cheats, bus art
tests/flip-orient.js     Playwright check that a flipped car is DRAWN facing its new way (phone + desktop; pass a URL to check the live site)
tests/map-e2e.js         Playwright play-test of the v8 city map (bus, districts, chests, inventory, cheats, migration)
tests/file-url.js        file:// smoke test
screenshots/             test screenshots
```

## Notes

- **The name:** "Word Jam Bus" is a working title. Several store titles already use "Word Jam".
- **Assets:** all graphics are CSS and all sounds are generated with WebAudio. There are no third-party assets.
