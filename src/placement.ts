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
import { ShipClass, ShipPlacement, Orientation } from "./types";

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
