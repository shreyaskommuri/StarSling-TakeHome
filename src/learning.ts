/**
 * learning.ts — Cross-attempt self-improvement via shot history
 *
 * Motivation: opponents are deterministic — they place ships in the same
 * positions every attempt. After attempt 1, we know which cells were HITs.
 * On attempt 2, we fire those cells first, converging on each opponent's
 * exact layout in ~2-3 attempts.
 *
 * Storage: data/history.json — append-only array of GameRecord.
 *   Each record: { opponentId, gameOrdinal, shots, incomingShots }
 *
 * getLearnedHits() returns high-confidence hit cells. If a repeated layout
 * fingerprint exists, cells from the most recent repeated layout come first;
 * otherwise cells are sorted by frequency across all past games.
 *
 * Used by: strategies/probability.ts (checks learned hits first before density)
 */
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { GameRecord } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = path.resolve(__dirname, "../data/history.json");

export function loadHistory(): GameRecord[] {
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

function recordSignature(record: GameRecord): string {
  const shotKey = record.shots.map((s) => `${s.row},${s.col},${s.outcome}`).join("|");
  const incomingKey = (record.incomingShots ?? []).map((s) => `${s.row},${s.col},${s.outcome}`).join("|");
  return `${record.opponentId}:${record.gameOrdinal}:${shotKey}:${incomingKey}`;
}

export function appendGameRecord(record: GameRecord): void {
  const history = loadHistory();
  const signature = recordSignature(record);
  if (history.some((r) => recordSignature(r) === signature)) return;
  history.push(record);
  saveHistory(history);
}

/**
 * Returns cells that were HIT in ≥2 past game records against this opponent.
 *
 * Cells confirmed across multiple records are reliable regardless of whether the
 * opponent uses a fixed or cycling layout — a fixed opponent's cells appear in
 * every record; a cycling opponent's cells appear in whichever records used the
 * same layout cycle. Returned sorted by frequency (highest confidence first).
 */
export function getLearnedHits(opponentId: string): Array<{ row: number; col: number }> {
  const history = loadHistory();
  const opponentRecords = history.filter((r) => r.opponentId === opponentId);
  if (opponentRecords.length === 0) return [];

  const freq = new Map<string, number>();
  const fingerprints = new Map<string, { count: number; lastIndex: number; cells: string[] }>();

  opponentRecords.forEach((record, idx) => {
    const cells = Array.from(
      new Set(
        record.shots
          .filter((shot) => shot.outcome === "HIT" || shot.outcome === "SINK")
          .map((shot) => `${shot.row},${shot.col}`)
      )
    ).sort();
    if (cells.length > 0) {
      const key = cells.join("|");
      const existing = fingerprints.get(key);
      fingerprints.set(key, {
        count: (existing?.count ?? 0) + 1,
        lastIndex: idx,
        cells,
      });
    }
  });

  for (const record of opponentRecords) {
    for (const shot of record.shots) {
      if (shot.outcome === "HIT" || shot.outcome === "SINK") {
        const key = `${shot.row},${shot.col}`;
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
    }
  }

  const recordCount = opponentRecords.length;
  const highConfidenceThreshold = Math.max(3, Math.ceil(recordCount * 0.5));
  const frequencyCells = Array.from(freq.entries())
    .filter(([, count]) => count >= highConfidenceThreshold)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => {
      const [row, col] = key.split(",").map(Number);
      return { key, row, col };
    });

  const repeatedLayout = Array.from(fingerprints.values())
    .filter((layout) => layout.count >= 2 && (layout.count >= 3 || layout.count / recordCount >= 0.5))
    .sort((a, b) => b.lastIndex - a.lastIndex)[0];

  if (!repeatedLayout) {
    return frequencyCells.map(({ row, col }) => ({ row, col }));
  }

  const seen = new Set<string>();
  const orderedKeys = [
    ...repeatedLayout.cells.sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0)),
    ...frequencyCells.map((cell) => cell.key),
  ].filter((key) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return orderedKeys.map((key) => {
    const [row, col] = key.split(",").map(Number);
    return { row, col };
  });
}
