/** Explicit whole-Run adoption into a current Experiment, preserving exact origins. */
import { Effect, Result } from "effect";
import type { SandboxPlanningServices } from "../sandbox/plan.ts";
import {
  type AdoptionProject, type AdoptionProjectInput,
  ExplicitAdoptionError, type ExplicitAdoptionFailureCode,
  type ExplicitAdoptionReadError, type ExplicitAdoptionRunPlan,
  type ExplicitAdoptionRunReceipt, type RenameAdoptionPreflight,
  adoptionRecordRoot, adoptionStartedAt, buildExplicitAdoptionRunPlan,
  commitExplicitAdoptionRunPlans, createExplicitAdoptionInvocationId,
  loadAdoptionProject, prepareCurrentAdoptionTarget, prepareWholeRunAdoptionMembers,
  resolveExactAdoptionSourceRun, withAdoptionReader,
} from "./adoption.ts";
import type { Config, DiscoveredEval, DiscoveredExperiment } from "./types.ts";

export type ExperimentRenameReason = ExplicitAdoptionFailureCode;
export interface ExperimentRenameOptions {
  readonly cwd: string;
  readonly sourceRunId: string;
  readonly newId: string;
  readonly config?: Config;
  readonly evals?: readonly DiscoveredEval[];
  readonly experiments?: readonly DiscoveredExperiment[];
  readonly planningServices?: SandboxPlanningServices;
  readonly now?: () => string | number;
  readonly operatorReason?: string;
}
export interface ExperimentRenameMigration {
  readonly evalId: string;
  readonly attempt: number;
  readonly sourceLocator: string;
  readonly targetExperimentId: string;
  readonly fingerprint: string;
}
export interface ExperimentRenamePlan {
  readonly status: "plan";
  readonly sourceRunId: string;
  readonly oldId: string | null;
  readonly newId: string;
  readonly migrations: readonly ExperimentRenameMigration[];
  readonly blocked?: { readonly reason: ExperimentRenameReason; readonly detail: string };
}
export class ExperimentRenameError extends Error {
  readonly name = "ExperimentRenameError";
  constructor(readonly plan: ExperimentRenamePlan) {
    super(plan.blocked!.detail);
  }
  get reason(): ExperimentRenameReason { return this.plan.blocked!.reason; }
}
export interface RenamedAttemptSourceReceipt {
  readonly experimentId: string;
  readonly locator: string;
  readonly originRunId: string;
  readonly attemptId: string;
}
export interface ExperimentRenameDoneEntry {
  readonly evalId: string;
  readonly attempt: number;
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
  readonly sourceRunId: string;
  readonly oldId: string;
  readonly newId: string;
  readonly migrated: readonly ExperimentRenameDoneEntry[];
}
export interface RenamePreflight {
  readonly source: RenameAdoptionPreflight;
  readonly plan: ExplicitAdoptionRunPlan;
}
const explicitError = (code: ExplicitAdoptionFailureCode, message: string) => new ExplicitAdoptionError(code, message);
function projectInput(input: ExperimentRenameOptions): AdoptionProjectInput {
  return {
    cwd: input.cwd,
    ...(input.config === undefined ? {} : { config: input.config }),
    ...(input.evals === undefined ? {} : { evals: input.evals }),
    ...(input.experiments === undefined ? {} : { experiments: input.experiments }),
    ...(input.planningServices === undefined ? {} : { planningServices: input.planningServices }),
  };
}
export function preflightExperimentRename(input: {
  readonly reader: Parameters<typeof resolveExactAdoptionSourceRun>[0]["reader"];
  readonly project: AdoptionProject;
  readonly sourceRun: AwaitedSourceRun;
  readonly newId: string;
  readonly startedAt: Parameters<typeof prepareCurrentAdoptionTarget>[0]["startedAt"];
  readonly operatorReason?: string;
}): Effect.Effect<RenamePreflight, ExplicitAdoptionReadError> {
  return Effect.gen(function* () {
    if (input.sourceRun.experimentId === input.newId) return yield* Effect.fail(explicitError(
      "adoption-source-run-mismatch", "Source and target Experiment identities must differ; use niceeval accept --run for the same Experiment.",
    ));
    const target = yield* prepareCurrentAdoptionTarget({ project: input.project, experimentId: input.newId, startedAt: input.startedAt });
    const source = yield* prepareWholeRunAdoptionMembers({
      intent: "rename", reader: input.reader, sourceRun: input.sourceRun, target,
      operatorReason: input.operatorReason ?? `rename ${input.sourceRun.experimentId} -> ${input.newId}`,
    });
    const plan = yield* buildExplicitAdoptionRunPlan({ intent: "rename", target, members: source.members.map((entry) => entry.member) });
    return Object.freeze({ source, plan });
  });
}
type AwaitedSourceRun = RenameAdoptionPreflight["sourceRun"];
function blockedPlan(input: ExperimentRenameOptions, oldId: string | null, error: ExplicitAdoptionError): ExperimentRenamePlan {
  return Object.freeze({ status: "plan", sourceRunId: input.sourceRunId, oldId, newId: input.newId,
    migrations: Object.freeze([]), blocked: Object.freeze({ reason: error.code, detail: error.message }) });
}
function prepare(input: ExperimentRenameOptions, reader: Parameters<typeof resolveExactAdoptionSourceRun>[0]["reader"], project: AdoptionProject, startedAt: Parameters<typeof prepareCurrentAdoptionTarget>[0]["startedAt"]) {
  return Effect.gen(function* () {
    const source = yield* Effect.result(resolveExactAdoptionSourceRun({ reader, sourceRunId: input.sourceRunId }));
    if (Result.isFailure(source)) {
      if (source.failure instanceof ExplicitAdoptionError) return yield* Effect.fail(new ExperimentRenameError(blockedPlan(input, null, source.failure)));
      return yield* Effect.fail(source.failure);
    }
    return yield* preflightExperimentRename({ reader, project, sourceRun: source.success, newId: input.newId, startedAt,
      ...(input.operatorReason === undefined ? {} : { operatorReason: input.operatorReason }) }).pipe(Effect.mapError((error) =>
      error instanceof ExplicitAdoptionError ? new ExperimentRenameError(blockedPlan(input, source.success.experimentId, error)) : error));
  });
}
export function planExperimentRename(input: ExperimentRenameOptions) {
  return Effect.gen(function* () {
    const root = yield* adoptionRecordRoot({ cwd: input.cwd });
    const startedAt = yield* adoptionStartedAt(input.now);
    const project = yield* loadAdoptionProject(projectInput(input));
    return yield* withAdoptionReader({ root, use: (reader) => prepare(input, reader, project, startedAt).pipe(
      Effect.map((preflight): ExperimentRenamePlan => Object.freeze({ status: "plan", sourceRunId: input.sourceRunId,
        oldId: preflight.source.sourceRun.experimentId, newId: input.newId,
        migrations: Object.freeze(preflight.source.members.map((entry) => Object.freeze({ evalId: entry.evalId, attempt: entry.attempt,
          sourceLocator: entry.member.locator, targetExperimentId: input.newId, fingerprint: entry.member.target.inputIdentity.value }))),
      })),
      Effect.catchIf((error): error is ExperimentRenameError => error instanceof ExperimentRenameError, (error) => Effect.succeed(error.plan)),
    ) });
  });
}
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
  readonly sourceRunId: string;
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
        attempt: entry.attempt,
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
      sourceRunId: input.sourceRunId,
      oldId: input.oldId,
      newId: input.newId,
      migrated: Object.freeze(migrated),
    });
  });
}


/** A formal invocation evaluates and freezes its target once, then publishes the preflighted membership. */
export function renameExperiment(input: ExperimentRenameOptions) {
  return Effect.gen(function* () {
    const root = yield* adoptionRecordRoot({ cwd: input.cwd });
    const startedAt = yield* adoptionStartedAt(input.now);
    const project = yield* loadAdoptionProject(projectInput(input));
    return yield* withAdoptionReader({ root, use: (reader) => Effect.gen(function* () {
      const preflight = yield* prepare(input, reader, project, startedAt);
      const invocationId = yield* createExplicitAdoptionInvocationId();
      const receipt = yield* commitExplicitAdoptionRunPlans(reader, root, invocationId, [preflight.plan]);
      return yield* renamedReceipt({ invocationId, sourceRunId: input.sourceRunId,
        oldId: preflight.source.sourceRun.experimentId, newId: input.newId, preflight, receipt });
    }) });
  });
}
