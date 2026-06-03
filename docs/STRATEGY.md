# Targeting Strategy

## The Problem

Given a 10×10 board, we know which cells we've tried (HIT, MISS, SUNK) and which ships are still afloat. We want to pick the next cell that maximizes expected hits.

---

## Why Not Hunt/Target?

Classic hunt/target:
1. **Hunt phase**: fire random cells (or checkerboard pattern) until a hit
2. **Target phase**: fire adjacent cells to sink the hit ship

Problems:
- Hunt phase ignores misses — they don't narrow down future shots
- Target phase ignores other ships — a miss on the wrong side wastes a shot
- The phases don't share information

---

## Probability Density Targeting

For each unsunk ship class, enumerate every possible board position that is **consistent with current information** (i.e., no confirmed miss cells in the way).

Build a density map: `density[r][c]` = number of valid placements that include cell (r,c).

**Intuition**: A cell with high density is "mentioned" by many possible ship positions. Shooting it eliminates the most possibilities regardless of outcome — HIT narrows down rapidly, MISS eliminates all placements containing that cell.

### Hit boost

When there are active unsunk hits on the board, placements that include those hit cells get weighted 4×. This pulls the density peak toward the area around confirmed hits — equivalent to "target mode" but mathematically unified with the hunt density.

### Learned hits (cross-attempt)

Before building the density map, we check `data/history.json` for cells that were confirmed hits against this opponent in prior attempts. Opponents are deterministic, so these cells will hit again. We fire them first (mode: `learned`).

After 2-3 attempts, we've seen enough of each opponent's layout to fire their ship locations directly, converging to ~17 shots/game (minimum to sink all 5 ships).

---

## Algorithm (probability.ts)

```
pickShot(context):
  1. For each cell in learnedHits (sorted by frequency):
       if not already tried this game → return it (mode: learned)
  
  2. Build missSet from yourShots where outcome=MISS
     Build activeHits from yourShots where outcome=HIT (not SUNK)
     Build unsunkClasses from opponentShips where sunk=false
  
  3. density[10][10] = all zeros
     For each unsunkClass:
       For each valid horizontal placement starting at (r,c):
         if any cell in placement is in missSet → skip
         boost = 4 if any cell is in activeHits, else 1
         density[r][c..c+len] += boost
       Repeat for vertical
  
  4. Find untried cell (r,c) with max density[r][c]
     mode = "target" if activeHits.size > 0, else "hunt"
     return {row: r, col: c, mode, meta: {density: score}}
```

---

## Complexity

- Per shot: O(5 ships × 100 positions × 10 cells) ≈ 5,000 operations
- Negligible for a 10×10 board
- Could extend to full Monte Carlo (joint fleet enumeration) for ~5-10% improvement

---

## Baseline Strategy (baseline.ts)

Fires a uniformly random untried cell. Exists as a control arm.

Expected performance: ~50-60 shots/game (equivalent to random search over 100 cells for 17 targets).

Use: `npx ts-node src/index.ts --strategy=baseline`

Then compare: `npx ts-node src/index.ts --stats`

---

## Adding a New Strategy

1. Create `src/strategies/yourname.ts`
2. Implement `ITargetingStrategy` from `../types`:
   ```typescript
   export class YourStrategy implements ITargetingStrategy {
     readonly name = "your_strategy_name";
     pickShot(ctx: ShotContext): ShotDecision {
       // ctx.yourShots, ctx.opponentShips, ctx.learnedHits
       return { row, col, mode: "hunt", meta: { /* anything */ } };
     }
   }
   ```
3. Export from `src/strategies/index.ts`
4. Register in `src/index.ts` STRATEGIES map
5. Run: `npx ts-node src/index.ts --strategy=yourname`

---

## Measuring Improvement

Before changing strategy:
```bash
npx ts-node src/index.ts --stats
# note: avgShotsPerGame, avgAccuracy, finalScore
```

After changing and running:
```bash
npx ts-node src/index.ts --stats
# compare delta
```

Every optimization should be justified by data, not intuition.

---

## Scoring Reference

Per game:
- +1 per hit cell (HIT or SUNK outcome)
- Sink bonuses: CARRIER+10, BATTLESHIP+8, CRUISER+7, SUBMARINE+6, DESTROYER+4
- +14 (SCOUT) or +15 (WARSHIP) if you WIN (sank all 5 opponent ships)
- -2 per your ship sunk (flat) - class penalty (same values as sink bonuses)

Opponents: 5 SCOUT then 10 WARSHIP, fixed order. Perfect score: 1000.

Key insight: winning (sinking all 5) gives +14/+15 bonus. Marginal hits beyond the minimum aren't worth as many points as the win bonus. Minimizing shots per game maximizes win probability per unit time, but every hit still scores.
