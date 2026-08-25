import { resolve } from "node:path";

import { Clock, Data, Effect, Either } from "effect";

import type { AnalysisSelectionRequest } from "../../analysis/contracts.ts";
import { recordHost } from "../../record/host/index.ts";
import { makeRecordRoot, type RecordRoot } from "../../record/platform/root.ts";
import { acceptLocators } from "../../runner/accept.ts";
import { activateFeedbackSink, type FeedbackSink } from "../../runner/feedback/sink.ts";
import { computeExitCode } from "../../runner/feedback/json.ts";
import { discoverEvals, discoverExperiments } from "../../runner/discover.ts";
import { resolveExperimentEvals, splitByEvaluationKind } from "../../runner/eval-selection.ts";
import { planProjectTarget } from "../../runner/fingerprint.ts";
import {
  prepareRunnerRecordReuse,
  withRunnerCurrentReusePreview,
} from "../../runner/record.ts";
import { projectCurrentReuseReadback } from "../../runner/reuse-readback.ts";
import type { ExecutionReusePlanSlot } from "../../runner/reuse-plan.ts";
import { runEvals } from "../../runner/run.ts";
import { isCaseLockExpired, readCaseLockEffect } from "../../runner/lock.ts";
import { loadProjectCurrent } from "../../runner/project-current.ts";
import { JUnit } from "../../runner/reporters/json.ts";
import {
  listSessions,
  showSession,
  SessionTracker,
} from "../../runner/session.ts";
import {
  linkRunSandboxes,
  recommendedConcurrencyForPreparedPairs,
} from "../../runner/sandbox-selection.ts";
import { resolveRunTimeout } from "../../runner/timeout.ts";
import {
  ExperimentRenameError,
  planExperimentRename,
  renameExperiment,
  type ExperimentRenamePlan as RunnerExperimentRenamePlan,
} from "../../runner/rename-experiment.ts";
import {
  resolveSandboxSetupCache,
  type AgentRun,
  type DiscoveredEval,
  type DiscoveredExperiment,
  type InvocationSummary,
  type SandboxSetupCache,
} from "../../runner/types.ts";
import { evalPrefixPredicate, matchExperimentSelector } from "../../shared/aggregate.ts";
import { ExperimentHostError } from "./types.ts";
import { assembleInvocationCompletion, foldInvocationEvalStats } from "./presentation.ts";

import type {
  ExperimentHostAcceptRequest,
  ExperimentHostAcceptedAttempt,
  ExperimentHostCatalog,
  ExperimentHostCheckRequest,
  ExperimentHostCheckResult,
  ExperimentHostDryComparison,
  ExperimentHostDryPlan,
  ExperimentHostDrySlot,
  ExperimentHostOperation,
  ExperimentHostExperimentSummary,
  ExperimentHostInvocationPlan,
  ExperimentHostInvocationPlanRequest,
  ExperimentHostInvocationPlanResult,
  ExperimentHostInvocationResult,
  ExperimentHostInvocationRunRequest,
  ExperimentHostInvocationShape,
  ExperimentHostInvocationSummary,
  ExperimentHostJsonValue,
  ExperimentHostInvocationStatusList,
  ExperimentHostInvocationStatusListRequest,
  ExperimentHostInvocationStatusShow,
  ExperimentHostInvocationStatusShowRequest,
  ExperimentHostProjectCurrentRequest,
  ExperimentHostProjectCurrentTarget,
  ExperimentHostRenamePlan,
  ExperimentHostRenameRequest,
  ExperimentHostRenameResult,
  ExperimentHostRequirements,
  ExperimentHostRunOverrides,
  ExperimentHostSelectionInput,
  ExperimentHostSelectionProblem,
} from "./types.ts";

function operationError(
  operation: ExperimentHostOperation,
  cause: unknown,
): ExperimentHostError {
  if (cause instanceof ExperimentHostError) return cause;
  const code = typeof cause === "object" && cause !== null && typeof Reflect.get(cause, "code") === "string"
    ? String(Reflect.get(cause, "code"))
    : "experiment-host-operation-failed";
  return new ExperimentHostError({
    operation,
    code,
    message: closedFailureMessage(cause),
  });
}

/** Preserve one actionable message while closing private Runner error shapes. */
function closedFailureMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.length > 0) return cause.message;
  if (typeof cause === "object" && cause !== null) {
    const direct = Reflect.get(cause, "message");
    if (typeof direct === "string" && direct.length > 0) return direct;
    const issue = Reflect.get(cause, "issue");
    if (typeof issue === "object" && issue !== null) {
      const nested = Reflect.get(issue, "message");
      if (typeof nested === "string" && nested.length > 0) return nested;
    }
  }
  return String(cause);
}

function closeOperation<A, E, R>(
  operation: ExperimentHostOperation,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, ExperimentHostError, R> {
  return effect.pipe(Effect.mapError((cause) => operationError(operation, cause)));
}

interface ClosedSelection {
  readonly evals: readonly DiscoveredEval[];
  readonly experimentIds: readonly string[];
  readonly selections: readonly {
    readonly experiment: DiscoveredExperiment;
    readonly selectedEvalIds: readonly string[];
    readonly selectorEvalIds: readonly string[];
  }[];
}

interface PreparedInvocationState {
  readonly evals: readonly DiscoveredEval[];
  readonly runs: readonly AgentRun[];
  readonly config: ExperimentHostInvocationPlanRequest["config"];
  readonly recordRoot: RecordRoot;
  readonly coordinationRoot: string;
  readonly overrides: ExperimentHostRunOverrides;
  readonly shape: ExperimentHostInvocationShape;
  consumed: boolean;
}

class ExperimentEvaluationKindAdmissionError extends Data.TaggedError("ExperimentEvaluationKindAdmissionError")<{
  readonly code: "experiment-evaluation-kind-mixed";
  readonly message: string;
  readonly issues: readonly {
    readonly experimentId: string;
    readonly passEvalIds: readonly string[];
    readonly scoreEvalIds: readonly string[];
  }[];
}> {}

type PreparedRuns =
  | {
      readonly status: "problem";
      readonly selected: ClosedSelection;
      readonly problem: ExperimentHostSelectionProblem;
    }
  | {
      readonly status: "ready";
      readonly selected: ClosedSelection;
      readonly runs: readonly AgentRun[];
    };

const invocationPlans = new WeakMap<object, PreparedInvocationState>();

function freezeArray<A>(values: Iterable<A>): readonly A[] {
  return Object.freeze([...values]);
}

function selectionProblem(
  input: ExperimentHostSelectionInput,
  selected: ClosedSelection,
): ExperimentHostSelectionProblem | undefined {
  if (input.experimentSelector !== undefined && selected.selections.length === 0) {
    return Object.freeze({
      status: "experiment-no-match" as const,
      selector: input.experimentSelector,
      candidates: freezeArray([...selected.experimentIds].sort()),
    });
  }
  const selectorEvalIds = freezeArray(new Set(selected.selections.flatMap((entry) => entry.selectorEvalIds)));
  for (const selector of input.evalSelectors ?? []) {
    if (selectorEvalIds.some((id) => evalPrefixPredicate([selector])(id))) continue;
    return Object.freeze({
      status: "eval-no-match" as const,
      selector,
      experimentIds: freezeArray(selected.selections.map(({ experiment }) => experiment.id)),
      candidates: freezeArray([...selectorEvalIds].sort()),
    });
  }
  if (selected.selections.every((entry) => entry.selectedEvalIds.length === 0)) {
    return Object.freeze({
      status: "empty-selection" as const,
      experimentIds: freezeArray(selected.selections.map(({ experiment }) => experiment.id)),
      candidates: freezeArray([...selected.experimentIds].sort()),
    });
  }
  return undefined;
}

function closeSelection(input: ExperimentHostSelectionInput): Effect.Effect<ClosedSelection, unknown> {
  return Effect.gen(function* () {
    const discovered = yield* discoverEvals(input.cwd);
    const evals = input.tag === undefined
      ? discovered
      : discovered.filter((definition) => definition.tags?.includes(input.tag!));
    const experiments = yield* discoverExperiments(input.cwd);
    const experimentIds = freezeArray(experiments.map((experiment) => experiment.id));
    const selectedIds = input.experimentSelector === undefined
      ? undefined
      : new Set(matchExperimentSelector(experimentIds, input.experimentSelector));
    const selections = experiments
      .filter((experiment) => selectedIds === undefined || selectedIds.has(experiment.id))
      .map((experiment) => {
        const selection = resolveExperimentEvals({
          experimentId: experiment.id,
          selector: experiment.evals,
          cliPatterns: input.evalSelectors ?? [],
          evals,
        });
        return Object.freeze({
          experiment,
          selectedEvalIds: freezeArray(selection.selectedEvalIds),
          selectorEvalIds: freezeArray(selection.selectorEvals.map((definition) => definition.id)),
        });
      });
    return Object.freeze({
      evals: freezeArray(evals),
      experimentIds,
      selections: freezeArray(selections),
    });
  });
}

function summaryOfExperiment(
  experiment: DiscoveredExperiment,
  evalIds: readonly string[],
): ExperimentHostExperimentSummary {
  return Object.freeze({
    id: experiment.id,
    ...(experiment.description === undefined ? {} : { description: experiment.description }),
    agent: experiment.agent.name,
    ...(experiment.model === undefined ? {} : { model: experiment.model }),
    attempts: experiment.attempts ?? 1,
    evalIds: freezeArray(evalIds),
    labels: Object.freeze({ ...(experiment.labels ?? {}) }),
    hasSetup: typeof experiment.setup === "function",
    hasTeardown: typeof experiment.teardown === "function",
    ...(experiment.sharedState === undefined ? {} : { sharedStateKey: experiment.sharedState.key }),
  });
}

export function catalog(
  input: ExperimentHostSelectionInput,
): Effect.Effect<ExperimentHostCatalog, ExperimentHostError> {
  return closeOperation("catalog", closeSelection(input).pipe(Effect.map((selected) => Object.freeze({
    status: "listed" as const,
    evals: freezeArray(selected.evals.map((definition) => Object.freeze({
      id: definition.id,
      ...(definition.description === undefined ? {} : { description: definition.description }),
      tags: freezeArray(definition.tags ?? []),
      evaluationKind: definition.evaluationKind,
    }))),
    experimentIds: selected.experimentIds,
    experiments: freezeArray(selected.selections.map(({ experiment, selectedEvalIds }) =>
      summaryOfExperiment(experiment, selectedEvalIds))),
  }))));
}

function agentRunFromExperiment(
  experiment: DiscoveredExperiment,
  selectedEvalIds: readonly string[],
  config: ExperimentHostInvocationPlanRequest["config"],
  overrides: ExperimentHostRunOverrides,
  sandboxSetupCacheOverride: SandboxSetupCache | undefined,
): AgentRun {
  return Object.freeze({
    agent: experiment.agent,
    model: experiment.model,
    reasoningEffort: experiment.reasoningEffort,
    flags: experiment.flags ?? {},
    plugins: experiment.plugins,
    attempts: overrides.attempts ?? experiment.attempts ?? 1,
    earlyExit: overrides.earlyExit ?? experiment.earlyExit ?? false,
    sandboxSetupCache: resolveSandboxSetupCache(
      sandboxSetupCacheOverride,
      experiment.sandboxCache,
      config.sandboxCache,
    ),
    sandbox: experiment.sandbox,
    sandboxReuse: experiment.sandboxReuse,
    ...(experiment.sharedState === undefined ? {} : { sharedState: experiment.sharedState }),
    judge: experiment.judge,
    ...resolveRunTimeout(overrides.timeoutMs, experiment.timeoutMs),
    budget: overrides.budget ?? experiment.budget,
    selectedEvalIds: freezeArray(selectedEvalIds),
    experimentId: experiment.id,
    experimentBaseDir: experiment.baseDir,
    experimentSourcePath: experiment.sourcePath,
    description: experiment.description,
    labels: experiment.labels,
    maxConcurrency: experiment.maxConcurrency,
    setup: experiment.setup,
    teardown: experiment.teardown,
    classifyFailure: experiment.classifyFailure,
  });
}

function sandboxSetupCacheOverrideOf(
  overrides: ExperimentHostRunOverrides,
): SandboxSetupCache | undefined {
  const value: unknown = Reflect.get(overrides, "sandboxSetupCache");
  if (value === undefined || value === "use" || value === "bypass") return value;
  throw new TypeError("sandboxSetupCache override must be \"use\" or \"bypass\".");
}

function prepareRuns(input: ExperimentHostSelectionInput & {
  readonly config: ExperimentHostInvocationPlanRequest["config"];
  readonly overrides?: ExperimentHostRunOverrides;
}): Effect.Effect<PreparedRuns, unknown> {
  return closeSelection(input).pipe(Effect.flatMap((selected): Effect.Effect<
    PreparedRuns,
    ExperimentEvaluationKindAdmissionError
  > => {
    const problem = selectionProblem(input, selected);
    if (problem !== undefined) return Effect.succeed({ status: "problem", selected, problem } as const);
    const evalsById = new Map(selected.evals.map((definition) => [definition.id, definition]));
    const issues = selected.selections.flatMap(({ experiment, selectedEvalIds }) => {
      const evaluationKinds = splitByEvaluationKind(selectedEvalIds.flatMap((id) => {
        const definition = evalsById.get(id);
        return definition === undefined ? [] : [definition];
      }));
      return evaluationKinds.pass.length === 0 || evaluationKinds.score.length === 0
        ? []
        : [{
            experimentId: experiment.id,
            passEvalIds: Object.freeze([...evaluationKinds.pass]),
            scoreEvalIds: Object.freeze([...evaluationKinds.score]),
          }];
    });
    if (issues.length > 0) {
      return Effect.fail(new ExperimentEvaluationKindAdmissionError({
        code: "experiment-evaluation-kind-mixed",
        message: issues.map((issue) =>
          `Experiment ${JSON.stringify(issue.experimentId)} selects both pass and score Evals. ` +
          `pass (${issue.passEvalIds.length}): ${issue.passEvalIds.join(", ")}; ` +
          `score (${issue.scoreEvalIds.length}): ${issue.scoreEvalIds.join(", ")}. ` +
          "Split the Experiment into one pass Experiment and one score Experiment, or narrow its Eval selection."
        ).join("\n"),
        issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
      }));
    }
    const overrides = input.overrides ?? {};
    const sandboxSetupCacheOverride = sandboxSetupCacheOverrideOf(overrides);
    return Effect.succeed({
      status: "ready",
      selected,
      runs: freezeArray(selected.selections.map(({ experiment, selectedEvalIds }) =>
        agentRunFromExperiment(
          experiment,
          selectedEvalIds,
          input.config,
          overrides,
          sandboxSetupCacheOverride,
        ))),
    } as const);
  }));
}

export function check(
  input: ExperimentHostCheckRequest,
): Effect.Effect<ExperimentHostCheckResult, ExperimentHostError> {
  return closeOperation("check", Effect.gen(function* () {
    const prepared = yield* prepareRuns(input);
    if (prepared.status === "problem") return prepared.problem;
    const pairs = yield* linkRunSandboxes(prepared.selected.evals, prepared.runs);
    return Object.freeze({
      status: "linked" as const,
      experimentIds: freezeArray(prepared.runs.map((run) => run.experimentId!)),
      evalIds: freezeArray(new Set(prepared.runs.flatMap((run) => run.selectedEvalIds))),
      pairCount: pairs.length,
    });
  }));
}

/**
 * Report-facing project-current resolution. Discovery, selection, identity
 * planning, and the resulting watch set close here so a CLI never reaches
 * into Runner to reconstruct the same target.
 */
export function resolveProjectCurrentTarget(
  input: ExperimentHostProjectCurrentRequest,
): Effect.Effect<ExperimentHostProjectCurrentTarget, ExperimentHostError> {
  return closeOperation("resolve-project-current", Effect.gen(function* () {
    const loaded = yield* loadProjectCurrent(input.cwd, {
      config: input.config,
      ...(input.experimentSelectors === undefined ? {} : { experiments: input.experimentSelectors }),
      ...(input.freshImport === undefined ? {} : { freshImport: input.freshImport }),
    });
    const experimentIds = input.experimentSelectors === undefined
      ? undefined
      : freezeArray(new Set(loaded.currentSlots.map((slot) => slot.experimentId)));
    const selection: AnalysisSelectionRequest = Object.freeze({
      policy: "project-current" as const,
      currentSlots: loaded.currentSlots,
      ...(experimentIds === undefined ? {} : { experimentIds }),
    });
    return Object.freeze({
      selection,
      currentSlots: loaded.currentSlots,
      watchInputs: freezeArray(loaded.watchInputs),
    });
  }));
}

/** Session data is intentionally presented as a closed, transient document. */
export function listInvocationStatus(
  input: ExperimentHostInvocationStatusListRequest,
): Effect.Effect<ExperimentHostInvocationStatusList, ExperimentHostError> {
  return closeOperation("invocation-status-list", listSessions(resolve(input.cwd, ".niceeval"), {
    ...(input.all === true ? { all: true } : {}),
    ...(input.experimentSelector === undefined ? {} : { selector: input.experimentSelector }),
  }));
}

export function showInvocationStatus(
  input: ExperimentHostInvocationStatusShowRequest,
): Effect.Effect<ExperimentHostInvocationStatusShow, ExperimentHostError> {
  return closeOperation("invocation-status-show", showSession(
    resolve(input.cwd, ".niceeval"),
    input.invocationSelector,
  ));
}

function recordRoot(input: ExperimentHostInvocationPlanRequest) {
  return makeRecordRoot(resolve(input.cwd, input.recordRoot ?? ".niceeval/record"));
}

function comparisonOf(slot: ExecutionReusePlanSlot): readonly ExperimentHostDryComparison[] {
  return freezeArray(slot.comparisons.map((comparison) => Object.freeze({ ...comparison })));
}

function jsonSnapshot(value: unknown): ExperimentHostJsonValue | undefined {
  try {
    return freezeJson(JSON.parse(JSON.stringify(value)) as ExperimentHostJsonValue);
  } catch {
    return undefined;
  }
}

function freezeJson(value: ExperimentHostJsonValue): ExperimentHostJsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJson));
  if (typeof value === "object" && value !== null) {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, freezeJson(entry)]),
    ));
  }
  return value;
}

function dryPlan(
  slots: readonly ExecutionReusePlanSlot[],
  readbacks: readonly ReturnType<typeof projectCurrentReuseReadback>[],
  lockedPairs: readonly string[],
  evalGroups: ReadonlyMap<string, { readonly id: string; readonly index: number }>,
): ExperimentHostDryPlan {
  const projected: ExperimentHostDrySlot[] = slots.map((slot) => {
    const evalGroup = evalGroups.get(slot.evalId);
    const target = Object.freeze({
      runId: slot.runId,
      slotId: slot.slotId,
      experimentId: slot.experimentId,
      evalId: slot.evalId,
      ...(evalGroup === undefined ? {} : { evalGroupId: evalGroup.id, evalGroupIndex: evalGroup.index }),
      attempt: slot.attempt,
    });
    if (slot.state === "reuse") {
      return Object.freeze({
        state: "reuse" as const,
        target,
        source: Object.freeze({
          attemptId: slot.source.attemptId,
          originRunId: slot.source.origin.runId,
          originSlotId: slot.source.origin.slotId,
          sourceRunId: slot.source.sourceBarrier.runId,
        }),
        comparisons: comparisonOf(slot),
      });
    }
    return Object.freeze({
      state: "gap" as const,
      target,
      reason: slot.reason,
      scope: slot.scope,
      issues: freezeArray(slot.issues.map((issue) => jsonSnapshot(issue) ?? Object.freeze({}))),
      comparisons: comparisonOf(slot),
    });
  });
  return Object.freeze({
    policy: Object.freeze({ name: "project-target" as const, version: 1 as const }),
    slots: freezeArray(projected),
    readbacks: freezeArray(readbacks),
    lockedPairs: freezeArray(lockedPairs),
  });
}

export function planInvocation(
  input: ExperimentHostInvocationPlanRequest,
): Effect.Effect<ExperimentHostInvocationPlanResult, ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation("invocation-plan", Effect.gen(function* () {
    const prepared = yield* prepareRuns(input);
    if (prepared.status === "problem") {
      return Object.freeze({ ...prepared.problem });
    }
    const root = recordRoot(input);
    if (Either.isLeft(root)) return yield* Effect.fail(root.left);
    const config = Object.freeze({
      ...input.config,
      ...(input.config.reporters === undefined
        ? {}
        : { reporters: [...input.config.reporters] }),
    });
    const overrides = Object.freeze({ ...(input.overrides ?? {}) });
    const target = yield* planProjectTarget(
      prepared.selected.evals,
      prepared.runs,
      config.timeoutMs,
      {
        configJudge: config.judge,
        ...(overrides.keepSandbox === undefined ? {} : { keepSandbox: overrides.keepSandbox }),
      },
    );
    const maxConcurrency = overrides.maxConcurrency
      ?? config.maxConcurrency
      ?? recommendedConcurrencyForPreparedPairs([...target.preparedPairsByKey.values()]);
    const maxBuildConcurrency = overrides.maxBuildConcurrency
      ?? config.maxBuildConcurrency
      ?? 2;
    if (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0) {
      return yield* Effect.fail(new Error(`maxConcurrency must be a positive integer, got ${maxConcurrency}.`));
    }
    if (!Number.isInteger(maxBuildConcurrency) || maxBuildConcurrency <= 0) {
      return yield* Effect.fail(new Error(`maxBuildConcurrency must be a positive integer, got ${maxBuildConcurrency}.`));
    }
    const uniqueEvalIds = new Set(prepared.runs.flatMap((run) => run.selectedEvalIds));
    const totalAttempts = prepared.runs.reduce(
      (sum, run) => sum + run.selectedEvalIds.length * run.attempts,
      0,
    );
    const experimentConcurrency = Object.freeze(Object.fromEntries(prepared.runs.flatMap((run) =>
      run.experimentId !== undefined && run.maxConcurrency !== undefined
        ? [[run.experimentId, run.maxConcurrency] as const]
        : [])));
    const shape: ExperimentHostInvocationShape = Object.freeze({
      experiments: prepared.runs.length,
      evals: uniqueEvalIds.size,
      configurations: prepared.runs.length,
      totalAttempts,
      attempts: Math.max(1, ...prepared.runs.map((run) => run.attempts)),
      maxConcurrency,
      maxBuildConcurrency,
      experimentConcurrency,
    });
    const reuse = yield* prepareRunnerRecordReuse({
      evals: prepared.selected.evals,
      runs: prepared.runs,
      config: { timeoutMs: config.timeoutMs },
      plannedFingerprints: target.plannedFingerprints,
      plannedConfigHashes: target.plannedConfigHashes,
      ...(overrides.rerun === undefined ? {} : { rerun: overrides.rerun }),
      ...(overrides.keepSandbox === undefined ? {} : { keepSandbox: overrides.keepSandbox }),
    });
    const previewStartedAt = input.preview === true ? yield* Clock.currentTimeMillis : undefined;
    const preview = previewStartedAt !== undefined
      ? yield* Effect.scoped(withRunnerCurrentReusePreview({
          recordRoot: root.right,
          startedAt: previewStartedAt,
          evals: prepared.selected.evals,
          runs: prepared.runs,
          reuse,
          use: ({ reusePlan, readReadbacks }) => Effect.gen(function* () {
            const readbacks = yield* readReadbacks();
            const now = yield* Clock.currentTimeMillis;
            const pairs = new Map(reusePlan.slots.map((slot) => [
              JSON.stringify([slot.experimentId, slot.evalId]),
              [slot.experimentId, slot.evalId] as const,
            ]));
            const locked = yield* Effect.all([...pairs].map(([key, [experimentId, evalId]]) =>
              readCaseLockEffect(resolve(input.cwd, input.coordinationRoot ?? ".niceeval"), experimentId, evalId).pipe(
                Effect.catchAll(() => Effect.succeed(undefined)),
                Effect.map((record) => record !== undefined && !isCaseLockExpired(record, now) ? key : undefined),
              )), { concurrency: "unbounded" });
            return dryPlan(
              reusePlan.slots,
              readbacks.map(projectCurrentReuseReadback),
              locked.filter((key): key is string => key !== undefined),
              new Map(prepared.selected.evals.flatMap((definition) => definition.evalGroup === undefined
                ? []
                : [[definition.id, {
                    id: definition.evalGroup.id,
                    index: definition.evalGroup.evalIds.indexOf(definition.id),
                  }] as const])),
            );
          }),
        }))
      : undefined;

    const plan = Object.freeze({}) as ExperimentHostInvocationPlan;
    invocationPlans.set(plan, {
      evals: prepared.selected.evals,
      runs: prepared.runs,
      config,
      recordRoot: root.right,
      coordinationRoot: resolve(input.cwd, input.coordinationRoot ?? ".niceeval"),
      overrides,
      shape,
      consumed: false,
    });
    const occurrenceAudits = new Map<string, ExperimentHostJsonValue>();
    for (const pair of target.preparedPairsByKey.values()) {
      for (const occurrence of pair.plugin.occurrences) {
        const audit = jsonSnapshot(occurrence.audit);
        if (audit !== undefined) occurrenceAudits.set(JSON.stringify(audit), audit);
      }
    }
    return Object.freeze({
      status: "ready" as const,
      plan,
      shape,
      experimentIds: freezeArray(prepared.runs.map((run) => run.experimentId!)),
      evalIds: freezeArray(uniqueEvalIds),
      pluginAudit: Object.freeze({ occurrences: freezeArray(occurrenceAudits.values()) }),
      ...(preview === undefined ? {} : { dry: preview }),
    });
  }));
}

function multiplexFeedbackSink(
  feedback: FeedbackSink | undefined,
  session: SessionTracker | undefined,
  isFeedbackStarted: () => boolean,
): FeedbackSink {
  const forward = <A extends unknown[]>(method: (sink: FeedbackSink, ...args: A) => void, ...args: A): void => {
    if (!isFeedbackStarted() || feedback === undefined) return;
    method(feedback, ...args);
  };
  return {
    activity: (detail) => forward((sink, value) => sink.activity(value), detail),
    diagnostic: (input) => forward((sink, value) => sink.diagnostic(value), input),
    interrupted: () => forward((sink) => sink.interrupted()),
    reporterError: (input) => forward((sink, value) => sink.reporterError(value), input),
    failure: (input) => forward((sink, value) => sink.failure(value), input),
    budgetExhausted: (input) => forward((sink, value) => sink.budgetExhausted(value), input),
    kept: (input) => forward((sink, value) => sink.kept(value), input),
    experimentHook: (input) => {
      session?.onInvocationEvent({ type: "experiment-hook", ...input });
      forward((sink, value) => sink.experimentHook(value), input);
    },
    precheck: (input) => forward((sink, value) => sink.precheck(value), input),
    lockWait: (input) => {
      session?.onInvocationEvent({ type: "lock-wait", ...input });
      forward((sink, value) => sink.lockWait(value), input);
    },
    runActivity: (input) => forward((sink, value) => sink.runActivity(value), input),
    experimentProgress: (input) => forward((sink, value) => sink.experimentProgress(value), input),
    lifecycle: (event) => {
      if (
        event.type === "attempt:queued" ||
        event.type === "attempt:start" ||
        event.type === "attempt:complete" ||
        event.type === "attempt:early-exit"
      ) {
        session?.onInvocationEvent(event);
      }
      forward((sink, value) => sink.lifecycle(value), event);
    },
  };
}

function summaryOf(summary: InvocationSummary): ExperimentHostInvocationSummary {
  return Object.freeze({
    total: summary.passed + summary.failed + summary.skipped + summary.errored,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    errored: summary.errored,
    durationMs: summary.durationMs,
    ...(summary.usage?.inputTokens === undefined ? {} : { inputTokens: summary.usage.inputTokens }),
    ...(summary.usage?.outputTokens === undefined ? {} : { outputTokens: summary.usage.outputTokens }),
    ...(summary.estimatedCostUSD === undefined ? {} : { estimatedCostUSD: summary.estimatedCostUSD }),
  });
}

export function runInvocation(
  input: ExperimentHostInvocationRunRequest,
): Effect.Effect<ExperimentHostInvocationResult, ExperimentHostError, ExperimentHostRequirements> {
  return Effect.scoped(closeOperation("invocation-run", Effect.gen(function* () {
    const state = invocationPlans.get(input.plan as object);
    if (state === undefined || state.consumed) {
      return yield* Effect.fail(new Error("Experiment Host invocation plan is forged, copied, or already consumed."));
    }
    state.consumed = true;
    let completedSummary: InvocationSummary | undefined;
    const reporters = [
      ...(input.junitPath === undefined ? [] : [{
        reporter: JUnit(input.junitPath),
        name: "junit",
        required: true,
        target: input.junitPath,
      }]),
      ...(state.config.reporters ?? []).map((reporter, index) => ({
        reporter,
        name: `config-reporter-${index}`,
        required: false,
      })),
      {
        name: "experiment-host-summary",
        required: false,
        reporter: { onInvocationComplete(summary: InvocationSummary) { completedSummary = summary; } },
      },
    ];
    // Session indexing is a Host-owned, project-local observation.  Runner only
    // receives the private tracker mechanism; this enclosing Scope closes its
    // heartbeat worker on success, typed failure, or interruption.
    const session = new SessionTracker(state.coordinationRoot);
    let sessionClosed = false;
    let feedbackStarted = false;
    let feedbackFinished = false;
    yield* Effect.addFinalizer(() => sessionClosed
      ? Effect.void
      : session.close({ status: "incomplete" }).pipe(Effect.ignore));
    yield* Effect.addFinalizer(() => !feedbackStarted || feedbackFinished || input.feedback === undefined
      ? Effect.void
      : Effect.tryPromise({
          try: () => input.feedback!.coordinator.stopDynamic(),
          catch: () => undefined,
        }).pipe(Effect.ignore));
    const feedback = input.feedback?.coordinator;
    const sink = multiplexFeedbackSink(feedback, session, () => feedbackStarted);
    const receipt = yield* Effect.acquireUseRelease(
      Effect.sync(() => activateFeedbackSink(sink)),
      () => runEvals({
        config: state.config,
        evals: state.evals,
        agentRuns: state.runs,
        reporters,
        maxConcurrency: state.shape.maxConcurrency,
        maxBuildConcurrency: state.shape.maxBuildConcurrency,
        coordinationRoot: state.coordinationRoot,
        recordRoot: state.recordRoot,
        ...(state.overrides.keepSandbox === undefined ? {} : { keepSandbox: state.overrides.keepSandbox }),
        ...(state.overrides.rerun === undefined ? {} : { rerun: state.overrides.rerun }),
        session,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
        onCurrentRecordReusePlan: (current) => Effect.sync(() => {
          if (feedback === undefined) return;
          feedback.start({
            shape: Object.freeze({
              evals: state.shape.evals,
              configs: state.shape.configurations,
              totalAttempts: state.shape.totalAttempts,
              maxConcurrency: state.shape.maxConcurrency,
              runIds: current.runIds,
            }),
            ...(Object.keys(state.shape.experimentConcurrency).length === 0
              ? {}
              : { experimentConcurrency: state.shape.experimentConcurrency }),
            reused: current.reused,
            ...(current.reusedFailures.length === 0
              ? {}
              : { reusedFailures: current.reusedFailures }),
          });
          feedbackStarted = true;
        }),
      }),
      (deactivate) => Effect.sync(deactivate),
    );
    const summary = completedSummary;
    if (summary === undefined) {
      return yield* Effect.fail(new Error("Runner completed without an invocation summary."));
    }
    if (feedback !== undefined && !feedbackStarted) {
      return yield* Effect.fail(new Error("Runner completed without starting Experiment feedback."));
    }
    const completion = feedback === undefined
      ? undefined
      : assembleInvocationCompletion(feedback.state);
    yield* session.close({
      status: completion?.status ?? (receipt.completion === "completed"
        ? "complete"
        : receipt.completion === "interrupted"
          ? "interrupted"
          : "incomplete"),
      ...(completion === undefined ? {} : { completion }),
      receipt,
      ...(receipt.completedAt === undefined ? {} : { completedAt: receipt.completedAt }),
    });
    sessionClosed = true;
    if (feedback !== undefined && completion !== undefined) {
      yield* Effect.tryPromise({
        try: () => feedback.finish({ summary, completion, receipt }),
        catch: (cause) => cause,
      });
      feedbackFinished = true;
    }
    const foldedStats = completion === undefined ? undefined : foldInvocationEvalStats(summary);
    return Object.freeze({
      status: "finished" as const,
      receipt: Object.freeze({
        invocationId: receipt.invocationId,
        runIds: freezeArray(receipt.runIds),
        startedAt: receipt.startedAt,
        ...(receipt.completedAt === undefined ? {} : { completedAt: receipt.completedAt }),
        completion: receipt.completion,
      }),
      summary: summaryOf(summary),
      ...(completion === undefined ? {} : {
        completion,
        exitCode: computeExitCode({
          ...summary,
          failed: foldedStats!.failed,
          errored: foldedStats!.errored,
        }, completion),
      }),
    });
  })));
}

function freezeRenamePlan(plan: RunnerExperimentRenamePlan): ExperimentHostRenamePlan {
  return Object.freeze({
    status: "plan",
    oldId: plan.oldId,
    newId: plan.newId,
    migrations: freezeArray(plan.migrations.map((entry) => Object.freeze({ ...entry }))),
    excluded: freezeArray(plan.excluded.map((entry) => Object.freeze({ ...entry }))),
    ...(plan.blocked === undefined ? {} : { blocked: Object.freeze({
      ...plan.blocked,
      ...(plan.blocked.conflictingEvals === undefined
        ? {}
        : { conflictingEvals: freezeArray(plan.blocked.conflictingEvals) }),
    }) }),
  });
}

export function planRename(
  input: ExperimentHostRenameRequest,
): Effect.Effect<ExperimentHostRenamePlan, ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation("rename-plan", planExperimentRename(input).pipe(
    Effect.map(freezeRenamePlan),
  ));
}

export function applyRename(
  input: ExperimentHostRenameRequest,
): Effect.Effect<ExperimentHostRenameResult, ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation("rename-apply", Effect.gen(function* () {
    const outcome = yield* Effect.either(renameExperiment(input));
    if (Either.isLeft(outcome)) {
      if (!(outcome.left instanceof ExperimentRenameError)) return yield* Effect.fail(outcome.left);
      return Object.freeze({
        status: "rejected" as const,
        oldId: input.oldId,
        newId: input.newId,
        reason: outcome.left.reason,
        ...(outcome.left.plan?.blocked?.evalId === undefined ? {} : { evalId: outcome.left.plan.blocked.evalId }),
        ...(outcome.left.plan?.blocked?.conflictingEvals === undefined
          ? {}
          : { conflictingEvals: freezeArray(outcome.left.plan.blocked.conflictingEvals) }),
        ...(outcome.left.message === "" ? {} : { detail: outcome.left.message }),
      }) satisfies ExperimentHostRenameResult;
    }
    const done = outcome.right;
    return Object.freeze({
      status: "done" as const,
      invocationId: done.invocationId,
      runId: done.runId,
      snapshotPath: done.snapshotPath,
      oldId: done.oldId,
      newId: done.newId,
      migrated: freezeArray(done.migrated.map((entry) => Object.freeze({
        evalId: entry.evalId,
        sourceLocator: entry.sourceLocator,
        locator: entry.locator,
        fingerprint: entry.fingerprint,
        verdict: entry.verdict,
      }))),
    }) satisfies ExperimentHostRenameResult;
  }));
}

export function accept(
  input: ExperimentHostAcceptRequest,
): Effect.Effect<readonly ExperimentHostAcceptedAttempt[], ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation("accept", acceptLocators(input).pipe(
    Effect.map((receipts) => freezeArray(receipts.map((receipt) => Object.freeze({
    invocationId: receipt.invocationId,
    runId: receipt.runId,
    slotId: receipt.slotId,
    locator: receipt.locator,
    sourceLocator: receipt.sourceLocator,
    fingerprint: receipt.fingerprint,
  })))),
  ));
}
