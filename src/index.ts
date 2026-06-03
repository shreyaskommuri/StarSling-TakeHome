import { initAuth } from "./auth";
import { abandonAttempt, getRules } from "./client";
import { runAttempt } from "./loop";
import { Logger, makeRunId } from "./logger";
import { ProbabilityStrategy, BaselineStrategy } from "./strategies";
import { ITargetingStrategy } from "./types";
import { loadAllMetrics } from "./metrics";

const STRATEGIES: Record<string, ITargetingStrategy> = {
  probability: new ProbabilityStrategy(),
  baseline: new BaselineStrategy(),
};

function parseArgs(): { mode: string; strategyName: string } {
  const args = process.argv.slice(2);
  if (args.includes("--rules")) return { mode: "rules", strategyName: "probability" };
  if (args.includes("--abandon")) return { mode: "abandon", strategyName: "probability" };
  if (args.includes("--stats")) return { mode: "stats", strategyName: "probability" };

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
          `avgShots=${m.avgShotsPerGame.toFixed(1)} ` +
          `avgAcc=${(m.avgAccuracy * 100).toFixed(1)}%`
      );
    }
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
