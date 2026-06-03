/**
 * metrics.ts — Attempt/game/move metric collection and persistence
 *
 * Three levels of granularity:
 *   MoveMetric  — per-shot: (row, col, outcome, mode, meta, timestamp)
 *   GameMetric  — per-game: totalShots, hits, misses, accuracy, shipsSunk, duration
 *   AttemptMetric — per-attempt: finalScore, avgShotsPerGame, avgAccuracy, best/worst game
 *
 * Persistence: data/metrics.json — append-only array of AttemptMetric.
 * Read with: npx ts-node src/index.ts --stats
 *
 * Accuracy definition: hits / totalShots (where hits = HIT + SINK outcomes).
 * Note: SINK is the outcome of the shot that sank the last cell of a ship,
 * so it counts as a hit for accuracy purposes.
 *
 * Used to answer:
 *   "Is probability_density better than baseline?" → compare avgShotsPerGame
 *   "Which opponent is hardest?" → worstGame by shots
 *   "Is learning working?" → compare attempt 1 vs 2+ avgShotsPerGame per opponent
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { AttemptMetric, GameMetric, MoveMetric, ShotMode, ShotOutcome } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const METRICS_FILE = path.resolve(__dirname, "../data/metrics.json");

export function loadAllMetrics(): AttemptMetric[] {
  try {
    return JSON.parse(fs.readFileSync(METRICS_FILE, "utf8")) as AttemptMetric[];
  } catch {
    return [];
  }
}

export function saveAttemptMetric(metric: AttemptMetric): void {
  const all = loadAllMetrics();
  all.push(metric);
  fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true });
  fs.writeFileSync(METRICS_FILE, JSON.stringify(all, null, 2));
}

export function summarizeGames(games: GameMetric[]): {
  avgShotsPerGame: number;
  avgAccuracy: number;
  bestGame: { opponentId: string; shots: number } | null;
  worstGame: { opponentId: string; shots: number } | null;
} {
  if (games.length === 0) {
    return { avgShotsPerGame: 0, avgAccuracy: 0, bestGame: null, worstGame: null };
  }

  const totalShots = games.reduce((s, g) => s + g.totalShots, 0);
  const totalAccuracy = games.reduce((s, g) => s + g.accuracy, 0);

  const sorted = [...games].sort((a, b) => a.totalShots - b.totalShots);
  return {
    avgShotsPerGame: totalShots / games.length,
    avgAccuracy: totalAccuracy / games.length,
    bestGame: { opponentId: sorted[0].opponentId, shots: sorted[0].totalShots },
    worstGame: {
      opponentId: sorted[sorted.length - 1].opponentId,
      shots: sorted[sorted.length - 1].totalShots,
    },
  };
}

export function printAttemptSummary(metric: AttemptMetric): void {
  console.log("\n══════════════ ATTEMPT SUMMARY ══════════════");
  console.log(`  Strategy     : ${metric.strategy}`);
  console.log(`  Outcome      : ${metric.outcome}`);
  console.log(`  Final score  : ${metric.finalScore ?? "N/A"}`);
  console.log(`  Games        : ${metric.gamesCompleted}`);
  console.log(`  Total shots  : ${metric.totalShots}`);
  console.log(`  Avg shots/game: ${metric.avgShotsPerGame.toFixed(1)}`);
  console.log(`  Avg accuracy : ${(metric.avgAccuracy * 100).toFixed(1)}%`);
  if (metric.bestGame) {
    console.log(`  Best game    : ${metric.bestGame.opponentId} (${metric.bestGame.shots} shots)`);
  }
  if (metric.worstGame) {
    console.log(`  Worst game   : ${metric.worstGame.opponentId} (${metric.worstGame.shots} shots)`);
  }
  console.log(`  Duration     : ${(metric.durationMs / 1000).toFixed(1)}s`);
  console.log("═════════════════════════════════════════════\n");

  // Per-game breakdown
  console.log("  Per-game breakdown:");
  for (const g of metric.games) {
    const bar = "█".repeat(Math.round(g.accuracy * 10)) + "░".repeat(10 - Math.round(g.accuracy * 10));
    console.log(
      `    [${String(g.gameOrdinal).padStart(2)}] ${g.opponentId.padEnd(12)} ` +
        `shots=${String(g.totalShots).padStart(3)} ` +
        `acc=${(g.accuracy * 100).toFixed(0).padStart(3)}% ${bar} ` +
        `sunk=${g.shipsSunk}`
    );
  }
  console.log();
}

export function buildMoveMetric(
  row: number,
  col: number,
  outcome: ShotOutcome,
  mode: ShotMode,
  meta?: Record<string, unknown>
): MoveMetric {
  return { timestamp: new Date().toISOString(), row, col, outcome, mode, meta };
}

export function buildGameMetric(
  opponentId: string,
  gameOrdinal: number,
  moves: MoveMetric[],
  durationMs: number
): GameMetric {
  const hits = moves.filter((m) => m.outcome === "HIT" || m.outcome === "SINK").length;
  const totalShots = moves.length;
  return {
    opponentId,
    gameOrdinal,
    totalShots,
    hits,
    misses: moves.filter((m) => m.outcome === "MISS").length,
    accuracy: totalShots > 0 ? hits / totalShots : 0,
    shipsSunk: moves.filter((m) => m.outcome === "SINK").length,
    durationMs,
    moves,
  };
}
