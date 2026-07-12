// e2e 共享 experiment factory(docs/engineering/e2e-ci/README.md 第 4 节的 L0 档):
// runs: 3 + earlyExit 吸收真实模型的单次抖动;连续 3 次不过的是真回归,矩阵照样红。
// verdicts 实验只排 deliberate-* fixture,由 verify.mjs 以"期望 exit 1"消费。
import { defineExperiment } from "niceeval";
import type { Agent, ExperimentDef } from "niceeval";

export interface CiExperimentOptions {
  /** 额外排除的 eval id 前缀(除了固定排除的 "deliberate-")。
   *  沙箱型项目用它把"需要特殊 agent 配置才能过"的正例(见 featuresExperiment)挡在 ci 组外面。 */
  excludeIdPrefixes?: string[];
  /** 覆盖默认 runs(3)。沙箱型 agent 每次 attempt 都要重装 CLI,更贵更慢,通常调小。 */
  runs?: number;
  /** 覆盖默认 budget(1 美元)。 */
  budget?: number;
}

export function ciExperiment(agent: Agent, opts: CiExperimentOptions = {}): ExperimentDef {
  const excludePrefixes = ["deliberate-", ...(opts.excludeIdPrefixes ?? [])];
  return defineExperiment({
    description: `ci:共享套件 L0 门禁(${agent.name})`,
    agent,
    runs: opts.runs ?? 3,
    earlyExit: true,
    evals: (id) => !excludePrefixes.some((prefix) => id.startsWith(prefix)),
    budget: opts.budget ?? 1,
  });
}

/**
 * features 实验(沙箱矩阵专用):只跑 "feature-" 前缀的正例——skills / MCP 这类需要
 * agent 额外挂载配置才可能通过的用例。基线组(ci 实验用的 agent)没挂这些配置,
 * 把正例放进 ci 会必然假失败;反例(skill-absent / mcp-absent)恰恰要留在 ci 组,
 * 用基线 agent 验证"没挂就是没挂"。
 */
export function featuresExperiment(agent: Agent, opts: { runs?: number; budget?: number } = {}): ExperimentDef {
  return defineExperiment({
    description: `features:skills/MCP 正例,需要专门配置的 agent(${agent.name})`,
    agent,
    runs: opts.runs ?? 2,
    earlyExit: true,
    evals: (id) => id.startsWith("feature-"),
    budget: opts.budget ?? 2,
  });
}

export function verdictsExperiment(agent: Agent) {
  return defineExperiment({
    description: `verdicts:故意红 fixture,期望进程 exit 1(${agent.name})`,
    agent,
    runs: 1,
    evals: (id) => id.startsWith("deliberate-"),
    budget: 1,
  });
}
