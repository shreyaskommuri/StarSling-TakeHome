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
 * Error handling:
 *   HTTP 4xx/5xx → thrown as Error with status + body
 *   ATTEMPT_DISQUALIFIED → HTTP 200 (check responseType, not HTTP status!)
 */
import { AgentAuthClient } from "@auth/agent";
import { mintToken } from "./auth.js";
import { CompetitionRules, GameStateEnvelope, ShipPlacement } from "./types.js";

const SERVER = "https://intern-battleship-game-server.vercel.app";
const COMP_ID = "OMITTED_COMPETITION_ID";
const BASE = `${SERVER}/competitions/${COMP_ID}`;

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

  // Some endpoints return no body (204) or empty body
  const text = await res.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export async function getRules(agent: AgentAuthClient, agentId: string): Promise<CompetitionRules> {
  return request<CompetitionRules>(agent, agentId, "GET", "/rules");
}

export async function createAttempt(
  agent: AgentAuthClient,
  agentId: string
): Promise<GameStateEnvelope> {
  return request<GameStateEnvelope>(agent, agentId, "POST", "/attempts");
}

export async function getCurrentAttempt(
  agent: AgentAuthClient,
  agentId: string
): Promise<GameStateEnvelope> {
  return request<GameStateEnvelope>(agent, agentId, "GET", "/attempts/current");
}

export async function placeShips(
  agent: AgentAuthClient,
  agentId: string,
  placements: ShipPlacement[]
): Promise<GameStateEnvelope> {
  return request<GameStateEnvelope>(agent, agentId, "POST", "/attempts/current/placements", {
    placements,
  });
}

export async function submitShot(
  agent: AgentAuthClient,
  agentId: string,
  row: number,
  col: number
): Promise<GameStateEnvelope> {
  return request<GameStateEnvelope>(agent, agentId, "POST", "/attempts/current/shots", {
    row,
    col,
  });
}

export async function abandonAttempt(
  agent: AgentAuthClient,
  agentId: string
): Promise<void> {
  await request<unknown>(agent, agentId, "POST", "/attempts/current/abandon");
}
