#!/usr/bin/env python3
"""
Word Jam Bus - independent reference solver for the v2 "slide until blocked" rules.
(Written separately from js/engine.js so the two can cross-check each other.)

Rules
  * Grid [rows, cols], 1-indexed; r1 = top row, c1 = left column.
  * Car {"l", "r", "c", "dir", "len"?}: (r, c) is the HEAD cell; the body extends
    behind it. A car only moves along its own axis.
  * Forward (toward the nose): if every cell to the edge is empty the car exits;
    otherwise it slides until it touches the first car in the way.
  * Reverse: slides backwards until it touches a car or the edge (never exits).
  * A move that cannot shift the car at all is a bump and is not a move.
  * Exiting unit = car's letters: "?" fills the next slot; a unit matching the
    next slot(s) fills; otherwise it goes to the bay; bay already full -> LOSE.
  * Bay units auto-fill whenever they match the next slot(s) (longest first).
  * WIN when every slot of the target ("words" joined, or "word") is filled.

Usage:
  python3 tools/wjb_solver.py levels/levels.json           # report
  python3 tools/wjb_solver.py levels/levels.json --check   # exit 1 on unsolvable / par mismatch
"""
import json
import sys
from collections import deque

STEP = {"up": (-1, 0), "down": (1, 0), "left": (0, -1), "right": (0, 1)}


def target_of(lv):
    return "".join(lv["words"]).upper() if lv.get("words") else lv["word"].upper()


class Lot:
    def __init__(self, lv):
        self.rows, self.cols = lv["grid"]
        self.target = target_of(lv)
        self.cap = lv["bay"]
        self.cars = []
        taken = set()
        for i, car in enumerate(lv["cars"]):
            dr, dc = STEP[car["dir"]]
            n = car.get("len", 1)
            cells = [(car["r"] - dr * k, car["c"] - dc * k) for k in range(n)]
            for cell in cells:
                if not (1 <= cell[0] <= self.rows and 1 <= cell[1] <= self.cols):
                    raise ValueError(f"car {i} outside the grid at {cell}")
                if cell in taken:
                    raise ValueError(f"car {i} overlaps at {cell}")
                taken.add(cell)
            # position = offset of the head cell from its start, along (dr, dc)
            self.cars.append({"unit": car["l"].upper(), "d": (dr, dc), "head": (car["r"], car["c"]), "n": n})
        self.start = tuple(0 for _ in self.cars)

    def cells(self, i, off):
        car = self.cars[i]
        dr, dc = car["d"]
        hr, hc = car["head"][0] + dr * off, car["head"][1] + dc * off
        return [(hr - dr * k, hc - dc * k) for k in range(car["n"])]

    def inside(self, cell):
        return 1 <= cell[0] <= self.rows and 1 <= cell[1] <= self.cols

    def fill_from_bay(self, idx, bay):
        bay = list(bay)
        while idx < len(self.target):
            fits = [u for u in bay if u != "?" and self.target.startswith(u, idx)]
            if not fits:
                break
            u = max(fits, key=len)
            bay.remove(u)
            idx += len(u)
        return idx, tuple(sorted(bay))

    def moves(self, state):
        offs, idx, bay = state
        occupied = {}
        for i, off in enumerate(offs):
            if off is not None:
                for cell in self.cells(i, off):
                    occupied[cell] = i
        for i, off in enumerate(offs):
            if off is None:
                continue
            car = self.cars[i]
            dr, dc = car["d"]
            for sgn in (1, -1):  # 1 = forward (toward the nose), -1 = reverse
                cs = self.cells(i, off)
                lead = cs[0] if sgn == 1 else cs[-1]
                cell = (lead[0] + dr * sgn, lead[1] + dc * sgn)
                dist = 0
                while self.inside(cell) and cell not in occupied:
                    dist += 1
                    cell = (cell[0] + dr * sgn, cell[1] + dc * sgn)
                hit_edge = not self.inside(cell)
                if sgn == 1 and hit_edge:
                    u = car["unit"]
                    new_offs = offs[:i] + (None,) + offs[i + 1:]
                    if u == "?" or self.target.startswith(u, idx):
                        n_idx, n_bay = self.fill_from_bay(idx + (1 if u == "?" else len(u)), bay)
                        yield (i, sgn), (new_offs, n_idx, n_bay)
                    elif len(bay) < self.cap:
                        yield (i, sgn), (new_offs, idx, tuple(sorted(bay + (u,))))
                    # else: losing move, never part of a solution
                elif dist > 0:
                    yield (i, sgn), (offs[:i] + (off + sgn * dist,) + offs[i + 1:], idx, bay)

    def solve(self):
        s0 = (self.start, 0, ())
        dist = {s0: 0}
        q = deque([s0])
        while q:
            s = q.popleft()
            if s[1] >= len(self.target):
                return dist[s], len(dist)
            for _, t in self.moves(s):
                if t not in dist:
                    dist[t] = dist[s] + 1
                    q.append(t)
        return None, len(dist)


def main():
    data = json.load(open(sys.argv[1]))
    levels = data["levels"] if isinstance(data, dict) else data
    check = "--check" in sys.argv
    ok = True
    for lv in levels:
        par, states = Lot(lv).solve()
        flag = ""
        if par is None:
            flag, ok = "  <-- UNSOLVABLE", False
        elif lv.get("par") != par:
            flag, ok = f"  <-- PAR MISMATCH (file {lv.get('par')})", False
        print(f"[{'OK' if not flag else 'FAIL'}] {lv.get('id')}: {target_of(lv)} par={par} states={states}{flag}")
    if check and not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
