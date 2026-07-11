import type { EvalResult, RunSummary, Usage } from "../../types.ts";
import { t } from "../../i18n/index.ts";
import { verdictSymbol } from "./shared.ts";
import { foldEvalVerdict, evalLevelStats as sharedEvalLevelStats } from "../../shared/verdict.ts";
// 展示口径(耗时/成本/百分比)与聚合小工具(标签/求和/排序)与 view 共用一份实现;
// console.ts 经这里 re-export formatDuration。
import { formatCost, formatDuration, formatPercent } from "../../shared/format.ts";
import { VERDICT_ORDER, avg, displayExperimentName, fallbackExperimentLabel, sumMaybe, totalTokens } from "../../shared/aggregate.ts";

export { formatCost, formatDuration } from "../../shared/format.ts";

interface ExperimentRow {
  key: string;
  label: string;
  model: string;
  agent: string;
  avgDurationMs: number;
  passRate: number;
  tokens: number;
  cost?: number;
  evals: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  attempts: number;
  results: EvalResult[];
}

interface EvalRow {
  id: string;
  verdict: EvalResult["verdict"];
  reason: string;
  durationMs: number;
  tokens: number;
  cost?: number;
  passedAttempts: number;
  attempts: number;
}

export function renderRunReport(summary: RunSummary): string {
  const rows = aggregateExperimentRows(summary.results);
  const lines: string[] = ["", t("report.table.experimentsTitle")];
  lines.push(renderTable(
    [
      t("report.table.experiment"),
      t("report.table.model"),
      t("report.table.agent"),
      t("report.table.avgDuration"),
      t("report.table.successRate"),
      t("report.table.tokens"),
      t("report.table.cost"),
      t("report.table.result"),
    ],
    rows.map((row) => [
      row.label,
      row.model,
      row.agent,
      formatDuration(row.avgDurationMs),
      formatPercent(row.passRate),
      formatTokens(row.tokens),
      formatCost(row.cost),
      formatResult(row),
    ]),
  ));

  for (const row of rows) {
    lines.push("", `${t("report.table.evalTitle")} ${row.label}`);
    lines.push(renderTable(
      [
        t("report.table.status"),
        t("report.table.eval"),
        t("report.table.reason"),
        t("report.table.duration"),
        t("report.table.tokens"),
        t("report.table.cost"),
        t("report.table.runs"),
      ],
      aggregateEvalRows(row.results).map((evalRow) => [
        formatVerdict(evalRow.verdict),
        evalRow.id,
        evalRow.reason,
        formatDuration(evalRow.durationMs),
        formatTokens(evalRow.tokens),
        formatCost(evalRow.cost),
        `${evalRow.passedAttempts}/${evalRow.attempts}`,
      ]),
      { maxWidth: 120, flexibleColumn: 2 },
    ));
  }

  const tok = (summary.usage?.inputTokens ?? 0) + (summary.usage?.outputTokens ?? 0);
  const tokStr = tok > 0 ? `${formatTokens(tok)} tok` : "— tok";
  const cost = summary.estimatedCostUSD !== undefined ? ` · ${formatCost(summary.estimatedCostUSD)}` : "";
  const parts = [
    t("report.summary.passed", { count: summary.passed }),
    t("report.summary.failed", { count: summary.failed }),
    ...(summary.errored > 0 ? [t("report.summary.errored", { count: summary.errored })] : []),
    t("report.summary.skipped", { count: summary.skipped }),
  ];
  lines.push(t("report.result", {
    parts: parts.join(", "),
    duration: formatDuration(summary.durationMs),
    tokens: tokStr,
    cost,
  }).trimEnd());
  lines.push(t("report.viewHint").trimEnd());

  return `${lines.join("\n")}\n\n`;
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatVerdict(verdict: string): string {
  const sym = verdictSymbol(verdict);
  switch (verdict) {
    case "passed": return `${sym} ${t("report.passed")}`;
    case "failed": return `${sym} ${t("report.failed")}`;
    case "errored": return `${sym} ${t("report.errored")}`;
    case "skipped": return `${sym} ${t("report.skipped")}`;
    default: return `${sym} ${verdict}`;
  }
}

function aggregateExperimentRows(results: EvalResult[]): ExperimentRow[] {
  const groups = new Map<string, EvalResult[]>();
  for (const result of results) {
    const key = result.experimentId ? `exp|||${result.experimentId}` : `legacy|||${result.agent}|||${result.model ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), result]);
  }

  return [...groups.entries()]
    .map(([key, groupResults]) => {
      const first = groupResults[0]!;
      const stats = evalLevelStats(groupResults);
      return {
        key,
        label: displayExperimentName(first.experimentId) ?? fallbackExperimentLabel(first),
        model: first.model ?? t("report.table.default"),
        agent: first.agent,
        avgDurationMs: avg(groupResults.map((r) => r.durationMs)),
        passRate: stats.passRate,
        tokens: totalTokens(groupResults.map((r) => r.usage)),
        cost: sumMaybe(groupResults.map((r) => r.estimatedCostUSD)),
        evals: stats.evals,
        passed: stats.passed,
        failed: stats.failed,
        errored: stats.errored,
        skipped: stats.skipped,
        attempts: groupResults.length,
        results: groupResults.slice().sort((a, b) => a.id.localeCompare(b.id) || a.attempt - b.attempt),
      };
    })
    .sort((a, b) => b.passRate - a.passRate || a.label.localeCompare(b.label));
}

function aggregateEvalRows(results: EvalResult[]): EvalRow[] {
  const byEval = new Map<string, EvalResult[]>();
  for (const result of results) byEval.set(result.id, [...(byEval.get(result.id) ?? []), result]);
  return [...byEval.entries()]
    .map(([id, evalResults]) => {
      const verdict = foldEvalVerdict(evalResults);
      const representative =
        evalResults.find((r) => r.verdict === verdict) ??
        evalResults.find((r) => r.verdict !== "passed") ??
        evalResults[0]!;
      return {
        id,
        verdict,
        reason: verdict === "passed" ? t("report.passed") : reasonFor(representative),
        durationMs: avg(evalResults.map((r) => r.durationMs)),
        tokens: totalTokens(evalResults.map((r) => r.usage)),
        cost: sumMaybe(evalResults.map((r) => r.estimatedCostUSD)),
        passedAttempts: evalResults.filter((r) => r.verdict === "passed").length,
        attempts: evalResults.length,
      };
    })
    .sort((a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.id.localeCompare(b.id));
}

// 折叠 / 计票口径与 view 同一份实现(src/shared/verdict.ts),CLI 表格和网页榜单永不打架。
function evalLevelStats(results: EvalResult[]) {
  return sharedEvalLevelStats(results, (r) => r.id);
}

function reasonFor(result: EvalResult): string {
  if (result.skipReason) return result.skipReason;
  if (result.error) return truncateOneLine(result.error, 120);
  const failed = result.assertions.filter((a) => !a.passed && a.severity === "gate");
  const assertions = failed.length ? failed : result.assertions.slice(0, 2);
  if (!assertions.length) return "";
  return truncateOneLine(
    assertions
      .map((a) => {
        const threshold = a.threshold !== undefined ? ` ${t("report.assertionThreshold", { score: a.score.toFixed(2), threshold: a.threshold }).trim()}` : "";
        return `${a.severity}: ${a.name}${threshold}`;
      })
      .join(" · "),
    120,
  );
}

function formatResult(row: ExperimentRow): string {
  const failures = row.failed + row.errored;
  const suffix = row.skipped > 0 ? ` · ${row.skipped} ${t("report.skipped")}` : "";
  return `${row.passed}/${row.evals} ${t("report.passed")} · ${failures} ${t("report.failed")}${suffix}`;
}







function renderTable(headers: string[], rows: string[][], opts: { maxWidth?: number; flexibleColumn?: number } = {}): string {
  const rawRows = [headers, ...rows];
  const widths = headers.map((_, col) => Math.max(...rawRows.map((row) => displayWidth(row[col] ?? ""))));
  const maxWidth = opts.maxWidth ?? 140;
  const tableWidth = widths.reduce((sum, w) => sum + w, 0) + (headers.length - 1) * 3;
  if (tableWidth > maxWidth && opts.flexibleColumn !== undefined) {
    const over = tableWidth - maxWidth;
    widths[opts.flexibleColumn] = Math.max(18, widths[opts.flexibleColumn]! - over);
  }

  const lines = [formatRow(headers, widths), widths.map((w) => "-".repeat(w)).join("-+-")];
  for (const row of rows) lines.push(formatRow(row, widths));
  return lines.join("\n");
}

function formatRow(row: string[], widths: number[]): string {
  return row.map((cell, i) => padEnd(truncateToWidth(cell ?? "", widths[i]!), widths[i]!)).join(" | ");
}

function truncateOneLine(s: string, width: number): string {
  return truncateToWidth(s.replace(/\s+/g, " ").trim(), width);
}

function truncateToWidth(s: string, width: number): string {
  if (displayWidth(s) <= width) return s;
  const ellipsis = "…";
  let out = "";
  for (const char of s) {
    if (displayWidth(out + char + ellipsis) > width) break;
    out += char;
  }
  return out + ellipsis;
}

function padEnd(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - displayWidth(s)));
}

function displayWidth(s: string): number {
  let width = 0;
  for (const char of s) {
    const code = char.codePointAt(0) ?? 0;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  );
}
