import { Effect, Either } from "effect";
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
  type AnalysisSampleHandle,
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
import {
  makeViewRevisionClosure,
  type ReportViewClosureInvalid,
  type ViewRevisionClosure,
} from "./view-closure.ts";

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

/** Failures from building the validated bilingual view closure for one selection. */
export type ExecuteReportViewClosureFromRecordError =
  | RecordReaderOpenError
  | AnalysisSelectionError
  | ReportExecutionError
  | ReportViewClosureInvalid;

/** Failures from building the validated bilingual view closure for one Attempt locator. */
export type ExecuteReportViewClosureForAttemptFromRecordError =
  | RecordReaderOpenError
  | SelectAnalysisSampleForLocatorError
  | ReportExecutionError
  | ReportViewClosureInvalid;

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

/**
 * Builds the validated bilingual ViewRevisionClosure for one selection. The
 * English and Simplified Chinese executions run sequentially over the same
 * AnalysisSampleHandle inside one scoped reader; the reader is never
 * reopened, and no Record I/O happens outside this boundary. A closure that
 * fails the isomorphism check is a typed failure, so a caller never receives
 * a half-localized or business-forked pair.
 */
export function executeReportViewClosureFromRecord(input: {
  readonly root: RecordRoot;
  readonly selection: AnalysisSelectionRequest;
  /** Omit for the built-in closed semantic overview. */
  readonly report?: Report;
  /** Private host input. Never stored on AnalysisSample. */
  readonly selectionOrigin?: ClassicSelectionOrigin;
}): Effect.Effect<
  ViewRevisionClosure,
  ExecuteReportViewClosureFromRecordError,
  ExecuteReportFromRecordRequirements
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* openRecordReader({ root: input.root });
      const sampleHandle = yield* selectAnalysisSample(reader, input.selection);
      return yield* executeLocaleClosure({
        sampleHandle,
        report: input.report ?? standard,
        selectionOrigin: input.selectionOrigin,
      });
    }),
  );
}

/**
 * Builds the validated bilingual ViewRevisionClosure for one canonical
 * Attempt locator. Same single-reader, single-handle, sequential-locale
 * discipline as the selection variant.
 */
export function executeReportViewClosureForAttemptFromRecord(input: {
  readonly root: RecordRoot;
  readonly locator: AttemptLocator;
  /** Omit for the built-in closed semantic overview. */
  readonly report?: Report;
  /** Private host input. Never stored on AnalysisSample. */
  readonly selectionOrigin?: ClassicSelectionOrigin;
}): Effect.Effect<
  ViewRevisionClosure,
  ExecuteReportViewClosureForAttemptFromRecordError,
  ExecuteReportFromRecordRequirements
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* openRecordReader({ root: input.root });
      const sampleHandle = yield* selectAnalysisSampleForLocator({
        reader,
        locator: input.locator,
      });
      return yield* executeLocaleClosure({
        sampleHandle,
        report: input.report ?? standard,
        selectionOrigin: input.selectionOrigin,
      });
    }),
  );
}

function executeLocaleClosure(input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly report: Report;
  readonly selectionOrigin?: ClassicSelectionOrigin;
}): Effect.Effect<
  ViewRevisionClosure,
  ReportExecutionError | ReportViewClosureInvalid,
  never
> {
  return Effect.gen(function* () {
    const en = yield* executeReport({
      sampleHandle: input.sampleHandle,
      report: input.report,
      locale: "en",
      ...(input.selectionOrigin === undefined ? {} : { selectionOrigin: input.selectionOrigin }),
    });
    const zhCN = yield* executeReport({
      sampleHandle: input.sampleHandle,
      report: input.report,
      locale: "zh-CN",
      ...(input.selectionOrigin === undefined ? {} : { selectionOrigin: input.selectionOrigin }),
    });
    const closure = makeViewRevisionClosure({ en, "zh-CN": zhCN });
    if (Either.isLeft(closure)) {
      return yield* Effect.fail(closure.left);
    }
    return closure.right;
  });
}
