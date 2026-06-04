# Battleship Agent — Development Log (Session 2026-06-03)

## What This Is

A self-improving Battleship agent for the StarSling take-home challenge.
- Plays 15 games per attempt against a competition server
- Score depends heavily on wins / own ships lost, plus hits and sink bonuses
- Max score: 1000 (win all 15 games, minimum shots)
- Highest observed score: **771/1000**

---

## Score Progression

| Attempt | Score | Shots | Ships Sunk | Notes |
|---------|-------|-------|------------|-------|
| 1 | 279 | 609 | 90 | Buggy (phantom-hits bug, corrupt history) |
| 2 | 113 | 641 | 48 | Corrupt learning data from attempt 1 |
| 3 | 387 | 513 | 54 | First good run (currentMoves fix) |
| 4 | 322 | 557 | 56 | Random opponents had different layouts |
| 5 | 281 | 486 | 48 | Bad abandonment threshold |
| 6 | 406 | 518 | 56 | freq≥2 learning filter |
| 7 | 349 | 503 | 52 | Variance from random opponents |
| 8 | 429 | 532 | 56+ | **Best with last-2 filter** |
| 9 | 310 | 559 | 52 | Wrong "last record" approach broke |
| 10 | **519** | 527 | 56+ | Restored freq≥2 + opening-miss abandonment |
| 11 | 420 | 586 | 57 | Game-15 fix worked; learned mode overfit noisy history |
| 12 | 605 | 540 | 58 | Reliability-gated learning + connected-component targeting |
| 13 | 692 | 599 | 60 | Defensive placement active; best score despite more shots |
| 14 | **708** | 573 | 74 | Survival/scoring fields active: 14W-1L, 29 own ships lost |
| 15 | **713** | 585 | 75 | Parity-restored final mode: 15W-0L, 30 own ships lost |
| 16 | **755** | 569 | 75 | First `targeted_defense_v1` high-water run: 15W-0L, 25 own ships lost |
| 17 | 561 | 604 | 71 | `targeted_defense_v1` volatility check; not stable |
| 18 | **771** | 560 | 75 | Final highest observed run: 15W-0L, 23 own ships lost |

---

## What Was Built

### Server Wire Format Fix (`src/client.ts`)

The server wraps all game state under a `state` key, uses different field names:
- `state.opponent.opponentId` (not `opponentId`)
- `state.sunkOpponentShipClasses[]` (not `opponentShips`)
- Shot outcome `"SINK"` (not `"SUNK"`)
- `ATTEMPT_COMPLETED.result.finalScore` (not `state.finalScore`)
- `ATTEMPT_DISQUALIFIED.reason` (top-level, not in `state`)

Added `normalizeResponse()` as a translation layer so the rest of the code works with clean internal types.

### Phantom Hits Bug (`src/loop.ts`)

**Root cause**: The server returns `yourShots` in newest-first order (or some non-sequential order), so indexing `yourShots[last]` always pointed to the first/oldest shot (always a MISS early on).

**Effect**: Strategy saw HITs via `.filter()` (correct), but display/metrics read from `yourShots[last]` (wrong MISS). This triggered target mode with 0% recorded accuracy. Game 6 in attempt 1 showed "36 sunk" (impossible).

**Fix**: Changed loop to:
1. Build `currentMoves` one-by-one as shots are fired
2. Pass `currentMoves` to strategy (not `state.yourShots`)
3. Read shot outcome via `.find(s => s.row === r && s.col === c)` (not by index)

### Probability Density Strategy (`src/strategies/probability.ts`)

Enumerate all valid placements of each remaining (unsunk) ship given current misses.
Build `density[r][c]` = count of placements that include (r,c). Shoot highest-density untried cell.

Key improvements:
- **Parity hunt mode**: checkerboard pattern `(r+c)%2===0` in hunt mode guarantees hitting any ship of length ≥2 while scanning only ~50 cells. Expected shots reduced from ~66 to ~42.
- **Hit boost**: placements overlapping k active hits get `4k×` weight. Two collinear hits get 8× — correctly amplifies orientation info.
- **Sunk cell exclusion**: after SINK, identify one plausible ship segment, using `shipClass` length when available. Exclude it from `activeHits` and `excludedCells` without absorbing adjacent live ships.
- **Connected-component targeting**: unresolved HITs are split into adjacent components; target mode focuses one component at a time instead of merging separated hits through misses.
- **Active hits check before learned**: if there are unsunk hits, finish the ship first — don't fire learned cells mid-ship.

### Self-Improvement / Learning (`src/learning.ts`)

Opponents have one of:
1. **Deterministic** layout (same every attempt): `hydra-probe`, `eridanus-drone`, `andromeda-cruiser`, `betelgeuse-berserker`
2. **Cycling** layout (2-3 preset layouts rotating): `rigel-reaver`, `pleiades-skimmer`, `vega-marauder`, `cygnus-stalker`
3. **Fully random** layout (different every attempt): most others

**Key insight**: deduplicating `data/history.json` by shot-sequence was wrong — same layout can produce different shot sequences across attempts. Instead:

- Store game records and skip only exact duplicates
- Group hit sets into exact layout fingerprints
- Prefer repeated layout fingerprints when they recur enough
- Otherwise fire only high-confidence frequent cells (`max(3, ceil(recordCount * 0.5))`)

**Opening-miss abandonment**: if the first 6 consecutive learned-cell shots all miss, the opponent has a different layout this game. Stop firing learned cells, switch to hunt mode. This is checked only over the OPENING run of shots (not total learned shots fired) to avoid false positives when hunt-mode cells accidentally overlap with the learned list.

**Underperformance abandonment**: if 8 learned-position shots have been tried and fewer than 35% hit, stop using learned cells for the rest of that game. This fixed attempt 11's noisy learned-shot overfire.

### Defensive Placement (`src/placement.ts`)

The loop now saves incoming opponent shots into `history.json`. Placement samples legal layouts and picks the lowest-danger one using per-opponent heatmaps when at least 2 incoming records exist, otherwise global incoming-shot heatmaps.

Evidence:
- Attempt 12: score 605 with 540 shots after incoming-shot capture started.
- Attempt 13: score 692 with 599 shots. More shots but better score, indicating own-ship survival / win bonuses matter more than raw shot minimization.

### History Data Integrity

Issue: `appendGameRecord` wrote duplicate records when an attempt ran twice or reconnected. Fixed by inspecting `data/history.json` and removing duplicates.

After dedup by shot-sequence: 78 records (down from 98).
Note: this removed the repeated-layout evidence. Going forward, new records accumulate without dedup.

### Metrics / Observability

Every attempt logs:
- `data/metrics.json` — per-attempt summary (score, shots, accuracy, ships sunk, wins/losses, own ships lost when returned by the server)
- `data/logs/{timestamp}.jsonl` — per-shot events with mode, meta, outcome
- Console output — per-game live shot stream

Modes labelled in output: `[learned]`, `[target]`, `[hunt]`, `[resumed]`.

---

## Current Code Structure

```
src/
  index.ts          Entry point — run attempt or show stats
  auth.ts           OAuth device flow + JWT signing (single-use tokens)
  client.ts         HTTP wrapper with wire-format normalization
  loop.ts           Game FSM: PLACE_SHIPS → SUBMIT_SHOT → GAME_COMPLETED → repeat
  placement.ts      Defensive/random valid fleet layout
  strategies/
    probability.ts  Probability density targeting (current strategy)
  learning.ts       Layout-aware learned cells + incoming-shot history
  metrics.ts        AttemptMetric / GameMetric / MoveMetric building and persistence
  logger.ts         JSONL event logger
  types.ts          All TypeScript types

data/
  agent.json        OAuth keypair + agentId (gitignored, DO NOT DELETE)
  history.json      Shot history for learning (gitignored)
  metrics.json      Attempt scores over time (gitignored)
  logs/             Per-attempt JSONL event logs (gitignored)
```

---

## Key Numbers

- **Old score approximation**: `≈ 19 × ships_sunk - 1.27 × total_shots`; useful but incomplete because own-ship losses and wins matter.
- **Perfect score** (1000) requires: sink all 75 ships across 15 games in ≤335 shots total (~22 shots/game)
- **Deterministic opponents**: sink in 21-27 shots (hydra-probe, eridanus-drone, andromeda-cruiser are near-optimal)
- **Random opponents**: need 35-60 shots (pure hunt mode after learned cells miss)
- **Game ends when opponent sinks all agent ships**, not necessarily when agent sinks all opponent ships — the race condition explains why many games end at "4 sunk" instead of 5
- **Latest scoring evidence**: the final high-water run scored 771 with 560 shots, 15W-0L, 75 opponent ships sunk, and 23 own ships lost. The server returns survival/scoring fields at attempt scope; per-game terminal responses have not exposed per-game win/loss/lost fields so far.

### 2026-06-03 Targeted 750+ Pass

Baseline before this pass:
- 708/1000, 14W-1L, 74/75 opponent ships sunk, 29 own ships lost, 573 shots.

Run log:
- Step 1, per-opponent report only: 637, 13W-2L, 73 sunk, 35 lost, 590 shots. Report identified `sirius-dreadnought` as the likely loss and listed visible 4-sink games.
- Step 2, first late-game final-ship mode: 611, 12W-3L, 71 sunk, 33 lost, 557 shots. Too much broad final searching.
- Step 2, final mode with high-confidence learned exception: 668, 13W-2L, 73 sunk, 31 lost, 584 shots.
- Step 2, final mode with parity restored for no-active-hit search: 713, 15W-0L, 75 sunk, 30 lost, 585 shots. Best result from this pass so far; wins reached 15/15, own losses still one above target.
- Step 3, early-shot weighted defensive placement: 535, 10W-5L, 69 sunk, 38 lost, 598 shots. Overfit incoming-shot heatmaps badly.
- Step 4, spacing penalties added: 650, 14W-1L, 74 sunk, 36 lost, 625 shots. Spacing helped but placement remained harmful.
- Step 5, conservative learned thresholds: 635, 13W-2L, 72 sunk, 34 lost, 598 shots. Learned mode became safer, but placement/final misses still dominated.
- Placement weight damped: 605, 12W-3L, 72 sunk, 35 lost, 587 shots. Still harmful.
- Placement made light tie-breaker + final-history hints: 566, 13W-2L, 73 sunk, 41 lost, 608 shots. Final-history hints were too noisy; remove this path.
- Final-history hints removed; placement guarded behind 25 opponent incoming-shot records: 407, 10W-5L, 68 sunk, 49 lost, 535 shots. Fewer shots did not help because own ships lost exploded. Restore prior placement behavior.
- Restored prior placement behavior: 676, 13W-2L, 73 sunk, 31 lost, 593 shots. Survival recovered, but incomplete-hit games remained (`sirius-dreadnought` 14 hits, `centauri-battlecruiser` 15 hits).
- Moderately conservative learned thresholds (`max(3, ceil(records*0.55))`, repeated layout `>=3` and `>=50%`): 707, 14W-1L, 74 sunk, 29 lost, 563 shots. Likely loss was `vega-marauder` with 14 hits; Vega has no reliable learned layout and only weak final history (`9,1` appears 3/26), so do not add Vega-specific learned shots.
- Stability rerun of moderate learned thresholds: 651, 14W-1L, 74 sunk, 36 lost, 610 shots. Regression confirms `stable_713` should preserve the stricter learned settings from the 713 run.
- Config system added with `stable_713`, `targeted_defense_v1`, `cycle_predict_v1`, `--compare-configs`, and `--risk-report`.
- `stable_713` eval run 1: 698, 15W-0L, 75 sunk, 32 lost, 625 shots. Preserved wins/sinks but did not improve own ships lost.
- `stable_713` eval run 2: 604, 12W-3L, 72 sunk, 35 lost, 559 shots. Not promotable; kept only as named rollback for the known 713 settings.
- `targeted_defense_v1` eval run 1: 634, 13W-2L, 73 sunk, 34 lost, 588 shots. Not promotable after run 1 because wins dropped below 15.
- `targeted_defense_v1` eval run 2: 755, 15W-0L, 75 sunk, 25 lost, 569 shots. Highest fresh run so far; build small variants from this profile under the 30-minute constraint.
- `targeted_defense_v2` quick run: 630, 13W-2L, 73 sunk, 36 lost, 625 shots. Lower danger/spacing was worse; do not promote.
- `targeted_defense_v3` quick run: 717, 14W-1L, 74 sunk, 28 lost, 566 shots. Extra placement samples reduced losses but did not preserve 15W-0L; do not promote.
- `targeted_defense_cycle_v1` quick run: 689, 14W-1L, 74 sunk, 30 lost, 588 shots. High-confidence cycle prediction changed too many openings; do not promote.
- `targeted_defense_safe` quick run: 605, 11W-4L, 71 sunk, 34 lost, 592 shots. Failed promotion gate; keep `stable_713` or `targeted_defense_v1` as final candidates.
- `targeted_defense_v1` rerun: 561, 11W-4L, 71 sunk, 38 lost, 604 shots. Confirmed the 755 run was a high-water observation at the time, not a stable average; do not promote variants over rollback rules.
- `targeted_defense_quick_abandon` research probe: 694, 13W-2L, 72 sunk, 27 lost, 560 shots. Opening-miss abandonment saved shots and lowered own losses, but it lost too many games/sinks; reject as final.
- Post-submit upside reroll with `targeted_defense_v1`: 771, 15W-0L, 75 sunk, 23 lost, 560 shots. New highest observed run; best-attempt report shows no likely loss and no incomplete-hit games.
- Final reroll attempt could not start: server returned `GAMEPLAY_WINDOW_CLOSED`. Treat 771 as the final usable high-water result.

Current conclusion:
- Keep the per-opponent report and the parity-restored final-ship mode.
- Keep learned mode conservative enough to abandon noisy history.
- Do not let defensive placement dominate. Existing evidence says aggressive early-shot heatmaps increase own ships lost.
- The final audit found no consistently stable score fix, but an additional `targeted_defense_v1` reroll improved the high-water score from 755 to 771. The main variance source remains noisy learned openings on high-risk opponents, especially Vega/Sirius/Tau/Centauri/Cygnus; cycle fingerprints are too weak to rely on, and defensive placement variants reduce stability.
- Per-game `won` / `yourShipsLost` fields are included in metrics/report when returned by the server, but current terminal payloads still show `?`.

Final wrap-up:
- Highest observed score: 771/1000.
- Config: `targeted_defense_v1`.
- Result: 15W-0L, 75/75 opponent ships sunk, 23 own ships lost, 560 shots.
- Best-attempt report: no likely loss and no incomplete-hit games.
- Caveat: this is the final usable high-water result, not a stability guarantee; the gameplay window closed before another reroll could start.

---

## What Could Improve Score Further

1. **Optimize defensive placement by score fields** — wins/losses and own ships lost are now recorded at attempt scope. Run multiple attempts and compare placement heatmaps against `agentShipsLost`, not just shot count.

2. **Track missed learned cells** — after learning misses, note which layout is ACTIVE this game (by what the hunt found), store that as a separate "current layout guess" for the NEXT attempt.

3. **Per-layout frequency** — instead of raw cell frequency, group records by hit-position set (layout fingerprint), count layout recurrence, predict which layout is coming next in the cycle.

4. **More attempts** — each run adds confirmed-hit cells. After 10+ attempts, deterministic opponents' full layouts are known. Cycling opponents' cycle patterns become clearer.

5. **Fix / exploit the 5th ship race** — many games still end at 4 sunk. Defensive placement helps survival; next improvement is using incoming-shot history to protect the most frequently lost ships/cells directly.

---

## Commands

```bash
npx tsx src/index.ts              # Play one attempt
npx tsx src/index.ts --stats      # Print all attempt scores
npx tsx src/index.ts --placement-stats --opponent=hydra-probe
npx tsx src/index.ts --abandon    # Abandon active attempt
```

---

## Competition Details

- **Server**: `https://intern-battleship-game-server.vercel.app`
- **Docs**: `https://challenge.starsling.dev/docs`
- **Competition ID**: `OMITTED_COMPETITION_ID`
- **Agent ID**: `OMITTED_AGENT_ID` (in `data/agent.json`)
- **15 games per attempt**, opponents: hydra-probe, lyra-skiff, orion-scout, eridanus-drone, pleiades-skimmer, cygnus-stalker, vega-marauder, andromeda-cruiser, tau-ceti-phantom, rigel-reaver, antares-predator, betelgeuse-berserker, polaris-warship, sirius-dreadnought, centauri-battlecruiser
