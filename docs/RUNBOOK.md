# Runbook

Operational guide for running, monitoring, and iterating on the agent.

---

## First Run

```bash
npm install
npx tsx src/index.ts
```

**What happens:**
1. Auth: `discoverProvider → connectAgent` — triggers device flow (browser approval may be required)
2. `data/agent.json` is written with agentId + keypair — **do not delete this file**
3. Attempt starts: 15 games (5 SCOUT + 10 WARSHIP)
4. Shot history saved to `data/history.json` after each game
5. Attempt metrics saved to `data/metrics.json` at completion
6. Summary printed to console

---

## Subsequent Runs

```bash
npx tsx src/index.ts
```

Same command. Auth loads existing agentId from `data/agent.json`. Shots begin immediately. Learning kicks in: `getLearnedHits()` returns cells from prior attempts that were confirmed hits — fired first before density targeting.

---

## Common Commands

```bash
# Play one attempt (default config: targeted_defense_v1)
npx tsx src/index.ts

# Play with baseline strategy (control arm for comparison)
npx tsx src/index.ts --strategy=baseline

# View all attempt metrics
npx tsx src/index.ts --stats

# Abandon active attempt (e.g. after a crash)
npx tsx src/index.ts --abandon

# Print competition rules
npx tsx src/index.ts --rules
```

---

## Recovery Scenarios

### "409 ACTIVE_ATTEMPT_EXISTS"
The agent auto-resumes. You don't need to do anything — loop.ts calls getCurrentAttempt and continues.

### Stuck / want fresh start
```bash
npx tsx src/index.ts --abandon
npx tsx src/index.ts
```

### Agent lost (data/agent.json deleted)
Re-registration required. Run `npx tsx src/index.ts` — it will run the device flow again.  
⚠️ This creates a NEW agentId. The old agentId is orphaned on the server.

### Process crashed mid-attempt
Just run `npx tsx src/index.ts` again. It detects the active attempt and resumes from where it left off.

---

## Monitoring a Run

Console output per move:
```
  [ 1] (3,5) HIT  [hunt]
  [ 2] (3,6) HIT  [target]
  [ 3] (3,7) SUNK [target]
  ...
```

Format: `[shot#] (row,col) OUTCOME [mode]`

Per-game summary on GAME_COMPLETED:
```
  Game 1 vs scout_1: 23 shots, 43% accuracy, 5 sunk
```

Full summary at ATTEMPT_COMPLETED (see OBSERVABILITY.md).

---

## Analyzing Results

```bash
# Quick cross-attempt summary
npx tsx src/index.ts --stats

# Deep dive on a specific run
cat data/logs/2024-01-15T10-30-45.jsonl | jq 'select(.type=="move")' | head -20

# Compare strategy performance
cat data/metrics.json | jq '.[] | {strategy, score: .finalScore, avgShots: .avgShotsPerGame}'

# Track improvement across attempts (are learned shots increasing?)
cat data/logs/*.jsonl | jq 'select(.type=="move") | .mode' | sort | uniq -c
```

---

## Iteration Loop

```
1. Run attempt
2. npx tsx src/index.ts --stats
3. Check: avgShotsPerGame, avgAccuracy, worstGame
4. If improvement possible:
   - Add/modify strategy in src/strategies/
   - Re-run and compare metrics
5. If opponent layouts are fully learned (all shots in "learned" mode):
   - Score should be near-optimal
   - Focus on minimizing your own ships sunk (placement diversity)
```

---

## File Inventory

| File | Safe to delete? |
|------|----------------|
| `data/agent.json` | ❌ Never — forces re-registration |
| `data/history.json` | ⚠️ Deleting resets learned opponent layouts |
| `data/metrics.json` | ✅ Only historical records |
| `data/logs/` | ✅ Only historical logs |
| `node_modules/` | ✅ Restored by `npm install` |
