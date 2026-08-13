// 项目 current 的宿主编排：发现定义 → 应用 selector → 无派发 identity planning。
// Record、carry、rerun 与历史结果都不进入这里；show/view/out 共用这一条入口。

import { Data, Effect } from "effect";
import { loadConfigFile } from "../load-config.ts";
import { matchExperimentSelector } from "../shared/aggregate.ts";
import { discoverEvals, discoverExperiments, type DiscoveryError } from "./discover.ts";
import { resolveExperimentEvals } from "./eval-selection.ts";
import {
  planProjectTarget,
  type FingerprintPlanningFailure,
  type ProjectTargetPlan,
} from "./fingerprint.ts";
import type { ProjectCurrentTarget } from "./project-target.ts";
import type { SandboxRunPlanningError } from "./sandbox-selection.ts";
import { resolveRunTimeout } from "./timeout.ts";
import type { AgentRun, Config } from "./types.ts";

export interface LoadProjectCurrentOptions {
  experiments?: string | readonly string[];
  evals?: readonly string[];
  freshImport?: boolean;
}

export interface LoadedProjectCurrent {
  target: ProjectCurrentTarget;
  watchInputs: readonly string[];
}

/** Project-current config loading is the only Promise boundary in this module. */
export class ProjectCurrentLoadError extends Data.TaggedError("ProjectCurrentLoadError")<{
  readonly stage: "config";
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
    const runs = yield* Effect.sync((): AgentRun[] => {
      const selectors = options.experiments === undefined
        ? []
        : Array.isArray(options.experiments) ? options.experiments : [options.experiments];
      const selectedIds = selectors.length === 0
        ? new Set(experiments.map((entry) => entry.id))
        : new Set(selectors.flatMap((selector) => matchExperimentSelector(
            experiments.map((entry) => entry.id),
            selector,
          )));
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
    const plan: ProjectTargetPlan = yield* planProjectTarget(
      evals,
      runs,
      config.timeoutMs,
      { configJudge: config.judge },
    );
    return {
      target: plan.target,
      watchInputs: Object.freeze([
        ...new Set([`${cwd}/niceeval.config.ts`, ...plan.watchInputs]),
      ].sort()),
    };
  });
}
