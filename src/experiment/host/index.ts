import { Effect } from "effect";
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
  readonly run: typeof run;
  readonly accept: typeof accept;
}

/** The fixed public Host surface; discovery, Runner, and adoption internals stay private. */
export const experimentHost: ExperimentHostSDK = Object.freeze({
  list,
  plan,
  run,
  accept,
});
