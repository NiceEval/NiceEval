import { Effect } from "effect";
import {
  openRecordReader,
  type RecordFileSystem,
  type RecordMaintenanceLock,
  type RecordReaderOpenError,
  type RecordRoot,
} from "../../record/index.ts";
import {
  selectAnalysisSample,
  type AnalysisSelectionError,
  type AnalysisSelectionRequest,
} from "../../analysis/index.ts";
import defaultOverviewReport from "../built-in/overview.ts";
import type { Report } from "../author/model.ts";
import type { ReportExecution } from "../execution/model.ts";
import { executeReport, type ReportExecutionError } from "./execute.ts";

/** Failures from opening the Record, selecting its AnalysisSample, or executing the Report. */
export type ExecuteReportFromRecordError =
  | RecordReaderOpenError
  | AnalysisSelectionError
  | ReportExecutionError;

/** The caller supplies the current Record platform; this host never installs Node services. */
export type ExecuteReportFromRecordRequirements =
  | RecordFileSystem
  | RecordMaintenanceLock;

/**
 * Opens one current Record snapshot, selects its AnalysisSample, and completes
 * the Report before closing the reader Scope. The returned execution contains
 * no reader, Scope, path, callback, or deferred Record I/O capability.
 */
export function executeReportFromRecord(input: {
  readonly root: RecordRoot;
  readonly selection: AnalysisSelectionRequest;
  /** Omit for the built-in closed semantic overview. */
  readonly report?: Report;
}): Effect.Effect<
  ReportExecution,
  ExecuteReportFromRecordError,
  ExecuteReportFromRecordRequirements
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* openRecordReader({ root: input.root });
      const sampleHandle = yield* selectAnalysisSample(reader, input.selection);
      return yield* executeReport({
        sampleHandle,
        report: input.report ?? defaultOverviewReport,
      });
    }),
  );
}
