/**
 * strategies/probability.ts — Probability density targeting
 *
 * Algorithm:
 *   For each unsunk ship class, enumerate EVERY valid board position consistent
 *   with current misses. Build density[r][c] = count of valid placements that
 *   include (r,c). Fire the untried cell with the highest density.
 *
 * Why this beats hunt/target:
 *   Hunt/target separates into two phases that don't share information.
 *   Probability density uses ALL information simultaneously — every miss
 *   eliminates placements across ALL ships, not just the one being targeted.
 *
 * Hit boost: placements containing an active (unsunk) hit cell are weighted 4x.
 * This focuses the density map on the area around confirmed hits, effectively
 * merging the "target" phase into the density calculation.
 *
 * Mode labeling (for observability):
 *   "learned" — firing a cell from prior-attempt history (highest confidence)
 *   "target"  — active unsunk hit exists; density is boosted around it
 *   "hunt"    — no active hits; pure placement probability
 *
 * Tradeoff vs Monte Carlo:
 *   Full Monte Carlo (sampling random valid full-fleet arrangements) is more
 *   accurate but O(n) per shot. Enumerating per-ship placements is O(ships × board)
 *   and fast enough for 10×10. Extend to MonteCarloStrategy if needed.
 */
import { ITargetingStrategy, ShotContext, ShotDecision, ShipClass } from "../types.js";

const SHIP_LENGTHS: Record<ShipClass, number> = {
  CARRIER: 5,
  BATTLESHIP: 4,
  CRUISER: 3,
  SUBMARINE: 3,
  DESTROYER: 2,
};

/**
 * Probability density targeting.
 *
 * For each unsunk ship, enumerate every valid board position given the current
 * set of misses. Build a density map where density[r][c] = count of valid
 * placements that include (r,c). Cells overlapping active hits are boosted.
 * Shoot the highest-density untried cell.
 *
 * Why this is better than hunt/target:
 * - Uses ALL information simultaneously (hits AND misses narrow the density).
 * - No separate hunt vs. target phase — the density map handles both.
 * - Naturally focuses fire on areas consistent with remaining ships.
 */
export class ProbabilityStrategy implements ITargetingStrategy {
  readonly name = "probability_density";

  pickShot(ctx: ShotContext): ShotDecision {
    const { yourShots, opponentShips, learnedHits } = ctx;
    const tried = new Set<string>(yourShots.map((s) => `${s.row},${s.col}`));

    // Prioritize learned hit cells from prior attempts against this opponent.
    for (const cell of learnedHits) {
      const key = `${cell.row},${cell.col}`;
      if (!tried.has(key)) {
        return { row: cell.row, col: cell.col, mode: "learned", meta: { source: "history" } };
      }
    }

    const missSet = new Set<string>(
      yourShots.filter((s) => s.outcome === "MISS").map((s) => `${s.row},${s.col}`)
    );
    const activeHits = new Set<string>(
      yourShots.filter((s) => s.outcome === "HIT").map((s) => `${s.row},${s.col}`)
    );
    const unsunkClasses = opponentShips.filter((s) => !s.sunk).map((s) => s.shipClass);

    const density: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));

    for (const shipClass of unsunkClasses) {
      const len = SHIP_LENGTHS[shipClass];

      for (let r = 0; r < 10; r++) {
        for (let c = 0; c <= 10 - len; c++) {
          const cells = Array.from({ length: len }, (_, i) => `${r},${c + i}`);
          if (cells.some((k) => missSet.has(k))) continue;
          const boost = cells.some((k) => activeHits.has(k)) ? 4 : 1;
          cells.forEach((k) => {
            const [cr, cc] = k.split(",").map(Number);
            density[cr][cc] += boost;
          });
        }
      }

      for (let r = 0; r <= 10 - len; r++) {
        for (let c = 0; c < 10; c++) {
          const cells = Array.from({ length: len }, (_, i) => `${r + i},${c}`);
          if (cells.some((k) => missSet.has(k))) continue;
          const boost = cells.some((k) => activeHits.has(k)) ? 4 : 1;
          cells.forEach((k) => {
            const [cr, cc] = k.split(",").map(Number);
            density[cr][cc] += boost;
          });
        }
      }
    }

    let bestRow = -1;
    let bestCol = -1;
    let bestScore = -1;

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (!tried.has(`${r},${c}`) && density[r][c] > bestScore) {
          bestScore = density[r][c];
          bestRow = r;
          bestCol = c;
        }
      }
    }

    // Fallback: density is zero (all remaining ships are fully constrained or
    // state is inconsistent). Pick any untried cell to keep the game moving.
    if (bestRow === -1) {
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          if (!tried.has(`${r},${c}`)) return { row: r, col: c, mode: "hunt", meta: { density: 0 } };
        }
      }
      throw new Error("No untried cells remain — game should have ended already");
    }

    const mode = activeHits.size > 0 ? "target" : "hunt";
    return { row: bestRow, col: bestCol, mode, meta: { density: bestScore } };
  }
}
