import { Effect, Stream } from "effect";
import type { AttemptLocator } from "../attempt-locator.ts";
import {
  resolveAttemptLocator,
  type AttemptLocatorViewInvalid,
} from "../attempt-locator-resolution.ts";
import {
  narrowAnalysisSampleHandle,
  selectExplicitRuns,
  type AnalysisSampleHandle,
  type AnalysisSelectionError,
} from "../sample/analysis.ts";
import type {
  AttemptId,
  RecordReader,
  RecordReaderReadError,
  RecordAttemptRef,
  SlotId,
} from "../record/index.ts";

/** An exact AttemptId was not published by any selectable current Record Run. */
export interface AnalysisAttemptNotFoundError {
  readonly code: "sample-attempt-not-found";
  readonly attemptId: AttemptId;
}

/** One exact AttemptId was claimed by more than one immutable origin reference. */
export interface AnalysisAttemptAmbiguousError {
  readonly code: "sample-attempt-ambiguous";
  readonly attemptId: AttemptId;
}

export type SelectAnalysisSampleForAttemptError =
  | AnalysisSelectionError
  | AnalysisAttemptNotFoundError
  | AnalysisAttemptAmbiguousError
  | RecordReaderReadError;

export interface AnalysisAttemptLocatorNotFoundError {
  readonly code: "sample-attempt-locator-not-found";
  readonly locator: AttemptLocator;
}

export interface AnalysisAttemptLocatorAmbiguousError {
  readonly code: "sample-attempt-locator-ambiguous";
  readonly locator: AttemptLocator;
}

export type SelectAnalysisSampleForLocatorError =
  | SelectAnalysisSampleForAttemptError
  | AnalysisAttemptLocatorNotFoundError
  | AnalysisAttemptLocatorAmbiguousError
  | AttemptLocatorViewInvalid;

interface AttemptSampleMatch {
  readonly handle: AnalysisSampleHandle;
  readonly slotId: SlotId;
  readonly attempt: RecordAttemptRef;
}

interface AttemptSampleScan {
  readonly first?: AttemptSampleMatch;
  readonly ambiguous: boolean;
}

function sameAttemptReference(left: RecordAttemptRef, right: RecordAttemptRef): boolean {
  return left.originRunId === right.originRunId && left.attemptId === right.attemptId;
}

function nextAttemptSampleScan(
  scan: AttemptSampleScan,
  handle: AnalysisSampleHandle,
  attemptId: AttemptId,
): AttemptSampleScan {
  let first = scan.first;
  let ambiguous = scan.ambiguous;
  for (const slot of handle.sample.slots) {
    if (slot.state !== "included" || slot.attempt.attemptId !== attemptId) continue;
    if (first === undefined) {
      first = Object.freeze({
        handle,
        slotId: slot.slotId,
        attempt: slot.attempt,
      });
    } else if (!sameAttemptReference(first.attempt, slot.attempt)) {
      ambiguous = true;
    }
  }
  return Object.freeze({
    ...(first === undefined ? {} : { first }),
    ambiguous,
  });
}

/**
 * Resolves an exact durable AttemptId through the same public frozen Reader and
 * AnalysisSampleHandle path available to every consumer. The completed handle
 * contains only the matching Slot; other slots from the selected Run stay
 * explicitly excluded so projection alignment remains intact.
 */
export function selectAnalysisSampleForAttempt(input: {
  readonly reader: RecordReader<RecordReaderReadError>;
  readonly attemptId: AttemptId;
}): Effect.Effect<AnalysisSampleHandle, SelectAnalysisSampleForAttemptError> {
  return Effect.gen(function* () {
    const scan = yield* Stream.runFoldEffect(
      input.reader.runs,
      Object.freeze({ ambiguous: false }) as AttemptSampleScan,
      (current, candidate): Effect.Effect<AttemptSampleScan, AnalysisSelectionError | RecordReaderReadError> => {
        if (current.ambiguous || candidate.state !== "available") return Effect.succeed(current);
        return Effect.map(
          selectExplicitRuns(input.reader, {
            runIds: [candidate.value.runId],
          }),
          (handle) => nextAttemptSampleScan(current, handle, input.attemptId),
        );
      },
    );
    if (scan.ambiguous) {
      return yield* Effect.fail<AnalysisAttemptAmbiguousError>({
        code: "sample-attempt-ambiguous",
        attemptId: input.attemptId,
      });
    }
    if (scan.first === undefined) {
      return yield* Effect.fail<AnalysisAttemptNotFoundError>({
        code: "sample-attempt-not-found",
        attemptId: input.attemptId,
      });
    }
    return yield* narrowAnalysisSampleHandle(scan.first.handle, {
      slotIds: [scan.first.slotId],
    });
  });
}

/** Resolve one canonical short locator, then retain exact AttemptId selection internally. */
export function selectAnalysisSampleForLocator(input: {
  readonly reader: RecordReader<RecordReaderReadError>;
  readonly locator: AttemptLocator;
}): Effect.Effect<AnalysisSampleHandle, SelectAnalysisSampleForLocatorError> {
  return Effect.gen(function* () {
    const resolved = yield* resolveAttemptLocator(input.reader, input.locator);
    if (resolved.kind === "not-found") {
      return yield* Effect.fail<AnalysisAttemptLocatorNotFoundError>({
        code: "sample-attempt-locator-not-found",
        locator: input.locator,
      });
    }
    if (resolved.kind === "ambiguous") {
      return yield* Effect.fail<AnalysisAttemptLocatorAmbiguousError>({
        code: "sample-attempt-locator-ambiguous",
        locator: input.locator,
      });
    }
    return yield* selectAnalysisSampleForAttempt({
      reader: input.reader,
      attemptId: resolved.attempt.attemptId,
    });
  });
}
