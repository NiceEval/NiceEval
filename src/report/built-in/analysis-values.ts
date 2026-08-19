/**
 * The standard report only composes Analysis-issued ClosedRows.  In
 * particular, it does not create a second Measure catalog or copy an Analysis
 * reducer: all denominator, missingness, provenance, and cost semantics come
 * from the public Report/Analysis facade.
 */

import type { Sample } from "../../analysis/index.ts";
import {
  aggregate,
  attempt,
  evalId,
  experiment,
} from "../model/aggregate.ts";
import {
  durationMs,
  passRate,
  tokens,
} from "../model/metrics.ts";
import { experimentListData } from "../components/entity-lists/compute.ts";

export function loadBuiltInSummaryRows(sample: Sample) {
  return aggregate(sample, {
    by: {},
    values: { passRate, durationMs, tokens },
  });
}

export type BuiltInSummaryRows = Awaited<ReturnType<typeof loadBuiltInSummaryRows>>;
export type BuiltInSummaryRow = BuiltInSummaryRows[number];

/** One closed row per selected Experiment for overview charts and tables. */
export async function loadBuiltInExperimentRows(sample: Sample) {
  const rows = await experimentListData(sample);
  const output = rows.map((row) => Object.freeze({
    key: String(row.experimentId),
    experiment: String(row.experimentId),
    evaluationKind: row.evaluationKind,
    ...(row.totalScore === undefined ? {} : { totalScore: row.totalScore }),
    passRate: row.evaluationKind === "pass" ? row.endToEndPassRate : null,
    durationMs: row.durationMs,
    tokens: row.tokens,
  }));
  const issues = new Map<string, typeof rows[number]["endToEndPassRate"]["issues"][number]>();
  for (const issue of output.flatMap((row) => [row.passRate, row.durationMs, row.tokens]
    .filter((metric) => metric !== null)
    .flatMap((metric) => metric.issues))) {
    issues.set(`${issue.code}\u0000${issue.message}`, issue);
  }
  return Object.freeze(Object.assign(output, {
    issues: Object.freeze([...issues.values()]),
  }));
}

export type BuiltInExperimentRows = Awaited<ReturnType<typeof loadBuiltInExperimentRows>>;
export type BuiltInExperimentRow = BuiltInExperimentRows[number];

/** One closed row per selected logical Attempt; used only by the Attempts Page. */
export function loadBuiltInAttemptRows(sample: Sample) {
  return aggregate(sample, {
    by: { experiment, evalId, attempt },
    values: { passRate, durationMs, tokens },
  });
}

export type BuiltInAttemptRows = Awaited<ReturnType<typeof loadBuiltInAttemptRows>>;
