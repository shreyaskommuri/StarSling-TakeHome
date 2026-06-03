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
function collectLine(
  sink: { row: number; col: number },
  hitSet: Set<string>,
  axis: "horizontal" | "vertical"
): string[] {
  const dirs = axis === "horizontal" ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
  const cells = [`${sink.row},${sink.col}`];

  for (const [dr, dc] of dirs) {
    const line: string[] = [];
    let r = sink.row + dr;
    let c = sink.col + dc;
    while (r >= 0 && r < 10 && c >= 0 && c < 10 && hitSet.has(`${r},${c}`)) {
      line.push(`${r},${c}`);
      r += dr;
      c += dc;
    }
    if (dr < 0 || dc < 0) cells.unshift(...line.reverse());
    else cells.push(...line);
  }

  return cells;
}

/** Identify cells belonging to sunk ships without absorbing perpendicular adjacent ships. */
function getSunkShipCells(shots: { row: number; col: number; outcome: string; shipClass?: ShipClass }[]): Set<string> {
  const hitSet = new Set<string>(shots.filter((s) => s.outcome === "HIT").map((s) => `${s.row},${s.col}`));
  const sunkCells = new Set<string>();

  for (const s of shots) {
    if (s.outcome !== "SINK") continue;
    const targetLen = s.shipClass ? SHIP_LENGTHS[s.shipClass] : undefined;
    const horizontal = collectLine(s, hitSet, "horizontal");
    const vertical = collectLine(s, hitSet, "vertical");
    const candidates = [horizontal, vertical];
    const exact = targetLen ? candidates.find((line) => line.length === targetLen) : undefined;
    const best = exact ?? candidates.sort((a, b) => b.length - a.length)[0];
    best.forEach((cell) => sunkCells.add(cell));
  }

  return sunkCells;
}

function parseCell(key: string): { row: number; col: number } {
  const [row, col] = key.split(",").map(Number);
  return { row, col };
}

function getActiveHitComponents(activeHits: Set<string>): string[][] {
  const remaining = new Set(activeHits);
  const components: string[][] = [];

  for (const start of activeHits) {
    if (!remaining.has(start)) continue;
    const component: string[] = [];
    const stack = [start];
    remaining.delete(start);

    while (stack.length > 0) {
      const key = stack.pop()!;
      component.push(key);
      const { row, col } = parseCell(key);
      for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
        const next = `${row + dr},${col + dc}`;
        if (remaining.has(next)) {
          remaining.delete(next);
          stack.push(next);
        }
      }
    }

    components.push(component);
  }

  return components;
}

function chooseTargetComponent(components: string[][], shots: { row: number; col: number; outcome: string }[]): Set<string> {
  if (components.length === 0) return new Set();

  const lastHitIndex = new Map<string, number>();
  shots.forEach((s, idx) => {
    if (s.outcome === "HIT") lastHitIndex.set(`${s.row},${s.col}`, idx);
  });

  const [best] = [...components].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const aLatest = Math.max(...a.map((k) => lastHitIndex.get(k) ?? -1));
    const bLatest = Math.max(...b.map((k) => lastHitIndex.get(k) ?? -1));
    return bLatest - aLatest;
  });

  return new Set(best);
}

export class ProbabilityStrategy implements ITargetingStrategy {
  readonly name = "probability_density";

  pickShot(ctx: ShotContext): ShotDecision {
    const { yourShots, opponentShips, learnedHits } = ctx;
    const tried = new Set<string>(yourShots.map((s) => `${s.row},${s.col}`));

    // Cells belonging to already-sunk ships (SINK + its connected HIT chain).
    const sunkCells = getSunkShipCells(yourShots);

    // Active hits: HIT cells not yet accounted for by a SINK (i.e., the ship is still alive).
    const activeHits = new Set<string>(
      yourShots
        .filter((s) => s.outcome === "HIT" && !sunkCells.has(`${s.row},${s.col}`))
        .map((s) => `${s.row},${s.col}`)
    );
    const activeHitComponents = getActiveHitComponents(activeHits);
    const targetHits = chooseTargetComponent(activeHitComponents, yourShots);

    // Fire learned cells only when there are no active unsunk hits to follow up.
    // If we have an active hit we must finish sinking that ship before firing elsewhere.
    // Learned cells are filtered to freq≥2 in getLearnedHits.
    //
    // Early-abandon: if the OPENING learned shots all miss, the opponent is using
    // a different layout this game — stop firing learned cells and switch to hunt.
    // We count the opening run of shots that overlap the learned list (before the
    // first non-learned cell is fired), since hunt cells can coincidentally land on
    // learned positions and give a false "hit" signal.
    if (activeHits.size === 0) {
      const learnedSet = new Set(learnedHits.map((c) => `${c.row},${c.col}`));
      let openingLearnedTried = 0;
      let openingLearnedHits = 0;
      let learnedTried = 0;
      let learnedHitsThisGame = 0;
      for (const shot of yourShots) {
        const key = `${shot.row},${shot.col}`;
        if (!learnedSet.has(key)) continue;
        learnedTried++;
        if (shot.outcome === "HIT" || shot.outcome === "SINK") learnedHitsThisGame++;
      }
      for (const shot of yourShots) {
        const key = `${shot.row},${shot.col}`;
        if (!learnedSet.has(key)) break; // stop at first non-learned cell
        openingLearnedTried++;
        if (shot.outcome === "HIT" || shot.outcome === "SINK") openingLearnedHits++;
      }
      const learnedAbandoned = openingLearnedTried >= 6 && openingLearnedHits === 0;
      const learnedUnderperforming = learnedTried >= 8 && learnedHitsThisGame / learnedTried < 0.35;

      if (!learnedAbandoned && !learnedUnderperforming) {
        for (const cell of learnedHits) {
          const key = `${cell.row},${cell.col}`;
          if (!tried.has(key)) {
            return {
              row: cell.row,
              col: cell.col,
              mode: "learned",
              meta: {
                source: "history",
                learnedTried,
                learnedHits: learnedHitsThisGame,
              },
            };
          }
        }
      }
    }

    // Cells that cannot host a remaining ship: confirmed empty (MISS) or occupied by a
    // sunk ship. Remaining ships cannot overlap either category.
    const excludedCells = new Set<string>([
      ...yourShots.filter((s) => s.outcome === "MISS").map((s) => `${s.row},${s.col}`),
      ...sunkCells,
    ]);

    const unsunkClasses = opponentShips.filter((s) => !s.sunk).map((s) => s.shipClass);

    const density: number[][] = Array.from({ length: 10 }, () => new Array(10).fill(0));

    for (const shipClass of unsunkClasses) {
      const len = SHIP_LENGTHS[shipClass];

      for (let r = 0; r < 10; r++) {
        for (let c = 0; c <= 10 - len; c++) {
          const cells = Array.from({ length: len }, (_, i) => `${r},${c + i}`);
          if (cells.some((k) => excludedCells.has(k))) continue;
          const hitOverlap = cells.filter((k) => targetHits.has(k)).length;
          if (targetHits.size > 0 && hitOverlap === 0) continue;
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
          if (cells.some((k) => excludedCells.has(k))) continue;
          const hitOverlap = cells.filter((k) => targetHits.has(k)).length;
          if (targetHits.size > 0 && hitOverlap === 0) continue;
          const boost = hitOverlap > 0 ? 4 * hitOverlap : 1;
          cells.forEach((k) => {
            const [cr, cc] = k.split(",").map(Number);
            density[cr][cc] += boost;
          });
        }
      }
    }

    const inHuntMode = targetHits.size === 0;

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
        if (!inHuntMode && density[r][c] <= 0) continue;
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
          if (!inHuntMode && density[r][c] <= 0) continue;
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
    return {
      row: bestRow,
      col: bestCol,
      mode,
      meta: {
        density: bestScore,
        parity: inHuntMode,
        activeComponents: activeHitComponents.length,
        targetHits: targetHits.size,
      },
    };
  }
}
