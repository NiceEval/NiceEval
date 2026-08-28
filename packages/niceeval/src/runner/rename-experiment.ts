/**
 * Experiment rename is explicit Record v1 adoption: one selected old Run is
 * read from a frozen view and its exact Attempts become reference Members of a
 * new current-target Run. No source Attempt, Attachment or legacy result is
 * copied or rewritten.
 */
import { Effect, Result } from "effect";

import type { SandboxPlanningServices } from "../sandbox/plan.ts";
import {
  type AdoptionProjectInput,
  type AdoptionProject,
  ExplicitAdoptionError,
  type ExplicitAdoptionOpenError,
  type ExplicitAdoptionReadError,
  type ExplicitAdoptionRunPlan,
  type ExplicitAdoptionRunReceipt,
  type RenameAdoptionPreflight,
  adoptionRecordRoot,
  adoptionStartedAt,
  buildExplicitAdoptionRunPlan,
  commitExplicitAdoptionRunPlans,
  createExplicitAdoptionInvocationId,
  loadAdoptionProject,
  prepareCurrentAdoptionTarget,
  prepareRenameAdoptionMembers,
  resolveRenameSourceRun,
  withAdoptionCommitScope,
  withAdoptionReader,
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
export interface RenamedAttemptSourceReceipt {
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
  readonly renamedFrom: RenamedAttemptSourceReceipt;
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

export interface RenamePreflight {
  readonly source: RenameAdoptionPreflight;
  readonly plan: ExplicitAdoptionRunPlan;
}

/** All native Record v1 failures before/while the formal publication runs. */
export type ExperimentRenameNativeError =
  | ExplicitAdoptionOpenError;

function explicitError(
  code: ExplicitAdoptionError["code"],
  message: string,
): ExplicitAdoptionError {
  return new ExplicitAdoptionError(code, message);
}

function projectInput(input: ExperimentRenameOptions): AdoptionProjectInput {
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
 * Native Host-reader preflight. It selects one old Run, rebuilds the complete
 * current target for newId, and validates every source Member before any
 * reference Run write may begin.
 */
export function preflightExperimentRename(input: {
  readonly reader: Parameters<typeof resolveRenameSourceRun>[0]["reader"];
  readonly project: AdoptionProject;
  readonly oldId: string;
  readonly newId: string;
  readonly sourceRunId?: string;
  readonly startedAt: Parameters<typeof prepareCurrentAdoptionTarget>[0]["startedAt"];
  readonly operatorReason: string;
}): Effect.Effect<RenamePreflight, ExplicitAdoptionReadError> {
  return Effect.gen(function* () {
    if (input.oldId === input.newId) {
      return yield* Effect.fail(explicitError(
        "adoption-source-run-mismatch",
        "The old and new Experiment identities must differ.",
      ));
    }
    const sourceRun = yield* resolveRenameSourceRun({
      reader: input.reader,
      oldId: input.oldId,
      ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }),
    });
    const target = yield* prepareCurrentAdoptionTarget({
      project: input.project,
      experimentId: input.newId,
      startedAt: input.startedAt,
    });
    const source = yield* prepareRenameAdoptionMembers({
      reader: input.reader,
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
    const plan = yield* buildExplicitAdoptionRunPlan({
      intent: "rename",
      target,
      members: source.members.map((entry) => entry.member),
    });
    return Object.freeze({ source, plan });
  });
}

function planFromPreflight(input: {
  readonly oldId: string;
  readonly newId: string;
  readonly preflight: RenamePreflight;
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

function compatibilityReason(error: ExplicitAdoptionError): ExperimentRenameReason {
  switch (error.code) {
    case "adoption-source-run-not-found":
      return "source-empty";
    case "adoption-target-experiment-not-found":
      return "target-not-found";
    case "adoption-target-planning-failed":
    case "adoption-target-invalid":
      return "artifact-unavailable";
    case "adoption-source-observability-unavailable":
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
  error: ExplicitAdoptionError,
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
  error: ExplicitAdoptionError,
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
    const root = yield* adoptionRecordRoot(input);
    const startedAt = yield* adoptionStartedAt(input.now);
    const project = yield* loadAdoptionProject(projectInput(input));
    const result = yield* Effect.result(withAdoptionReader({
      root,
      use: (reader) => preflightExperimentRename({
        reader,
        project,
        oldId: input.oldId,
        newId: input.newId,
        ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }),
        startedAt,
        operatorReason: defaultOperatorReason(input),
      }),
    }));
    if (Result.isSuccess(result)) {
      return planFromPreflight({
        oldId: input.oldId,
        newId: input.newId,
        preflight: result.success,
      });
    }
    if (result.failure instanceof ExplicitAdoptionError) {
      return blockedPlanFromError(input, result.failure);
    }
    return yield* Effect.fail(result.failure);
  });
}

/**
 * Receipt ordering is an implementation detail of the writer, never rename
 * provenance. Match each published Member through its immutable source
 * locator, then prove the target Slot and source Attempt provenance agree.
 */
function renameMemberReceiptsByLocator(input: {
  readonly preflight: RenamePreflight;
  readonly receipt: ExplicitAdoptionRunReceipt;
}): Effect.Effect<
  ReadonlyMap<string, ExplicitAdoptionRunReceipt["members"][number]>,
  ExplicitAdoptionError
> {
  return Effect.gen(function* () {
    const expectedByLocator = new Map<
      string,
      RenameAdoptionPreflight["members"][number]
    >();
    for (const entry of input.preflight.source.members) {
      if (expectedByLocator.has(entry.member.locator)) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          `Explicit rename preflight repeated source locator "${entry.member.locator}".`,
        ));
      }
      expectedByLocator.set(entry.member.locator, entry);
    }

    const receiptsByLocator = new Map<
      string,
      ExplicitAdoptionRunReceipt["members"][number]
    >();
    for (const memberReceipt of input.receipt.members) {
      if (receiptsByLocator.has(memberReceipt.locator)) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          `Explicit rename publication returned duplicate receipt locator "${memberReceipt.locator}".`,
        ));
      }
      receiptsByLocator.set(memberReceipt.locator, memberReceipt);
    }

    for (const [locator, entry] of expectedByLocator) {
      const memberReceipt = receiptsByLocator.get(locator);
      if (memberReceipt === undefined) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          `Explicit rename publication omitted receipt for source locator "${locator}".`,
        ));
      }
      if (
        memberReceipt.locator !== entry.member.locator
        || memberReceipt.slotId !== entry.member.target.slotId
        || memberReceipt.sourceRunId !== entry.member.source.origin.runId
        || memberReceipt.attemptId !== entry.member.source.attempt.attemptId
      ) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          `Explicit rename publication returned mismatched identity provenance for source locator "${locator}".`,
        ));
      }
    }

    for (const locator of receiptsByLocator.keys()) {
      if (!expectedByLocator.has(locator)) {
        return yield* Effect.fail(explicitError(
          "adoption-provenance-invalid",
          `Explicit rename publication returned unexpected receipt locator "${locator}".`,
        ));
      }
    }
    return receiptsByLocator;
  });
}

function renamedReceipt(input: {
  readonly invocationId: string;
  readonly oldId: string;
  readonly newId: string;
  readonly preflight: RenamePreflight;
  readonly receipt: readonly ExplicitAdoptionRunReceipt[];
}): Effect.Effect<RenamedExperiment, ExplicitAdoptionError> {
  return Effect.gen(function* () {
    const [runReceipt] = input.receipt;
    if (input.receipt.length !== 1 || runReceipt === undefined) {
      return yield* Effect.fail(explicitError(
        "adoption-provenance-invalid",
        "Explicit rename publication did not return exactly one target Run receipt.",
      ));
    }
    if (
      runReceipt.experimentId !== input.newId
      || runReceipt.experimentId !== input.preflight.plan.target.experimentId
    ) {
      return yield* Effect.fail(explicitError(
        "adoption-provenance-invalid",
        "Explicit rename publication returned a receipt for the wrong target Experiment.",
      ));
    }
    const receiptsByLocator = yield* renameMemberReceiptsByLocator({
      preflight: input.preflight,
      receipt: runReceipt,
    });
    const migrated: ExperimentRenameDoneEntry[] = [];
    for (const entry of input.preflight.source.members) {
      const memberReceipt = receiptsByLocator.get(entry.member.locator);
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
          originRunId: entry.member.source.origin.runId,
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
 * Effect-native formal rename. A Host reader preflight occurs first. One
 * later Host read Scope then repeats every decision and publishes the
 * reference Run through createReferenceRun.
 */
export function renameExperiment(input: ExperimentRenameOptions) {
  return Effect.gen(function* () {
    const root = yield* adoptionRecordRoot(input);
    const startedAt = yield* adoptionStartedAt(input.now);
    const resolvedProjectInput = projectInput(input);
    const previewProject = yield* loadAdoptionProject(resolvedProjectInput);
    const initial = yield* Effect.result(withAdoptionReader({
      root,
      use: (reader) => preflightExperimentRename({
        reader,
        project: previewProject,
        oldId: input.oldId,
        newId: input.newId,
        ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }),
        startedAt,
        operatorReason: defaultOperatorReason(input),
      }),
    }));
    if (Result.isFailure(initial)) {
      if (initial.failure instanceof ExplicitAdoptionError) {
        return yield* Effect.fail(renameErrorFor(input, initial.failure));
      }
      return yield* Effect.fail(initial.failure);
    }

    const invocationId = yield* createExplicitAdoptionInvocationId();
    const published = yield* withAdoptionCommitScope({
      root,
      use: (reader) => Effect.gen(function* () {
        const project = yield* loadAdoptionProject(resolvedProjectInput);
        const preflight = yield* preflightExperimentRename({
          reader,
          project,
          oldId: input.oldId,
          newId: input.newId,
          ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }),
          startedAt,
          operatorReason: defaultOperatorReason(input),
        });
        const receipt = yield* commitExplicitAdoptionRunPlans(reader, root, invocationId, [preflight.plan]);
        return yield* renamedReceipt({
          invocationId,
          oldId: input.oldId,
          newId: input.newId,
          preflight,
          receipt,
        });
      }),
    }).pipe(
      Effect.mapError((error) => error instanceof ExplicitAdoptionError
        ? renameErrorFor(input, error)
        : error),
    );
    return published;
  });
}
