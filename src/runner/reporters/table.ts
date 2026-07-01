import type { EvalResult, RunSummary, Usage } from "../../types.ts";
import { t } from "../../i18n/index.ts";

const OUTCOME_ORDER: Record<string, number> = {
  failed: 0,
  errored: 1,
  skipped: 2,
  passed: 3,
};

const OUTCOME_SYM: Record<string, string> = {
  passed: "✓",
  failed: "✗",
  errored: "!",
  skipped: "○",
};

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
  outcome: EvalResult["outcome"];
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
        formatOutcome(evalRow.outcome),
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

  return `${lines.join("\n")}\n\n`;
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

export function formatCost(n: number | undefined): string {
  if (n === undefined || n <= 0) return "$0";
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

export function formatOutcome(outcome: string): string {
  const sym = OUTCOME_SYM[outcome] ?? "?";
  switch (outcome) {
    case "passed": return `${sym} ${t("report.passed")}`;
    case "failed": return `${sym} ${t("report.failed")}`;
    case "errored": return `${sym} ${t("report.errored")}`;
    case "skipped": return `${sym} ${t("report.skipped")}`;
    default: return `${sym} ${outcome}`;
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
      const outcome = foldEvalOutcome(evalResults);
      const representative =
        evalResults.find((r) => r.outcome === outcome) ??
        evalResults.find((r) => r.outcome !== "passed") ??
        evalResults[0]!;
      return {
        id,
        outcome,
        reason: outcome === "passed" ? t("report.passed") : reasonFor(representative),
        durationMs: avg(evalResults.map((r) => r.durationMs)),
        tokens: totalTokens(evalResults.map((r) => r.usage)),
        cost: sumMaybe(evalResults.map((r) => r.estimatedCostUSD)),
        passedAttempts: evalResults.filter((r) => r.outcome === "passed").length,
        attempts: evalResults.length,
      };
    })
    .sort((a, b) => OUTCOME_ORDER[a.outcome] - OUTCOME_ORDER[b.outcome] || a.id.localeCompare(b.id));
}

function evalLevelStats(results: EvalResult[]) {
  const byEval = new Map<string, EvalResult[]>();
  for (const r of results) byEval.set(r.id, [...(byEval.get(r.id) ?? []), r]);
  const counts = { passed: 0, failed: 0, errored: 0, skipped: 0 };
  for (const group of byEval.values()) counts[foldEvalOutcome(group)] += 1;
  const ran = counts.passed + counts.failed + counts.errored;
  return { evals: byEval.size, ...counts, passRate: ran ? counts.passed / ran : 0 };
}

function foldEvalOutcome(results: EvalResult[]): EvalResult["outcome"] {
  const outcomes = results.map((r) => r.outcome);
  if (outcomes.some((o) => o === "passed")) return "passed";
  if (outcomes.some((o) => o === "failed")) return "failed";
  if (outcomes.some((o) => o === "errored")) return "errored";
  return "skipped";
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

function displayExperimentName(id: string | undefined): string | undefined {
  if (!id) return undefined;
  return id.split("/").filter(Boolean).at(-1) ?? id;
}

function fallbackExperimentLabel(result: EvalResult): string {
  if (result.experiment?.id) return displayExperimentName(result.experiment.id) ?? result.experiment.id;
  if (result.model) return `${result.agent}/${result.model}`;
  return result.agent || "ad hoc run";
}

function totalTokens(items: Array<Usage | undefined>): number {
  return items.reduce((n, u) => n + (u?.inputTokens ?? 0) + (u?.outputTokens ?? 0), 0);
}

function sumMaybe(items: Array<number | undefined>): number | undefined {
  const known = items.filter((n): n is number => n !== undefined);
  return known.length ? known.reduce((sum, n) => sum + n, 0) : undefined;
}

function avg(items: number[]): number {
  return items.length ? items.reduce((sum, n) => sum + n, 0) / items.length : 0;
}

function formatPercent(v: number): string {
  return `${Math.round(v * 100)}%`;
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
