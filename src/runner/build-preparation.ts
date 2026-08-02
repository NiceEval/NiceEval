// PreparedRunPair -> Run 级构建工作。provider-specific 解析留在 sandbox/runtime；
// 本模块只去重 BuildKey、路由 provider，并跳过已经完整携带的 pair。

import { Effect, Option } from "effect";
import type { SandboxBuildProvider, SandboxBuildWork } from "../sandbox/build-coordinator.ts";
import { routeBuildProviders } from "../sandbox/dockerfile-build.ts";
import type { BuildKey } from "../sandbox/identity.ts";
import {
  collectSandboxRuntimeBuildPreparation,
  SandboxRuntimeMaterializationError,
} from "../sandbox/runtime.ts";
import type { PreparedRunPair } from "./sandbox-selection.ts";
import type { RunOptions } from "./types.ts";

export interface CollectedBuildPreparation {
  readonly works: readonly SandboxBuildWork[];
  readonly evalBuildKeys: Readonly<globalThis.Record<string, readonly string[]>>;
  readonly provider: SandboxBuildProvider;
}

/**
 * CarryPlan 完成后收集 fresh pair 所需构建。输入已经是不可变 physical plan；这里不再读取
 * Eval/Experiment 声明，也不做 template/provider 二次选择。
 */
export function collectBuildPreparation(opts: {
  readonly preparedPairs: readonly PreparedRunPair[];
  readonly carriedAttemptsByKey: ReadonlyMap<string, ReadonlySet<number>>;
  /** 测试可注入单一 provider；生产默认按每条 BuildKey 的 ProviderModule 路由。 */
  readonly provider?: SandboxBuildProvider;
}): Effect.Effect<
  Option.Option<CollectedBuildPreparation>,
  SandboxRuntimeMaterializationError
> {
  return Effect.gen(function* () {
    const worksByKey = new Map<BuildKey, SandboxBuildWork>();
    const providerByKey = new Map<BuildKey, SandboxBuildProvider>();
    const evalBuildKeys = new Map<string, string[]>();

    for (const pair of opts.preparedPairs) {
      const carried = opts.carriedAttemptsByKey.get(pair.key);
      if (carried !== undefined && carried.size >= pair.run.attempts) continue;
      if (pair.plan._tag === "Direct") continue;

      const collection = yield* collectSandboxRuntimeBuildPreparation(pair.plan, pair.evalDef.id);
      if (pair.plan.providerPlan.build._tag === "None") {
        if (Option.isSome(collection) && collection.value.works.length > 0) {
          return yield* new SandboxRuntimeMaterializationError({
            code: "sandbox.build-input-drift",
            provider: pair.plan.providerPlan.provider,
            message: "Provider planned no builds but returned build work during collection.",
            cause: new Error("unexpected build work"),
          });
        }
        continue;
      }
      if (Option.isNone(collection)) {
        return yield* new SandboxRuntimeMaterializationError({
          code: "sandbox.build-input-drift",
          provider: pair.plan.providerPlan.provider,
          message: "Provider planned required builds but returned no build collection.",
          cause: new Error("required build collection missing"),
        });
      }
      const collected = collection.value;
      const plannedKeys = pair.plan.providerPlan.build.buildKeys;
      const collectedKeys = collected.works.map((work) => work.buildKey).sort();
      if (plannedKeys.length !== collectedKeys.length || [...plannedKeys].sort().some((key, i) => key !== collectedKeys[i])) {
        return yield* new SandboxRuntimeMaterializationError({
          code: "sandbox.build-input-drift",
          provider: pair.plan.providerPlan.provider,
          message: "Build collection keys differ from the physical plan.",
          cause: new Error("build key mismatch"),
        });
      }
      const keys: string[] = [];
      for (const work of collected.works) {
        if (!worksByKey.has(work.buildKey)) worksByKey.set(work.buildKey, work);
        providerByKey.set(work.buildKey, opts.provider ?? collected.provider);
        if (!keys.includes(work.buildKey)) keys.push(work.buildKey);
      }
      if (keys.length > 0) evalBuildKeys.set(pair.key, keys);
    }

    if (worksByKey.size === 0) return Option.none();
    const provider = opts.provider ?? routeBuildProviders(providerByKey);
    return Option.some(Object.freeze({
      works: Object.freeze([...worksByKey.values()]),
      evalBuildKeys: Object.freeze(Object.fromEntries(evalBuildKeys)),
      provider,
    }));
  });
}

/** 把收集结果压成 RunOptions.buildPreparation。 */
export function toBuildPreparation(
  collected: CollectedBuildPreparation,
): Option.Option<NonNullable<RunOptions["buildPreparation"]>> {
  if (collected.works.length === 0) return Option.none();
  return Option.some({
    works: collected.works,
    evalBuildKeys: collected.evalBuildKeys,
    provider: collected.provider,
  });
}
