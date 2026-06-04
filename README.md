# StarSling Battleship Agent

This project is a self-improving Battleship agent built around closed-loop optimization, observability, and measured iteration. I treated the challenge as an engineering optimization problem: instrument the system, identify the dominant failure mode, make a targeted change, run an attempt, compare metrics, and keep or reject the change based on regression gates.

## Reviewer Guide

- [Results summary](docs/results-summary.md): final score, config, and key insight
- [Architecture](docs/architecture.md): module map and data flow
- [Experiments](docs/experiments.md): promoted and rejected changes
- [Development log](DEVLOG.md): full iteration record, including failed attempts and volatility checks

The highest observed score was **771/1000** with `targeted_defense_v1`:

- **15W-0L**
- **75/75 opponent ships sunk**
- **23 own ships lost**
- **560 shots**

That result was the high-water mark, not a stable guarantee. `targeted_defense_v1` showed the most upside, but it was more volatile on reruns. The safer rollback config was `stable_713`, which produced the strongest stable signal:

- **713/1000**
- **15W-0L**
- **75/75 opponent ships sunk**
- **30 own ships lost**
- **585 shots**

`stable_713` also produced a **698** run with **15W-0L** and **75/75 sunk**, so I kept it as the rollback config while continuing to evaluate higher-upside variants.

## Score Progression

The agent improved from an initial **279/1000** buggy baseline to a **771/1000** highest observed run, with a reliable 700+ configuration.

Key milestones:

- **279**: initial buggy run caused by phantom-hit / shot-order issues
- **519**: after fixing `currentMoves`, restoring frequency-based learning, and adding opening-miss abandonment
- **605**: after reliability-gated learning and connected-component targeting
- **692**: after defensive placement became active
- **708**: after survival/scoring fields were tracked
- **713**: after parity-restored final-ship mode
- **755**: first >750 high-water run with `targeted_defense_v1`
- **771**: final highest observed run with `targeted_defense_v1`

The strongest insight was that this was not purely a shot-minimization problem. Later scoring fields showed that wins and own ships lost mattered heavily, so the optimization objective became:

1. Win all 15 games
2. Sink all 75 opponent ships
3. Reduce own ships lost
4. Reduce wasted shots

## Engineering Process

I split the work the way I would approach a production optimization problem under time pressure:

- First, I stabilized correctness: API normalization, shot ordering, local move tracking, and valid placement generation.
- Then I improved offensive capability with probability-density targeting, parity hunt mode, connected-component targeting, and conservative learning.
- Once wins and survival data were available, I shifted effort toward targeted defensive placement and opponent modeling.
- Finally, I used config-based experiments, per-attempt metrics, and regression gates to decide what to promote or reject.

The research process was intentionally time-boxed and evidence-led. I used the early window to fix correctness and observability, the middle window to improve targeting and learning, and the final window to compare configs and reduce variance. When an idea looked clever but hurt the score, win rate, or own-ship losses, I rejected it instead of trying to rationalize it.

I did not blindly promote every high-scoring experiment. The 755 and 771 runs were valuable because they showed upside, but reruns exposed volatility. That led to a careful distinction between the highest observed configuration and the safer rollback profile.

## Product Takeaway for StarSling

I also looked at StarSling's public positioning while preparing the final deliverables. StarSling describes itself as self-driving CI: faster GitHub Actions runners plus AI agents that analyze workflows, run logs, and telemetry, then open optimization PRs for caching, dependency installs, build steps, tests, and workflow structure.

This challenge surfaced a product lesson that seems directly relevant to that mission: autonomous engineering agents should not only optimize for success; they should optimize for trustworthy improvement.

The Battleship agent had several high-upside strategies, but some were volatile. `targeted_defense_v1` produced the highest observed score, while `stable_713` remained the safer rollback. The strongest workflow was not "make the cleverest change." It was:

1. Measure the current behavior.
2. Change one thing.
3. Compare against a rollback profile.
4. Check reliability, variance, and secondary metrics.
5. Promote only when the evidence supports it.

For a self-driving CI product, the same pattern suggests high-value reviewer and user-facing features:

- Regression gates before promoting an autonomous fix.
- Confidence scores before editing workflow files, changing dependencies, or opening PRs.
- Last-known-good rollback states for workflows, dependency sets, and agent policies.
- Observability traces that explain what failed, what the agent inspected, what it changed, and what validated the fix.
- Memory of rejected fix attempts so the agent does not repeat strategies that already failed.
- Multi-run validation for flaky or high-variance CI failures.

I would frame this as an opportunity rather than a critique: StarSling already targets the right problem space, and this project reinforced how important promotion criteria, rollback safety, and explainability become once agents are allowed to improve engineering systems on their own.

## How To Run

Create an ignored `.env` file with the competition id:

```bash
COMPETITION_ID=...
```

Then install and run:

```bash
npm install
npx tsx src/index.ts
```

Useful local-only commands:

```bash
npx tsx src/index.ts --stats
npx tsx src/index.ts --report=best
npx tsx src/index.ts --configs
npx tsx src/index.ts --config=stable_713
```

## Architecture

The repo is organized around focused modules:

- `auth.ts`: OAuth device flow and single-use JWT signing
- `client.ts`: API wrapper and server response normalization
- `loop.ts`: game FSM for `PLACE_SHIPS`, `SUBMIT_SHOT`, `GAME_COMPLETED`, and `ATTEMPT_COMPLETED`
- `placement.ts`: random and defensive valid fleet placement
- `strategies/probability.ts`: probability-density targeting
- `learning.ts`: opponent-specific learning and layout-aware history
- `metrics.ts`: attempt, game, and move metrics
- `logger.ts`: JSONL event logging
- `types.ts`: shared TypeScript types

## Key Technical Work

### Server Wire-Format Normalization

The server wrapped game state under `state` and used different field names than the local model. I normalized fields such as `opponentId`, sunk ship classes, shot outcomes, `finalScore`, and disqualification reasons so the rest of the agent could operate on stable internal types.

### Phantom-Hit / Shot-Order Bug Fix

A major early issue was caused by assuming the server returned `yourShots` in sequential order. It did not always do that. The old code read the last array element and could assign the wrong outcome to the shot just fired.

I fixed this by maintaining `currentMoves` locally and matching shot outcomes by `row` and `col`. This removed phantom hits, corrected learning data, and made metrics trustworthy.

### Probability-Density Targeting

The core strategy enumerates legal placements for remaining ships, builds a density map over unknown cells, and fires at the highest-probability cell. It uses parity hunt mode to reduce the search space and hit/collinearity boosts to finish discovered ships faster.

### Connected-Component Targeting

Unresolved hits are split into adjacent components so target mode focuses on one plausible ship at a time. This avoids merging disconnected hits and prevents the agent from chasing impossible ship lines through known misses.

### Sunk-Cell Exclusion

After a `SINK`, the agent identifies the plausible sunk segment using the ship class length when available. Those cells are removed from active hit tracking so already-sunk ships do not pollute remaining-ship density.

### Conservative Learning

The agent stores historical game records and uses layout fingerprints built from hit sets. It uses high-confidence frequent cells, but includes opening-miss abandonment and underperformance abandonment so noisy history does not dominate the current game.

This conservative learning mattered because many opponents had multiple layouts or weak layout cycles. Overfitting to history could produce fast wins in one run and regress badly in another.

### Targeted Defensive Placement

The agent records incoming opponent shots and builds danger maps from early firing behavior. It samples legal fleet layouts and chooses lower-danger placements.

This became important once scoring showed that own ships lost and win preservation mattered more than raw shot count alone.

### Final-Ship Mode

After four opponent ships are sunk, the agent switches into a late-game final-ship mode. Restoring parity in this phase helped produce the `stable_713` run with **15W-0L** and **75/75 ships sunk**.

## Configs

- Default: `targeted_defense_v1`, because it produced the final highest observed score: **771/1000**, **15W-0L**, **75/75 sunk**, **23 own ships lost**, **560 shots**
- `stable_713`: safer rollback config preserving the best stable 15W-0L behavior
- `targeted_defense_v1`: highest observed score config, but more volatile on reruns
- `cycle_predict_v1`: tested but not promoted because cycle confidence was not reliable enough
- Other variants such as `targeted_defense_v2`, `targeted_defense_v3`, and `targeted_defense_safe` were evaluated but not promoted

## Rejected Experiments

Several experiments were intentionally rejected based on data:

- Aggressive early-shot weighted defensive placement overfit and dropped to **535**
- Spacing penalties helped slightly but still underperformed
- Final-history hints were too noisy
- Guarding placement behind too many records caused own ships lost to increase
- Cycle prediction changed too many openings and was not promoted
- `targeted_defense_v2` and `targeted_defense_v3` did not consistently beat `targeted_defense_v1` or the stable rollback
- `targeted_defense_safe` failed promotion criteria

These rejected experiments were useful because they clarified the real optimization boundary: improve survival without sacrificing full completion and 15-game win consistency.

## Observability

The agent logs:

- Final score
- Shots
- Hit rate
- Ships sunk
- Wins/losses when available
- Own ships lost when available
- Per-shot JSONL events
- Mode labels: `learned`, `target`, `hunt`, `final`, `resumed`
- Per-attempt metrics in `data/metrics.json`
- Per-shot logs in `data/logs/*.jsonl`

This observability made it possible to compare configs by score, win rate, own ships lost, opponent ships sunk, shots, and regression risk.

## What I Would Improve Next

- More robust per-layout prediction for cycling opponents
- Better confidence scoring for defensive placement
- Longer-run evaluation harness across multiple attempts
- Per-opponent rollout comparison
- Learned placement policy with explicit regression gates
- More precise modeling of opponent firing order
- Automatic promotion/rollback based on statistically meaningful score improvements
