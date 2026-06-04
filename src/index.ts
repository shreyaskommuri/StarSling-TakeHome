import { initAuth } from "./auth.js";
import { abandonAttempt, getRules } from "./client.js";
import { runAttempt } from "./loop.js";
import { Logger, makeRunId } from "./logger.js";
import { ProbabilityStrategy, BaselineStrategy } from "./strategies/index.js";
import { ITargetingStrategy } from "./types.js";
import { loadAllMetrics, printOpponentReport, selectAttemptReport } from "./metrics.js";
import { getPlacementStats } from "./placement.js";
import { CONFIGS, getAgentConfig } from "./config.js";

function makeStrategies(configName?: string): Record<string, ITargetingStrategy> {
  const config = getAgentConfig(configName);
  return {
    probability: new ProbabilityStrategy(config),
    baseline: new BaselineStrategy(),
  };
}

function argValue(name: string): string | undefined {
  const arg = process.argv.slice(2).find((a) => a.startsWith(`${name}=`));
  return arg?.split("=")[1];
}

function parseArgs(): { mode: string; strategyName: string; configName: string } {
  const args = process.argv.slice(2);
  const configName = argValue("--config") ?? "targeted_defense_v1";
  if (args.includes("--rules")) return { mode: "rules", strategyName: "probability", configName };
  if (args.includes("--abandon")) return { mode: "abandon", strategyName: "probability", configName };
  if (args.includes("--stats")) return { mode: "stats", strategyName: "probability", configName };
  if (args.includes("--configs")) return { mode: "configs", strategyName: "probability", configName };
  if (args.includes("--compare-configs")) return { mode: "compare-configs", strategyName: "probability", configName };
  if (args.includes("--risk-report")) return { mode: "risk-report", strategyName: "probability", configName };
  if (args.some((a) => a === "--report" || a.startsWith("--report="))) return { mode: "report", strategyName: "probability", configName };
  if (args.includes("--placement-stats")) return { mode: "placement-stats", strategyName: "probability", configName };

  const strategyArg = args.find((a) => a.startsWith("--strategy="));
  const strategyName = strategyArg ? strategyArg.split("=")[1] : "probability";
  return { mode: "play", strategyName, configName };
}

async function main(): Promise<void> {
  const { mode, strategyName, configName } = parseArgs();
  const config = getAgentConfig(configName);

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
          `config=${m.configName ?? "untagged"} ` +
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

  if (mode === "configs") {
    for (const name of Object.keys(CONFIGS)) console.log(name);
    return;
  }

  if (mode === "compare-configs") {
    const completed = loadAllMetrics().filter((m) => m.outcome === "completed" && m.configName);
    const byConfig = new Map<string, typeof completed>();
    for (const metric of completed) {
      const key = metric.configName ?? "untagged";
      byConfig.set(key, [...(byConfig.get(key) ?? []), metric]);
    }
    for (const [name, metrics] of [...byConfig.entries()].sort()) {
      const avg = (values: number[]) => values.reduce((s, v) => s + v, 0) / Math.max(1, values.length);
      const scores = metrics.map((m) => m.finalScore ?? 0);
      const wins = metrics.map((m) => m.wins ?? 0);
      const lost = metrics.map((m) => m.agentShipsLost ?? 0);
      const sunk = metrics.map((m) => m.opponentShipsSunk ?? 0);
      console.log(
        `${name.padEnd(22)} runs=${String(metrics.length).padStart(2)} ` +
          `avgScore=${avg(scores).toFixed(1)} avgWins=${avg(wins).toFixed(1)} ` +
          `avgSunk=${avg(sunk).toFixed(1)} avgLost=${avg(lost).toFixed(1)} ` +
          `promotable=${metrics.length >= 2 && avg(scores) > 713 && Math.min(...wins) >= 15 ? "yes" : "no"}`
      );
    }
    return;
  }

  if (mode === "risk-report") {
    const completed = loadAllMetrics().filter((m) => m.outcome === "completed");
    const rows = new Map<string, { games: number; fourSunk: number; incomplete: number; shots: number; latestIncomplete: boolean }>();
    for (const metric of completed) {
      for (const game of metric.games) {
        const row = rows.get(game.opponentId) ?? { games: 0, fourSunk: 0, incomplete: 0, shots: 0, latestIncomplete: false };
        row.games++;
        row.fourSunk += game.shipsSunk === 4 ? 1 : 0;
        row.incomplete += game.hits < 16 ? 1 : 0;
        row.shots += game.totalShots;
        row.latestIncomplete = game.hits < 16;
        rows.set(game.opponentId, row);
      }
    }
    console.log("Opponent risk report (own-loss proxy: long 4-sink races + incomplete hits; server per-game own-loss fields are usually absent)");
    for (const [opponentId, row] of [...rows.entries()].sort((a, b) => b[1].incomplete - a[1].incomplete || b[1].shots / b[1].games - a[1].shots / a[1].games)) {
      console.log(
        `${opponentId.padEnd(24)} games=${String(row.games).padStart(2)} ` +
          `avgShots=${(row.shots / row.games).toFixed(1)} ` +
          `4sink=${row.fourSunk}/${row.games} incomplete=${row.incomplete}/${row.games}` +
          (row.latestIncomplete ? " latest_incomplete" : "")
      );
    }
    return;
  }

  if (mode === "report") {
    const reportArg = process.argv.slice(2).find((a) => a.startsWith("--report="));
    const kind = reportArg?.split("=")[1] === "best" ? "best" : "latest";
    const metric = selectAttemptReport(kind);
    if (!metric) {
      console.log("No completed attempts recorded yet.");
      return;
    }
    printOpponentReport(metric);
    return;
  }

  if (mode === "placement-stats") {
    const opponentArg = process.argv.slice(2).find((a) => a.startsWith("--opponent="));
    const opponentId = opponentArg?.split("=")[1];
    const stats = getPlacementStats(opponentId, config);
    console.log(`Placement stats${opponentId ? ` for ${opponentId}` : ""}`);
    console.log(`Records used: ${stats.recordsUsed}`);
    console.log(`Targeted defense: ${stats.targeted ? "yes" : "no"}`);
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

  const strategy = makeStrategies(config.name)[strategyName];
  if (!strategy) {
    console.error(`Unknown strategy: ${strategyName}. Available: ${Object.keys(makeStrategies(config.name)).join(", ")}`);
    process.exit(1);
  }

  const runId = makeRunId();
  const logger = new Logger(runId);
  console.log(`Log: ${logger.logPath}`);

  await runAttempt(agent, agentId, strategy, logger, config);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
