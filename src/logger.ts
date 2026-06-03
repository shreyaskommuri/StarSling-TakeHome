/**
 * logger.ts — Structured JSONL event logger
 *
 * Writes one JSON object per line to data/logs/{runId}.jsonl.
 * JSONL (newline-delimited JSON) is grep-able, streamable, and trivially
 * parseable: `cat data/logs/*.jsonl | jq 'select(.type=="move")'`
 *
 * Event types and what they answer:
 *   attempt_start  → which strategy ran, when
 *   game_start     → which opponent, which game number
 *   ships_placed   → placement confirmed (no layout stored — opponents may adapt)
 *   move           → row, col, outcome, mode (hunt/target/learned), strategy meta
 *   game_end       → shots, hits, accuracy, ships sunk, duration for this game
 *   attempt_end    → final score, total shots, outcome
 *   error          → unexpected server state or internal errors
 *
 * The log is the authoritative record of what happened. metrics.json aggregates
 * across attempts; logs let you audit individual decisions.
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { ShipClass, ShipPlacement } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type LogEvent =
  | { type: "attempt_start"; timestamp: string; runId: string; strategy: string }
  | { type: "game_start"; timestamp: string; opponentId: string; gameOrdinal: number }
  | { type: "move"; timestamp: string; row: number; col: number; outcome: string; shipClass?: ShipClass; mode: string; meta?: Record<string, unknown> }
  | { type: "game_end"; timestamp: string; opponentId: string; gameOrdinal: number; totalShots: number; hits: number; accuracy: number; shipsSunk: number; yourShipsLost?: number; opponentShipsLost?: number; won?: boolean; gameScore?: number; durationMs: number }
  | { type: "attempt_end"; timestamp: string; finalScore: number | null; outcome: string; gamesCompleted: number; totalShots: number; wins?: number; losses?: number; opponentShipsSunk?: number; agentShipsLost?: number; hitDifferential?: number; durationMs: number }
  | { type: "ships_placed"; timestamp: string; gameOrdinal: number; placements?: ShipPlacement[] }
  | { type: "error"; timestamp: string; message: string; context?: Record<string, unknown> };

export class Logger {
  private stream: fs.WriteStream;
  readonly logPath: string;

  constructor(runId: string) {
    const logDir = path.resolve(__dirname, "../data/logs");
    fs.mkdirSync(logDir, { recursive: true });
    this.logPath = path.join(logDir, `${runId}.jsonl`);
    this.stream = fs.createWriteStream(this.logPath, { flags: "a" });
  }

  log(event: LogEvent): void {
    this.stream.write(JSON.stringify(event) + "\n");
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}

export function makeRunId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
