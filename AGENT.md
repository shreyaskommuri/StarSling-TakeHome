# Battleship Agent — StarSling Challenge

## Quick Reference

- **Server**: `https://intern-battleship-game-server.vercel.app`
- **Competition ID**: loaded from ignored `.env` as `COMPETITION_ID`
- **Auth**: Agent Auth Protocol (OAuth device flow + signed JWTs) via `@auth/agent` SDK
- **Credentials file**: `data/agent.json` — keypair + agentId, persisted via KVStorage
- **History file**: `data/history.json` — per-opponent shot outcomes for self-improvement
- **Language**: TypeScript, Node.js
- **Entry point**: `npx tsx src/index.ts`

---

## Session Recovery

If you pick this up mid-session:

1. Check `data/agent.json` — if it has an `agentId`, the agent is approved. **Never call `connectAgent` again.**
2. Check `data/history.json` — contains shot history per opponent from past attempts.
3. Run `npx tsx src/index.ts` to play an attempt.
4. If you get a 409 ACTIVE_ATTEMPT_EXISTS, run `npx tsx src/index.ts --abandon` to clear it first.

---

## Architecture

```
src/
  index.ts      Entry point. Parses --abandon flag. Calls auth → loop.
  auth.ts       AgentAuthClient with KVStorage over data/agent.json.
                First run: discoverProvider → connectAgent → save agentId.
                Later runs: load agentId → signJwt only (no connectAgent).
  client.ts     Typed HTTP wrapper. Mints a fresh JWT per request.
                Exports: getRules, createAttempt, placeShips, submitShot,
                         getCurrentAttempt, abandonAttempt.
  types.ts      All TypeScript interfaces: envelopes, state, rules, history.
  placement.ts  Returns a valid defensive/random fleet layout. Validates locally.
  strategies/
    probability.ts  Probability density targeting. Enumerates valid placements
                    for remaining ships given hits/misses, picks highest-density cell.
  learning.ts   Reads/writes data/history.json. Provides layout-aware learned
                hit cells for each opponentId that get prioritized in targeting.
  loop.ts       Game FSM. Drives responseType: MOVE_REQUIRED → GAME_COMPLETED
                → ATTEMPT_COMPLETED | ATTEMPT_DISQUALIFIED.
                Saves shot/incoming-shot history after each game.
data/
  agent.json    KVStorage backing file. Contains agentId + keypair.
                DO NOT DELETE — deletion forces re-approval.
  history.json  Per-opponent game history. Used by learning.ts.
```

---

## Auth: Critical Rules

- **KVStorage** over `data/agent.json` — never `MemoryStorage` (drops keypair on exit).
- **`connectAgent` runs ONCE** (first run, when no agentId in storage). After that, load agentId and call `signJwt` only.
- **JWT is single-use** — mint a fresh one per request, pass the full capability list every time.
- **Full capability list**: `["getCompetitionRules","createAttempt","getCurrentAttempt","placeShips","submitShot","abandonAttempt"]`
- Server intersects JWT capabilities with granted capabilities — omitting any returns 403.

```typescript
// First run only:
const provider = await agent.discoverProvider(SERVER);
const { agentId } = await agent.connectAgent({ provider: provider.issuer, capabilities });
saveAgentId(agentId);  // into data/agent.json

// Every run (including first, after connect):
const { token } = await agent.signJwt({ agentId, capabilities });
// Authorization: Bearer <token>
```

---

## Game Endpoints

All under `/competitions/{COMP}/`:

| Method | Path | Body | Notes |
|--------|------|------|-------|
| GET | `/rules` | — | Auto-granted, no body |
| POST | `/attempts` | — | No Content-Type header! Empty body = 422 if JSON CT set |
| POST | `/attempts/current/placements` | `{placements:[...]}` | JSON CT required |
| POST | `/attempts/current/shots` | `{row, col}` | JSON CT required |
| GET | `/attempts/current` | — | Read state after crash |
| POST | `/attempts/current/abandon` | — | No Content-Type header! |

**Critical**: Set `Content-Type: application/json` ONLY when sending a body. Empty-body POSTs with JSON CT return 422.

---

## Response Envelope FSM

```
createAttempt()
    │
    ▼
MOVE_REQUIRED
    ├─ nextRequiredMove = PLACE_SHIPS → placeShips(layout) → loop
    └─ nextRequiredMove = SUBMIT_SHOT → submitShot(cell) → loop
         │
         ├─ GAME_COMPLETED      → resp = resp.next → loop (keep playing)
         ├─ ATTEMPT_COMPLETED   → print finalScore, save history, done
         └─ ATTEMPT_DISQUALIFIED → print reason (TIMEOUT|ILLEGAL_MOVE|ABANDONED), done
```

GAME_COMPLETED has `.next` already embedded — do NOT call createAttempt again.

---

## Fleet Rules (Standard v1)

- Board: 10×10, 0-indexed (row 0..9, col 0..9)
- Ships: CARRIER(5), BATTLESHIP(4), CRUISER(3), SUBMARINE(3), DESTROYER(2)
- HORIZONTAL: extends rightward — startCol + length ≤ 10
- VERTICAL: extends downward — startRow + length ≤ 10
- No overlaps. Adjacency allowed.
- Exactly one of each class. All 5 required.
- **Validate locally before sending** — illegal fleet = instant ATTEMPT_DISQUALIFIED (HTTP 200, not 4xx)

---

## Strategy

### Placement (placement.ts)
Random but valid until incoming-shot history exists. Then sample legal layouts and choose the lowest-danger layout from opponent/global incoming-shot heatmaps.

### Targeting (strategies/probability.ts) — Probability Density Map
1. Build set of all tried cells from `state.yourShots`.
2. For each unsunk ship class, enumerate ALL valid board positions (up to 200 per ship).
3. Build density map: `density[r][c]` = count of valid placements that include cell (r,c).
4. Active hits are split into connected components; target mode focuses one unresolved component at a time.
5. Shoot the highest-density untried cell.

This is strictly better than hunt/target: uses ALL information (hits AND misses) to narrow down ship locations.

### Self-Improvement (learning.ts)
- After each game, append `{opponentId, gameOrdinal, shots, incomingShots}` to `data/history.json`.
- When selecting the next shot, first check repeated layout fingerprints and high-confidence frequent hit cells from `history[opponentId]` that haven't been tried yet this game → shoot those first.
- Over 2–3 attempts, we converge on each opponent's exact layout → can sink them in 17 shots minimum.

---

## Scoring (maximize this)

Per game:
- +1 × (cells you hit) — agentHitPoints
- Sink bonuses: CARRIER +10, BATTLESHIP +8, CRUISER +7, SUBMARINE +6, DESTROYER +4
- +opponent base score (14 for SCOUT, 15 for WARSHIP) if you WIN
- −2 per your ship sunk (flat) − class penalty (same values as sink bonuses)

Opponents: 5 SCOUT (base 14) then 10 WARSHIP (base 15), fixed order.
Perfect score: 1000 (win all 15, lose zero ships).

Latest validated metric shape: attempt summaries/stats include `wins`, `losses`,
`opponentShipsSunk`, `agentShipsLost`, and `hitDifferential` when the server returns
them. Per-game terminal responses have not exposed per-game survival fields so far.

---

## Error Handling

| HTTP Status | Meaning | Action |
|-------------|---------|--------|
| 401 | Invalid/reused JWT | Mint fresh JWT (already done per-request) |
| 403 | Capability missing from JWT | Always pass full capability list to signJwt |
| 404 NO_ACTIVE_ATTEMPT | No active attempt | Call createAttempt first |
| 409 ACTIVE_ATTEMPT_EXISTS | Already have an active attempt | Run --abandon flag or call abandonAttempt |
| 409 SHIPS_ALREADY_PLACED | Already placed ships | Bug in FSM — check state.nextRequiredMove |
| 422 VALIDATION | Malformed request body | Check Content-Type and body shape |

ATTEMPT_DISQUALIFIED is HTTP 200 — check responseType, not HTTP status.

---

## Self-Improvement Loop (big picture)

```
Attempt 1: Random targeting + probability density
  → record all shot outcomes per opponent
Attempt 2: Learned hits prioritized → wins faster → less opponent fire → fewer penalties
Attempt 3+: Near-optimal, sinking opponents in ~17 shots
```

Over time, `data/history.json` accumulates a near-complete map of each opponent's layout.
When we've seen enough hits to reconstruct a ship's full location, we can predict the rest
and skip hunt phase entirely for that ship.

---

## Dependencies

```json
{
  "@auth/agent": "latest",
  "typescript": "^5",
  "tsx": "^4",
  "@types/node": "^20"
}
```

---

## Commands

```bash
npm install                          # install deps
npx tsx src/index.ts                    # play one attempt
npx tsx src/index.ts --stats            # print score history
npx tsx src/index.ts --placement-stats  # inspect defensive placement heatmap
npx tsx src/index.ts --abandon          # abandon active attempt and exit
npx tsx src/index.ts --rules            # print competition rules and exit
```
