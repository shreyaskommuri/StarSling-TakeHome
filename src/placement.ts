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
 * Validated locally before submission — illegal fleet = ATTEMPT_DISQUALIFIED (HTTP 200).
 */
import { ShipClass, ShipPlacement, Orientation } from "./types.js";

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

export function generatePlacements(): ShipPlacement[] {
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
