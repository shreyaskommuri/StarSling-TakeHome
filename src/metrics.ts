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
import { AttemptMetric, GameMetric, MoveMetric, ShipClass, ShotMode, ShotOutcome } from "./types.js";

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

export function selectAttemptReport(kind: "latest" | "best" = "latest"): AttemptMetric | null {
  const all = loadAllMetrics().filter((m) => m.outcome === "completed");
  if (all.length === 0) return null;
  if (kind === "latest") return all[all.length - 1];
  return [...all].sort((a, b) => (b.finalScore ?? -Infinity) - (a.finalScore ?? -Infinity))[0];
}

export function printOpponentReport(metric: AttemptMetric): void {
  const minHits = Math.min(...metric.games.map((g) => g.hits));
  const incompleteHitGames = metric.games.filter((g) => g.hits < 16);
  const likelyLosses = metric.games.filter(
    (g) => g.won === false || (metric.losses && metric.losses > 0 && (g.hits === minHits || g.hits < 16))
  );
  const visibleFourSunk = metric.games.filter((g) => g.shipsSunk === 4);
  const lowHitGames = metric.games.filter((g) => g.hits === minHits);

  console.log("\n════════════ OPPONENT REPORT ════════════");
  console.log(`  Attempt      : ${metric.timestamp.slice(0, 19)}`);
  console.log(`  Config       : ${metric.configName ?? "untagged"}`);
  console.log(`  Score        : ${metric.finalScore ?? "N/A"}`);
  console.log(`  Record       : ${metric.wins ?? "?"}W-${metric.losses ?? "?"}L`);
  console.log(`  Ships        : sunk=${metric.opponentShipsSunk ?? "?"} lost=${metric.agentShipsLost ?? "?"}`);
  console.log(`  Shots        : ${metric.totalShots}`);
  console.log("  Likely loss  : " + (likelyLosses.length ? likelyLosses.map((g) => `${g.opponentId} (#${g.gameOrdinal})`).join(", ") : "none detected"));
  console.log("  Lowest-hit games: " + (lowHitGames.length ? lowHitGames.map((g) => `${g.opponentId} hits=${g.hits}`).join(", ") : "none"));
  console.log("  Incomplete-hit games: " + (incompleteHitGames.length ? incompleteHitGames.map((g) => `${g.opponentId} hits=${g.hits}`).join(", ") : "none"));
  console.log("  Visible 4-sink games: " + (visibleFourSunk.length ? visibleFourSunk.map((g) => g.opponentId).join(", ") : "none"));
  console.log("═════════════════════════════════════════\n");

  console.log("  Per-opponent details:");
  for (const g of metric.games) {
    const last = g.moves[g.moves.length - 1];
    const flags = [
      g.hits === minHits ? "LOWEST_HITS" : "",
      g.hits < 16 ? "INCOMPLETE_HITS" : "",
      g.shipsSunk === 4 ? "VISIBLE_4_SUNK" : "",
      g.won === false ? "LOSS" : "",
    ].filter(Boolean);
    console.log(
      `    [${String(g.gameOrdinal).padStart(2)}] ${g.opponentId.padEnd(22)} ` +
        `shots=${String(g.totalShots).padStart(3)} hits=${String(g.hits).padStart(2)} ` +
        `sinks=${g.shipsSunk} lost=${g.yourShipsLost ?? "?"} ` +
        `won=${g.won === undefined ? "?" : g.won ? "Y" : "N"} ` +
        `acc=${(g.accuracy * 100).toFixed(0).padStart(3)}% ` +
        `last=${last ? `${last.outcome}@${last.row},${last.col}/${last.mode}` : "n/a"}` +
        (flags.length ? ` ${flags.join(",")}` : "")
    );
  }
  console.log();
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
  console.log(`  Config       : ${metric.configName ?? "untagged"}`);
  console.log(`  Outcome      : ${metric.outcome}`);
  console.log(`  Final score  : ${metric.finalScore ?? "N/A"}`);
  if (metric.wins !== undefined || metric.losses !== undefined) {
    console.log(`  Record       : ${metric.wins ?? "?"}W-${metric.losses ?? "?"}L`);
  }
  if (metric.agentShipsLost !== undefined || metric.opponentShipsSunk !== undefined) {
    console.log(
      `  Ships        : sunk=${metric.opponentShipsSunk ?? "?"} ` +
        `lost=${metric.agentShipsLost ?? "?"}`
    );
  }
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
        `sunk=${g.shipsSunk}` +
        (g.yourShipsLost !== undefined ? ` lost=${g.yourShipsLost}` : "") +
        (g.won !== undefined ? ` ${g.won ? "WIN" : "LOSS"}` : "") +
        (g.gameScore !== undefined ? ` score=${g.gameScore}` : "")
    );
  }
  console.log();
}

export function buildMoveMetric(
  row: number,
  col: number,
  outcome: ShotOutcome,
  mode: ShotMode,
  meta?: Record<string, unknown>,
  shipClass?: ShipClass
): MoveMetric {
  return { timestamp: new Date().toISOString(), row, col, outcome, shipClass, mode, meta };
}

export function buildGameMetric(
  opponentId: string,
  gameOrdinal: number,
  moves: MoveMetric[],
  durationMs: number,
  result?: {
    won?: boolean;
    gameScore?: number;
    yourShipsLost?: number;
    opponentShipsLost?: number;
  }
): GameMetric {
  const hits = moves.filter((m) => m.outcome === "HIT" || m.outcome === "SINK").length;
  const totalShots = moves.length;
  return {
    opponentId,
    gameOrdinal,
    won: result?.won,
    gameScore: result?.gameScore,
    totalShots,
    hits,
    misses: moves.filter((m) => m.outcome === "MISS").length,
    accuracy: totalShots > 0 ? hits / totalShots : 0,
    shipsSunk: moves.filter((m) => m.outcome === "SINK").length,
    yourShipsLost: result?.yourShipsLost,
    opponentShipsLost: result?.opponentShipsLost,
    durationMs,
    moves,
  };
}
