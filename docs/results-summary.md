# Results Summary

## Final High-Water Result

- **Highest observed score**: 771/1000
- **Config**: `targeted_defense_v1`
- **Record**: 15W-0L
- **Opponent ships sunk**: 75/75
- **Own ships lost**: 23
- **Total shots**: 560

This was the final usable high-water run. The gameplay window closed immediately afterward, so no further live rerolls could be started.

## Key Insight

The score was not only about minimizing shots. Once the server exposed attempt-level survival fields, it became clear that wins and own ships lost mattered heavily. The optimization target shifted from pure offense to:

1. Preserve 15W-0L.
2. Sink all 75 opponent ships.
3. Reduce own ships lost.
4. Reduce wasted shots.

That shift led to targeted defensive placement, conservative learned-mode guardrails, and a stricter promotion standard for experiments.

## Honest Framing

`targeted_defense_v1` produced the highest observed score, but it was volatile on reruns. `stable_713` was kept as the safer rollback profile. The final README and devlog call this out directly rather than presenting the 771 as a stability guarantee.

## Evidence Trail

- `DEVLOG.md` records the score progression from 279 to 771.
- `npx tsx src/index.ts --report=best` reports the 771 attempt locally from recorded metrics.
- `npx tsx src/index.ts --stats` prints the full attempt history.
