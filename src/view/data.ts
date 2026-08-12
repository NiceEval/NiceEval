import type { ReportExecution } from "../report/execution/model.ts";

/**
 * A View host receives an already-projected, immutable report execution.
 * It does not discover or adapt historical evaluation data.
 */
export interface ViewScanOptions {
  readonly execution?: ReportExecution;
}
