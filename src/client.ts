/**
 * client.ts — Typed HTTP wrapper for the battleship competition server
 *
 * Server: https://intern-battleship-game-server.vercel.app
 * Spec:   https://challenge.starsling.dev/docs
 * All game endpoints live under /competitions/{COMP_ID}/
 *
 * Content-Type rules:
 *   Set "Content-Type: application/json" ONLY when sending a body.
 *   Empty-body POSTs (createAttempt, abandonAttempt) must NOT include it.
 *
 * JWT: mint a fresh single-use token per request; reusing returns 401.
 *
 * Response normalization (normalizeResponse):
 *   All game data is nested under a "state" key on the wire. Field names
 *   also differ: opponent.opponentId, sunkOpponentShipClasses, etc.
 *   normalizeResponse() maps wire format → GameStateEnvelope so the rest
 *   of the codebase is isolated from the server's naming conventions.
 *
 * Placement wire format (per spec):
 *   { shipClass, orientation, startRow, startCol } — "shipClass" NOT "class".
 *   Our internal ShipPlacement uses the same names, so no transform needed.
 *
 * Shot outcome values (per spec): "MISS" | "HIT" | "SINK" (not "SUNK").
 *
 * Terminal response shapes (per spec):
 *   ATTEMPT_DISQUALIFIED → { responseType, reason, ranked, attemptId, context }
 *   ATTEMPT_COMPLETED    → { responseType, result: { finalScore, wins, ... } }
 *   GAME_COMPLETED       → { responseType, state, result, next }
 */
import { AgentAuthClient } from "@auth/agent";
import { mintToken } from "./auth.js";
import {
  CompetitionRules,
  GameStateEnvelope,
  ShipPlacement,
  ShipStatus,
  ShipClass,
  ShotOutcome,
  ResponseType,
  NextRequiredMove,
  DisqualifyReason,
  Shot,
} from "./types.js";

const SERVER = "https://intern-battleship-game-server.vercel.app";
const COMP_ID = "OMITTED_COMPETITION_ID";
const BASE = `${SERVER}/competitions/${COMP_ID}`;

// ─── Wire format types ─────────────────────────────────────────────────────────

interface RawShot {
  row: number;
  col: number;
  outcome?: string;
  sunkShipClass?: string;
}

interface RawGameState {
  competitionId?: string;
  gameOrdinal?: number;
  totalGames?: number;
  opponent?: { opponentId: string; displayName: string; opponentClass: string; baseScore: number };
  nextRequiredMove?: string;
  nextMoveDeadlineAt?: string;
  board?: {
    gridRows: number;
    gridCols: number;
    shipClasses: { class: string; length: number }[];
    allowAdjacency: boolean;
  };
  yourFleet?: unknown[];
  yourShots?: RawShot[];
  incomingShots?: RawShot[];
  sunkOpponentShipClasses?: string[];
}

interface RawResponse {
  responseType: string;
  state?: RawGameState;
  // ATTEMPT_DISQUALIFIED fields (top-level, not in state)
  reason?: string;
  ranked?: boolean;
  attemptId?: string;
  context?: { lastRequiredMove?: string; gameOrdinal?: number; opponentId?: string; deadlineAt?: string };
  // ATTEMPT_COMPLETED fields
  result?: {
    finalScore?: number;
    wins?: number;
    losses?: number;
    hitDifferential?: number;
    opponentShipsSunk?: number;
    agentShipsLost?: number;
    isNewBest?: boolean;
    completionMessage?: string;
    // GAME_COMPLETED result fields
    gameOrdinal?: number;
    won?: boolean;
    yourShipsLost?: number;
    opponentShipsLost?: number;
    gameScore?: number;
  };
  // GAME_COMPLETED: next game envelope at top level
  next?: RawResponse;
}

// ─── Normalization ─────────────────────────────────────────────────────────────

function normalizeShots(raw: RawShot[] | undefined): Shot[] {
  return (raw ?? []).map((s) => ({
    row: s.row,
    col: s.col,
    outcome: (s.outcome?.toUpperCase() ?? "MISS") as ShotOutcome,
    shipClass: s.sunkShipClass ? (s.sunkShipClass.toUpperCase() as ShipClass) : undefined,
  }));
}

function normalizeResponse(raw: RawResponse): GameStateEnvelope {
  const s: RawGameState = raw.state ?? {};

  // Reconstruct opponentShips from board definition + sunk list.
  // The server only reports which classes are sunk; we derive the full
  // ShipStatus[] so the strategy can compute which ships are still alive.
  const allClasses = s.board?.shipClasses ?? [];
  const sunkSet = new Set((s.sunkOpponentShipClasses ?? []).map((c) => c.toUpperCase()));
  const opponentShips: ShipStatus[] = allClasses.map((sc) => ({
    shipClass: sc.class.toUpperCase() as ShipClass,
    sunk: sunkSet.has(sc.class.toUpperCase()),
    hitCount: 0,
  }));

  return {
    responseType: raw.responseType as ResponseType,
    nextRequiredMove: s.nextRequiredMove as NextRequiredMove | undefined,
    opponentId: s.opponent?.opponentId,
    gameOrdinal: s.gameOrdinal,
    yourShots: normalizeShots(s.yourShots),
    opponentShots: normalizeShots(s.incomingShots),
    yourShips: [],
    opponentShips,
    // ATTEMPT_COMPLETED: score lives in result, not state
    finalScore: raw.result?.finalScore,
    // ATTEMPT_DISQUALIFIED: reason is top-level, not in state
    disqualifyReason: raw.reason as DisqualifyReason | undefined,
    // GAME_COMPLETED: next game envelope at top level
    next: raw.next ? normalizeResponse(raw.next) : undefined,
  };
}

// ─── HTTP layer ────────────────────────────────────────────────────────────────

async function request<T>(
  agent: AgentAuthClient,
  agentId: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = await mintToken(agent, agentId);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text}`);
  }

  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export async function getRules(agent: AgentAuthClient, agentId: string): Promise<CompetitionRules> {
  return request<CompetitionRules>(agent, agentId, "GET", "/rules");
}

export async function createAttempt(
  agent: AgentAuthClient,
  agentId: string
): Promise<GameStateEnvelope> {
  const raw = await request<RawResponse>(agent, agentId, "POST", "/attempts");
  return normalizeResponse(raw);
}

export async function getCurrentAttempt(
  agent: AgentAuthClient,
  agentId: string
): Promise<GameStateEnvelope> {
  const raw = await request<RawResponse>(agent, agentId, "GET", "/attempts/current");
  return normalizeResponse(raw);
}

export async function placeShips(
  agent: AgentAuthClient,
  agentId: string,
  placements: ShipPlacement[]
): Promise<GameStateEnvelope> {
  // Spec uses "shipClass" (same as our internal type) — no field rename needed.
  const raw = await request<RawResponse>(agent, agentId, "POST", "/attempts/current/placements", {
    placements,
  });
  return normalizeResponse(raw);
}

export async function submitShot(
  agent: AgentAuthClient,
  agentId: string,
  row: number,
  col: number
): Promise<GameStateEnvelope> {
  const raw = await request<RawResponse>(agent, agentId, "POST", "/attempts/current/shots", {
    row,
    col,
  });
  return normalizeResponse(raw);
}

export async function abandonAttempt(
  agent: AgentAuthClient,
  agentId: string
): Promise<void> {
  await request<unknown>(agent, agentId, "POST", "/attempts/current/abandon");
}
