/* GENERATED from levels/world-trial.json — World Trial manifest. */
window.WJB_WORLD_TRIAL = {
 "format": "wjb-world-trial/1",
 "version": "0.10.0",
 "worldSeed": 90210,
 "genVersion": "g1",
 "saveKey": "wordJamBus.trial.v1",
 "sequence": [
  {
   "city": "c01"
  },
  {
   "path": "suburbs"
  },
  {
   "city": "c02"
  },
  {
   "path": "mainst"
  },
  {
   "city": "c03"
  }
 ],
 "cities": {
  "c01": {
   "name": "Pencil Park",
   "art": "default",
   "theme": "school",
   "pack": "c01",
   "packVersion": 1,
   "band": {
    "score": [
     4,
     10
    ],
    "par": [
     3,
     9
    ]
   },
   "routes": [
    {
     "id": "c01-r1",
     "name": "Route 1",
     "count": 6
    },
    {
     "id": "c01-r2",
     "name": "Route 2",
     "count": 6
    },
    {
     "id": "c01-r3",
     "name": "Route 3",
     "count": 6
    },
    {
     "id": "c01-r4",
     "name": "Route 4",
     "count": 6
    }
   ],
   "bigChest": {
    "coins": 500,
    "boosters": {
     "tow": 1,
     "bay": 1,
     "nudge": 1,
     "flip": 1
    },
    "paint": "maple"
   }
  },
  "c02": {
   "name": "Crayon Creek",
   "art": "default",
   "theme": "suburbs",
   "pack": "c02",
   "packVersion": 1,
   "band": {
    "score": [
     8,
     15
    ],
    "par": [
     7,
     11
    ]
   },
   "routes": [
    {
     "id": "c02-r1",
     "name": "Route 1",
     "count": 6
    },
    {
     "id": "c02-r2",
     "name": "Route 2",
     "count": 6
    },
    {
     "id": "c02-r3",
     "name": "Route 3",
     "count": 6
    },
    {
     "id": "c02-r4",
     "name": "Route 4",
     "count": 6
    },
    {
     "id": "c02-r5",
     "name": "Route 5",
     "count": 6
    }
   ],
   "bigChest": {
    "coins": 1000,
    "boosters": {
     "tow": 1,
     "bay": 1,
     "nudge": 1,
     "flip": 1
    },
    "paint": "trolley"
   }
  },
  "c03": {
   "name": "Notebook Nook",
   "art": "default",
   "theme": "mainst",
   "pack": "c03",
   "packVersion": 1,
   "band": {
    "score": [
     12,
     20
    ],
    "par": [
     9,
     13
    ]
   },
   "routes": [
    {
     "id": "c03-r1",
     "name": "Route 1",
     "count": 7
    },
    {
     "id": "c03-r2",
     "name": "Route 2",
     "count": 7
    },
    {
     "id": "c03-r3",
     "name": "Route 3",
     "count": 7
    },
    {
     "id": "c03-r4",
     "name": "Route 4",
     "count": 7
    },
    {
     "id": "c03-r5",
     "name": "Route 5",
     "count": 7
    }
   ],
   "bigChest": {
    "coins": 1500,
    "boosters": {
     "tow": 1,
     "bay": 1,
     "nudge": 1,
     "flip": 1
    },
    "paint": "surf"
   }
  }
 },
 "paths": {
  "suburbs": {
   "districtId": "suburbs",
   "name": "Maple Suburbs"
  },
  "mainst": {
   "districtId": "mainst",
   "name": "Main Street"
  }
 },
 "pacing": {
  "scrambleDebut": {
   "city": "c01",
   "route": 2
  },
  "bayWordsDebut": {
   "city": "c01",
   "route": 3
  },
  "keysDebut": {
   "city": "c02",
   "route": 1,
   "keys": 1,
   "locks": 1
  }
 }
};
