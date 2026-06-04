# Experiments

## Approach

I treated the challenge as a closed-loop optimization problem:

1. Instrument the agent.
2. Identify the current bottleneck.
3. Make a small targeted change.
4. Run an attempt.
5. Compare score, wins, opponent ships sunk, own ships lost, and shots.
6. Promote only when the evidence justified it.

This mattered because some changes reduced shots but lost games, while others looked strategically attractive but increased own ships lost.

## Promoted Changes

- `currentMoves` shot tracking: fixed phantom-hit and shot-order bugs by using locally ordered move history instead of trusting server shot array ordering.
- Probability-density targeting: enumerated legal placements and fired at high-density cells rather than random hunt.
- Connected-component targeting: kept target mode focused on one plausible unsunk ship instead of merging disconnected hits.
- Sunk-cell exclusion: removed sunk ship cells from active hit tracking so old hits did not pollute the next target decision.
- Parity-restored final mode: improved late-game search after four opponent ships were sunk.
- Conservative learned mode: used history where it was reliable, but abandoned learned cells when opening misses or underperformance showed the current layout had shifted.
- `targeted_defense_v1`: final highest observed profile, reaching 771/1000 with 15W-0L, 75/75 sunk, 23 own ships lost, and 560 shots.

## Rejected Experiments

- Aggressive early-shot defensive placement: overfit incoming-shot heatmaps and dropped to 535.
- Broad final-history hints: too noisy and increased wasted late-game shots.
- Guarding placement behind too many records: reduced shots in some places but caused own ships lost to spike.
- `targeted_defense_v2`: lower danger and spacing weights underperformed.
- `targeted_defense_v3`: reduced own losses in one run but failed to preserve 15W-0L.
- Cycle prediction variants: layout cycles were too weak to trust, so prediction changed too many openings.
- `targeted_defense_safe`: stronger guardrails looked safer on paper but failed the promotion gate.
- `targeted_defense_quick_abandon`: reduced own losses and shots but sacrificed wins and sunk ships.

## Technical Judgment

The most important decision was not to keep adding strategy complexity after every bad rerun. I kept `stable_713` as a rollback, used `targeted_defense_v1` for upside, and documented volatility instead of hiding it. That is the same tradeoff I would make in production: optimize aggressively, but keep rollback paths and trust measured outcomes over intuition.

## Research Process

The research was split by time and uncertainty:

- Early phase: fix correctness, API normalization, valid placement, and trustworthy metrics.
- Middle phase: improve targeting with probability density, parity, connected components, and layout-aware learning.
- Late phase: shift to scoring optimization once own ships lost and win/loss fields appeared.
- Final phase: compare configs, run targeted rerolls, reject unstable variants, and document the highest observed result honestly.

This process helped separate actual signal from leaderboard variance.
