import type { ExperimentHostRequirements } from "./requirements.ts";
import { getExperimentExecutionSource } from "../../runner/experiment-modules.ts";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { decodeJsonValue } from "../../shared/json-value.ts";

import { Clock, Effect, Exit, Result } from "effect";

import { makeRecordRoot, recordRootPaths, type RecordRoot } from "../../record/platform/root.ts";
import { SqliteRecordError } from "../../record/sqlite/errors.ts";
import {
  closeRecordDatabase,
  openRecordReader,
  recordSqlitePath,
  validateExactSchema,
} from "../../record/sqlite/database.ts";
import { readStateOrigins } from "../../record/sqlite/state-repository.ts";
import type { StateLineage } from "../../state/protocol.ts";
import { ProjectStateDatabase } from "../../record/sqlite/project-state-database.ts";
import { acceptLocators, acceptRun, planAcceptRun, planAcceptLocators } from "../../runner/accept.ts";
import { activateFeedbackSink, type FeedbackSink } from "../../runner/feedback/sink.ts";
import { computeExitCode } from "../../runner/feedback/json.ts";
import { discoverEvals, discoverExperimentSelection } from "../../runner/discover.ts";
import { acquireFreshImportGeneration, type FreshImportGeneration } from "../../fresh-import.ts";
import { resolveExperimentEvals, splitByEvaluationKind } from "../../runner/eval-selection.ts";
import { planProjectTarget, type ProjectTargetPlan } from "../../runner/fingerprint.ts";
import { prepareRunnerRecordReuse, withRunnerCurrentReusePreview } from "../../runner/record.ts";
import { projectCurrentReuseReadback } from "../../runner/reuse-readback.ts";
import { projectTargetPolicyIdentity, type ExecutionReusePlanSlot } from "../../runner/reuse-plan.ts";
import { runEvals } from "../../runner/run.ts";
import { readCaseLockEffect } from "../../runner/lock.ts";
import { exactProcessState } from "../../runner/node-process-identity.ts";
import { JUnit } from "../../runner/reporters/json.ts";
import { listSessions, showSession, SessionTracker } from "../../runner/session.ts";
import { linkRunSandboxes, recommendedConcurrencyForPreparedPairs } from "../../runner/sandbox-selection.ts";
import { resolveRunTimeout } from "../../runner/timeout.ts";
import { ExperimentRenameError, planExperimentRename, renameExperiment } from "../../runner/rename-experiment.ts";
import {
  resolveSandboxBeforeCache,
  type AgentRun,
  type DiscoveredEval,
  type DiscoveredExperiment,
  type InvocationSummary,
  type SandboxBeforeCache,
} from "../../runner/types.ts";
import { evalPrefixPredicate, experimentOptionValues, matchExperimentSelector } from "../../shared/aggregate.ts";
import { ExperimentEvaluationKindAdmissionError, ExperimentHostError, normalizeExperimentHostCause } from "./types.ts";
import { assembleInvocationCompletion, foldInvocationEvalStats } from "./presentation.ts";
import { firstLine, formatThrown } from "../../util.ts";

import type {
  ExperimentHostCause,
  ExperimentHostAcceptRequest,
  ExperimentHostAcceptRunPlan,
  ExperimentHostAcceptRunRequest,
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
  ExperimentHostRenamePlan,
  ExperimentHostRenameRequest,
  ExperimentHostRenameResult,
  ExperimentHostRunOverrides,
  ExperimentHostSelectionInput,
  ExperimentHostSelectionProblem,
} from "./types.ts";

export function operationError(operation: ExperimentHostOperation, cause: unknown): ExperimentHostError {
  if (cause instanceof ExperimentHostError) return cause;
  const typedCause = normalizeExperimentHostCause(cause);
  return new ExperimentHostError({
    operation,
    code: closedFailureCode(typedCause),
    message: closedFailureMessage(typedCause),
    cause: typedCause,
    comparisons: "comparisons" in typedCause ? typedCause.comparisons : undefined,
  });
}

function closedFailureCode(cause: ExperimentHostCause): string {
  if ("code" in cause && cause.code === "runner-session-open-failed")
    return closedFailureCode(normalizeExperimentHostCause(cause.cause));
  if ("code" in cause) {
    if (typeof cause.code === "string") return cause.code;
    if (cause.code._tag === "Present" && typeof cause.code.value === "string") return cause.code.value;
  }
  return "experiment-host-operation-failed";
}

/** Preserve one actionable message from the classified Runner failure. */
function closedFailureMessage(cause: ExperimentHostCause): string {
  if ("code" in cause && cause.code === "runner-session-open-failed")
    return closedFailureMessage(normalizeExperimentHostCause(cause.cause));
  const diagnostic = closedRecordDiagnostic(cause);
  if (diagnostic !== undefined) return JSON.stringify(diagnostic);
  if ("message" in cause && cause.message.length > 0) return cause.message;
  if ("issue" in cause && "message" in cause.issue && cause.issue.message.length > 0) return cause.issue.message;
  return firstLine(formatThrown(cause));
}

function closedRecordDiagnostic(cause: ExperimentHostCause): ExperimentHostJsonValue | undefined {
  if (!("code" in cause)) return undefined;
  switch (cause.code) {
    case "runner-record-target-identity-invalid":
      return { code: cause.code, kind: cause.kind, value: cause.value };
    case "runner-record-attempt-publication-failed": {
      const nested = closedRecordDiagnostic(cause.cause) ?? closedDiagnosticMessage(cause.cause);
      return {
        code: cause.code,
        locator: cause.locator,
        ...(nested === undefined ? {} : { cause: nested }),
      };
    }
    case "record-attachment-encode-error":
      return {
        code: cause.code,
        family: cause.family,
        issues: cause.issues.map(({ code, path }) => ({ code, path })),
        schemaIssues: cause.schemaIssues.map(({ path, message }) => ({ path, message })),
      };
    default:
      return undefined;
  }
}

function closedDiagnosticMessage(cause: ExperimentHostCause): Readonly<{ message: string }> | undefined {
  if (!("message" in cause) || cause.message.length === 0) return undefined;
  return { message: cause.message };
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
  readonly experimentEntries: readonly { readonly id: string; readonly path: string }[];
  readonly selections: readonly {
    readonly experiment: DiscoveredExperiment;
    readonly selectedEvalIds: readonly string[];
    readonly selectorEvalIds: readonly string[];
  }[];
}

interface PreparedInvocationState {
  readonly cwd: string;
  readonly evals: readonly DiscoveredEval[];
  readonly runs: readonly AgentRun[];
  readonly config: ExperimentHostInvocationPlanRequest["config"];
  readonly recordRoot: RecordRoot;
  readonly coordinationRoot: string;
  readonly overrides: ExperimentHostRunOverrides;
  readonly shape: ExperimentHostInvocationShape;
  consumed: boolean;
}

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

function selectionProblem(
  input: ExperimentHostSelectionInput,
  selected: ClosedSelection,
): ExperimentHostSelectionProblem | undefined {
  if (input.experimentIds !== undefined) {
    const missing = input.experimentIds.find(
      (value) =>
        !selected.experimentEntries.some(({ id, path }) =>
          value.endsWith("/") ? path.startsWith(value) : id === value,
        ),
    );
    if (missing !== undefined) {
      return {
        status: "experiment-no-match" as const,
        selector: missing,
        candidates: experimentOptionValues(selected.experimentEntries),
      };
    }
  }
  if (input.experimentSelector !== undefined && selected.selections.length === 0) {
    return {
      status: "experiment-no-match" as const,
      selector: input.experimentSelector,
      candidates: experimentOptionValues(selected.experimentEntries),
    };
  }
  const selectorEvalIds = [...new Set(selected.selections.flatMap((entry) => entry.selectorEvalIds))];
  for (const selector of input.evalSelectors ?? []) {
    if (selectorEvalIds.some((id) => evalPrefixPredicate([selector])(id))) continue;
    return {
      status: "eval-no-match" as const,
      selector,
      experimentIds: selected.selections.map(({ experiment }) => experiment.id),
      candidates: [...selectorEvalIds].sort(),
    };
  }
  if (selected.selections.every((entry) => entry.selectedEvalIds.length === 0)) {
    return {
      status: "empty-selection" as const,
      experimentIds: selected.selections.map(({ experiment }) => experiment.id),
      candidates: [...selected.experimentIds].sort(),
    };
  }
  return undefined;
}

function closeSelection(
  input: ExperimentHostSelectionInput,
  exactCurrentIds?: ReadonlySet<string>,
): Effect.Effect<ClosedSelection, unknown> {
  const selectWith = (generation?: FreshImportGeneration) =>
    Effect.gen(function* () {
      if (
        input.experimentIds !== undefined &&
        (input.experimentIds.length === 0 || input.experimentSelector !== undefined)
      ) {
        return yield* Effect.fail(
          new TypeError("experimentIds must be non-empty and cannot be combined with experimentSelector"),
        );
      }
      const discovered = yield* discoverEvals(input.cwd, { freshImport: undefined, generation });
      const evals =
        input.tag === undefined ? discovered : discovered.filter((definition) => definition.tags?.includes(input.tag!));
      const selectedIdsInput = input.experimentIds;
      const selectorInput = input.experimentSelector;
      function select(
        ids: readonly string[],
        entries: readonly { readonly id: string; readonly path: string }[],
      ): readonly string[] {
        if (exactCurrentIds !== undefined) return ids.filter((id) => exactCurrentIds.has(id));
        if (selectedIdsInput !== undefined) {
          const matches = selectedIdsInput.map((value) =>
            entries.filter(({ id, path }) => (value.endsWith("/") ? path.startsWith(value) : id === value)),
          );
          // A missing option rejects the entire selection before any Experiment import.
          if (matches.some((group) => group.length === 0)) return [];
          return [...new Set(matches.flat().map(({ id }) => id))];
        }
        if (selectorInput === undefined) return ids;
        return matchExperimentSelector(ids, selectorInput, entries);
      }
      const { experiments, experimentIds, entries } = yield* discoverExperimentSelection(input.cwd, {
        freshImport: undefined,
        generation,
        select,
      });
      const selections = experiments.map((experiment) => {
        const selection = resolveExperimentEvals({
          experimentId: experiment.id,
          models: experiment.models,
          tag: input.tag,
          selector: experiment.evals,
          cliPatterns: input.evalSelectors ?? [],
          evals: discovered,

          validateModelRequirements: undefined,
        });
        return {
          experiment,
          selectedEvalIds: selection.selectedEvalIds,
          selectorEvalIds: selection.selectorEvals.map((definition) => definition.id),
        };
      });
      return {
        evals,
        experimentIds,
        experimentEntries: entries,
        selections,
      };
    });
  return Effect.scoped(acquireFreshImportGeneration(input.cwd).pipe(Effect.flatMap(selectWith)));
}

function summaryOfExperiment(
  experiment: DiscoveredExperiment,
  evalIds: readonly string[],
): ExperimentHostExperimentSummary {
  return {
    id: experiment.id,
    description: experiment.description,
    adapter: experiment.adapter?.name ?? null,
    models: experiment.models,
    model: experiment.model,
    attempts: experiment.attempts ?? 1,
    evalIds,
    labels: { ...(experiment.labels ?? {}) },
    hasBefore: typeof experiment.before === "function",
    hasAfter: typeof experiment.after === "function",
    sharedStateKey: experiment.sharedState?.key,
  };
}

export function catalog(
  input: ExperimentHostSelectionInput,
): Effect.Effect<ExperimentHostCatalog, ExperimentHostError> {
  return closeOperation(
    "catalog",
    closeSelection(input).pipe(
      Effect.map((selected) => ({
        status: "listed" as const,
        evals: selected.evals.map((definition) => ({
          id: definition.id,
          description: definition.description,
          tags: definition.tags ?? [],
          evaluationKind: definition.evaluationKind,
        })),
        experimentIds: selected.experimentIds,
        experiments: selected.selections.map(({ experiment, selectedEvalIds }) =>
          summaryOfExperiment(experiment, selectedEvalIds),
        ),
      })),
    ),
  );
}

function agentRunFromExperiment(
  experiment: DiscoveredExperiment,
  selectedEvalIds: readonly string[],
  config: ExperimentHostInvocationPlanRequest["config"],
  overrides: ExperimentHostRunOverrides,
  sandboxBeforeCacheOverride: SandboxBeforeCache | undefined,
): AgentRun {
  return {
    adapter: experiment.adapter,
    agent: experiment.adapter?.kind === "custom" ? undefined : experiment.adapter,
    models: experiment.models,
    model: experiment.model,
    reasoningEffort: experiment.reasoningEffort,
    flags: experiment.flags ?? {},
    plugins: experiment.plugins,
    pluginBehavior: undefined,
    attempts: overrides.attempts ?? experiment.attempts ?? 1,
    earlyExit: overrides.earlyExit ?? experiment.earlyExit ?? false,
    sandboxBeforeCache: resolveSandboxBeforeCache(
      sandboxBeforeCacheOverride,
      experiment.sandboxCache,
      config.sandboxCache,
    ),
    sandbox: experiment.sandbox,
    sandboxReuse: experiment.sandboxReuse,
    sandboxLabels: experiment.sandboxLabels,
    sharedState: experiment.sharedState,
    state: experiment.state,
    judge: experiment.judge,
    ...resolveRunTimeout(overrides.timeoutMs, experiment.timeoutMs),
    budget: overrides.budget ?? experiment.budget,
    selectedEvalIds,
    experimentId: experiment.id,
    experimentBaseDir: experiment.baseDir,
    experimentSourcePath: experiment.sourcePath,
    experimentExecutionSource: getExperimentExecutionSource(experiment, config),
    description: experiment.description,
    labels: experiment.labels,
    maxConcurrency: experiment.maxConcurrency,
    setup: experiment.before,
    teardown: experiment.after,
  };
}

function sandboxBeforeCacheOverrideOf(overrides: ExperimentHostRunOverrides): SandboxBeforeCache | undefined {
  const value: unknown = Reflect.get(overrides, "sandboxBeforeCache");
  if (value === undefined || value === "use" || value === "bypass") return value;
  throw new TypeError('sandboxBeforeCache override must be "use" or "bypass".');
}

export function prepareRuns(
  input: ExperimentHostSelectionInput & {
    readonly config: ExperimentHostInvocationPlanRequest["config"];
    readonly overrides?: ExperimentHostRunOverrides | undefined;
  },
  options: {
    readonly allowEmptySelection: boolean;
    readonly freshImport: boolean;
    readonly exactCurrentIds?: ReadonlySet<string> | undefined;
  } = {
    allowEmptySelection: false,
    freshImport: false,
  },
): Effect.Effect<PreparedRuns, unknown> {
  return closeSelection(input, options.exactCurrentIds).pipe(
    Effect.flatMap((selected): Effect.Effect<PreparedRuns, ExperimentEvaluationKindAdmissionError> => {
      const problem = selectionProblem(input, selected);
      if (problem !== undefined && !(options.allowEmptySelection === true && problem.status === "empty-selection")) {
        return Effect.succeed({ status: "problem", selected, problem } as const);
      }
      const evalsById = new Map(selected.evals.map((definition) => [definition.id, definition]));
      const issues = selected.selections.flatMap(({ experiment, selectedEvalIds }) => {
        const evaluationKinds = splitByEvaluationKind(
          selectedEvalIds.flatMap((id) => {
            const definition = evalsById.get(id);
            return definition === undefined ? [] : [definition];
          }),
        );
        return evaluationKinds.pass.length === 0 || evaluationKinds.score.length === 0
          ? []
          : [
              {
                experimentId: experiment.id,
                passEvalIds: evaluationKinds.pass,
                scoreEvalIds: evaluationKinds.score,
              },
            ];
      });
      if (issues.length > 0) {
        return Effect.fail(
          new ExperimentEvaluationKindAdmissionError({
            code: "experiment-evaluation-kind-mixed",
            message: issues
              .map(
                (issue) =>
                  `Experiment ${JSON.stringify(issue.experimentId)} selects both pass and score Evals. ` +
                  `pass (${issue.passEvalIds.length}): ${issue.passEvalIds.join(", ")}; ` +
                  `score (${issue.scoreEvalIds.length}): ${issue.scoreEvalIds.join(", ")}. ` +
                  "Split the Experiment into one pass Experiment and one score Experiment, or narrow its Eval selection.",
              )
              .join("\n"),
            issues,
          }),
        );
      }
      const overrides = input.overrides ?? {};
      const sandboxBeforeCacheOverride = sandboxBeforeCacheOverrideOf(overrides);
      return Effect.succeed({
        status: "ready",
        selected,
        runs: selected.selections.map(({ experiment, selectedEvalIds }) =>
          agentRunFromExperiment(experiment, selectedEvalIds, input.config, overrides, sandboxBeforeCacheOverride),
        ),
      } as const);
    }),
  );
}

export function check(
  input: ExperimentHostCheckRequest,
): Effect.Effect<ExperimentHostCheckResult, ExperimentHostError> {
  return closeOperation(
    "check",
    Effect.gen(function* () {
      const prepared = yield* prepareRuns(input);
      if (prepared.status === "problem") return prepared.problem;
      const pairs = yield* linkRunSandboxes(prepared.selected.evals, prepared.runs, input.cwd);
      return {
        status: "linked" as const,
        experimentIds: prepared.runs.map((run) => run.experimentId!),
        evalIds: [...new Set(prepared.runs.flatMap((run) => run.selectedEvalIds))],
        pairCount: pairs.length,
      };
    }),
  );
}

/** Session data is intentionally presented as a closed, transient document. */
export function listInvocationStatus(
  input: ExperimentHostInvocationStatusListRequest,
): Effect.Effect<ExperimentHostInvocationStatusList, ExperimentHostError, ProjectStateDatabase> {
  return closeOperation(
    "invocation-status-list",
    listSessions(resolve(input.cwd, ".niceeval"), {
      all: input.all ?? false,
      selector: input.experimentSelector,
      nowMs: undefined,
    }),
  );
}

export function showInvocationStatus(
  input: ExperimentHostInvocationStatusShowRequest,
): Effect.Effect<ExperimentHostInvocationStatusShow, ExperimentHostError, ProjectStateDatabase> {
  return closeOperation(
    "invocation-status-show",
    showSession(resolve(input.cwd, ".niceeval"), input.invocationSelector),
  );
}

function recordRoot(input: ExperimentHostInvocationPlanRequest) {
  // An ordinary Invocation is always anchored to its discovered project. A
  // Query/view source selection belongs to Inspection and can never be
  // promoted to the live writer through this request.
  return makeRecordRoot(resolve(input.cwd, ".niceeval"));
}

function comparisonOf(slot: ExecutionReusePlanSlot): readonly ExperimentHostDryComparison[] {
  return slot.comparisons;
}

function jsonSnapshot(value: unknown): ExperimentHostJsonValue | undefined {
  try {
    return decodeJsonValue(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function dryPlan(
  slots: readonly ExecutionReusePlanSlot[],
  readbacks: readonly ReturnType<typeof projectCurrentReuseReadback>[],
  lockedPairs: readonly string[],
  recoverablePairs: readonly string[],
  evalGroups: ReadonlyMap<string, { readonly id: string; readonly index: number }>,
  stateGroups: ExperimentHostDryPlan["groups"],
): ExperimentHostDryPlan {
  const projected: ExperimentHostDrySlot[] = slots.map((slot) => {
    const evalGroup = evalGroups.get(slot.evalId);
    const target = {
      runId: slot.runId,
      slotId: slot.slotId,
      experimentId: slot.experimentId,
      evalId: slot.evalId,
      executionIdentityDigest: slot.executionIdentityDigest,
      evalGroup,
      attempt: slot.attempt,
    };
    if (slot.state === "reuse") {
      return {
        state: "reuse" as const,
        target,
        source: {
          attemptId: slot.source.attemptId,
          originRunId: slot.source.origin.runId,
          originSlotId: slot.source.origin.slotId,
          sourceRunId: slot.source.sourceBarrier.runId,
        },
        comparisons: comparisonOf(slot),
      };
    }
    return {
      state: "gap" as const,
      target,
      reason: slot.reason,
      scope: slot.scope,
      issues: slot.issues.map((issue) => jsonSnapshot(issue) ?? {}),
      comparisons: comparisonOf(slot),
    };
  });
  return {
    groups: stateGroups,
    policy: projectTargetPolicyIdentity,
    slots: projected,
    readbacks,
    lockedPairs,
    recoverablePairs,
  };
}

function dryStateGroups(root: string, target: ProjectTargetPlan) {
  const groups = new Map<string, { experimentId: string; evalGroupId: string; lineages: readonly StateLineage[] }>();
  for (const [key, pair] of target.preparedPairsByKey) {
    const evalGroupId = pair.evalDef.evalGroup?.id;
    if (evalGroupId === undefined) continue;
    const experimentId = pair.run.experimentId;
    groups.set(JSON.stringify([experimentId, evalGroupId]), {
      experimentId,
      evalGroupId,
      lineages: target.stateByPair.get(key)?.bindings.map(({ lineage }) => lineage) ?? [],
    });
  }
  return Effect.try({
    try: (): ExperimentHostDryPlan["groups"] => {
      const path = recordSqlitePath(root);
      if (![...groups.values()].some(({ lineages }) => lineages.length > 0) || !existsSync(path)) {
        return [...groups.values()].map(({ experimentId, evalGroupId, lineages }) => ({
          experimentId,
          evalGroupId,
          state: lineages.map((lineage) => ({ lineage, origin: { kind: "fresh" } })),
        }));
      }
      const reader = openRecordReader(path);
      try {
        reader.db.exec("BEGIN");
        validateExactSchema(reader);
        return [...groups.values()].map(({ experimentId, evalGroupId, lineages }) => ({
          experimentId,
          evalGroupId,
          state: readStateOrigins(reader, lineages),
        }));
      } finally {
        closeRecordDatabase(reader);
      }
    },
    catch: (cause) => cause,
  });
}

export function planInvocation(
  input: ExperimentHostInvocationPlanRequest,
): Effect.Effect<ExperimentHostInvocationPlanResult, ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation(
    "invocation-plan",
    Effect.gen(function* () {
      const prepared = yield* prepareRuns(input);
      if (prepared.status === "problem") {
        return prepared.problem;
      }
      const root = recordRoot(input);
      if (Result.isFailure(root)) return yield* Effect.fail(root.failure);
      const config = {
        ...input.config,
        ...(input.config.reporters === undefined ? {} : { reporters: [...input.config.reporters] }),
      };
      const overrides = { ...(input.overrides ?? {}) };
      const target = yield* planProjectTarget(prepared.selected.evals, prepared.runs, config.timeoutMs, {
        cwd: input.cwd,
        configJudge: config.judgeProvider,
        keepSandbox: overrides.keepSandbox,
      });
      const maxConcurrency =
        overrides.maxConcurrency ??
        config.maxConcurrency ??
        recommendedConcurrencyForPreparedPairs([...target.preparedPairsByKey.values()]);
      const maxBuildConcurrency = overrides.maxBuildConcurrency ?? config.maxBuildConcurrency ?? 2;
      const maxBeforeCacheConcurrency = overrides.maxBeforeCacheConcurrency ?? config.maxBeforeCacheConcurrency ?? 2;
      if (!Number.isInteger(maxConcurrency) || maxConcurrency <= 0) {
        return yield* Effect.fail(new Error(`maxConcurrency must be a positive integer, got ${maxConcurrency}.`));
      }
      if (!Number.isInteger(maxBuildConcurrency) || maxBuildConcurrency <= 0) {
        return yield* Effect.fail(
          new Error(`maxBuildConcurrency must be a positive integer, got ${maxBuildConcurrency}.`),
        );
      }
      if (!Number.isInteger(maxBeforeCacheConcurrency) || maxBeforeCacheConcurrency <= 0) {
        return yield* Effect.fail(
          new Error(`maxBeforeCacheConcurrency must be a positive integer, got ${maxBeforeCacheConcurrency}.`),
        );
      }
      const uniqueEvalIds = new Set(prepared.runs.flatMap((run) => run.selectedEvalIds));
      const totalAttempts = prepared.runs.reduce((sum, run) => sum + run.selectedEvalIds.length * run.attempts, 0);
      const experimentConcurrency = Object.fromEntries(
        prepared.runs.flatMap((run) =>
          run.experimentId !== undefined && run.maxConcurrency !== undefined
            ? [[run.experimentId, run.maxConcurrency] as const]
            : [],
        ),
      );
      const shape: ExperimentHostInvocationShape = {
        experiments: prepared.runs.length,
        evals: uniqueEvalIds.size,
        configurations: prepared.runs.length,
        totalAttempts,
        attempts: Math.max(1, ...prepared.runs.map((run) => run.attempts)),
        maxConcurrency,
        maxBuildConcurrency,
        maxBeforeCacheConcurrency,
        experimentConcurrency,
      };
      const reuse = yield* prepareRunnerRecordReuse({
        manifestsByKey: target.manifestsByKey,
        preparedPairsByKey: target.preparedPairsByKey,
        evals: prepared.selected.evals,
        runs: prepared.runs,
        config: { timeoutMs: config.timeoutMs },
        plannedFingerprints: target.plannedFingerprints,
        renameFingerprintsByKey: target.renameFingerprintsByKey,
        plannedConfigHashes: target.plannedConfigHashes,
        rerun: overrides.rerun,
        keepSandbox: overrides.keepSandbox,
      });
      const previewStartedAt = input.preview === true ? yield* Clock.currentTimeMillis : undefined;
      const preview =
        previewStartedAt !== undefined
          ? yield* Effect.scoped(
              withRunnerCurrentReusePreview({
                recordRoot: root.success,
                startedAt: previewStartedAt,
                evals: prepared.selected.evals,
                runs: prepared.runs,
                reuse,
                use: ({ reusePlan, readReadbacks }) =>
                  Effect.gen(function* () {
                    const readbacks = yield* readReadbacks();
                    const pairs = new Map(
                      reusePlan.slots.map((slot) => [
                        JSON.stringify([slot.experimentId, slot.evalId]),
                        [slot.experimentId, slot.evalId] as const,
                      ]),
                    );
                    const projectDatabaseRoot = recordRootPaths(root.success)?.portableRoot;
                    if (projectDatabaseRoot === undefined)
                      return yield* Effect.fail(new Error("Record root is unavailable."));
                    const caseOwners = yield* Effect.all(
                      [...pairs].map(([key, [experimentId, evalId]]) =>
                        readCaseLockEffect(projectDatabaseRoot, experimentId, evalId).pipe(
                          Effect.catch(() => Effect.succeed(undefined)),
                          Effect.map((record) => {
                            if (record === undefined) return undefined;
                            return { key, state: exactProcessState(record) === "dead" ? "recoverable" : "locked" };
                          }),
                        ),
                      ),
                      { concurrency: "unbounded" },
                    );
                    return dryPlan(
                      reusePlan.slots,
                      readbacks.map(projectCurrentReuseReadback),
                      caseOwners.flatMap((owner) => (owner?.state === "locked" ? [owner.key] : [])),
                      caseOwners.flatMap((owner) => (owner?.state === "recoverable" ? [owner.key] : [])),
                      new Map(
                        prepared.selected.evals.flatMap((definition) =>
                          definition.evalGroup === undefined
                            ? []
                            : [
                                [
                                  definition.id,
                                  {
                                    id: definition.evalGroup.id,
                                    index: definition.evalGroup.evalIds.indexOf(definition.id),
                                  },
                                ] as const,
                              ],
                        ),
                      ),
                      yield* dryStateGroups(projectDatabaseRoot, target),
                    );
                  }),
              }),
            )
          : undefined;

      const plan = Object.freeze({}) as ExperimentHostInvocationPlan;
      invocationPlans.set(plan, {
        cwd: resolve(input.cwd),
        evals: prepared.selected.evals,
        runs: prepared.runs,
        config,
        recordRoot: root.success,
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
      return {
        status: "ready" as const,
        plan,
        shape,
        experimentIds: prepared.runs.map((run) => run.experimentId!),
        evalIds: [...uniqueEvalIds],
        pluginAudit: { occurrences: [...occurrenceAudits.values()] },
        dry: preview,
      };
    }),
  );
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
    pausePrompt: (text) => {
      if (isFeedbackStarted() && feedback?.pausePrompt) feedback.pausePrompt(text);
      else process.stderr.write(`${text}\n`);
    },
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
    runActivity: (input) => {
      session?.onInvocationEvent({ type: "run-activity", at: Date.now(), ...input });
      forward((sink, value) => sink.runActivity(value), input);
    },
    experimentProgress: (input) => forward((sink, value) => sink.experimentProgress(value), input),
    lifecycle: (event) => {
      if (
        event.type === "attempt:queued" ||
        event.type === "attempt:start" ||
        event.type === "attempt:phase" ||
        event.type === "attempt:progress" ||
        event.type === "attempt:sandbox" ||
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
  return {
    total: summary.passed + summary.failed + summary.skipped + summary.errored,
    passed: summary.passed,
    failed: summary.failed,
    skipped: summary.skipped,
    errored: summary.errored,
    durationMs: summary.durationMs,
    inputTokens: summary.usage?.inputTokens,
    outputTokens: summary.usage?.outputTokens,
    estimatedCostUSD: summary.estimatedCostUSD,
    beforeCaches: summary.beforeCaches,
  };
}

export function runInvocation(
  input: ExperimentHostInvocationRunRequest,
): Effect.Effect<ExperimentHostInvocationResult, ExperimentHostError, ExperimentHostRequirements> {
  const invocationRuns = new Set<string>();
  return Effect.scoped(
    closeOperation(
      "invocation-run",
      Effect.gen(function* () {
        const state = invocationPlans.get(input.plan as object);
        if (state === undefined || state.consumed) {
          return yield* Effect.fail(
            new Error("Experiment Host invocation plan is forged, copied, or already consumed."),
          );
        }
        state.consumed = true;
        let completedSummary: InvocationSummary | undefined;
        const reporters = [
          ...(input.junitPath === undefined
            ? []
            : [
                {
                  reporter: JUnit(input.junitPath),
                  name: "junit",
                  required: true,
                  target: input.junitPath,
                },
              ]),
          ...(state.config.reporters ?? []).map((reporter, index) => ({
            reporter,
            name: `config-reporter-${index}`,
            required: false,
            target: undefined,
          })),
          {
            name: "experiment-host-summary",
            required: false,
            target: undefined,
            reporter: {
              onInvocationComplete(summary: InvocationSummary) {
                completedSummary = summary;
              },
            },
          },
        ];
        // Session indexing is a Host-owned, project-local observation.  Runner only
        // receives the private tracker mechanism; this enclosing Scope closes its
        // heartbeat worker on success, typed failure, or interruption.
        const projectDatabaseRoot = recordRootPaths(state.recordRoot)?.portableRoot;
        if (projectDatabaseRoot === undefined) return yield* Effect.fail(new Error("Record root is unavailable."));
        const projectStateDatabase = yield* ProjectStateDatabase;
        const session = new SessionTracker(projectDatabaseRoot, projectStateDatabase);
        const closePortable = projectStateDatabase.closeInvocationPortable(projectDatabaseRoot);
        let sessionClosed = false;
        let feedbackStarted = false;
        let feedbackFinished = false;
        // During failure cleanup, close the worker after the fallback Session close
        // and preserve the original failure.
        yield* Effect.addFinalizer(() => (sessionClosed ? Effect.void : closePortable.pipe(Effect.ignore)));
        yield* Effect.addFinalizer(() =>
          sessionClosed ? Effect.void : session.close({ status: "incomplete" }).pipe(Effect.ignore),
        );
        yield* Effect.addFinalizer(() =>
          !feedbackStarted || feedbackFinished || input.feedback === undefined
            ? Effect.void
            : Effect.tryPromise({
                try: () => input.feedback!.coordinator.stopDynamic(),
                catch: () => undefined,
              }).pipe(Effect.ignore),
        );
        const feedback = input.feedback?.coordinator;
        const sink = multiplexFeedbackSink(feedback, session, () => feedbackStarted);
        const receipt = yield* Effect.acquireUseRelease(
          Effect.sync(() => activateFeedbackSink(sink)),
          () =>
            runEvals({
              projectRoot: state.cwd,
              config: state.config,
              evals: state.evals,
              agentRuns: state.runs,
              reporters,
              maxConcurrency: state.shape.maxConcurrency,
              maxBuildConcurrency: state.shape.maxBuildConcurrency,
              maxBeforeCacheConcurrency: state.shape.maxBeforeCacheConcurrency,
              coordinationRoot: state.coordinationRoot,
              recordRoot: state.recordRoot,
              keepSandbox: state.overrides.keepSandbox,
              observeState: input.feedback?.observeState,
              pauseOnFailure: state.overrides.pauseOnFailure,
              rerun: state.overrides.rerun,
              session,
              signal: input.signal,
              onCurrentRecordReusePlan: (current) =>
                Effect.sync(() => {
                  for (const runId of current.runIds.values()) invocationRuns.add(runId);
                  if (feedback === undefined) return;
                  feedback.start({
                    shape: {
                      evals: state.shape.evals,
                      configs: state.shape.configurations,
                      totalAttempts: state.shape.totalAttempts,
                      maxConcurrency: state.shape.maxConcurrency,
                      runIds: current.runIds,
                    },
                    experimentConcurrency: state.shape.experimentConcurrency,
                    reused: current.reused,
                    reusedFailures: current.reusedFailures,
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
        const completion = feedback === undefined ? undefined : assembleInvocationCompletion(feedback.state);
        function sessionCompletionStatus() {
          if (completion !== undefined) return completion.status;
          switch (receipt.completion) {
            case "completed":
              return "complete" as const;
            case "interrupted":
              return "interrupted" as const;
            default:
              return "incomplete" as const;
          }
        }
        yield* session
          .close({
            status: sessionCompletionStatus(),
            completion,
            receipt,
            completedAt: receipt.completedAt,
          })
          .pipe(
            Effect.onExit((exit) => {
              if (Exit.isFailure(exit)) return Effect.void;
              sessionClosed = true;
              // The Session is already terminal. Report the gate error directly.
              return closePortable.pipe(Effect.mapError((cause) => operationError("invocation-run", cause)));
            }),
          );
        if (feedback !== undefined && completion !== undefined) {
          yield* Effect.tryPromise({
            try: () => feedback.finish({ summary, completion, receipt }),
            catch: (cause) => cause,
          });
          feedbackFinished = true;
        }
        const foldedStats = foldInvocationEvalStats(summary);
        return {
          status: "finished" as const,
          receipt: {
            invocationId: receipt.invocationId,
            createdRunIds: receipt.createdRunIds,
            publicationCutoff: receipt.publicationCutoff,
            startedAt: receipt.startedAt,
            completedAt: receipt.completedAt,
            completion: receipt.completion,
          },
          summary: summaryOf(summary),
          feedback:
            completion === undefined
              ? { kind: "not-requested" as const }
              : {
                  kind: "completed" as const,
                  completion,
                  exitCode: computeExitCode(
                    {
                      ...summary,
                      failed: foldedStats.failed,
                      errored: foldedStats.errored,
                    },
                    completion,
                  ),
                },
        };
      }).pipe(
        Effect.mapError((cause) => {
          if (!(cause instanceof SqliteRecordError) || invocationRuns.size === 0) return cause;
          const runs = [...invocationRuns];
          return new SqliteRecordError(
            cause.code,
            cause.operation,
            `${cause.message} (operation: ${cause.operation}). Invocation Runs: ${runs.join(", ")}. After the owner exits, inspect saved coverage and recover unfinished Runs: ${runs.map((runId) => `niceeval run recover ${runId} --yes`).join("; ")}`,
            { cause },
          );
        }),
      ),
    ),
  );
}

export function planRename(
  input: ExperimentHostRenameRequest,
): Effect.Effect<ExperimentHostRenamePlan, ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation(
    "rename-plan",
    planExperimentRename(input).pipe(Effect.map((plan) => ({ ...plan, oldId: plan.oldId ?? null }))),
  );
}

export function applyRename(
  input: ExperimentHostRenameRequest,
): Effect.Effect<ExperimentHostRenameResult, ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation(
    "rename-apply",
    Effect.gen(function* () {
      const outcome = yield* Effect.result(renameExperiment(input));
      if (Result.isFailure(outcome)) {
        if (!(outcome.failure instanceof ExperimentRenameError)) return yield* Effect.fail(outcome.failure);
        const plan = outcome.failure.plan;
        return {
          status: "rejected" as const,
          sourceRunId: plan.sourceRunId,
          oldId: plan.oldId ?? null,
          newId: plan.newId,
          reason: plan.blocked!.reason,
          detail: plan.blocked!.detail,
        };
      }
      const done = outcome.success;
      return {
        status: "done" as const,
        invocationId: done.invocationId,
        runId: done.runId,
        sourceRunId: done.sourceRunId,
        oldId: done.oldId,
        newId: done.newId,
        migrated: done.migrated.map(({ renamedFrom: _, ...entry }) => entry),
      };
    }),
  );
}

export function accept(
  input: ExperimentHostAcceptRequest,
): Effect.Effect<readonly ExperimentHostAcceptedAttempt[], ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation(
    "accept",
    acceptLocators(input).pipe(
      Effect.map((receipts) =>
        receipts.map((receipt) => ({
          invocationId: receipt.invocationId,
          runId: receipt.runId,
          slotId: receipt.slotId,
          locator: receipt.locator,
          sourceLocator: receipt.sourceLocator,
          fingerprint: receipt.fingerprint,
        })),
      ),
    ),
  );
}

export function planRunAccept(
  input: ExperimentHostAcceptRunRequest,
): Effect.Effect<ExperimentHostAcceptRunPlan, ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation(
    "accept",
    planAcceptRun(input).pipe(
      Effect.map((plan) => ({
        sourceRunId: plan.sourceRunId,
        members: plan.members.map((member) => ({
          locator: member.locator,
          experimentId: member.experimentId,
          evalId: member.evalId,
          attempt: member.attempt,
          fingerprint: member.fingerprint,
          comparisons: member.comparisons,
        })),
      })),
    ),
  );
}

export function applyRunAccept(
  input: ExperimentHostAcceptRunRequest,
): Effect.Effect<readonly ExperimentHostAcceptedAttempt[], ExperimentHostError, ExperimentHostRequirements> {
  return closeOperation(
    "accept",
    acceptRun(input).pipe(
      Effect.map((receipts) =>
        receipts.map((receipt) => ({
          invocationId: receipt.invocationId,
          runId: receipt.runId,
          slotId: receipt.slotId,
          locator: receipt.locator,
          sourceLocator: receipt.sourceLocator,
          fingerprint: receipt.fingerprint,
        })),
      ),
    ),
  );
}

/** Locator preview shares the exact frozen-reader preflight with formal acceptance. */
export function planLocatorAccept(input: ExperimentHostAcceptRequest) {
  return closeOperation("accept", planAcceptLocators(input));
}
