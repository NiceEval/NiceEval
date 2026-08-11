import { Effect, Either, Schema, Stream } from "effect";
import {
  AttemptIdSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "../record/codec/identifiers.ts";
import { RecordExactParseOptions } from "../record/codec/core.ts";
import type { RecordAttemptRef } from "../record/model/core.ts";
import {
  compareCanonicalIdentity,
  isPortableSegment,
  type AttemptId,
  type RunId,
  type SlotId,
  type UtcMillis,
} from "../record/model/identifiers.ts";
import type { RecordCoreRead } from "../record/model/read-state.ts";
import {
  NonEmptyRecordIssuesSchema,
  recordIssue,
  type NonEmptyRecordIssues,
  type RecordIssue,
} from "../record/errors/record-errors.ts";
import { RecordHandleInvalid } from "../record/reader/errors.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import {
  resolveFrozenRecordReaderPort,
  type FrozenRecordReaderPort,
} from "../record/reader/internal.ts";
import type {
  FrozenRecordRun,
  RecordReader,
} from "../record/reader/types.ts";
import { EvaluationRecordIdentitySchema } from "../eval/record/attachment.ts";
import {
  EVALUATIONS_ATTACHMENT_NAME_V1,
  evaluationsAttachmentFamilyV1,
} from "../eval/record/evaluation.ts";
import type { ExperimentIdV1 as ExperimentId } from "../eval/record/evaluation.ts";

export type { RecordAttemptRef } from "../record/model/core.ts";
export type {
  AttemptId,
  RunId,
  SlotId,
  UtcMillis,
} from "../record/model/identifiers.ts";
export type {
  NonEmptyRecordIssues,
  RecordIssue,
} from "../record/errors/record-errors.ts";
export {
  RecordHandleInvalid,
} from "../record/reader/errors.ts";
export type {
  RecordReaderClosed,
  RecordReaderReadError as RecordReadError,
} from "../record/reader/errors.ts";
export type {
  RecordIoError,
  RecordPermissionError,
} from "../record/platform/errors.ts";
export type { ExperimentIdV1 as ExperimentId } from "../eval/record/evaluation.ts";

export interface ExplicitRunsAnalysisInput {
  readonly runIds: readonly [RunId, ...RunId[]];
}

export interface LatestRunsAnalysisInput {
  readonly experimentIds?: readonly [ExperimentId, ...ExperimentId[]];
}

/** A portable request. It deliberately carries neither a reader nor a callback. */
export type AnalysisSelectionRequest =
  | {
      readonly policy: "explicit-runs/v1";
      readonly input: ExplicitRunsAnalysisInput;
    }
  | {
      readonly policy: "latest-runs/v1";
      readonly input: LatestRunsAnalysisInput;
    };

export type AnalysisSelectionSummary =
  | {
      readonly policy: "explicit-runs/v1";
      readonly runIds: readonly RunId[];
    }
  | {
      readonly policy: "latest-runs/v1";
      readonly experimentIds: readonly ExperimentId[] | "all";
      readonly selectedRunIds: readonly RunId[];
    };

export interface AnalysisRun {
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
  readonly completedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
}

export interface AnalysisSlotRef {
  readonly runId: RunId;
  readonly slotId: SlotId;
}

export interface IncludedAnalysisSlot extends AnalysisSlotRef {
  readonly state: "included";
  readonly relation: "origin" | "reference";
  readonly attempt: RecordAttemptRef;
}

export interface NotRecordedAnalysisSlot extends AnalysisSlotRef {
  readonly state: "not-recorded";
}

export interface CoreInvalidAnalysisSlot extends AnalysisSlotRef {
  readonly state: "core-invalid";
  readonly issues: NonEmptyRecordIssues;
}

export type AnalysisBaseSlot =
  | IncludedAnalysisSlot
  | NotRecordedAnalysisSlot
  | CoreInvalidAnalysisSlot;

export interface ExcludedAnalysisSlot extends AnalysisSlotRef {
  readonly state: "excluded";
  readonly base: AnalysisBaseSlot;
}

export type AnalysisSlot = AnalysisBaseSlot | ExcludedAnalysisSlot;

/**
 * A self-contained, serializable analysis denominator. It intentionally has
 * no path, reader, handle, callback, promise, or deferred query.
 */
export interface AnalysisSample {
  readonly selection: AnalysisSelectionSummary;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
  readonly denominator: number;
}

const analysisSampleHandleTypeId: unique symbol = Symbol("niceeval.analysis-sample-handle");

/**
 * A live reader-bound capability. The private WeakMap is its runtime authority;
 * this nominal property only prevents ordinary structural assignment.
 */
export interface AnalysisSampleHandle {
  readonly sample: AnalysisSample;
  readonly [analysisSampleHandleTypeId]: (sample: AnalysisSample) => AnalysisSample;
}

export interface AnalysisSampleSelector {
  readonly runIds?: readonly RunId[];
  readonly slotIds?: readonly SlotId[];
}

export interface AnalysisSelectionInvalidError {
  readonly code: "sample-selection-invalid";
  readonly field: string;
  readonly reason: string;
}

export interface AnalysisRunNotFoundError {
  readonly code: "sample-run-not-found";
  readonly runId: RunId;
}

export interface AnalysisRunInvalidError {
  readonly code: "sample-run-invalid";
  readonly runId: RunId;
  readonly issues: NonEmptyRecordIssues;
}

export interface AnalysisLatestIndeterminateError {
  readonly code: "sample-latest-indeterminate";
  readonly issues: NonEmptyRecordIssues;
}

export interface AnalysisLimitExceededError {
  readonly code: "sample-limit-exceeded";
  readonly limit: "selected-runs" | "slots";
  readonly maximum: number;
  readonly observedAtLeast: number;
}

export type AnalysisSelectionError =
  | AnalysisSelectionInvalidError
  | AnalysisRunNotFoundError
  | AnalysisRunInvalidError
  | AnalysisLatestIndeterminateError
  | AnalysisLimitExceededError;

export interface AnalysisSampleCodecError {
  readonly code: "analysis-sample-invalid";
  readonly path: readonly string[];
  readonly reason: string;
}

const MAX_SELECTED_RUNS = 4_096;
const MAX_SLOTS = 250_000;

interface AnalysisHandleBinding {
  readonly reader: RecordReader<RecordReaderReadError>;
  readonly port: FrozenRecordReaderPort;
  readonly sample: AnalysisSample;
}

interface NormalizedSelector {
  readonly runIds: ReadonlySet<RunId> | undefined;
  readonly slotIds: ReadonlySet<SlotId> | undefined;
}

interface NormalizedExplicitSelection {
  readonly policy: "explicit-runs/v1";
  readonly runIds: readonly RunId[];
}

interface NormalizedLatestSelection {
  readonly policy: "latest-runs/v1";
  readonly experimentIds: readonly ExperimentId[] | "all";
}

type NormalizedSelection =
  | NormalizedExplicitSelection
  | NormalizedLatestSelection;

const handleBindings = new WeakMap<AnalysisSampleHandle, AnalysisHandleBinding>();

/** Exact, portable decode. The result is deeply frozen and canonically ordered. */
export function decodeAnalysisSample(
  input: unknown,
): Either.Either<AnalysisSample, AnalysisSampleCodecError> {
  if (!isExactObject(input, ["selection", "runs", "slots", "denominator"])) {
    return Either.left(codecError([], "must contain exactly selection, runs, slots, and denominator"));
  }
  const selection = decodeSelectionSummary(valueAt(input, "selection"), ["selection"]);
  if (Either.isLeft(selection)) return Either.left(selection.left);
  const encodedRuns = valueAt(input, "runs");
  if (!Array.isArray(encodedRuns)) return Either.left(codecError(["runs"], "must be an array"));
  if (encodedRuns.length > MAX_SELECTED_RUNS) {
    return Either.left(codecError(["runs"], "exceeds the selected-runs limit"));
  }
  const runs: AnalysisRun[] = [];
  for (let index = 0; index < encodedRuns.length; index += 1) {
    const decodedRun = decodeAnalysisRun(encodedRuns[index], ["runs", String(index)]);
    if (Either.isLeft(decodedRun)) return Either.left(decodedRun.left);
    runs.push(decodedRun.right);
  }
  const encodedSlots = valueAt(input, "slots");
  if (!Array.isArray(encodedSlots)) return Either.left(codecError(["slots"], "must be an array"));
  if (encodedSlots.length > MAX_SLOTS) {
    return Either.left(codecError(["slots"], "exceeds the slots limit"));
  }
  const slots: AnalysisSlot[] = [];
  for (let index = 0; index < encodedSlots.length; index += 1) {
    const decodedSlot = decodeAnalysisSlot(encodedSlots[index], ["slots", String(index)]);
    if (Either.isLeft(decodedSlot)) return Either.left(decodedSlot.left);
    slots.push(decodedSlot.right);
  }
  const denominator = valueAt(input, "denominator");
  if (!isNonNegativeInteger(denominator)) {
    return Either.left(codecError(["denominator"], "must be a non-negative safe integer"));
  }
  const sample = makeAnalysisSample(selection.right, runs, slots);
  if (sample.denominator !== denominator) {
    return Either.left(codecError(["denominator"], "must equal the number of non-excluded slots"));
  }
  const integrity = validateSampleIntegrity(sample);
  if (integrity !== undefined) return Either.left(integrity);
  return Either.right(sample);
}

/** Encoding shares the exact decoder so callers cannot emit a non-canonical sample. */
export function encodeAnalysisSample(
  sample: AnalysisSample,
): Either.Either<AnalysisSample, AnalysisSampleCodecError> {
  return decodeAnalysisSample(sample);
}

/** Selects a portable denominator from exactly the supplied frozen Record view. */
export function selectAnalysisSample(
  reader: RecordReader<RecordReaderReadError>,
  request: AnalysisSelectionRequest,
): Effect.Effect<AnalysisSampleHandle, AnalysisSelectionError | RecordReaderReadError> {
  return Effect.suspend(() => {
    const normalized = normalizeSelectionRequest(request);
    return Either.isLeft(normalized)
      ? Effect.fail(normalized.left)
      : selectNormalizedAnalysisSample(reader, normalized.right);
  });
}

/** Narrow entry point for the explicit completed-Run policy. */
export function selectExplicitRuns(
  reader: RecordReader<RecordReaderReadError>,
  input: ExplicitRunsAnalysisInput,
): Effect.Effect<AnalysisSampleHandle, AnalysisSelectionError | RecordReaderReadError> {
  return Effect.suspend(() => {
    const runIds = normalizeExplicitRunIds(input);
    return Either.isLeft(runIds)
      ? Effect.fail(runIds.left)
      : selectNormalizedAnalysisSample(
        reader,
        Object.freeze({ policy: "explicit-runs/v1", runIds: runIds.right }),
      );
  });
}

/** Narrow entry point for the latest completed Run of each Experiment. */
export function selectLatestRuns(
  reader: RecordReader<RecordReaderReadError>,
  input: LatestRunsAnalysisInput,
): Effect.Effect<AnalysisSampleHandle, AnalysisSelectionError | RecordReaderReadError> {
  return Effect.suspend(() => {
    const experimentIds = normalizeLatestExperimentIds(input);
    return Either.isLeft(experimentIds)
      ? Effect.fail(experimentIds.left)
      : selectNormalizedAnalysisSample(
        reader,
        Object.freeze({ policy: "latest-runs/v1", experimentIds: experimentIds.right }),
      );
  });
}

/** Pure, monotonic narrowing. It neither needs nor restores Record I/O. */
export function narrowAnalysisSample(
  sample: AnalysisSample,
  selector: AnalysisSampleSelector,
): Either.Either<AnalysisSample, AnalysisSelectionError> {
  const canonical = encodeAnalysisSample(sample);
  if (Either.isLeft(canonical)) {
    return Either.left(selectionInvalid("sample", canonical.left.reason));
  }
  const normalized = normalizeSelector(selector);
  if (Either.isLeft(normalized)) return Either.left(normalized.left);
  const slots: AnalysisSlot[] = [];
  for (const slot of canonical.right.slots) {
    if (slot.state === "excluded") {
      slots.push(copyAnalysisSlot(slot));
      continue;
    }
    const base = copyBaseSlot(slot);
    if (matchesSelector(base, normalized.right)) {
      slots.push(base);
    } else {
      slots.push(excludedSlot(base));
    }
  }
  return Either.right(makeAnalysisSample(canonical.right.selection, canonical.right.runs, slots));
}

/**
 * Live narrowing validates the authentic handle and its reader first. The new
 * handle remains bound to exactly the same frozen Record view.
 */
export function narrowAnalysisSampleHandle(
  handle: AnalysisSampleHandle,
  selector: AnalysisSampleSelector,
): Effect.Effect<AnalysisSampleHandle, AnalysisSelectionError | RecordReaderReadError> {
  return Effect.suspend(() => {
    const binding = handleBindings.get(handle);
    if (
      binding === undefined
      || handle.sample !== binding.sample
      || resolveFrozenRecordReaderPort(binding.reader) !== binding.port
    ) {
      return Effect.fail(recordHandleInvalid());
    }
    return Effect.gen(function* () {
      yield* binding.port.assertOpen(binding.reader);
      const narrowed = narrowAnalysisSample(binding.sample, selector);
      if (Either.isLeft(narrowed)) return yield* Effect.fail(narrowed.left);
      return makeHandle(binding.reader, binding.port, narrowed.right);
    });
  });
}

/**
 * @internal Projection consumes the exact frozen reader capability bound when
 * selection minted this handle. This is intentionally not a public Sample
 * export: a pure AnalysisSample can never recover Record I/O.
 */
export function resolveAnalysisSampleHandle(
  handle: AnalysisSampleHandle,
): Effect.Effect<
  {
    readonly reader: RecordReader<RecordReaderReadError>;
    readonly sample: AnalysisSample;
  },
  RecordReaderReadError
> {
  return Effect.suspend(() => {
    const binding = handleBindings.get(handle);
    if (
      binding === undefined
      || handle.sample !== binding.sample
      || resolveFrozenRecordReaderPort(binding.reader) !== binding.port
    ) {
      return Effect.fail(recordHandleInvalid());
    }
    return Effect.map(binding.port.assertOpen(binding.reader), () =>
      Object.freeze({ reader: binding.reader, sample: binding.sample }));
  });
}

function selectNormalizedAnalysisSample(
  reader: RecordReader<RecordReaderReadError>,
  selection: NormalizedSelection,
): Effect.Effect<AnalysisSampleHandle, AnalysisSelectionError | RecordReaderReadError> {
  return Effect.suspend(() => {
    const port = resolveFrozenRecordReaderPort(reader);
    if (port === undefined) return Effect.fail(recordHandleInvalid());
    return Effect.gen(function* () {
      yield* port.assertOpen(reader);
      if (selection.policy === "explicit-runs/v1") {
        const runs = yield* selectExplicitRunsFromPort(reader, port, selection.runIds);
        const summary: AnalysisSelectionSummary = Object.freeze({
          policy: "explicit-runs/v1",
          runIds: selection.runIds,
        });
        const sample = yield* materializeAnalysisSample(reader, port, summary, runs);
        return makeHandle(reader, port, sample);
      }
      const runs = yield* selectLatestRunsFromPort(reader, port, selection.experimentIds);
      const summary: AnalysisSelectionSummary = Object.freeze({
        policy: "latest-runs/v1",
        experimentIds: selection.experimentIds,
        selectedRunIds: Object.freeze(runs.map((run) => run.runId)),
      });
      const sample = yield* materializeAnalysisSample(reader, port, summary, runs);
      return makeHandle(reader, port, sample);
    });
  });
}

function selectExplicitRunsFromPort(
  reader: object,
  port: FrozenRecordReaderPort,
  runIds: readonly RunId[],
): Effect.Effect<readonly FrozenRecordRun[], AnalysisSelectionError | RecordReaderReadError> {
  return Effect.gen(function* () {
    const runs: FrozenRecordRun[] = [];
    for (const runId of runIds) {
      const read = yield* port.run(reader, runId);
      if (read.state === "missing") {
        return yield* Effect.fail(runNotFound(runId));
      }
      if (read.state === "core-invalid") {
        return yield* Effect.fail(runInvalid(runId, read.issues));
      }
      runs.push(read.value);
    }
    return Object.freeze(runs);
  });
}

function selectLatestRunsFromPort(
  reader: object,
  port: FrozenRecordReaderPort,
  experimentIds: readonly ExperimentId[] | "all",
): Effect.Effect<readonly FrozenRecordRun[], AnalysisSelectionError | RecordReaderReadError> {
  const requestedExperimentIds = experimentIds === "all"
    ? undefined
    : new Set<ExperimentId>(experimentIds);
  return Stream.runFoldEffect(
    port.candidates(reader),
    new Map<ExperimentId, FrozenRecordRun>(),
    (latestByExperiment, candidate) =>
      collectLatestCandidate(
        reader,
        port,
        requestedExperimentIds,
        latestByExperiment,
        candidate,
      ),
  ).pipe(
    Effect.map((latestByExperiment) =>
      Object.freeze(
        [...latestByExperiment.values()].sort((left, right) =>
          compareCanonicalIdentity(left.runId, right.runId)),
      ),
    ),
  );
}

function collectLatestCandidate(
  reader: object,
  port: FrozenRecordReaderPort,
  requestedExperimentIds: ReadonlySet<ExperimentId> | undefined,
  latestByExperiment: Map<ExperimentId, FrozenRecordRun>,
  candidate: RecordCoreRead<FrozenRecordRun>,
): Effect.Effect<
  Map<ExperimentId, FrozenRecordRun>,
  AnalysisSelectionError | RecordReaderReadError
> {
  return Effect.gen(function* () {
    if (candidate.state === "missing") {
      return yield* Effect.fail(
        latestIndeterminate(singleRecordIssue("record-schema-invalid", ["runs"])),
      );
    }
    if (candidate.state === "core-invalid") {
      return yield* Effect.fail(latestIndeterminate(candidate.issues));
    }
    const attachment = yield* port.readRunAttachment(
      reader,
      candidate.value,
      evaluationsAttachmentFamilyV1,
    );
    if (attachment.state !== "available") {
      return yield* Effect.fail(
        latestIndeterminate(
          singleRecordIssue(
            "record-schema-invalid",
            ["attachments", EVALUATIONS_ATTACHMENT_NAME_V1, attachment.state],
          ),
        ),
      );
    }
    const experimentId = attachment.value.payload.experimentId;
    if (
      requestedExperimentIds !== undefined
      && !requestedExperimentIds.has(experimentId)
    ) {
      return latestByExperiment;
    }
    const previous = latestByExperiment.get(experimentId);
    if (previous === undefined) {
      if (latestByExperiment.size >= MAX_SELECTED_RUNS) {
        return yield* Effect.fail(
          selectionLimit("selected-runs", latestByExperiment.size + 1),
        );
      }
      latestByExperiment.set(experimentId, candidate.value);
      return latestByExperiment;
    }
    if (isLaterRun(candidate.value, previous)) {
      latestByExperiment.set(experimentId, candidate.value);
    }
    return latestByExperiment;
  });
}

function materializeAnalysisSample(
  reader: object,
  port: FrozenRecordReaderPort,
  selection: AnalysisSelectionSummary,
  selectedRuns: readonly FrozenRecordRun[],
): Effect.Effect<AnalysisSample, AnalysisSelectionError | RecordReaderReadError> {
  return Effect.gen(function* () {
    const runs = [...selectedRuns].sort((left, right) =>
      compareCanonicalIdentity(left.runId, right.runId));
    if (runs.length > MAX_SELECTED_RUNS) {
      return yield* Effect.fail(selectionLimit("selected-runs", runs.length));
    }
    const analysisRuns: AnalysisRun[] = [];
    const slots: AnalysisSlot[] = [];
    let slotCount = 0;
    for (const run of runs) {
      const expectedSlots = sortedUnique(run.expectedSlots);
      if (expectedSlots.length !== run.expectedSlots.length) {
        return yield* Effect.fail(
          runInvalid(
            run.runId,
            singleRecordIssue("record-expected-slot-duplicate", ["runs", run.runId]),
          ),
        );
      }
      if (slotCount > MAX_SLOTS - expectedSlots.length) {
        return yield* Effect.fail(selectionLimit("slots", slotCount + expectedSlots.length));
      }
      slotCount += expectedSlots.length;
      analysisRuns.push(Object.freeze({
        runId: run.runId,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        expectedSlots: Object.freeze(expectedSlots),
      }));
      for (const slotId of expectedSlots) {
        slots.push(yield* materializeAnalysisSlot(reader, port, run, slotId));
      }
    }
    return makeAnalysisSample(selection, analysisRuns, slots);
  });
}

function materializeAnalysisSlot(
  reader: object,
  port: FrozenRecordReaderPort,
  run: FrozenRecordRun,
  slotId: SlotId,
): Effect.Effect<AnalysisBaseSlot, RecordReaderReadError> {
  return Effect.gen(function* () {
    const member = yield* port.member(reader, run, slotId);
    if (member.state === "missing") {
      return Object.freeze({ runId: run.runId, slotId, state: "not-recorded" });
    }
    if (member.state === "core-invalid") {
      return coreInvalidSlot(run.runId, slotId, member.issues);
    }
    if (member.value.slotId !== slotId) {
      return coreInvalidSlot(
        run.runId,
        slotId,
        singleRecordIssue("record-member-slot-unexpected", ["members", slotId]),
      );
    }
    const attempt = yield* port.attempt(reader, member.value.attempt);
    if (attempt.state === "missing") {
      return coreInvalidSlot(
        run.runId,
        slotId,
        singleRecordIssue("record-attempt-reference-missing", ["members", slotId, "attempt"]),
      );
    }
    if (attempt.state === "core-invalid") {
      return coreInvalidSlot(run.runId, slotId, attempt.issues);
    }
    if (
      attempt.value.originRunId !== member.value.attempt.originRunId
      || attempt.value.attemptId !== member.value.attempt.attemptId
    ) {
      return coreInvalidSlot(
        run.runId,
        slotId,
        singleRecordIssue("record-attempt-owner-invalid", ["members", slotId, "attempt"]),
      );
    }
    return Object.freeze({
      runId: run.runId,
      slotId,
      state: "included",
      relation: attempt.value.originRunId === run.runId ? "origin" : "reference",
      attempt: copyAttemptRef(member.value.attempt),
    });
  });
}

function normalizeSelectionRequest(
  input: unknown,
): Either.Either<NormalizedSelection, AnalysisSelectionError> {
  if (!isExactObject(input, ["policy", "input"]) || !hasOwnProperty(input, "policy") || !hasOwnProperty(input, "input")) {
    return Either.left(selectionInvalid("request", "must contain exactly policy and input"));
  }
  const policy = valueAt(input, "policy");
  if (policy === "explicit-runs/v1") {
    const runIds = normalizeExplicitRunIds(valueAt(input, "input"));
    return Either.isLeft(runIds)
      ? Either.left(runIds.left)
      : Either.right(Object.freeze({ policy, runIds: runIds.right }));
  }
  if (policy === "latest-runs/v1") {
    const experimentIds = normalizeLatestExperimentIds(valueAt(input, "input"));
    return Either.isLeft(experimentIds)
      ? Either.left(experimentIds.left)
      : Either.right(Object.freeze({ policy, experimentIds: experimentIds.right }));
  }
  return Either.left(selectionInvalid("request.policy", "must be an analysis selection policy"));
}

function normalizeExplicitRunIds(
  input: unknown,
): Either.Either<readonly RunId[], AnalysisSelectionError> {
  if (!isExactObject(input, ["runIds"]) || !hasOwnProperty(input, "runIds")) {
    return Either.left(selectionInvalid("input", "must contain exactly runIds"));
  }
  const encodedRunIds = valueAt(input, "runIds");
  if (!Array.isArray(encodedRunIds) || encodedRunIds.length === 0) {
    return Either.left(selectionInvalid("input.runIds", "must be a non-empty array"));
  }
  const runIds: RunId[] = [];
  for (let index = 0; index < encodedRunIds.length; index += 1) {
    const runId = decodeRunId(encodedRunIds[index], ["input", "runIds", String(index)]);
    if (Either.isLeft(runId)) {
      return Either.left(selectionInvalid(`input.runIds.${index}`, runId.left.reason));
    }
    runIds.push(runId.right);
  }
  const normalized = sortedUnique(runIds);
  return normalized.length > MAX_SELECTED_RUNS
    ? Either.left(selectionLimit("selected-runs", normalized.length))
    : Either.right(Object.freeze(normalized));
}

function normalizeLatestExperimentIds(
  input: unknown,
): Either.Either<readonly ExperimentId[] | "all", AnalysisSelectionError> {
  if (!isExactObject(input, ["experimentIds"])) {
    return Either.left(selectionInvalid("input", "may contain only experimentIds"));
  }
  if (!hasOwnProperty(input, "experimentIds")) return Either.right("all");
  const encodedExperimentIds = valueAt(input, "experimentIds");
  if (!Array.isArray(encodedExperimentIds) || encodedExperimentIds.length === 0) {
    return Either.left(selectionInvalid("input.experimentIds", "must be a non-empty array when present"));
  }
  const experimentIds: ExperimentId[] = [];
  for (let index = 0; index < encodedExperimentIds.length; index += 1) {
    const experimentId = decodeExperimentId(
      encodedExperimentIds[index],
      ["input", "experimentIds", String(index)],
    );
    if (Either.isLeft(experimentId)) {
      return Either.left(selectionInvalid(`input.experimentIds.${index}`, experimentId.left.reason));
    }
    experimentIds.push(experimentId.right);
  }
  const normalized = sortedUnique(experimentIds);
  return normalized.length > MAX_SELECTED_RUNS
    ? Either.left(selectionLimit("selected-runs", normalized.length))
    : Either.right(Object.freeze(normalized));
}

function isLaterRun(candidate: FrozenRecordRun, current: FrozenRecordRun): boolean {
  return candidate.completedAt > current.completedAt
    || (
      candidate.completedAt === current.completedAt
      && compareCanonicalIdentity(candidate.runId, current.runId) > 0
    );
}

function runNotFound(runId: RunId): AnalysisRunNotFoundError {
  return Object.freeze({ code: "sample-run-not-found", runId });
}

function runInvalid(
  runId: RunId,
  issues: NonEmptyRecordIssues,
): AnalysisRunInvalidError {
  return Object.freeze({ code: "sample-run-invalid", runId, issues: copyIssues(issues) });
}

function latestIndeterminate(
  issues: NonEmptyRecordIssues,
): AnalysisLatestIndeterminateError {
  return Object.freeze({ code: "sample-latest-indeterminate", issues: copyIssues(issues) });
}

function selectionLimit(
  limit: AnalysisLimitExceededError["limit"],
  observedAtLeast: number,
): AnalysisLimitExceededError {
  const maximum = limit === "selected-runs" ? MAX_SELECTED_RUNS : MAX_SLOTS;
  return Object.freeze({
    code: "sample-limit-exceeded",
    limit,
    maximum,
    observedAtLeast,
  });
}

function coreInvalidSlot(
  runId: RunId,
  slotId: SlotId,
  issues: NonEmptyRecordIssues,
): CoreInvalidAnalysisSlot {
  return Object.freeze({
    runId,
    slotId,
    state: "core-invalid",
    issues: copyIssues(issues),
  });
}

function singleRecordIssue(
  code: RecordIssue["code"],
  path: readonly string[],
): NonEmptyRecordIssues {
  return Object.freeze([recordIssue(code, path)]);
}

function decodeSelectionSummary(
  input: unknown,
  path: readonly string[],
): Either.Either<AnalysisSelectionSummary, AnalysisSampleCodecError> {
  if (!isExactObject(input, ["policy", "runIds", "experimentIds", "selectedRunIds"])) {
    return Either.left(codecError(path, "contains unsupported fields"));
  }
  const policy = valueAt(input, "policy");
  if (policy === "explicit-runs/v1") {
    if (!isExactObject(input, ["policy", "runIds"])) {
      return Either.left(codecError(path, "explicit selection must contain exactly policy and runIds"));
    }
    const runIds = decodeIdentityArray(
      valueAt(input, "runIds"),
      [...path, "runIds"],
      true,
      decodeRunId,
    );
    if (Either.isLeft(runIds)) return Either.left(runIds.left);
    const selection: AnalysisSelectionSummary = {
      policy: "explicit-runs/v1",
      runIds: runIds.right,
    };
    return Either.right(Object.freeze(selection));
  }
  if (policy === "latest-runs/v1") {
    if (!isExactObject(input, ["policy", "experimentIds", "selectedRunIds"])) {
      return Either.left(codecError(path, "latest selection must contain policy, experimentIds, and selectedRunIds"));
    }
    const encodedExperimentIds = valueAt(input, "experimentIds");
    let experimentIds: readonly ExperimentId[] | "all";
    if (encodedExperimentIds === "all") {
      experimentIds = "all";
    } else {
      const decodedExperimentIds = decodeIdentityArray(
        encodedExperimentIds,
        [...path, "experimentIds"],
        true,
        decodeExperimentId,
      );
      if (Either.isLeft(decodedExperimentIds)) {
        return Either.left(decodedExperimentIds.left);
      }
      experimentIds = decodedExperimentIds.right;
    }
    const selectedRunIds = decodeIdentityArray(
      valueAt(input, "selectedRunIds"),
      [...path, "selectedRunIds"],
      false,
      decodeRunId,
    );
    if (Either.isLeft(selectedRunIds)) return Either.left(selectedRunIds.left);
    const selection: AnalysisSelectionSummary = {
      policy: "latest-runs/v1",
      experimentIds,
      selectedRunIds: selectedRunIds.right,
    };
    return Either.right(Object.freeze(selection));
  }
  return Either.left(codecError([...path, "policy"], "must be an analysis selection policy"));
}

function decodeAnalysisRun(
  input: unknown,
  path: readonly string[],
): Either.Either<AnalysisRun, AnalysisSampleCodecError> {
  if (!isExactObject(input, ["runId", "startedAt", "completedAt", "expectedSlots"])) {
    return Either.left(codecError(path, "must contain exactly runId, startedAt, completedAt, and expectedSlots"));
  }
  const runId = decodeRunId(valueAt(input, "runId"), [...path, "runId"]);
  if (Either.isLeft(runId)) return Either.left(runId.left);
  const startedAt = decodeUtcMillis(valueAt(input, "startedAt"), [...path, "startedAt"]);
  if (Either.isLeft(startedAt)) return Either.left(startedAt.left);
  const completedAt = decodeUtcMillis(valueAt(input, "completedAt"), [...path, "completedAt"]);
  if (Either.isLeft(completedAt) || completedAt.right < startedAt.right) {
    return Either.left(codecError([...path, "completedAt"], "must be a UTC millisecond no earlier than startedAt"));
  }
  const expectedSlots = decodeIdentityArray(
    valueAt(input, "expectedSlots"),
    [...path, "expectedSlots"],
    false,
    decodeSlotId,
  );
  if (Either.isLeft(expectedSlots)) return Either.left(expectedSlots.left);
  const run: AnalysisRun = {
    runId: runId.right,
    startedAt: startedAt.right,
    completedAt: completedAt.right,
    expectedSlots: expectedSlots.right,
  };
  return Either.right(Object.freeze(run));
}

function decodeAnalysisSlot(
  input: unknown,
  path: readonly string[],
): Either.Either<AnalysisSlot, AnalysisSampleCodecError> {
  if (!isExactObject(input, ["runId", "slotId", "state", "relation", "attempt", "issues", "base"])) {
    return Either.left(codecError(path, "contains unsupported fields"));
  }
  const state = valueAt(input, "state");
  if (state === "excluded") {
    if (!isExactObject(input, ["runId", "slotId", "state", "base"])) {
      return Either.left(codecError(path, "excluded slot must contain runId, slotId, state, and base"));
    }
    const runId = decodeRunId(valueAt(input, "runId"), [...path, "runId"]);
    if (Either.isLeft(runId)) return Either.left(runId.left);
    const slotId = decodeSlotId(valueAt(input, "slotId"), [...path, "slotId"]);
    if (Either.isLeft(slotId)) return Either.left(slotId.left);
    const base = decodeBaseSlot(valueAt(input, "base"), [...path, "base"]);
    if (Either.isLeft(base)) return Either.left(base.left);
    if (base.right.runId !== runId.right || base.right.slotId !== slotId.right) {
      return Either.left(codecError([...path, "base"], "must keep the same runId and slotId"));
    }
    const slot: ExcludedAnalysisSlot = {
      runId: runId.right,
      slotId: slotId.right,
      state: "excluded",
      base: base.right,
    };
    return Either.right(Object.freeze(slot));
  }
  return decodeBaseSlot(input, path);
}

function decodeBaseSlot(
  input: unknown,
  path: readonly string[],
): Either.Either<AnalysisBaseSlot, AnalysisSampleCodecError> {
  if (!isExactObject(input, ["runId", "slotId", "state", "relation", "attempt", "issues"])) {
    return Either.left(codecError(path, "contains unsupported fields"));
  }
  const state = valueAt(input, "state");
  if (state === "included") {
    if (!isExactObject(input, ["runId", "slotId", "state", "relation", "attempt"])) {
      return Either.left(codecError(path, "included slot must contain runId, slotId, state, relation, and attempt"));
    }
    const runId = decodeRunId(valueAt(input, "runId"), [...path, "runId"]);
    if (Either.isLeft(runId)) return Either.left(runId.left);
    const slotId = decodeSlotId(valueAt(input, "slotId"), [...path, "slotId"]);
    if (Either.isLeft(slotId)) return Either.left(slotId.left);
    const relation = valueAt(input, "relation");
    if (relation !== "origin" && relation !== "reference") {
      return Either.left(codecError([...path, "relation"], "must be origin or reference"));
    }
    const attempt = decodeAttemptRef(valueAt(input, "attempt"), [...path, "attempt"]);
    if (Either.isLeft(attempt)) return Either.left(attempt.left);
    const slot: IncludedAnalysisSlot = {
      runId: runId.right,
      slotId: slotId.right,
      state: "included",
      relation,
      attempt: attempt.right,
    };
    return Either.right(Object.freeze(slot));
  }
  if (state === "not-recorded") {
    if (!isExactObject(input, ["runId", "slotId", "state"])) {
      return Either.left(codecError(path, "not-recorded slot must contain runId, slotId, and state"));
    }
    const runId = decodeRunId(valueAt(input, "runId"), [...path, "runId"]);
    if (Either.isLeft(runId)) return Either.left(runId.left);
    const slotId = decodeSlotId(valueAt(input, "slotId"), [...path, "slotId"]);
    if (Either.isLeft(slotId)) return Either.left(slotId.left);
    const slot: NotRecordedAnalysisSlot = {
      runId: runId.right,
      slotId: slotId.right,
      state: "not-recorded",
    };
    return Either.right(Object.freeze(slot));
  }
  if (state === "core-invalid") {
    if (!isExactObject(input, ["runId", "slotId", "state", "issues"])) {
      return Either.left(codecError(path, "core-invalid slot must contain runId, slotId, state, and issues"));
    }
    const runId = decodeRunId(valueAt(input, "runId"), [...path, "runId"]);
    if (Either.isLeft(runId)) return Either.left(runId.left);
    const slotId = decodeSlotId(valueAt(input, "slotId"), [...path, "slotId"]);
    if (Either.isLeft(slotId)) return Either.left(slotId.left);
    const issues = decodeIssues(valueAt(input, "issues"), [...path, "issues"]);
    if (Either.isLeft(issues)) return Either.left(issues.left);
    const slot: CoreInvalidAnalysisSlot = {
      runId: runId.right,
      slotId: slotId.right,
      state: "core-invalid",
      issues: issues.right,
    };
    return Either.right(Object.freeze(slot));
  }
  return Either.left(codecError([...path, "state"], "must be included, not-recorded, or core-invalid"));
}

function decodeAttemptRef(
  input: unknown,
  path: readonly string[],
): Either.Either<RecordAttemptRef, AnalysisSampleCodecError> {
  if (!isExactObject(input, ["originRunId", "attemptId"])) {
    return Either.left(codecError(path, "must contain exactly originRunId and attemptId"));
  }
  const originRunId = decodeRunId(valueAt(input, "originRunId"), [...path, "originRunId"]);
  if (Either.isLeft(originRunId)) return Either.left(originRunId.left);
  const attemptId = decodeAttemptId(valueAt(input, "attemptId"), [...path, "attemptId"]);
  if (Either.isLeft(attemptId)) return Either.left(attemptId.left);
  const ref: RecordAttemptRef = {
    originRunId: originRunId.right,
    attemptId: attemptId.right,
  };
  return Either.right(Object.freeze(ref));
}

function decodeIssues(
  input: unknown,
  path: readonly string[],
): Either.Either<NonEmptyRecordIssues, AnalysisSampleCodecError> {
  const decoded = Schema.decodeUnknownEither(
    NonEmptyRecordIssuesSchema,
    RecordExactParseOptions,
  )(input);
  return Either.isLeft(decoded)
    ? Either.left(codecError(path, "must be a non-empty Record issue array"))
    : Either.right(copyIssues(decoded.right));
}

type IdentityDecoder<Identity extends string> = (
  input: unknown,
  path: readonly string[],
) => Either.Either<Identity, AnalysisSampleCodecError>;

function decodeIdentityArray<Identity extends string>(
  input: unknown,
  path: readonly string[],
  requireNonEmpty: boolean,
  decodeIdentity: IdentityDecoder<Identity>,
): Either.Either<readonly Identity[], AnalysisSampleCodecError> {
  if (!Array.isArray(input)) return Either.left(codecError(path, "must be an array"));
  if (requireNonEmpty && input.length === 0) return Either.left(codecError(path, "must not be empty"));
  const values: Identity[] = [];
  let previous: Identity | undefined;
  for (let index = 0; index < input.length; index += 1) {
    const identity = decodeIdentity(input[index], [...path, String(index)]);
    if (Either.isLeft(identity)) return Either.left(identity.left);
    if (previous !== undefined && compareCanonicalIdentity(previous, identity.right) >= 0) {
      return Either.left(codecError(path, "must be strictly sorted and unique"));
    }
    previous = identity.right;
    values.push(identity.right);
  }
  return Either.right(Object.freeze(values));
}

function decodeRunId(
  input: unknown,
  path: readonly string[],
): Either.Either<RunId, AnalysisSampleCodecError> {
  const decoded = Schema.decodeUnknownEither(RunIdSchema, RecordExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(codecError(path, "must be a portable RunId"))
    : Either.right(decoded.right);
}

function decodeSlotId(
  input: unknown,
  path: readonly string[],
): Either.Either<SlotId, AnalysisSampleCodecError> {
  const decoded = Schema.decodeUnknownEither(SlotIdSchema, RecordExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(codecError(path, "must be a portable SlotId"))
    : Either.right(decoded.right);
}

function decodeAttemptId(
  input: unknown,
  path: readonly string[],
): Either.Either<AttemptId, AnalysisSampleCodecError> {
  const decoded = Schema.decodeUnknownEither(AttemptIdSchema, RecordExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(codecError(path, "must be a portable AttemptId"))
    : Either.right(decoded.right);
}

function decodeUtcMillis(
  input: unknown,
  path: readonly string[],
): Either.Either<UtcMillis, AnalysisSampleCodecError> {
  const decoded = Schema.decodeUnknownEither(UtcMillisSchema, RecordExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(codecError(path, "must be a UTC millisecond"))
    : Either.right(decoded.right);
}

function decodeExperimentId(
  input: unknown,
  path: readonly string[],
): Either.Either<ExperimentId, AnalysisSampleCodecError> {
  const decoded = Schema.decodeUnknownEither(EvaluationRecordIdentitySchema)(input);
  return Either.isLeft(decoded)
    ? Either.left(codecError(path, "must be an Experiment identity"))
    : Either.right(decoded.right);
}

function validateSampleIntegrity(sample: AnalysisSample): AnalysisSampleCodecError | undefined {
  const expectedSlotsByRun = new Map<RunId, ReadonlySet<SlotId>>();
  let previousRunId: RunId | undefined;
  let expectedSlotCount = 0;
  for (const run of sample.runs) {
    if (previousRunId !== undefined && compareCanonicalIdentity(previousRunId, run.runId) >= 0) {
      return codecError(["runs"], "must be strictly sorted and unique by runId");
    }
    previousRunId = run.runId;
    const slots = new Set<SlotId>();
    for (const slotId of run.expectedSlots) slots.add(slotId);
    expectedSlotsByRun.set(run.runId, slots);
    if (expectedSlotCount > MAX_SLOTS - run.expectedSlots.length) {
      return codecError(["runs"], "expected slot count exceeds the slots limit");
    }
    expectedSlotCount += run.expectedSlots.length;
  }
  if (sample.slots.length !== expectedSlotCount) {
    return codecError(["slots"], "must contain one entry for every expected slot");
  }
  const seenSlotsByRun = new Map<RunId, Set<SlotId>>();
  let previousSlot: AnalysisSlot | undefined;
  let denominator = 0;
  for (const slot of sample.slots) {
    if (
      previousSlot !== undefined &&
      compareSlotIdentity(previousSlot, slot) >= 0
    ) {
      return codecError(["slots"], "must be strictly sorted and unique by runId and slotId");
    }
    previousSlot = slot;
    const expectedSlots = expectedSlotsByRun.get(slot.runId);
    if (expectedSlots === undefined || !expectedSlots.has(slot.slotId)) {
      return codecError(["slots"], "must reference an expected slot of a selected run");
    }
    let seenSlots = seenSlotsByRun.get(slot.runId);
    if (seenSlots === undefined) {
      seenSlots = new Set<SlotId>();
      seenSlotsByRun.set(slot.runId, seenSlots);
    }
    seenSlots.add(slot.slotId);
    if (slot.state !== "excluded") denominator += 1;
  }
  if (denominator !== sample.denominator) {
    return codecError(["denominator"], "must equal the number of non-excluded slots");
  }
  const runIds = sample.runs.map((run) => run.runId);
  if (sample.selection.policy === "explicit-runs/v1") {
    if (!sameIdentitySequence(sample.selection.runIds, runIds)) {
      return codecError(["selection", "runIds"], "must equal selected runs in canonical order");
    }
  } else if (!sameIdentitySequence(sample.selection.selectedRunIds, runIds)) {
    return codecError(["selection", "selectedRunIds"], "must equal selected runs in canonical order");
  }
  return undefined;
}

function normalizeSelector(
  selector: AnalysisSampleSelector,
): Either.Either<NormalizedSelector, AnalysisSelectionError> {
  if (!isExactObject(selector, ["runIds", "slotIds"])) {
    return Either.left(selectionInvalid("selector", "may contain only runIds and slotIds"));
  }
  if (hasOwnProperty(selector, "runIds") && selector.runIds === undefined) {
    return Either.left(selectionInvalid("selector.runIds", "must be omitted or an array"));
  }
  if (hasOwnProperty(selector, "slotIds") && selector.slotIds === undefined) {
    return Either.left(selectionInvalid("selector.slotIds", "must be omitted or an array"));
  }
  if (selector.runIds !== undefined && !Array.isArray(selector.runIds)) {
    return Either.left(selectionInvalid("selector.runIds", "must be an array"));
  }
  if (selector.slotIds !== undefined && !Array.isArray(selector.slotIds)) {
    return Either.left(selectionInvalid("selector.slotIds", "must be an array"));
  }
  let runIds: ReadonlySet<RunId> | undefined;
  if (selector.runIds !== undefined) {
    const decodedRunIds = selectorIdentitySet(selector.runIds, "selector.runIds");
    if (Either.isLeft(decodedRunIds)) return Either.left(decodedRunIds.left);
    runIds = decodedRunIds.right;
  }
  let slotIds: ReadonlySet<SlotId> | undefined;
  if (selector.slotIds !== undefined) {
    const decodedSlotIds = selectorIdentitySet(selector.slotIds, "selector.slotIds");
    if (Either.isLeft(decodedSlotIds)) return Either.left(decodedSlotIds.left);
    slotIds = decodedSlotIds.right;
  }
  const normalized: NormalizedSelector = {
    runIds,
    slotIds,
  };
  return Either.right(Object.freeze(normalized));
}

function selectorIdentitySet<Identity extends string>(
  values: readonly Identity[],
  field: string,
): Either.Either<ReadonlySet<Identity>, AnalysisSelectionError> {
  const selected = new Set<Identity>();
  for (const value of values) {
    if (!isPortableSegment(value)) {
      return Either.left(selectionInvalid(field, "must contain portable Record identities"));
    }
    selected.add(value);
  }
  return Either.right(selected);
}

function makeHandle(
  reader: RecordReader<RecordReaderReadError>,
  port: FrozenRecordReaderPort,
  sample: AnalysisSample,
): AnalysisSampleHandle {
  const handle: AnalysisSampleHandle = {
    sample,
    [analysisSampleHandleTypeId](boundSample: AnalysisSample): AnalysisSample {
      return boundSample;
    },
  };
  const frozenHandle = Object.freeze(handle);
  const binding: AnalysisHandleBinding = {
    reader,
    port,
    sample,
  };
  handleBindings.set(frozenHandle, Object.freeze(binding));
  return frozenHandle;
}

function makeAnalysisSample(
  selection: AnalysisSelectionSummary,
  runs: readonly AnalysisRun[],
  slots: readonly AnalysisSlot[],
): AnalysisSample {
  const copiedRuns: readonly AnalysisRun[] = Object.freeze(runs.map(copyAnalysisRun));
  const copiedSlots: readonly AnalysisSlot[] = Object.freeze(slots.map(copyAnalysisSlot));
  let denominator = 0;
  for (const slot of copiedSlots) {
    if (slot.state !== "excluded") denominator += 1;
  }
  const sample: AnalysisSample = {
    selection: copySelectionSummary(selection),
    runs: copiedRuns,
    slots: copiedSlots,
    denominator,
  };
  return Object.freeze(sample);
}

function copySelectionSummary(selection: AnalysisSelectionSummary): AnalysisSelectionSummary {
  if (selection.policy === "explicit-runs/v1") {
    const summary: AnalysisSelectionSummary = {
      policy: "explicit-runs/v1",
      runIds: Object.freeze(sortedUnique(selection.runIds)),
    };
    return Object.freeze(summary);
  }
  const experimentIds = selection.experimentIds === "all"
    ? "all"
    : Object.freeze(sortedUnique(selection.experimentIds));
  const summary: AnalysisSelectionSummary = {
    policy: "latest-runs/v1",
    experimentIds,
    selectedRunIds: Object.freeze(sortedUnique(selection.selectedRunIds)),
  };
  return Object.freeze(summary);
}

function copyAnalysisRun(run: AnalysisRun): AnalysisRun {
  const copy: AnalysisRun = {
    runId: run.runId,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    expectedSlots: Object.freeze(sortedUnique(run.expectedSlots)),
  };
  return Object.freeze(copy);
}

function copyAnalysisSlot(slot: AnalysisSlot): AnalysisSlot {
  if (slot.state === "excluded") {
    const copy: ExcludedAnalysisSlot = {
      runId: slot.runId,
      slotId: slot.slotId,
      state: "excluded",
      base: copyBaseSlot(slot.base),
    };
    return Object.freeze(copy);
  }
  return copyBaseSlot(slot);
}

function copyBaseSlot(slot: AnalysisBaseSlot): AnalysisBaseSlot {
  if (slot.state === "included") {
    const copy: IncludedAnalysisSlot = {
      runId: slot.runId,
      slotId: slot.slotId,
      state: "included",
      relation: slot.relation,
      attempt: copyAttemptRef(slot.attempt),
    };
    return Object.freeze(copy);
  }
  if (slot.state === "not-recorded") {
    const copy: NotRecordedAnalysisSlot = {
      runId: slot.runId,
      slotId: slot.slotId,
      state: "not-recorded",
    };
    return Object.freeze(copy);
  }
  const copy: CoreInvalidAnalysisSlot = {
    runId: slot.runId,
    slotId: slot.slotId,
    state: "core-invalid",
    issues: copyIssues(slot.issues),
  };
  return Object.freeze(copy);
}

function copyAttemptRef(ref: RecordAttemptRef): RecordAttemptRef {
  const copy: RecordAttemptRef = {
    originRunId: ref.originRunId,
    attemptId: ref.attemptId,
  };
  return Object.freeze(copy);
}

function copyIssues(issues: NonEmptyRecordIssues): NonEmptyRecordIssues {
  const [first, ...rest] = issues;
  const copied: [RecordIssue, ...RecordIssue[]] = [copyIssue(first), ...rest.map(copyIssue)];
  return Object.freeze(copied);
}

function copyIssue(issue: RecordIssue): RecordIssue {
  const copy: RecordIssue = {
    code: issue.code,
    path: Object.freeze([...issue.path]),
  };
  return Object.freeze(copy);
}

function matchesSelector(slot: AnalysisBaseSlot, selector: NormalizedSelector): boolean {
  const runMatches = selector.runIds === undefined || selector.runIds.has(slot.runId);
  const slotMatches = selector.slotIds === undefined || selector.slotIds.has(slot.slotId);
  return runMatches && slotMatches;
}

function excludedSlot(base: AnalysisBaseSlot): ExcludedAnalysisSlot {
  const excluded: ExcludedAnalysisSlot = {
    runId: base.runId,
    slotId: base.slotId,
    state: "excluded",
    base: copyBaseSlot(base),
  };
  return Object.freeze(excluded);
}

function compareSlotIdentity(left: AnalysisSlot, right: AnalysisSlot): number {
  const runComparison = compareCanonicalIdentity(left.runId, right.runId);
  return runComparison === 0
    ? compareCanonicalIdentity(left.slotId, right.slotId)
    : runComparison;
}

function sameIdentitySequence<Identity extends string>(
  left: readonly Identity[],
  right: readonly Identity[],
): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sortedUnique<Identity extends string>(values: readonly Identity[]): Identity[] {
  const valuesByIdentity = new Set<Identity>(values);
  const sorted = [...valuesByIdentity];
  sorted.sort(compareCanonicalIdentity);
  return sorted;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isExactObject(value: unknown, allowed: readonly string[]): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return false;
  }
  return true;
}

function valueAt(value: object, key: string): unknown {
  return Reflect.get(value, key);
}

function hasOwnProperty(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}

function selectionInvalid(field: string, reason: string): AnalysisSelectionInvalidError {
  const error: AnalysisSelectionInvalidError = {
    code: "sample-selection-invalid",
    field,
    reason,
  };
  return Object.freeze(error);
}

function codecError(path: readonly string[], reason: string): AnalysisSampleCodecError {
  const error: AnalysisSampleCodecError = {
    code: "analysis-sample-invalid",
    path: Object.freeze([...path]),
    reason,
  };
  return Object.freeze(error);
}

function recordHandleInvalid(): RecordHandleInvalid {
  return new RecordHandleInvalid({ code: "record-handle-invalid" });
}
