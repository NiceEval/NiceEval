/**
 * Experiment rename is explicit Record v1 adoption: one selected old Run is
 * read from a frozen view and its exact Attempts become reference Members of a
 * new current-target Run. No source Attempt, Attachment or legacy result is
 * copied or rewritten.
 */
import { Effect, Either } from "effect";

import type { SandboxPlanningServices } from "../sandbox/plan.ts";
import {
  type AdoptionProjectInputV1,
  type AdoptionProjectV1,
  ExplicitAdoptionErrorV1,
  type ExplicitAdoptionOpenErrorV1,
  type ExplicitAdoptionReadErrorV1,
  type ExplicitAdoptionRunPlanV1,
  type ExplicitAdoptionRunReceiptV1,
  type RenameAdoptionPreflightV1,
  adoptionRecordRootV1,
  adoptionStartedAtV1,
  buildExplicitAdoptionRunPlanV1,
  commitExplicitAdoptionRunPlansV1,
  createExplicitAdoptionInvocationIdV1,
  loadAdoptionProjectV1,
  mapExplicitAdoptionCommitFailureV1,
  prepareCurrentAdoptionTargetV1,
  prepareRenameAdoptionMembersV1,
  resolveRenameSourceRunV1,
  withAdoptionReaderV1,
  withAdoptionWriteSessionV1,
} from "./adoption.ts";
import type {
  Config,
  DiscoveredEval,
  DiscoveredExperiment,
} from "./types.ts";

/** Kept stable only because the current CLI renders these compatibility keys. */
export type ExperimentRenameReason =
  | "source-empty"
  | "target-not-found"
  | "target-has-results"
  | "source-unreadable"
  | "artifact-unavailable"
  | "nothing-to-migrate";

export class ExperimentRenameError extends Error {
  readonly name = "ExperimentRenameError";

  constructor(
    readonly reason: ExperimentRenameReason,
    message: string,
    readonly plan?: ExperimentRenamePlan,
  ) {
    super(message);
  }
}

export interface ExperimentRenameOptions {
  readonly cwd: string;
  readonly oldId: string;
  readonly newId: string;
  readonly recordRoot?: string;
  /** Required when oldId has multiple published Runs; never inferred by time. */
  readonly sourceRunId?: string;
  readonly config?: Config;
  readonly evals?: readonly DiscoveredEval[];
  readonly experiments?: readonly DiscoveredExperiment[];
  readonly planningServices?: SandboxPlanningServices;
  readonly now?: () => string | number;
  /** Stored in accepted membership provenance as the explicit rename reason. */
  readonly operatorReason?: string;
}

export interface ExperimentRenameMigration {
  readonly evalId: string;
  readonly sourceLocator: string;
  readonly targetExperimentId: string;
  readonly fingerprint: string;
}

export interface ExperimentRenameExcluded {
  readonly evalId: string;
  readonly reason: string;
}

export interface ExperimentRenameBlocked {
  readonly reason: ExperimentRenameReason;
  readonly evalId?: string;
  readonly conflictingEvals?: readonly string[];
  readonly detail?: string;
}

export interface ExperimentRenamePlan {
  readonly status: "plan";
  readonly oldId: string;
  readonly newId: string;
  readonly migrations: readonly ExperimentRenameMigration[];
  readonly excluded: readonly ExperimentRenameExcluded[];
  readonly blocked?: ExperimentRenameBlocked;
}

/** A receipt-only replacement for the retired EvalResult. It is never stored. */
export interface RenamedAttemptSourceReceiptV1 {
  readonly experimentId: string;
  readonly locator: string;
  readonly originRunId: string;
  readonly attemptId: string;
}

export interface ExperimentRenameDoneEntry {
  readonly evalId: string;
  readonly sourceLocator: string;
  readonly locator: string;
  readonly fingerprint: string;
  readonly verdict: "passed" | "failed";
  readonly renamedFrom: RenamedAttemptSourceReceiptV1;
}

export interface RenamedExperiment {
  readonly status: "done";
  readonly invocationId: string;
  readonly runId: string;
  readonly oldId: string;
  readonly newId: string;
  readonly snapshotPath: string;
  readonly migrated: readonly ExperimentRenameDoneEntry[];
}

export interface ExperimentRenameRejected {
  readonly status: "rejected";
  readonly oldId: string;
  readonly newId: string;
  readonly reason: ExperimentRenameReason;
  readonly evalId?: string;
  readonly conflictingEvals?: readonly string[];
  readonly detail?: string;
}

export interface RenamePreflightV1 {
  readonly source: RenameAdoptionPreflightV1;
  readonly plan: ExplicitAdoptionRunPlanV1;
}

/** All native Record v1 failures before/while the formal publication runs. */
export type ExperimentRenameNativeErrorV1 =
  | ExplicitAdoptionOpenErrorV1;

function explicitError(
  code: ExplicitAdoptionErrorV1["code"],
  message: string,
): ExplicitAdoptionErrorV1 {
  return new ExplicitAdoptionErrorV1(code, message);
}

function projectInputV1(input: ExperimentRenameOptions): AdoptionProjectInputV1 {
  return {
    cwd: input.cwd,
    ...(input.config === undefined ? {} : { config: input.config }),
    ...(input.evals === undefined ? {} : { evals: input.evals }),
    ...(input.experiments === undefined ? {} : { experiments: input.experiments }),
    ...(input.planningServices === undefined
      ? {}
      : { planningServices: input.planningServices }),
  };
}

function defaultOperatorReason(input: ExperimentRenameOptions): string {
  return input.operatorReason ?? `rename ${input.oldId} -> ${input.newId}`;
}

/**
 * Native frozen-view preflight. It selects one old Run, rebuilds the complete
 * current target for newId, and validates every source Member before any
 * generic writer operation may begin.
 */
export function preflightExperimentRenameV1(input: {
  readonly view: Parameters<typeof resolveRenameSourceRunV1>[0]["view"];
  readonly project: AdoptionProjectV1;
  readonly oldId: string;
  readonly newId: string;
  readonly sourceRunId?: string;
  readonly startedAt: Parameters<typeof prepareCurrentAdoptionTargetV1>[0]["startedAt"];
  readonly operatorReason: string;
}): Effect.Effect<RenamePreflightV1, ExplicitAdoptionReadErrorV1> {
  return Effect.gen(function* () {
    if (input.oldId === input.newId) {
      return yield* Effect.fail(explicitError(
        "adoption-source-run-mismatch",
        "The old and new Experiment identities must differ.",
      ));
    }
    const sourceRun = yield* resolveRenameSourceRunV1({
      view: input.view,
      oldId: input.oldId,
      ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }),
    });
    const target = yield* prepareCurrentAdoptionTargetV1({
      project: input.project,
      experimentId: input.newId,
      startedAt: input.startedAt,
    });
    const source = yield* prepareRenameAdoptionMembersV1({
      view: input.view,
      oldId: input.oldId,
      sourceRun,
      target,
      operatorReason: input.operatorReason,
    });
    if (source.members.length === 0) {
      return yield* Effect.fail(explicitError(
        "adoption-target-invalid",
        `Selected source Run "${sourceRun.runId}" has no Members eligible for explicit rename adoption.`,
      ));
    }
    const plan = yield* buildExplicitAdoptionRunPlanV1({
      intent: "rename",
      target,
      members: source.members.map((entry) => entry.member),
    });
    return Object.freeze({ source, plan });
  });
}

function planFromPreflightV1(input: {
  readonly oldId: string;
  readonly newId: string;
  readonly preflight: RenamePreflightV1;
}): ExperimentRenamePlan {
  return Object.freeze({
    status: "plan",
    oldId: input.oldId,
    newId: input.newId,
    migrations: Object.freeze(input.preflight.source.members.map((entry) => Object.freeze({
      evalId: entry.evalId,
      sourceLocator: entry.member.locator,
      targetExperimentId: input.newId,
      fingerprint: entry.member.target.inputIdentity.value,
    }))),
    excluded: Object.freeze(input.preflight.source.excluded.map((entry) => Object.freeze({
      evalId: entry.evalId,
      reason: entry.reason,
    }))),
  });
}

function compatibilityReason(error: ExplicitAdoptionErrorV1): ExperimentRenameReason {
  switch (error.code) {
    case "adoption-source-run-not-found":
      return "source-empty";
    case "adoption-target-experiment-not-found":
      return "target-not-found";
    case "adoption-target-planning-failed":
    case "adoption-target-invalid":
      return "artifact-unavailable";
    case "adoption-source-eligibility-unavailable":
    case "adoption-source-verdict-unavailable":
    case "adoption-source-verdict-ineligible":
    case "adoption-duration-domain-mismatch":
    case "adoption-timeout-exceeded":
      return "artifact-unavailable";
    default:
      return "source-unreadable";
  }
}

function blockedPlanFromError(
  input: Pick<ExperimentRenameOptions, "oldId" | "newId">,
  error: ExplicitAdoptionErrorV1,
): ExperimentRenamePlan {
  const reason = error.code === "adoption-target-invalid"
    && error.message.includes("no Members eligible")
    ? "nothing-to-migrate"
    : compatibilityReason(error);
  return Object.freeze({
    status: "plan",
    oldId: input.oldId,
    newId: input.newId,
    migrations: Object.freeze([]),
    excluded: Object.freeze([]),
    blocked: Object.freeze({ reason, detail: error.message }),
  });
}

function renameErrorFor(
  input: Pick<ExperimentRenameOptions, "oldId" | "newId">,
  error: ExplicitAdoptionErrorV1,
): ExperimentRenameError {
  const plan = blockedPlanFromError(input, error);
  return new ExperimentRenameError(plan.blocked!.reason, error.message, plan);
}

/**
 * Reader-only CLI compatibility plan. Expected adoption failures are rendered
 * as stable blocked documents; it never opens a writer or creates a Run.
 */
export function planExperimentRename(input: ExperimentRenameOptions) {
  return Effect.gen(function* () {
    const root = yield* adoptionRecordRootV1(input);
    const startedAt = yield* adoptionStartedAtV1(input.now);
    const project = yield* loadAdoptionProjectV1(projectInputV1(input));
    const result = yield* Effect.either(withAdoptionReaderV1({
      root,
      use: (view) => preflightExperimentRenameV1({
        view,
        project,
        oldId: input.oldId,
        newId: input.newId,
        ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }),
        startedAt,
        operatorReason: defaultOperatorReason(input),
      }),
    }));
    if (Either.isRight(result)) {
      return planFromPreflightV1({
        oldId: input.oldId,
        newId: input.newId,
        preflight: result.right,
      });
    }
    if (result.left instanceof ExplicitAdoptionErrorV1) {
      return blockedPlanFromError(input, result.left);
    }
    return yield* Effect.fail(result.left);
  });
}

function renamedReceiptV1(input: {
  readonly invocationId: string;
  readonly oldId: string;
  readonly newId: string;
  readonly preflight: RenamePreflightV1;
  readonly receipt: readonly ExplicitAdoptionRunReceiptV1[];
}): Effect.Effect<RenamedExperiment, ExplicitAdoptionErrorV1> {
  return Effect.gen(function* () {
    const [runReceipt] = input.receipt;
    if (input.receipt.length !== 1 || runReceipt === undefined) {
      return yield* Effect.fail(explicitError(
        "adoption-provenance-invalid",
        "Explicit rename publication did not return exactly one target Run receipt.",
      ));
    }
    if (runReceipt.members.length !== input.preflight.source.members.length) {
      return yield* Effect.fail(explicitError(
        "adoption-provenance-invalid",
        "Explicit rename publication omitted Member receipts.",
      ));
    }
    const migrated: ExperimentRenameDoneEntry[] = [];
    for (const [index, entry] of input.preflight.source.members.entries()) {
      const memberReceipt = runReceipt.members[index];
      if (memberReceipt === undefined) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          "Explicit rename publication omitted one accepted Member receipt.",
        ));
      }
      migrated.push(Object.freeze({
        evalId: entry.evalId,
        sourceLocator: entry.member.locator,
        // A reference has no new Attempt; the exact source locator remains it.
        locator: entry.member.locator,
        fingerprint: entry.member.target.inputIdentity.value,
        verdict: entry.member.verdict,
        renamedFrom: Object.freeze({
          experimentId: input.oldId,
          locator: entry.member.locator,
          originRunId: entry.member.source.origin.run.runId,
          attemptId: entry.member.source.attempt.attemptId,
        }),
      }));
    }
    return Object.freeze({
      status: "done" as const,
      invocationId: input.invocationId,
      runId: runReceipt.runId,
      oldId: input.oldId,
      newId: input.newId,
      snapshotPath: `runs/${runReceipt.runId}`,
      migrated: Object.freeze(migrated),
    });
  });
}

/**
 * Effect-native formal rename. The frozen reader preflight occurs before the
 * writer lock. The one write-session frozen view then repeats every decision
 * before its sole target Run is created and published.
 */
export function renameExperimentV1(input: ExperimentRenameOptions) {
  return Effect.gen(function* () {
    const root = yield* adoptionRecordRootV1(input);
    const startedAt = yield* adoptionStartedAtV1(input.now);
    const projectInput = projectInputV1(input);
    const previewProject = yield* loadAdoptionProjectV1(projectInput);
    const initial = yield* Effect.either(withAdoptionReaderV1({
      root,
      use: (view) => preflightExperimentRenameV1({
        view,
        project: previewProject,
        oldId: input.oldId,
        newId: input.newId,
        ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }),
        startedAt,
        operatorReason: defaultOperatorReason(input),
      }),
    }));
    if (Either.isLeft(initial)) {
      if (initial.left instanceof ExplicitAdoptionErrorV1) {
        return yield* Effect.fail(renameErrorFor(input, initial.left));
      }
      return yield* Effect.fail(initial.left);
    }

    const invocationId = yield* createExplicitAdoptionInvocationIdV1();
    const published = yield* withAdoptionWriteSessionV1({
      root,
      use: (session) => Effect.gen(function* () {
        const project = yield* loadAdoptionProjectV1(projectInput);
        const preflight = yield* preflightExperimentRenameV1({
          view: session.view,
          project,
          oldId: input.oldId,
          newId: input.newId,
          ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }),
          startedAt,
          operatorReason: defaultOperatorReason(input),
        });
        const receipt = yield* commitExplicitAdoptionRunPlansV1(session, [preflight.plan]).pipe(
          Effect.mapError(mapExplicitAdoptionCommitFailureV1),
        );
        return yield* renamedReceiptV1({
          invocationId,
          oldId: input.oldId,
          newId: input.newId,
          preflight,
          receipt,
        });
      }),
    }).pipe(
      Effect.mapError((error) => error instanceof ExplicitAdoptionErrorV1
        ? renameErrorFor(input, error)
        : error),
    );
    return published;
  });
}

/** Current CLI compatibility adapter; native callers should use renameExperimentV1. */
export function renameExperiment(input: ExperimentRenameOptions) {
  return renameExperimentV1(input);
}
