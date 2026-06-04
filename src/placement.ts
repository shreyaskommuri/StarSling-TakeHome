/**
 * placement.ts — Random valid fleet layout generator
 *
 * Fleet: CARRIER(5), BATTLESHIP(4), CRUISER(3), SUBMARINE(3), DESTROYER(2)
 * Board: 10×10, 0-indexed. Ships may be adjacent but not overlapping.
 *
 * Placement rules (per server spec):
 *   HORIZONTAL: extends rightward — startCol + length ≤ 10
 *   VERTICAL:   extends downward  — startRow + length ≤ 10
 *
 * Strategy: randomize every game to prevent opponents from learning our layout.
 * Once incoming-shot history exists, sample random legal layouts and choose the
 * one with the lowest opponent/global early-shot danger score.
 * Validated locally before submission — illegal fleet = ATTEMPT_DISQUALIFIED (HTTP 200).
 */
import { ShipClass, ShipPlacement, Orientation } from "./types.js";
import { loadHistory } from "./learning.js";
import { AgentConfig, STABLE_713 } from "./config.js";

const SHIP_LENGTHS: Record<ShipClass, number> = {
  CARRIER: 5,
  BATTLESHIP: 4,
  CRUISER: 3,
  SUBMARINE: 3,
  DESTROYER: 2,
};

const SHIP_CLASSES: ShipClass[] = [
  "CARRIER",
  "BATTLESHIP",
  "CRUISER",
  "SUBMARINE",
  "DESTROYER",
];

function rnd(n: number): number {
  return Math.floor(Math.random() * n);
}

function cellsForPlacement(p: ShipPlacement): Array<{ row: number; col: number }> {
  const len = SHIP_LENGTHS[p.shipClass];
  return Array.from({ length: len }, (_, i) => ({
    row: p.orientation === "VERTICAL" ? p.startRow + i : p.startRow,
    col: p.orientation === "HORIZONTAL" ? p.startCol + i : p.startCol,
  }));
}

/**
 * Validates a fleet layout against all server rules.
 * Called before every placeShips() call — an invalid fleet returns
 * ATTEMPT_DISQUALIFIED (HTTP 200), not a 4xx error, so we must catch it here.
 * Throws with a descriptive message so bugs in generatePlacements() surface immediately.
 */
export function validatePlacements(placements: ShipPlacement[]): void {
  const seen = new Set<ShipClass>();
  const occupied = new Set<string>();

  if (placements.length !== SHIP_CLASSES.length) {
    throw new Error(`Expected ${SHIP_CLASSES.length} ships, got ${placements.length}`);
  }

  for (const p of placements) {
    if (seen.has(p.shipClass)) throw new Error(`Duplicate ship class: ${p.shipClass}`);
    seen.add(p.shipClass);

    const len = SHIP_LENGTHS[p.shipClass];

    if (p.orientation === "HORIZONTAL") {
      if (p.startRow < 0 || p.startRow > 9) throw new Error(`${p.shipClass}: startRow ${p.startRow} out of bounds`);
      if (p.startCol < 0 || p.startCol + len > 10) throw new Error(`${p.shipClass}: HORIZONTAL extends out of bounds`);
      for (let i = 0; i < len; i++) {
        const cell = `${p.startRow},${p.startCol + i}`;
        if (occupied.has(cell)) throw new Error(`${p.shipClass}: overlaps at ${cell}`);
        occupied.add(cell);
      }
    } else {
      if (p.startCol < 0 || p.startCol > 9) throw new Error(`${p.shipClass}: startCol ${p.startCol} out of bounds`);
      if (p.startRow < 0 || p.startRow + len > 10) throw new Error(`${p.shipClass}: VERTICAL extends out of bounds`);
      for (let i = 0; i < len; i++) {
        const cell = `${p.startRow + i},${p.startCol}`;
        if (occupied.has(cell)) throw new Error(`${p.shipClass}: overlaps at ${cell}`);
        occupied.add(cell);
      }
    }
  }

  for (const shipClass of SHIP_CLASSES) {
    if (!seen.has(shipClass)) throw new Error(`Missing required ship: ${shipClass}`);
  }
}

function generateRandomPlacements(): ShipPlacement[] {
  const occupied = new Set<string>();
  const placements: ShipPlacement[] = [];

  for (const shipClass of SHIP_CLASSES) {
    const len = SHIP_LENGTHS[shipClass];
    let placed = false;

    while (!placed) {
      const orientation: Orientation = rnd(2) === 0 ? "HORIZONTAL" : "VERTICAL";
      const maxRow = orientation === "VERTICAL" ? 10 - len : 9;
      const maxCol = orientation === "HORIZONTAL" ? 10 - len : 9;
      const startRow = rnd(maxRow + 1);
      const startCol = rnd(maxCol + 1);

      const cells: string[] = [];
      for (let i = 0; i < len; i++) {
        const r = orientation === "VERTICAL" ? startRow + i : startRow;
        const c = orientation === "HORIZONTAL" ? startCol + i : startCol;
        cells.push(`${r},${c}`);
      }

      if (cells.every((c) => !occupied.has(c))) {
        cells.forEach((c) => occupied.add(c));
        placements.push({ shipClass, orientation, startRow, startCol });
        placed = true;
      }
    }
  }

  return placements;
}

function incomingShotWeight(turn: number, targeted: boolean): number {
  if (targeted) {
    if (turn <= 10) return 4;
    if (turn <= 20) return 2;
    if (turn <= 35) return 1;
    return 0.25;
  }
  return 1 / turn;
}

function isTargetedDefenseOpponent(opponentId: string | undefined, config: AgentConfig): boolean {
  return Boolean(
    opponentId &&
      config.targetedDefense.enabled &&
      config.targetedDefense.opponents.includes(opponentId)
  );
}

function buildDangerMap(opponentId?: string, config: AgentConfig = STABLE_713): { danger: number[][]; recordsUsed: number; targeted: boolean } {
  const history = loadHistory();
  const targeted = isTargetedDefenseOpponent(opponentId, config);
  const opponentRecords = opponentId
    ? history.filter((r) => r.opponentId === opponentId && r.incomingShots?.length)
    : [];
  const records = targeted && opponentRecords.length < config.targetedDefense.minRecords
    ? []
    : opponentRecords.length >= 2
    ? opponentRecords
    : history.filter((r) => r.incomingShots?.length);

  const danger = Array.from({ length: 10 }, () => new Array(10).fill(0));
  for (const record of records) {
    for (const [idx, shot] of (record.incomingShots ?? []).entries()) {
      if (shot.row < 0 || shot.row > 9 || shot.col < 0 || shot.col > 9) continue;
      danger[shot.row][shot.col] += incomingShotWeight(idx + 1, targeted);
    }
  }

  return { danger, recordsUsed: records.length, targeted };
}

function scorePlacement(placements: ShipPlacement[], danger: number[][], config: AgentConfig, targeted: boolean): number {
  let score = 0;
  const occupiedByShip: Array<{ row: number; col: number; shipClass: ShipClass }> = [];
  for (const placement of placements) {
    for (const cell of cellsForPlacement(placement)) {
      score += danger[cell.row][cell.col] * (targeted ? config.targetedDefense.dangerWeight : 1);
      occupiedByShip.push({ ...cell, shipClass: placement.shipClass });
    }
  }

  if (targeted) {
    for (let i = 0; i < occupiedByShip.length; i++) {
      for (let j = i + 1; j < occupiedByShip.length; j++) {
        if (occupiedByShip[i].shipClass === occupiedByShip[j].shipClass) continue;
        const distance =
          Math.abs(occupiedByShip[i].row - occupiedByShip[j].row) +
          Math.abs(occupiedByShip[i].col - occupiedByShip[j].col);
        if (distance === 1) score += config.targetedDefense.spacingAdjacentPenalty;
        else if (distance === 2) score += config.targetedDefense.spacingDistanceTwoPenalty;
      }
    }
  }

  return score;
}

export function generatePlacements(opponentId?: string, samples = 5000, config: AgentConfig = STABLE_713): ShipPlacement[] {
  const { danger, recordsUsed, targeted } = buildDangerMap(opponentId, config);
  if (recordsUsed === 0) return generateRandomPlacements();

  let best = generateRandomPlacements();
  let bestScore = scorePlacement(best, danger, config, targeted);
  for (let i = 1; i < samples; i++) {
    const candidate = generateRandomPlacements();
    const score = scorePlacement(candidate, danger, config, targeted);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

export function getPlacementStats(opponentId?: string, config: AgentConfig = STABLE_713): {
  recordsUsed: number;
  hottest: Array<{ row: number; col: number; danger: number }>;
  safest: Array<{ row: number; col: number; danger: number }>;
  selected: ShipPlacement[];
  targeted: boolean;
} {
  const { danger, recordsUsed, targeted } = buildDangerMap(opponentId, config);
  const cells = danger.flatMap((row, r) => row.map((value, c) => ({ row: r, col: c, danger: value })));
  return {
    recordsUsed,
    hottest: [...cells].sort((a, b) => b.danger - a.danger).slice(0, 10),
    safest: [...cells].sort((a, b) => a.danger - b.danger).slice(0, 10),
    selected: generatePlacements(opponentId, 5000, config),
    targeted,
  };
}
