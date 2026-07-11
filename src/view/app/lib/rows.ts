// viewData(官方数据契约 + 快照明细)→ 页面模型的纯拼接,零聚合口径:
// 榜单数字全部来自官方 MetricTable.data 的格子(server 侧算好),这里只把格子和
// 对应 latest 快照的证据室明细(attempt 列表、判定计数)接在一起;Runs / Traces 的
// 平铺列表来自全部快照(server 侧已跨快照去重)。

import type { ReactNode } from "react";
import type { RowRun, T } from "../shared.ts";
import type { SortKey, ViewData, ViewResult, ViewRow, ViewSnapshot } from "../types.ts";
import { evalLevelStats } from "../../../shared/verdict.ts";
import { displayExperimentName, fallbackExperimentLabel, sumMaybe } from "../../../shared/aggregate.ts";
import { formatConfigValue } from "./format.ts";

/** 默认报告格子的列键(= 内置指标的 metric.name,见 src/report/metrics.ts)。 */
export const CELL_KEYS = {
  passRate: "pass-rate",
  duration: "duration",
  tokens: "tokens",
  cost: "cost",
} as const;

/** 快照的展示标签:experiment id 的末段;合成键退化到 agent/model 兜底。 */
function snapshotLabel(snapshot: ViewSnapshot): string {
  if (snapshot.synthetic) {
    const first = snapshot.results[0];
    return first ? fallbackExperimentLabel(first) : snapshot.experimentId;
  }
  return displayExperimentName(snapshot.experimentId) ?? snapshot.experimentId;
}

function experimentGroup(snapshot: ViewSnapshot): string | undefined {
  if (snapshot.synthetic || !snapshot.experimentId.includes("/")) return undefined;
  return snapshot.experimentId.split("/").slice(0, -1).join("/");
}

/** 官方 TableData 行 × latest 快照 → 榜单行。行集合以官方表为准,快照只补证据室明细。 */
export function buildRows(data: ViewData): ViewRow[] {
  const latestByExperiment = new Map<string, ViewSnapshot>();
  for (const snapshot of data.snapshots) {
    if (snapshot.latest) latestByExperiment.set(snapshot.experimentId, snapshot);
  }
  const rows: ViewRow[] = [];
  for (const tableRow of data.table.rows) {
    const snapshot = latestByExperiment.get(tableRow.key);
    if (!snapshot) continue; // 官方表与快照来自同一次挑选,理论上不缺;缺了宁可不渲染半行
    const results = snapshot.results;
    const stats = evalLevelStats(results, (r) => r.id);
    rows.push({
      key: tableRow.key,
      experimentId: snapshot.experimentId,
      ...(snapshot.synthetic ? { synthetic: true } : {}),
      experiment: results[0]?.experiment,
      group: experimentGroup(snapshot),
      label: snapshotLabel(snapshot),
      agent: snapshot.agent,
      model: snapshot.model,
      lastRunAt: snapshot.startedAt,
      cells: tableRow.cells,
      runs: results.length,
      evals: stats.evals,
      passed: stats.passed,
      failed: stats.failed,
      errored: stats.errored,
      skipped: stats.skipped,
      totalCostUSD: sumMaybe(results.map((r) => r.usage?.costUSD ?? r.estimatedCostUSD)),
      results,
    });
  }
  return rows;
}

/** Runs / Traces 的平铺列表:全部快照(含历史)的 attempt,带所属实验的展示标注。 */
export function flattenAttempts(snapshots: ViewSnapshot[]): RowRun[] {
  return snapshots.flatMap((snapshot) => {
    const label = snapshotLabel(snapshot);
    return snapshot.results.map(
      (r): RowRun => ({ ...r, rowLabel: label, rowAgent: snapshot.agent, rowModel: r.model ?? snapshot.model }),
    );
  });
}

/** 旧版 ?modal= 深链的只读回退:在全部快照里按 (eval id, experimentId, attempt) 定位。 */
export function resultFromUrl(snapshots: ViewSnapshot[]): ViewResult | null {
  const p = new URLSearchParams(location.search);
  const id = p.get("modal");
  if (!id) return null;
  const exp = p.get("exp");
  const attempt = parseInt(p.get("a") ?? "0", 10);
  for (const snapshot of snapshots) {
    for (const result of snapshot.results) {
      if (result.id === id && (!exp || result.experimentId === exp) && result.attempt === attempt) {
        return result;
      }
    }
  }
  return null;
}

export function buildGroupMap(rows: ViewRow[]): Map<string, ViewRow[]> {
  const map = new Map<string, ViewRow[]>();
  for (const row of rows) {
    if (!row.group) continue;
    if (!map.has(row.group)) map.set(row.group, []);
    map.get(row.group)?.push(row);
  }
  return map;
}

export function compareRows(a: ViewRow, b: ViewRow, key: SortKey): number {
  const av = valueFor(a, key);
  const bv = valueFor(b, key);
  if (typeof av === "string" || typeof bv === "string") return String(av).localeCompare(String(bv));
  // 缺数据(null)沉底,与官方组件「缺数据不画 0」同一姿势。
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return Number(av) - Number(bv);
}

export function valueFor(row: ViewRow, key: SortKey): string | number | null {
  if (key === "experiment") return row.label;
  if (key === "model") return row.model || "";
  if (key === "agent") return row.agent;
  const cellKey =
    key === "passRate" ? CELL_KEYS.passRate : key === "duration" ? CELL_KEYS.duration : key === "tokens" ? CELL_KEYS.tokens : CELL_KEYS.cost;
  return row.cells[cellKey]?.value ?? null;
}

export function configChips(row: ViewRow, t: T): [string, ReactNode][] {
  const exp = row.experiment || {};
  const flags = exp.flags && Object.keys(exp.flags).length
    ? Object.entries(exp.flags).map(([k, v]) => k + "=" + formatConfigValue(v)).join(", ")
    : t("config.flagsNone");
  return [
    [t("config.experiment"), row.synthetic ? row.label : row.experimentId],
    [t("table.model"), row.model || t("config.default")],
    ["agent", row.agent],
    ["runs", exp.runs ?? row.runs],
    ["earlyExit", exp.earlyExit === undefined ? t("config.notApplicable") : String(exp.earlyExit)],
    ["sandbox", exp.sandbox || t("config.default")],
    ["budget", exp.budget === undefined ? t("config.none") : "$" + exp.budget],
    ["flags", flags],
  ];
}
