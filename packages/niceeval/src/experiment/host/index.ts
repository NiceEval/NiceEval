import { Effect } from "effect";
import { assembleCommandPlan, setupPrefixPlanOf, type CommandPlan, type SetupPrefixPlan } from "../../runner/command-plan.ts";
import { discoverEvals, discoverExperiments } from "../../runner/discover.ts";
import { planProjectTarget } from "../../runner/fingerprint.ts";
import { resolveExperimentEvals } from "../../runner/eval-selection.ts";
import { resolveRunTimeout } from "../../runner/timeout.ts";
import type {
  AgentRun,
  Config,
  DiscoveredEval,
  DiscoveredExperiment,
} from "../../runner/types.ts";
import { resolveSandboxSetupCache } from "../../runner/types.ts";
import { matchExperimentSelector } from "../../shared/aggregate.ts";
import {
  accept,
  applyRunAccept,
  applyRename,
  catalog,
  check,
  listInvocationStatus,
  planInvocation,
  planRename,
  planRunAccept,
  runInvocation,
  showInvocationStatus,
} from "./operations.ts";
import { inspectTeardown, runTeardown } from "./teardown.ts";
import { ExperimentHostError, type ExperimentHostHighLevelSDK } from "./types.ts";

export * from "./types.ts";
export { decodeExpPlanDocument, ExpPlanDocumentSchema, type ExpPlanDocument } from "./cli/plan-protocol.ts";
export {
  decodeExpTerminalEvent,
  ExpInvocationReceiptSchema,
  ExpTerminalEventSchema,
  ExpTerminalSummarySchema,
  type ExpInvocationReceipt,
  type ExpTerminalEvent,
  type ExpTerminalSummary,
} from "./cli/output-protocol.ts";

/**
 * Public, supported high-level Host composition SDK for the NiceEval CLI,
 * replacement CLI/Web hosts, and deep application integrations. Eval authors
 * use `defineExperiment`; this entry deliberately exposes no Runner internals.
 */

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
function discoverSelection(input: {
  readonly cwd: string;
  /** Keep the CLI's public `--tag` selection inside the Experiment boundary. */
  readonly tag?: string;
  readonly selector?: string;
  readonly evalPatterns?: readonly string[];
}): Effect.Effect<ExperimentHostListResult, unknown> {
  return Effect.gen(function* () {
    const discoveredEvals = yield* discoverEvals(input.cwd);
    const evals = input.tag === undefined
      ? discoveredEvals
      : discoveredEvals.filter((evalDefinition) => evalDefinition.tags?.includes(input.tag!));
    const experiments = yield* discoverExperiments(input.cwd);
    const experimentIds = Object.freeze(experiments.map((experiment) => experiment.id));
    const selectedIds = input.selector === undefined
      ? undefined
      : new Set(matchExperimentSelector(experimentIds, input.selector));
    const selections = experiments
      .filter((experiment) => selectedIds === undefined || selectedIds.has(experiment.id))
      .map((experiment): ExperimentHostSelection => {
        const selected = resolveExperimentEvals({
          experimentId: experiment.id,
          selector: experiment.evals,
          cliPatterns: input.evalPatterns ?? [],
          evals,
        });
        return Object.freeze({
          experiment,
          selectedEvalIds: Object.freeze([...selected.selectedEvalIds]),
          selectorEvalIds: Object.freeze(selected.selectorEvals.map((evalDefinition) => evalDefinition.id)),
        });
      });
    return Object.freeze({
      evals: Object.freeze([...evals]),
      experimentIds,
      selections: Object.freeze(selections),
    });
  });
}

export interface ExperimentHostDebugPlanRequest {
  readonly cwd: string;
  readonly config: Config;
  readonly experimentSelector: string;
  readonly evalSelector?: string;
}

/** A fully closed, read-only lifecycle plan for exactly one Experiment × Eval pair. */
export interface ExperimentHostDebugPlan {
  readonly status: "planned";
  readonly experimentId: string;
  /** Retained for the existing single-pair response. */
  readonly evalId?: string;
  readonly evalIds: readonly string[];
  readonly commandPlan: CommandPlan;
  readonly setupPrefixPlan: SetupPrefixPlan;
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
  return exact === undefined
    ? candidates.filter((candidate) => id(candidate).startsWith(selector))
    : [exact];
}

function debugAgentRun(
  experiment: DiscoveredExperiment,
  evalId: string,
  config: Config,
): AgentRun {
  return {
    agent: experiment.agent,
    model: experiment.model,
    reasoningEffort: experiment.reasoningEffort,
    flags: experiment.flags ?? {},
    plugins: experiment.plugins,
    attempts: experiment.attempts ?? 1,
    earlyExit: experiment.earlyExit ?? false,
    sandboxSetupCache: resolveSandboxSetupCache(
      undefined,
      experiment.sandboxCache,
      config.sandboxCache,
    ),
    sandbox: experiment.sandbox,
    sandboxReuse: experiment.sandboxReuse,
    ...(experiment.sharedState === undefined ? {} : { sharedState: experiment.sharedState }),
    judge: experiment.judge,
    ...resolveRunTimeout(undefined, experiment.timeoutMs),
    budget: experiment.budget,
    selectedEvalIds: [evalId],
    experimentId: experiment.id,
    experimentBaseDir: experiment.baseDir,
    experimentSourcePath: experiment.sourcePath,
    description: experiment.description,
    labels: experiment.labels,
    maxConcurrency: experiment.maxConcurrency,
    setup: experiment.setup,
    teardown: experiment.teardown,
    classifyFailure: experiment.classifyFailure,
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
    const listed = yield* discoverSelection({ cwd: input.cwd });
    const selectedExperiments = uniqueExactOrPrefix(
      listed.selections,
      input.experimentSelector,
      ({ experiment }) => experiment.id,
    ).slice().sort((left, right) => left.experiment.id.localeCompare(right.experiment.id));
    if (selectedExperiments.length === 0) {
      return Object.freeze({
        status: "experiment-no-match" as const,
        selector: input.experimentSelector,
        candidates: Object.freeze([...listed.experimentIds].sort()),
      });
    }
    if (selectedExperiments.length > 1) {
      return Object.freeze({
        status: "experiment-ambiguous" as const,
        selector: input.experimentSelector,
        candidates: Object.freeze(selectedExperiments.map(({ experiment }) => experiment.id)),
      });
    }

    const selection = selectedExperiments[0]!;
    const experiment = selection.experiment;
    const selectorEvalIds = new Set(selection.selectorEvalIds);
    const selectorEvals = listed.evals.filter((evalDef) => selectorEvalIds.has(evalDef.id));
    const selectedEvals = (input.evalSelector === undefined
      ? selectorEvals
      : uniqueExactOrPrefix(selectorEvals, input.evalSelector, (evalDef) => evalDef.id))
      .slice().sort((left, right) => left.id.localeCompare(right.id));
    if (selectedEvals.length === 0) {
      return Object.freeze({
        status: "eval-no-match" as const,
        selector: input.evalSelector ?? "",
        experimentId: experiment.id,
        candidates: Object.freeze(selectorEvals.map((evalDef) => evalDef.id).sort()),
      });
    }
    if (input.evalSelector !== undefined && selectedEvals.length > 1) {
      return Object.freeze({
        status: "eval-ambiguous" as const,
        selector: input.evalSelector,
        experimentId: experiment.id,
        candidates: Object.freeze(selectedEvals.map((evalDef) => evalDef.id)),
      });
    }

    const runs = selectedEvals.map((evalDef) => debugAgentRun(experiment, evalDef.id, input.config));
    const target = yield* planProjectTarget(
      listed.evals,
      runs,
      input.config.timeoutMs,
      { configJudge: input.config.judge },
    );
    const commandPlan = assembleCommandPlan({
      rows: selectedEvals.map((evalDef) => {
        const run = runs.find((candidate) => candidate.selectedEvalIds.includes(evalDef.id))!;
        return {
        experimentId: experiment.id,
        evalId: evalDef.id,
        ...(evalDef.evalGroup === undefined ? {} : { evalGroupId: evalDef.evalGroup.id }),
        attempts: run.attempts,
        dispatch: [{ attempts: Array.from({ length: run.attempts }, (_, attempt) => attempt) }],
        };
      }),
      preparedPairsByKey: target.preparedPairsByKey,
    });
    return Object.freeze({
      status: "planned" as const,
      experimentId: experiment.id,
      ...(selectedEvals.length === 1 ? { evalId: selectedEvals[0]!.id } : {}),
      evalIds: Object.freeze(selectedEvals.map((evalDef) => evalDef.id)),
      commandPlan,
      setupPrefixPlan: setupPrefixPlanOf(commandPlan),
    });
  }).pipe(Effect.mapError((cause) => new ExperimentHostError({
    operation: "debug",
    code: typeof cause === "object" && cause !== null && typeof Reflect.get(cause, "code") === "string"
      ? String(Reflect.get(cause, "code"))
      : "experiment-host-operation-failed",
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  })));
}

export interface ExperimentHostSDK extends ExperimentHostHighLevelSDK {
  readonly debug: typeof debug;
}

/** The fixed public Host surface; discovery, Runner, and adoption internals stay private. */
export const experimentHost: ExperimentHostSDK = Object.freeze({
  catalog,
  check,
  invocation: Object.freeze({ plan: planInvocation, run: runInvocation }),
  invocationStatus: Object.freeze({ list: listInvocationStatus, show: showInvocationStatus }),
  rename: Object.freeze({ plan: planRename, apply: applyRename }),
  teardown: Object.freeze({ inspect: inspectTeardown, run: runTeardown }),
  debug,
  accept,
  acceptRun: Object.freeze({ plan: planRunAccept, apply: applyRunAccept }),
});
