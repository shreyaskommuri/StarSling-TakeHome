/**
 * auth.ts — Agent registration and JWT minting
 *
 * Uses the Agent Auth Protocol (OAuth device flow + signed JWTs) via @auth/agent.
 * Spec: https://intern-battleship-game-server.vercel.app
 *
 * Lifecycle:
 *   First run : discoverProvider → connectAgent → save agentId to data/agent.json
 *   Later runs: load agentId → signJwt only (never call connectAgent again)
 *
 * Storage design: KVStorage wraps a single in-memory `store` object backed by
 * data/agent.json. We use one shared store object for BOTH the SDK's internal
 * connection/keypair data AND our manually-tracked "agentId" key. Using two
 * separate loadStore() calls would cause the manual save to overwrite the SDK's
 * keypair on first run, breaking signJwt on all subsequent runs.
 *
 * JWT rules (enforced by server):
 *   - JWT is single-use: mint a fresh token per request.
 *   - Full capability list must be passed every time — server intersects with
 *     granted caps; omitting any returns 403.
 */
import { AgentAuthClient, KVStorage, KVStore } from "@auth/agent";
import * as fs from "fs";
import * as path from "path";

const AGENT_FILE = path.resolve(__dirname, "../data/agent.json");
const SERVER = "https://intern-battleship-game-server.vercel.app";

export const CAPABILITIES = [
  "getCompetitionRules",
  "createAttempt",
  "getCurrentAttempt",
  "placeShips",
  "submitShot",
  "abandonAttempt",
] as const;

function loadStore(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(AGENT_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveStore(store: Record<string, string>): void {
  fs.mkdirSync(path.dirname(AGENT_FILE), { recursive: true });
  fs.writeFileSync(AGENT_FILE, JSON.stringify(store, null, 2));
}

export async function initAuth(): Promise<{ agent: AgentAuthClient; agentId: string }> {
  // Single in-memory store shared by both KVStorage and our manual agentId key.
  // Critical: never call loadStore() a second time — any parallel write would
  // overwrite the SDK's keypair data that connectAgent writes on first run.
  const store = loadStore();
  const kv: KVStore = {
    async get(key: string) { return store[key] ?? null; },
    async set(key: string, value: string) { store[key] = value; saveStore(store); },
    async del(key: string) { delete store[key]; saveStore(store); },
  };
  const storage = new KVStorage(kv);
  const agent = new AgentAuthClient({ storage });

  let agentId = store["agentId"];

  if (!agentId) {
    console.log("First run: registering agent...");
    const provider = await agent.discoverProvider(SERVER);
    // CapabilityRequestItem = string | { name, constraints } so string[] is valid.
    // Spread removes the readonly constraint without an unsafe cast.
    const result = await agent.connectAgent({
      provider: provider.issuer,
      capabilities: [...CAPABILITIES],
    });
    if (result.status !== "active") {
      throw new Error(
        `Agent registration returned status "${result.status}" — ` +
          `approval may be required. Check the competition portal and re-run.`
      );
    }
    agentId = result.agentId;
    // Write through kv so the shared store stays consistent and
    // the SDK's keypair data already written to disk is preserved.
    await kv.set("agentId", agentId);
    console.log(`Agent registered: ${agentId}`);
  } else {
    console.log(`Using existing agent: ${agentId}`);
  }

  return { agent, agentId };
}

export async function mintToken(agent: AgentAuthClient, agentId: string): Promise<string> {
  const { token } = await agent.signJwt({
    agentId,
    capabilities: [...CAPABILITIES],
  });
  return token;
}
