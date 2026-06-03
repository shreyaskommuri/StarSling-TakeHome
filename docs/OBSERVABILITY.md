# Observability

The system generates three types of structured data automatically during every run.

---

## 1. Per-Run JSONL Logs (`data/logs/{runId}.jsonl`)

Every run creates a new log file. Each line is a JSON event.

### Event types

| Type | When | Key fields |
|------|------|-----------|
| `attempt_start` | Run begins | `runId`, `strategy` |
| `game_start` | New game begins | `opponentId`, `gameOrdinal` |
| `ships_placed` | Fleet submitted | `gameOrdinal` |
| `move` | Shot fired | `row`, `col`, `outcome`, `mode`, `meta` |
| `game_end` | Game finished | `totalShots`, `hits`, `accuracy`, `shipsSunk`, `durationMs` |
| `attempt_end` | Attempt finished | `finalScore`, `outcome`, `gamesCompleted`, `totalShots` |
| `error` | Unexpected state | `message`, `context` |

### Useful queries

```bash
# All moves in order
cat data/logs/2024-01-15T10-30-45.jsonl | jq 'select(.type=="move")'

# Accuracy per game
cat data/logs/*.jsonl | jq 'select(.type=="game_end") | {opp: .opponentId, acc: .accuracy, shots: .totalShots}'

# All misses
cat data/logs/*.jsonl | jq 'select(.type=="move" and .outcome=="MISS") | {row, col}'

# Moves broken down by mode
cat data/logs/*.jsonl | jq 'select(.type=="move") | .mode' | sort | uniq -c

# Final score from each run
cat data/logs/*.jsonl | jq 'select(.type=="attempt_end") | {score: .finalScore, outcome}'
```

### Move mode breakdown

`mode` answers "how did the strategy choose this cell?":
- `learned` — fired from prior-attempt history (highest confidence)
- `target` — active unsunk hit on board; density focused around it
- `hunt` — no active hits; pure placement probability
- `resumed` — shot was already on board when we reconnected mid-game

A high ratio of `learned` shots in attempt 2+ indicates the self-improvement loop is working.

---

## 2. Cross-Attempt Metrics (`data/metrics.json`)

Append-only array of `AttemptMetric` objects. Read with:

```bash
npx ts-node src/index.ts --stats
```

Each entry:
```json
{
  "id": "2024-01-15T10-30-45",
  "timestamp": "2024-01-15T10:30:45.123Z",
  "strategy": "probability_density",
  "finalScore": 742,
  "outcome": "completed",
  "gamesCompleted": 15,
  "totalShots": 487,
  "avgShotsPerGame": 32.5,
  "avgAccuracy": 0.354,
  "bestGame": { "opponentId": "scout_1", "shots": 17 },
  "worstGame": { "opponentId": "warship_9", "shots": 58 },
  "durationMs": 94221,
  "games": [...]
}
```

### Key metrics to watch

| Metric | What it tells you |
|--------|-----------------|
| `avgShotsPerGame` | Overall efficiency. Lower = better. Optimal ≈ 17. |
| `avgAccuracy` | Hits per shot. Higher = better. |
| `bestGame.shots` | Best case — how close to optimal (17)? |
| `finalScore` | Ultimate measure. Compare across attempts and strategies. |

### Comparing strategies

```bash
# After running both: npx ts-node src/index.ts --stats
# Look for strategy= field per line
```

Or read metrics.json directly:
```bash
cat data/metrics.json | jq '.[] | {strategy, score: .finalScore, avg: .avgShotsPerGame}'
```

---

## 3. Attempt Summary (Console)

After every run, a summary prints automatically:

```
══════════════ ATTEMPT SUMMARY ══════════════
  Strategy     : probability_density
  Outcome      : completed
  Final score  : 742
  Games        : 15
  Total shots  : 487
  Avg shots/game: 32.5
  Avg accuracy : 35.4%
  Best game    : scout_1 (17 shots)
  Worst game   : warship_9 (58 shots)
  Duration     : 94.2s
═════════════════════════════════════════════

  Per-game breakdown:
    [ 1] scout_1      shots= 23 acc= 43% ████░░░░░░ sunk=5
    [ 2] scout_2      shots= 17 acc= 100% ██████████ sunk=5
    ...
```

The `█` bar shows accuracy. A full bar (100%) means every shot hit — possible on attempt 2+ when all cells are learned from history.

---

## Answering "What happened? Why? How often?"

| Question | Where to look |
|----------|--------------|
| Did attempt N work? | `--stats` or metrics.json |
| Why did game X take so many shots? | logs/{runId}.jsonl → move events for that gameOrdinal |
| Is learning improving accuracy? | Compare avgShotsPerGame across attempts 1 → 2 → 3 |
| Which opponent is hardest? | worstGame across all metrics entries |
| Is probability better than baseline? | Run `--strategy=baseline`, compare avgShotsPerGame |
| Did we get disqualified and why? | `outcome` field in metrics + logs |
