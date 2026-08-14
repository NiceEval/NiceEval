import { Effect } from "effect";
import type { AttemptLocator } from "../../attempt-locator.ts";
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
} from "../../sample/analysis.ts";
import {
  selectAnalysisSampleForLocator,
  type SelectAnalysisSampleForLocatorError,
} from "../../projection/attempt-selection.ts";
import standard from "../built-in/standard.ts";
import type { Report } from "../author/model.ts";
import type { ClassicLocale, ClassicSelectionOrigin } from "../classic/index.ts";
import type { ReportExecution } from "../execution/model.ts";
import { executeReport, type ReportExecutionError } from "./execute.ts";

/** Failures from opening the Record, selecting its AnalysisSample, or executing the Report. */
export type ExecuteReportFromRecordError =
  | RecordReaderOpenError
  | AnalysisSelectionError
  | ReportExecutionError;

/** Failures from opening one Record and resolving an exact Attempt-owned sample. */
export type ExecuteReportForAttemptFromRecordError =
  | RecordReaderOpenError
  | SelectAnalysisSampleForLocatorError
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
  /** Private host input. Never stored on AnalysisSample. */
  readonly selectionOrigin?: ClassicSelectionOrigin;
  readonly locale?: ClassicLocale;
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
        report: input.report ?? standard,
        ...(input.selectionOrigin === undefined ? {} : { selectionOrigin: input.selectionOrigin }),
        ...(input.locale === undefined ? {} : { locale: input.locale }),
      });
    }),
  );
}

/**
 * Executes a Report for one canonical Attempt locator without reopening a
 * separate evidence reader. Locator resolution yields the same live
 * AnalysisSampleHandle that ordinary projection consumers receive.
 */
export function executeReportForAttemptFromRecord(input: {
  readonly root: RecordRoot;
  readonly locator: AttemptLocator;
  /** Omit for the built-in closed semantic overview. */
  readonly report?: Report;
  /** Private host input. Never stored on AnalysisSample. */
  readonly selectionOrigin?: ClassicSelectionOrigin;
  readonly locale?: ClassicLocale;
}): Effect.Effect<
  ReportExecution,
  ExecuteReportForAttemptFromRecordError,
  ExecuteReportFromRecordRequirements
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* openRecordReader({ root: input.root });
      const sampleHandle = yield* selectAnalysisSampleForLocator({
        reader,
        locator: input.locator,
      });
      return yield* executeReport({
        sampleHandle,
        report: input.report ?? standard,
        ...(input.selectionOrigin === undefined ? {} : { selectionOrigin: input.selectionOrigin }),
        ...(input.locale === undefined ? {} : { locale: input.locale }),
      });
    }),
  );
}
