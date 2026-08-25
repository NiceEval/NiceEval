import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Effect, Either, Schema } from "effect";

import {
  encodeAttemptLocator,
  parseAttemptLocator,
  type AttemptLocator,
} from "../attempt-locator.ts";
import { resolveAttemptLocator } from "../attempt-locator-resolution.ts";
import { sealedAssertionResult } from "../assertions/record/model.ts";
import {
  EXECUTION_DURATION_DOMAIN,
  readAttemptExecutionDuration,
  type DurationLimit,
  type EqualityToken,
} from "../eval/record/eligibility.ts";
import {
  type ComparisonProvenance,
} from "../eval/record/membership-provenance.ts";
import {
  foldVerdict,
  type VerdictState,
} from "../eval/record/verdict.ts";
import { recordHost } from "../record/host/runtime.ts";
import type {
  RecordReadSession,
  SelectedAttemptRef,
} from "../record/host/types.ts";
import {
  EvalIdSchema,
  ExecutionIdentityDigestSchema,
  ExperimentIdSchema,
  RunIdSchema,
  SlotIdSchema,
  UtcMillisSchema,
} from "../record/codec/identifiers.ts";
import type { AttemptOutcome, RecordSlotIdentity } from "../record/model/core.ts";
import {
  canonicalizeRunContext,
  type RunContext,
} from "../record/model/run-context.ts";
import type {
  EvalId,
  ExperimentId,
  ExecutionIdentityDigest,
  RunId,
  SlotId,
  UtcMillis,
} from "../record/model/identifiers.ts";
import {
  makeRecordRoot,
  type RecordRoot,
  type RecordRootConstructionError,
} from "../record/platform/root.ts";
import type { RecordReaderOpenError, RecordReaderReadError } from "../record/reader/errors.ts";
import type { RecordWriteError } from "../record/writer/types.ts";
import type { SandboxPlanningServices } from "../sandbox/plan.ts";
import {
  discoverEvals,
  discoverExperiments,
} from "./discover.ts";
import { resolveExperimentEvals } from "./eval-selection.ts";
import { slotExecutionIdentityDigestHex } from "./execution-identity.ts";
import {
  planPreparedProjectTarget,
} from "./fingerprint.ts";
import { prepareRunSandboxes, type PreparedRunPair } from "./sandbox-selection.ts";
import { resolveAttemptTimeout, resolveRunTimeout } from "./timeout.ts";
import { resolveSandboxSetupCache } from "./types.ts";
import type {
  AgentRun,
  Config,
  DiscoveredEval,
  DiscoveredExperiment,
} from "./types.ts";

/** Shared domains emitted by the current ProjectTarget producer. */
export const ADOPTION_INPUT_IDENTITY_DOMAIN =
  "niceeval.input/fingerprint-v1" as const;
export const ADOPTION_CONFIG_IDENTITY_DOMAIN =
  "niceeval.config/identity-v1" as const;
const ADOPTION_TARGET_SLOT_SEPARATOR = "\u0000";

export type ExplicitAdoptionIntent = "accept" | "rename";

export type ExplicitAdoptionFailureCode =
  | "adoption-locator-malformed"
  | "adoption-locator-not-found"
  | "adoption-locator-ambiguous"
  | "adoption-batch-locator-duplicate"
  | "adoption-source-core-invalid"
  | "adoption-source-verdict-unavailable"
  | "adoption-source-observability-unavailable"
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
export class ExplicitAdoptionError extends Error {
  readonly name = "ExplicitAdoptionError";

  constructor(
    readonly code: ExplicitAdoptionFailureCode,
    message: string,
  ) {
    super(message);
  }
}

export type ExplicitAdoptionReadError =
  | ExplicitAdoptionError
  | RecordReaderReadError;

export type ExplicitAdoptionOpenError =
  | ExplicitAdoptionError
  | RecordRootConstructionError
  | RecordReaderOpenError
  | RecordReaderReadError
  | RecordWriteError;

export interface AdoptionProjectInput {
  readonly cwd: string;
  readonly config?: Config;
  readonly evals?: readonly DiscoveredEval[];
  readonly experiments?: readonly DiscoveredExperiment[];
  readonly planningServices?: SandboxPlanningServices;
}

export interface AdoptionProject {
  readonly cwd: string;
  readonly config: Config;
  readonly evals: readonly DiscoveredEval[];
  readonly experiments: readonly DiscoveredExperiment[];
  readonly planningServices?: SandboxPlanningServices;
}

export interface ExplicitAttemptLocator {
  readonly text: string;
  readonly locator: AttemptLocator;
  readonly attemptId: SelectedAttemptRef["attemptId"];
}

interface ParsedExplicitAttemptLocator {
  readonly text: string;
  readonly locator: AttemptLocator;
}

export interface ResolvedAdoptionAttempt {
  readonly locator: ExplicitAttemptLocator;
  readonly attempt: SelectedAttemptRef;
  readonly origin: {
    readonly runId: RunId;
    readonly slotId: SlotId;
    readonly startedAt: UtcMillis;
  };
  readonly originExperimentId: string;
  readonly originEvalId: string;
  readonly originAttempt: number;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
}

export interface CurrentAdoptionSlot {
  readonly slotId: SlotId;
  readonly experimentId: string;
  readonly evalId: string;
  /** Durable Slot identity; `attempt` remains the caller-facing selector. */
  readonly attemptOrdinal: number;
  readonly attempt: number;
  readonly inputIdentity: EqualityToken;
  readonly configIdentity: EqualityToken;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
  readonly timeout?: DurationLimit;
}

export interface CurrentAdoptionTarget {
  readonly experimentId: string;
  readonly startedAt: UtcMillis;
  readonly expectedSlots: readonly RecordSlotIdentity[];
  readonly context: RunContext;
  readonly slots: readonly CurrentAdoptionSlot[];
  readonly slotFor: (evalId: string, attempt: number) => CurrentAdoptionSlot | undefined;
}

export interface ExplicitAdoptionMember {
  readonly target: CurrentAdoptionSlot;
  readonly source: ResolvedAdoptionAttempt;
  readonly locator: string;
  readonly verdict: "passed" | "failed";
  readonly comparisons: readonly ComparisonProvenance[];
  readonly operatorReason?: string;
}

export interface ExplicitAdoptionRunPlan {
  readonly intent: ExplicitAdoptionIntent;
  readonly target: CurrentAdoptionTarget;
  readonly members: readonly ExplicitAdoptionMember[];
}

export interface ExplicitAdoptionMemberReceipt {
  readonly slotId: SlotId;
  readonly locator: string;
  readonly sourceRunId: RunId;
  readonly attemptId: SelectedAttemptRef["attemptId"];
}

export interface ExplicitAdoptionRunReceipt {
  /** Explicit target identity; receipt ordering is never provenance. */
  readonly experimentId: string;
  readonly runId: RunId;
  readonly members: readonly ExplicitAdoptionMemberReceipt[];
}

/** Real Host write/open failures after all domain preflight has already passed. */
export type ExplicitAdoptionCommitError =
  | RecordWriteError
  | RecordReaderOpenError;

function adoptionError(
  code: ExplicitAdoptionFailureCode,
  message: string,
): ExplicitAdoptionError {
  return new ExplicitAdoptionError(code, message);
}

function safeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function decodeBrandedId<Id>(
  schema: Schema.Schema<Id, string>,
  value: string,
  code: ExplicitAdoptionFailureCode,
  label: string,
): Effect.Effect<Id, ExplicitAdoptionError> {
  const decoded = Schema.decodeUnknownEither(schema)(value);
  return Either.isLeft(decoded)
    ? Effect.fail(adoptionError(code, `${label} is not a current Record identity.`))
    : Effect.succeed(decoded.right);
}

function utcMillis(value: number): Effect.Effect<UtcMillis, ExplicitAdoptionError> {
  const decoded = Schema.decodeUnknownEither(UtcMillisSchema)(value);
  return Either.isLeft(decoded)
    ? Effect.fail(adoptionError("adoption-target-invalid", "Adoption timestamp is invalid."))
    : Effect.succeed(decoded.right);
}

function slotKey(evalId: string, attempt: number): string {
  return `${evalId}${ADOPTION_TARGET_SLOT_SEPARATOR}${String(attempt)}`;
}

function attemptLocatorFor(
  attemptId: SelectedAttemptRef["attemptId"],
): ExplicitAttemptLocator {
  const locator = encodeAttemptLocator(attemptId);
  return Object.freeze({ text: locator, locator, attemptId });
}

/** Strict v1 parser accepts only the current canonical short locator. */
export function parseExplicitAttemptLocator(
  value: string,
): Effect.Effect<ParsedExplicitAttemptLocator, ExplicitAdoptionError> {
  const parsed = parseAttemptLocator(value);
  if (!parsed.valid) {
    return Effect.fail(
      adoptionError(
        "adoption-locator-malformed",
        "An explicit adoption locator must match @1 followed by 12 canonical uppercase Crockford characters.",
      ),
    );
  }
  return Effect.succeed(Object.freeze({ text: value, locator: parsed.locator }));
}

/** The public application boundary owns Record-root construction. */
export function adoptionRecordRoot(input: {
  readonly cwd: string;
  readonly recordRoot?: string;
}): Effect.Effect<RecordRoot, RecordRootConstructionError> {
  const root = makeRecordRoot(resolve(input.cwd, input.recordRoot ?? ".niceeval/record"));
  return Either.isLeft(root) ? Effect.fail(root.left) : Effect.succeed(root.right);
}

/** Discovery is rerun for both read preflight and the write-session frozen view. */
export function loadAdoptionProject(
  input: AdoptionProjectInput,
): Effect.Effect<AdoptionProject, ExplicitAdoptionError> {
  return Effect.gen(function* () {
    const cwd = resolve(input.cwd);
    const config = input.config ?? (yield* Effect.fail(adoptionError(
      "adoption-target-invalid",
      "An application host must supply the resolved project configuration.",
    )));
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
  config: Config,
): AgentRun {
  return Object.freeze({
    agent: experiment.agent,
    ...(experiment.model === undefined ? {} : { model: experiment.model }),
    ...(experiment.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: experiment.reasoningEffort }),
    flags: experiment.flags,
    plugins: experiment.plugins,
    attempts: experiment.attempts,
    earlyExit: experiment.earlyExit,
    sandboxSetupCache: resolveSandboxSetupCache(
      undefined,
      experiment.sandboxCache,
      config.sandboxCache,
    ),
    ...(experiment.sandbox === undefined ? {} : { sandbox: experiment.sandbox }),
    sandboxReuse: experiment.sandboxReuse,
    ...(experiment.sharedState === undefined ? {} : { sharedState: experiment.sharedState }),
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

function adoptionRunContext(run: AgentRun): Either.Either<RunContext, ExplicitAdoptionError> {
  const context = canonicalizeRunContext({
    experimentId: run.experimentId,
    execution: {
      agentId: run.agent.name,
      model: run.model ?? null,
      reasoningEffort: run.reasoningEffort ?? null,
      flags: run.flags,
    },
    labels: run.labels ?? {},
  });
  return Either.isLeft(context)
    ? Either.left(adoptionError(
        "adoption-target-invalid",
        `Run Context for "${run.experimentId}" is invalid.`,
      ))
    : Either.right(context.right);
}

function currentTargetSlotIdentity(input: {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly inputIdentity: EqualityToken;
  readonly configIdentity: EqualityToken;
  readonly timeout?: DurationLimit;
}): Effect.Effect<{
  readonly slotId: SlotId;
  readonly evalId: EvalId;
  readonly attemptOrdinal: number;
  readonly executionIdentityDigest: ExecutionIdentityDigest;
}, ExplicitAdoptionError> {
  return Effect.gen(function* () {
    const digestValue = slotExecutionIdentityDigestHex({
      experimentId: input.experimentId,
      evalId: input.evalId,
      attempt: input.attempt,
      input: input.inputIdentity,
      config: input.configIdentity,
      timeout: input.timeout === undefined
        ? null
        : { domain: input.timeout.domain, milliseconds: input.timeout.milliseconds },
    });
    const digest = yield* decodeBrandedId(
      ExecutionIdentityDigestSchema,
      digestValue,
      "adoption-target-invalid",
      "Adoption target execution identity",
    );
    const evalId = yield* decodeBrandedId(
      EvalIdSchema,
      input.evalId,
      "adoption-target-invalid",
      "Adoption target Eval",
    );
    const slotId = yield* decodeBrandedId(
      SlotIdSchema,
      `slot-${digest}`,
      "adoption-target-invalid",
      "Adoption target Slot",
    );
    return Object.freeze({
      slotId,
      evalId,
      attemptOrdinal: input.attempt,
      executionIdentityDigest: digest,
    });
  });
}

interface CurrentTargetPair {
  readonly pair: PreparedRunPair;
  readonly inputIdentity: EqualityToken;
  readonly configIdentity: EqualityToken;
  readonly timeout?: DurationLimit;
}

/**
 * Rebuilds current discovery, physical planning, config identity and timeout
 * before any adoption decision. It intentionally plans every selected Eval so
 * a produced Run has the complete current denominator rather than only the
 * manually adopted Members.
 */
export function prepareCurrentAdoptionTarget(input: {
  readonly project: AdoptionProject;
  readonly experimentId: string;
  readonly startedAt: UtcMillis;
}): Effect.Effect<CurrentAdoptionTarget, ExplicitAdoptionError> {
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

    const run = runForExperiment(experiment, selection.selectedEvalIds, input.project.config);
    const context = yield* adoptionRunContext(run);
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

    const projectPlan = yield* planPreparedProjectTarget(pairs, {
      configJudge: input.project.config.judge,
    }).pipe(Effect.mapError((cause) => adoptionError(
      "adoption-target-planning-failed",
      `Current identity planning for "${experiment.id}" failed: ${safeMessage(cause)}`,
    )));
    const plannedPairs: CurrentTargetPair[] = [];
    for (const pair of pairs) {
      const fingerprint = projectPlan.plannedFingerprints.get(pair.key);
      const configHash = projectPlan.plannedConfigHashes.get(pair.key);
      if (fingerprint === undefined || configHash === undefined) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-planning-failed",
          `Current identity planning omitted Eval "${pair.evalDef.id}".`,
        ));
      }
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
      plannedPairs.push(Object.freeze({
        pair,
        inputIdentity: Object.freeze({
          domain: ADOPTION_INPUT_IDENTITY_DOMAIN,
          value: fingerprint,
        }),
        configIdentity: Object.freeze({
          domain: ADOPTION_CONFIG_IDENTITY_DOMAIN,
          value: configHash,
        }),
        ...(timeout === undefined
          ? {}
          : {
              timeout: Object.freeze({
                domain: EXECUTION_DURATION_DOMAIN,
                milliseconds: timeout.timeoutMs,
              }),
            }),
      }));
    }

    const pairByEval = new Map<string, CurrentTargetPair>();
    for (const planned of plannedPairs) {
      if (pairByEval.has(planned.pair.evalDef.id)) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-slot-duplicate",
          `Current planning produced duplicate Eval "${planned.pair.evalDef.id}".`,
        ));
      }
      pairByEval.set(planned.pair.evalDef.id, planned);
    }

    const slots: CurrentAdoptionSlot[] = [];
    const seenSlots = new Set<string>();
    for (const evalDef of selection.selectedEvals) {
      const planned = pairByEval.get(evalDef.id);
      if (planned === undefined) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-planning-failed",
          `Current planning omitted selected Eval "${evalDef.id}".`,
        ));
      }
      for (let attempt = 0; attempt < run.attempts; attempt += 1) {
        const identity = yield* currentTargetSlotIdentity({
          experimentId: experiment.id,
          evalId: evalDef.id,
          attempt,
          inputIdentity: planned.inputIdentity,
          configIdentity: planned.configIdentity,
          ...(planned.timeout === undefined ? {} : { timeout: planned.timeout }),
        });
        if (seenSlots.has(identity.slotId)) {
          return yield* Effect.fail(adoptionError(
            "adoption-target-slot-duplicate",
            `Current target produced duplicate Slot "${identity.slotId}".`,
          ));
        }
        seenSlots.add(identity.slotId);
        const targetSlot = Object.freeze({
          slotId: identity.slotId,
          experimentId: experiment.id,
          evalId: evalDef.id,
          attemptOrdinal: identity.attemptOrdinal,
          attempt,
          inputIdentity: planned.inputIdentity,
          configIdentity: planned.configIdentity,
          executionIdentityDigest: identity.executionIdentityDigest,
          ...(planned.timeout === undefined ? {} : { timeout: planned.timeout }),
        });
        slots.push(targetSlot);
      }
    }
    const byKey = new Map<string, CurrentAdoptionSlot>();
    for (const slot of slots) byKey.set(slotKey(slot.evalId, slot.attemptOrdinal), slot);
    const expectedSlots = Object.freeze([...slots]
      .map((slot) => Object.freeze({
        slotId: slot.slotId,
        evalId: Schema.decodeUnknownSync(EvalIdSchema)(slot.evalId),
        attemptOrdinal: slot.attemptOrdinal,
        executionIdentityDigest: slot.executionIdentityDigest,
      }))
      .sort((left, right) => left.slotId < right.slotId ? -1 : left.slotId > right.slotId ? 1 : 0));
    return Object.freeze({
      experimentId: experiment.id,
      startedAt: input.startedAt,
      context,
      expectedSlots,
      slots: Object.freeze([...slots]),
      slotFor: (evalId: string, attempt: number) => byKey.get(slotKey(evalId, attempt)),
    });
  });
}

function sourceCoreInvalid(message: string): ExplicitAdoptionError {
  return adoptionError("adoption-source-core-invalid", message);
}

/** Locates one canonical short locator through the live Record Host session. */
export function resolveExplicitAttemptLocator(
  reader: RecordReadSession,
  text: string,
): Effect.Effect<ResolvedAdoptionAttempt, ExplicitAdoptionReadError> {
  return Effect.gen(function* () {
    const parsed = yield* parseExplicitAttemptLocator(text);
    const selected = yield* reader.selectRuns();
    const resolved = yield* resolveAttemptLocator({
      reader,
      selection: selected,
      locator: parsed.locator,
    });
    if (resolved.kind === "not-found") {
      return yield* Effect.fail(adoptionError(
        "adoption-locator-not-found",
        `No published current-Record Attempt matches locator "${parsed.text}".`,
      ));
    }
    if (resolved.kind === "ambiguous") {
      return yield* Effect.fail(adoptionError(
        "adoption-locator-ambiguous",
        `Locator "${parsed.text}" resolves to more than one immutable Attempt.`,
      ));
    }
    return yield* resolveAdoptionAttempt(reader, resolved.attempt, Object.freeze({
      text: parsed.text,
      locator: parsed.locator,
      attemptId: resolved.attempt.attemptId,
    }));
  });
}

/** Validates the origin anchor and evaluates its source Run/Slot metadata. */
export function resolveAdoptionAttempt(
  reader: RecordReadSession,
  attempt: SelectedAttemptRef,
  locator?: ExplicitAttemptLocator,
): Effect.Effect<ResolvedAdoptionAttempt, ExplicitAdoptionReadError> {
  return Effect.gen(function* () {
    const sourceLocator = locator ?? attemptLocatorFor(attempt.attemptId);
    const selected = yield* reader.selectRuns({ runIds: Object.freeze([attempt.originRunId]) });
    if (selected.runRefs.length !== 1) {
      return yield* Effect.fail(sourceCoreInvalid(
        `Source locator "${sourceLocator.text}" has no readable origin Run.`,
      ));
    }
    const originRun = yield* reader.readRun(selected.runRefs[0]!);
    if (originRun.state !== "available") {
      return yield* Effect.fail(sourceCoreInvalid(
        `Source locator "${sourceLocator.text}" has no readable origin Run.`,
      ));
    }
    const attemptRead = yield* reader.readAttempt(attempt);
    if (attemptRead.state !== "available") {
      return yield* Effect.fail(sourceCoreInvalid(
        `Locator "${sourceLocator.text}" points at a missing or invalid source Attempt.`,
      ));
    }
    const originSlot = originRun.value.document.expectedSlots.find(
      (slot) => slot.slotId === attemptRead.value.document.slotId,
    );
    if (originSlot === undefined) {
      return yield* Effect.fail(sourceCoreInvalid(
        `Source locator "${sourceLocator.text}" has no origin Member.`,
      ));
    }
    const matchingMembers = originRun.value.members.filter((member) =>
      member.attempt !== null
      && member.attempt.originRunId === attempt.originRunId
      && member.attempt.attemptId === attempt.attemptId,
    );
    if (matchingMembers.length !== 1) {
      return yield* Effect.fail(sourceCoreInvalid(
        matchingMembers.length === 0
          ? `Source locator "${sourceLocator.text}" has no origin Member.`
          : `Source origin Run for "${sourceLocator.text}" has duplicate origin Members.`,
      ));
    }
    return Object.freeze({
      locator: sourceLocator,
      attempt,
      origin: Object.freeze({
        runId: originRun.value.document.runId,
        slotId: originSlot.slotId,
        startedAt: originRun.value.document.startedAt,
      }),
      originExperimentId: originRun.value.document.experimentId,
      originEvalId: originSlot.evalId,
      originAttempt: originSlot.attemptOrdinal,
      executionIdentityDigest: originSlot.executionIdentityDigest,
    });
  });
}

export interface AdoptionAttemptFacts {
  readonly outcome: AttemptOutcome;
  readonly verdict: VerdictState;
}

/** Reads the exact Core outcome and its Assertion-derived terminal Verdict together. */
export function readAdoptionAttemptFacts(
  reader: RecordReadSession,
  source: ResolvedAdoptionAttempt,
): Effect.Effect<AdoptionAttemptFacts, ExplicitAdoptionReadError> {
  return Effect.gen(function* () {
    const attempt = yield* reader.readAttempt(source.attempt);
    if (attempt.state !== "available") {
      return yield* Effect.fail(adoptionError(
        "adoption-source-verdict-unavailable",
        "Source Attempt/Core is unavailable.",
      ));
    }
    const assertions = yield* reader.readAssertions(attempt.value.owner);
    if (assertions.state !== "available") {
      const detail = assertions.state === "invalid" ? "invalid" : assertions.state;
      return yield* Effect.fail(adoptionError(
        "adoption-source-verdict-unavailable",
        `Source Assertions is ${detail}.`,
      ));
    }
    const outcome = attempt.value.document.outcome;
    const verdict = foldVerdict({
      execution: outcome === "errored" || outcome === "interrupted"
        ? "errored"
        : "completed",
      explicitlySkipped: outcome === "cancelled",
      assertions: assertions.value.entries.map((entry) => Object.freeze({
        required: entry.policy.requirement.state === "available" && entry.policy.requirement.value === "required",
        result: sealedAssertionResult(entry),
      })),
    });
    return Object.freeze({ outcome, verdict });
  });
}

export function readAdoptionVerdict(
  reader: RecordReadSession,
  source: ResolvedAdoptionAttempt,
): Effect.Effect<VerdictState, ExplicitAdoptionReadError> {
  return readAdoptionAttemptFacts(reader, source).pipe(
    Effect.map((facts) => facts.verdict),
  );
}

/**
 * Timing is a fixed Runner Activity receipt. No missing, partial, or invalid
 * timing collection is eligible for adoption, including an unbounded target.
 */
export function readAdoptionExecutionDuration(
  reader: RecordReadSession,
  source: ResolvedAdoptionAttempt,
): Effect.Effect<DurationLimit, ExplicitAdoptionReadError> {
  return Effect.gen(function* () {
    const attempt = yield* reader.readAttempt(source.attempt);
    if (attempt.state !== "available") {
      return yield* Effect.fail(adoptionError(
        "adoption-source-observability-unavailable",
        `Source timing for locator "${source.locator.text}" has no readable Attempt.`,
      ));
    }
    const activities = yield* reader.readAttemptRunnerActivities(attempt.value.owner);
    if (activities.state !== "available") {
      const detail = activities.state === "invalid" ? "invalid" : activities.state;
      return yield* Effect.fail(adoptionError(
        "adoption-source-observability-unavailable",
        `Source timing for locator "${source.locator.text}" is ${detail}.`,
      ));
    }
    const duration = readAttemptExecutionDuration(activities.value);
    if (duration.state !== "available") {
      return yield* Effect.fail(adoptionError(
        "adoption-source-observability-unavailable",
        `Source timing for locator "${source.locator.text}" is ${duration.reason}.`,
      ));
    }
    return duration.duration;
  });
}

function executionIdentityComparison(input: {
  readonly source: ExecutionIdentityDigest;
  readonly target: ExecutionIdentityDigest;
}): ComparisonProvenance {
  const reason = input.source === input.target
    ? "execution-identity-match"
    : "execution-identity-mismatch";
  return Object.freeze({
    attachment: "core" as const,
    recordedClaim: "execution-identity" as const,
    sourceState: "available" as const,
    result: reason.endsWith("-match") ? "match" as const : "mismatch" as const,
    reason,
  });
}

function durationComparison(input: {
  readonly source: DurationLimit;
  readonly target?: DurationLimit;
}): {
  readonly comparison: ComparisonProvenance;
  readonly failure?: "adoption-duration-domain-mismatch" | "adoption-timeout-exceeded";
} {
  if (input.target === undefined) {
    return Object.freeze({
      comparison: Object.freeze({
        attachment: "niceeval.runner-activities" as const,
        recordedClaim: "execution-duration" as const,
        sourceState: "available" as const,
        result: "match" as const,
        reason: "timeout-unbounded",
      }),
    });
  }
  if (input.source.domain !== input.target.domain) {
    return Object.freeze({
      comparison: Object.freeze({
        attachment: "niceeval.runner-activities" as const,
        recordedClaim: "execution-duration" as const,
        sourceState: "available" as const,
        result: "mismatch" as const,
        reason: "duration-domain-mismatch",
      }),
      failure: "adoption-duration-domain-mismatch",
    });
  }
  if (input.source.milliseconds > input.target.milliseconds) {
    return Object.freeze({
      comparison: Object.freeze({
        attachment: "niceeval.runner-activities" as const,
        recordedClaim: "execution-duration" as const,
        sourceState: "available" as const,
        result: "mismatch" as const,
        reason: "timeout-exceeded",
      }),
      failure: "adoption-timeout-exceeded",
    });
  }
  return Object.freeze({
    comparison: Object.freeze({
      attachment: "niceeval.runner-activities" as const,
      recordedClaim: "execution-duration" as const,
      sourceState: "available" as const,
      result: "match" as const,
      reason: "duration-within-timeout",
    }),
  });
}

/**
 * Builds one accepted reference intent. The Core combined execution identity
 * is compared exactly, but an explicit operator decision may accept a mismatch.
 * The folded Verdict and complete Runner Activity timing remain hard gates.
 */
export function prepareExplicitAdoptionMember(input: {
  readonly reader: RecordReadSession;
  readonly target: CurrentAdoptionTarget;
  readonly source: ResolvedAdoptionAttempt;
  readonly evalId: string;
  readonly attempt: number;
  readonly operatorReason?: string;
}): Effect.Effect<ExplicitAdoptionMember, ExplicitAdoptionReadError> {
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
    const facts = yield* readAdoptionAttemptFacts(input.reader, input.source);
    const verdict = facts.verdict;
    if (facts.outcome !== "completed") {
      return yield* Effect.fail(adoptionError(
        "adoption-source-verdict-ineligible",
        `Source locator "${input.source.locator.text}" has Attempt outcome "${facts.outcome}" and cannot be explicitly adopted.`,
      ));
    }
    if (verdict !== "passed" && verdict !== "failed") {
      return yield* Effect.fail(adoptionError(
        "adoption-source-verdict-ineligible",
        `Source locator "${input.source.locator.text}" has Verdict "${verdict}" and cannot be explicitly adopted.`,
      ));
    }
    const executionDuration = yield* readAdoptionExecutionDuration(
      input.reader,
      input.source,
    );
    const duration = durationComparison({
      source: executionDuration,
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
        attachment: "core" as const,
        recordedClaim: "attempt-outcome" as const,
        sourceState: "available" as const,
        result: "match" as const,
        reason: "attempt-completed",
      }),
      executionIdentityComparison({
        source: input.source.executionIdentityDigest,
        target: target.executionIdentityDigest,
      }),
      Object.freeze({
        attachment: "niceeval.assertions" as const,
        recordedClaim: "assertion-verdict" as const,
        sourceState: "available" as const,
        result: "match" as const,
        reason: "verdict-eligible",
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

/** Validates the exact Core Run denominator before the writer records Members. */
function validateExplicitAdoptionMembers(input: {
  readonly target: CurrentAdoptionTarget;
  readonly members: readonly ExplicitAdoptionMember[];
}): Effect.Effect<void, ExplicitAdoptionError> {
  return Effect.gen(function* () {
    const expected = new Set<string>();
    for (const slot of input.target.expectedSlots) {
      if (expected.has(slot.slotId)) {
        return yield* Effect.fail(adoptionError(
          "adoption-target-slot-duplicate",
          `Current target lists Slot "${slot.slotId}" more than once.`,
        ));
      }
      expected.add(slot.slotId);
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

    const memberBySlot = new Set<string>();
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
      memberBySlot.add(slotId);
    }
    return undefined;
  });
}

/**
 * Performs Core denominator and Member validation before a writer creates a
 * reference Run. This is the batch's no-business-write boundary.
 */
export function buildExplicitAdoptionRunPlan(input: {
  readonly intent: ExplicitAdoptionIntent;
  readonly target: CurrentAdoptionTarget;
  readonly members: readonly ExplicitAdoptionMember[];
}): Effect.Effect<ExplicitAdoptionRunPlan, ExplicitAdoptionError> {
  return Effect.gen(function* () {
    if (input.members.length === 0) {
      return yield* Effect.fail(adoptionError(
        "adoption-target-invalid",
        "Explicit adoption requires at least one reference Member.",
      ));
    }
    yield* validateExplicitAdoptionMembers(input);
    return Object.freeze({
      intent: input.intent,
      target: input.target,
      members: Object.freeze([...input.members]),
    });
  });
}

/** Writes only plans already built from this exact session's Host reader. */
export function commitExplicitAdoptionRunPlans(
  _reader: RecordReadSession,
  root: RecordRoot,
  plans: readonly ExplicitAdoptionRunPlan[],
) {
  return Effect.forEach(
    plans,
    (plan) => Effect.gen(function* () {
      const experimentId = yield* decodeBrandedId(
        ExperimentIdSchema,
        plan.target.experimentId,
        "adoption-target-invalid",
        "Adoption target Experiment",
      );
      const writer = yield* recordHost.current.createReferenceRun({
        root,
        experimentId,
        context: plan.target.context,
        startedAt: plan.target.startedAt,
        expectedSlots: plan.target.expectedSlots,
      });
      const accepted = new Set(plan.members.map((member) => String(member.target.slotId)));
      for (const member of plan.members) {
        yield* writer.recordAcceptedMembership({
          slotId: member.target.slotId,
          attempt: member.source.attempt,
        });
      }
      for (const slot of plan.target.expectedSlots) {
        if (accepted.has(String(slot.slotId))) continue;
        yield* writer.recordTerminalMember({
          slotId: slot.slotId,
          action: "not-dispatched",
        });
      }
      const sealed = yield* writer.seal({ completedAt: plan.target.startedAt });
      return receiptForPlan(plan, sealed.runId);
    }),
    { concurrency: 1 },
  );
}

function receiptForPlan(
  plan: ExplicitAdoptionRunPlan,
  runId: RunId,
): ExplicitAdoptionRunReceipt {
  return Object.freeze({
    experimentId: plan.target.experimentId,
    runId,
    members: Object.freeze(plan.members.map((member) => Object.freeze({
      slotId: member.target.slotId,
      locator: member.locator,
      sourceRunId: member.source.origin.runId,
      attemptId: member.source.attempt.attemptId,
    }))),
  });
}

/** A fresh in-memory invocation identity never enters Record Core. */
export function createExplicitAdoptionInvocationId(
  mint: () => string = randomUUID,
): Effect.Effect<string> {
  return Effect.sync(() => `adoption-${mint()}`);
}

export function adoptionStartedAt(input?: () => string | number): Effect.Effect<UtcMillis, ExplicitAdoptionError> {
  return Effect.sync(() => input?.() ?? Date.now()).pipe(
    Effect.flatMap((value) => {
      const millis = typeof value === "number" ? value : Date.parse(value);
      return utcMillis(millis);
    }),
  );
}

/** Opens a Host read session only; dry callers must use this rather than a writer. */
export function withAdoptionReader<A, E, R>(input: {
  readonly root: RecordRoot;
  readonly use: (
    reader: RecordReadSession,
  ) => Effect.Effect<A, E, R>;
}) {
  return Effect.scoped(
    Effect.gen(function* () {
      const reader = yield* recordHost.current.openRead({ root: input.root });
      return yield* input.use(reader);
    }),
  );
}

/**
 * One Scope keeps the Host reader live while reference Runs are created, so
 * SelectedAttemptRefs remain valid through seal. Discovery still happens
 * before this Scope opens, so the first preflight writes nothing.
 */
export function withAdoptionCommitScope<A, E, R>(input: {
  readonly root: RecordRoot;
  readonly use: (reader: RecordReadSession) => Effect.Effect<A, E, R>;
}) {
  return withAdoptionReader(input);
}

export interface RenameSourceRun {
  readonly runId: RunId;
  readonly experimentId: ExperimentId;
  readonly startedAt: UtcMillis;
  readonly expectedSlots: readonly RecordSlotIdentity[];
}

/**
 * Selects one old Experiment Run without directory-time inference. Multiple
 * matching Runs require the caller to pass an exact RunId.
 */
export function resolveRenameSourceRun(input: {
  readonly reader: RecordReadSession;
  readonly oldId: string;
  readonly sourceRunId?: string;
}): Effect.Effect<RenameSourceRun, ExplicitAdoptionReadError> {
  return Effect.gen(function* () {
    if (input.sourceRunId !== undefined) {
      const runId = yield* decodeBrandedId(
        RunIdSchema,
        input.sourceRunId,
        "adoption-source-run-not-found",
        "Rename source Run",
      );
      const selected = yield* input.reader.selectRuns({ runIds: Object.freeze([runId]) });
      if (selected.runRefs.length !== 1) {
        return yield* Effect.fail(adoptionError(
          "adoption-source-run-not-found",
          `Rename source Run "${input.sourceRunId}" is not a published readable Run.`,
        ));
      }
      const run = yield* input.reader.readRun(selected.runRefs[0]!);
      if (run.state !== "available") {
        return yield* Effect.fail(adoptionError(
          "adoption-source-run-not-found",
          `Rename source Run "${input.sourceRunId}" is not a published readable Run.`,
        ));
      }
      if (run.value.document.experimentId !== input.oldId) {
        return yield* Effect.fail(adoptionError(
          "adoption-source-run-mismatch",
          `Run "${input.sourceRunId}" does not belong to old Experiment "${input.oldId}".`,
        ));
      }
      return Object.freeze({
        runId: run.value.document.runId,
        experimentId: run.value.document.experimentId,
        startedAt: run.value.document.startedAt,
        expectedSlots: run.value.document.expectedSlots,
      });
    }

    const selected = yield* input.reader.selectRuns();
    let first: RenameSourceRun | undefined;
    for (const ref of selected.runRefs) {
      const run = yield* input.reader.readRun(ref);
      if (run.state !== "available") continue;
      if (run.value.document.experimentId !== input.oldId) continue;
      const current = Object.freeze({
        runId: run.value.document.runId,
        experimentId: run.value.document.experimentId,
        startedAt: run.value.document.startedAt,
        expectedSlots: run.value.document.expectedSlots,
      });
      if (first !== undefined) {
        return yield* Effect.fail(adoptionError(
          "adoption-source-run-required",
          `Old Experiment "${input.oldId}" has multiple published Runs; select one exact source RunId.`,
        ));
      }
      first = current;
    }
    if (first === undefined) {
      return yield* Effect.fail(adoptionError(
        "adoption-source-run-not-found",
        `No published source Run belongs to old Experiment "${input.oldId}".`,
      ));
    }
    return first;
  });
}

export interface RenameAdoptionMember {
  readonly evalId: string;
  readonly attempt: number;
  readonly member: ExplicitAdoptionMember;
}

export interface RenameAdoptionExcluded {
  readonly evalId: string;
  readonly attempt: number;
  readonly reason: "source-member-missing" | "target-eval-not-selected" | "target-attempt-not-selected";
}

export interface RenameAdoptionPreflight {
  readonly sourceRun: RenameSourceRun;
  readonly members: readonly RenameAdoptionMember[];
  readonly excluded: readonly RenameAdoptionExcluded[];
}

/**
 * Reads exactly one selected old Run. Source slots omitted by the current
 * target are preview exclusions; every source Member that would be adopted is
 * fully validated before the caller is allowed to create a target Run.
 */
export function prepareRenameAdoptionMembers(input: {
  readonly reader: RecordReadSession;
  readonly oldId: string;
  readonly sourceRun: RenameSourceRun;
  readonly target: CurrentAdoptionTarget;
  readonly operatorReason: string;
}): Effect.Effect<RenameAdoptionPreflight, ExplicitAdoptionReadError> {
  return Effect.gen(function* () {
    if (input.sourceRun.experimentId !== input.oldId) {
      return yield* Effect.fail(adoptionError(
        "adoption-source-run-mismatch",
        `Selected source Run "${input.sourceRun.runId}" does not belong to old Experiment "${input.oldId}".`,
      ));
    }
    const selected = yield* input.reader.selectRuns({
      runIds: Object.freeze([input.sourceRun.runId]),
    });
    if (selected.runRefs.length !== 1) {
      return yield* Effect.fail(sourceCoreInvalid(
        `Selected source Run "${input.sourceRun.runId}" is not a published readable Run.`,
      ));
    }
    const run = yield* input.reader.readRun(selected.runRefs[0]!);
    if (run.state !== "available") {
      return yield* Effect.fail(sourceCoreInvalid(
        `Selected source Run "${input.sourceRun.runId}" is not a published readable Run.`,
      ));
    }

    const members: RenameAdoptionMember[] = [];
    const excluded: RenameAdoptionExcluded[] = [];
    const seenSourceSlots = new Set<string>();
    for (const sourceSlot of input.sourceRun.expectedSlots) {
      const slotId = sourceSlot.slotId;
      if (seenSourceSlots.has(slotId)) {
        return yield* Effect.fail(sourceCoreInvalid(
          `Selected source Run "${input.sourceRun.runId}" repeats Slot "${slotId}".`,
        ));
      }
      seenSourceSlots.add(slotId);
      const attemptOrdinal = sourceSlot.attemptOrdinal;
      const targetSlot = input.target.slotFor(sourceSlot.evalId, attemptOrdinal);
      if (targetSlot === undefined) {
        const selectedEval = input.target.slots.some(
          (slot) => slot.evalId === sourceSlot.evalId,
        );
        excluded.push(Object.freeze({
          evalId: sourceSlot.evalId,
          attempt: attemptOrdinal,
          reason: selectedEval
            ? "target-attempt-not-selected"
            : "target-eval-not-selected",
        }));
        continue;
      }

      const sourceMember = run.value.members.find((member) => member.document.slotId === slotId);
      if (sourceMember === undefined || sourceMember.attempt === null) {
        excluded.push(Object.freeze({
          evalId: sourceSlot.evalId,
          attempt: attemptOrdinal,
          reason: "source-member-missing",
        }));
        continue;
      }
      const source = yield* resolveAdoptionAttempt(input.reader, sourceMember.attempt);
      if (
        source.originEvalId !== sourceSlot.evalId
        || source.originAttempt !== attemptOrdinal
      ) {
        return yield* Effect.fail(sourceCoreInvalid(
          `Selected source Member for ${sourceSlot.evalId}/${String(attemptOrdinal)} does not retain a matching origin Attempt.`,
        ));
      }
      const member = yield* prepareExplicitAdoptionMember({
        reader: input.reader,
        target: input.target,
        source,
        evalId: sourceSlot.evalId,
        attempt: attemptOrdinal,
        operatorReason: input.operatorReason,
      });
      members.push(Object.freeze({
        evalId: sourceSlot.evalId,
        attempt: attemptOrdinal,
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
