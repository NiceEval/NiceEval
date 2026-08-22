import { Effect } from "effect";

import type { RecordIssue } from "../record/errors/record-errors.ts";
import type {
  AssertionsAttachment,
} from "../record/family/assertions.ts";
import {
  readAttemptExecutionDuration,
  type DurationLimit,
} from "../eval/record/eligibility.ts";
import {
  foldRecordedAttemptVerdict,
  type VerdictState,
} from "../eval/record/verdict.ts";
import type {
  RecordReadSession,
  ReadableAttempt,
  ReadableRun,
  SelectedAttemptRef,
  SelectedRunRef,
} from "../record/host/types.ts";
import type { RecordCoreRead } from "../record/model/read-state.ts";
import {
  compareCanonicalIdentity,
  isPortableSegment,
  isSha256Digest,
  isUtcMillis,
  type ExecutionIdentityDigest,
  type RunId,
  type SlotId,
  type UtcMillis,
} from "../record/model/identifiers.ts";
import type { AttemptOutcome, RecordSlotIdentity } from "../record/model/core.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type { EvaluationKind } from "./types.ts";

export const PROJECT_TARGET_POLICY_NAME = "project-target" as const;
export const PROJECT_TARGET_POLICY_VERSION = 1 as const;
export const PROJECT_TARGET_INVOCATION_ID_MAXIMUM_LENGTH = 255 as const;
export const PROJECT_TARGET_RECORD_IDENTITY_MAXIMUM_LENGTH = 4096 as const;

export interface ExecutionPolicyIdentity {
  readonly name: typeof PROJECT_TARGET_POLICY_NAME;
  readonly version: typeof PROJECT_TARGET_POLICY_VERSION;
}

export const projectTargetPolicyIdentity: ExecutionPolicyIdentity = Object.freeze({
  name: PROJECT_TARGET_POLICY_NAME,
  version: PROJECT_TARGET_POLICY_VERSION,
});

/** Current planner input, kept in memory rather than persisted as an Attachment. */
export interface ExecutionIdentity {
  readonly domain: string;
  readonly value: string;
}

export interface ExecutionDurationLimit {
  readonly domain: string;
  readonly milliseconds: number;
}

/**
 * Reuse compares current execution identity with the immutable Core Slot,
 * folds Core outcome with Assertions, and reads duration from fixed
 * Observability. None of these facts is a separate eligibility/verdict family.
 */
export type ExecutionComparisonAttachment =
  | "core"
  | "niceeval.assertions"
  | "niceeval.observability";
export type ExecutionComparisonSourceState =
  | "available"
  | "unavailable"
  | "migration-required"
  | "unsupported"
  | "invalid";
export type ExecutionComparisonResult = "match" | "mismatch" | "ineligible" | "not-comparable";
export type ExecutionRecordedClaim =
  | "execution-identity"
  | "attempt-outcome"
  | "assertion-verdict"
  | "execution-duration";

export interface ExecutionComparison {
  readonly attachment: ExecutionComparisonAttachment;
  readonly recordedClaim: ExecutionRecordedClaim;
  readonly sourceState: ExecutionComparisonSourceState;
  readonly result: ExecutionComparisonResult;
  readonly reason: string;
}

export type ExecutionGapReason =
  | "no-source-run"
  | "source-slot-missing"
  | "source-member-missing"
  | "source-core-invalid"
  | "source-attachment-unavailable"
  | "source-attachment-migration-required"
  | "source-attachment-unsupported"
  | "source-attachment-invalid"
  | "reuse-contract-domain-mismatch"
  | "reuse-contract-mismatch"
  | "identity-mismatch"
  | "identity-domain-mismatch"
  | "duration-domain-mismatch"
  | "timeout-exceeded"
  | "attempt-outcome-ineligible"
  | "verdict-ineligible"
  | "rerun-requested"
  | "sandbox-retention-requested";

export type ExecutionGapScope = "slot" | "experiment" | "target";

/** Origin identity is read from the immutable Attempt, never reconstructed. */
export interface ExecutionSourceOrigin {
  readonly runId: RunId;
  readonly slotId: SlotId;
}

/** The selected Run boundary may itself be a reference Run. */
export interface ExecutionSourceBarrier {
  readonly runId: RunId;
  readonly startedAt: UtcMillis;
}

export interface ExecutionReuseEffectiveOptions {
  readonly rerun: "none" | "failed" | "all";
  readonly keepSandbox: boolean;
  readonly reuseContract: ExecutionIdentity;
}

export interface ExecutionTarget {
  readonly invocationId: string;
  readonly runs: readonly TargetRun[];
}

export interface TargetRun {
  readonly runId: RunId;
  readonly experimentId: string;
  readonly startedAt: UtcMillis;
  readonly slots: readonly TargetSlot[];
}

/**
 * `slotId` and `executionIdentityDigest` are deterministic current planning
 * facts. A carried Member can therefore point at the exact immutable origin
 * Attempt without an out-of-band provenance Attachment.
 */
export interface TargetSlot {
  readonly runId: RunId;
  readonly slotId: SlotId;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly evaluationKind: EvaluationKind;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
  readonly inputIdentity: ExecutionIdentity;
  readonly configIdentity: ExecutionIdentity;
  readonly timeout?: ExecutionDurationLimit;
}

export type AssertionsVerdict = VerdictState;

/** The exact selection-issued references remain live only while its reader Scope is live. */
export interface ExecutionReusePlanSource {
  readonly attemptId: SelectedAttemptRef["attemptId"];
  readonly attempt: SelectedAttemptRef;
  readonly origin: ExecutionSourceOrigin;
  readonly originRun: SelectedRunRef;
  readonly sourceBarrier: ExecutionSourceBarrier;
  readonly evaluationKind: EvaluationKind;
}

export interface ProjectTargetPolicy {
  readonly identity: ExecutionPolicyIdentity;
  readonly reuseContract: ExecutionIdentity;
  readonly rerun: "none" | "failed" | "all";
  readonly keepSandbox: boolean;
}

export interface ExecutionReusePlanSlotBase extends TargetSlot {
  readonly comparisons: readonly ExecutionComparison[];
}

export interface ReusePlanSlot extends ExecutionReusePlanSlotBase {
  readonly state: "reuse";
  readonly adoption: "carried";
  readonly source: ExecutionReusePlanSource;
}

export interface ExecutionGapSlot extends ExecutionReusePlanSlotBase {
  readonly state: "gap";
  readonly reason: ExecutionGapReason;
  readonly scope: ExecutionGapScope;
  readonly issues: readonly RecordIssue[];
  readonly sourceBarrier?: ExecutionSourceBarrier;
  readonly candidate?: ExecutionReusePlanSource;
}

export type ExecutionReusePlanSlot = ReusePlanSlot | ExecutionGapSlot;

export interface ExecutionReusePlan {
  readonly target: ExecutionTarget;
  readonly policy: ExecutionPolicyIdentity;
  readonly effectiveOptions: ExecutionReuseEffectiveOptions;
  readonly slots: readonly ExecutionReusePlanSlot[];
  readonly reuse: readonly ReusePlanSlot[];
  readonly gaps: readonly ExecutionGapSlot[];
}

export interface ProjectTargetReusePlanInput {
  readonly reader: RecordReadSession;
  readonly target: ExecutionTarget;
  readonly policy: ProjectTargetPolicy;
}

export type ProjectTargetReusePlanInvalidReason =
  | "invocation-id-invalid"
  | "target-run-invalid"
  | "target-run-duplicate"
  | "target-slot-invalid"
  | "target-slot-duplicate"
  | "target-slot-run-mismatch"
  | "target-slot-experiment-mismatch"
  | "target-slot-ordinal-duplicate"
  | "policy-unsupported"
  | "policy-input-invalid";

export interface ProjectTargetReusePlanInvalid {
  readonly code: "project-target-reuse-plan-invalid";
  readonly reason: ProjectTargetReusePlanInvalidReason;
}

/**
 * Fold the terminal Verdict from the source Attempt's immutable Core outcome
 * and its fixed Assertions facts. This is a projection, not a second durable
 * Verdict family.
 */
export function recordedAttemptVerdict(input: {
  readonly outcome: AttemptOutcome;
  readonly assertions: AssertionsAttachment;
}): AssertionsVerdict {
  return foldRecordedAttemptVerdict(input);
}

/** Input validation is pure; it never invents a target Slot or repairs an identity. */
export function validateProjectTargetReusePlanInput(input: {
  readonly target: ExecutionTarget;
  readonly policy: ProjectTargetPolicy;
}): ProjectTargetReusePlanInvalid | undefined {
  const unknownInput: unknown = input;
  if (typeof unknownInput !== "object" || unknownInput === null) {
    return invalidPlan("target-run-invalid");
  }
  const envelope = unknownInput as { readonly target?: unknown; readonly policy?: unknown };
  if (typeof envelope.target !== "object" || envelope.target === null) {
    return invalidPlan("target-run-invalid");
  }
  const target = envelope.target as { readonly invocationId?: unknown; readonly runs?: unknown };
  if (
    typeof target.invocationId !== "string"
    || !isBoundedNonEmptyText(target.invocationId, PROJECT_TARGET_INVOCATION_ID_MAXIMUM_LENGTH)
    || !Array.isArray(target.runs)
  ) {
    return invalidPlan("invocation-id-invalid");
  }
  if (typeof envelope.policy !== "object" || envelope.policy === null) {
    return invalidPlan("policy-input-invalid");
  }
  const policy = envelope.policy as {
    readonly identity?: unknown;
    readonly reuseContract?: unknown;
    readonly rerun?: unknown;
    readonly keepSandbox?: unknown;
  };
  if (
    typeof policy.identity !== "object"
    || policy.identity === null
    || (policy.identity as { readonly name?: unknown }).name !== PROJECT_TARGET_POLICY_NAME
    || (policy.identity as { readonly version?: unknown }).version !== PROJECT_TARGET_POLICY_VERSION
  ) {
    return invalidPlan("policy-unsupported");
  }
  if (
    !isExecutionIdentity(policy.reuseContract)
    || !isRerunOption(policy.rerun)
    || typeof policy.keepSandbox !== "boolean"
  ) {
    return invalidPlan("policy-input-invalid");
  }

  const runIds = new Set<string>();
  const slotIds = new Set<string>();
  const ordinals = new Set<string>();
  for (const run of target.runs) {
    if (!isTargetRun(run)) return invalidPlan("target-run-invalid");
    if (runIds.has(run.runId)) return invalidPlan("target-run-duplicate");
    runIds.add(run.runId);
    for (const slot of run.slots) {
      if (!isTargetSlot(slot)) return invalidPlan("target-slot-invalid");
      if (slot.runId !== run.runId) return invalidPlan("target-slot-run-mismatch");
      if (slot.experimentId !== run.experimentId) {
        return invalidPlan("target-slot-experiment-mismatch");
      }
      if (slotIds.has(slot.slotId)) return invalidPlan("target-slot-duplicate");
      slotIds.add(slot.slotId);
      const ordinal = sourceKey(slot.experimentId, slot.evalId, String(slot.attempt));
      if (ordinals.has(ordinal)) return invalidPlan("target-slot-ordinal-duplicate");
      ordinals.add(ordinal);
    }
  }
  return undefined;
}

/**
 * Plans only from Record Host selection references. It neither reconstructs
 * attempt handles from strings nor reads private Record paths.
 */
export function planProjectTargetReuse(
  input: ProjectTargetReusePlanInput,
): Effect.Effect<
  ExecutionReusePlan,
  ProjectTargetReusePlanInvalid | RecordReaderReadError
> {
  return Effect.suspend<
    ExecutionReusePlan,
    ProjectTargetReusePlanInvalid | RecordReaderReadError,
    never
  >(() => {
    const invalid = validateProjectTargetReusePlanInput(input);
    if (invalid !== undefined) return Effect.fail(invalid);

    return Effect.gen(function* () {
      const selection = yield* input.reader.selectRuns();
      const readable = yield* Effect.forEach(
        selection.runRefs,
        (ref) => input.reader.readRun(ref),
        { concurrency: 1 },
      );
      const runs: ReadableRun[] = [];
      const coreIssues: RecordIssue[] = [];
      for (const read of readable) {
        if (read.state === "available") runs.push(read.value);
        else if (read.state === "core-invalid") coreIssues.push(...read.issues);
      }
      const byRunId = new Map(runs.map((run) => [run.document.runId, run] as const));
      const slots: ExecutionReusePlanSlot[] = [];
      for (const target of flattenTargetSlots(input.target)) {
        slots.push(yield* planTargetSlot({
          reader: input.reader,
          target,
          policy: input.policy,
          runs,
          byRunId,
          selectionHasProblem: selection.problems.length > 0 || coreIssues.length > 0,
          coreIssues,
        }));
      }
      const reuse = slots.filter((slot): slot is ReusePlanSlot => slot.state === "reuse");
      const gaps = slots.filter((slot): slot is ExecutionGapSlot => slot.state === "gap");
      return Object.freeze({
        target: input.target,
        policy: projectTargetPolicyIdentity,
        effectiveOptions: effectiveOptions(input.policy),
        slots: Object.freeze(slots),
        reuse: Object.freeze(reuse),
        gaps: Object.freeze(gaps),
      });
    });
  });
}

/** Empty or not-yet-created Record roots produce no source capability. */
export function planProjectTargetReuseWithoutSources(input: {
  readonly target: ExecutionTarget;
  readonly policy: ProjectTargetPolicy;
}): Effect.Effect<ExecutionReusePlan, ProjectTargetReusePlanInvalid> {
  return Effect.suspend(() => {
    const invalid = validateProjectTargetReusePlanInput(input);
    if (invalid !== undefined) return Effect.fail(invalid);
    const gaps = Object.freeze(flattenTargetSlots(input.target).map((target) =>
      gapSlot(target, {
        reason: "no-source-run",
        scope: "slot",
        issues: [],
        comparisons: [],
      })
    ));
    return Effect.succeed(Object.freeze({
      target: input.target,
      policy: projectTargetPolicyIdentity,
      effectiveOptions: effectiveOptions(input.policy),
      slots: gaps,
      reuse: Object.freeze([]),
      gaps,
    }));
  });
}

export const ProjectTargetReusePlanner = Object.freeze({ plan: planProjectTargetReuse });

function planTargetSlot(input: {
  readonly reader: RecordReadSession;
  readonly target: TargetSlot;
  readonly policy: ProjectTargetPolicy;
  readonly runs: readonly ReadableRun[];
  readonly byRunId: ReadonlyMap<RunId, ReadableRun>;
  readonly selectionHasProblem: boolean;
  readonly coreIssues: readonly RecordIssue[];
}): Effect.Effect<ExecutionReusePlanSlot, RecordReaderReadError> {
  return Effect.gen(function* () {
    if (input.selectionHasProblem) {
      return gapSlot(input.target, {
        reason: "source-core-invalid",
        scope: "target",
        issues: input.coreIssues,
        comparisons: [],
      });
    }
    const sourceRun = latestSourceRun(input.runs, input.target);
    if (sourceRun === undefined) {
      return gapSlot(input.target, {
        reason: "no-source-run",
        scope: "slot",
        issues: [],
        comparisons: [],
      });
    }
    const sourceBarrier = Object.freeze({
      runId: sourceRun.document.runId,
      startedAt: sourceRun.document.startedAt,
    });
    const expected = sourceRun.document.expectedSlots.find((slot) =>
      slot.evalId === input.target.evalId
      && slot.attemptOrdinal === input.target.attempt
    );
    if (expected === undefined) {
      return gapSlot(input.target, {
        reason: "source-slot-missing",
        scope: "slot",
        issues: [],
        sourceBarrier,
        comparisons: [],
      });
    }
    const member = sourceRun.members.find((candidate) => candidate.document.slotId === expected.slotId);
    if (member === undefined || member.attempt === null) {
      return gapSlot(input.target, {
        reason: "source-member-missing",
        scope: "slot",
        issues: [],
        sourceBarrier,
        comparisons: [],
      });
    }
    const readAttempt = yield* input.reader.readAttempt(member.attempt);
    if (readAttempt.state !== "available") {
      return gapSlot(input.target, {
        reason: "source-core-invalid",
        scope: "slot",
        issues: issuesOf(readAttempt),
        sourceBarrier,
        comparisons: [],
      });
    }
    const candidateResolution = candidateFor({
      target: input.target,
      sourceBarrier,
      attempt: readAttempt.value,
      byRunId: input.byRunId,
    });
    if (candidateResolution === undefined) {
      return gapSlot(input.target, {
        reason: "source-core-invalid",
        scope: "slot",
        issues: [],
        sourceBarrier,
        comparisons: [],
      });
    }
    const candidate = candidateResolution.source;
    if (!reusableSlotIdentityMatches({
      target: input.target,
      sourceExpected: expected,
      originExpected: candidateResolution.originExpected,
    })) {
      return gapSlot(input.target, {
        reason: "identity-mismatch",
        scope: "slot",
        issues: [],
        sourceBarrier,
        candidate,
        comparisons: [identityMismatchComparison()],
      });
    }
    const assertions = yield* input.reader.readAssertions(readAttempt.value.owner);
    if (assertions.state !== "available") {
      const problem = attachmentProblem(assertions);
      return gapSlot(input.target, {
        reason: problem.reason,
        scope: "slot",
        issues: problem.issues,
        sourceBarrier,
        candidate,
        comparisons: [comparison(
          "niceeval.assertions",
          "assertion-verdict",
          problem.state,
          "not-comparable",
          problem.reason,
        )],
      });
    }
    const verdict = recordedAttemptVerdict({
      outcome: readAttempt.value.document.outcome,
      assertions: assertions.value,
    });
    if (readAttempt.value.document.outcome !== "completed") {
      return gapSlot(input.target, {
        reason: "attempt-outcome-ineligible",
        scope: "slot",
        issues: [],
        sourceBarrier,
        candidate,
        comparisons: [
          comparison(
            "core",
            "attempt-outcome",
            "available",
            "ineligible",
            `attempt-${readAttempt.value.document.outcome}`,
          ),
          verdictComparison(verdict, "ineligible"),
        ],
      });
    }
    if (verdict !== "passed" && verdict !== "failed") {
      return gapSlot(input.target, {
        reason: "verdict-ineligible",
        scope: "slot",
        issues: [],
        sourceBarrier,
        candidate,
        comparisons: [verdictComparison(verdict, "ineligible")],
      });
    }
    const observability = yield* input.reader.readAttemptObservability(readAttempt.value.owner);
    if (observability.state !== "available") {
      const problem = attachmentProblem(observability);
      return gapSlot(input.target, {
        reason: problem.reason,
        scope: "slot",
        issues: problem.issues,
        sourceBarrier,
        candidate,
        comparisons: [comparison(
          "niceeval.observability",
          "execution-duration",
          problem.state,
          "not-comparable",
          problem.reason,
        )],
      });
    }
    const durationRead = readAttemptExecutionDuration(observability.value);
    if (durationRead.state !== "available") {
      return gapSlot(input.target, {
        reason: "source-attachment-unavailable",
        scope: "slot",
        issues: [],
        sourceBarrier,
        candidate,
        comparisons: [comparison(
          "niceeval.observability",
          "execution-duration",
          "unavailable",
          "not-comparable",
          durationRead.reason,
        )],
      });
    }
    const duration = durationComparison({
      source: durationRead.duration,
      target: input.target.timeout,
    });
    if (duration.failure !== undefined) {
      return gapSlot(input.target, {
        reason: duration.failure,
        scope: "slot",
        issues: [],
        sourceBarrier,
        candidate,
        comparisons: [duration.comparison],
      });
    }
    if (
      input.policy.rerun === "all"
      || (input.policy.rerun === "failed" && verdict === "failed")
    ) {
      return gapSlot(input.target, {
        reason: "rerun-requested",
        scope: "slot",
        issues: [],
        sourceBarrier,
        candidate,
        comparisons: [verdictComparison(verdict, "match"), duration.comparison],
      });
    }
    if (input.policy.keepSandbox) {
      return gapSlot(input.target, {
        reason: "sandbox-retention-requested",
        scope: "slot",
        issues: [],
        sourceBarrier,
        candidate,
        comparisons: [verdictComparison(verdict, "match"), duration.comparison],
      });
    }
    return Object.freeze({
      ...input.target,
      state: "reuse" as const,
      adoption: "carried" as const,
      source: candidate,
      comparisons: Object.freeze([
        comparison("core", "execution-identity", "available", "match", "execution-identity-match"),
        comparison("core", "attempt-outcome", "available", "match", "attempt-completed"),
        verdictComparison(verdict, "match"),
        duration.comparison,
      ]),
    });
  });
}

function latestSourceRun(
  runs: readonly ReadableRun[],
  target: TargetSlot,
): ReadableRun | undefined {
  const candidates = runs.filter((run) =>
    run.document.experimentId === target.experimentId
    && run.document.expectedSlots.some((slot) => slot.evalId === target.evalId)
  );
  return candidates.sort(compareReadableRuns).at(-1);
}

function compareReadableRuns(left: ReadableRun, right: ReadableRun): number {
  if (left.document.startedAt !== right.document.startedAt) {
    return left.document.startedAt < right.document.startedAt ? -1 : 1;
  }
  return compareCanonicalIdentity(left.document.runId, right.document.runId);
}

interface CandidateResolution {
  readonly source: ExecutionReusePlanSource;
  readonly originExpected: RecordSlotIdentity;
}

function candidateFor(input: {
  readonly target: TargetSlot;
  readonly sourceBarrier: ExecutionSourceBarrier;
  readonly attempt: ReadableAttempt;
  readonly byRunId: ReadonlyMap<RunId, ReadableRun>;
}): CandidateResolution | undefined {
  const document = input.attempt.document;
  const originRun = input.byRunId.get(document.originRunId);
  if (originRun === undefined) return undefined;
  const originExpected = originRun.document.expectedSlots.find(
    (slot) => slot.slotId === document.slotId,
  );
  if (
    originExpected === undefined
    || document.evalId !== originExpected.evalId
    || document.executionIdentityDigest !== originExpected.executionIdentityDigest
  ) {
    return undefined;
  }
  return Object.freeze({
    source: Object.freeze({
      attemptId: input.attempt.ref.attemptId,
      attempt: input.attempt.ref,
      origin: Object.freeze({ runId: document.originRunId, slotId: document.slotId }),
      originRun: originRun.ref,
      sourceBarrier: input.sourceBarrier,
      evaluationKind: input.target.evaluationKind,
    }),
    originExpected,
  });
}

function sameSlotIdentity(
  left: RecordSlotIdentity,
  right: RecordSlotIdentity,
): boolean {
  return left.slotId === right.slotId
    && left.evalId === right.evalId
    && left.attemptOrdinal === right.attemptOrdinal
    && left.executionIdentityDigest === right.executionIdentityDigest;
}

function targetMatchesSlotIdentity(
  target: TargetSlot,
  slot: RecordSlotIdentity,
): boolean {
  return target.slotId === slot.slotId
    && target.evalId === slot.evalId
    && target.attempt === slot.attemptOrdinal
    && target.executionIdentityDigest === slot.executionIdentityDigest;
}

function reusableSlotIdentityMatches(input: {
  readonly target: TargetSlot;
  readonly sourceExpected: RecordSlotIdentity;
  readonly originExpected: RecordSlotIdentity;
}): boolean {
  return sameSlotIdentity(input.sourceExpected, input.originExpected)
    && targetMatchesSlotIdentity(input.target, input.sourceExpected)
    && targetMatchesSlotIdentity(input.target, input.originExpected);
}

function issuesOf(read: RecordCoreRead<unknown>): readonly RecordIssue[] {
  return read.state === "core-invalid" ? read.issues : Object.freeze([]);
}

function attachmentProblem(input: {
  readonly state: "not-recorded" | "migration-required" | "unsupported" | "invalid";
  readonly family?: string;
  readonly schemaVersion?: number;
  readonly issues?: readonly RecordIssue[];
}): {
  readonly reason: Extract<
    ExecutionGapReason,
    | "source-attachment-unavailable"
    | "source-attachment-migration-required"
    | "source-attachment-unsupported"
    | "source-attachment-invalid"
  >;
  readonly state: Exclude<ExecutionComparisonSourceState, "available">;
  readonly issues: readonly RecordIssue[];
} {
  switch (input.state) {
    case "not-recorded":
      return Object.freeze({
        reason: "source-attachment-unavailable" as const,
        state: "unavailable" as const,
        issues: Object.freeze([]),
      });
    case "migration-required":
      return Object.freeze({
        reason: "source-attachment-migration-required" as const,
        state: "migration-required" as const,
        issues: Object.freeze([]),
      });
    case "unsupported":
      return Object.freeze({
        reason: "source-attachment-unsupported" as const,
        state: "unsupported" as const,
        issues: Object.freeze([]),
      });
    case "invalid":
      return Object.freeze({
        reason: "source-attachment-invalid" as const,
        state: "invalid" as const,
        issues: input.issues ?? Object.freeze([]),
      });
  }
}

function identityMismatchComparison(): ExecutionComparison {
  return comparison(
    "core",
    "execution-identity",
    "available",
    "mismatch",
    "identity-mismatch",
  );
}

function verdictComparison(
  verdict: AssertionsVerdict,
  result: Extract<ExecutionComparisonResult, "match" | "ineligible">,
): ExecutionComparison {
  return comparison(
    "niceeval.assertions",
    "assertion-verdict",
    "available",
    result,
    verdict === "errored" ? "verdict-ineligible" : `verdict-${verdict}`,
  );
}

function durationComparison(input: {
  readonly source: DurationLimit;
  readonly target: ExecutionDurationLimit | undefined;
}): {
  readonly comparison: ExecutionComparison;
  readonly failure?: "duration-domain-mismatch" | "timeout-exceeded";
} {
  if (input.target === undefined) {
    return {
      comparison: comparison(
        "niceeval.observability",
        "execution-duration",
        "available",
        "match",
        "timeout-unbounded",
      ),
    };
  }
  if (input.source.domain !== input.target.domain) {
    return {
      comparison: comparison(
        "niceeval.observability",
        "execution-duration",
        "available",
        "mismatch",
        "duration-domain-mismatch",
      ),
      failure: "duration-domain-mismatch",
    };
  }
  if (input.source.milliseconds > input.target.milliseconds) {
    return {
      comparison: comparison(
        "niceeval.observability",
        "execution-duration",
        "available",
        "mismatch",
        "timeout-exceeded",
      ),
      failure: "timeout-exceeded",
    };
  }
  return {
    comparison: comparison(
      "niceeval.observability",
      "execution-duration",
      "available",
      "match",
      "duration-within-timeout",
    ),
  };
}

function comparison(
  attachment: ExecutionComparisonAttachment,
  recordedClaim: ExecutionRecordedClaim,
  sourceState: ExecutionComparisonSourceState,
  result: ExecutionComparisonResult,
  reason: string,
): ExecutionComparison {
  return Object.freeze({ attachment, recordedClaim, sourceState, result, reason });
}

function gapSlot(
  target: TargetSlot,
  input: {
    readonly reason: ExecutionGapReason;
    readonly scope: ExecutionGapScope;
    readonly issues: readonly RecordIssue[];
    readonly comparisons: readonly ExecutionComparison[];
    readonly sourceBarrier?: ExecutionSourceBarrier;
    readonly candidate?: ExecutionReusePlanSource;
  },
): ExecutionGapSlot {
  return Object.freeze({
    ...target,
    state: "gap" as const,
    reason: input.reason,
    scope: input.scope,
    issues: Object.freeze([...input.issues]),
    ...(input.sourceBarrier === undefined ? {} : { sourceBarrier: input.sourceBarrier }),
    ...(input.candidate === undefined ? {} : { candidate: input.candidate }),
    comparisons: Object.freeze([...input.comparisons]),
  });
}

function effectiveOptions(policy: ProjectTargetPolicy): ExecutionReuseEffectiveOptions {
  return Object.freeze({
    rerun: policy.rerun,
    keepSandbox: policy.keepSandbox,
    reuseContract: Object.freeze({
      domain: policy.reuseContract.domain,
      value: policy.reuseContract.value,
    }),
  });
}

function flattenTargetSlots(target: ExecutionTarget): readonly TargetSlot[] {
  return Object.freeze(target.runs.flatMap((run) => run.slots));
}

function sourceKey(experimentId: string, evalId: string, ordinal?: string): string {
  return ordinal === undefined
    ? `${experimentId}\u0000${evalId}`
    : `${experimentId}\u0000${evalId}\u0000${ordinal}`;
}

function invalidPlan(reason: ProjectTargetReusePlanInvalidReason): ProjectTargetReusePlanInvalid {
  return Object.freeze({ code: "project-target-reuse-plan-invalid", reason });
}

function isTargetRun(value: unknown): value is TargetRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Partial<TargetRun>;
  return (
    typeof run.runId === "string"
    && isPortableSegment(run.runId)
    && typeof run.experimentId === "string"
    && isBoundedRecordIdentity(run.experimentId)
    && typeof run.startedAt === "number"
    && isUtcMillis(run.startedAt)
    && Array.isArray(run.slots)
  );
}

function isTargetSlot(value: unknown): value is TargetSlot {
  if (typeof value !== "object" || value === null) return false;
  const slot = value as Partial<TargetSlot>;
  return (
    typeof slot.runId === "string"
    && isPortableSegment(slot.runId)
    && typeof slot.slotId === "string"
    && isPortableSegment(slot.slotId)
    && typeof slot.experimentId === "string"
    && isBoundedRecordIdentity(slot.experimentId)
    && typeof slot.evalId === "string"
    && isBoundedRecordIdentity(slot.evalId)
    && typeof slot.attempt === "number"
    && Number.isSafeInteger(slot.attempt)
    && slot.attempt >= 0
    && (slot.evaluationKind === "pass" || slot.evaluationKind === "score")
    && typeof slot.executionIdentityDigest === "string"
    && isSha256Digest(slot.executionIdentityDigest)
    && isExecutionIdentity(slot.inputIdentity)
    && isExecutionIdentity(slot.configIdentity)
    && (slot.timeout === undefined || isExecutionDurationLimit(slot.timeout))
  );
}

function isBoundedNonEmptyText(value: string, maximumLength: number): boolean {
  return value.length > 0 && value.length <= maximumLength;
}

function isBoundedRecordIdentity(value: string): boolean {
  return isBoundedNonEmptyText(value, PROJECT_TARGET_RECORD_IDENTITY_MAXIMUM_LENGTH)
    && !value.includes("\u0000");
}

function isRerunOption(value: unknown): value is ProjectTargetPolicy["rerun"] {
  return value === "none" || value === "failed" || value === "all";
}

function isExecutionIdentity(value: unknown): value is ExecutionIdentity {
  if (typeof value !== "object" || value === null) return false;
  const identity = value as { readonly domain?: unknown; readonly value?: unknown };
  return typeof identity.domain === "string"
    && isBoundedRecordIdentity(identity.domain)
    && typeof identity.value === "string"
    && isBoundedRecordIdentity(identity.value);
}

function isExecutionDurationLimit(value: unknown): value is ExecutionDurationLimit {
  if (typeof value !== "object" || value === null) return false;
  const duration = value as { readonly domain?: unknown; readonly milliseconds?: unknown };
  return typeof duration.domain === "string"
    && isBoundedRecordIdentity(duration.domain)
    && typeof duration.milliseconds === "number"
    && Number.isFinite(duration.milliseconds)
    && duration.milliseconds >= 0;
}
