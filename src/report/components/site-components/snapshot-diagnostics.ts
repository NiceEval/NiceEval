// SnapshotDiagnostics 的聚合层:把 snapshotDiagnosticsData 的产物按来源 experiment 分组,
// web / text 两面共用(docs/feature/reports/components/site/run-diagnostics.md)。
// 输入已经由 snapshotDiagnosticsData 按 experiment id 字典序、组内 startedAt 新到旧排好序,
// 这里只按 experimentId 分桶,不重新排序、不跨来源合并 DiagnosticRecord。

import type { DiagnosticRecord } from "../../../types.ts";
import type { SnapshotDiagnosticsData, SnapshotDiagnosticsItem } from "../../model/types.ts";
import { localeText, type ReportLocale, type ReportMessageKey } from "../../model/locale.ts";

export interface SnapshotDiagnosticsGroup {
  experimentId: string;
  /** 该实验贡献的来源快照,已按 startedAt 新到旧排列;各自的 diagnostics 不跨快照合并。 */
  items: readonly SnapshotDiagnosticsItem[];
}

export interface GroupedSnapshotDiagnostics {
  /** 汇总行:涉及多少个 experiment、多少个 Run、多少条记录(按 count 计数)与最高严重度。 */
  summary: string;
  groups: readonly SnapshotDiagnosticsGroup[];
  /** 全部记录里的最高严重度;没有 error 记录时为 warning。空集合时也是 warning(不参与渲染)。 */
  severity: "warning" | "error";
}

function pluralText(
  locale: ReportLocale,
  base: "snapshotDiagnostics.summary.experiments" | "snapshotDiagnostics.summary.runs" | "snapshotDiagnostics.summary.records",
  n: number,
): string {
  return localeText(locale, `${base}.${n === 1 ? "one" : "other"}` as ReportMessageKey, { n });
}

/** 一条 DiagnosticRecord 折叠后的出现次数;省略等于 1。 */
export function occurrencesOf(record: DiagnosticRecord): number {
  return record.count ?? 1;
}

export function groupSnapshotDiagnostics(data: SnapshotDiagnosticsData, locale: ReportLocale): GroupedSnapshotDiagnostics {
  const byExperiment = new Map<string, SnapshotDiagnosticsItem[]>();
  for (const item of data) {
    const members = byExperiment.get(item.experimentId) ?? [];
    members.push(item);
    byExperiment.set(item.experimentId, members);
  }
  const groups: SnapshotDiagnosticsGroup[] = [...byExperiment.entries()].map(([experimentId, items]) => ({
    experimentId,
    items,
  }));

  let records = 0;
  let severity: "warning" | "error" = "warning";
  for (const item of data) {
    for (const d of item.diagnostics) {
      records += occurrencesOf(d);
      if (d.level === "error") severity = "error";
    }
  }

  const summary =
    data.length === 0
      ? ""
      : [
          pluralText(locale, "snapshotDiagnostics.summary.experiments", byExperiment.size),
          pluralText(locale, "snapshotDiagnostics.summary.runs", data.length),
          pluralText(locale, "snapshotDiagnostics.summary.records", records),
          localeText(locale, severity === "error" ? "snapshotDiagnostics.severity.error" : "snapshotDiagnostics.severity.warning"),
        ].join(" · ");

  return { summary, groups, severity };
}
