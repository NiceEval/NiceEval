// ExperimentDef.sandbox 的规划期解析:spec 携带 environments 表时,按每条选中 eval 的
// `environment` profile 查表派生该 eval 的具体 spec;缺表项在创建任何沙箱、计算 carry 或
// 选择全局并发之前一次性穷举报错。指纹、并发预算、attempt 创建与结果审计全部消费这同一份
// 解析结果(见 docs/feature/experiments/library.md「不同 eval 起自不同预制环境」)。

import { sandboxRecommendedConcurrency, sandboxRunInfo } from "../sandbox/resolve.ts";
import type { DiscoveredEval, SandboxOption, SandboxRunInfo } from "../types.ts";
import type { AgentRun } from "./types.ts";

/** environments 表是内置 provider spec 的数据字段;这里只做查表,不认 provider 名。 */
function specEnvironments(spec: SandboxOption): Readonly<globalThis.Record<string, globalThis.Record<string, unknown>>> | undefined {
  const environments = (spec as { environments?: unknown }).environments;
  if (typeof environments !== "object" || environments === null) return undefined;
  return environments as Readonly<globalThis.Record<string, globalThis.Record<string, unknown>>>;
}

/** 按 profile 派生该 eval 的具体 spec(浅覆盖预制产物槽位,hooks 与其余参数共享);缺表项返回 undefined。 */
function deriveSpec(spec: SandboxOption, profile: string): SandboxOption | undefined {
  const override = specEnvironments(spec)?.[profile];
  if (override === undefined) return undefined;
  return { ...spec, ...override } as SandboxOption;
}

function missingEnvironmentsError(run: AgentRun, missing: ReadonlyArray<readonly [string, string]>): Error {
  const entries = missing.map(([id, profile]) => `  ${id} → ${JSON.stringify(profile)}`).join("\n");
  return new Error(
    `sandbox spec for experiment ${JSON.stringify(run.experimentId ?? run.agent.name)} has no environments entry for:\n${entries}\n` +
      `add the missing profile(s) to the spec's environments table — dockerSandbox({ environments: { "<profile>": { image } } }), ` +
      `e2bSandbox({ environments: { "<profile>": { template } } }), vercelSandbox({ environments: { "<profile>": { snapshotId } } }) — ` +
      `or fix the eval's environment declaration`,
  );
}

/** 该 eval 实际起步的 spec:未声明 environment 用基础 spec;声明了则查表派生并缓存。 */
export function sandboxForEval(run: AgentRun, evalDef: DiscoveredEval, fallback?: SandboxOption): SandboxOption | undefined {
  if (run.agent.kind !== "sandbox") return undefined;
  const spec = run.sandbox ?? fallback;
  if (spec === undefined || evalDef.environment === undefined) return spec;

  const cached = run.resolvedSandboxes?.get(evalDef.id);
  if (cached !== undefined) return cached;

  const derived = deriveSpec(spec, evalDef.environment);
  if (derived === undefined) throw missingEnvironmentsError(run, [[evalDef.id, evalDef.environment]]);
  const cache = run.resolvedSandboxes ?? new Map<string, SandboxOption>();
  cache.set(evalDef.id, derived);
  run.resolvedSandboxes = cache;
  return derived;
}

/** 在 dry-run / carry / concurrency / attempt 展开之前一次性查表;全部缺项一次穷举,不等到花费发生后才出现。 */
export function prepareRunSandboxes(evals: DiscoveredEval[], runs: AgentRun[], fallback?: SandboxOption): void {
  for (const run of runs) {
    if (run.agent.kind !== "sandbox") continue;
    const spec = run.sandbox ?? fallback;
    if (spec === undefined) continue; // 缺 spec 的错误由既有 resolveSandbox 路径按原文案报
    const selectedIds = new Set(run.selectedEvalIds);
    const missing: Array<readonly [string, string]> = [];
    for (const evalDef of evals) {
      if (!selectedIds.has(evalDef.id) || evalDef.environment === undefined) continue;
      if (run.resolvedSandboxes?.has(evalDef.id)) continue;
      const derived = deriveSpec(spec, evalDef.environment);
      if (derived === undefined) {
        missing.push([evalDef.id, evalDef.environment]);
        continue;
      }
      const cache = run.resolvedSandboxes ?? new Map<string, SandboxOption>();
      cache.set(evalDef.id, derived);
      run.resolvedSandboxes = cache;
    }
    if (missing.length > 0) throw missingEnvironmentsError(run, missing);
  }
}

/** ExperimentRunInfo 的 sandbox 投影:顶层恒为基础 spec;sandboxByEval 只含声明了 environment 的选中 eval。 */
export function sandboxProjection(run: AgentRun, fallback?: SandboxOption): {
  sandbox?: SandboxRunInfo;
  sandboxByEval?: globalThis.Record<string, SandboxRunInfo>;
} {
  if (run.agent.kind !== "sandbox") return {};
  const sandbox = sandboxRunInfo(run.sandbox ?? fallback);
  const entries = [...(run.resolvedSandboxes ?? new Map<string, SandboxOption>()).entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const sandboxByEval: globalThis.Record<string, SandboxRunInfo> = {};
  for (const [evalId, derived] of entries) {
    const info = sandboxRunInfo(derived);
    if (info !== undefined) sandboxByEval[evalId] = info;
  }
  return {
    ...(sandbox !== undefined ? { sandbox } : {}),
    ...(entries.length > 0 ? { sandboxByEval } : {}),
  };
}

export function resolvedSandboxRecommendedConcurrency(
  evals: DiscoveredEval[],
  runs: AgentRun[],
  fallback?: SandboxOption,
): number {
  prepareRunSandboxes(evals, runs, fallback);
  const recommendations: number[] = [];
  for (const run of runs) {
    if (run.agent.kind !== "sandbox") continue;
    const selectedIds = new Set(run.selectedEvalIds);
    for (const evalDef of evals) {
      if (!selectedIds.has(evalDef.id)) continue;
      recommendations.push(sandboxRecommendedConcurrency(sandboxForEval(run, evalDef, fallback)));
    }
  }
  return recommendations.length > 0 ? Math.min(...recommendations) : 10;
}
