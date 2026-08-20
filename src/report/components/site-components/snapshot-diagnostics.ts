import type {
  ClosedDiagnostic,
  SnapshotDiagnosticsData,
  SnapshotDiagnosticsItem,
} from "./content.ts";
import {
  localeText,
  type ReportLocale,
} from "../../model/locale.ts";

export interface SnapshotDiagnosticsGroup {
  readonly experimentId: string;
  readonly items: readonly SnapshotDiagnosticsItem[];
}

export interface GroupedSnapshotDiagnostics {
  readonly summary: string;
  readonly groups: readonly SnapshotDiagnosticsGroup[];
  readonly severity: "warning" | "error";
}

/** Collapsed diagnostic count; omission is one visible occurrence. */
export function occurrencesOf(diagnostic: ClosedDiagnostic): number {
  return diagnostic.count ?? 1;
}

/** Groups already-closed diagnostics without joining or changing any evidence fact. */
export function groupSnapshotDiagnostics(
  data: SnapshotDiagnosticsData,
  locale: ReportLocale,
): GroupedSnapshotDiagnostics {
  const byExperiment = new Map<string, SnapshotDiagnosticsItem[]>();
  for (const item of data) {
    const items = byExperiment.get(item.experimentId) ?? [];
    items.push(item);
    byExperiment.set(item.experimentId, items);
  }
  const groups = [...byExperiment.entries()].map(([experimentId, items]) => Object.freeze({
    experimentId,
    items: Object.freeze([...items]),
  }));
  let records = 0;
  let severity: "warning" | "error" = "warning";
  for (const item of data) {
    for (const diagnostic of item.diagnostics) {
      records += occurrencesOf(diagnostic);
      if (diagnostic.level === "error") severity = "error";
    }
  }
  const summary = data.length === 0
    ? ""
    : [
        localeText(locale, `snapshotDiagnostics.summary.experiments.${byExperiment.size === 1 ? "one" : "other"}`, {
          n: byExperiment.size,
        }),
        localeText(locale, `snapshotDiagnostics.summary.runs.${data.length === 1 ? "one" : "other"}`, { n: data.length }),
        localeText(locale, `snapshotDiagnostics.summary.records.${records === 1 ? "one" : "other"}`, { n: records }),
        localeText(locale, severity === "error" ? "snapshotDiagnostics.severity.error" : "snapshotDiagnostics.severity.warning"),
      ].join(" · ");
  return Object.freeze({ summary, groups: Object.freeze(groups), severity });
}
