import { Effect } from "effect";
import { assembleCommandPlan, type CommandPlan } from "../../runner/command-plan.ts";
import { discoverEvals, discoverExperiments } from "../../runner/discover.ts";
import { planProjectTarget } from "../../runner/fingerprint.ts";
import { resolveExperimentEvals } from "../../runner/eval-selection.ts";
import {
  prepareRunnerRecordReuse,
  withRunnerCurrentReusePreview,
} from "../../runner/record.ts";
import {
  projectCurrentReuseReadback,
} from "../../runner/reuse-readback.ts";
import { acceptLocators } from "../../runner/accept.ts";
import { runEvals } from "../../runner/run.ts";
import type {
  AcceptLocatorsOptions,
} from "../../runner/accept.ts";
import type { ProjectTargetPlan } from "../../runner/fingerprint.ts";
import type { CurrentReuseReadbackSnapshot } from "../../runner/reuse-readback.ts";
import type { ExecutionReusePlanSlot } from "../../runner/reuse-plan.ts";
import { resolveRunTimeout } from "../../runner/timeout.ts";
import type {
  AgentRun,
  Config,
  DiscoveredEval,
  DiscoveredExperiment,
  RunOptions,
} from "../../runner/types.ts";
import type { RecordRoot } from "../../record/platform/root.ts";
import { matchExperimentSelector } from "../../shared/aggregate.ts";

/**
 * Public, supported high-level Host composition SDK for the NiceEval CLI,
 * replacement CLI/Web hosts, and deep application integrations. Eval authors
 * use `defineExperiment`; this entry deliberately exposes no Runner internals.
 */

/** One discovered Experiment after its author selector and CLI prefixes close. */
export interface ExperimentHostSelection {
  readonly experiment: DiscoveredExperiment;
  readonly selectedEvalIds: readonly string[];
  /** The Experiment-owned set before CLI eval-prefix narrowing. */
  readonly selectorEvalIds: readonly string[];
}

/** Discovery result used by both `exp list` and execution planning. */
export interface ExperimentHostListResult {
  readonly evals: readonly DiscoveredEval[];
  readonly experimentIds: readonly string[];
  readonly selections: readonly ExperimentHostSelection[];
}

/**
 * Discovery and selection are owned here so consumers cannot invoke an
 * Experiment's predicate a second time while reconstructing an AgentRun.
 */
function list(input: {
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
  readonly evalSelector: string;
}

/** A fully closed, read-only lifecycle plan for exactly one Experiment × Eval pair. */
export interface ExperimentHostDebugPlan {
  readonly status: "planned";
  readonly experimentId: string;
  readonly evalId: string;
  readonly commandPlan: CommandPlan;
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

function debugAgentRun(experiment: DiscoveredExperiment, evalId: string): AgentRun {
  return {
    agent: experiment.agent,
    model: experiment.model,
    reasoningEffort: experiment.reasoningEffort,
    flags: experiment.flags ?? {},
    plugins: experiment.plugins,
    attempts: experiment.attempts ?? 1,
    earlyExit: experiment.earlyExit ?? false,
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
): Effect.Effect<ExperimentHostDebugPlanResult, unknown> {
  return Effect.gen(function* () {
    const listed = yield* list({ cwd: input.cwd });
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
    const selectedEvals = uniqueExactOrPrefix(selectorEvals, input.evalSelector, (evalDef) => evalDef.id)
      .slice().sort((left, right) => left.id.localeCompare(right.id));
    if (selectedEvals.length === 0) {
      return Object.freeze({
        status: "eval-no-match" as const,
        selector: input.evalSelector,
        experimentId: experiment.id,
        candidates: Object.freeze(selectorEvals.map((evalDef) => evalDef.id).sort()),
      });
    }
    if (selectedEvals.length > 1) {
      return Object.freeze({
        status: "eval-ambiguous" as const,
        selector: input.evalSelector,
        experimentId: experiment.id,
        candidates: Object.freeze(selectedEvals.map((evalDef) => evalDef.id)),
      });
    }

    const evalDef = selectedEvals[0]!;
    const run = debugAgentRun(experiment, evalDef.id);
    const target = yield* planProjectTarget(
      listed.evals,
      [run],
      input.config.timeoutMs,
      { configJudge: input.config.judge },
    );
    const commandPlan = assembleCommandPlan({
      rows: [{
        experimentId: experiment.id,
        evalId: evalDef.id,
        ...(evalDef.evalGroup === undefined ? {} : { evalGroupId: evalDef.evalGroup.id }),
        attempts: run.attempts,
        dispatch: [{ attempts: Array.from({ length: run.attempts }, (_, attempt) => attempt) }],
      }],
      preparedPairsByKey: target.preparedPairsByKey,
    });
    return Object.freeze({
      status: "planned" as const,
      experimentId: experiment.id,
      evalId: evalDef.id,
      commandPlan,
    });
  });
}

export interface ExperimentHostPlanRequest {
  readonly evals: readonly DiscoveredEval[];
  readonly agentRuns: readonly AgentRun[];
  readonly config: Config;
  readonly recordRoot: RecordRoot;
  readonly rerun?: "failed" | "all";
  readonly keepSandbox?: "failed" | "all";
  /** Omit for a dispatch plan; include only for the read-only `exp --dry` path. */
  readonly previewStartedAt?: number;
}

export interface ExperimentHostCurrentPlan {
  readonly slots: readonly ExecutionReusePlanSlot[];
  readonly readbacks: readonly CurrentReuseReadbackSnapshot[];
}

export interface ExperimentHostPlan {
  readonly target: ProjectTargetPlan;
  readonly current?: ExperimentHostCurrentPlan;
}

/**
 * Reuses the production physical planner and frozen Record reuse planner.
 * It never creates a Run; current history is read only when a dry preview was
 * explicitly requested.
 */
function plan(input: ExperimentHostPlanRequest) {
  return Effect.gen(function* () {
    const target = yield* planProjectTarget(
      input.evals,
      input.agentRuns,
      input.config.timeoutMs,
      {
        configJudge: input.config.judge,
        ...(input.keepSandbox === undefined ? {} : { keepSandbox: input.keepSandbox }),
      },
    );
    const reuse = yield* prepareRunnerRecordReuse({
      evals: input.evals,
      runs: input.agentRuns,
      config: { timeoutMs: input.config.timeoutMs },
      plannedFingerprints: target.plannedFingerprints,
      plannedConfigHashes: target.plannedConfigHashes,
      ...(input.rerun === undefined ? {} : { rerun: input.rerun }),
      ...(input.keepSandbox === undefined ? {} : { keepSandbox: input.keepSandbox }),
    });
    const current = input.previewStartedAt === undefined
      ? undefined
      : yield* withRunnerCurrentReusePreview({
        recordRoot: input.recordRoot,
        startedAt: input.previewStartedAt,
        evals: input.evals,
        runs: input.agentRuns,
        reuse,
        use: ({ reusePlan, readReadbacks }) => readReadbacks().pipe(
          Effect.map((readbacks): ExperimentHostCurrentPlan => Object.freeze({
            slots: Object.freeze([...reusePlan.slots]),
            readbacks: Object.freeze(readbacks.map(projectCurrentReuseReadback)),
          })),
        ),
      });
    return Object.freeze({
      target,
      ...(current === undefined ? {} : { current }),
    });
  });
}

/** The existing Runner remains the one execution implementation. */
function run<AttachmentError, AttachmentRequirements>(
  input: RunOptions<AttachmentError, AttachmentRequirements>,
) {
  return runEvals(input);
}

/** The existing adoption flow remains the one acceptance implementation. */
function accept(input: AcceptLocatorsOptions) {
  return acceptLocators(input);
}

export interface ExperimentHostSDK {
  readonly list: typeof list;
  readonly plan: typeof plan;
  readonly debug: typeof debug;
  readonly run: typeof run;
  readonly accept: typeof accept;
}

/** The fixed public Host surface; discovery, Runner, and adoption internals stay private. */
export const experimentHost: ExperimentHostSDK = Object.freeze({
  list,
  plan,
  debug,
  run,
  accept,
});
