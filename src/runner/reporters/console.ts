// 控制台报告器:流式逐行输出,失败断言内联展开,末尾出效率三件套(时间 / token / $)。

import type { EvalResult, Reporter, RunSummary } from "../../types.ts";

const SYMBOL: Record<string, string> = {
  passed: "✓",
  failed: "✗",
  scored: "~",
  skipped: "○",
};

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function fmtDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(0)}s`;
  return `${ms}ms`;
}

export function Console(): Reporter {
  return {
    onRunStart(evals) {
      process.stdout.write(`\n发现 ${evals.length} 个 eval\n\n`);
    },
    onEvalComplete(result: EvalResult) {
      const sym = SYMBOL[result.verdict] ?? "?";
      const tok = result.usage ? (result.usage.inputTokens ?? 0) + (result.usage.outputTokens ?? 0) : 0;
      const cost = result.estimatedCostUSD !== undefined ? `  $${result.estimatedCostUSD.toFixed(3)}` : "";
      const who = result.model ? `${result.agent}/${result.model}` : result.agent;
      const meta = `(${fmtDuration(result.durationMs)}  ${fmtTokens(tok)} tok${cost})`;
      process.stdout.write(`  ${sym} ${result.id}  [${who}]  ${meta}\n`);

      if (result.skipReason) {
        process.stdout.write(`      ○ skipped: ${result.skipReason}\n`);
      }
      if (result.error) {
        process.stdout.write(`      ! error: ${truncate(result.error, 400)}\n`);
      }
      for (const a of result.assertions) {
        if (a.passed) continue;
        const sev = a.severity === "gate" ? "gate" : "soft";
        const thr = a.threshold !== undefined ? ` (got ${a.score.toFixed(2)} < ${a.threshold})` : "";
        process.stdout.write(`      - ${sev}: ${a.name}${thr}${a.detail ? ` — ${truncate(a.detail, 300)}` : ""}\n`);
      }
    },
    onRunComplete(summary: RunSummary) {
      const tok = (summary.usage?.inputTokens ?? 0) + (summary.usage?.outputTokens ?? 0);
      const cost = summary.estimatedCostUSD !== undefined ? ` · $${summary.estimatedCostUSD.toFixed(2)}` : "";
      process.stdout.write(
        `\n结果:${summary.passed} passed, ${summary.failed} failed, ${summary.scored} scored, ${summary.skipped} skipped` +
          `  (${fmtDuration(summary.durationMs)} · ${fmtTokens(tok)} tok${cost})\n\n`,
      );
    },
  };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
