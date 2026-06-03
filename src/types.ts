// ─── Game domain types ────────────────────────────────────────────────────────

export type ShipClass = "CARRIER" | "BATTLESHIP" | "CRUISER" | "SUBMARINE" | "DESTROYER";
export type Orientation = "HORIZONTAL" | "VERTICAL";
export type ShotOutcome = "HIT" | "MISS" | "SINK";
export type ResponseType =
  | "MOVE_REQUIRED"
  | "GAME_COMPLETED"
  | "ATTEMPT_COMPLETED"
  | "ATTEMPT_DISQUALIFIED";
export type NextRequiredMove = "PLACE_SHIPS" | "SUBMIT_SHOT";
export type DisqualifyReason = "TIMEOUT" | "ILLEGAL_MOVE" | "ABANDONED";

export interface ShipPlacement {
  shipClass: ShipClass;
  orientation: Orientation;
  startRow: number;
  startCol: number;
}

export interface Shot {
  row: number;
  col: number;
  outcome: ShotOutcome;
  shipClass?: ShipClass;
}

export interface ShipStatus {
  shipClass: ShipClass;
  sunk: boolean;
  hitCount: number;
}

export interface GameState {
  responseType: ResponseType;
  nextRequiredMove?: NextRequiredMove;
  gameId?: string;
  opponentId?: string;
  yourShots: Shot[];
  opponentShots: Shot[];
  yourShips: ShipStatus[];
  opponentShips: ShipStatus[];
  gameOrdinal?: number;
  next?: GameStateEnvelope;
  finalScore?: number;
  wins?: number;
  losses?: number;
  hitDifferential?: number;
  opponentShipsSunk?: number;
  agentShipsLost?: number;
  isNewBest?: boolean;
  completionMessage?: string;
  won?: boolean;
  yourShipsLost?: number;
  opponentShipsLost?: number;
  gameScore?: number;
  disqualifyReason?: DisqualifyReason;
}

export interface GameStateEnvelope extends GameState {}

export interface CompetitionRules {
  boardSize: number;
  ships: { shipClass: ShipClass; length: number }[];
}

// ─── History / learning types ─────────────────────────────────────────────────

export interface HistoryShot {
  row: number;
  col: number;
  outcome: ShotOutcome;
  shipClass?: ShipClass;
}

export interface GameRecord {
  opponentId: string;
  gameOrdinal: number;
  shots: HistoryShot[];
  incomingShots?: HistoryShot[];
}

// ─── Observability types ──────────────────────────────────────────────────────

/**
 * Targeting mode at the time a shot was fired.
 * - learned: cell was taken from prior-attempt history for this opponent
 * - target: active unsunk hit(s) on board; density is focused around them
 * - hunt:   no active hits; density reflects pure placement probability
 * - resumed: shot was already on the board when we reconnected mid-game
 */
export type ShotMode = "learned" | "target" | "hunt" | "resumed";

export interface MoveMetric {
  timestamp: string;
  row: number;
  col: number;
  outcome: ShotOutcome;
  shipClass?: ShipClass;
  mode: ShotMode;
  meta?: Record<string, unknown>;
}

export interface GameMetric {
  opponentId: string;
  gameOrdinal: number;
  won?: boolean;
  gameScore?: number;
  totalShots: number;
  hits: number;
  misses: number;
  accuracy: number;
  shipsSunk: number;
  yourShipsLost?: number;
  opponentShipsLost?: number;
  durationMs: number;
  moves: MoveMetric[];
}

export interface AttemptMetric {
  id: string;
  timestamp: string;
  strategy: string;
  finalScore: number | null;
  outcome: "completed" | "disqualified" | "error";
  disqualifyReason?: DisqualifyReason;
  wins?: number;
  losses?: number;
  hitDifferential?: number;
  opponentShipsSunk?: number;
  agentShipsLost?: number;
  isNewBest?: boolean;
  gamesCompleted: number;
  totalShots: number;
  avgShotsPerGame: number;
  avgAccuracy: number;
  bestGame: { opponentId: string; shots: number } | null;
  worstGame: { opponentId: string; shots: number } | null;
  durationMs: number;
  games: GameMetric[];
}

// ─── Strategy types ───────────────────────────────────────────────────────────

export interface ShotContext {
  yourShots: Shot[];
  opponentShips: ShipStatus[];
  learnedHits: Array<{ row: number; col: number }>;
}

export interface ShotDecision {
  row: number;
  col: number;
  mode: ShotMode;
  meta?: Record<string, unknown>;
}

export interface ITargetingStrategy {
  readonly name: string;
  pickShot(context: ShotContext): ShotDecision;
}
