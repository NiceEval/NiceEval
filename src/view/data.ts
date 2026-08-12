// Node view data starts with a completed ReportExecution. The former scan of
// legacy Record snapshots is gone; stale callers fail closed below rather than
// silently treating a current Record as empty history.

import type { EvalManifest } from "../runner/manifest.ts";
import type { EvalResult, JsonValue } from "../types.ts";
import type { ReportExecution } from "../report/execution/model.ts";

export {
  readCurrentExecutionReusePlanResults,
  readCurrentReusedAttempt,
  readFrozenAttemptAttachmentProjection,
} from "../runner/reuse-readback.ts";
export type {
  CurrentReusedAttemptReadback,
  CurrentReusedAttemptScore,
  CurrentReusedAttemptSource,
  CurrentReusedAttemptTarget,
  CurrentReusedExecutionError,
  CurrentReuseReadbackPlanInvalid,
} from "../runner/reuse-readback.ts";

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
 * @deprecated This is the old result-shaped carry boundary. It remains a type
 * declaration only while CLI wiring moves to `CurrentReusedAttemptReadback`;
 * a current Record must never be coerced into it.
 */
export interface CarryInputs {
  readonly results: EvalResult[];
  readonly evidenceStatesByAttempt: Map<string, "local" | "borrowed" | "dangling">;
  readonly flagBagsByExperiment: Map<string, globalThis.Record<string, JsonValue>[]>;
  readonly manifestsByEvalKey: Map<string, EvalManifest>;
  readonly incompatibleHistory: Set<string>;
}

/**
 * @deprecated Current Record carry reads require a FrozenRecordView and an
 * ExecutionReusePlan. This function intentionally fails rather than claiming
 * that the Record has no reusable results.
 */
export async function loadCarryInputs(_root = ".niceeval"): Promise<CarryInputs> {
  throw legacyCarryReadbackUnavailable();
}

/** @deprecated See `loadCarryInputs`; no path-based current Record scan exists. */
export async function loadLatestResultsPerEval(_root = ".niceeval"): Promise<EvalResult[]> {
  throw legacyCarryReadbackUnavailable();
}

function legacyCarryReadbackUnavailable(): ViewInputError {
  return new ViewInputError(
    "Legacy carry readback has been removed. Use the current FrozenRecordView and ExecutionReusePlan readback capability.",
  );
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
