import { initAuth } from "./auth.js";
import { abandonAttempt, getRules } from "./client.js";
import { runAttempt } from "./loop.js";
import { Logger, makeRunId } from "./logger.js";
import { ProbabilityStrategy, BaselineStrategy } from "./strategies/index.js";
import { ITargetingStrategy } from "./types.js";
import { loadAllMetrics } from "./metrics.js";
import { getPlacementStats } from "./placement.js";

const STRATEGIES: Record<string, ITargetingStrategy> = {
  probability: new ProbabilityStrategy(),
  baseline: new BaselineStrategy(),
};

function parseArgs(): { mode: string; strategyName: string } {
  const args = process.argv.slice(2);
  if (args.includes("--rules")) return { mode: "rules", strategyName: "probability" };
  if (args.includes("--abandon")) return { mode: "abandon", strategyName: "probability" };
  if (args.includes("--stats")) return { mode: "stats", strategyName: "probability" };
  if (args.includes("--placement-stats")) return { mode: "placement-stats", strategyName: "probability" };

  const strategyArg = args.find((a) => a.startsWith("--strategy="));
  const strategyName = strategyArg ? strategyArg.split("=")[1] : "probability";
  return { mode: "play", strategyName };
}

async function main(): Promise<void> {
  const { mode, strategyName } = parseArgs();

  // --stats reads local data only; skip network auth.
  if (mode === "stats") {
    const all = loadAllMetrics();
    if (all.length === 0) {
      console.log("No attempts recorded yet.");
      return;
    }
    for (const m of all) {
      console.log(
        `[${m.timestamp.slice(0, 19)}] strategy=${m.strategy} ` +
          `score=${m.finalScore ?? "DQ"} ` +
          `games=${m.gamesCompleted} ` +
          (m.wins !== undefined || m.losses !== undefined ? `record=${m.wins ?? "?"}-${m.losses ?? "?"} ` : "") +
          (m.agentShipsLost !== undefined ? `lost=${m.agentShipsLost} ` : "") +
          `avgShots=${m.avgShotsPerGame.toFixed(1)} ` +
          `avgAcc=${(m.avgAccuracy * 100).toFixed(1)}%`
      );
    }
    return;
  }

  if (mode === "placement-stats") {
    const opponentArg = process.argv.slice(2).find((a) => a.startsWith("--opponent="));
    const opponentId = opponentArg?.split("=")[1];
    const stats = getPlacementStats(opponentId);
    console.log(`Placement stats${opponentId ? ` for ${opponentId}` : ""}`);
    console.log(`Records used: ${stats.recordsUsed}`);
    console.log("Top targeted cells:");
    for (const c of stats.hottest) {
      console.log(`  (${c.row},${c.col}) danger=${c.danger.toFixed(3)}`);
    }
    console.log("Safest cells:");
    for (const c of stats.safest) {
      console.log(`  (${c.row},${c.col}) danger=${c.danger.toFixed(3)}`);
    }
    console.log("Selected defensive layout:");
    console.log(JSON.stringify(stats.selected, null, 2));
    return;
  }

  const { agent, agentId } = await initAuth();

  if (mode === "rules") {
    const rules = await getRules(agent, agentId);
    console.log(JSON.stringify(rules, null, 2));
    return;
  }

  if (mode === "abandon") {
    console.log("Abandoning active attempt...");
    await abandonAttempt(agent, agentId);
    console.log("Abandoned.");
    return;
  }

  const strategy = STRATEGIES[strategyName];
  if (!strategy) {
    console.error(`Unknown strategy: ${strategyName}. Available: ${Object.keys(STRATEGIES).join(", ")}`);
    process.exit(1);
  }

  const runId = makeRunId();
  const logger = new Logger(runId);
  console.log(`Log: ${logger.logPath}`);

  await runAttempt(agent, agentId, strategy, logger);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
