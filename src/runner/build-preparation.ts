// PreparedRunPair -> Run 级构建工作。provider-specific 解析留在 sandbox/runtime；
// 本模块只去重 BuildKey、路由 provider，并跳过已经完整携带的 pair。

import { Effect, Option } from "effect";
import type { SandboxBuildProvider, SandboxBuildWork } from "../sandbox/build-coordinator.ts";
import { routeBuildProviders } from "../sandbox/dockerfile-build.ts";
import { digestOf, type BuildKey } from "../sandbox/identity.ts";
import { collectSandboxRuntimeBuildPreparation } from "../sandbox/runtime.ts";
import type { PreparedRunPair } from "./sandbox-selection.ts";
import type { RunOptions } from "./types.ts";

export interface CollectedBuildPreparation {
  readonly works: readonly SandboxBuildWork[];
  readonly evalBuildKeys: Readonly<globalThis.Record<string, readonly string[]>>;
  readonly provider: SandboxBuildProvider;
  readonly caseKeys: ReadonlyMap<string, string>;
}

/**
 * CarryPlan 完成后收集 fresh pair 所需构建。输入已经是不可变 physical plan；这里不再读取
 * Eval/Experiment 声明，也不做 template/provider 二次选择。
 */
export async function collectBuildPreparation(opts: {
  readonly preparedPairs: readonly PreparedRunPair[];
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  /** 测试可注入单一 provider；生产默认按每条 BuildKey 的 adapter provider 路由。 */
  readonly provider?: SandboxBuildProvider;
}): Promise<CollectedBuildPreparation | undefined> {
  const worksByKey = new Map<BuildKey, SandboxBuildWork>();
  const providerByKey = new Map<BuildKey, SandboxBuildProvider>();
  const evalBuildKeys = new Map<string, string[]>();
  const caseKeys = new Map<string, string>();

  for (const pair of opts.preparedPairs) {
    const carried = opts.carriedAttemptsByKey.get(pair.key);
    if (carried !== undefined && carried.size >= pair.run.attempts) continue;
    if (pair.plan._tag === "Direct") continue;

    const collection = await Effect.runPromise(
      collectSandboxRuntimeBuildPreparation(pair.plan, pair.evalDef.id),
    );
    if (Option.isNone(collection)) {
      caseKeys.set(pair.key, digestOf({ version: 1, providerPlan: pair.plan.providerPlan.identity }));
      continue;
    }
    const collected = collection.value;

    caseKeys.set(pair.key, collected.caseKey);
    const keys: string[] = [];
    for (const work of collected.works) {
      if (!worksByKey.has(work.buildKey)) worksByKey.set(work.buildKey, work);
      providerByKey.set(work.buildKey, opts.provider ?? collected.provider);
      if (!keys.includes(work.buildKey)) keys.push(work.buildKey);
    }
    if (keys.length > 0) evalBuildKeys.set(pair.key, keys);
  }

  if (worksByKey.size === 0 && caseKeys.size === 0) return undefined;
  const provider = opts.provider ?? routeBuildProviders(providerByKey);
  return Object.freeze({
    works: Object.freeze([...worksByKey.values()]),
    evalBuildKeys: Object.freeze(Object.fromEntries(evalBuildKeys)),
    provider,
    caseKeys,
  });
}

/** 把收集结果压成 RunOptions.buildPreparation；无构建时仅保留 caseKeys，不启动协调器。 */
export function toBuildPreparation(
  collected: CollectedBuildPreparation,
): NonNullable<RunOptions["buildPreparation"]> | undefined {
  if (collected.works.length === 0) return undefined;
  return {
    works: collected.works,
    evalBuildKeys: collected.evalBuildKeys,
    provider: collected.provider,
  };
}
