import { Effect } from "effect";
import type {
  RecordAttachmentFamily,
  RecordAttachmentValue,
} from "../record/attachment/index.ts";
import { recordAttemptReferenceKey } from "../record/model/core.ts";
import type { RecordCoreRead } from "../record/model/read-state.ts";
import type {
  NonEmptyRecordIssues,
  RecordIssue,
} from "../record/errors/record-errors.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type {
  FrozenRecordAttempt,
  FrozenRecordRun,
  FrozenRecordView,
} from "../record/reader/types.ts";
import type {
  AnalysisRun,
  AnalysisSample,
  AnalysisSampleHandle,
  CoreInvalidAnalysisSlot,
  IncludedAnalysisSlot,
  RunId,
} from "../sample/index.ts";
import { resolveAnalysisSampleHandle } from "../sample/analysis.ts";
import {
  projectRecordAttachmentRead,
  type ProjectedRecordAttachmentResult,
} from "./attachment-result.ts";
import {
  calculateProjectionCoverage,
} from "./coverage.ts";
import type {
  AttemptOriginRunProjectedEntry,
  AttemptAttachmentOwner,
  AttemptSlotProjectedEntry,
  ProjectedSlotEntry,
  ProjectedSample,
  ProjectionAccess,
  ProjectionLimitError,
  RunAttachmentOwner,
  SelectedRunProjectedEntry,
} from "./model.ts";
import {
  recordProjectionDeclaration,
  withRecordAttachmentProjector,
  type RecordAttachmentProjector,
  type RecordProjection,
} from "./projector.ts";

const MAXIMUM_LOGICAL_ENTRIES = 250_000;

type AttemptOwnerResult<Value> =
  | {
      readonly state: "attachment-result";
      readonly attachment: ProjectedRecordAttachmentResult<Value>;
    }
  | {
      readonly state: "core-invalid";
      readonly issues: NonEmptyRecordIssues;
    };

type RunOwnerResult<Value> =
  | {
      readonly state: "attachment-result";
      readonly attachment: ProjectedRecordAttachmentResult<Value>;
    }
  | {
      readonly state: "core-invalid";
      readonly issues: NonEmptyRecordIssues;
    };

/**
 * The only public execution boundary. Sample resolves the exact frozen view
 * originally bound to this genuine handle; callers cannot supply a pure sample
 * or a second reader.
 */
export function projectAnalysisSample<
  Access extends ProjectionAccess,
  Value,
>(input: {
  readonly sampleHandle: AnalysisSampleHandle;
  readonly projection: RecordProjection<Access, Value>;
}): Effect.Effect<
  ProjectedSample<Access, Value>,
  RecordReaderReadError | ProjectionLimitError
> {
  return Effect.flatMap(
    resolveAnalysisSampleHandle(input.sampleHandle),
    ({ reader, sample }) =>
      projectAnalysisSampleFromView({ reader, sample, projection: input.projection }),
  );
}

/**
 * @internal The public handle boundary supplies a verified frozen view. This
 * function never receives a path, callback, or unbound sample reader.
 */
function projectAnalysisSampleFromView<
  Access extends ProjectionAccess,
  Value,
>(input: {
  readonly reader: FrozenRecordView<RecordReaderReadError>;
  readonly sample: AnalysisSample;
  readonly projection: RecordProjection<Access, Value>;
}): Effect.Effect<
  ProjectedSample<Access, Value>,
  RecordReaderReadError | ProjectionLimitError
> {
  return Effect.suspend(() => {
    const projection = recordProjectionDeclaration(input.projection);
    const logicalEntries = projection.access === "selected-run"
      ? input.sample.runs.length
      : input.sample.slots.length;
    if (logicalEntries > MAXIMUM_LOGICAL_ENTRIES) {
      return Effect.fail(projectionLimitError(logicalEntries));
    }

    switch (projection.access) {
      case "attempt-slot":
        return projectAttemptSlots(input.reader, input.sample, projection.projector).pipe(
          Effect.map((entries) => makeAttemptSlotSample(input.sample, entries)),
        ) as Effect.Effect<
          ProjectedSample<Access, Value>,
          RecordReaderReadError | ProjectionLimitError
        >;
      case "attempt-origin-run":
        return projectAttemptOriginRuns(input.reader, input.sample, projection.projector).pipe(
          Effect.map((entries) => makeAttemptOriginRunSample(input.sample, entries)),
        ) as Effect.Effect<
          ProjectedSample<Access, Value>,
          RecordReaderReadError | ProjectionLimitError
        >;
      case "selected-run":
        return projectSelectedRuns(input.reader, input.sample, projection.projector).pipe(
          Effect.map((entries) => makeSelectedRunSample(input.sample, entries)),
        ) as Effect.Effect<
          ProjectedSample<Access, Value>,
          RecordReaderReadError | ProjectionLimitError
        >;
    }
  });
}

function projectAttemptSlots<Value>(
  reader: FrozenRecordView<RecordReaderReadError>,
  sample: AnalysisSample,
  projector: RecordAttachmentProjector<"attempt", Value>,
): Effect.Effect<readonly AttemptSlotProjectedEntry<Value>[], RecordReaderReadError> {
  return withRecordAttachmentProjector(projector, (family, project) =>
    projectAttemptSlotsForFamily(reader, sample, family, project),
  );
}

function projectAttemptSlotsForFamily<Payload, Value>(
  reader: FrozenRecordView<RecordReaderReadError>,
  sample: AnalysisSample,
  family: RecordAttachmentFamily<"attempt", Payload>,
  project: (value: RecordAttachmentValue<Payload>) => Value,
): Effect.Effect<readonly AttemptSlotProjectedEntry<Value>[], RecordReaderReadError> {
  return Effect.gen(function* () {
    const entries: AttemptSlotProjectedEntry<Value>[] = [];
    const byAttempt = new Map<string, AttemptOwnerResult<Value>>();

    for (const slot of sample.slots) {
      switch (slot.state) {
        case "excluded":
          entries.push(Object.freeze({ state: "excluded", slot }));
          break;
        case "not-recorded":
          entries.push(Object.freeze({ state: "not-recorded", slot }));
          break;
        case "core-invalid":
          entries.push(Object.freeze({ state: "core-invalid", slot }));
          break;
        case "included": {
          const key = recordAttemptReferenceKey(slot.attempt);
          let resolved = byAttempt.get(key);
          if (resolved === undefined) {
            const owner = yield* reader.attempt(slot.attempt);
            resolved = yield* projectAttemptOwner(reader, owner, family, project);
            byAttempt.set(key, resolved);
          }
          entries.push(attemptEntryFor(slot, resolved));
          break;
        }
        default:
          unreachableProjectionState(slot);
      }
    }

    return Object.freeze(entries);
  });
}

function projectAttemptOriginRuns<Value>(
  reader: FrozenRecordView<RecordReaderReadError>,
  sample: AnalysisSample,
  projector: RecordAttachmentProjector<"run", Value>,
): Effect.Effect<readonly AttemptOriginRunProjectedEntry<Value>[], RecordReaderReadError> {
  return withRecordAttachmentProjector(projector, (family, project) =>
    projectAttemptOriginRunsForFamily(reader, sample, family, project),
  );
}

function projectAttemptOriginRunsForFamily<Payload, Value>(
  reader: FrozenRecordView<RecordReaderReadError>,
  sample: AnalysisSample,
  family: RecordAttachmentFamily<"run", Payload>,
  project: (value: RecordAttachmentValue<Payload>) => Value,
): Effect.Effect<readonly AttemptOriginRunProjectedEntry<Value>[], RecordReaderReadError> {
  return Effect.gen(function* () {
    const entries: AttemptOriginRunProjectedEntry<Value>[] = [];
    const byRun = new Map<RunId, RunOwnerResult<Value>>();

    for (const slot of sample.slots) {
      switch (slot.state) {
        case "excluded":
          entries.push(Object.freeze({ state: "excluded", slot }));
          break;
        case "not-recorded":
          entries.push(Object.freeze({ state: "not-recorded", slot }));
          break;
        case "core-invalid":
          entries.push(Object.freeze({ state: "core-invalid", slot }));
          break;
        case "included": {
          const runId = slot.attempt.originRunId;
          let resolved = byRun.get(runId);
          if (resolved === undefined) {
            const owner = yield* reader.run(runId);
            resolved = yield* projectRunOwner(reader, owner, family, project);
            byRun.set(runId, resolved);
          }
          entries.push(originRunEntryFor(slot, resolved));
          break;
        }
        default:
          unreachableProjectionState(slot);
      }
    }

    return Object.freeze(entries);
  });
}

function projectSelectedRuns<Value>(
  reader: FrozenRecordView<RecordReaderReadError>,
  sample: AnalysisSample,
  projector: RecordAttachmentProjector<"run", Value>,
): Effect.Effect<readonly SelectedRunProjectedEntry<Value>[], RecordReaderReadError> {
  return withRecordAttachmentProjector(projector, (family, project) =>
    projectSelectedRunsForFamily(reader, sample, family, project),
  );
}

function projectSelectedRunsForFamily<Payload, Value>(
  reader: FrozenRecordView<RecordReaderReadError>,
  sample: AnalysisSample,
  family: RecordAttachmentFamily<"run", Payload>,
  project: (value: RecordAttachmentValue<Payload>) => Value,
): Effect.Effect<readonly SelectedRunProjectedEntry<Value>[], RecordReaderReadError> {
  return Effect.gen(function* () {
    const entries: SelectedRunProjectedEntry<Value>[] = [];
    const byRun = new Map<RunId, ProjectedRecordAttachmentResult<Value>>();

    for (const run of sample.runs) {
      let attachment = byRun.get(run.runId);
      if (attachment === undefined) {
        const owner = yield* reader.run(run.runId);
        const availableOwner = requireAvailableOwner(owner, "selected Run");
        const read = yield* reader.readRunAttachment(availableOwner, family);
        attachment = yield* projectRecordAttachmentRead(read, project);
        byRun.set(run.runId, attachment);
      }
      entries.push(selectedRunEntry(run, attachment));
    }

    return Object.freeze(entries);
  });
}

function projectAttemptOwner<Payload, Value>(
  reader: FrozenRecordView<RecordReaderReadError>,
  owner: RecordCoreRead<FrozenRecordAttempt>,
  family: RecordAttachmentFamily<"attempt", Payload>,
  project: (value: RecordAttachmentValue<Payload>) => Value,
): Effect.Effect<AttemptOwnerResult<Value>, RecordReaderReadError> {
  if (owner.state === "core-invalid") {
    return Effect.succeed(Object.freeze({ state: "core-invalid", issues: owner.issues }));
  }
  if (owner.state === "missing") {
    return Effect.succeed(Object.freeze({
      state: "core-invalid",
      issues: missingOwnerIssues("attempt"),
    }));
  }
  return reader.readAttemptAttachment(owner.value, family).pipe(
    Effect.flatMap((read) => projectRecordAttachmentRead(read, project)),
    Effect.map((attachment) => Object.freeze({ state: "attachment-result", attachment })),
  );
}

function projectRunOwner<Payload, Value>(
  reader: FrozenRecordView<RecordReaderReadError>,
  owner: RecordCoreRead<FrozenRecordRun>,
  family: RecordAttachmentFamily<"run", Payload>,
  project: (value: RecordAttachmentValue<Payload>) => Value,
): Effect.Effect<RunOwnerResult<Value>, RecordReaderReadError> {
  if (owner.state === "core-invalid") {
    return Effect.succeed(Object.freeze({ state: "core-invalid", issues: owner.issues }));
  }
  if (owner.state === "missing") {
    return Effect.succeed(Object.freeze({
      state: "core-invalid",
      issues: missingOwnerIssues("run"),
    }));
  }
  return reader.readRunAttachment(owner.value, family).pipe(
    Effect.flatMap((read) => projectRecordAttachmentRead(read, project)),
    Effect.map((attachment) => Object.freeze({ state: "attachment-result", attachment })),
  );
}

function attemptEntryFor<Value>(
  slot: IncludedAnalysisSlot,
  resolved: AttemptOwnerResult<Value>,
): AttemptSlotProjectedEntry<Value> {
  if (resolved.state === "core-invalid") {
    return coreInvalidEntry<AttemptAttachmentOwner, Value>(slot, resolved.issues);
  }
  return Object.freeze({
    state: "attachment-result",
    slot,
    owner: Object.freeze({ kind: "attempt", attempt: slot.attempt }),
    attachment: resolved.attachment,
  });
}

function originRunEntryFor<Value>(
  slot: IncludedAnalysisSlot,
  resolved: RunOwnerResult<Value>,
): AttemptOriginRunProjectedEntry<Value> {
  if (resolved.state === "core-invalid") {
    return coreInvalidEntry<RunAttachmentOwner, Value>(slot, resolved.issues);
  }
  return Object.freeze({
    state: "attachment-result",
    slot,
    owner: Object.freeze({ kind: "run", runId: slot.attempt.originRunId }),
    attachment: resolved.attachment,
  });
}

function selectedRunEntry<Value>(
  run: AnalysisRun,
  attachment: ProjectedRecordAttachmentResult<Value>,
): SelectedRunProjectedEntry<Value> {
  return Object.freeze({
    state: "attachment-result",
    run,
    owner: Object.freeze({ kind: "run", runId: run.runId }),
    attachment,
  });
}

function coreInvalidEntry<Owner, Value>(
  slot: IncludedAnalysisSlot,
  issues: NonEmptyRecordIssues,
): ProjectedSlotEntry<Owner, Value> {
  const coreInvalidSlot: CoreInvalidAnalysisSlot = Object.freeze({
    runId: slot.runId,
    slotId: slot.slotId,
    state: "core-invalid",
    issues,
  });
  return Object.freeze({ state: "core-invalid", slot: coreInvalidSlot });
}

function requireAvailableOwner<Owner>(
  read: RecordCoreRead<Owner>,
  label: string,
): Owner {
  if (read.state === "available") {
    return read.value;
  }
  throw new Error(`${label} disappeared or became invalid in a frozen Record view`);
}

function missingOwnerIssues(owner: "attempt" | "run"): NonEmptyRecordIssues {
  const issue: RecordIssue = Object.freeze({
    code: owner === "attempt" ? "record-attempt-reference-missing" : "record-attempt-owner-invalid",
    path: Object.freeze([owner]),
  });
  return Object.freeze([issue]);
}

function makeAttemptSlotSample<Value>(
  sample: AnalysisSample,
  entries: readonly AttemptSlotProjectedEntry<Value>[],
): ProjectedSample<"attempt-slot", Value> {
  return Object.freeze({
    sample,
    access: "attempt-slot",
    entries,
    coverage: calculateProjectionCoverage(sample, entries),
  });
}

function makeAttemptOriginRunSample<Value>(
  sample: AnalysisSample,
  entries: readonly AttemptOriginRunProjectedEntry<Value>[],
): ProjectedSample<"attempt-origin-run", Value> {
  return Object.freeze({
    sample,
    access: "attempt-origin-run",
    entries,
    coverage: calculateProjectionCoverage(sample, entries),
  });
}

function makeSelectedRunSample<Value>(
  sample: AnalysisSample,
  entries: readonly SelectedRunProjectedEntry<Value>[],
): ProjectedSample<"selected-run", Value> {
  return Object.freeze({
    sample,
    access: "selected-run",
    entries,
    coverage: calculateProjectionCoverage(sample, entries),
  });
}

function projectionLimitError(observedAtLeast: number): ProjectionLimitError {
  return Object.freeze({
    code: "projection-limit-exceeded",
    limit: "logical-entries",
    maximum: MAXIMUM_LOGICAL_ENTRIES,
    observedAtLeast,
  });
}

function unreachableProjectionState(value: never): never {
  throw new Error(`unknown Analysis Sample slot state: ${String(value)}`);
}
