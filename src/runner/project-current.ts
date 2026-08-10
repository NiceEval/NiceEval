// 项目 current 的宿主编排：发现定义 → 应用 selector → 无派发 identity planning。
// Record、carry、rerun 与历史结果都不进入这里；show/view/out 共用这一条入口。

import { Effect } from "effect";
import { loadConfigFile } from "../load-config.ts";
import type { ProjectCurrentTarget } from "../record/types.ts";
import { matchExperimentSelector } from "../shared/aggregate.ts";
import { discoverEvals, discoverExperiments } from "./discover.ts";
import { resolveExperimentEvals } from "./eval-selection.ts";
import { planProjectTarget, type ProjectTargetPlan } from "./fingerprint.ts";
import { resolveRunTimeout } from "./timeout.ts";
import type { AgentRun } from "./types.ts";

export interface LoadProjectCurrentOptions {
  experiments?: string | readonly string[];
  evals?: readonly string[];
  freshImport?: boolean;
}

export interface LoadedProjectCurrent {
  target: ProjectCurrentTarget;
  watchInputs: readonly string[];
}

export async function loadProjectCurrent(
  cwd: string,
  options: LoadProjectCurrentOptions = {},
): Promise<LoadedProjectCurrent> {
  const discoveryOptions = { freshImport: options.freshImport };
  // namespaced fresh import 是进程级 loader 边界，按顺序装载，避免三棵图并发注册互相卡住。
  const config = await loadConfigFile(cwd, discoveryOptions);
  const evals = await discoverEvals(cwd, discoveryOptions);
  const experiments = await discoverExperiments(cwd, discoveryOptions);
  const selectors = options.experiments === undefined
    ? []
    : Array.isArray(options.experiments) ? options.experiments : [options.experiments];
  const selectedIds = selectors.length === 0
    ? new Set(experiments.map((entry) => entry.id))
    : new Set(selectors.flatMap((selector) => matchExperimentSelector(
        experiments.map((entry) => entry.id),
        selector,
      )));
  const runs: AgentRun[] = [];
  for (const experiment of experiments) {
    if (!selectedIds.has(experiment.id)) continue;
    const { selectedEvalIds } = resolveExperimentEvals({
      experimentId: experiment.id,
      selector: experiment.evals,
      cliPatterns: [...(options.evals ?? [])],
      evals,
    });
    runs.push({
      agent: experiment.agent,
      model: experiment.model,
      reasoningEffort: experiment.reasoningEffort,
      flags: experiment.flags ?? {},
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
      strict: undefined,
      setup: experiment.setup,
      teardown: experiment.teardown,
      classifyFailure: experiment.classifyFailure,
    });
  }
  const plan: ProjectTargetPlan = await Effect.runPromise(
    planProjectTarget(evals, runs, config.timeoutMs, { configJudge: config.judge }),
  );
  return {
    target: plan.target,
    watchInputs: Object.freeze([
      ...new Set([`${cwd}/niceeval.config.ts`, ...plan.watchInputs]),
    ].sort()),
  };
}
