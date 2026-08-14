import { Effect, Either, Schema } from "effect";
import { encodeAttemptLocator, parseAttemptLocator } from "../attempt-locator.ts";
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
  if (!isExactObject(value, ["version", "identity", "selection", "runs", "slots", "coverage"])) {
    return Either.left(codecError([], "must contain exactly version, identity, selection, runs, slots, and coverage"));
  }
  if (valueAt(value, "version") !== 1) return Either.left(codecError(["version"], "must be 1"));
  const selection = decodeSelection(valueAt(value, "selection"), ["selection"]);
  if (Either.isLeft(selection)) return Either.left(selection.left);
  const runs = decodeRuns(valueAt(value, "runs"), ["runs"]);
  if (Either.isLeft(runs)) return Either.left(runs.left);
  const slots = decodeSlots(valueAt(value, "slots"), ["slots"]);
  if (Either.isLeft(slots)) return Either.left(slots.left);
  const alignment = validateSlotRunAlignment(runs.right, slots.right);
  if (alignment !== undefined) return Either.left(alignment);
  const snapshot = makeSnapshot({ selection: selection.right, runs: runs.right, slots: slots.right });
  if (!sameIdentity(valueAt(value, "identity"), snapshot.identity)) {
    return Either.left(codecError(["identity"], "does not match the canonical frozen selection"));
  }
  if (!sameCoverage(valueAt(value, "coverage"), snapshot.coverage)) {
    return Either.left(codecError(["coverage"], "does not satisfy the canonical coverage equations"));
  }
  return Either.right(snapshot);
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
  const problems = normalizedSelectionProblems([
    ...selection.problems,
    ...selection.warnings.map((warning): AnalysisSelectionProblem => Object.freeze({
      code: "incomplete-run" as const,
      runId: warning.runId,
    })),
  ]);
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
    startedAt: run.document.startedAt,
    completedAt: run.document.completedAt,
    expectedSlots: Object.freeze(expectedSlots.map((slot) => slot.slotId)),
  });
}

function closeRunFacts(facts: RecordSelection["runFacts"][number]): AnalysisRun {
  return Object.freeze({
    runId: facts.run.runId,
    experimentId: facts.experimentId,
    startedAt: facts.startedAt,
    completedAt: facts.completedAt,
    expectedSlots: Object.freeze(facts.expectedSlots.map((slot) => slot.slotId)),
  });
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

function decodeSelection(
  value: unknown,
  path: readonly string[],
): Either.Either<AnalysisSelectionSummary, SampleSnapshotCodecError> {
  if (!isPlainObject(value)) return Either.left(codecError(path, "must be an object"));
  const policy = valueAt(value, "policy");
  if (policy === "explicit-runs") {
    if (!isExactObject(value, ["policy", "runIds", "selectedRunIds", "problems"])) {
      return Either.left(codecError(path, "explicit-runs must contain exactly policy, runIds, selectedRunIds, and problems"));
    }
    const runIds = decodeArray(valueAt(value, "runIds"), [...path, "runIds"], decodeRunId);
    const selectedRunIds = decodeArray(
      valueAt(value, "selectedRunIds"),
      [...path, "selectedRunIds"],
      decodeRunId,
    );
    const problems = decodeSelectionProblems(valueAt(value, "problems"), [...path, "problems"]);
    if (Either.isLeft(runIds)) return Either.left(runIds.left);
    if (Either.isLeft(selectedRunIds)) return Either.left(selectedRunIds.left);
    if (Either.isLeft(problems)) return Either.left(problems.left);
    return Either.right(Object.freeze({
      policy: "explicit-runs" as const,
      runIds: uniqueSorted(runIds.right),
      selectedRunIds: uniqueSorted(selectedRunIds.right),
      problems: normalizedSelectionProblems(problems.right),
    }));
  }
  if (policy === "project-current") {
    if (!isExactObject(value, ["policy", "experimentIds", "selectedRunIds", "problems"])) {
      return Either.left(codecError(path, "project-current must contain exactly policy, experimentIds, selectedRunIds, and problems"));
    }
    const experimentIdsValue = valueAt(value, "experimentIds");
    let experimentIds: "all" | readonly ExperimentId[];
    if (experimentIdsValue === "all") {
      experimentIds = "all";
    } else {
      const decodedExperimentIds = decodeArray(
        experimentIdsValue,
        [...path, "experimentIds"],
        decodeExperimentId,
      );
      if (Either.isLeft(decodedExperimentIds)) return Either.left(decodedExperimentIds.left);
      experimentIds = uniqueSorted(decodedExperimentIds.right);
    }
    const selectedRunIds = decodeArray(
      valueAt(value, "selectedRunIds"),
      [...path, "selectedRunIds"],
      decodeRunId,
    );
    const problems = decodeSelectionProblems(valueAt(value, "problems"), [...path, "problems"]);
    if (Either.isLeft(selectedRunIds)) return Either.left(selectedRunIds.left);
    if (Either.isLeft(problems)) return Either.left(problems.left);
    return Either.right(Object.freeze({
      policy: "project-current" as const,
      experimentIds,
      selectedRunIds: uniqueSorted(selectedRunIds.right),
      problems: normalizedSelectionProblems(problems.right),
    }));
  }
  return Either.left(codecError([...path, "policy"], "must be explicit-runs or project-current"));
}

function decodeSelectionProblems(
  value: unknown,
  path: readonly string[],
): Either.Either<readonly AnalysisSelectionProblem[], SampleSnapshotCodecError> {
  if (!Array.isArray(value)) return Either.left(codecError(path, "must be an array"));
  const problems: AnalysisSelectionProblem[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const decoded = decodeSelectionProblem(value[index], [...path, String(index)]);
    if (Either.isLeft(decoded)) return Either.left(decoded.left);
    problems.push(decoded.right);
  }
  return Either.right(Object.freeze(problems));
}

function decodeSelectionProblem(
  value: unknown,
  path: readonly string[],
): Either.Either<AnalysisSelectionProblem, SampleSnapshotCodecError> {
  if (!isExactObject(value, ["code", "runId"])) return Either.left(codecError(path, "must contain exactly code and runId"));
  const code = valueAt(value, "code");
  if (code !== "incomplete-run" && code !== "record-core-invalid" && code !== "selection-run-missing" && code !== "selection-run-unreadable") {
    return Either.left(codecError([...path, "code"], "is not a known selection problem"));
  }
  const runId = decodeRunId(valueAt(value, "runId"), [...path, "runId"]);
  return Either.isLeft(runId) ? Either.left(runId.left) : Either.right(Object.freeze({ code, runId: runId.right }));
}

function decodeRuns(
  value: unknown,
  path: readonly string[],
): Either.Either<readonly AnalysisRun[], SampleSnapshotCodecError> {
  if (!Array.isArray(value)) return Either.left(codecError(path, "must be an array"));
  if (value.length > MAX_SELECTED_RUNS) return Either.left(codecError(path, "exceeds the selected-runs limit"));
  const runs: AnalysisRun[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const decoded = decodeRun(value[index], [...path, String(index)]);
    if (Either.isLeft(decoded)) return Either.left(decoded.left);
    runs.push(decoded.right);
  }
  return Either.right(Object.freeze(uniqueSortedBy(runs, (run) => run.runId)));
}

function decodeRun(value: unknown, path: readonly string[]): Either.Either<AnalysisRun, SampleSnapshotCodecError> {
  if (!isExactObject(value, ["runId", "experimentId", "startedAt", "completedAt", "expectedSlots"])) {
    return Either.left(codecError(path, "contains unsupported fields"));
  }
  const runId = decodeRunId(valueAt(value, "runId"), [...path, "runId"]);
  const experimentId = decodeExperimentId(valueAt(value, "experimentId"), [...path, "experimentId"]);
  const startedAt = decodeUtcMillis(valueAt(value, "startedAt"), [...path, "startedAt"]);
  const completedAt = decodeUtcMillis(valueAt(value, "completedAt"), [...path, "completedAt"]);
  const slots = decodeArray(valueAt(value, "expectedSlots"), [...path, "expectedSlots"], decodeSlotId);
  if (Either.isLeft(runId)) return Either.left(runId.left);
  if (Either.isLeft(experimentId)) return Either.left(experimentId.left);
  if (Either.isLeft(startedAt)) return Either.left(startedAt.left);
  if (Either.isLeft(completedAt)) return Either.left(completedAt.left);
  if (Either.isLeft(slots)) return Either.left(slots.left);
  return Either.right(Object.freeze({
    runId: runId.right,
    experimentId: experimentId.right,
    startedAt: startedAt.right,
    completedAt: completedAt.right,
    expectedSlots: Object.freeze(uniqueSorted(slots.right)),
  }));
}

function decodeSlots(
  value: unknown,
  path: readonly string[],
): Either.Either<readonly AnalysisSlot[], SampleSnapshotCodecError> {
  if (!Array.isArray(value)) return Either.left(codecError(path, "must be an array"));
  if (value.length > MAX_SLOTS) return Either.left(codecError(path, "exceeds the Slot limit"));
  const slots: AnalysisSlot[] = [];
  const identities = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const decoded = decodeSlot(value[index], [...path, String(index)], false);
    if (Either.isLeft(decoded)) return Either.left(decoded.left);
    const key = slotKey(decoded.right.runId, decoded.right.slotId);
    if (identities.has(key)) return Either.left(codecError([...path, String(index)], "duplicates a Run/Slot identity"));
    identities.add(key);
    slots.push(decoded.right);
  }
  return Either.right(Object.freeze(slots.sort(compareSlots)));
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
    if (run === undefined) {
      return codecError(["slots", String(index), "runId"], "does not identify a selected AnalysisRun");
    }
    if (run.experimentId !== slot.experimentId) {
      return codecError(["slots", String(index), "experimentId"], "does not match the associated AnalysisRun");
    }
    if (!run.expectedSlots.includes(slot.slotId)) {
      return codecError(["slots", String(index), "slotId"], "does not belong to the associated AnalysisRun");
    }
  }
  return undefined;
}

function decodeSlot(
  value: unknown,
  path: readonly string[],
  nested: boolean,
): Either.Either<AnalysisSlot, SampleSnapshotCodecError> {
  if (!isPlainObject(value)) return Either.left(codecError(path, "must be an object"));
  const state = valueAt(value, "state");
  if (state === "excluded") {
    const hasReason = Object.prototype.hasOwnProperty.call(value, "reason");
    const expectedKeys = hasReason
      ? ["runId", "slotId", "experimentId", "evalId", "attemptOrdinal", "executionIdentityDigest", "state", "base", "reason"]
      : ["runId", "slotId", "experimentId", "evalId", "attemptOrdinal", "executionIdentityDigest", "state", "base"];
    if (nested || !isExactObject(value, expectedKeys)) {
      return Either.left(codecError(path, "excluded Slots must contain exactly runId, slotId, state, base, and optional reason"));
    }
    const runId = decodeRunId(valueAt(value, "runId"), [...path, "runId"]);
    const slotId = decodeSlotId(valueAt(value, "slotId"), [...path, "slotId"]);
    const experimentId = decodeExperimentId(valueAt(value, "experimentId"), [...path, "experimentId"]);
    const evalId = decodeEvalId(valueAt(value, "evalId"), [...path, "evalId"]);
    const attemptOrdinal = decodeAttemptOrdinal(valueAt(value, "attemptOrdinal"), [...path, "attemptOrdinal"]);
    const executionIdentityDigest = decodeExecutionIdentityDigest(
      valueAt(value, "executionIdentityDigest"),
      [...path, "executionIdentityDigest"],
    );
    const base = decodeSlot(valueAt(value, "base"), [...path, "base"], true);
    if (Either.isLeft(runId)) return Either.left(runId.left);
    if (Either.isLeft(slotId)) return Either.left(slotId.left);
    if (Either.isLeft(experimentId)) return Either.left(experimentId.left);
    if (Either.isLeft(evalId)) return Either.left(evalId.left);
    if (Either.isLeft(attemptOrdinal)) return Either.left(attemptOrdinal.left);
    if (Either.isLeft(executionIdentityDigest)) return Either.left(executionIdentityDigest.left);
    if (Either.isLeft(base)) return Either.left(base.left);
    if (
      base.right.state === "excluded"
      || base.right.runId !== runId.right
      || base.right.slotId !== slotId.right
      || base.right.experimentId !== experimentId.right
      || base.right.evalId !== evalId.right
      || base.right.attemptOrdinal !== attemptOrdinal.right
      || base.right.executionIdentityDigest !== executionIdentityDigest.right
    ) {
      return Either.left(codecError(path, "excluded base must be a matching active Slot"));
    }
    if (hasReason && valueAt(value, "reason") !== "identity-mismatch") {
      return Either.left(codecError([...path, "reason"], "must be identity-mismatch"));
    }
    return Either.right(Object.freeze({
      runId: runId.right,
      slotId: slotId.right,
      experimentId: experimentId.right,
      evalId: evalId.right,
      attemptOrdinal: attemptOrdinal.right,
      executionIdentityDigest: executionIdentityDigest.right,
      state,
      base: base.right,
      ...(hasReason ? { reason: "identity-mismatch" as const } : {}),
    }));
  }
  const runId = decodeRunId(valueAt(value, "runId"), [...path, "runId"]);
  const slotId = decodeSlotId(valueAt(value, "slotId"), [...path, "slotId"]);
  const experimentId = decodeExperimentId(valueAt(value, "experimentId"), [...path, "experimentId"]);
  const evalId = decodeEvalId(valueAt(value, "evalId"), [...path, "evalId"]);
  const attemptOrdinal = decodeAttemptOrdinal(valueAt(value, "attemptOrdinal"), [...path, "attemptOrdinal"]);
  const executionIdentityDigest = decodeExecutionIdentityDigest(
    valueAt(value, "executionIdentityDigest"),
    [...path, "executionIdentityDigest"],
  );
  if (Either.isLeft(runId)) return Either.left(runId.left);
  if (Either.isLeft(slotId)) return Either.left(slotId.left);
  if (Either.isLeft(experimentId)) return Either.left(experimentId.left);
  if (Either.isLeft(evalId)) return Either.left(evalId.left);
  if (Either.isLeft(attemptOrdinal)) return Either.left(attemptOrdinal.left);
  if (Either.isLeft(executionIdentityDigest)) return Either.left(executionIdentityDigest.left);
  if (state === "included") {
    if (!isExactObject(value, ["runId", "slotId", "experimentId", "evalId", "attemptOrdinal", "executionIdentityDigest", "state", "action", "relation", "attempt"])) {
      return Either.left(codecError(path, "included Slots contain unsupported fields"));
    }
    const action = valueAt(value, "action");
    const relation = valueAt(value, "relation");
    const attempt = decodeAttemptIdentity(valueAt(value, "attempt"), [...path, "attempt"]);
    if ((action !== "executed" && action !== "carried" && action !== "accepted") || (relation !== "origin" && relation !== "reference")) {
      return Either.left(codecError(path, "included Slot has an invalid Member action or relation"));
    }
    if (Either.isLeft(attempt)) return Either.left(attempt.left);
    return Either.right(Object.freeze({
      runId: runId.right,
      slotId: slotId.right,
      experimentId: experimentId.right,
      evalId: evalId.right,
      attemptOrdinal: attemptOrdinal.right,
      executionIdentityDigest: executionIdentityDigest.right,
      state,
      action,
      relation,
      attempt: attempt.right,
    }));
  }
  if (state === "not-recorded") {
    if (!isExactObject(value, ["runId", "slotId", "experimentId", "evalId", "attemptOrdinal", "executionIdentityDigest", "state", "action", "attempt"]) || valueAt(value, "attempt") !== null) {
      return Either.left(codecError(path, "not-recorded Slots must retain a null Attempt"));
    }
    const action = valueAt(value, "action");
    if (action !== null && action !== "not-dispatched" && action !== "interrupted") {
      return Either.left(codecError([...path, "action"], "is not a null Member action"));
    }
    return Either.right(Object.freeze({
      runId: runId.right,
      slotId: slotId.right,
      experimentId: experimentId.right,
      evalId: evalId.right,
      attemptOrdinal: attemptOrdinal.right,
      executionIdentityDigest: executionIdentityDigest.right,
      state,
      action,
      attempt: null,
    }));
  }
  if (state === "core-invalid") {
    if (!isExactObject(value, ["runId", "slotId", "experimentId", "evalId", "attemptOrdinal", "executionIdentityDigest", "state", "action", "attempt", "issues"]) || valueAt(value, "attempt") !== null) {
      return Either.left(codecError(path, "core-invalid Slots must contain null Attempt and issues"));
    }
    const action = valueAt(value, "action");
    if (action !== null && action !== "executed" && action !== "carried" && action !== "accepted" && action !== "not-dispatched" && action !== "interrupted") {
      return Either.left(codecError([...path, "action"], "is not a Member action"));
    }
    const issues = decodeIssues(valueAt(value, "issues"), [...path, "issues"]);
    if (Either.isLeft(issues)) return Either.left(issues.left);
    return Either.right(Object.freeze({
      runId: runId.right,
      slotId: slotId.right,
      experimentId: experimentId.right,
      evalId: evalId.right,
      attemptOrdinal: attemptOrdinal.right,
      executionIdentityDigest: executionIdentityDigest.right,
      state,
      action,
      attempt: null,
      issues: issues.right,
    }));
  }
  return Either.left(codecError([...path, "state"], "must be included, not-recorded, core-invalid, or excluded"));
}

function decodeAttemptIdentity(
  value: unknown,
  path: readonly string[],
): Either.Either<IncludedAnalysisSlot["attempt"], SampleSnapshotCodecError> {
  if (!isExactObject(value, ["kind", "locator", "originRunId"]) || valueAt(value, "kind") !== "attempt") {
    return Either.left(codecError(path, "must contain an Attempt locator identity"));
  }
  const locator = valueAt(value, "locator");
  const originRunId = decodeRunId(valueAt(value, "originRunId"), [...path, "originRunId"]);
  if (typeof locator !== "string" || !parseAttemptLocator(locator).valid) {
    return Either.left(codecError([...path, "locator"], "is not a canonical Attempt locator"));
  }
  return Either.isLeft(originRunId)
    ? Either.left(originRunId.left)
    : Either.right(Object.freeze({ kind: "attempt" as const, locator: locator as IncludedAnalysisSlot["attempt"]["locator"], originRunId: originRunId.right }));
}

function decodeIssues(
  value: unknown,
  path: readonly string[],
): Either.Either<readonly AnalysisIssue[], SampleSnapshotCodecError> {
  if (!Array.isArray(value)) return Either.left(codecError(path, "must be an array"));
  const issues: AnalysisIssue[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isExactObject(entry, ["code", "message", "refs"])) return Either.left(codecError([...path, String(index)], "has unsupported fields"));
    const code = valueAt(entry, "code");
    const message = valueAt(entry, "message");
    const refs = valueAt(entry, "refs");
    if ((code !== "missing" && code !== "unsupported" && code !== "producer-incompatible" && code !== "input-invalid" && code !== "reduction-failed" && code !== "relation-unmatched") || typeof message !== "string" || !Array.isArray(refs)) {
      return Either.left(codecError([...path, String(index)], "is not a closed Analysis issue"));
    }
    const decodedRefs = [] as AnalysisIssue["refs"][number][];
    for (let refIndex = 0; refIndex < refs.length; refIndex += 1) {
      const ref = refs[refIndex];
      if (!isExactObject(ref, ["identity"]) || !isExactObject(valueAt(ref, "identity"), ["kind", "locator"])) {
        return Either.left(codecError([...path, String(index), "refs", String(refIndex)], "is not a closed evidence reference"));
      }
      const identity = valueAt(ref, "identity");
      if (!isExactObject(identity, ["kind", "locator"])) {
        return Either.left(codecError([...path, String(index), "refs", String(refIndex)], "is not a closed evidence reference"));
      }
      const locator = valueAt(identity, "locator");
      if (valueAt(identity, "kind") !== "attempt" || typeof locator !== "string" || !parseAttemptLocator(locator).valid) {
        return Either.left(codecError([...path, String(index), "refs", String(refIndex)], "has an invalid evidence locator"));
      }
      decodedRefs.push(Object.freeze({ identity: Object.freeze({ kind: "attempt" as const, locator: locator as AnalysisIssue["refs"][number]["identity"]["locator"] }) }));
    }
    issues.push(Object.freeze({ code, message, refs: Object.freeze(decodedRefs) }));
  }
  return Either.right(Object.freeze(issues));
}

function decodeArray<Value>(
  value: unknown,
  path: readonly string[],
  decode: (value: unknown, path: readonly string[]) => Either.Either<Value, SampleSnapshotCodecError>,
): Either.Either<readonly Value[], SampleSnapshotCodecError> {
  if (!Array.isArray(value)) return Either.left(codecError(path, "must be an array"));
  const values: Value[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const decoded = decode(value[index], [...path, String(index)]);
    if (Either.isLeft(decoded)) return Either.left(decoded.left);
    values.push(decoded.right);
  }
  return Either.right(Object.freeze(values));
}

function decodeRunId(value: unknown, path: readonly string[]): Either.Either<RunId, SampleSnapshotCodecError> {
  return decodeBrand(RunIdSchema, value, path, "a RunId");
}

function decodeSlotId(value: unknown, path: readonly string[]): Either.Either<SlotId, SampleSnapshotCodecError> {
  return decodeBrand(SlotIdSchema, value, path, "a SlotId");
}

function decodeEvalId(value: unknown, path: readonly string[]): Either.Either<EvalId, SampleSnapshotCodecError> {
  return decodeBrand(EvalIdSchema, value, path, "an EvalId");
}

function decodeAttemptOrdinal(value: unknown, path: readonly string[]): Either.Either<number, SampleSnapshotCodecError> {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? Either.right(value)
    : Either.left(codecError(path, "must be a zero-based non-negative safe attempt ordinal"));
}

function decodeExecutionIdentityDigest(
  value: unknown,
  path: readonly string[],
): Either.Either<ExecutionIdentityDigest, SampleSnapshotCodecError> {
  return decodeBrand(ExecutionIdentityDigestSchema, value, path, "an execution identity digest");
}

function decodeExperimentId(value: unknown, path: readonly string[]): Either.Either<ExperimentId, SampleSnapshotCodecError> {
  return decodeBrand(ExperimentIdSchema, value, path, "an ExperimentId");
}

function decodeUtcMillis(value: unknown, path: readonly string[]): Either.Either<UtcMillis, SampleSnapshotCodecError> {
  return decodeBrand(UtcMillisSchema, value, path, "a UTC millisecond value");
}

function decodeBrand<Value>(
  schema: Schema.Schema<Value, any>,
  value: unknown,
  path: readonly string[],
  label: string,
): Either.Either<Value, SampleSnapshotCodecError> {
  const decoded = Schema.decodeUnknownEither(schema)(value);
  return Either.isLeft(decoded) ? Either.left(codecError(path, `must be ${label}`)) : Either.right(decoded.right);
}

function uniqueSorted<Value extends string>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...new Set<Value>(values)].sort(compareCanonicalIdentity));
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

function sameIdentity(value: unknown, expected: SampleIdentity): boolean {
  return isExactObject(value, ["kind", "id"])
    && valueAt(value, "kind") === expected.kind
    && valueAt(value, "id") === expected.id;
}

function sameCoverage(value: unknown, expected: SampleCoverage): boolean {
  return isExactObject(value, ["frameTotal", "selected", "included", "notRecorded", "coreInvalid", "excluded"])
    && valueAt(value, "frameTotal") === expected.frameTotal
    && valueAt(value, "selected") === expected.selected
    && valueAt(value, "included") === expected.included
    && valueAt(value, "notRecorded") === expected.notRecorded
    && valueAt(value, "coreInvalid") === expected.coreInvalid
    && valueAt(value, "excluded") === expected.excluded;
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

function isPlainObject(value: unknown): value is object {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isExactObject(value: unknown, keys: readonly string[]): value is object {
  if (!isPlainObject(value)) return false;
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && actual.every((key) => typeof key === "string" && keys.includes(key));
}

function valueAt(value: object, key: string): unknown {
  return Reflect.get(value, key);
}
