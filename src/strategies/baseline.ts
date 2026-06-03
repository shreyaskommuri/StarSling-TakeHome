/**
 * strategies/baseline.ts — Random targeting (control arm)
 *
 * Fires a uniformly random untried cell with no intelligence.
 * Exists purely as an experimental baseline to measure improvement from
 * probability_density. Expected ~50-60 shots/game vs ~30-35 for probability.
 *
 * Run: npx ts-node src/index.ts --strategy=baseline
 * Then compare: npx ts-node src/index.ts --stats
 */
import { ITargetingStrategy, ShotContext, ShotDecision } from "../types";

/**
 * Baseline: picks a random untried cell.
 * Exists as a control to measure probability density's improvement over chance.
 */
export class BaselineStrategy implements ITargetingStrategy {
  readonly name = "baseline_random";

  pickShot(context: ShotContext): ShotDecision {
    const tried = new Set<string>(context.yourShots.map((s) => `${s.row},${s.col}`));
    const candidates: Array<[number, number]> = [];
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 10; c++) {
        if (!tried.has(`${r},${c}`)) candidates.push([r, c]);
      }
    }
    if (candidates.length === 0) {
      throw new Error("No untried cells remain — game should have ended already");
    }
    const [row, col] = candidates[Math.floor(Math.random() * candidates.length)];
    return { row, col, mode: "hunt", meta: { candidatePool: candidates.length } };
  }
}
