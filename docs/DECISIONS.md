# Design Decisions

Each decision here follows the format: **Decision → Reason → Tradeoffs → Future**

---

## Auth: Single shared `store` object in initAuth()

**Decision**: One `store` object is loaded from disk and shared between the KVStorage closure and our manual `agentId` tracking.

**Reason**: On first run, `connectAgent` writes the agent keypair into the KVStorage (which calls `kv.set()`). If we then call `loadStore()` again into a second variable and `saveStore()` that, we overwrite the keypair. The second run would have an `agentId` but no keypair → `signJwt` fails → every request fails.

**Tradeoff**: Slightly less obvious that `store` is shared. Mitigated by the comment in auth.ts.

**Future**: Could use `agent.listAgentConnections()` to detect existing registration instead of manual `agentId` tracking.

---

## Strategy Pattern (ITargetingStrategy)

**Decision**: Targeting is an interface with swappable implementations. Two strategies exist: `ProbabilityStrategy` and `BaselineStrategy`.

**Reason**: "I want to run experiments rather than rewrite the system." (Engineering principles). `--strategy=baseline` runs the control arm; `--strategy=probability` runs the optimized arm. Compare with `--stats`.

**Tradeoff**: Slight indirection vs. hardcoded targeting function. Pays for itself on first experiment.

**Future**: Add `MonteCarloStrategy` (samples random full-fleet arrangements instead of per-ship enumeration — more accurate, slower). Add `HeatMapStrategy` (uses historical opponent data to build a prior).

---

## Probability Density with 4× Hit Boost (not classic Hunt/Target)

**Decision**: Build a density map from all unsunk ship placements. Placements overlapping active hits get 4× weight.

**Reason**: Classic hunt/target treats phases separately — it doesn't use misses to narrow down the hunt phase or hits to inform which placement of a ship is most likely. Probability density uses all information simultaneously.

**Tradeoff**: Slightly more complex than hunt/target. More computation per shot (O(ships × board)), but negligible for 10×10.

**Future**: True Monte Carlo (enumerate full-fleet arrangements jointly) accounts for ship interactions (e.g., if carrier must be vertical in column 3 because of misses, that constrains where BATTLESHIP can be). Current approach is per-ship independent. Monte Carlo would improve targeting by ~5-10%.

---

## History Saved at GAME_COMPLETED (not ATTEMPT_COMPLETED)

**Decision**: Call `appendGameRecord()` inside the `GAME_COMPLETED` handler, not at the end of the attempt.

**Reason**: If the process crashes mid-attempt, we lose all history from that attempt's completed games if we only save at ATTEMPT_COMPLETED. Saving at GAME_COMPLETED makes history durable incrementally.

**Tradeoff**: History is written more frequently (15 writes per attempt vs 1). Each write is a full file rewrite (read → append → write). Acceptable for 15 games.

**Future**: Use append-only JSONL for history.json (like logs) to avoid full-file rewrites.

---

## JSONL Logging to data/logs/

**Decision**: One `.jsonl` file per run, append-only, one JSON object per line.

**Reason**: JSONL is grep-able, streamable, and trivially parseable. `cat data/logs/*.jsonl | jq 'select(.type=="move" and .outcome=="MISS")'` — no special tooling needed.

**Tradeoff**: No structured query interface (no DB). Fine for offline analysis of a single competition run.

**Future**: Feed into a SQLite DB or a simple analysis script for cross-attempt querying.

---

## validatePlacements() Called Before Every placeShips()

**Decision**: Explicit validator asserts bounds, no overlaps, all 5 ships — throws before the HTTP call.

**Reason**: AGENT.md calls this out: "illegal fleet = instant ATTEMPT_DISQUALIFIED (HTTP 200, not 4xx)". A silently disqualified attempt wastes the run and produces no useful metrics. Better to crash loudly.

**Tradeoff**: `generatePlacements()` already produces valid fleets by construction. The validator is redundant in the happy path. But it's a cheap safety net for future changes to placement logic.

---

## Metrics Written at Attempt-End, Logs Written Per-Move

**Decision**: `data/metrics.json` is updated once per attempt (at the end). `data/logs/*.jsonl` is written per event.

**Reason**: Metrics are for cross-attempt comparison — no value in partial attempts. Logs need to be durable mid-attempt so you can audit a crashed run.

**Tradeoff**: A crashed attempt produces a log file but no metrics entry. You can still reconstruct metrics from the log if needed.

---

## --stats Skips Auth

**Decision**: `npx tsx src/index.ts --stats` reads `data/metrics.json` locally without calling `initAuth()`.

**Reason**: Reading local files doesn't need a network round-trip or token minting. Faster, and works offline.

**Tradeoff**: Slightly asymmetric command structure. Minor.
