import { getExperimentExecutionSource } from "../../runner/experiment-modules.ts";
import { Effect } from "effect";
import {
  assembleCommandPlan,
  beforeCachePlanOf,
  type CommandPlan,
  type BeforeCachePlan,
} from "../../runner/command-plan.ts";
import { discoverEvals, discoverExperimentSelection } from "../../runner/discover.ts";
import { planProjectTarget } from "../../runner/fingerprint.ts";
import { resolveExperimentEvals } from "../../runner/eval-selection.ts";
import { resolveRunTimeout } from "../../runner/timeout.ts";
import type { AgentRun, Config, DiscoveredEval, DiscoveredExperiment } from "../../runner/types.ts";
import { resolveSandboxBeforeCache } from "../../runner/types.ts";
import {
  accept,
  applyRunAccept,
  applyRename,
  catalog,
  check,
  listInvocationStatus,
  operationError,
  planInvocation,
  planRename,
  planRunAccept,
  runInvocation,
  showInvocationStatus,
} from "./operations.ts";
import { inspectTeardown, runTeardown } from "./teardown.ts";
import { ExperimentHostError } from "./types.ts";

/** One discovered Experiment after its author selector and CLI prefixes close. */
interface ExperimentHostSelection {
  readonly experiment: DiscoveredExperiment;
  readonly selectedEvalIds: readonly string[];
  /** The Experiment-owned set before CLI eval-prefix narrowing. */
  readonly selectorEvalIds: readonly string[];
}

/** Discovery result used by both `exp list` and execution planning. */
interface ExperimentHostListResult {
  readonly evals: readonly DiscoveredEval[];
  readonly experimentIds: readonly string[];
  readonly selections: readonly ExperimentHostSelection[];
}

/**
 * Discovery and selection are owned here so consumers cannot invoke an
 * Experiment's predicate a second time while reconstructing an AgentRun.
 */
function discoverSelection(cwd: string): Effect.Effect<ExperimentHostListResult, unknown> {
  return Effect.gen(function* () {
    const evals = yield* discoverEvals(cwd);
    const { experiments, experimentIds } = yield* discoverExperimentSelection(cwd, {
      select: (ids) => ids,
      freshImport: false,
      generation: undefined,
    });
    const selections = experiments.map((experiment): ExperimentHostSelection => {
      const selected = resolveExperimentEvals({
        experimentId: experiment.id,
        models: experiment.models,
        tag: undefined,
        selector: experiment.evals,
        cliPatterns: [],
        evals,

        validateModelRequirements: undefined,
      });
      return {
        experiment,
        selectedEvalIds: selected.selectedEvalIds,
        selectorEvalIds: selected.selectorEvals.map((evalDefinition) => evalDefinition.id),
      };
    });
    return {
      evals,
      experimentIds,
      selections,
    };
  });
}

/** Selects an Experiment and optional Eval for readonly debug planning using an explicit cwd and Config; it does not authorize execution. */
export interface ExperimentHostDebugPlanRequest {
  readonly cwd: string;
  readonly config: Config;
  readonly experimentSelector: string;
  readonly evalSelector?: string | undefined;
}

/** A fully closed, read-only lifecycle plan for exactly one Experiment × Eval pair. */
export interface ExperimentHostDebugPlan {
  readonly status: "planned";
  readonly experimentId: string;
  /** Retained for the existing single-pair response. */
  readonly evalId: string | undefined;
  readonly evalIds: readonly string[];
  readonly commandPlan: CommandPlan;
  readonly beforeCachePlan: BeforeCachePlan;
}

/**
 * Selector outcomes are data, rather than CLI-owned selection logic or a
 * partially constructed plan. The caller can render them in its own surface.
 */
export type ExperimentHostDebugPlanResult =
  | ExperimentHostDebugPlan
  | {
      readonly status: "experiment-no-match";
      readonly selector: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly status: "experiment-ambiguous";
      readonly selector: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly status: "eval-no-match";
      readonly selector: string;
      readonly experimentId: string;
      readonly candidates: readonly string[];
    }
  | {
      readonly status: "eval-ambiguous";
      readonly selector: string;
      readonly experimentId: string;
      readonly candidates: readonly string[];
    };

function uniqueExactOrPrefix<T>(
  candidates: readonly T[],
  selector: string,
  id: (candidate: T) => string,
): readonly T[] {
  const exact = candidates.find((candidate) => id(candidate) === selector);
  return exact === undefined ? candidates.filter((candidate) => id(candidate).startsWith(selector)) : [exact];
}

function debugAgentRun(experiment: DiscoveredExperiment, evalId: string, config: Config): AgentRun {
  return {
    adapter: experiment.adapter,
    agent: experiment.adapter?.kind === "custom" ? undefined : experiment.adapter,
    models: experiment.models,
    model: experiment.model,
    reasoningEffort: experiment.reasoningEffort,
    flags: experiment.flags ?? {},
    plugins: experiment.plugins,
    pluginBehavior: undefined,
    attempts: experiment.attempts ?? 1,
    earlyExit: experiment.earlyExit ?? false,
    sandboxBeforeCache: resolveSandboxBeforeCache(undefined, experiment.sandboxCache, config.sandboxCache),
    sandbox: experiment.sandbox,
    sandboxReuse: experiment.sandboxReuse,
    sandboxLabels: experiment.sandboxLabels,
    sharedState: experiment.sharedState,
    state: experiment.state,
    judge: experiment.judge,
    ...resolveRunTimeout(undefined, experiment.timeoutMs),
    budget: experiment.budget,
    selectedEvalIds: [evalId],
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

/**
 * Closes selector resolution, physical planning, and command-plan projection
 * inside the Experiment Host. It deliberately does not construct a Record
 * root, enter a lease, read history, or invoke an author callback.
 */
function debug(
  input: ExperimentHostDebugPlanRequest,
): Effect.Effect<ExperimentHostDebugPlanResult, ExperimentHostError> {
  return Effect.gen(function* () {
    const listed = yield* discoverSelection(input.cwd);
    const selectedExperiments = uniqueExactOrPrefix(
      listed.selections,
      input.experimentSelector,
      ({ experiment }) => experiment.id,
    )
      .slice()
      .sort((left, right) => left.experiment.id.localeCompare(right.experiment.id));
    if (selectedExperiments.length === 0) {
      return {
        status: "experiment-no-match" as const,
        selector: input.experimentSelector,
        candidates: [...listed.experimentIds].sort(),
      };
    }
    if (selectedExperiments.length > 1) {
      return {
        status: "experiment-ambiguous" as const,
        selector: input.experimentSelector,
        candidates: selectedExperiments.map(({ experiment }) => experiment.id),
      };
    }

    const selection = selectedExperiments[0]!;
    const experiment = selection.experiment;
    const selectorEvalIds = new Set(selection.selectorEvalIds);
    const selectorEvals = listed.evals.filter((evalDef) => selectorEvalIds.has(evalDef.id));
    const selectedEvals = (
      input.evalSelector === undefined
        ? selectorEvals
        : uniqueExactOrPrefix(selectorEvals, input.evalSelector, (evalDef) => evalDef.id)
    )
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id));
    if (selectedEvals.length === 0) {
      return {
        status: "eval-no-match" as const,
        selector: input.evalSelector ?? "",
        experimentId: experiment.id,
        candidates: selectorEvals.map((evalDef) => evalDef.id).sort(),
      };
    }
    if (input.evalSelector !== undefined && selectedEvals.length > 1) {
      return {
        status: "eval-ambiguous" as const,
        selector: input.evalSelector,
        experimentId: experiment.id,
        candidates: selectedEvals.map((evalDef) => evalDef.id),
      };
    }

    const runs = selectedEvals.map((evalDef) => debugAgentRun(experiment, evalDef.id, input.config));
    const target = yield* planProjectTarget(listed.evals, runs, input.config.timeoutMs, {
      cwd: input.cwd,
      configJudge: input.config.judgeProvider,
      keepSandbox: undefined,
    });
    const commandPlan = assembleCommandPlan({
      rows: selectedEvals.map((evalDef) => {
        const run = runs.find((candidate) => candidate.selectedEvalIds.includes(evalDef.id))!;
        return {
          experimentId: experiment.id,
          evalId: evalDef.id,
          evalGroupId: evalDef.evalGroup?.id,
          attempts: run.attempts,
          dispatch: [{ attempts: Array.from({ length: run.attempts }, (_, attempt) => attempt) }],
        };
      }),
      preparedPairsByKey: target.preparedPairsByKey,
    });
    return {
      status: "planned" as const,
      experimentId: experiment.id,
      evalId: selectedEvals.length === 1 ? selectedEvals[0]?.id : undefined,
      evalIds: selectedEvals.map((evalDef) => evalDef.id),
      commandPlan,
      beforeCachePlan: beforeCachePlanOf(commandPlan),
    };
  }).pipe(Effect.mapError((cause) => operationError("debug", cause)));
}

/** Internal operations retain their service requirements for the CLI composition. */
export const rawExperimentHost = Object.freeze({
  catalog,
  check,
  invocation: Object.freeze({ plan: planInvocation, run: runInvocation }),
  invocationStatus: Object.freeze({ list: listInvocationStatus, show: showInvocationStatus }),
  rename: Object.freeze({ plan: planRename, apply: applyRename }),
  after: Object.freeze({ inspect: inspectTeardown, run: runTeardown }),
  debug,
  accept,
  acceptRun: Object.freeze({ plan: planRunAccept, apply: applyRunAccept }),
});
