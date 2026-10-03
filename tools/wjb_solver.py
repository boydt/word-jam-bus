#!/usr/bin/env python3
"""
Word Jam Bus - level simulator + BFS solver.

Rules (compatible with spelling-car-jam-brief.md test page):
  * Grid [rows, cols], 1-indexed rows (top->bottom) and cols (left->right).
  * Each car: {"l": letter(s), "r": row, "c": col, "dir": up|down|left|right}
      optional "len": cells (default 1). (r,c) is the HEAD (front) cell; the body
      extends backwards, opposite to dir.  e.g. len 2 facing right at r3c4 -> r3c3,r3c4.
  * Tap: if every cell from the head to the grid edge (in dir) is empty -> car exits
    (counts as 1 move). Otherwise it does not move (no move counted).
  * Exiting unit = the car's "l" string.
      - "?"  (wildcard taxi): fills the next needed slot.
      - if target[idx:idx+len(l)] == l : fills those slots.
      - else goes to the holding bay. If the bay already holds `bay` units -> LOSE.
  * After any fill, auto-fill chains from the bay: while some bay unit matches the
    next needed letters, it fills (longest matching unit first; identical units are
    interchangeable, so WHICH copy is used never matters).
  * Repeated letters are fungible: any car with letter P can fill any P slot when that
    slot is next. Extra copies beyond the word's need behave like decoys.
  * Multi-word levels: optional "words": ["BUS","STOP"] instead of "word"; words are
    filled in order (the bay persists across words). Target = concatenation.
  * WIN when every slot is filled (remaining cars don't matter).

Usage:
  python3 wjb_solver.py levels.json            # solve every level, print report
  python3 wjb_solver.py levels.json --check    # exit 1 if any level is unsolvable or par mismatches
  python3 wjb_solver.py levels.json --ascii    # also print ASCII grids
"""
import json, sys
from collections import deque

DIRS = {"up": (-1, 0), "down": (1, 0), "left": (0, -1), "right": (0, 1)}
ARROW = {"up": "↑", "down": "↓", "left": "←", "right": "→"}


def target_of(level):
    if "words" in level:
        return "".join(level["words"]).upper()
    return level["word"].upper()


def car_cells(car):
    dr, dc = DIRS[car["dir"]]
    n = car.get("len", 1)
    return [(car["r"] - dr * k, car["c"] - dc * k) for k in range(n)]


class Level:
    def __init__(self, level):
        self.raw = level
        self.rows, self.cols = level["grid"]
        self.target = target_of(level)
        self.cap = level["bay"]
        self.cars = level["cars"]
        self.cells = [car_cells(c) for c in self.cars]
        # validate
        occ = {}
        for i, cells in enumerate(self.cells):
            for (r, c) in cells:
                if not (1 <= r <= self.rows and 1 <= c <= self.cols):
                    raise ValueError(f"car {i} {self.cars[i]} out of grid at {(r, c)}")
                if (r, c) in occ:
                    raise ValueError(f"cars {occ[(r, c)]} and {i} overlap at {(r, c)}")
                occ[(r, c)] = i
        self.occ = occ
        # path cells for each car (from head to edge, exclusive of head)
        self.path = []
        for car in self.cars:
            dr, dc = DIRS[car["dir"]]
            r, c = car["r"] + dr, car["c"] + dc
            p = []
            while 1 <= r <= self.rows and 1 <= c <= self.cols:
                p.append((r, c))
                r, c = r + dr, c + dc
            self.path.append(p)
        # blockers[i] = set of car ids whose cells lie on car i's path
        self.blockers = [frozenset(occ[x] for x in p if x in occ) for p in self.path]

    def can_move(self, i, removed):
        return all((removed >> b) & 1 for b in self.blockers[i])

    def autofill(self, idx, bay):
        bay = list(bay)
        while idx < len(self.target):
            best = None
            for u in bay:
                if u != "?" and self.target.startswith(u, idx):
                    if best is None or len(u) > len(best):
                        best = u
            if best is None:
                break
            bay.remove(best)
            idx += len(best)
        return idx, tuple(sorted(bay))

    def step(self, state, i, cap=None):
        """Return new state, or None if tap is blocked, or 'LOSE'."""
        cap = self.cap if cap is None else cap
        removed, idx, bay = state
        if (removed >> i) & 1 or not self.can_move(i, removed):
            return None
        u = self.cars[i]["l"].upper()
        removed |= (1 << i)
        if u == "?":
            idx += 1
            idx, bay = self.autofill(idx, bay)
        elif self.target.startswith(u, idx):
            idx += len(u)
            idx, bay = self.autofill(idx, bay)
        else:
            if len(bay) >= cap:
                return "LOSE"
            bay = tuple(sorted(bay + (u,)))
        return (removed, idx, bay)

    def start(self):
        return (0, 0, ())

    def solve(self, cap=None):
        """BFS. Returns (par, path_of_car_ids, stats) or (None, None, stats)."""
        s0 = self.start()
        prev = {s0: None}
        q = deque([s0])
        win = None
        while q:
            s = q.popleft()
            if s[1] >= len(self.target):
                win = s
                break
            for i in range(len(self.cars)):
                t = self.step(s, i, cap)
                if t is None or t == "LOSE" or t in prev:
                    continue
                prev[t] = (s, i)
                q.append(t)
        if win is None:
            return None, None, {"states": len(prev)}
        path = []
        s = win
        while prev[s] is not None:
            s, i = prev[s]
            path.append(i)
        path.reverse()
        return len(path), path, {"states": len(prev)}

    def explore(self):
        """Full reachable-state analysis: how many states / first moves are dead ends."""
        s0 = self.start()
        seen = {s0}
        order = [s0]
        edges = {}
        q = deque([s0])
        while q:
            s = q.popleft()
            edges[s] = []
            if s[1] >= len(self.target):
                continue
            for i in range(len(self.cars)):
                t = self.step(s, i)
                if t is None:
                    continue
                edges[s].append((i, t))
                if t != "LOSE" and t not in seen:
                    seen.add(t)
                    order.append(t)
                    q.append(t)
        good = {s for s in seen if s[1] >= len(self.target)}
        changed = True
        while changed:
            changed = False
            for s in seen:
                if s in good:
                    continue
                if any(t != "LOSE" and t in good for _, t in edges[s]):
                    good.add(s)
                    changed = True
        dead = len(seen) - len(good)
        first = edges[s0]
        first_bad = [self.cars[i]["l"] for i, t in first if t == "LOSE" or t not in good]
        return {"reachable": len(seen), "dead_states": dead,
                "first_moves": len(first), "first_moves_dead": first_bad}

    def min_bay(self):
        for cap in range(0, len(self.cars) + 1):
            p, _, _ = self.solve(cap)
            if p is not None:
                return cap
        return None

    def narrate(self, path):
        s = self.start()
        lines = []
        for n, i in enumerate(path, 1):
            car = self.cars[i]
            before_idx = s[1]
            t = self.step(s, i)
            u = car["l"].upper()
            filled = self.target[before_idx:t[1]]
            if t[1] > before_idx:
                if u == "?" :
                    what = f"wildcard fills {self.target[before_idx]}"
                else:
                    what = f"fills {u}"
                extra = filled[1 if u == '?' else len(u):]
                if extra:
                    what += f", bay auto-fills {' '.join(extra)}"
            else:
                what = "not next -> bay"
            done = " -> WIN" if t[1] >= len(self.target) else ""
            lines.append((n, f"{u}@r{car['r']}c{car['c']}{ARROW[car['dir']]}", what + done,
                          " ".join(t[2]) or "-", self.target[:t[1]] or "-"))
            s = t
        return lines

    def ascii(self):
        grid = [["  . " for _ in range(self.cols)] for _ in range(self.rows)]
        for car, cells in zip(self.cars, self.cells):
            l = car["l"].upper()
            head = f"{l}{ARROW[car['dir']]}"
            r, c = cells[0]
            grid[r - 1][c - 1] = f"{head:>4}"
            for (r, c) in cells[1:]:
                grid[r - 1][c - 1] = "  = " if car["dir"] in ("left", "right") else "  ‖ "
        hdr = "     " + "".join(f" c{c:<2}" for c in range(1, self.cols + 1))
        out = [hdr]
        for r in range(self.rows):
            out.append(f"r{r+1:<3} " + "".join(grid[r]))
        return "\n".join(out)


def report(levels, show_ascii=False, check=False):
    ok = True
    results = []
    for lv in levels:
        L = Level(lv)
        par, path, st = L.solve()
        name = lv.get("id", lv.get("name", target_of(lv)))
        if par is None:
            print(f"[FAIL] {name}: UNSOLVABLE with bay={L.cap} (states {st['states']})")
            ok = False
            continue
        mb = L.min_bay()
        ex = L.explore()
        flag = ""
        if "par" in lv and lv["par"] != par:
            flag = f"  <-- PAR MISMATCH (file says {lv['par']})"
            ok = False
        print(f"[OK] {name}: target={L.target} grid={L.rows}x{L.cols} cars={len(L.cars)} "
              f"bay={L.cap} min_bay_needed={mb} optimal_moves(par)={par} "
              f"reachable_states={ex['reachable']} dead_states={ex['dead_states']} "
              f"dead_first_taps={ex['first_moves_dead']}{flag}")
        if show_ascii:
            print(L.ascii())
            for row in L.narrate(path):
                print("   ", row)
            print()
        results.append((name, par, mb))
    if check and not ok:
        sys.exit(1)
    return results


if __name__ == "__main__":
    data = json.load(open(sys.argv[1]))
    levels = data["levels"] if isinstance(data, dict) else data
    report(levels, show_ascii="--ascii" in sys.argv, check="--check" in sys.argv)
