import { Effect, Either, ParseResult, Schema } from "effect";
import { encodeAttemptLocator, parseAttemptLocator } from "../attempt-locator.ts";
import type { AttemptLocator } from "../attempt-locator.ts";
import {
  EvalIdSchema,
  ExecutionIdentityDigestSchema,
  ExperimentIdSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "../record/codec/identifiers.ts";
import type { RecordSlotIdentity } from "../record/model/core.ts";
import { compareCanonicalIdentity } from "../record/model/identifiers.ts";
import {
  canonicalizeRunContext,
  type RunContext,
  type RunExecutionContext,
  type RunContextJsonObject,
  type RunContextJsonValue,
} from "../record/model/run-context.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type {
  ReadableRun,
  RecordReadSession,
  RecordSelection,
  SelectedAttemptRef,
  SelectedRunRef,
} from "../record/host/types.ts";
import type {
  ActiveAnalysisSlot,
  AnalysisIssue,
  AnalysisRun,
  AnalysisRunContext,
  AnalysisRunExecution,
  AnalysisSlotOccurrenceIdentity,
  SampleIdentity,
  AnalysisSelectionProblem,
  AnalysisSelectionRequest,
  AnalysisSelectionSummary,
  AnalysisSlot,
  AnalysisRequestError,
  CoreInvalidAnalysisSlot,
  ExcludedAnalysisSlot,
  IncludedAnalysisSlot,
  JsonValue,
  NotRecordedAnalysisSlot,
  SampleCoverage,
  SampleSelector,
  SampleSnapshot,
  SampleSnapshotCodecError,
} from "../analysis/contracts.ts";
import type {
  EvalId,
  ExecutionIdentityDigest,
  ExperimentId,
  RunId,
  SlotId,
  UtcMillis,
} from "../record/model/identifiers.ts";

const MAX_SELECTED_RUNS = 4_096;
const MAX_SLOTS = 250_000;

/** Private bridge retained in Sample's WeakMap, never in a closed value. */
export interface SampleMaterialization {
  readonly snapshot: SampleSnapshot;
  readonly attemptsBySlot: ReadonlyMap<string, SelectedAttemptRef>;
  /** Private Core identity used to validate a later lazy Attempt read. */
  readonly slotIdentitiesBySlot: ReadonlyMap<string, RecordSlotIdentity>;
}

/**
 * Reads only the selected Core needed to freeze the Sample denominator. Fixed
 * family payloads, blobs, and physical paths are intentionally not touched.
 */
export function materializeSampleSnapshot(input: {
  readonly reader: RecordReadSession;
  readonly selection: RecordSelection;
  readonly selectionRequest: AnalysisSelectionRequest;
}): Effect.Effect<SampleMaterialization, RecordReaderReadError> {
  return Effect.gen(function* () {
    const selection = selectionSummary(input.selectionRequest, input.selection);
    const selected = [...input.selection.runRefs].sort((left, right) =>
      compareCanonicalIdentity(left.runId, right.runId)
    );
    if (selected.length > MAX_SELECTED_RUNS) {
      return yield* Effect.die(new Error("Sample selection exceeds the maximum selected Run count"));
    }

    const expectedByRun = expectedSlotsByRun(input.selection);
    const factsByRun = runFactsByRun(input.selection);
    const runs: AnalysisRun[] = [];
    const slots: AnalysisSlot[] = [];
    const attemptsBySlot = new Map<string, SelectedAttemptRef>();
    const slotIdentitiesBySlot = new Map<string, RecordSlotIdentity>();

    for (const ref of selected) {
      const facts = factsByRun.get(ref);
      if (facts === undefined) {
        return yield* Effect.die(new Error("Record selection omitted closed facts for a selected Run"));
      }
      const expected = expectedSlotsForRun(ref, facts, expectedByRun.get(ref));
      if (expected.length > MAX_SLOTS - slots.length) {
        return yield* Effect.die(new Error("Sample selection exceeds the maximum Slot count"));
      }
      const read = yield* input.reader.readRun(ref);
      if (read.state !== "available") {
        runs.push(closeRunFacts(facts));
        for (const expectedSlot of expected) {
          slotIdentitiesBySlot.set(slotKey(ref.runId, expectedSlot.slot.slotId), expectedSlot.slot);
          slots.push(coreInvalidSlot(
            ref.runId,
            expectedSlot.experimentId,
            expectedSlot.slot,
            null,
            "the selected Run Core is unavailable",
          ));
        }
        continue;
      }

      const run = read.value;
      if (run.document.experimentId !== facts.experimentId) {
        runs.push(closeRunFacts(facts));
        for (const expectedSlot of expected) {
          slotIdentitiesBySlot.set(slotKey(ref.runId, expectedSlot.slot.slotId), expectedSlot.slot);
          slots.push(coreInvalidSlot(
            ref.runId,
            expectedSlot.experimentId,
            expectedSlot.slot,
            null,
            "the selected Run experimentId does not match its closed selection facts",
          ));
        }
        continue;
      }
      runs.push(closeRun(run, expected.map((entry) => entry.slot)));
      const members = membersBySlot(run);
      for (const expectedSlot of expected) {
        const slot = expectedSlot.slot;
        slotIdentitiesBySlot.set(slotKey(ref.runId, slot.slotId), slot);
        const materialized = materializeSlot({
          selectedRun: ref,
          experimentId: expectedSlot.experimentId,
          slot,
          members,
        });
        slots.push(materialized.slot);
        if (materialized.attempt !== undefined) {
          attemptsBySlot.set(slotKey(materialized.slot.runId, materialized.slot.slotId), materialized.attempt);
        }
      }
    }

    const canonicalRuns = Object.freeze([...runs].sort((left, right) =>
      compareCanonicalIdentity(left.runId, right.runId)
    ));
    const canonicalSlots = Object.freeze([...slots].sort(compareSlots));
    const snapshot = makeSnapshot({ selection, runs: canonicalRuns, slots: canonicalSlots });
    return Object.freeze({
      snapshot,
      attemptsBySlot,
      slotIdentitiesBySlot,
    });
  });
}

/** Synchronous, monotonic narrowing over an already-frozen snapshot. */
export function narrowSampleSnapshot(
  snapshot: SampleSnapshot,
  selector: SampleSelector,
): SampleSnapshot | AnalysisRequestError {
  const runIds = normalizedSelectorIds(selector.runIds);
  const slotIds = normalizedSelectorIds(selector.slotIds);
  if (runIds === undefined && slotIds === undefined) {
    return requestError("narrowSample needs at least one runIds or slotIds selector");
  }
  const slots = snapshot.slots.map((slot): AnalysisSlot => {
    if (slot.state === "excluded") return slot;
    const runMatches = runIds === undefined || runIds.has(slot.runId);
    const slotMatches = slotIds === undefined || slotIds.has(slot.slotId);
    if (runMatches && slotMatches) return slot;
    return Object.freeze({
      runId: slot.runId,
      slotId: slot.slotId,
      experimentId: slot.experimentId,
      evalId: slot.evalId,
      attemptOrdinal: slot.attemptOrdinal,
      executionIdentityDigest: slot.executionIdentityDigest,
      state: "excluded" as const,
      base: slot,
    }) satisfies ExcludedAnalysisSlot;
  });
  return makeSnapshot({
    selection: snapshot.selection,
    runs: snapshot.runs,
    slots: Object.freeze(slots),
  });
}

/**
 * `project-current` identity narrowing. Empty matching ids exclude every
 * active Slot; unmatched members become `excluded` with `identity-mismatch`.
 */
export function narrowSampleSnapshotByCurrentIdentity(
  snapshot: SampleSnapshot,
  matchingOccurrences: readonly AnalysisSlotOccurrenceIdentity[],
): SampleSnapshot {
  const keep = new Set(matchingOccurrences.map((occurrence) =>
    slotKey(occurrence.runId, occurrence.slotId)
  ));
  const slots = snapshot.slots.map((slot): AnalysisSlot => {
    if (slot.state === "excluded") return slot;
    if (keep.has(slotKey(slot.runId, slot.slotId))) return slot;
    return Object.freeze({
      runId: slot.runId,
      slotId: slot.slotId,
      experimentId: slot.experimentId,
      evalId: slot.evalId,
      attemptOrdinal: slot.attemptOrdinal,
      executionIdentityDigest: slot.executionIdentityDigest,
      state: "excluded" as const,
      base: slot,
      reason: "identity-mismatch" as const,
    }) satisfies ExcludedAnalysisSlot;
  });
  return makeSnapshot({
    selection: snapshot.selection,
    runs: snapshot.runs,
    slots: Object.freeze(slots),
  });
}

/** The only portable Sample encoding; it has no selected Record references. */
export function encodeSampleSnapshot(snapshot: SampleSnapshot): JsonValue {
  return snapshotJson(decodeSampleSnapshot(snapshot));
}

/** Exact decode, canonical ordering, coverage validation, and deep freeze. */
export function decodeSampleSnapshot(value: unknown): SampleSnapshot {
  const decoded = decodeSampleSnapshotEither(value);
  if (Either.isLeft(decoded)) throw codecException(decoded.left);
  return decoded.right;
}

/** @internal Typed codec branch for host diagnostics. */
export function decodeSampleSnapshotEither(
  value: unknown,
): Either.Either<SampleSnapshot, SampleSnapshotCodecError> {
  const decoded = Schema.decodeUnknownEither(SampleSnapshotWireSchema, SampleSchemaParseOptions)(value);
  if (Either.isLeft(decoded)) return Either.left(codecErrorFromSchema(decoded.left));
  const canonical = canonicalizeSnapshotWire(decoded.right);
  if (Either.isLeft(canonical)) return Either.left(canonical.left);
  const alignment = validateSlotRunAlignment(canonical.right.runs, canonical.right.slots);
  if (alignment !== undefined) return Either.left(alignment);
  const snapshot = makeSnapshot(canonical.right);
  if (decoded.right.identity.kind !== snapshot.identity.kind || decoded.right.identity.id !== snapshot.identity.id) {
    return Either.left(codecError(["identity"], "does not match the canonical frozen selection"));
  }
  if (!sameCoverage(decoded.right.coverage, snapshot.coverage)) {
    return Either.left(codecError(["coverage"], "does not satisfy the canonical coverage equations"));
  }
  return Either.right(snapshot);
}

const SampleSchemaParseOptions = Object.freeze({
  errors: "all" as const,
  exact: true,
  onExcessProperty: "error" as const,
});

/** Preserve the former JSON-record boundary before each exact Struct parse. */
type PlainObject = Readonly<Record<PropertyKey, unknown>>;

const PlainObjectSchema = Schema.declare<PlainObject>(
  (value): value is PlainObject => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  },
  { identifier: "SamplePlainObject", description: "a plain object or null-prototype record" },
);

const plainStruct = <Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.compose(Schema.Struct(fields), { strict: false })(PlainObjectSchema);

const AttemptOrdinalSchema = Schema.JsonNumber.pipe(Schema.filter(
  (value): value is number => Number.isSafeInteger(value) && value >= 0,
  {
    identifier: "SampleAttemptOrdinal",
    description: "a zero-based non-negative safe attempt ordinal",
  },
));

const AttemptLocatorSchema: Schema.Schema<AttemptLocator, string> = Schema.String.pipe(
  Schema.filter<string, AttemptLocator>(
    (value): value is AttemptLocator => parseAttemptLocator(value).valid,
    { identifier: "SampleAttemptLocator", description: "a canonical Attempt locator" },
  ),
);

const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() => Schema.Union(
  Schema.Null,
  Schema.Boolean,
  Schema.JsonNumber,
  Schema.String,
  Schema.Array(JsonValueSchema),
  Schema.Record({ key: Schema.String, value: JsonValueSchema }),
));

const RunContextWireSchema = plainStruct({
  execution: plainStruct({
    agentId: Schema.String.pipe(Schema.minLength(1)),
    model: Schema.NullOr(Schema.String),
    reasoningEffort: Schema.NullOr(Schema.String),
    flags: Schema.Record({ key: Schema.String, value: JsonValueSchema }),
  }),
  labels: Schema.Record({ key: Schema.String, value: Schema.String }),
});

const SelectionProblemSchema = plainStruct({
  code: Schema.Literal(
    "incomplete-run",
    "record-core-invalid",
    "selection-run-missing",
    "selection-run-unreadable",
  ),
  runId: RunIdSchema,
});

const SelectionSchema = Schema.Union(
  plainStruct({
    policy: Schema.Literal("explicit-runs"),
    runIds: Schema.Array(RunIdSchema),
    selectedRunIds: Schema.Array(RunIdSchema),
    problems: Schema.Array(SelectionProblemSchema),
  }),
  plainStruct({
    policy: Schema.Literal("project-current"),
    experimentIds: Schema.Union(Schema.Literal("all"), Schema.Array(ExperimentIdSchema)),
    selectedRunIds: Schema.Array(RunIdSchema),
    problems: Schema.Array(SelectionProblemSchema),
  }),
);

const RunSchema = plainStruct({
  runId: RunIdSchema,
  experimentId: ExperimentIdSchema,
  context: Schema.NullOr(RunContextWireSchema),
  startedAt: UtcMillisSchema,
  completedAt: UtcMillisSchema,
  expectedSlots: Schema.Array(SlotIdSchema),
});

const SlotReferenceFields = {
  runId: RunIdSchema,
  slotId: SlotIdSchema,
  experimentId: ExperimentIdSchema,
  evalId: EvalIdSchema,
  attemptOrdinal: AttemptOrdinalSchema,
  executionIdentityDigest: ExecutionIdentityDigestSchema,
};

const AttemptEvidenceSchema = plainStruct({
  kind: Schema.Literal("attempt"),
  locator: AttemptLocatorSchema,
  originRunId: RunIdSchema,
});

const IssueSchema = plainStruct({
  code: Schema.Literal(
    "missing",
    "migration-required",
    "unsupported",
    "producer-incompatible",
    "input-invalid",
    "reduction-failed",
    "relation-unmatched",
  ),
  message: Schema.String,
  refs: Schema.Array(plainStruct({
    identity: plainStruct({ kind: Schema.Literal("attempt"), locator: AttemptLocatorSchema }),
  })),
});

const ActiveSlotSchema = Schema.Union(
  plainStruct({
    ...SlotReferenceFields,
    state: Schema.Literal("included"),
    action: Schema.Literal("executed", "carried", "accepted"),
    relation: Schema.Literal("origin", "reference"),
    attempt: AttemptEvidenceSchema,
  }),
  plainStruct({
    ...SlotReferenceFields,
    state: Schema.Literal("not-recorded"),
    action: Schema.Literal("not-dispatched", "interrupted").pipe(Schema.NullOr),
    attempt: Schema.Null,
  }),
  plainStruct({
    ...SlotReferenceFields,
    state: Schema.Literal("core-invalid"),
    action: Schema.Literal(
      "executed",
      "carried",
      "accepted",
      "not-dispatched",
      "interrupted",
    ).pipe(Schema.NullOr),
    attempt: Schema.Null,
    issues: Schema.Array(IssueSchema),
  }),
);

const SlotSchemaRaw = Schema.suspend(() => Schema.Union(
  ActiveSlotSchema,
  plainStruct({
    ...SlotReferenceFields,
    state: Schema.Literal("excluded"),
    base: ActiveSlotSchema,
  }),
  plainStruct({
    ...SlotReferenceFields,
    state: Schema.Literal("excluded"),
    base: ActiveSlotSchema,
    reason: Schema.Literal("identity-mismatch"),
  }),
));

const SlotSchema: Schema.Schema<AnalysisSlot, Schema.Schema.Encoded<typeof SlotSchemaRaw>> = SlotSchemaRaw;

const SampleSnapshotWireSchema = plainStruct({
  version: Schema.Literal(1),
  identity: plainStruct({ kind: Schema.Literal("analysis-sample"), id: Schema.String }),
  selection: SelectionSchema,
  runs: Schema.Array(RunSchema).pipe(Schema.filter(
    (runs) => runs.length <= MAX_SELECTED_RUNS,
    { identifier: "SampleSelectedRuns", description: "at most 4096 selected Runs" },
  )),
  slots: Schema.Array(SlotSchema).pipe(Schema.filter(
    (slots) => slots.length <= MAX_SLOTS,
    { identifier: "SampleSlots", description: "at most 250000 Slots" },
  )),
  coverage: plainStruct({
    frameTotal: Schema.JsonNumber,
    selected: Schema.JsonNumber,
    included: Schema.JsonNumber,
    notRecorded: Schema.JsonNumber,
    coreInvalid: Schema.JsonNumber,
    excluded: Schema.JsonNumber,
  }),
});

function canonicalizeSnapshotWire(input: Schema.Schema.Type<typeof SampleSnapshotWireSchema>): Either.Either<{
  readonly selection: AnalysisSelectionSummary;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
}, SampleSnapshotCodecError> {
  const selection = canonicalizeSelection(input.selection);
  const runs: AnalysisRun[] = [];
  for (let index = 0; index < input.runs.length; index += 1) {
    const run = input.runs[index]!;
    const context = run.context === null
      ? null
      : canonicalizeRunContext({ experimentId: run.experimentId, ...run.context });
    if (context !== null && Either.isLeft(context)) {
      return Either.left(codecError(["runs", String(index), "context"], "is not a valid closed Run context"));
    }
    runs.push(Object.freeze({
      runId: run.runId,
      experimentId: run.experimentId,
      context: context === null ? null : closeRunContext(context.right),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      expectedSlots: Object.freeze(uniqueSorted(run.expectedSlots)),
    }));
  }
  let canonicalRuns: readonly AnalysisRun[];
  try {
    canonicalRuns = uniqueSortedBy(runs, (run) => run.runId);
  } catch {
    return Either.left(codecError(["runs"], "duplicates a Run identity"));
  }
  const identities = new Set<string>();
  const slots: AnalysisSlot[] = [];
  for (let index = 0; index < input.slots.length; index += 1) {
    const slot = input.slots[index]!;
    const key = slotKey(slot.runId, slot.slotId);
    if (identities.has(key)) return Either.left(codecError(["slots", String(index)], "duplicates a Run/Slot identity"));
    identities.add(key);
    const closed = closeDecodedSlot(slot, ["slots", String(index)]);
    if (Either.isLeft(closed)) return Either.left(closed.left);
    slots.push(closed.right);
  }
  return Either.right(Object.freeze({
    selection,
    runs: canonicalRuns,
    slots: Object.freeze(slots.sort(compareSlots)),
  }));
}

function closeDecodedSlot(
  slot: AnalysisSlot,
  path: readonly string[],
): Either.Either<AnalysisSlot, SampleSnapshotCodecError> {
  if (slot.state === "excluded") {
    const base = closeDecodedSlot(slot.base, [...path, "base"]);
    if (Either.isLeft(base)) return base;
    if (base.right.state === "excluded") {
      return Either.left(codecError([...path, "base"], "must be an active Slot"));
    }
    if (
      base.right.runId !== slot.runId || base.right.slotId !== slot.slotId ||
      base.right.experimentId !== slot.experimentId || base.right.evalId !== slot.evalId ||
      base.right.attemptOrdinal !== slot.attemptOrdinal ||
      base.right.executionIdentityDigest !== slot.executionIdentityDigest
    ) return Either.left(codecError(path, "excluded base must be a matching active Slot"));
    return Either.right(Object.freeze({ ...slot, base: base.right }));
  }
  if (slot.state === "included") {
    return Either.right(Object.freeze({ ...slot, attempt: Object.freeze({ ...slot.attempt }) }));
  }
  if (slot.state === "not-recorded") return Either.right(Object.freeze({ ...slot }));
  return Either.right(Object.freeze({
    ...slot,
    issues: Object.freeze(slot.issues.map((issue) => Object.freeze({
      ...issue,
      refs: Object.freeze(issue.refs.map((ref) => Object.freeze({
        identity: Object.freeze({ ...ref.identity }),
      }))),
    }))),
  }));
}

function canonicalizeSelection(selection: Schema.Schema.Type<typeof SelectionSchema>): AnalysisSelectionSummary {
  const problems = normalizedSelectionProblems(selection.problems);
  return selection.policy === "explicit-runs"
    ? Object.freeze({
      policy: selection.policy,
      runIds: uniqueSorted(selection.runIds),
      selectedRunIds: uniqueSorted(selection.selectedRunIds),
      problems,
    })
    : Object.freeze({
      policy: selection.policy,
      experimentIds: selection.experimentIds === "all" ? "all" : uniqueSorted(selection.experimentIds),
      selectedRunIds: uniqueSorted(selection.selectedRunIds),
      problems,
    });
}

/** A Snapshot Slot is a derived occurrence of exactly one closed AnalysisRun. */
function validateSlotRunAlignment(
  runs: readonly AnalysisRun[],
  slots: readonly AnalysisSlot[],
): SampleSnapshotCodecError | undefined {
  const runsById = new Map(runs.map((run) => [run.runId, run] as const));
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index]!;
    const run = runsById.get(slot.runId);
    if (run === undefined) return codecError(["slots", String(index), "runId"], "does not identify a selected AnalysisRun");
    if (run.experimentId !== slot.experimentId) return codecError(["slots", String(index), "experimentId"], "does not match the associated AnalysisRun");
    if (!run.expectedSlots.includes(slot.slotId)) return codecError(["slots", String(index), "slotId"], "does not belong to the associated AnalysisRun");
  }
  return undefined;
}

function codecErrorFromSchema(error: ParseResult.ParseError): SampleSnapshotCodecError {
  const issue = ParseResult.ArrayFormatter.formatErrorSync(error)[0];
  if (issue === undefined) return codecError([], "is not a valid Sample snapshot");
  return codecError(issue.path.map(String), issue.message);
}

function expectedSlotsByRun(
  selection: RecordSelection,
): ReadonlyMap<SelectedRunRef, readonly RecordSelection["expectedSlots"][number][]> {
  const result = new Map<SelectedRunRef, readonly RecordSelection["expectedSlots"][number][]>();
  for (const entry of selection.expectedSlots) {
    const slots = result.get(entry.run);
    if (slots === undefined) result.set(entry.run, [entry]);
    else result.set(entry.run, [...slots, entry]);
  }
  for (const [ref, slots] of result) {
    result.set(ref, Object.freeze([...slots].sort((left, right) =>
      compareCanonicalIdentity(left.slot.slotId, right.slot.slotId)
    )));
  }
  return result;
}

function runFactsByRun(
  selection: RecordSelection,
): ReadonlyMap<SelectedRunRef, RecordSelection["runFacts"][number]> {
  return new Map(selection.runFacts.map((facts) => [facts.run, facts] as const));
}

function expectedSlotsForRun(
  ref: SelectedRunRef,
  facts: RecordSelection["runFacts"][number],
  fromSelection: readonly RecordSelection["expectedSlots"][number][] | undefined,
): readonly RecordSelection["expectedSlots"][number][] {
  if (fromSelection !== undefined) return fromSelection;
  return Object.freeze(facts.expectedSlots.map((slot) => Object.freeze({
    run: ref,
    experimentId: facts.experimentId,
    slot,
  })));
}

function selectionSummary(
  request: AnalysisSelectionRequest,
  selection: RecordSelection,
): AnalysisSelectionSummary {
  const selectedRunIds = uniqueSorted(selection.runRefs.map((ref) => ref.runId));
  // Unpublished Run directories are normal writer residue. Record keeps the
  // warning for maintenance, but it is not a problem with the selected Sample.
  const problems = normalizedSelectionProblems(selection.problems);
  if (request.policy === "explicit-runs") {
    return Object.freeze({
      policy: "explicit-runs" as const,
      runIds: uniqueSorted(request.runIds),
      selectedRunIds,
      problems,
    });
  }
  const requestedExperimentIds = request.experimentIds === undefined
    ? uniqueSorted(request.currentSlots.map((slot) => slot.experimentId))
    : uniqueSorted(request.experimentIds);
  return Object.freeze({
    policy: "project-current" as const,
    experimentIds: requestedExperimentIds.length === 0 ? "all" : requestedExperimentIds,
    selectedRunIds,
    problems,
  });
}

function normalizedSelectionProblems(
  values: readonly AnalysisSelectionProblem[],
): readonly AnalysisSelectionProblem[] {
  const byKey = new Map<string, AnalysisSelectionProblem>();
  for (const problem of values) {
    byKey.set(`${problem.code}\u0000${problem.runId}`, Object.freeze({ ...problem }));
  }
  return Object.freeze([...byKey.entries()]
    .sort(([left], [right]) => compareCanonicalIdentity(left, right))
    .map(([, problem]) => problem));
}

function closeRun(run: ReadableRun, expectedSlots: readonly RecordSlotIdentity[]): AnalysisRun {
  return Object.freeze({
    runId: run.document.runId,
    experimentId: run.document.experimentId,
    context: closeRunContext(run.document.context),
    startedAt: run.document.startedAt,
    completedAt: run.document.completedAt,
    expectedSlots: Object.freeze(expectedSlots.map((slot) => slot.slotId)),
  });
}

function closeRunFacts(facts: RecordSelection["runFacts"][number]): AnalysisRun {
  return Object.freeze({
    runId: facts.run.runId,
    experimentId: facts.experimentId,
    context: null,
    startedAt: facts.startedAt,
    completedAt: facts.completedAt,
    expectedSlots: Object.freeze(facts.expectedSlots.map((slot) => slot.slotId)),
  });
}

/**
 * Context is Core, but Sample owns an independent value-only closure rather
 * than retaining a reference to a Record read result. Canonical key ordering
 * keeps the Snapshot identity stable before it reaches JSON encoding.
 */
function closeRunContext(context: RunContext): AnalysisRunContext {
  return Object.freeze({
    execution: closeAnalysisRunExecution(context.execution),
    labels: closeStringRecord(context.labels),
  });
}

/**
 * Internal closure shared by selected-Run snapshot construction and the
 * origin-Attempt projection. It copies only durable JSON facts; neither path,
 * reader, nor mutable Record object escapes into Sample.
 */
export function closeAnalysisRunExecution(
  execution: RunExecutionContext,
): AnalysisRunExecution {
  return Object.freeze({
    agentId: execution.agentId,
    model: execution.model,
    reasoningEffort: execution.reasoningEffort,
    flags: closeJsonObject(execution.flags),
  });
}

function closeStringRecord(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(value).sort(compareCanonicalIdentity)) {
    Object.defineProperty(result, key, {
      value: value[key],
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function closeJsonObject(value: RunContextJsonObject): Readonly<Record<string, JsonValue>> {
  const result: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  for (const key of Object.keys(value).sort(compareCanonicalIdentity)) {
    Object.defineProperty(result, key, {
      value: closeJsonValue(value[key]!),
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function closeJsonValue(value: RunContextJsonValue): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(closeJsonValue));
  if (isRunContextJsonObject(value)) return closeJsonObject(value);
  throw new TypeError("RunContext JSON value must be an object after scalar and array cases");
}

function isRunContextJsonObject(value: RunContextJsonValue): value is RunContextJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function membersBySlot(run: ReadableRun): ReadonlyMap<SlotId, ReadableRun["members"][number] | "duplicate"> {
  const result = new Map<SlotId, ReadableRun["members"][number] | "duplicate">();
  for (const member of run.members) {
    if (result.has(member.document.slotId)) result.set(member.document.slotId, "duplicate");
    else result.set(member.document.slotId, member);
  }
  return result;
}

function materializeSlot(input: {
  readonly selectedRun: SelectedRunRef;
  /** Derived once from the exact Run Core, never copied into Record Slot. */
  readonly experimentId: ExperimentId;
  readonly slot: RecordSlotIdentity;
  readonly members: ReadonlyMap<SlotId, ReadableRun["members"][number] | "duplicate">;
}): {
  readonly slot: AnalysisSlot;
  readonly attempt?: SelectedAttemptRef;
} {
  const member = input.members.get(input.slot.slotId);
  if (member === undefined) {
    return Object.freeze({
      slot: Object.freeze({
        runId: input.selectedRun.runId,
        slotId: input.slot.slotId,
        experimentId: input.experimentId,
        evalId: input.slot.evalId,
        attemptOrdinal: input.slot.attemptOrdinal,
        executionIdentityDigest: input.slot.executionIdentityDigest,
        state: "not-recorded" as const,
        action: null,
        attempt: null,
      }) satisfies NotRecordedAnalysisSlot,
    });
  }
  if (member === "duplicate" || member.document.slotId !== input.slot.slotId) {
    return Object.freeze({
      slot: coreInvalidSlot(
        input.selectedRun.runId,
        input.experimentId,
        input.slot,
        null,
        "the Run has an invalid Member mapping",
      ),
    });
  }
  if (member.document.attempt === null) {
    return Object.freeze({
      slot: Object.freeze({
        runId: input.selectedRun.runId,
        slotId: input.slot.slotId,
        experimentId: input.experimentId,
        evalId: input.slot.evalId,
        attemptOrdinal: input.slot.attemptOrdinal,
        executionIdentityDigest: input.slot.executionIdentityDigest,
        state: "not-recorded" as const,
        action: member.document.action,
        attempt: null,
      }) satisfies NotRecordedAnalysisSlot,
    });
  }
  if (
    member.attempt === null ||
    member.document.attempt.originRunId !== member.attempt.originRunId ||
    member.document.attempt.attemptId !== member.attempt.attemptId
  ) {
    return Object.freeze({
      slot: coreInvalidSlot(
        input.selectedRun.runId,
        input.experimentId,
        input.slot,
        member.document.action,
        "the selected Member did not receive the exact Attempt capability",
      ),
    });
  }
  const slot: IncludedAnalysisSlot = Object.freeze({
    runId: input.selectedRun.runId,
    slotId: input.slot.slotId,
    experimentId: input.experimentId,
    evalId: input.slot.evalId,
    attemptOrdinal: input.slot.attemptOrdinal,
    executionIdentityDigest: input.slot.executionIdentityDigest,
    state: "included" as const,
    action: member.document.action,
    relation: member.attempt.originRunId === input.selectedRun.runId ? "origin" as const : "reference" as const,
    attempt: Object.freeze({
      kind: "attempt" as const,
      locator: encodeAttemptLocator(member.attempt.attemptId),
      originRunId: member.attempt.originRunId,
    }),
  });
  return Object.freeze({ slot, attempt: member.attempt });
}

function coreInvalidSlot(
  runId: RunId,
  experimentId: ExperimentId,
  slot: RecordSlotIdentity,
  action: CoreInvalidAnalysisSlot["action"],
  message: string,
): CoreInvalidAnalysisSlot {
  return Object.freeze({
    runId,
    slotId: slot.slotId,
    experimentId,
    evalId: slot.evalId,
    attemptOrdinal: slot.attemptOrdinal,
    executionIdentityDigest: slot.executionIdentityDigest,
    state: "core-invalid" as const,
    action,
    attempt: null,
    issues: Object.freeze([analysisIssue("input-invalid", message)]),
  });
}

function makeSnapshot(input: {
  readonly selection: AnalysisSelectionSummary;
  readonly runs: readonly AnalysisRun[];
  readonly slots: readonly AnalysisSlot[];
}): SampleSnapshot {
  const runs = Object.freeze([...input.runs].sort((left, right) =>
    compareCanonicalIdentity(left.runId, right.runId)
  ));
  const slots = Object.freeze([...input.slots].sort(compareSlots));
  const canonicalSelection = selectionForSlots(input.selection, slots);
  const coverage = coverageFor(slots);
  return Object.freeze({
    version: 1 as const,
    identity: sampleIdentity(canonicalSelection, runs, slots),
    selection: canonicalSelection,
    runs,
    slots,
    coverage,
  });
}

/** Every derived Sample retains its source policy and refreshes its active result. */
function selectionForSlots(
  selection: AnalysisSelectionSummary,
  slots: readonly AnalysisSlot[],
): AnalysisSelectionSummary {
  const selectedRunIds = uniqueSorted(slots.flatMap((slot) =>
    slot.state === "excluded" ? [] : [slot.runId]
  ));
  const problems = normalizedSelectionProblems(selection.problems);
  if (selection.policy === "explicit-runs") {
    return Object.freeze({
      policy: "explicit-runs" as const,
      runIds: uniqueSorted(selection.runIds),
      selectedRunIds,
      problems,
    });
  }
  return Object.freeze({
    policy: "project-current" as const,
    experimentIds: selection.experimentIds === "all"
      ? "all"
      : uniqueSorted(selection.experimentIds),
    selectedRunIds,
    problems,
  });
}

function coverageFor(slots: readonly AnalysisSlot[]): SampleCoverage {
  let selected = 0;
  let included = 0;
  let notRecorded = 0;
  let coreInvalid = 0;
  let excluded = 0;
  for (const slot of slots) {
    if (slot.state === "excluded") {
      excluded += 1;
      continue;
    }
    selected += 1;
    if (slot.state === "included") included += 1;
    else if (slot.state === "not-recorded") notRecorded += 1;
    else coreInvalid += 1;
  }
  return Object.freeze({
    frameTotal: slots.length,
    selected,
    included,
    notRecorded,
    coreInvalid,
    excluded,
  });
}

function sampleIdentity(
  selection: AnalysisSelectionSummary,
  runs: readonly AnalysisRun[],
  slots: readonly AnalysisSlot[],
): SampleIdentity {
  return Object.freeze({
    kind: "analysis-sample" as const,
    id: canonicalIdentity({ selection, runs, slots }),
  });
}

function compareSlots(left: AnalysisSlot, right: AnalysisSlot): number {
  const run = compareCanonicalIdentity(left.runId, right.runId);
  return run === 0 ? compareCanonicalIdentity(left.slotId, right.slotId) : run;
}

function slotKey(runId: RunId, slotId: SlotId): string {
  return `${runId}\u0000${slotId}`;
}

function normalizedSelectorIds(values: readonly string[] | undefined): ReadonlySet<string> | undefined {
  if (values === undefined) return undefined;
  return new Set(values);
}

function requestError(reason: string): AnalysisRequestError {
  return Object.freeze({ code: "analysis-request-invalid" as const, reason });
}

function analysisIssue(code: AnalysisIssue["code"], message: string): AnalysisIssue {
  return Object.freeze({ code, message, refs: Object.freeze([]) });
}

function snapshotJson(snapshot: SampleSnapshot): JsonValue {
  return Object.freeze({
    version: snapshot.version,
    identity: Object.freeze({ kind: snapshot.identity.kind, id: snapshot.identity.id }),
    selection: selectionJson(snapshot.selection),
    runs: Object.freeze(snapshot.runs.map((run) => Object.freeze({
      runId: run.runId,
      experimentId: run.experimentId,
      context: run.context === null ? null : Object.freeze({
        execution: Object.freeze({
          agentId: run.context.execution.agentId,
          model: run.context.execution.model,
          reasoningEffort: run.context.execution.reasoningEffort,
          flags: closeJsonObject(run.context.execution.flags),
        }),
        labels: closeStringRecord(run.context.labels),
      }),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      expectedSlots: Object.freeze([...run.expectedSlots]),
    }))),
    slots: Object.freeze(snapshot.slots.map(slotJson)),
    coverage: Object.freeze({ ...snapshot.coverage }),
  });
}

function selectionJson(selection: AnalysisSelectionSummary): JsonValue {
  const problems = Object.freeze(selection.problems.map((problem) => Object.freeze({ ...problem })));
  if (selection.policy === "explicit-runs") {
    return Object.freeze({
      policy: selection.policy,
      runIds: Object.freeze([...selection.runIds]),
      selectedRunIds: Object.freeze([...selection.selectedRunIds]),
      problems,
    });
  }
  return Object.freeze({
    policy: selection.policy,
    experimentIds: selection.experimentIds === "all"
      ? "all"
      : Object.freeze([...selection.experimentIds]),
    selectedRunIds: Object.freeze([...selection.selectedRunIds]),
    problems,
  });
}

function slotJson(slot: AnalysisSlot): JsonValue {
  if (slot.state === "excluded") {
    return Object.freeze({
      runId: slot.runId,
      slotId: slot.slotId,
      experimentId: slot.experimentId,
      evalId: slot.evalId,
      attemptOrdinal: slot.attemptOrdinal,
      executionIdentityDigest: slot.executionIdentityDigest,
      state: slot.state,
      base: slotJson(slot.base),
      ...(slot.reason === undefined ? {} : { reason: slot.reason }),
    });
  }
  if (slot.state === "included") {
    return Object.freeze({
      runId: slot.runId,
      slotId: slot.slotId,
      experimentId: slot.experimentId,
      evalId: slot.evalId,
      attemptOrdinal: slot.attemptOrdinal,
      executionIdentityDigest: slot.executionIdentityDigest,
      state: slot.state,
      action: slot.action,
      relation: slot.relation,
      attempt: Object.freeze({ ...slot.attempt }),
    });
  }
  if (slot.state === "not-recorded") {
    return Object.freeze({
      runId: slot.runId,
      slotId: slot.slotId,
      experimentId: slot.experimentId,
      evalId: slot.evalId,
      attemptOrdinal: slot.attemptOrdinal,
      executionIdentityDigest: slot.executionIdentityDigest,
      state: slot.state,
      action: slot.action,
      attempt: null,
    });
  }
  return Object.freeze({
    runId: slot.runId,
    slotId: slot.slotId,
    experimentId: slot.experimentId,
    evalId: slot.evalId,
    attemptOrdinal: slot.attemptOrdinal,
    executionIdentityDigest: slot.executionIdentityDigest,
    state: slot.state,
    action: slot.action,
    attempt: null,
    issues: Object.freeze(slot.issues.map(issueJson)),
  });
}

function issueJson(issue: AnalysisIssue): JsonValue {
  return Object.freeze({
    code: issue.code,
    message: issue.message,
    refs: Object.freeze(issue.refs.map((ref) => Object.freeze({
      identity: Object.freeze({ kind: ref.identity.kind, locator: ref.identity.locator }),
    }))),
  });
}

function uniqueSortedBy<Value>(values: readonly Value[], key: (value: Value) => string): readonly Value[] {
  const byKey = new Map<string, Value>();
  for (const value of values) {
    const identity = key(value);
    if (byKey.has(identity)) throw new Error("SampleSnapshot contains duplicate identities");
    byKey.set(identity, value);
  }
  return Object.freeze([...byKey.entries()]
    .sort(([left], [right]) => compareCanonicalIdentity(left, right))
    .map(([, value]) => value));
}

function uniqueSorted<Value extends string>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...new Set<Value>(values)].sort(compareCanonicalIdentity));
}

function sameCoverage(value: unknown, expected: SampleCoverage): boolean {
  return JSON.stringify(value) === JSON.stringify(expected);
}

function codecException(error: SampleSnapshotCodecError): Error {
  const exception = new Error(error.reason);
  Object.assign(exception, error);
  return exception;
}

function codecError(path: readonly string[], reason: string): SampleSnapshotCodecError {
  return Object.freeze({ code: "sample-snapshot-invalid" as const, path: Object.freeze([...path]), reason });
}

/** Complete normalized selection data is collision-safe identity material. */
function canonicalIdentity(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("Sample identity input must be JSON-serializable");
  return `sample-v1:${encoded}`;
}
