// 控制台报告器:流式逐行输出,失败断言内联展开,末尾出效率三件套(时间 / token / $)。

import type { EvalResult, Reporter, RunSummary } from "../../types.ts";
import { t } from "../../i18n/index.ts";
import { formatCost, formatDuration, formatTokens, renderRunReport } from "./table.ts";
import { outcomeSymbol } from "./shared.ts";

export function Console(): Reporter {
  return {
    onRunStart(evals, _agent, shape) {
      // compare(多 agent / 多 model)或 runs>1 时,实际 attempt 数 > eval 数。头部如实报清,
      // 否则「本次运行 5 个 eval」会和末尾「5 passed, 5 failed」(按 attempt 计 10)对不上。
      const n = shape?.evals ?? evals.length;
      const extra =
        shape && shape.totalRuns > n
          ? t("report.runStartExtra", { configs: shape.configs, totalRuns: shape.totalRuns })
          : "";
      process.stdout.write(t("report.runStart", { count: n, extra, concurrency: shape?.maxConcurrency ?? "?" }));
    },
    onEvalComplete(result: EvalResult) {
      const sym = outcomeSymbol(result.outcome);
      const tok = (result.usage?.inputTokens ?? 0) + (result.usage?.outputTokens ?? 0);
      // requests > 0 但 tokens = 0 → agent 跑了但不上报用量(如 bub);显示 — 而非误导性的 0
      const tokStr = tok > 0 ? `${formatTokens(tok)} tok` : (result.usage?.requests ?? 0) > 0 ? `— tok` : `0 tok`;
      const cost = result.estimatedCostUSD !== undefined ? `  ${formatCost(result.estimatedCostUSD)}` : "";
      const who = result.model ? `${result.agent}/${result.model}` : result.agent;
      const meta = `(${formatDuration(result.durationMs)}  ${tokStr}${cost})`;
      const label = result.outcome === "passed" ? "" : ` ${formatOutcome(result.outcome)}`;
      process.stdout.write(`  ${sym} ${result.id}${label}  [${who}]  ${meta}\n`);

      if (result.skipReason) {
        process.stdout.write(`      ○ ${t("report.skipped")}: ${result.skipReason}\n`);
      }
      if (result.error) {
        process.stdout.write(`      ! ${t("report.error")}: ${truncate(result.error, 400)}\n`);
      }
      let lastGroup: string | undefined;
      for (const a of result.assertions) {
        if (a.passed) continue;
        if (a.group !== undefined && a.group !== lastGroup) {
          process.stdout.write(`      ▸ ${a.group}\n`);
        }
        lastGroup = a.group;
        const sev = a.severity === "gate" ? t("report.gate") : t("report.soft");
        const thr = a.threshold !== undefined
          ? t("report.assertionThreshold", { score: a.score.toFixed(2), threshold: a.threshold })
          : "";
        const indent = a.group !== undefined ? "        " : "      ";
        process.stdout.write(`${indent}- ${sev}: ${a.name}${thr}${a.detail ? ` — ${truncate(a.detail, 300)}` : ""}\n`);
      }
    },
    onRunComplete(summary: RunSummary) {
      process.stdout.write(renderRunReport(summary));
    },
  };
}

function formatOutcome(outcome: string): string {
  switch (outcome) {
    case "passed": return t("report.passed");
    case "failed": return t("report.failed");
    case "errored": return t("report.errored");
    case "skipped": return t("report.skipped");
    default: return outcome;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
