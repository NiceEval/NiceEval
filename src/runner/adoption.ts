import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Effect, Either, Schema, Stream } from "effect";

import {
  type EvaluationsPayloadV1,
  buildEvaluationsPayloadV1,
  evaluationsAttachmentFamilyV1,
  projectEvaluationsAttachmentV1,
} from "../eval/record/evaluation.ts";
import {
  EvaluationRecordContractV1,
  type EvaluationRecordOriginDraftMissingV1,
  type EvaluationRecordPlanInvalidV1,
  type EvaluationRecordPlanV1,
} from "../eval/record/evaluation-record.ts";
import {
  eligibilityAttachmentFamilyV1,
  projectEligibilityAttachmentV1,
  EXECUTION_DURATION_DOMAIN_V1,
  type AttemptEligibilityPayloadV1,
  type DurationLimitV1,
  type EqualityTokenV1,
} from "../eval/record/eligibility.ts";
import {
  buildMembershipProvenanceAttachmentWriteV1,
  type ComparisonProvenanceV1,
  type MembershipActionV1,
  type MembershipEffectiveOptionsV1,
  type MembershipProvenancePayloadV1,
} from "../eval/record/membership-provenance.ts";
import {
  projectVerdictAttachmentV1,
  verdictAttachmentFamilyV1,
  type VerdictStateV1,
} from "../eval/record/verdict.ts";
import { loadConfigFile } from "../load-config.ts";
import {
  AttemptIdSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "../record/codec/identifiers.ts";
import type { RecordAttemptRef } from "../record/model/core.ts";
import type { AttemptId, RunId, SlotId, UtcMillis } from "../record/model/identifiers.ts";
import type { RecordAttachmentRead } from "../record/model/read-state.ts";
import {
  makeRecordRoot,
  type RecordRoot,
  type RecordRootConstructionError,
} from "../record/platform/root.ts";
import { resolveFrozenRecordReaderPort } from "../record/reader/internal.ts";
import type { RecordReaderOpenError, RecordReaderReadError } from "../record/reader/errors.ts";
import { openRecordReader } from "../record/reader/runtime.ts";
import type {
  FrozenRecordAttempt,
  FrozenRecordRun,
  FrozenRecordView,
} from "../record/reader/types.ts";
import { openRecordWriteSession } from "../record/writer/runtime.ts";
import type {
  OpenRecordWriteSessionError,
  RecordPublishReceipt,
  RecordWriteError,
  RecordWriteSession,
} from "../record/writer/types.ts";
import { digestOf } from "../sandbox/identity.ts";
import type { SandboxPlanningServices } from "../sandbox/plan.ts";
import { configIdentityForRun } from "./config-identity.ts";
import {
  discoverEvals,
  discoverExperiments,
} from "./discover.ts";
import { resolveExperimentEvals } from "./eval-selection.ts";
import {
  createFingerprintSourceCache,
  fingerprintWithManifest,
  hashConfigIdentity,
} from "./fingerprint.ts";
import { resolveJudge } from "./judge-config.ts";
import { prepareRunSandboxes, type PreparedRunPair } from "./sandbox-selection.ts";
import { resolveAttemptTimeout, resolveRunTimeout } from "./timeout.ts";
import type {
  AgentRun,
  Config,
  DiscoveredEval,
  DiscoveredExperiment,
} from "./types.ts";

/** The sole manual-adoption policy identity persisted by the v1 migration. */
export const EXPLICIT_ADOPTION_POLICY_NAME_V1 = "explicit-adoption" as const;
export const EXPLICIT_ADOPTION_POLICY_VERSION_V1 = 1 as const;

/** Shared domains emitted by the current ProjectTarget producer. */
export const ADOPTION_INPUT_IDENTITY_DOMAIN_V1 =
  "niceeval.input/fingerprint-v1" as const;
export const ADOPTION_CONFIG_IDENTITY_DOMAIN_V1 =
  "niceeval.config/identity-v1" as const;
const ADOPTION_TARGET_SLOT_SEPARATOR = "\u0000";

export type ExplicitAdoptionIntentV1 = "accept" | "rename";

export type ExplicitAdoptionFailureCodeV1 =
  | "adoption-locator-malformed"
  | "adoption-locator-not-found"
  | "adoption-locator-ambiguous"
  | "adoption-batch-locator-duplicate"
  | "adoption-source-core-invalid"
  | "adoption-source-evaluations-unavailable"
  | "adoption-source-verdict-unavailable"
  | "adoption-source-eligibility-unavailable"
  | "adoption-source-verdict-ineligible"
  | "adoption-target-experiment-not-found"
  | "adoption-target-eval-not-selected"
  | "adoption-target-attempt-not-selected"
  | "adoption-target-planning-failed"
  | "adoption-target-invalid"
  | "adoption-target-slot-duplicate"
  | "adoption-target-member-duplicate"
  | "adoption-duration-domain-mismatch"
  | "adoption-timeout-exceeded"
  | "adoption-source-run-required"
  | "adoption-source-run-not-found"
  | "adoption-source-run-mismatch"
  | "adoption-provenance-invalid"
  | "adoption-evaluation-plan-invalid";

/** Expected product failures retain a stable code without collapsing Effect causes. */
export class ExplicitAdoptionErrorV1 extends Error {
  readonly name = "ExplicitAdoptionErrorV1";

  constructor(
    readonly code: ExplicitAdoptionFailureCodeV1,
    message: string,
  ) {
    super(message);
  }
}

export type ExplicitAdoptionReadErrorV1 =
  | ExplicitAdoptionErrorV1
  | RecordReaderReadError;

export type ExplicitAdoptionOpenErrorV1 =
  | ExplicitAdoptionErrorV1
  | RecordRootConstructionError
  | RecordReaderOpenError
  | RecordReaderReadError
  | OpenRecordWriteSessionError;

export interface AdoptionProjectInputV1 {
  readonly cwd: string;
  readonly config?: Config;
  readonly evals?: readonly DiscoveredEval[];
  readonly experiments?: readonly DiscoveredExperiment[];
  readonly planningServices?: SandboxPlanningServices;
}

export interface AdoptionProjectV1 {
  readonly cwd: string;
  readonly config: Config;
  readonly evals: readonly DiscoveredEval[];
  readonly experiments: readonly DiscoveredExperiment[];
  readonly planningServices?: SandboxPlanningServices;
}

export interface ExplicitAttemptLocatorV1 {
  readonly text: string;
  readonly attemptId: AttemptId;
}

export interface ResolvedAdoptionAttemptV1 {
  readonly locator: ExplicitAttemptLocatorV1;
  readonly attempt: FrozenRecordAttempt;
  readonly origin: {
    readonly run: FrozenRecordRun;
    readonly slotId: SlotId;
  };
  readonly originExperimentId: string;
  readonly originEvalId: string;
  readonly originAttempt: number;
}

export interface CurrentAdoptionSlotV1 {
  readonly slotId: SlotId;
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly inputIdentity: EqualityTokenV1;
  readonly configIdentity: EqualityTokenV1;
  readonly timeout?: DurationLimitV1;
}

export interface CurrentAdoptionTargetV1 {
  readonly experimentId: string;
  readonly startedAt: UtcMillis;
  readonly expectedSlots: readonly SlotId[];
  readonly evaluations: EvaluationsPayloadV1;
  readonly slots: readonly CurrentAdoptionSlotV1[];
  readonly slotFor: (evalId: string, attempt: number) => CurrentAdoptionSlotV1 | undefined;
}

export interface ExplicitAdoptionMemberV1 {
  readonly target: CurrentAdoptionSlotV1;
  readonly source: ResolvedAdoptionAttemptV1;
  readonly locator: string;
  readonly verdict: "passed" | "failed";
  readonly comparisons: readonly ComparisonProvenanceV1[];
  readonly operatorReason?: string;
}

export interface ExplicitAdoptionRunPlanV1 {
  readonly intent: ExplicitAdoptionIntentV1;
  readonly target: CurrentAdoptionTargetV1;
  readonly members: readonly ExplicitAdoptionMemberV1[];
  readonly evaluationPlan: EvaluationRecordPlanV1<never, never>;
}

export interface ExplicitAdoptionMemberReceiptV1 {
  readonly slotId: SlotId;
  readonly locator: string;
  readonly sourceRunId: RunId;
  readonly attemptId: AttemptId;
}

export interface ExplicitAdoptionRunReceiptV1 {
  readonly runId: RunId;
  readonly members: readonly ExplicitAdoptionMemberReceiptV1[];
}

/** Real write/publish failures after all domain preflight has already passed. */
export type ExplicitAdoptionCommitErrorV1 =
  | EvaluationRecordPlanInvalidV1
  | EvaluationRecordOriginDraftMissingV1
  | RecordWriteError;

/**
 * A plan-token failure is still a domain preflight failure when observed on
 * the session's second frozen view. Real writer/publish failures remain their
 * exact RecordWriteError so callers can report an already-published prefix.
 */
export function mapExplicitAdoptionCommitFailureV1(
  error: ExplicitAdoptionCommitErrorV1,
): ExplicitAdoptionErrorV1 | RecordWriteError {
  if (
    error.code === "evaluation-record-plan-invalid"
    || error.code === "evaluation-record-origin-draft-missing"
  ) {
    return adoptionError(
      "adoption-evaluation-plan-invalid",
      "Explicit adoption's already-preflighted Evaluation Record plan became invalid before publication.",
    );
  }
  return error;
}

function adoptionError(
  code: ExplicitAdoptionFailureCodeV1,
  message: string,
): ExplicitAdoptionErrorV1 {
  return new ExplicitAdoptionErrorV1(code, message);
}

function safeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function decodeBrandedId<Id>(
  schema: Schema.Schema<Id, string>,
  value: string,
  code: ExplicitAdoptionFailureCodeV1,
  label: string,
): Effect.Effect<Id, ExplicitAdoptionErrorV1> {
  const decoded = Schema.decodeUnknownEither(schema)(value);
  return Either.isLeft(decoded)
    ? Effect.fail(adoptionError(code, `${label} is not a current Record identity.`))
    : Effect.succeed(decoded.right);
}

function utcMillis(value: number): Effect.Effect<UtcMillis, ExplicitAdoptionErrorV1> {
  const decoded = Schema.decodeUnknownEither(UtcMillisSchema)(value);
  return Either.isLeft(decoded)
    ? Effect.fail(adoptionError("adoption-target-invalid", "Adoption timestamp is invalid."))
    : Effect.succeed(decoded.right);
}

function slotKey(evalId: string, attempt: number): string {
  return `${evalId}${ADOPTION_TARGET_SLOT_SEPARATOR}${String(attempt)}`;
}

function sameAttemptReference(
  left: RecordAttemptRef,
  right: FrozenRecordAttempt,
): boolean {
  return left.originRunId === right.originRunId && left.attemptId === right.attemptId;
}

function attemptLocatorFor(
  attemptId: AttemptId,
): Effect.Effect<ExplicitAttemptLocatorV1, ExplicitAdoptionErrorV1> {
  return Effect.succeed(Object.freeze({ text: `@${attemptId}`, attemptId }));
}

/** Exact v1 locator parsing deliberately does not accept the retired hash locator. */
export function parseExplicitAttemptLocatorV1(
  value: string,
): Effect.Effect<ExplicitAttemptLocatorV1, ExplicitAdoptionErrorV1> {
  if (!value.startsWith("@") || value.length === 1 || value.startsWith("@@")) {
    return Effect.fail(
      adoptionError(
        "adoption-locator-malformed",
        "An explicit adoption locator must be exactly one @ followed by one complete current Record AttemptId.",
      ),
    );
  }
  return decodeBrandedId(
    AttemptIdSchema,
    value.slice(1),
    "adoption-locator-malformed",
    "Attempt locator",
  ).pipe(
    Effect.map((attemptId) => Object.freeze({ text: value, attemptId })),
  );
}

/** The public application boundary owns Record-root construction. */
export function adoptionRecordRootV1(input: {
  readonly cwd: string;
  readonly recordRoot?: string;
}): Effect.Effect<RecordRoot, RecordRootConstructionError> {
  const root = makeRecordRoot(resolve(input.cwd, input.recordRoot ?? ".niceeval/record"));
  return Either.isLeft(root) ? Effect.fail(root.left) : Effect.succeed(root.right);
}

/** Discovery is rerun for both read preflight and the write-session frozen view. */
export function loadAdoptionProjectV1(
  input: AdoptionProjectInputV1,
): Effect.Effect<AdoptionProjectV1, ExplicitAdoptionErrorV1> {
  return Effect.gen(function* () {
    const cwd = resolve(input.cwd);
    const config = input.config ?? (yield* Effect.tryPromise({
      try: () => loadConfigFile(cwd),
      catch: (cause) => adoptionError(
        "adoption-target-invalid",
        `Current configuration could not be loaded: ${safeMessage(cause)}`,
      ),
    }));
    const evals = input.evals ?? (yield* discoverEvals(cwd).pipe(
      Effect.mapError((error) => adoptionError(
        "adoption-target-invalid",
        `Current Eval discovery failed: ${error.message}`,
      )),
    ));
    const experiments = input.experiments ?? (yield* discoverExperiments(cwd).pipe(
      Effect.mapError((error) => adoptionError(
        "adoption-target-invalid",
        `Current Experiment discovery failed: ${error.message}`,
      )),
    ));
    return Object.freeze({
      cwd,
      config,
      evals: Object.freeze([...evals]),
      experiments: Object.freeze([...experiments]),
      ...(input.planningServices === undefined
        ? {}
        : { planningServices: input.planningServices }),
    });
  });
}

function runForExperiment(
  experiment: DiscoveredExperiment,
  selectedEvalIds: readonly string[],
): AgentRun {
  return Object.freeze({
    agent: experiment.agent,
    ...(experiment.model === undefined ? {} : { model: experiment.model }),
    ...(experiment.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: experiment.reasoningEffort }),
    flags: experiment.flags,
    attempts: experiment.attempts,
    earlyExit: experiment.earlyExit,
    ...(experiment.sandbox === undefined ? {} : { sandbox: experiment.sandbox }),
    sandboxReuse: experiment.sandboxReuse,
    ...(experiment.judge === undefined ? {} : { judge: experiment.judge }),
    ...resolveRunTimeout(undefined, experiment.timeoutMs),
    ...(experiment.budget === undefined ? {} : { budget: experiment.budget }),
    experimentId: experiment.id,
    experimentBaseDir: experiment.baseDir,
    experimentSourcePath: experiment.sourcePath,
    ...(experiment.description === undefined
      ? {}
      : { description: experiment.description }),
    ...(Object.keys(experiment.labels).length === 0
      ? {}
      : { labels: experiment.labels }),
    selectedEvalIds: Object.freeze([...selectedEvalIds]),
    ...(experiment.maxConcurrency === undefined
      ? {}
      : { maxConcurrency: experiment.maxConcurrency }),
    ...(experiment.setup === undefined ? {} : { setup: experiment.setup }),
    ...(experiment.teardown === undefined ? {} : { teardown: experiment.teardown }),
    ...(experiment.classifyFailure === undefined
      ? {}
      : { classifyFailure: experiment.classifyFailure }),
  });
}

function sortedSlots(slots: readonly SlotId[]): readonly SlotId[] {
  return Object.freeze([...slots].sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
}

function asNonEmptySlots(
  slots: readonly { readonly slotId: SlotId; readonly attempt: number }[],
): readonly [
  { readonly slotId: SlotId; readonly attempt: number },
  ...{ readonly slotId: SlotId; readonly attempt: number }[],
] | undefined {
  const [first, ...rest] = slots;
  return first === undefined ? undefined : Object.freeze([first, ...rest]);
}

function currentTargetSlotId(input: {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
}): Effect.Effect<SlotId, ExplicitAdoptionErrorV1> {
  return decodeBrandedId(
    SlotIdSchema,
    `slot-${digestOf(input)}`,
    "adoption-target-invalid",
    "Adoption target Slot",
  );
}

interface CurrentTargetPairV1 {
  readonly pair: PreparedRunPair;
  readonly inputIdentity: EqualityTokenV1;
  readonly configIdentity: EqualityTokenV1;
  readonly timeout?: DurationLimitV1;
}

/**
 * Rebuilds current discovery, physical planning, config identity and timeout
 * before any adoption decision. It intentionally plans every selected Eval so
 * a produced Run has the complete current denominator rather than only the
 * manually adopted Members.
 */
export function prepareCurrentAdoptionTargetV1(input: {
  readonly project: AdoptionProjectV1;
  readonly experimentId: string;
  readonly startedAt: UtcMillis;
}): Effect.Effect<CurrentAdoptionTargetV1, ExplicitAdoptionErrorV1> {
  return Effect.gen(function* () {
    const experiment = input.project.experiments.find(
      (candidate) => candidate.id === input.experimentId,
    );
    if (experiment === undefined) {
      return yield* Effect.fail(adoptionError(
        "adoption-target-experiment-not-found",
        `Current discovery does not contain Experiment "${input.experimentId}".`,
      ));
    }
    const selection = yield* Effect.try({
      try: () => resolveExperimentEvals({
        experimentId: experiment.id,
        selector: experiment.evals,
        cliPatterns: [],
        evals: input.project.evals,
      }),
      catch: (cause) => adoptionError(
        "adoption-target-invalid",
        `Current Eval selection for "${experiment.id}" failed: ${safeMessage(cause)}`,
      ),
    });
    if (selection.selectedEvals.length === 0 || experiment.attempts < 1) {
      return yield* Effect.fail(adoptionError(
        "adoption-target-invalid",
        `Current Experiment "${experiment.id}" has no selectable target Slots.`,
      ));
    }

    const run = runForExperiment(experiment, selection.selectedEvalIds);
    const pairs = yield* prepareRunSandboxes(
      selection.selectedEvals,
      [run],
      input.project.planningServices,
      { configTimeoutMs: input.project.config.timeoutMs },
    ).pipe(
      Effect.mapError((error) => adoptionError(
        "adoption-target-planning-failed",
        `Current planning for "${experiment.id}" failed: ${safeMessage(error)}`,
      )),
    );
    if (pairs.length !== selection.selectedEvals.length) {
      return yield* Effect.fail(adoptionError(
        "adoption-target-planning-failed",
        `Current planning for "${experiment.id}" did not return every selected Eval.`,
      ));
    }

    const sourceCache = createFingerprintSourceCache();
    const plannedPairs = yield* Effect.forEach(
      pairs,
      (pair): Effect.Effect<CurrentTargetPairV1, ExplicitAdoptionErrorV1> =>
        Effect.gen(function* () {
          const identity = yield* Effect.try({
            try: () => configIdentityForRun(
              run,
              pair.plan,
              resolveJudge(run.judge, pair.evalDef.judge, input.project.config.judge),
            ),
            catch: (cause) => adoptionError(
              "adoption-target-invalid",
              `Current configuration identity for "${pair.evalDef.id}" failed: ${safeMessage(cause)}`,
            ),
          });
          const fingerprint = yield* fingerprintWithManifest(pair, sourceCache, {
              _tag: "Current",
              identity,
            }).pipe(Effect.mapError((cause) => adoptionError(
              "adoption-target-invalid",
              `Current input identity for "${pair.evalDef.id}" failed: ${safeMessage(cause)}`,
            )));
          const timeout = resolveAttemptTimeout(
            run,
            pair.evalDef,
            input.project.config,
          );
          if (timeout !== undefined && !Number.isFinite(timeout.timeoutMs)) {
            return yield* Effect.fail(adoptionError(
              "adoption-target-invalid",
              `Current timeout for "${pair.evalDef.id}" is invalid.`,
            ));
          }
          return Object.freeze({
            pair,
            inputIdentity: Object.freeze({
              domain: ADOPTION_INPUT_IDENTITY_DOMAIN_V1,
              value: fingerprint.fingerprint,
            }),
            configIdentity: Object.freeze({
              domain: ADOPTION_CONFIG_IDENTITY_DOMAIN_V1,
              value: hashConfigIdentity(identity),
            }),
            ...(timeout === undefined
              ? {}
              : {
                  timeout: Object.freeze({
                    domain: EXECUTION_DURATION_DOMAIN_V1,
                    milliseconds: timeout.timeoutMs,
                  }),
                }),
          });
        }),
      { concurrency: 4 },
    );

    const pairByEval = new Map<string, CurrentTargetPairV1>();
    for (const planned of plannedPairs) {
      if (pairByEval.has(planned.pair.evalDef.id)) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-slot-duplicate",
          `Current planning produced duplicate Eval "${planned.pair.evalDef.id}".`,
        ));
      }
      pairByEval.set(planned.pair.evalDef.id, planned);
    }

    const slots: CurrentAdoptionSlotV1[] = [];
    const slotsByEval = new Map<string, readonly { readonly slotId: SlotId; readonly attempt: number }[]>();
    const seenSlots = new Set<string>();
    for (const evalDef of selection.selectedEvals) {
      const planned = pairByEval.get(evalDef.id);
      if (planned === undefined) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-planning-failed",
          `Current planning omitted selected Eval "${evalDef.id}".`,
        ));
      }
      const evaluationSlots: Array<{ readonly slotId: SlotId; readonly attempt: number }> = [];
      for (let attempt = 0; attempt < run.attempts; attempt += 1) {
        const slotId = yield* currentTargetSlotId({
          experimentId: experiment.id,
          evalId: evalDef.id,
          attempt,
        });
        if (seenSlots.has(slotId)) {
          return yield* Effect.fail(adoptionError(
            "adoption-target-slot-duplicate",
            `Current target produced duplicate Slot "${slotId}".`,
          ));
        }
        seenSlots.add(slotId);
        const targetSlot = Object.freeze({
          slotId,
          experimentId: experiment.id,
          evalId: evalDef.id,
          attempt,
          inputIdentity: planned.inputIdentity,
          configIdentity: planned.configIdentity,
          ...(planned.timeout === undefined ? {} : { timeout: planned.timeout }),
        });
        slots.push(targetSlot);
        evaluationSlots.push(Object.freeze({ slotId, attempt }));
      }
      slotsByEval.set(evalDef.id, Object.freeze(evaluationSlots));
    }

    const evaluationDefinitions: Array<EvaluationsPayloadV1["evaluations"][number]> = [];
    for (const evalDef of selection.selectedEvals) {
      const evaluationSlots = slotsByEval.get(evalDef.id);
      const nonEmpty = evaluationSlots === undefined
        ? undefined
        : asNonEmptySlots(evaluationSlots);
      if (nonEmpty === undefined) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-invalid",
          `Current target lost all Slots for ${evalDef.id}.`,
        ));
      }
      evaluationDefinitions.push(Object.freeze({
        evalId: evalDef.id,
        evaluationKind: evalDef.evaluationKind,
        slots: nonEmpty,
      }));
    }
    const evaluationsInput: EvaluationsPayloadV1 = {
      experimentId: experiment.id,
      evaluations: evaluationDefinitions,
    };
    const evaluations = buildEvaluationsPayloadV1(evaluationsInput);
    if (Either.isLeft(evaluations)) {
      return yield* Effect.fail(adoptionError(
        "adoption-target-invalid",
        "Current target Evaluation attachment is invalid.",
      ));
    }
    const byKey = new Map<string, CurrentAdoptionSlotV1>();
    for (const slot of slots) byKey.set(slotKey(slot.evalId, slot.attempt), slot);
    return Object.freeze({
      experimentId: experiment.id,
      startedAt: input.startedAt,
      expectedSlots: sortedSlots(slots.map((slot) => slot.slotId)),
      evaluations: evaluations.right,
      slots: Object.freeze([...slots]),
      slotFor: (evalId: string, attempt: number) => byKey.get(slotKey(evalId, attempt)),
    });
  });
}

function attachmentUnavailable(
  subject: "evaluations" | "verdict" | "eligibility",
  read: RecordAttachmentRead<unknown>,
): ExplicitAdoptionErrorV1 {
  const code = subject === "evaluations"
    ? "adoption-source-evaluations-unavailable"
    : subject === "verdict"
      ? "adoption-source-verdict-unavailable"
      : "adoption-source-eligibility-unavailable";
  const detail = read.state === "invalid"
    ? "invalid"
    : read.state;
  return adoptionError(code, `Source ${subject} Attachment is ${detail}.`);
}

function sourceCoreInvalid(message: string): ExplicitAdoptionErrorV1 {
  return adoptionError("adoption-source-core-invalid", message);
}

function sourceReferenceKey(ref: RecordAttemptRef): string {
  return `${ref.originRunId}${ADOPTION_TARGET_SLOT_SEPARATOR}${ref.attemptId}`;
}

/** Locates one exact v1 AttemptId by scanning only the frozen Record view. */
export function resolveExplicitAttemptLocatorV1(
  view: FrozenRecordView<RecordReaderReadError>,
  text: string,
): Effect.Effect<ResolvedAdoptionAttemptV1, ExplicitAdoptionReadErrorV1> {
  return Effect.gen(function* () {
    const locator = yield* parseExplicitAttemptLocatorV1(text);
    const port = resolveFrozenRecordReaderPort(view);
    if (port === undefined) {
      return yield* Effect.fail(sourceCoreInvalid("The supplied Record view is not an authentic frozen reader."));
    }
    yield* port.assertOpen(view);
    const matches = yield* Stream.runFoldEffect(
      port.candidates(view),
      { first: undefined as RecordAttemptRef | undefined, duplicate: false },
      (found, candidate): Effect.Effect<{
        readonly first: RecordAttemptRef | undefined;
        readonly duplicate: boolean;
      }, RecordReaderReadError> => {
        // Once a second distinct immutable reference has been observed, the
        // locator is irredeemably ambiguous. Keep consuming the bounded stream
        // without retaining or reading any more candidates.
        if (found.duplicate || candidate.state !== "available") {
          return Effect.succeed(found);
        }
        return Effect.gen(function* () {
          let first = found.first;
          let duplicate = false;
          for (const slotId of candidate.value.expectedSlots) {
            // Candidate Members are read one at a time: a locator only needs
            // its first exact reference and an ambiguity bit, never a full
            // per-Run Member result array.
            if (duplicate) break;
            const member = yield* port.member(view, candidate.value, slotId);
            if (
              member.state === "available"
              && member.value.attempt.attemptId === locator.attemptId
            ) {
              if (first === undefined) {
                first = member.value.attempt;
              } else if (sourceReferenceKey(first) !== sourceReferenceKey(member.value.attempt)) {
                duplicate = true;
              }
            }
          }
          return Object.freeze({ first, duplicate });
        });
      },
    );
    if (matches.first === undefined) {
      return yield* Effect.fail(adoptionError(
        "adoption-locator-not-found",
        `No published current-Record Attempt matches locator "${locator.text}".`,
      ));
    }
    if (matches.duplicate) {
      return yield* Effect.fail(adoptionError(
        "adoption-locator-ambiguous",
        `Locator "${locator.text}" resolves to more than one immutable Attempt.`,
      ));
    }
    const ref = matches.first;
    const attempt = yield* view.attempt(ref);
    if (attempt.state !== "available") {
      return yield* Effect.fail(sourceCoreInvalid(
        `Locator "${locator.text}" points at a missing or invalid source Attempt.`,
      ));
    }
    return yield* resolveAdoptionAttemptV1(view, attempt.value, locator);
  });
}

/** Validates the origin anchor and evaluates its source Run/Slot metadata. */
export function resolveAdoptionAttemptV1(
  view: FrozenRecordView<RecordReaderReadError>,
  attempt: FrozenRecordAttempt,
  locator?: ExplicitAttemptLocatorV1,
): Effect.Effect<ResolvedAdoptionAttemptV1, ExplicitAdoptionReadErrorV1> {
  return Effect.gen(function* () {
    const sourceLocator = locator ?? (yield* attemptLocatorFor(attempt.attemptId));
    const checked = yield* view.attempt({
      originRunId: attempt.originRunId,
      attemptId: attempt.attemptId,
    });
    if (checked.state !== "available" || checked.value !== attempt) {
      return yield* Effect.fail(sourceCoreInvalid(
        `Source locator "${sourceLocator.text}" does not retain an exact frozen Attempt identity.`,
      ));
    }
    const port = resolveFrozenRecordReaderPort(view);
    if (port === undefined) {
      return yield* Effect.fail(sourceCoreInvalid("The supplied Record view is not an authentic frozen reader."));
    }
    const originRun = yield* view.run(attempt.originRunId);
    if (originRun.state !== "available") {
      return yield* Effect.fail(sourceCoreInvalid(
        `Source locator "${sourceLocator.text}" has no readable origin Run.`,
      ));
    }
    let originSlot: SlotId | undefined;
    for (const slotId of originRun.value.expectedSlots) {
      const member = yield* port.member(view, originRun.value, slotId);
      if (member.state === "core-invalid") {
        return yield* Effect.fail(sourceCoreInvalid(
          `Source origin Run for "${sourceLocator.text}" has an invalid Member.`,
        ));
      }
      if (member.state === "available" && sameAttemptReference(member.value.attempt, attempt)) {
        if (originSlot !== undefined) {
          return yield* Effect.fail(sourceCoreInvalid(
            `Source origin Run for "${sourceLocator.text}" has duplicate origin Members.`,
          ));
        }
        originSlot = slotId;
      }
    }
    if (originSlot === undefined) {
      return yield* Effect.fail(sourceCoreInvalid(
        `Source locator "${sourceLocator.text}" has no origin Member.`,
      ));
    }
    const evaluations = yield* view.readRunAttachment(
      originRun.value,
      evaluationsAttachmentFamilyV1,
    );
    if (evaluations.state !== "available") {
      return yield* Effect.fail(attachmentUnavailable("evaluations", evaluations));
    }
    const projection = projectEvaluationsAttachmentV1(evaluations.value);
    const sourceSlot = projection.evaluationForSlot(originSlot);
    if (sourceSlot === undefined) {
      return yield* Effect.fail(sourceCoreInvalid(
        `Source origin Slot for "${sourceLocator.text}" is absent from its Evaluation attachment.`,
      ));
    }
    return Object.freeze({
      locator: sourceLocator,
      attempt,
      origin: Object.freeze({ run: originRun.value, slotId: originSlot }),
      originExperimentId: projection.experimentId,
      originEvalId: sourceSlot.evalId,
      originAttempt: sourceSlot.attempt,
    });
  });
}

export function readAdoptionVerdictV1(
  view: FrozenRecordView<RecordReaderReadError>,
  source: ResolvedAdoptionAttemptV1,
): Effect.Effect<VerdictStateV1, ExplicitAdoptionReadErrorV1> {
  return view.readAttemptAttachment(source.attempt, verdictAttachmentFamilyV1).pipe(
    Effect.flatMap((verdict) => verdict.state === "available"
      ? Effect.succeed(projectVerdictAttachmentV1(verdict.value))
      : Effect.fail(attachmentUnavailable("verdict", verdict))),
  );
}

export function readAdoptionEligibilityV1(
  view: FrozenRecordView<RecordReaderReadError>,
  source: ResolvedAdoptionAttemptV1,
): Effect.Effect<AttemptEligibilityPayloadV1, ExplicitAdoptionReadErrorV1> {
  return view.readAttemptAttachment(source.attempt, eligibilityAttachmentFamilyV1).pipe(
    Effect.flatMap((eligibility) => eligibility.state === "available"
      ? Effect.succeed(projectEligibilityAttachmentV1(eligibility.value))
      : Effect.fail(attachmentUnavailable("eligibility", eligibility))),
  );
}

function identityComparison(input: {
  readonly recordedClaim: "input-identity" | "config-identity";
  readonly source: EqualityTokenV1;
  readonly target: EqualityTokenV1;
}): ComparisonProvenanceV1 {
  const reason = input.source.domain !== input.target.domain
    ? "identity-domain-mismatch"
    : input.source.value !== input.target.value
      ? "identity-mismatch"
      : `${input.recordedClaim}-match`;
  return Object.freeze({
    attachment: "niceeval.eligibility/v1",
    recordedClaim: input.recordedClaim,
    sourceState: "available",
    result: reason.endsWith("-match") ? "match" : "mismatch",
    reason,
  });
}

function durationComparison(input: {
  readonly source: DurationLimitV1;
  readonly target?: DurationLimitV1;
}): {
  readonly comparison: ComparisonProvenanceV1;
  readonly failure?: "adoption-duration-domain-mismatch" | "adoption-timeout-exceeded";
} {
  if (input.target === undefined) {
    return Object.freeze({
      comparison: Object.freeze({
        attachment: "niceeval.eligibility/v1",
        recordedClaim: "execution-duration",
        sourceState: "available",
        result: "match",
        reason: "timeout-unbounded",
      }),
    });
  }
  if (input.source.domain !== input.target.domain) {
    return Object.freeze({
      comparison: Object.freeze({
        attachment: "niceeval.eligibility/v1",
        recordedClaim: "execution-duration",
        sourceState: "available",
        result: "mismatch",
        reason: "duration-domain-mismatch",
      }),
      failure: "adoption-duration-domain-mismatch",
    });
  }
  if (input.source.milliseconds > input.target.milliseconds) {
    return Object.freeze({
      comparison: Object.freeze({
        attachment: "niceeval.eligibility/v1",
        recordedClaim: "execution-duration",
        sourceState: "available",
        result: "mismatch",
        reason: "timeout-exceeded",
      }),
      failure: "adoption-timeout-exceeded",
    });
  }
  return Object.freeze({
    comparison: Object.freeze({
      attachment: "niceeval.eligibility/v1",
      recordedClaim: "execution-duration",
      sourceState: "available",
      result: "match",
      reason: "duration-within-timeout",
    }),
  });
}

/**
 * Builds one accepted reference intent. Input/config comparisons are durable
 * evidence of the operator's manual decision; unlike automatic carry, a
 * mismatch does not silently turn into a gap. Verdict, readable eligibility,
 * duration domain and the current timeout remain hard safety gates.
 */
export function prepareExplicitAdoptionMemberV1(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly target: CurrentAdoptionTargetV1;
  readonly source: ResolvedAdoptionAttemptV1;
  readonly evalId: string;
  readonly attempt: number;
  readonly operatorReason?: string;
}): Effect.Effect<ExplicitAdoptionMemberV1, ExplicitAdoptionReadErrorV1> {
  return Effect.gen(function* () {
    const target = input.target.slotFor(input.evalId, input.attempt);
    if (target === undefined) {
      const code = input.target.slots.some((slot) => slot.evalId === input.evalId)
        ? "adoption-target-attempt-not-selected"
        : "adoption-target-eval-not-selected";
      return yield* Effect.fail(adoptionError(
        code,
        `Current target ${input.target.experimentId}/${input.evalId} does not contain ordinal ${String(input.attempt)}.`,
      ));
    }
    const verdict = yield* readAdoptionVerdictV1(input.view, input.source);
    if (verdict !== "passed" && verdict !== "failed") {
      return yield* Effect.fail(adoptionError(
        "adoption-source-verdict-ineligible",
        `Source locator "${input.source.locator.text}" has Verdict "${verdict}" and cannot be explicitly adopted.`,
      ));
    }
    const eligibility = yield* readAdoptionEligibilityV1(input.view, input.source);
    const duration = durationComparison({
      source: eligibility.executionDuration,
      target: target.timeout,
    });
    if (duration.failure !== undefined) {
      return yield* Effect.fail(adoptionError(
        duration.failure,
        duration.failure === "adoption-timeout-exceeded"
          ? `Source locator "${input.source.locator.text}" exceeds the current timeout.`
          : `Source locator "${input.source.locator.text}" uses an incomparable execution-duration domain.`,
      ));
    }
    const comparisons = Object.freeze([
      Object.freeze({
        attachment: "niceeval.eligibility/v1" as const,
        recordedClaim: "reuse-contract" as const,
        sourceState: "available" as const,
        result: "not-comparable" as const,
        reason: "explicit-adoption-manual-policy",
      }),
      Object.freeze({
        attachment: "niceeval.verdict/v1" as const,
        recordedClaim: "verdict-state" as const,
        sourceState: "available" as const,
        result: "match" as const,
        reason: "verdict-eligible",
      }),
      identityComparison({
        recordedClaim: "input-identity",
        source: eligibility.inputIdentity,
        target: target.inputIdentity,
      }),
      identityComparison({
        recordedClaim: "config-identity",
        source: eligibility.configIdentity,
        target: target.configIdentity,
      }),
      duration.comparison,
    ]);
    return Object.freeze({
      target,
      source: input.source,
      locator: input.source.locator.text,
      verdict,
      comparisons,
      ...(input.operatorReason === undefined
        ? {}
        : { operatorReason: input.operatorReason }),
    });
  });
}

function membershipOptions(input: {
  readonly intent: ExplicitAdoptionIntentV1;
  readonly target: CurrentAdoptionTargetV1;
}): MembershipEffectiveOptionsV1 {
  return Object.freeze({
    intent: input.intent,
    experimentId: input.target.experimentId,
    expectedSlots: input.target.expectedSlots.map((slotId) => String(slotId)),
  });
}

function notDispatchedAdoptionAction(
  slotId: SlotId,
): MembershipActionV1 {
  return Object.freeze({
    action: "not-dispatched" as const,
    slotId,
    gap: Object.freeze({
      reason: "rerun-requested" as const,
      scope: "slot" as const,
      issues: Object.freeze([]),
    }),
    comparisons: Object.freeze([
      Object.freeze({
        attachment: "niceeval.eligibility/v1" as const,
        recordedClaim: "reuse-contract" as const,
        sourceState: "unavailable" as const,
        result: "not-comparable" as const,
        reason: "explicit-adoption-locator-not-authorized-for-target-slot",
      }),
    ]),
  });
}

function acceptedAdoptionAction(
  member: ExplicitAdoptionMemberV1,
): MembershipActionV1 {
  return Object.freeze({
    action: "accepted" as const,
    slotId: member.target.slotId,
    attemptId: member.source.attempt.attemptId,
    origin: Object.freeze({
      runId: member.source.origin.run.runId,
      slotId: member.source.origin.slotId,
    }),
    sourceBarrier: Object.freeze({
      runId: member.source.origin.run.runId,
      startedAt: member.source.origin.run.startedAt,
    }),
    comparisons: member.comparisons,
    locator: member.locator,
    ...(member.operatorReason === undefined
      ? {}
      : { operatorReason: member.operatorReason }),
  });
}

/**
 * The full current target remains the Run denominator. Therefore this producer
 * constructs exactly one final provenance action for every expected Slot:
 * explicit Members are accepted, while all other current Slots are explicitly
 * recorded as not dispatched rather than silently disappearing from history.
 */
function buildExplicitAdoptionActionsV1(input: {
  readonly target: CurrentAdoptionTargetV1;
  readonly members: readonly ExplicitAdoptionMemberV1[];
}): Effect.Effect<readonly MembershipActionV1[], ExplicitAdoptionErrorV1> {
  return Effect.gen(function* () {
    const expected = new Set<string>();
    for (const slotId of input.target.expectedSlots) {
      if (expected.has(slotId)) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-slot-duplicate",
          `Current target lists Slot "${slotId}" more than once.`,
        ));
      }
      expected.add(slotId);
    }
    const targetSlots = new Set(input.target.slots.map((slot) => String(slot.slotId)));
    if (
      targetSlots.size !== expected.size
      || [...expected].some((slotId) => !targetSlots.has(slotId))
    ) {
      return yield* Effect.fail(adoptionError(
        "adoption-target-invalid",
        "Current target Slot definitions do not exactly match its expected Slot denominator.",
      ));
    }

    const memberBySlot = new Map<string, ExplicitAdoptionMemberV1>();
    for (const member of input.members) {
      const slotId = String(member.target.slotId);
      if (!expected.has(slotId)) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-eval-not-selected",
          `Explicit adoption selected Slot "${slotId}" outside the current target denominator.`,
        ));
      }
      if (memberBySlot.has(slotId)) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-member-duplicate",
          `More than one source attempts to occupy target Slot "${slotId}".`,
        ));
      }
      memberBySlot.set(slotId, member);
    }

    const actions = input.target.expectedSlots.map((slotId) => {
      const member = memberBySlot.get(String(slotId));
      return member === undefined
        ? notDispatchedAdoptionAction(slotId)
        : acceptedAdoptionAction(member);
    });
    const actionSlots = new Set(actions.map((action) => String(action.slotId)));
    if (
      actions.length !== input.target.expectedSlots.length
      || actionSlots.size !== expected.size
      || [...expected].some((slotId) => !actionSlots.has(slotId))
    ) {
      return yield* Effect.fail(adoptionError(
        "adoption-provenance-invalid",
        "Explicit adoption did not produce one final Membership action for every expected Slot.",
      ));
    }
    return Object.freeze(actions);
  });
}

/**
 * Performs all generic Evaluation and provenance validation before a writer
 * creates a Run directory. This is the batch's no-business-write boundary.
 */
export function buildExplicitAdoptionRunPlanV1(input: {
  readonly intent: ExplicitAdoptionIntentV1;
  readonly target: CurrentAdoptionTargetV1;
  readonly members: readonly ExplicitAdoptionMemberV1[];
}): Effect.Effect<ExplicitAdoptionRunPlanV1, ExplicitAdoptionErrorV1> {
  return Effect.gen(function* () {
    if (input.members.length === 0) {
      return yield* Effect.fail(adoptionError(
        "adoption-target-invalid",
        "Explicit adoption requires at least one reference Member.",
      ));
    }
    const actions = yield* buildExplicitAdoptionActionsV1(input);
    const provenance: MembershipProvenancePayloadV1 = {
      policy: Object.freeze({
        name: EXPLICIT_ADOPTION_POLICY_NAME_V1,
        version: EXPLICIT_ADOPTION_POLICY_VERSION_V1,
      }),
      effectiveOptions: membershipOptions(input),
      actions,
    };
    const provenanceWrite = buildMembershipProvenanceAttachmentWriteV1(provenance);
    if (Either.isLeft(provenanceWrite)) {
      return yield* Effect.fail(adoptionError(
        "adoption-provenance-invalid",
        "Explicit adoption produced invalid Membership Provenance.",
      ));
    }
    const plan = yield* EvaluationRecordContractV1.preparePlan({
      startedAt: input.target.startedAt,
      completedAt: input.target.startedAt,
      expectedSlots: input.target.expectedSlots,
      evaluations: input.target.evaluations,
      originAttempts: [],
      references: input.members.map((member) => Object.freeze({
        slotId: member.target.slotId,
        attempt: member.source.attempt,
      })),
      runWrites: [provenanceWrite.right],
    }).pipe(
      Effect.mapError(() => adoptionError(
        "adoption-evaluation-plan-invalid",
        "Explicit adoption failed Evaluation Record contract preflight.",
      )),
    );
    return Object.freeze({
      intent: input.intent,
      target: input.target,
      members: Object.freeze([...input.members]),
      evaluationPlan: plan,
    });
  });
}

/** Writes only plans already built from this exact session's frozen view. */
export function commitExplicitAdoptionRunPlansV1(
  session: RecordWriteSession,
  plans: readonly ExplicitAdoptionRunPlanV1[],
): Effect.Effect<
  readonly ExplicitAdoptionRunReceiptV1[],
  ExplicitAdoptionCommitErrorV1,
  never
> {
  return Effect.forEach(
    plans,
    (plan): Effect.Effect<
      ExplicitAdoptionRunReceiptV1,
      ExplicitAdoptionCommitErrorV1,
      never
    > => EvaluationRecordContractV1.writePlan(session, plan.evaluationPlan).pipe(
      Effect.map((receipt: RecordPublishReceipt) => receiptForPlan(plan, receipt)),
    ),
    { concurrency: 1 },
  );
}

function receiptForPlan(
  plan: ExplicitAdoptionRunPlanV1,
  receipt: RecordPublishReceipt,
): ExplicitAdoptionRunReceiptV1 {
  return Object.freeze({
    runId: receipt.runId,
    members: Object.freeze(plan.members.map((member) => Object.freeze({
      slotId: member.target.slotId,
      locator: member.locator,
      sourceRunId: member.source.origin.run.runId,
      attemptId: member.source.attempt.attemptId,
    }))),
  });
}

/** A fresh in-memory invocation identity never enters Record Core. */
export function createExplicitAdoptionInvocationIdV1(
  mint: () => string = randomUUID,
): Effect.Effect<string> {
  return Effect.sync(() => `adoption-${mint()}`);
}

export function adoptionStartedAtV1(input?: () => string | number): Effect.Effect<UtcMillis, ExplicitAdoptionErrorV1> {
  return Effect.sync(() => input?.() ?? Date.now()).pipe(
    Effect.flatMap((value) => {
      const millis = typeof value === "number" ? value : Date.parse(value);
      return utcMillis(millis);
    }),
  );
}

/** Opens a frozen read view only; dry callers must use this rather than a writer session. */
export function withAdoptionReaderV1<A, E, R>(input: {
  readonly root: RecordRoot;
  readonly use: (
    view: FrozenRecordView<RecordReaderReadError>,
  ) => Effect.Effect<A, E, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* openRecordReader({ root: input.root });
      return yield* input.use(reader);
    }),
  );
}

/** Opens the sole scoped write session after an earlier reader preflight passed. */
export function withAdoptionWriteSessionV1<A, E, R>(input: {
  readonly root: RecordRoot;
  readonly use: (session: RecordWriteSession) => Effect.Effect<A, E, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const session = yield* openRecordWriteSession({ root: input.root });
      return yield* input.use(session);
    }),
  );
}

/**
 * Selects one old Experiment Run without directory-time inference. Multiple
 * matching Runs require the caller to pass an exact RunId.
 */
export function resolveRenameSourceRunV1(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly oldId: string;
  readonly sourceRunId?: string;
}): Effect.Effect<FrozenRecordRun, ExplicitAdoptionReadErrorV1> {
  return Effect.gen(function* () {
    if (input.sourceRunId !== undefined) {
      const runId = yield* decodeBrandedId(
        RunIdSchema,
        input.sourceRunId,
        "adoption-source-run-not-found",
        "Rename source Run",
      );
      const run = yield* input.view.run(runId);
      if (run.state !== "available") {
        return yield* Effect.fail(adoptionError(
          "adoption-source-run-not-found",
          `Rename source Run "${input.sourceRunId}" is not a published readable Run.`,
        ));
      }
      const evaluations = yield* input.view.readRunAttachment(run.value, evaluationsAttachmentFamilyV1);
      if (evaluations.state !== "available") {
        return yield* Effect.fail(attachmentUnavailable("evaluations", evaluations));
      }
      if (projectEvaluationsAttachmentV1(evaluations.value).experimentId !== input.oldId) {
        return yield* Effect.fail(adoptionError(
          "adoption-source-run-mismatch",
          `Run "${input.sourceRunId}" does not belong to old Experiment "${input.oldId}".`,
        ));
      }
      return run.value;
    }

    const matches = yield* Stream.runFoldEffect(
      input.view.runs,
      { first: undefined as FrozenRecordRun | undefined, duplicate: false },
      (runs, candidate): Effect.Effect<{
        readonly first: FrozenRecordRun | undefined;
        readonly duplicate: boolean;
      }, RecordReaderReadError> => {
        // Keep the scan streaming even after the decision is known, but do not
        // retain arbitrary historic Runs or perform needless Attachment I/O.
        if (runs.duplicate || candidate.state !== "available") {
          return Effect.succeed(runs);
        }
        return input.view.readRunAttachment(candidate.value, evaluationsAttachmentFamilyV1).pipe(
          Effect.map((evaluations) => {
            if (
              evaluations.state === "available"
              && projectEvaluationsAttachmentV1(evaluations.value).experimentId === input.oldId
            ) {
              return runs.first === undefined
                ? Object.freeze({ first: candidate.value, duplicate: false })
                : Object.freeze({ first: runs.first, duplicate: true });
            }
            return runs;
          }),
        );
      },
    );
    if (matches.first === undefined) {
      return yield* Effect.fail(adoptionError(
        "adoption-source-run-not-found",
        `No published source Run belongs to old Experiment "${input.oldId}".`,
      ));
    }
    if (matches.duplicate) {
      return yield* Effect.fail(adoptionError(
        "adoption-source-run-required",
        `Old Experiment "${input.oldId}" has multiple published Runs; select one exact source RunId.`,
      ));
    }
    return matches.first;
  });
}

export interface RenameAdoptionMemberV1 {
  readonly evalId: string;
  readonly attempt: number;
  readonly member: ExplicitAdoptionMemberV1;
}

export interface RenameAdoptionExcludedV1 {
  readonly evalId: string;
  readonly attempt: number;
  readonly reason: "source-member-missing" | "target-eval-not-selected" | "target-attempt-not-selected";
}

export interface RenameAdoptionPreflightV1 {
  readonly sourceRun: FrozenRecordRun;
  readonly members: readonly RenameAdoptionMemberV1[];
  readonly excluded: readonly RenameAdoptionExcludedV1[];
}

/**
 * Reads exactly one selected old Run. Source slots omitted by the current
 * target are preview exclusions; every source Member that would be adopted is
 * fully validated before the caller is allowed to create a target Run.
 */
export function prepareRenameAdoptionMembersV1(input: {
  readonly view: FrozenRecordView<RecordReaderReadError>;
  readonly oldId: string;
  readonly sourceRun: FrozenRecordRun;
  readonly target: CurrentAdoptionTargetV1;
  readonly operatorReason: string;
}): Effect.Effect<RenameAdoptionPreflightV1, ExplicitAdoptionReadErrorV1> {
  return Effect.gen(function* () {
    const port = resolveFrozenRecordReaderPort(input.view);
    if (port === undefined) {
      return yield* Effect.fail(sourceCoreInvalid("The supplied Record view is not an authentic frozen reader."));
    }
    const evaluations = yield* input.view.readRunAttachment(
      input.sourceRun,
      evaluationsAttachmentFamilyV1,
    );
    if (evaluations.state !== "available") {
      return yield* Effect.fail(attachmentUnavailable("evaluations", evaluations));
    }
    const sourceEvaluations = projectEvaluationsAttachmentV1(evaluations.value);
    if (sourceEvaluations.experimentId !== input.oldId) {
      return yield* Effect.fail(adoptionError(
        "adoption-source-run-mismatch",
        `Selected source Run "${input.sourceRun.runId}" does not belong to old Experiment "${input.oldId}".`,
      ));
    }

    const members: RenameAdoptionMemberV1[] = [];
    const excluded: RenameAdoptionExcludedV1[] = [];
    const seenSourceSlots = new Set<string>();
    for (const slotId of input.sourceRun.expectedSlots) {
      if (seenSourceSlots.has(slotId)) {
        return yield* Effect.fail(sourceCoreInvalid(
          `Selected source Run "${input.sourceRun.runId}" repeats Slot "${slotId}".`,
        ));
      }
      seenSourceSlots.add(slotId);
      const sourceSlot = sourceEvaluations.evaluationForSlot(slotId);
      if (sourceSlot === undefined) {
        return yield* Effect.fail(sourceCoreInvalid(
          `Selected source Run "${input.sourceRun.runId}" has Slot "${slotId}" outside its Evaluations attachment.`,
        ));
      }
      const targetSlot = input.target.slotFor(sourceSlot.evalId, sourceSlot.attempt);
      if (targetSlot === undefined) {
        const selectedEval = input.target.slots.some(
          (slot) => slot.evalId === sourceSlot.evalId,
        );
        excluded.push(Object.freeze({
          evalId: sourceSlot.evalId,
          attempt: sourceSlot.attempt,
          reason: selectedEval
            ? "target-attempt-not-selected"
            : "target-eval-not-selected",
        }));
        continue;
      }

      const sourceMember = yield* port.member(input.view, input.sourceRun, slotId);
      if (sourceMember.state === "core-invalid") {
        return yield* Effect.fail(sourceCoreInvalid(
          `Selected source Run "${input.sourceRun.runId}" has an invalid Member for Slot "${slotId}".`,
        ));
      }
      if (sourceMember.state === "missing") {
        excluded.push(Object.freeze({
          evalId: sourceSlot.evalId,
          attempt: sourceSlot.attempt,
          reason: "source-member-missing",
        }));
        continue;
      }
      const sourceAttempt = yield* input.view.attempt(sourceMember.value.attempt);
      if (sourceAttempt.state !== "available") {
        return yield* Effect.fail(sourceCoreInvalid(
          `Selected source Member for Slot "${slotId}" does not retain a readable exact Attempt.`,
        ));
      }
      const source = yield* resolveAdoptionAttemptV1(input.view, sourceAttempt.value);
      if (
        source.originEvalId !== sourceSlot.evalId
        || source.originAttempt !== sourceSlot.attempt
      ) {
        return yield* Effect.fail(sourceCoreInvalid(
          `Selected source Member for ${sourceSlot.evalId}/${String(sourceSlot.attempt)} does not retain a matching origin Attempt.`,
        ));
      }
      const member = yield* prepareExplicitAdoptionMemberV1({
        view: input.view,
        target: input.target,
        source,
        evalId: sourceSlot.evalId,
        attempt: sourceSlot.attempt,
        operatorReason: input.operatorReason,
      });
      members.push(Object.freeze({
        evalId: sourceSlot.evalId,
        attempt: sourceSlot.attempt,
        member,
      }));
    }
    return Object.freeze({
      sourceRun: input.sourceRun,
      members: Object.freeze(members),
      excluded: Object.freeze(excluded),
    });
  });
}
