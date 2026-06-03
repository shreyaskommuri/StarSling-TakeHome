/**
 * client.ts — Typed HTTP wrapper for the battleship competition server
 *
 * Server: https://intern-battleship-game-server.vercel.app
 * All endpoints live under /competitions/{COMP_ID}/
 *
 * Critical Content-Type rules (enforced by server):
 *   - Set "Content-Type: application/json" ONLY when sending a body.
 *   - Empty-body POSTs (createAttempt, abandonAttempt) must NOT include the header
 *     or the server returns 422.
 *
 * JWT: every request mints a fresh single-use JWT via mintToken().
 * Reusing a token returns 401.
 *
 * Response normalization:
 *   The server wraps all game data in a nested "state" key and uses different
 *   field names than our internal types (e.g. "opponent.opponentId" vs "opponentId",
 *   "sunkOpponentShipClasses" vs "opponentShips"). normalizeResponse() flattens
 *   this into GameStateEnvelope so the rest of the code never sees wire format.
 *
 * Placement wire format:
 *   Server expects { class, orientation, startRow, startCol } per ship.
 *   Our internal ShipPlacement uses { shipClass, ... }; transformed before send.
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

// ─── Wire format types (what the server actually returns) ─────────────────────

interface RawShot {
  row: number;
  col: number;
  outcome?: string;
  result?: string;   // server may use either field name
  shipClass?: string;
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
  finalScore?: number;
  disqualifyReason?: string;
  next?: RawResponse;
}

interface RawResponse {
  responseType: string;
  state?: RawGameState;
  // Some fields may appear at the top level on terminal states
  finalScore?: number;
  disqualifyReason?: string;
  next?: RawResponse;
}

// ─── Normalization ─────────────────────────────────────────────────────────────

function normalizeShots(raw: RawShot[] | undefined): Shot[] {
  return (raw ?? []).map((s) => ({
    row: s.row,
    col: s.col,
    outcome: ((s.outcome ?? s.result ?? "MISS").toUpperCase()) as ShotOutcome,
    shipClass: s.shipClass ? (s.shipClass.toUpperCase() as ShipClass) : undefined,
  }));
}

function normalizeResponse(raw: RawResponse): GameStateEnvelope {
  const s: RawGameState = raw.state ?? {};

  // Reconstruct opponentShips: server only tells us which classes are sunk.
  // We derive the full list from board.shipClasses so the strategy knows which
  // ships are still alive without having to track sunk state itself.
  const allClasses = s.board?.shipClasses ?? [];
  const sunkSet = new Set((s.sunkOpponentShipClasses ?? []).map((c) => c.toUpperCase()));
  const opponentShips: ShipStatus[] = allClasses.map((sc) => ({
    shipClass: sc.class.toUpperCase() as ShipClass,
    sunk: sunkSet.has(sc.class.toUpperCase()),
    hitCount: 0,
  }));

  const rawNext = s.next ?? raw.next;

  return {
    responseType: raw.responseType as ResponseType,
    nextRequiredMove: s.nextRequiredMove as NextRequiredMove | undefined,
    opponentId: s.opponent?.opponentId,
    gameOrdinal: s.gameOrdinal,
    yourShots: normalizeShots(s.yourShots),
    opponentShots: normalizeShots(s.incomingShots),
    yourShips: [],
    opponentShips,
    finalScore: s.finalScore ?? raw.finalScore,
    disqualifyReason: (s.disqualifyReason ?? raw.disqualifyReason) as DisqualifyReason | undefined,
    next: rawNext ? normalizeResponse(rawNext) : undefined,
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
  // Server expects { class, orientation, startRow, startCol } — uses "class" not "shipClass".
  const wirePlacements = placements.map((p) => ({
    class: p.shipClass,
    orientation: p.orientation,
    startRow: p.startRow,
    startCol: p.startCol,
  }));
  const raw = await request<RawResponse>(agent, agentId, "POST", "/attempts/current/placements", {
    placements: wirePlacements,
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
