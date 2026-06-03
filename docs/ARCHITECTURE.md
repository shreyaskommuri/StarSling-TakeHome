# Architecture

## Overview

This is a closed-loop optimization system that plays Battleship against a competition server, measures its own performance, and improves across attempts.

The Battleship game is the environment. The interesting engineering is:
- How the system collects feedback
- How it evaluates itself  
- How it supports experimentation
- How it improves over time

---

## File Structure

```
src/
  index.ts              Entry point. Arg parsing. Strategy selection. Logger init.
  auth.ts               Agent Auth Protocol: KVStorage-backed keypair + JWT minting.
  client.ts             Typed HTTP wrapper. Correct Content-Type rules enforced here.
  types.ts              All domain types + observability types + strategy interface.
  placement.ts          Random valid fleet generator + explicit pre-send validator.
  learning.ts           Reads/writes data/history.json for cross-attempt self-improvement.
  logger.ts             Structured JSONL event logger → data/logs/{runId}.jsonl
  metrics.ts            Attempt/game/move metric collection and persistence.
  loop.ts               Game FSM: drives PLACE_SHIPS → SUBMIT_SHOT → GAME_COMPLETED → ...
  strategies/
    interface.ts        (via types.ts) ITargetingStrategy interface
    probability.ts      Probability density targeting — main strategy
    baseline.ts         Random targeting — control arm for experiments
    index.ts            Re-exports all strategies

data/                   (gitignored — runtime only)
  agent.json            KVStorage: agentId + keypair. DO NOT DELETE.
  history.json          Per-opponent shot history for self-improvement.
  metrics.json          Append-only array of AttemptMetric objects.
  logs/                 Per-run JSONL event logs.

docs/
  ARCHITECTURE.md       This file.
  DECISIONS.md          Design decisions and tradeoffs.
  OBSERVABILITY.md      How to read logs and metrics.
  STRATEGY.md           Targeting algorithm deep-dive.
```

---

## Data Flow

```
index.ts
  └─ initAuth()           → data/agent.json (KVStorage)
  └─ runAttempt()
       ├─ createAttempt() → HTTP POST /attempts
       │
       ├─ [PLACE_SHIPS]
       │    ├─ generatePlacements()
       │    ├─ validatePlacements()   ← guard: silent DISQUALIFIED if invalid
       │    └─ placeShips()           → HTTP POST /attempts/current/placements
       │
       ├─ [SUBMIT_SHOT loop]
       │    ├─ getLearnedHits()       → reads data/history.json
       │    ├─ strategy.pickShot()    → ShotDecision {row, col, mode, meta}
       │    ├─ submitShot()           → HTTP POST /attempts/current/shots
       │    └─ logger.log(move)       → data/logs/{runId}.jsonl
       │
       ├─ [GAME_COMPLETED]
       │    ├─ buildGameMetric()
       │    ├─ appendGameRecord()     → data/history.json
       │    └─ follow state.next
       │
       └─ [ATTEMPT_COMPLETED]
            ├─ saveAttemptMetric()   → data/metrics.json
            └─ printAttemptSummary()
```

---

## Component Responsibilities

### auth.ts
- First run: `discoverProvider → connectAgent → save agentId`
- Every run: load agentId → `signJwt` (single-use token per request)
- Uses one shared in-memory `store` object for both SDK internals and our `agentId` key.  
  Critical: two separate `loadStore()` calls would overwrite the SDK's keypair on first run.

### client.ts
- Wraps all 6 API endpoints with correct HTTP semantics.
- Content-Type: application/json ONLY when body is present (empty-body POSTs without CT header requirement).
- Error: HTTP 4xx/5xx → thrown. ATTEMPT_DISQUALIFIED → HTTP 200 (check responseType).

### loop.ts
- FSM that follows server-returned `responseType`.
- Resilient: 409 on create → resume via getCurrentAttempt; 404 on resume → create fresh.
- Seeds `currentMoves` from existing shots when resuming mid-game.
- Saves history at GAME_COMPLETED (not ATTEMPT_COMPLETED) so partial progress survives crashes.

### strategies/probability.ts
- For each unsunk ship, enumerates every valid placement consistent with current misses.
- Weights placements overlapping active hits 4×.
- Fires highest-density untried cell.
- Falls through to history (learned mode) first, then density map.

### learning.ts
- Appends shot records after each game.
- `getLearnedHits(opponentId)` returns confirmed hit cells sorted by frequency.
- Opponents are deterministic → converges on exact layout in 2–3 attempts.

### logger.ts
- One JSONL file per run: `data/logs/{runId}.jsonl`.
- Each line is a typed JSON event: attempt_start, game_start, ships_placed, move, game_end, attempt_end, error.

### metrics.ts
- Three levels: MoveMetric (per-shot), GameMetric (per-game), AttemptMetric (per-attempt).
- Persisted to `data/metrics.json` as append-only array.
- `printAttemptSummary()` shows per-game accuracy bar chart on completion.

---

## Resilience Design

| Failure | Recovery |
|---------|---------|
| Process crash mid-shot | Resume via getCurrentAttempt on next run |
| 409 ACTIVE_ATTEMPT_EXISTS | getCurrentAttempt → continue FSM |
| 404 on resume (attempt expired) | createAttempt → fresh start |
| Invalid fleet (code bug) | validatePlacements() throws before HTTP call |
| All cells tried (impossible in valid game) | Throw with clear error message |
