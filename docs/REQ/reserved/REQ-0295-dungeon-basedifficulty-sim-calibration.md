# REQ-0295 - Dungeon baseDifficulty: sim-calibrated self-normalisation

**Status:** todo (user-directed 2026-07-23: derive from sim statistics, no hand-tuned feel)
**Depends on:** REQ-0293 (engine + baseDifficulty), REQ-0294 (g=1.1 activation).

## Problem
With g=1.1 live and baseDifficulty = levelMin (1/4/8), the same reference troop wipes at
very different attackLv per dungeon (grave/beast at ~20, niflheim at ~27) -- draws are NOT
self-normalised. The authored rosters are not on the 1.1 ladder by baseDifficulty.

## Method (data-driven, no "feel")
tools/calibrate_base_difficulty.cjs: run ONE fixed reference troop (content/live/
scenario.json x4) through a boss-less arena of each dungeon's packPool at a sweep of
effLevel, N=6 encounters, 24 deterministic seeds; measure win rate. The "cliff" = the
effLevel where the troop starts losing (win rate < 0.5), by binary search. Below the
cliff every dungeon is a 100% win, so equalising the cliffs makes the WIN/LOSS outcome
identical across draws at EVERY attackLv. baseDifficulty_d = anchorBase + (cliff_anchor -
cliff_d), anchor = easiest dungeon (max cliff) kept at baseDifficulty 1. Deterministic and
reproducible (fixed seeds); reference troop is the standard sim scenario (calibration is
relative to it, by user direction "same troop").

## Result (tool output, reproducible)
    niflheim_depths  cliff 26.5  base 1 -> 1   (anchor)
    grave_hollows    cliff 12.6  base 4 -> 15
    beastreach_wilds cliff 11.3  base 8 -> 16
All three then wipe at attackLv ~27.5.

## Validation (win rate vs attackLv, 24 seeds)
CALIBRATED 1/15/16 -- transition together:
    attackLv          8    15   20   24   27   28   31
    niflheim (1)    1.00 1.00 1.00 1.00 0.71 0.25 0.13
    grave    (15)   1.00 1.00 1.00 1.00 0.79 0.29 0.00
    beast    (16)   1.00 1.00 1.00 1.00 0.63 0.04 0.00
CURRENT 1/4/8 -- grave/beast collapse 7 levels early:
    grave    (4)    1.00 1.00 0.00 0.00 0.00 0.00 0.00
    beast    (8)    1.00 1.00 0.00 0.00 0.00 0.00 0.00

## Changes
- tools/calibrate_base_difficulty.cjs (new; the reproducible derivation).
- content/live/dungeon/dungeons.json + batch-002 source: baseDifficulty niflheim 1,
  grave 4->15, beast 8->16 (byte-identical batch<->live; registry sha256 updated).

## Behaviour / scope
- Inert to the roller (baseDifficulty is not read by dungeon_roll.cjs) and to goldens
  (no scaling profile) and api_test (test_dungeon, effLevel 0). Only runs.cjs effLevel
  changes for LIVE dives: grave/beast now stay at authored strength until attackLv > 15/16
  and share niflheim's wipe-attackLv. This is a real (intended) live rebalance: grave/beast
  become pushable as far as niflheim instead of collapsing 7 levels early.
- Reference-troop-relative by construction; re-run the tool if the canonical troop changes.

## Acceptance
- goldens byte-identical; sim suite green; coverage green; dungeon_roll green; api_test 194/0.
- REQ-0122 lossless green after the dungeons.json content is deployed to the main checkout.

## Gate results / commit hashes
_(filled on build)_
