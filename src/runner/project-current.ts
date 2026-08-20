// 项目 current 的宿主编排：发现定义 → 应用 selector → 无派发 identity planning。
// Record、carry、rerun 与历史结果都不进入这里；show/view/out 共用这一条入口。

import { Data, Effect, Either, Schema } from "effect";
import type { AnalysisCurrentSlotIdentity } from "../analysis/contracts.ts";
import {
  EvalIdSchema,
  ExecutionIdentityDigestSchema,
  ExperimentIdSchema,
} from "../record/codec/identifiers.ts";
import { loadConfigFile } from "../load-config.ts";
import { discoverEvals, discoverExperiments, type DiscoveryError } from "./discover.ts";
import { resolveExperimentEvals } from "./eval-selection.ts";
import { slotExecutionIdentityDigestHex } from "./execution-identity.ts";
import {
  planProjectTarget,
  type FingerprintPlanningFailure,
  type ProjectTargetPlan,
} from "./fingerprint.ts";
import type { ProjectCurrentTarget } from "./project-target.ts";
import type { SandboxRunPlanningError } from "./sandbox-selection.ts";
import { resolveAttemptTimeout, resolveRunTimeout } from "./timeout.ts";
import type { AgentRun, Config } from "./types.ts";
import { matchExperimentSelector } from "../shared/aggregate.ts";

export interface LoadProjectCurrentOptions {
  experiments?: string | readonly string[];
  evals?: readonly string[];
  freshImport?: boolean;
}

export interface LoadedProjectCurrent {
  target: ProjectCurrentTarget;
  watchInputs: readonly string[];
  currentSlots: readonly AnalysisCurrentSlotIdentity[];
}

/** Project-current config loading is the only Promise boundary in this module. */
export class ProjectCurrentLoadError extends Data.TaggedError("ProjectCurrentLoadError")<{
  readonly stage: "config" | "selection";
  readonly message: string;
}> {}

function loadProjectConfig(
  cwd: string,
  options: { freshImport?: boolean },
): Effect.Effect<Config, ProjectCurrentLoadError> {
  return Effect.tryPromise({
    try: () => loadConfigFile(cwd, options),
    catch: (cause) => new ProjectCurrentLoadError({
      stage: "config",
      message: cause instanceof Error ? cause.message : String(cause),
    }),
  });
}

/**
 * Discovers and plans the current project without closing the Effect runtime.
 * CLI and view are the Promise-facing application hosts for this operation.
 */
export function loadProjectCurrent(
  cwd: string,
  options: LoadProjectCurrentOptions = {},
): Effect.Effect<
  LoadedProjectCurrent,
  ProjectCurrentLoadError | DiscoveryError | SandboxRunPlanningError | FingerprintPlanningFailure
> {
  const discoveryOptions = { freshImport: options.freshImport };
  return Effect.gen(function*() {
    // namespaced fresh import 是进程级 loader 边界，按顺序装载，避免三棵图并发注册互相卡住。
    const config = yield* loadProjectConfig(cwd, discoveryOptions);
    const evals = yield* discoverEvals(cwd, discoveryOptions);
    const experiments = yield* discoverExperiments(cwd, discoveryOptions);
    const selectors = options.experiments === undefined
      ? []
      : Array.isArray(options.experiments) ? options.experiments : [options.experiments];
    const availableExperimentIds = experiments.map((entry) => entry.id);
    const availableIds = new Set(availableExperimentIds);
    const selectedIds = new Set<string>();
    for (const selector of selectors) {
      const matches = matchExperimentSelector(availableExperimentIds, selector);
      if (matches.length === 0) {
        return yield* Effect.fail(new ProjectCurrentLoadError({
          stage: "selection",
          message: `Unknown current project Experiment ${JSON.stringify(selector)}.`,
        }));
      }
      for (const match of matches) selectedIds.add(match);
    }
    if (selectors.length === 0) {
      for (const id of availableIds) selectedIds.add(id);
    }
    if (selectedIds.size === 0) {
      return yield* Effect.fail(new ProjectCurrentLoadError({
        stage: "selection",
        message: "The current project has no Experiments to show.",
      }));
    }
    const runs = yield* Effect.sync((): AgentRun[] => {
      const selectedRuns: AgentRun[] = [];
      for (const experiment of experiments) {
        if (!selectedIds.has(experiment.id)) continue;
        const { selectedEvalIds } = resolveExperimentEvals({
          experimentId: experiment.id,
          selector: experiment.evals,
          cliPatterns: [...(options.evals ?? [])],
          evals,
        });
        selectedRuns.push({
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
          selectedEvalIds,
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
      return selectedRuns;
    });
    if (runs.length === 0) {
      return yield* Effect.fail(new ProjectCurrentLoadError({
        stage: "selection",
        message: "The current project target contains no runnable Experiments.",
      }));
    }
    const plan: ProjectTargetPlan = yield* planProjectTarget(
      evals,
      runs,
      config.timeoutMs,
      { configJudge: config.judge },
    );
    if (plan.target.experiments.length === 0) {
      return yield* Effect.fail(new ProjectCurrentLoadError({
        stage: "selection",
        message: "The current project target contains no Eval results to show.",
      }));
    }
    const currentSlots = yield* currentSlotIdentities(runs, plan, config);
    return {
      target: plan.target,
      currentSlots,
      watchInputs: Object.freeze([
        ...new Set([`${cwd}/niceeval.config.ts`, ...plan.watchInputs]),
      ].sort()),
    };
  });
}

function currentSlotIdentities(
  runs: readonly AgentRun[],
  plan: ProjectTargetPlan,
  config: Config,
): Effect.Effect<readonly AnalysisCurrentSlotIdentity[], ProjectCurrentLoadError> {
  return Effect.gen(function* () {
    const slots: AnalysisCurrentSlotIdentity[] = [];
    const seen = new Set<string>();
    for (const run of runs) {
      for (const pair of plan.preparedPairsByKey.values()) {
        if (pair.run.experimentId !== run.experimentId) continue;
        const fingerprint = plan.plannedFingerprints.get(pair.key);
        const configHash = plan.plannedConfigHashes.get(pair.key);
        if (fingerprint === undefined || configHash === undefined) {
          return yield* Effect.fail(new ProjectCurrentLoadError({
            stage: "selection",
            message: `Current identity planning omitted Eval ${JSON.stringify(pair.evalDef.id)}.`,
          }));
        }
        const timeout = resolveAttemptTimeout(run, pair.evalDef, config);
        const experimentId = Schema.decodeUnknownEither(ExperimentIdSchema)(run.experimentId);
        const evalId = Schema.decodeUnknownEither(EvalIdSchema)(pair.evalDef.id);
        if (Either.isLeft(experimentId) || Either.isLeft(evalId)) {
          return yield* Effect.fail(new ProjectCurrentLoadError({
            stage: "selection",
            message: `Current target produced an invalid Experiment or Eval identity.`,
          }));
        }
        for (let attempt = 0; attempt < run.attempts; attempt += 1) {
          const digestValue = slotExecutionIdentityDigestHex({
            experimentId: run.experimentId,
            evalId: pair.evalDef.id,
            attempt,
            input: { domain: "niceeval.input/fingerprint-v1", value: fingerprint },
            config: { domain: "niceeval.config/identity-v1", value: configHash },
            timeout: timeout === undefined
              ? null
              : { domain: "niceeval.execution-duration/v1", milliseconds: timeout.timeoutMs },
          });
          const digest = Schema.decodeUnknownEither(ExecutionIdentityDigestSchema)(digestValue);
          if (Either.isLeft(digest)) {
            return yield* Effect.fail(new ProjectCurrentLoadError({
              stage: "selection",
              message: `Current target produced an invalid execution identity digest.`,
            }));
          }
          const key = `${experimentId.right}\0${evalId.right}\0${String(attempt)}\0${digest.right}`;
          if (seen.has(key)) continue;
          seen.add(key);
          slots.push(Object.freeze({
            experimentId: experimentId.right,
            evalId: evalId.right,
            attemptOrdinal: attempt,
            executionIdentityDigest: digest.right,
          }));
        }
      }
    }
    return Object.freeze(slots);
  });
}
