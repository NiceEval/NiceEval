// Node view data starts with a completed ReportExecution. The former scan of
// legacy Record snapshots lived here; it intentionally has no compatibility
// path because a view revision must never reopen old Record/Fact data.

import type { EvalManifest } from "../runner/manifest.ts";
import type { EvalResult, JsonValue } from "../types.ts";
import type { ReportExecution } from "../report/execution/model.ts";

export class ViewInputError extends Error {}

/** A fixed execution. The Effect-native host derives serializable view data. */
export interface ViewScan {
  readonly execution: ReportExecution;
}

/**
 * The index signature keeps the legacy CLI's un-migrated scan object
 * structurally acceptable without interpreting any of its retired fields.
 */
export interface ViewScanOptions {
  readonly execution?: ReportExecution;
  readonly [key: string]: unknown;
}

export interface LoadedDefinitions {
  readonly execution: ReportExecution;
}

export interface ReportPageRenderer {
  readonly execution: ReportExecution;
}

/**
 * A caller must compose RecordReader -> AnalysisSampleHandle -> executeReport
 * before asking the view host for a revision. No path-based Record scan exists
 * at this boundary.
 */
export async function loadViewScan(
  _input?: string,
  options: ViewScanOptions = {},
): Promise<ViewScan> {
  if (options.execution === undefined) {
    throw new ViewInputError("niceeval view needs a completed ReportExecution from the current Record reader pipeline.");
  }
  return Object.freeze({
    execution: options.execution,
  });
}

/** A custom root remains a host path, not a durable Report dependency. */
export function viewRoot(input = ".niceeval"): string {
  return input;
}

/**
 * Compatibility helpers for the runner's still-separate carry planner. They
 * deliberately expose no retired Record object and therefore never cause a
 * view/report request to recreate the old Record graph.
 */
export interface CarryInputs {
  readonly results: EvalResult[];
  readonly evidenceStatesByAttempt: Map<string, "local" | "borrowed" | "dangling">;
  readonly flagBagsByExperiment: Map<string, globalThis.Record<string, JsonValue>[]>;
  readonly manifestsByEvalKey: Map<string, EvalManifest>;
  readonly incompatibleHistory: Set<string>;
}

export async function loadCarryInputs(_root = ".niceeval"): Promise<CarryInputs> {
  return Object.freeze({
    results: [],
    evidenceStatesByAttempt: new Map<string, "local" | "borrowed" | "dangling">(),
    flagBagsByExperiment: new Map<string, globalThis.Record<string, JsonValue>[]>(),
    manifestsByEvalKey: new Map<string, EvalManifest>(),
    incompatibleHistory: new Set<string>(),
  });
}

export async function loadLatestResultsPerEval(_root = ".niceeval"): Promise<EvalResult[]> {
  return [];
}

export interface IncompatibleRun {
  readonly dir: string;
  readonly schemaVersion?: number;
}

export class IncompatibleResultsError extends Error {}

export function incompatibleViewCommand(run: IncompatibleRun): string | undefined {
  return run.schemaVersion === undefined ? undefined : `niceeval migrate --record ${run.dir}`;
}

export function incompatibleHint(run: IncompatibleRun): string {
  const command = incompatibleViewCommand(run);
  return command === undefined ? "This Record cannot be viewed by the current format." : `Run ${command}.`;
}

export function incompatibleHistoryKey(experimentId: string, evalId: string): string {
  return `${experimentId}\u0000${evalId}`;
}
