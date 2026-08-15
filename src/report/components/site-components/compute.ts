/**
 * Pure helpers that close already-selected display facts into site component
 * DTOs.  They do not accept a Sample, a reader, an attempt handle, or an
 * analysis result object.
 */

import type {
  ClosedFailureSummary,
  CopyFixPromptData,
  HeroData,
  SiteWarning,
  SnapshotDiagnosticsData,
  SnapshotDiagnosticsItem,
  TraceWaterfallData,
  TraceWaterfallRow,
} from "./content.ts";
import type { SampleSnapshot } from "../../../analysis/index.ts";

/** The only run fact Hero needs from an upstream closed projection. */
export interface HeroRunSummary {
  readonly startedAt: string | number;
}

/** Latest known start time and contributing Run count, with no invented clock. */
export function heroData(runs: readonly HeroRunSummary[]): HeroData {
  let latestMs: number | null = null;
  for (const run of runs) {
    const value = typeof run.startedAt === "number" ? run.startedAt : Date.parse(run.startedAt);
    if (Number.isFinite(value) && (latestMs === null || value > latestMs)) latestMs = value;
  }
  return Object.freeze({
    latestStartedAt: latestMs === null ? null : new Date(latestMs).toISOString(),
    runs: runs.length,
  });
}

/** Retains closed warnings in their supplied order without interpreting source state. */
export function scopeWarningsData(warnings: readonly SiteWarning[]): readonly SiteWarning[] {
  return Object.freeze([...warnings]);
}

/**
 * Closes the fixed Sample's selection and coverage facts into the familiar
 * zero-config notice component input. No Record capability or lazy
 * Analysis query is retained in the returned values.
 */
export function sampleWarningsData(snapshot: SampleSnapshot): readonly SiteWarning[] {
  const warnings: SiteWarning[] = snapshot.selection.problems.map((problem) => Object.freeze({
    code: problem.code,
    level: problem.code === "selection-run-unreadable" || problem.code === "record-core-invalid"
      ? "error" as const
      : "warning" as const,
    experimentId: snapshot.runs.find((run) => run.runId === problem.runId)?.experimentId,
    message: {
      en: `Run ${problem.runId} reported ${problem.code}.`,
      "zh-CN": `运行 ${problem.runId} 报告了 ${problem.code}。`,
    },
    action: `niceeval show --run ${problem.runId}`,
  }));
  if (snapshot.coverage.notRecorded > 0) {
    warnings.push(Object.freeze({
      code: "not-recorded",
      level: "warning" as const,
      message: {
        en: `${snapshot.coverage.notRecorded} selected slot(s) were not recorded.`,
        "zh-CN": `${snapshot.coverage.notRecorded} 个已选择 slot 未被记录。`,
      },
    }));
  }
  if (snapshot.coverage.coreInvalid > 0) {
    warnings.push(Object.freeze({
      code: "core-invalid",
      level: "error" as const,
      message: {
        en: `${snapshot.coverage.coreInvalid} selected slot(s) have invalid Core data.`,
        "zh-CN": `${snapshot.coverage.coreInvalid} 个已选择 slot 的 Core 数据无效。`,
      },
    }));
  }
  return Object.freeze(warnings);
}

/**
 * Canonicalizes already-closed diagnostic bundles for a stable product order:
 * experiment identifier ascending, then Run start time descending.
 */
export function snapshotDiagnosticsData(
  diagnostics: readonly SnapshotDiagnosticsItem[],
): SnapshotDiagnosticsData {
  return Object.freeze(
    diagnostics
      .filter((item) => item.diagnostics.length > 0)
      .map((item) => Object.freeze({
        experimentId: item.experimentId,
        startedAt: item.startedAt,
        diagnostics: Object.freeze([...item.diagnostics]),
      }))
      .sort((left, right) =>
        left.experimentId.localeCompare(right.experimentId) || right.startedAt.localeCompare(left.startedAt)),
  );
}

/**
 * Builds the established remediation prose from supplied failure summaries.
 * Verdict classification and failure counting are upstream responsibilities.
 */
export function copyFixPromptData(failures: readonly ClosedFailureSummary[]): CopyFixPromptData {
  if (failures.length === 0) return Object.freeze({ prompt: "", failures: 0 });
  const lines = failures.map((failure, index) => {
    const reason =
      failure.failureSummary === undefined || failure.failureSummary === null
        ? null
        : failure.moreFailures !== undefined && failure.moreFailures > 0
          ? `${failure.failureSummary} (+${failure.moreFailures} more failures)`
          : failure.failureSummary;
    return [
      `${index + 1}. eval "${failure.evalId}" [experiment ${failure.experimentId}] — ${failure.verdict}`,
      reason === null ? null : `   reason: ${reason}`,
      `   inspect: niceeval show ${failure.locator}`,
    ].filter((line): line is string => line !== null).join("\n");
  });
  const experiments = [...new Set(failures.map((failure) => failure.experimentId))].join(" / ");
  return Object.freeze({
    prompt: [
      "Fix the failing evals from this niceeval run.",
      "",
      "## Failures",
      lines.join("\n"),
      "",
      "## Steps",
      "1. Read the relevant NiceEval guide before changing the program or the eval.",
      "2. Inspect each failure, then decide whether the defect is in the program or the eval.",
      "3. Fix that side; do not weaken assertions merely to turn a run green.",
      `4. Re-run: \`npx niceeval exp ${experiments || "<experiment>"} <eval-id-prefix>\`.`,
      "5. Run `npx niceeval show` and confirm these failures are gone.",
    ].join("\n"),
    failures: failures.length,
  });
}

/**
 * Keeps a trace presentation input closed.  Its spans are already normalized
 * display intervals, so this helper never opens or reinterprets trace data.
 */
export function traceWaterfallData(rows: readonly TraceWaterfallRow[]): TraceWaterfallData {
  return Object.freeze(rows.map((row) => Object.freeze({
    experimentId: row.experimentId,
    evalId: row.evalId,
    locator: row.locator,
    durationMs: row.durationMs,
    spans: Object.freeze([...row.spans]),
  })));
}
