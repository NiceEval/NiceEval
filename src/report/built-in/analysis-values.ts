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

export function loadBuiltInSummaryRows(sample: Sample) {
  return aggregate(sample, {
    by: {},
    values: { passRate, durationMs, tokens },
  });
}

export type BuiltInSummaryRows = Awaited<ReturnType<typeof loadBuiltInSummaryRows>>;
export type BuiltInSummaryRow = BuiltInSummaryRows[number];

/** One closed row per selected Experiment for overview charts and tables. */
export function loadBuiltInExperimentRows(sample: Sample) {
  return aggregate(sample, {
    by: { experiment },
    values: { passRate, durationMs, tokens },
  });
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
