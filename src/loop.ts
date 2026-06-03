/**
 * loop.ts — Game FSM
 *
 * Drives the full attempt lifecycle by following server-returned responseType:
 *
 *   createAttempt()
 *       │
 *       ▼
 *   MOVE_REQUIRED
 *       ├─ nextRequiredMove=PLACE_SHIPS → placeShips(layout) → loop
 *       └─ nextRequiredMove=SUBMIT_SHOT → submitShot(cell)   → loop
 *            │
 *            ├─ GAME_COMPLETED      → save history, follow .next → loop
 *            ├─ ATTEMPT_COMPLETED   → save metrics, print summary, done
 *            └─ ATTEMPT_DISQUALIFIED→ save metrics, print reason, done
 *
 * Resilience:
 *   - 409 on createAttempt → resume via getCurrentAttempt
 *   - GAME_COMPLETED missing .next → poll getCurrentAttempt (server bug recovery)
 *   - Pre-existing shots on resume are seeded into currentMoves so game-level
 *     metrics (accuracy, totalShots) remain accurate across reconnects.
 *
 * Observability:
 *   - Every move is logged as a JSONL event with row, col, outcome, mode, meta.
 *   - Game-end and attempt-end events include full aggregated metrics.
 *   - All events written to data/logs/{runId}.jsonl for offline analysis.
 */
import { AgentAuthClient } from "@auth/agent";
import { createAttempt, placeShips, submitShot, getCurrentAttempt } from "./client.js";
import { generatePlacements, validatePlacements } from "./placement.js";
import { appendGameRecord, getLearnedHits } from "./learning.js";
import { Logger } from "./logger.js";
import {
  buildMoveMetric,
  buildGameMetric,
  saveAttemptMetric,
  summarizeGames,
  printAttemptSummary,
} from "./metrics.js";
import { ITargetingStrategy, GameStateEnvelope, GameMetric, MoveMetric } from "./types.js";

export async function runAttempt(
  agent: AgentAuthClient,
  agentId: string,
  strategy: ITargetingStrategy,
  logger: Logger
): Promise<void> {
  const attemptStart = Date.now();
  const runId = logger.logPath.split("/").pop()?.replace(".jsonl", "") ?? "unknown";

  logger.log({ type: "attempt_start", timestamp: new Date().toISOString(), runId, strategy: strategy.name });
  console.log(`Starting attempt [${runId}] with strategy: ${strategy.name}`);

  let state: GameStateEnvelope;

  // Resume active attempt if one exists, otherwise create a new one.
  try {
    state = await createAttempt(agent, agentId);
    console.log("Created new attempt.");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("409")) {
      console.log("Active attempt found — resuming...");
      try {
        state = await getCurrentAttempt(agent, agentId);
      } catch (inner: unknown) {
        const innerMsg = inner instanceof Error ? inner.message : String(inner);
        if (innerMsg.includes("404")) {
          // Attempt expired between the two calls — just create a fresh one.
          console.log("Active attempt expired, creating new one...");
          state = await createAttempt(agent, agentId);
        } else {
          throw inner;
        }
      }
    } else {
      logger.log({ type: "error", timestamp: new Date().toISOString(), message: msg });
      throw err;
    }
  }

  const games: GameMetric[] = [];
  let currentMoves: MoveMetric[] = [];
  let gameStart = Date.now();
  let currentOpponentId = state.opponentId ?? "unknown";
  let currentOrdinal = state.gameOrdinal ?? 0;

  // If we resumed mid-game, seed the move log from existing shots so game-level
  // metrics (accuracy, totalShots) reflect the full game, not just this run's shots.
  if (state.yourShots?.length > 0) {
    currentMoves = state.yourShots.map((s) =>
      buildMoveMetric(s.row, s.col, s.outcome, "resumed")
    );
    console.log(`  Resumed game with ${currentMoves.length} shots already taken.`);
  }

  while (true) {
    const { responseType } = state;

    if (responseType === "ATTEMPT_COMPLETED") {
      const finalScore = state.finalScore ?? null;
      const durationMs = Date.now() - attemptStart;

      logger.log({
        type: "attempt_end",
        timestamp: new Date().toISOString(),
        finalScore,
        outcome: "completed",
        gamesCompleted: games.length,
        totalShots: games.reduce((s, g) => s + g.totalShots, 0),
        durationMs,
      });

      const { avgShotsPerGame, avgAccuracy, bestGame, worstGame } = summarizeGames(games);
      const metric = {
        id: runId,
        timestamp: new Date().toISOString(),
        strategy: strategy.name,
        finalScore,
        outcome: "completed" as const,
        gamesCompleted: games.length,
        totalShots: games.reduce((s, g) => s + g.totalShots, 0),
        avgShotsPerGame,
        avgAccuracy,
        bestGame,
        worstGame,
        durationMs,
        games,
      };
      saveAttemptMetric(metric);
      printAttemptSummary(metric);
      break;
    }

    if (responseType === "ATTEMPT_DISQUALIFIED") {
      const durationMs = Date.now() - attemptStart;
      console.log(`\nAttempt disqualified: ${state.disqualifyReason ?? "(no reason returned — likely prior attempt state)"}`);
      logger.log({
        type: "error",
        timestamp: new Date().toISOString(),
        message: "ATTEMPT_DISQUALIFIED",
        context: { disqualifyReason: state.disqualifyReason, gamesCompleted: games.length, stateKeys: Object.keys(state) },
      });

      logger.log({
        type: "attempt_end",
        timestamp: new Date().toISOString(),
        finalScore: null,
        outcome: `disqualified:${state.disqualifyReason}`,
        gamesCompleted: games.length,
        totalShots: games.reduce((s, g) => s + g.totalShots, 0),
        durationMs,
      });

      const { avgShotsPerGame, avgAccuracy, bestGame, worstGame } = summarizeGames(games);
      saveAttemptMetric({
        id: runId,
        timestamp: new Date().toISOString(),
        strategy: strategy.name,
        finalScore: null,
        outcome: "disqualified",
        disqualifyReason: state.disqualifyReason,
        gamesCompleted: games.length,
        totalShots: games.reduce((s, g) => s + g.totalShots, 0),
        avgShotsPerGame,
        avgAccuracy,
        bestGame,
        worstGame,
        durationMs,
        games,
      });
      break;
    }

    if (responseType === "GAME_COMPLETED") {
      // Finalize the game we just completed.
      const gameMetric = buildGameMetric(
        currentOpponentId,
        currentOrdinal,
        currentMoves,
        Date.now() - gameStart
      );
      games.push(gameMetric);

      logger.log({
        type: "game_end",
        timestamp: new Date().toISOString(),
        opponentId: currentOpponentId,
        gameOrdinal: currentOrdinal,
        totalShots: gameMetric.totalShots,
        hits: gameMetric.hits,
        accuracy: gameMetric.accuracy,
        shipsSunk: gameMetric.shipsSunk,
        durationMs: gameMetric.durationMs,
      });

      // Persist shot history for self-improvement on next attempt.
      if (currentOpponentId !== "unknown" && currentMoves.length > 0) {
        appendGameRecord({
          opponentId: currentOpponentId,
          gameOrdinal: currentOrdinal,
          shots: currentMoves.map((m) => ({ row: m.row, col: m.col, outcome: m.outcome })),
        });
      }

      console.log(
        `  Game ${currentOrdinal} vs ${currentOpponentId}: ` +
          `${gameMetric.totalShots} shots, ` +
          `${(gameMetric.accuracy * 100).toFixed(0)}% accuracy, ` +
          `${gameMetric.shipsSunk} sunk`
      );

      if (!state.next) {
        // Per spec, GAME_COMPLETED always embeds .next. If it's missing, the
        // server is misbehaving — log it but don't break; let ATTEMPT_COMPLETED
        // or ATTEMPT_DISQUALIFIED arrive naturally via getCurrentAttempt.
        logger.log({
          type: "error",
          timestamp: new Date().toISOString(),
          message: "GAME_COMPLETED missing .next — polling getCurrentAttempt",
        });
        console.warn("GAME_COMPLETED missing .next, polling server...");
        state = await getCurrentAttempt(agent, agentId);
        continue;
      }

      // Transition to the next game.
      state = state.next;
      currentMoves = [];
      gameStart = Date.now();
      currentOpponentId = state.opponentId ?? "unknown";
      currentOrdinal = state.gameOrdinal ?? 0;
      continue;
    }

    if (responseType === "MOVE_REQUIRED") {
      if (state.nextRequiredMove === "PLACE_SHIPS" || (state.nextRequiredMove as unknown as string) === "place_ships") {
        currentOpponentId = state.opponentId ?? "unknown";
        currentOrdinal = state.gameOrdinal ?? 0;
        gameStart = Date.now();
        currentMoves = [];

        logger.log({
          type: "game_start",
          timestamp: new Date().toISOString(),
          opponentId: currentOpponentId,
          gameOrdinal: currentOrdinal,
        });

        console.log(`\nGame ${currentOrdinal} vs ${currentOpponentId}`);

        const layout = generatePlacements();
        validatePlacements(layout); // guard: illegal fleet = silent ATTEMPT_DISQUALIFIED
        logger.log({ type: "ships_placed", timestamp: new Date().toISOString(), gameOrdinal: currentOrdinal });
        state = await placeShips(agent, agentId, layout);
        continue;
      }

      if (state.nextRequiredMove === "SUBMIT_SHOT" || (state.nextRequiredMove as unknown as string) === "submit_shot") {
        const learnedHits = getLearnedHits(currentOpponentId);
        const decision = strategy.pickShot({
          yourShots: state.yourShots,
          opponentShips: state.opponentShips,
          learnedHits,
        });

        state = await submitShot(agent, agentId, decision.row, decision.col);

        // The shot outcome is in the updated state's yourShots (last entry).
        const lastShot = state.yourShots[state.yourShots.length - 1];
        const outcome = lastShot?.outcome ?? "MISS";

        const move = buildMoveMetric(decision.row, decision.col, outcome, decision.mode, decision.meta);
        currentMoves.push(move);

        logger.log({
          type: "move",
          timestamp: move.timestamp,
          row: decision.row,
          col: decision.col,
          outcome,
          mode: decision.mode,
          meta: decision.meta,
        });

        process.stdout.write(
          `  [${String(currentMoves.length).padStart(2)}] (${decision.row},${decision.col}) ` +
            `${outcome.padEnd(4)} [${decision.mode}]\n`
        );
        continue;
      }
    }

    logger.log({
      type: "error",
      timestamp: new Date().toISOString(),
      message: `Unexpected state`,
      context: {
        responseType,
        nextRequiredMove: state.nextRequiredMove,
        opponentId: state.opponentId,
        gameOrdinal: state.gameOrdinal,
      },
    });
    console.error(`Unexpected state: responseType=${responseType} nextRequiredMove=${state.nextRequiredMove}`);
    console.error("Full state:", JSON.stringify(state, null, 2));
    break;
  }

  await logger.close();
}
