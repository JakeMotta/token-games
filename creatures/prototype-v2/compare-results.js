// Made by tools/compare-results.js: do not edit by hand.
window.CreatureCompareResults = {
 "generated": "2026-11-28",
 "machine": "Apple M1 Pro, 10 cores, Google Chrome headless, GPU off",
 "bench": {
  "counts": [
   1,
   5,
   20
  ],
  "frames": 200,
  "warm": 40,
  "timerResolutionMs": 0.1,
  "results": [
   {
    "kind": "v1",
    "n": 1,
    "update": {
     "avg": 0.126,
     "p95": 0.2
    },
    "draw": {
     "avg": 26,
     "p95": 30.2
    }
   },
   {
    "kind": "v2",
    "n": 1,
    "update": {
     "avg": 0.157,
     "p95": 0.2
    },
    "draw": {
     "avg": 28.8,
     "p95": 34.6
    }
   },
   {
    "kind": "v3",
    "n": 1,
    "update": {
     "avg": 0.018,
     "p95": 0.1
    },
    "draw": {
     "avg": 3.45,
     "p95": 3.7
    }
   },
   {
    "kind": "v1",
    "n": 5,
    "update": {
     "avg": 0.341,
     "p95": 0.5
    },
    "draw": {
     "avg": 115.56,
     "p95": 129.4
    }
   },
   {
    "kind": "v2",
    "n": 5,
    "update": {
     "avg": 0.418,
     "p95": 0.6
    },
    "draw": {
     "avg": 129.53,
     "p95": 141.5
    }
   },
   {
    "kind": "v3",
    "n": 5,
    "update": {
     "avg": 0.079,
     "p95": 0.2
    },
    "draw": {
     "avg": 15.1,
     "p95": 15.7
    }
   },
   {
    "kind": "v1",
    "n": 20,
    "update": {
     "avg": 1.016,
     "p95": 1.3
    },
    "draw": {
     "avg": 391.06,
     "p95": 409.5
    }
   },
   {
    "kind": "v2",
    "n": 20,
    "update": {
     "avg": 1.35,
     "p95": 1.9
    },
    "draw": {
     "avg": 448.17,
     "p95": 477.6
    }
   },
   {
    "kind": "v3",
    "n": 20,
    "update": {
     "avg": 0.14,
     "p95": 0.2
    },
    "draw": {
     "avg": 58.33,
     "p95": 60.2
    }
   }
  ]
 },
 "smooth": {
  "scenarios": [
   "s-curve",
   "figure-eight",
   "u-turn",
   "legs-2",
   "legs-4",
   "legs-6",
   "stops"
  ],
  "seeds": [
   "moss",
   "g9",
   "fern",
   "ember",
   "tide"
  ],
  "runs": 35,
  "byKind": {
   "v1": {
    "footSlide": 0.425,
    "footSlideMax": 5.25,
    "hipJitter": 0.431,
    "wobble": 4.38,
    "strideCV": 12.9,
    "crossings": 33.77,
    "pathError": 0.061,
    "tightestTurn": 0.756,
    "bend": 4.5
   },
   "v2": {
    "footSlide": 0.447,
    "footSlideMax": 1.11,
    "hipJitter": 0.156,
    "wobble": 4.26,
    "strideCV": 14.7,
    "crossings": 18.94,
    "pathError": 0.047,
    "tightestTurn": 0.788,
    "bend": 56.8
   },
   "v3": {
    "footSlide": 0.185,
    "footSlideMax": 0.3,
    "hipJitter": 0.156,
    "wobble": 4.26,
    "strideCV": 45.3,
    "crossings": 5.71,
    "pathError": 0.047,
    "tightestTurn": 0.788,
    "bend": 56.8
   }
  }
 },
 "eating": {
  "bodies": [
   "own",
   "legs-2",
   "legs-4",
   "legs-6"
  ],
  "seeds": [
   "moss",
   "g9",
   "fern",
   "ember",
   "tide"
  ],
  "runs": 20,
  "byKind": {
   "v1": {
    "reach": 5.18,
    "eat": 2.82,
    "eaten": 19
   },
   "v2": {
    "reach": 5.11,
    "eat": 2.82,
    "eaten": 20
   },
   "v3": {
    "reach": 5.11,
    "eat": 2.82,
    "eaten": 20
   }
  }
 },
 "verdict": {
  "v1": "The most regular step timing (it walks to a clock) and a slightly cheaper update, but its hips judder almost three times as much as version 2's, its worst foot slip is five times bigger and its legs cross nearly twice as often. Once in 20 feedings (two legs) it circled the berry and never reached it.",
  "v2": "The smoothest to look at: the hips glide, a planted foot hardly ever slides, fewer crossed legs and it keeps closer to the path. Its steps come when a foot falls behind, so the timing is a little less even. It costs a little more to draw than version 1 (about 29 ms a creature on the CPU against 26, its body has more pieces) and its update is a little dearer too.",
  "v3": "Version 2's motion seen from above, so it moves just as smoothly, and it is about eight times cheaper to draw because it paints flat shapes instead of ray-marching: five creatures fit in a 60 fps frame (15 ms) on the CPU, where versions 1 and 2 cannot draw even one (26 to 29 ms). Its wider-set feet step less evenly.",
  "pick": "Version 2's motion: it is the smoother one, and the difference you could not quite see is mostly the hips (version 1 jitters) and the odd sliding foot. Draw it the version 3 way whenever more than one or two creatures are on screen, because drawing, not moving, is what costs. Keep version 1 only if a clock-steady gait matters more than how smooth it looks."
 },
 "caveats": [
  "Cost is headless Chrome with the GPU off: every canvas is drawn on the CPU, the same for all three, and slower than a real window.",
  "Versions 1 and 2 ray-march each creature into a small sprite every frame, which is most of their drawing time; version 3 draws flat shapes.",
  "All three are timed with their shadow on. Here versions 1 and 2 both use version 1's cast shadow; version 2's own page lights its shadow differently (light.js), which is not timed.",
  "The timer in a file:// page is rounded to 0.1 ms, so update times under that are averages of many rounded readings.",
  "Smoothness and eating numbers are the same on every machine (a fixed 1/60 s step); cost numbers are this machine only.",
  "The berry and the Feed button are a prototype tool for comparing eating, not part of the game."
 ]
};
