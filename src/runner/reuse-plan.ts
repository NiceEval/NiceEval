import { Effect, Stream } from "effect";
import {
  evaluationsAttachmentFamilyV1,
  projectEvaluationsAttachmentV1,
  type EvaluationDefinitionV1,
  type EvaluationIdV1,
  type EvaluationKindV1,
  type ExperimentIdV1,
} from "../eval/record/evaluation.ts";
import {
  eligibilityAttachmentFamilyV1,
  isDurationLimitV1,
  isEqualityTokenV1,
  projectEligibilityAttachmentV1,
  type AttemptEligibilityPayloadV1,
  type DurationLimitV1,
  type EqualityTokenV1,
} from "../eval/record/eligibility.ts";
import {
  type ComparisonAttachmentV1,
  type ComparisonProvenanceV1,
  type ComparisonSourceStateV1,
  type ExecutionGapReasonV1,
  type ExecutionGapScopeV1,
  type MembershipAttemptOriginV1,
  type MembershipEffectiveOptionsV1,
  type MembershipSourceBarrierV1,
} from "../eval/record/membership-provenance.ts";
import {
  projectVerdictAttachmentV1,
  verdictAttachmentFamilyV1,
  type VerdictStateV1,
} from "../eval/record/verdict.ts";
import type { RecordIssue } from "../record/errors/record-errors.ts";
import { recordAttemptReferenceKey } from "../record/model/core.ts";
import {
  compareCanonicalIdentity,
  isPortableSegment,
  type RunId,
  type SlotId,
  type UtcMillis,
} from "../record/model/identifiers.ts";
import type { RecordAttachmentRead, RecordCoreRead } from "../record/model/read-state.ts";
import { resolveFrozenRecordReaderPort, type FrozenRecordReaderPort } from "../record/reader/internal.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";
import type {
  FrozenRecordAttempt,
  FrozenRecordRun,
  FrozenRecordView,
} from "../record/reader/types.ts";

export const PROJECT_TARGET_POLICY_NAME_V1 = "project-target" as const;
export const PROJECT_TARGET_POLICY_VERSION_V1 = 1 as const;
export const PROJECT_TARGET_INVOCATION_ID_MAXIMUM_LENGTH_V1 = 255 as const;
export const PROJECT_TARGET_RECORD_IDENTITY_MAXIMUM_LENGTH_V1 = 4096 as const;

export interface ExecutionPolicyIdentity {
  readonly name: typeof PROJECT_TARGET_POLICY_NAME_V1;
  readonly version: typeof PROJECT_TARGET_POLICY_VERSION_V1;
}

export const projectTargetPolicyIdentityV1: ExecutionPolicyIdentity = Object.freeze({
  name: PROJECT_TARGET_POLICY_NAME_V1,
  version: PROJECT_TARGET_POLICY_VERSION_V1,
});

/** A fully evaluated target is immutable before this planner sees it. */
export interface ExecutionTarget {
  readonly invocationId: string;
  readonly runs: readonly TargetRun[];
}

export interface TargetRun {
  readonly runId: RunId;
  readonly experimentId: ExperimentIdV1;
  readonly startedAt: UtcMillis;
  readonly slots: readonly TargetSlot[];
}

export interface TargetSlot {
  readonly runId: RunId;
  readonly slotId: SlotId;
  readonly experimentId: ExperimentIdV1;
  readonly evalId: EvaluationIdV1;
  readonly attempt: number;
  readonly inputIdentity: EqualityTokenV1;
  readonly configIdentity: EqualityTokenV1;
  readonly timeout?: DurationLimitV1;
}

/**
 * The policy's expected reuse contract is explicit instead of being derived
 * from a prior Attempt. This lets a new required gate change only the policy
 * token/domain and fail closed against older eligibility facts.
 */
export interface ProjectTargetPolicyV1 {
  readonly identity: ExecutionPolicyIdentity;
  readonly reuseContract: EqualityTokenV1;
  readonly rerun: "none" | "failed" | "all";
  readonly keepSandbox: boolean;
}

export interface ExecutionReusePlanSlotBase extends TargetSlot {
  readonly comparisons: readonly ComparisonProvenanceV1[];
}

/** A carried reference always retains Record's exact frozen Attempt capability. */
export interface ReusePlanSlot extends ExecutionReusePlanSlotBase {
  readonly state: "reuse";
  readonly adoption: "carried";
  /**
   * The source Run's current `niceeval.evaluations/v1` projection. Readback
   * uses this to decide whether a Score Attachment is semantically applicable
   * without reopening or guessing from a legacy result shape.
   */
  readonly sourceEvaluationKind: EvaluationKindV1;
  readonly attemptId: FrozenRecordAttempt["attemptId"];
  readonly sourceAttempt: FrozenRecordAttempt;
  readonly origin: MembershipAttemptOriginV1;
  readonly sourceBarrier: MembershipSourceBarrierV1;
}

export interface ExecutionGapSlot extends ExecutionReusePlanSlotBase {
  readonly state: "gap";
  readonly reason: ExecutionGapReasonV1;
  readonly scope: ExecutionGapScopeV1;
  readonly issues: readonly RecordIssue[];
  readonly sourceBarrier?: MembershipSourceBarrierV1;
}

export type ExecutionReusePlanSlot = ReusePlanSlot | ExecutionGapSlot;

export interface ExecutionReusePlan {
  readonly target: ExecutionTarget;
  readonly policy: ExecutionPolicyIdentity;
  readonly effectiveOptions: MembershipEffectiveOptionsV1;
  readonly slots: readonly ExecutionReusePlanSlot[];
  readonly reuse: readonly ReusePlanSlot[];
  readonly gaps: readonly ExecutionGapSlot[];
}

export interface ProjectTargetReusePlanInput {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly target: ExecutionTarget;
  readonly policy: ProjectTargetPolicyV1;
}

export type ProjectTargetReusePlanInvalidReason =
  | "view-invalid"
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

/** Planning cannot safely continue when its current target/policy is incomplete. */
export interface ProjectTargetReusePlanInvalid {
  readonly code: "project-target-reuse-plan-invalid";
  readonly reason: ProjectTargetReusePlanInvalidReason;
}

interface SourceCandidate {
  readonly run: FrozenRecordRun;
  readonly evaluation: EvaluationDefinitionV1;
}

export type ProjectTargetAttachmentGapReason = Extract<
  ExecutionGapReasonV1,
  | "source-attachment-unavailable"
  | "source-attachment-migration-required"
  | "source-attachment-migration-unavailable"
  | "source-attachment-unsupported"
  | "source-attachment-invalid"
>;

export interface ProjectTargetAttachmentProblem {
  readonly reason: ProjectTargetAttachmentGapReason;
  readonly state: ComparisonSourceStateV1;
  readonly issues: readonly RecordIssue[];
}

interface SourceDiscovery {
  readonly latestByExperimentEval: ReadonlyMap<string, SourceCandidate>;
  readonly unattributedProblem?: {
    readonly reason: ExecutionGapReasonV1;
    readonly issues: readonly RecordIssue[];
  };
}

interface SourceDiscoveryAccumulator {
  readonly latestByExperimentEval: Map<string, SourceCandidate>;
  unattributedProblem?: SourceDiscovery["unattributedProblem"];
}

type OriginLookup =
  | { readonly state: "available"; readonly origin: MembershipAttemptOriginV1 }
  | { readonly state: "invalid"; readonly issues: readonly RecordIssue[] };

interface AttemptEligibilityComparison {
  readonly comparisons: readonly ComparisonProvenanceV1[];
  readonly reason?: Exclude<
    ExecutionGapReasonV1,
    | "no-source-run"
    | "source-slot-missing"
    | "source-member-missing"
    | "source-core-invalid"
    | "source-attachment-unavailable"
    | "source-attachment-migration-required"
    | "source-attachment-migration-unavailable"
    | "source-attachment-unsupported"
    | "source-attachment-invalid"
  >;
}

/**
 * Validates the immutable input before any Record I/O. This stays pure so the
 * planner never invents target identities or silently repairs duplicate slots.
 */
export function validateProjectTargetReusePlanInput(input: {
  readonly target: ExecutionTarget;
  readonly policy: ProjectTargetPolicyV1;
}): ProjectTargetReusePlanInvalid | undefined {
  const unknownInput: unknown = input;
  if (typeof unknownInput !== "object" || unknownInput === null) {
    return invalidPlan("target-run-invalid");
  }
  const envelope = unknownInput as {
    readonly target?: unknown;
    readonly policy?: unknown;
  };
  if (typeof envelope.target !== "object" || envelope.target === null) {
    return invalidPlan("target-run-invalid");
  }
  const target = envelope.target as {
    readonly invocationId?: unknown;
    readonly runs?: unknown;
  };
  if (
    typeof target.invocationId !== "string"
    || !isBoundedNonEmptyText(
      target.invocationId,
      PROJECT_TARGET_INVOCATION_ID_MAXIMUM_LENGTH_V1,
    )
  ) {
    return invalidPlan("invocation-id-invalid");
  }
  if (!Array.isArray(target.runs)) return invalidPlan("target-run-invalid");

  if (typeof envelope.policy !== "object" || envelope.policy === null) {
    return invalidPlan("policy-input-invalid");
  }
  const policy = envelope.policy as {
    readonly identity?: unknown;
    readonly reuseContract?: unknown;
    readonly rerun?: unknown;
    readonly keepSandbox?: unknown;
  };
  if (typeof policy.identity !== "object" || policy.identity === null) {
    return invalidPlan("policy-unsupported");
  }
  const identity = policy.identity as {
    readonly name?: unknown;
    readonly version?: unknown;
  };
  if (
    identity.name !== PROJECT_TARGET_POLICY_NAME_V1
    || identity.version !== PROJECT_TARGET_POLICY_VERSION_V1
  ) {
    return invalidPlan("policy-unsupported");
  }
  if (
    !isEqualityTokenV1(policy.reuseContract)
    || !isRerunOption(policy.rerun)
    || typeof policy.keepSandbox !== "boolean"
  ) {
    return invalidPlan("policy-input-invalid");
  }

  const runIds = new Set<string>();
  const slotIds = new Set<string>();
  const ordinals = new Set<string>();
  for (const run of target.runs) {
    if (
      !isTargetRun(run)
      || typeof run.runId !== "string"
      || typeof run.experimentId !== "string"
      || !isUtcMillis(run.startedAt)
    ) {
      return invalidPlan("target-run-invalid");
    }
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
 * Purely compares the two available immutable payloads. Record reads and
 * attachment states are handled outside this function, preserving the domain
 * boundary between I/O and equality/rerun policy.
 */
export function compareProjectTargetAttemptEligibility(input: {
  readonly eligibility: AttemptEligibilityPayloadV1;
  readonly verdict: VerdictStateV1;
  readonly target: TargetSlot;
  readonly policy: ProjectTargetPolicyV1;
}): AttemptEligibilityComparison {
  const comparisons: ComparisonProvenanceV1[] = [];
  let reason: AttemptEligibilityComparison["reason"];
  const chooseReason = (next: NonNullable<AttemptEligibilityComparison["reason"]>): void => {
    if (reason === undefined) reason = next;
  };

  const reuseContract = compareToken(
    "reuse-contract",
    input.eligibility.reuseContract,
    input.policy.reuseContract,
    "reuse-contract-domain-mismatch",
    "reuse-contract-mismatch",
  );
  comparisons.push(reuseContract.comparison);
  if (reuseContract.reason !== undefined) chooseReason(reuseContract.reason);

  const verdictEligible = input.verdict === "passed" || input.verdict === "failed";
  comparisons.push(
    comparison(
      "niceeval.verdict/v1",
      "verdict-state",
      "available",
      verdictEligible ? "match" : "ineligible",
      verdictEligible ? "verdict-eligible" : "verdict-ineligible",
    ),
  );
  if (!verdictEligible) chooseReason("verdict-ineligible");

  const inputIdentity = compareToken(
    "input-identity",
    input.eligibility.inputIdentity,
    input.target.inputIdentity,
    "identity-domain-mismatch",
    "identity-mismatch",
  );
  comparisons.push(inputIdentity.comparison);
  if (inputIdentity.reason !== undefined) chooseReason(inputIdentity.reason);

  const configIdentity = compareToken(
    "config-identity",
    input.eligibility.configIdentity,
    input.target.configIdentity,
    "identity-domain-mismatch",
    "identity-mismatch",
  );
  comparisons.push(configIdentity.comparison);
  if (configIdentity.reason !== undefined) chooseReason(configIdentity.reason);

  const duration = compareDuration(
    input.eligibility.executionDuration,
    input.target.timeout,
  );
  comparisons.push(duration.comparison);
  if (duration.reason !== undefined) chooseReason(duration.reason);

  if (
    verdictEligible
    && (input.policy.rerun === "all"
      || (input.policy.rerun === "failed" && input.verdict === "failed"))
  ) {
    chooseReason("rerun-requested");
  }
  if (input.policy.keepSandbox) chooseReason("sandbox-retention-requested");

  return Object.freeze({
    comparisons: Object.freeze(comparisons),
    ...(reason === undefined ? {} : { reason }),
  });
}

/**
 * Reads only the frozen current Record and produces a total, target-ordered
 * reuse/gap partition. It never opens storage, walks directories, or creates
 * an Effect runtime of its own.
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

    const port = resolveFrozenRecordReaderPort(input.view);
    if (port === undefined) return Effect.fail(invalidPlan("view-invalid"));

    return Effect.gen(function* () {
      yield* port.assertOpen(input.view);
      const discovery = yield* discoverSources(input.view, port, input.target);
      const slots: ExecutionReusePlanSlot[] = [];
      const origins = new Map<string, OriginLookup>();

      for (const target of flattenTargetSlots(input.target)) {
        const planned = yield* planTargetSlot({
          view: input.view,
          port,
          target,
          policy: input.policy,
          discovery,
          origins,
        });
        slots.push(planned);
      }

      const reuse: ReusePlanSlot[] = [];
      const gaps: ExecutionGapSlot[] = [];
      for (const slot of slots) {
        if (slot.state === "reuse") reuse.push(slot);
        else gaps.push(slot);
      }

      return Object.freeze({
        target: input.target,
        policy: projectTargetPolicyIdentityV1,
        effectiveOptions: effectiveOptions(input.policy),
        slots: Object.freeze(slots),
        reuse: Object.freeze(reuse),
        gaps: Object.freeze(gaps),
      });
    });
  });
}

/** A small named facade lets Runner wiring keep the policy capability explicit. */
export const ProjectTargetReusePlanner = Object.freeze({
  plan: planProjectTargetReuse,
});

function discoverSources(
  view: FrozenRecordView<RecordReaderReadError>,
  port: FrozenRecordReaderPort,
  target: ExecutionTarget,
): Effect.Effect<SourceDiscovery, RecordReaderReadError> {
  const targetKeys = sourceKeysForTarget(target);
  return targetKeys.size === 0
    ? Effect.succeed(Object.freeze({ latestByExperimentEval: new Map() }))
    : foldProjectTargetSourceCandidates({
        view,
        port,
        candidates: port.candidates(view),
        targetKeys,
      });
}

function sourceKeysForTarget(target: ExecutionTarget): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const run of target.runs) {
    for (const slot of run.slots) {
      keys.add(sourceKey(slot.experimentId, slot.evalId));
    }
  }
  return keys;
}

/**
 * @internal Stream-fold entry point. It intentionally retains only one latest
 * candidate per requested `(experimentId, evalId)` plus one fail-closed
 * unattributed problem; candidate cardinality never determines heap use.
 */
export function foldProjectTargetSourceCandidates(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly port: FrozenRecordReaderPort;
  readonly candidates: Stream.Stream<
    RecordCoreRead<FrozenRecordRun>,
    RecordReaderReadError
  >;
  readonly targetKeys: ReadonlySet<string>;
}): Effect.Effect<SourceDiscovery, RecordReaderReadError> {
  const initial: SourceDiscoveryAccumulator = {
    latestByExperimentEval: new Map(),
  };
  return Stream.runFoldEffect(
    input.candidates,
    initial,
    (state, candidate) => collectSourceCandidate(input, state, candidate),
  ).pipe(
    Effect.map((state) =>
      state.unattributedProblem === undefined
        ? Object.freeze({ latestByExperimentEval: state.latestByExperimentEval })
        : Object.freeze({
            latestByExperimentEval: state.latestByExperimentEval,
            unattributedProblem: state.unattributedProblem,
          }),
    ),
  );
}

function collectSourceCandidate(
  input: {
    readonly view: FrozenRecordView<RecordReaderReadError>;
    readonly port: FrozenRecordReaderPort;
    readonly targetKeys: ReadonlySet<string>;
  },
  state: SourceDiscoveryAccumulator,
  candidate: RecordCoreRead<FrozenRecordRun>,
): Effect.Effect<SourceDiscoveryAccumulator, RecordReaderReadError> {
  if (state.unattributedProblem !== undefined) return Effect.succeed(state);
  if (candidate.state === "core-invalid") {
    state.unattributedProblem = Object.freeze({
      reason: "source-core-invalid" as const,
      issues: candidate.issues,
    });
    return Effect.succeed(state);
  }
  if (candidate.state === "missing") {
    state.unattributedProblem = Object.freeze({
      reason: "source-core-invalid" as const,
      issues: Object.freeze([]),
    });
    return Effect.succeed(state);
  }

  return Effect.gen(function* () {
    const read = yield* input.port.readRunAttachment(
      input.view,
      candidate.value,
      evaluationsAttachmentFamilyV1,
    );
    const problem = projectTargetAttachmentProblem(read);
    if (problem !== undefined) {
      state.unattributedProblem = Object.freeze({
        reason: problem.reason,
        issues: problem.issues,
      });
      return state;
    }
    if (read.state !== "available") {
      throw new Error("available Evaluation Attachment was lost before projection");
    }

    const evaluations = projectEvaluationsAttachmentV1(read.value);
    for (const evaluation of evaluations.evaluations) {
      const key = sourceKey(evaluations.experimentId, evaluation.evalId);
      if (!input.targetKeys.has(key)) continue;
      const candidateForEval: SourceCandidate = Object.freeze({
        run: candidate.value,
        evaluation,
      });
      const prior = state.latestByExperimentEval.get(key);
      if (
        prior === undefined
        || compareSourceRuns(prior.run, candidateForEval.run) < 0
      ) {
        state.latestByExperimentEval.set(key, candidateForEval);
      }
    }
    return state;
  });
}

function planTargetSlot(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly port: FrozenRecordReaderPort;
  readonly target: TargetSlot;
  readonly policy: ProjectTargetPolicyV1;
  readonly discovery: SourceDiscovery;
  readonly origins: Map<string, OriginLookup>;
}): Effect.Effect<ExecutionReusePlanSlot, RecordReaderReadError> {
  return Effect.gen(function* () {
    const unattributed = input.discovery.unattributedProblem;
    if (unattributed !== undefined) {
      return gapSlot(input.target, {
        reason: unattributed.reason,
        scope: "target",
        issues: unattributed.issues,
        comparisons: [],
      });
    }

    const source = input.discovery.latestByExperimentEval.get(
      sourceKey(input.target.experimentId, input.target.evalId),
    );
    if (source === undefined) {
      return gapSlot(input.target, {
        reason: "no-source-run",
        scope: "slot",
        issues: [],
        comparisons: [],
      });
    }

    const barrier = sourceBarrier(source.run);
    const sourceSlot = source.evaluation.slots.find(
      (slot) => slot.attempt === input.target.attempt,
    );
    if (
      sourceSlot === undefined
      || !source.run.expectedSlots.includes(sourceSlot.slotId)
    ) {
      return gapSlot(input.target, {
        reason: "source-slot-missing",
        scope: "slot",
        issues: [],
        sourceBarrier: barrier,
        comparisons: [],
      });
    }

    const member = yield* input.port.member(input.view, source.run, sourceSlot.slotId);
    if (member.state === "core-invalid") {
      return gapSlot(input.target, {
        reason: "source-core-invalid",
        scope: "slot",
        issues: member.issues,
        sourceBarrier: barrier,
        comparisons: [],
      });
    }
    if (member.state === "missing") {
      return gapSlot(input.target, {
        reason: "source-member-missing",
        scope: "slot",
        issues: [],
        sourceBarrier: barrier,
        comparisons: [],
      });
    }

    const attempt = yield* input.port.attempt(input.view, member.value.attempt);
    if (attempt.state === "core-invalid") {
      return gapSlot(input.target, {
        reason: "source-core-invalid",
        scope: "slot",
        issues: attempt.issues,
        sourceBarrier: barrier,
        comparisons: [],
      });
    }
    if (
      attempt.state === "missing"
      || attempt.value.attemptId !== member.value.attempt.attemptId
      || attempt.value.originRunId !== member.value.attempt.originRunId
    ) {
      return gapSlot(input.target, {
        reason: "source-core-invalid",
        scope: "slot",
        issues: [],
        sourceBarrier: barrier,
        comparisons: [],
      });
    }

    const origin = yield* resolveAttemptOrigin({
      view: input.view,
      port: input.port,
      attempt: attempt.value,
      cache: input.origins,
    });
    if (origin.state === "invalid") {
      return gapSlot(input.target, {
        reason: "source-core-invalid",
        scope: "slot",
        issues: origin.issues,
        sourceBarrier: barrier,
        comparisons: [],
      });
    }

    const eligibilityRead = yield* input.port.readAttemptAttachment(
      input.view,
      attempt.value,
      // The family is captured in the helper's module; importing its value here
      // would be equivalent, but this explicit read preserves one Record I/O path.
      eligibilityAttachmentFamilyV1,
    );
    const verdictRead = yield* input.port.readAttemptAttachment(
      input.view,
      attempt.value,
      verdictAttachmentFamilyV1,
    );
    const eligibilityProblem = projectTargetAttachmentProblem(eligibilityRead);
    const verdictProblem = projectTargetAttachmentProblem(verdictRead);
    if (eligibilityProblem !== undefined || verdictProblem !== undefined) {
      const problems = [eligibilityProblem, verdictProblem].filter(
        (problem): problem is ProjectTargetAttachmentProblem => problem !== undefined,
      );
      const comparisons = Object.freeze([
        ...(eligibilityProblem === undefined
          ? []
          : [
              unavailableComparison(
                "niceeval.eligibility/v1",
                "reuse-contract",
                eligibilityProblem,
              ),
            ]),
        ...(verdictProblem === undefined
          ? []
          : [
              unavailableComparison(
                "niceeval.verdict/v1",
                "verdict-state",
                verdictProblem,
              ),
            ]),
      ]);
      return gapSlot(input.target, {
        reason: problems[0]!.reason,
        scope: "slot",
        issues: Object.freeze(problems.flatMap((problem) => problem.issues)),
        sourceBarrier: barrier,
        comparisons,
      });
    }

    if (eligibilityRead.state !== "available" || verdictRead.state !== "available") {
      throw new Error("available reuse Attachment was lost before projection");
    }
    const eligibility = projectEligibilityAttachmentV1(eligibilityRead.value);
    const verdict = projectVerdictAttachmentV1(verdictRead.value);
    const comparison = compareProjectTargetAttemptEligibility({
      eligibility,
      verdict,
      target: input.target,
      policy: input.policy,
    });
    if (comparison.reason !== undefined) {
      return gapSlot(input.target, {
        reason: comparison.reason,
        scope: "slot",
        issues: [],
        sourceBarrier: barrier,
        comparisons: comparison.comparisons,
      });
    }

    return Object.freeze({
      ...input.target,
      state: "reuse" as const,
      adoption: "carried" as const,
      sourceEvaluationKind: source.evaluation.evaluationKind,
      attemptId: attempt.value.attemptId,
      sourceAttempt: attempt.value,
      origin: origin.origin,
      sourceBarrier: barrier,
      comparisons: comparison.comparisons,
    });
  });
}

function resolveAttemptOrigin(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly port: FrozenRecordReaderPort;
  readonly attempt: FrozenRecordAttempt;
  readonly cache: Map<string, OriginLookup>;
}): Effect.Effect<OriginLookup, RecordReaderReadError> {
  return Effect.suspend(() => {
    const key = recordAttemptReferenceKey({
      originRunId: input.attempt.originRunId,
      attemptId: input.attempt.attemptId,
    });
    const cached = input.cache.get(key);
    if (cached !== undefined) return Effect.succeed(cached);

    return Effect.gen(function* () {
      const run = yield* input.port.run(input.view, input.attempt.originRunId);
      if (run.state === "core-invalid") {
        const result: OriginLookup = Object.freeze({
          state: "invalid" as const,
          issues: run.issues,
        });
        input.cache.set(key, result);
        return result;
      }
      if (run.state === "missing") {
        const result: OriginLookup = Object.freeze({
          state: "invalid" as const,
          issues: Object.freeze([]),
        });
        input.cache.set(key, result);
        return result;
      }

      for (const slotId of run.value.expectedSlots) {
        const member = yield* input.port.member(input.view, run.value, slotId);
        if (member.state === "core-invalid") {
          const result: OriginLookup = Object.freeze({
            state: "invalid" as const,
            issues: member.issues,
          });
          input.cache.set(key, result);
          return result;
        }
        if (
          member.state === "available"
          && member.value.attempt.originRunId === input.attempt.originRunId
          && member.value.attempt.attemptId === input.attempt.attemptId
        ) {
          const result: OriginLookup = Object.freeze({
            state: "available" as const,
            origin: Object.freeze({ runId: run.value.runId, slotId }),
          });
          input.cache.set(key, result);
          return result;
        }
      }

      const result: OriginLookup = Object.freeze({
        state: "invalid" as const,
        issues: Object.freeze([]),
      });
      input.cache.set(key, result);
      return result;
    });
  });
}

/** Converts every non-available RecordAttachment read state into a stable gap. */
export function projectTargetAttachmentProblem<Payload>(
  read: RecordAttachmentRead<Payload>,
): ProjectTargetAttachmentProblem | undefined {
  switch (read.state) {
    case "available":
      return undefined;
    case "unavailable":
      return Object.freeze({
        reason: projectTargetAttachmentGapReason("unavailable"),
        state: "unavailable" as const,
        issues: Object.freeze([]),
      });
    case "migration-required":
      return Object.freeze({
        reason: projectTargetAttachmentGapReason("migration-required"),
        state: "migration-required" as const,
        issues: Object.freeze([]),
      });
    case "migration-unavailable":
      return Object.freeze({
        reason: projectTargetAttachmentGapReason("migration-unavailable"),
        state: "migration-unavailable" as const,
        issues: Object.freeze([]),
      });
    case "unsupported":
      return Object.freeze({
        reason: projectTargetAttachmentGapReason("unsupported"),
        state: "unsupported" as const,
        issues: Object.freeze([]),
      });
    case "invalid":
      return Object.freeze({
        reason: projectTargetAttachmentGapReason("invalid"),
        state: "invalid" as const,
        issues: read.issues,
      });
  }
}

/** Stable read-state mapping used by both source and required-Attempt facts. */
export function projectTargetAttachmentGapReason(
  state: Exclude<ComparisonSourceStateV1, "available">,
): ProjectTargetAttachmentGapReason {
  switch (state) {
    case "unavailable":
      return "source-attachment-unavailable";
    case "migration-required":
      return "source-attachment-migration-required";
    case "migration-unavailable":
      return "source-attachment-migration-unavailable";
    case "unsupported":
      return "source-attachment-unsupported";
    case "invalid":
      return "source-attachment-invalid";
  }
}

function unavailableComparison(
  attachment: ComparisonAttachmentV1,
  recordedClaim: ComparisonProvenanceV1["recordedClaim"],
  problem: ProjectTargetAttachmentProblem,
): ComparisonProvenanceV1 {
  return comparison(
    attachment,
    recordedClaim,
    problem.state,
    "not-comparable",
    problem.reason,
  );
}

function compareToken(
  recordedClaim: "reuse-contract" | "input-identity" | "config-identity",
  source: EqualityTokenV1,
  target: EqualityTokenV1,
  domainReason: "reuse-contract-domain-mismatch" | "identity-domain-mismatch",
  mismatchReason: "reuse-contract-mismatch" | "identity-mismatch",
): {
  readonly comparison: ComparisonProvenanceV1;
  readonly reason?: typeof domainReason | typeof mismatchReason;
} {
  if (source.domain !== target.domain) {
    return Object.freeze({
      comparison: comparison(
        "niceeval.eligibility/v1",
        recordedClaim,
        "available",
        "mismatch",
        domainReason,
      ),
      reason: domainReason,
    });
  }
  if (source.value !== target.value) {
    return Object.freeze({
      comparison: comparison(
        "niceeval.eligibility/v1",
        recordedClaim,
        "available",
        "mismatch",
        mismatchReason,
      ),
      reason: mismatchReason,
    });
  }
  return Object.freeze({
    comparison: comparison(
      "niceeval.eligibility/v1",
      recordedClaim,
      "available",
      "match",
      `${recordedClaim}-match`,
    ),
  });
}

function compareDuration(
  source: DurationLimitV1,
  timeout: DurationLimitV1 | undefined,
): {
  readonly comparison: ComparisonProvenanceV1;
  readonly reason?: "duration-domain-mismatch" | "timeout-exceeded";
} {
  if (timeout === undefined) {
    return Object.freeze({
      comparison: comparison(
        "niceeval.eligibility/v1",
        "execution-duration",
        "available",
        "match",
        "timeout-unbounded",
      ),
    });
  }
  if (source.domain !== timeout.domain) {
    return Object.freeze({
      comparison: comparison(
        "niceeval.eligibility/v1",
        "execution-duration",
        "available",
        "mismatch",
        "duration-domain-mismatch",
      ),
      reason: "duration-domain-mismatch" as const,
    });
  }
  if (source.milliseconds > timeout.milliseconds) {
    return Object.freeze({
      comparison: comparison(
        "niceeval.eligibility/v1",
        "execution-duration",
        "available",
        "mismatch",
        "timeout-exceeded",
      ),
      reason: "timeout-exceeded" as const,
    });
  }
  return Object.freeze({
    comparison: comparison(
      "niceeval.eligibility/v1",
      "execution-duration",
      "available",
      "match",
      "duration-within-timeout",
    ),
  });
}

function comparison(
  attachment: ComparisonAttachmentV1,
  recordedClaim: ComparisonProvenanceV1["recordedClaim"],
  sourceState: ComparisonSourceStateV1,
  result: ComparisonProvenanceV1["result"],
  reason: string,
): ComparisonProvenanceV1 {
  return Object.freeze({ attachment, recordedClaim, sourceState, result, reason });
}

function gapSlot(
  target: TargetSlot,
  input: {
    readonly reason: ExecutionGapReasonV1;
    readonly scope: ExecutionGapScopeV1;
    readonly issues: readonly RecordIssue[];
    readonly comparisons: readonly ComparisonProvenanceV1[];
    readonly sourceBarrier?: MembershipSourceBarrierV1;
  },
): ExecutionGapSlot {
  return input.sourceBarrier === undefined
    ? Object.freeze({
        ...target,
        state: "gap" as const,
        reason: input.reason,
        scope: input.scope,
        issues: Object.freeze([...input.issues]),
        comparisons: Object.freeze([...input.comparisons]),
      })
    : Object.freeze({
        ...target,
        state: "gap" as const,
        reason: input.reason,
        scope: input.scope,
        issues: Object.freeze([...input.issues]),
        sourceBarrier: input.sourceBarrier,
        comparisons: Object.freeze([...input.comparisons]),
      });
}

function effectiveOptions(
  policy: ProjectTargetPolicyV1,
): MembershipEffectiveOptionsV1 {
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
  const slots: TargetSlot[] = [];
  for (const run of target.runs) slots.push(...run.slots);
  return Object.freeze(slots);
}

function sourceBarrier(run: FrozenRecordRun): MembershipSourceBarrierV1 {
  return Object.freeze({ runId: run.runId, startedAt: run.startedAt });
}

function compareSourceRuns(left: FrozenRecordRun, right: FrozenRecordRun): number {
  if (left.startedAt !== right.startedAt) {
    return left.startedAt < right.startedAt ? -1 : 1;
  }
  return compareCanonicalIdentity(left.runId, right.runId);
}

function sourceKey(
  experimentId: string,
  evalId: string,
  ordinal?: string,
): string {
  return ordinal === undefined
    ? `${experimentId}\u0000${evalId}`
    : `${experimentId}\u0000${evalId}\u0000${ordinal}`;
}

function invalidPlan(
  reason: ProjectTargetReusePlanInvalidReason,
): ProjectTargetReusePlanInvalid {
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
    && isEqualityTokenV1(slot.inputIdentity)
    && isEqualityTokenV1(slot.configIdentity)
    && (slot.timeout === undefined || isDurationLimitV1(slot.timeout))
  );
}

function isBoundedNonEmptyText(value: string, maximumLength: number): boolean {
  return value.length > 0 && value.length <= maximumLength;
}

function isBoundedRecordIdentity(value: string): boolean {
  return (
    isBoundedNonEmptyText(
      value,
      PROJECT_TARGET_RECORD_IDENTITY_MAXIMUM_LENGTH_V1,
    ) && !value.includes("\u0000")
  );
}

function isUtcMillis(value: unknown): value is UtcMillis {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRerunOption(value: unknown): value is ProjectTargetPolicyV1["rerun"] {
  return value === "none" || value === "failed" || value === "all";
}

/** Documentation-level alias keeps the versioned policy type aligned with cache.md. */
export type ProjectTargetPolicy = ProjectTargetPolicyV1;
