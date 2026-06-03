/**
 * learning.ts — Cross-attempt self-improvement via shot history
 *
 * Motivation: opponents are deterministic — they place ships in the same
 * positions every attempt. After attempt 1, we know which cells were HITs.
 * On attempt 2, we fire those cells first, converging on each opponent's
 * exact layout in ~2-3 attempts.
 *
 * Storage: data/history.json — append-only array of GameRecord.
 *   Each record: { opponentId, gameOrdinal, shots: [{row, col, outcome}] }
 *
 * getLearnedHits() returns hit cells sorted by frequency across all past games
 * against that opponent. High-frequency cells = high confidence in ship location.
 *
 * Used by: strategies/probability.ts (checks learned hits first before density)
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { GameRecord } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.resolve(__dirname, "../data/history.json");

function loadHistory(): GameRecord[] {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, "utf8")) as GameRecord[];
  } catch {
    return [];
  }
}

function saveHistory(records: GameRecord[]): void {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(records, null, 2));
}

export function appendGameRecord(record: GameRecord): void {
  const history = loadHistory();
  history.push(record);
  saveHistory(history);
}

/** Returns cells that were HIT against this opponent in past games, ordered by frequency. */
export function getLearnedHits(opponentId: string): Array<{ row: number; col: number }> {
  const history = loadHistory();
  const freq = new Map<string, number>();

  for (const record of history) {
    if (record.opponentId !== opponentId) continue;
    for (const shot of record.shots) {
      if (shot.outcome === "HIT" || shot.outcome === "SUNK") {
        const key = `${shot.row},${shot.col}`;
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
    }
  }

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => {
      const [row, col] = key.split(",").map(Number);
      return { row, col };
    });
}
