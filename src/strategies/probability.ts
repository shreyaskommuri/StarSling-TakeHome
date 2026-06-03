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
 * Parity filtering (hunt mode): Any ship of length ≥2 must cover at least
 *   one cell of each parity class, so a checkerboard scan guarantees a hit
 *   while firing only half the board (~50 cells vs ~100). Once an active hit
 *   exists we disable the filter so we can finish the ship.
 *
 * Hit boost: placements containing k active (unsunk) hit cells are weighted
 *   4k× instead of a flat 4×. A placement aligned with 2 confirmed collinear
 *   hits gets 8×, correctly amplifying orientation information.
 *
 * Mode labeling (for observability):
 *   "learned" — firing a cell from prior-attempt history (highest confidence)
 *   "target"  — active unsunk hit exists; density is boosted around it
 *   "hunt"    — no active hits; pure placement probability with parity filter
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
          const hitOverlap = cells.filter((k) => activeHits.has(k)).length;
          const boost = hitOverlap > 0 ? 4 * hitOverlap : 1;
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
          const hitOverlap = cells.filter((k) => activeHits.has(k)).length;
          const boost = hitOverlap > 0 ? 4 * hitOverlap : 1;
          cells.forEach((k) => {
            const [cr, cc] = k.split(",").map(Number);
            density[cr][cc] += boost;
          });
        }
      }
    }

    const inHuntMode = activeHits.size === 0;

    let bestRow = -1;
    let bestCol = -1;
    let bestScore = -1;

    // In hunt mode, apply checkerboard parity: any ship of length ≥2 spans both
    // parity classes so we're guaranteed to hit it while firing only ~50 cells.
    // Disable the filter the moment there's an active hit so we can finish the ship.
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (tried.has(`${r},${c}`)) continue;
        if (inHuntMode && (r + c) % 2 !== 0) continue;
        if (density[r][c] > bestScore) {
          bestScore = density[r][c];
          bestRow = r;
          bestCol = c;
        }
      }
    }

    // Parity cells exhausted (late game) or density zero — fall back to full board.
    if (bestRow === -1) {
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          if (!tried.has(`${r},${c}`) && density[r][c] > bestScore) {
            bestScore = density[r][c];
            bestRow = r;
            bestCol = c;
          }
        }
      }
    }

    if (bestRow === -1) {
      // Truly no cells left — game should have ended already.
      for (let r = 0; r < 10; r++) {
        for (let c = 0; c < 10; c++) {
          if (!tried.has(`${r},${c}`)) return { row: r, col: c, mode: "hunt", meta: { density: 0 } };
        }
      }
      throw new Error("No untried cells remain — game should have ended already");
    }

    const mode = inHuntMode ? "hunt" : "target";
    return { row: bestRow, col: bestCol, mode, meta: { density: bestScore, parity: inHuntMode } };
  }
}
