// discovery + selector 后的 pair-owned Sandbox 规划。
// 本模块不修改 AgentRun；check 消费 link 结果，dry/run 消费同一批 immutable prepared pairs。

import { Data, Effect } from "effect";
import { digestOf } from "../sandbox/identity.ts";
import {
  linkSandboxLayers,
  type LinkedSandboxLayerPair,
  type SandboxLayerLinkError,
  type SandboxLayerPairInput,
} from "../sandbox/link.ts";
import {
  linkedRunRecordIdentity,
  liveSandboxPlanningServices,
  planLinkedRuns,
  providerPlanRecordIdentity,
  type LinkedRunPlan,
  type SandboxPhysicalCapabilityRequirement,
  type SandboxPlanningServices,
  type SandboxPhysicalPlanningError,
} from "../sandbox/plan.ts";
import { selectedEvalsForRun } from "./eval-selection.ts";
import type { AgentRun, DiscoveredEval, SandboxRunInfo } from "./types.ts";

export interface LinkedRunPair {
  readonly key: string;
  readonly run: AgentRun;
  readonly evalDef: DiscoveredEval;
  readonly pair: LinkedSandboxLayerPair;
  readonly authorBaseDirs: {
    readonly eval: string;
    readonly experiment: string;
  };
}

export interface PreparedRunPair {
  readonly key: string;
  readonly run: AgentRun;
  readonly evalDef: DiscoveredEval;
  readonly plan: LinkedRunPlan;
  readonly identity: ReturnType<typeof linkedRunRecordIdentity>;
}

export class SandboxRunPlanningInvariantError extends Data.TaggedError(
  "SandboxRunPlanningInvariantError",
)<{
  readonly code: "sandbox.run-planning-invariant";
  readonly message: string;
}> {}

export interface DuplicateSandboxRunPair {
  readonly key: string;
  readonly experimentId: string;
  readonly evalId: string;
  readonly occurrences: number;
}

export class SandboxRunPairDuplicateError extends Data.TaggedError(
  "SandboxRunPairDuplicateError",
)<{
  readonly code: "sandbox.duplicate-run-pair";
  readonly duplicates: readonly DuplicateSandboxRunPair[];
  readonly message: string;
}> {}

export type SandboxRunPlanningError =
  | SandboxLayerLinkError
  | SandboxPhysicalPlanningError
  | SandboxRunPlanningInvariantError
  | SandboxRunPairDuplicateError;

export interface SandboxRunPlanningOptions {
  readonly keepSandbox?: "failed" | "all";
  readonly configTimeoutMs?: number;
}

function physicalCapabilityRequirements(
  run: AgentRun,
  evalDef: DiscoveredEval,
  options: SandboxRunPlanningOptions,
): readonly SandboxPhysicalCapabilityRequirement[] {
  const requirements: SandboxPhysicalCapabilityRequirement[] = [];
  if (run.sandboxReuse === true || evalDef.evalGroup !== undefined) {
    requirements.push(Object.freeze({ _tag: "Reuse" }));
  }
  if (options.keepSandbox !== undefined) requirements.push(Object.freeze({ _tag: "Retention" }));
  const timeoutMs = run.timeoutMs ?? evalDef.timeoutMs ?? options.configTimeoutMs;
  if (timeoutMs !== undefined) {
    requirements.push(Object.freeze({ _tag: "SessionDuration", milliseconds: timeoutMs }));
  }
  return Object.freeze(requirements);
}

/** Injective tuple encoding keeps `(a|b,c)` distinct from `(a,b|c)` without forbidding characters in either id. */
export function runPairKey(experimentId: string, evalId: string): string {
  return experimentId.includes("|") || evalId.includes("|")
    ? JSON.stringify([experimentId, evalId])
    : `${experimentId}|${evalId}`;
}

function linkedOwnerKey(pair: LinkedSandboxLayerPair): string {
  return JSON.stringify([pair.experimentId, pair.evalId, pair.agentName]);
}

/** 纯 link：全矩阵聚合错误，不读 provider 文件，不做网络或资源操作。 */
export function linkRunSandboxes(
  evals: readonly DiscoveredEval[],
  runs: readonly AgentRun[],
): Effect.Effect<
  readonly LinkedRunPair[],
  SandboxLayerLinkError | SandboxRunPlanningInvariantError | SandboxRunPairDuplicateError
> {
  const records: Array<Readonly<{
    input: SandboxLayerPairInput;
    ownerKey: string;
    key: string;
    run: AgentRun;
    evalDef: DiscoveredEval;
    authorBaseDirs: {
      readonly eval: string;
      readonly "eval-group"?: string;
      readonly experiment: string;
    };
  }>> = [];

  for (const run of runs) {
    const { experimentId, experimentBaseDir, experimentSourcePath } = run;
    if (experimentId === undefined || experimentBaseDir === undefined || experimentSourcePath === undefined) {
      return Effect.fail(new SandboxRunPlanningInvariantError({
        code: "sandbox.run-planning-invariant",
        message: "Sandbox planning requires completed Experiment discovery facts: id, baseDir, and sourcePath.",
      }));
    }
    for (const evalDef of selectedEvalsForRun(evals, run)) {
      if (evalDef.evalGroup !== undefined && run.sandboxReuse === true) {
        return Effect.fail(new SandboxRunPlanningInvariantError({
          code: "sandbox.run-planning-invariant",
          message: `eval-group-sandbox-reuse-conflict: Experiment ${JSON.stringify(experimentId)} selects Eval Group ${JSON.stringify(evalDef.evalGroup.id)} while declaring sandboxReuse: true. Eval Groups own reuse; remove sandboxReuse.`,
        }));
      }
      const input: SandboxLayerPairInput = {
        eval: {
          id: evalDef.id,
          layer: evalDef.sandbox,
          declaredAt: { file: evalDef.sourcePath },
        },
        ...(evalDef.evalGroup === undefined ? {} : { group: {
          id: evalDef.evalGroup.id,
          layer: evalDef.evalGroup.sandbox,
          declaredAt: { file: evalDef.evalGroup.sourcePath },
        } }),
        experiment: {
          id: experimentId,
          layer: run.sandbox,
          declaredAt: { file: experimentSourcePath },
        },
        agent: { kind: run.agent.kind, name: run.agent.name },
      };
      records.push(Object.freeze({
        input,
        ownerKey: JSON.stringify([experimentId, evalDef.id, run.agent.name]),
        key: runPairKey(experimentId, evalDef.id),
        run,
        evalDef,
        authorBaseDirs: Object.freeze({
          eval: evalDef.baseDir,
          ...(evalDef.evalGroup === undefined ? {} : { "eval-group": evalDef.evalGroup.baseDir }),
          experiment: experimentBaseDir,
        }),
      }));
    }
  }

  const occurrences = new Map<string, { experimentId: string; evalId: string; count: number }>();
  for (const { key, input } of records) {
    const previous = occurrences.get(key);
    occurrences.set(key, {
      experimentId: input.experiment.id,
      evalId: input.eval.id,
      count: (previous?.count ?? 0) + 1,
    });
  }
  const duplicates = [...occurrences.entries()]
    .filter(([, entry]) => entry.count > 1)
    .map(([key, entry]) => Object.freeze({
      key,
      experimentId: entry.experimentId,
      evalId: entry.evalId,
      occurrences: entry.count,
    }));
  if (duplicates.length > 0) {
    return Effect.fail(new SandboxRunPairDuplicateError({
      code: "sandbox.duplicate-run-pair",
      duplicates: Object.freeze(duplicates),
      message:
        `Sandbox planning received ${duplicates.length} duplicate (Experiment, Eval) pair` +
        `${duplicates.length === 1 ? "" : "s"}. Every discovered pair must have one owner.`,
    }));
  }

  return Effect.flatMap(linkSandboxLayers(records.map(({ input }) => input)), (pairs) => {
    const ownersByKey = new Map<string, typeof records>();
    for (const record of records) {
      const queue = ownersByKey.get(record.ownerKey) ?? [];
      ownersByKey.set(record.ownerKey, [...queue, record]);
    }
    const linked: LinkedRunPair[] = [];
    for (const pair of pairs) {
      const ownerKey = linkedOwnerKey(pair);
      const queue = ownersByKey.get(ownerKey);
      if (queue === undefined || queue.length === 0) {
        return Effect.fail(new SandboxRunPlanningInvariantError({
          code: "sandbox.run-planning-invariant",
          message: `Sandbox linker returned an unowned pair ${ownerKey}.`,
        }));
      }
      const [owner, ...remaining] = queue;
      if (owner === undefined) {
        return Effect.fail(new SandboxRunPlanningInvariantError({
          code: "sandbox.run-planning-invariant",
          message: `Sandbox owner queue was empty for ${ownerKey}.`,
        }));
      }
      ownersByKey.set(ownerKey, remaining);
      linked.push(Object.freeze({
        key: owner.key,
        run: owner.run,
        evalDef: owner.evalDef,
        pair,
        authorBaseDirs: owner.authorBaseDirs,
      }));
    }
    const remaining = [...ownersByKey.values()].reduce((count, queue) => count + queue.length, 0);
    if (remaining !== 0) {
      return Effect.fail(new SandboxRunPlanningInvariantError({
        code: "sandbox.run-planning-invariant",
        message: `Sandbox linker omitted ${remaining} owned pair${remaining === 1 ? "" : "s"}.`,
      }));
    }
    return Effect.succeed(Object.freeze(linked));
  });
}

/**
 * 唯一 physical planning 入口。每条输出直接持有自己的 LinkedRunPlan；后续 fingerprint、
 * Attempt 与 reuse 传递这份值，不再回到 AgentRun 查可变 Map。
 */
export function prepareRunSandboxes(
  evals: readonly DiscoveredEval[],
  runs: readonly AgentRun[],
  services: SandboxPlanningServices = liveSandboxPlanningServices(),
  options: SandboxRunPlanningOptions = {},
): Effect.Effect<readonly PreparedRunPair[], SandboxRunPlanningError> {
  return Effect.flatMap(linkRunSandboxes(evals, runs), (linkedPairs) =>
    Effect.flatMap(
      planLinkedRuns(linkedPairs.map(({ pair, authorBaseDirs, run, evalDef }) => ({
        pair,
        authorBaseDirs,
        requirements: physicalCapabilityRequirements(run, evalDef, options),
      })), services),
      (planned) => {
        const linkedByPair = new Map(linkedPairs.map((linked) => [linkedOwnerKey(linked.pair), linked]));
        const prepared: PreparedRunPair[] = [];
        for (const { pair, plan } of planned) {
          const linked = linkedByPair.get(linkedOwnerKey(pair));
          if (linked === undefined) {
            return Effect.fail(new SandboxRunPlanningInvariantError({
              code: "sandbox.run-planning-invariant",
              message: `Physical planner returned an unowned pair ${linkedOwnerKey(pair)}.`,
            }));
          }
          prepared.push(Object.freeze({
            key: linked.key,
            run: linked.run,
            evalDef: linked.evalDef,
            plan,
            identity: linkedRunRecordIdentity(plan),
          }));
        }
        if (prepared.length !== linkedPairs.length) {
          return Effect.fail(new SandboxRunPlanningInvariantError({
            code: "sandbox.run-planning-invariant",
            message: `Physical planner returned ${prepared.length} of ${linkedPairs.length} linked pairs.`,
          }));
        }
        const groupPlans = new Map<string, string>();
        for (const entry of prepared) {
          const group = entry.evalDef.evalGroup;
          if (group === undefined || entry.plan._tag !== "Sandbox") continue;
          const key = JSON.stringify([entry.run.experimentId, group.id]);
          const physical = digestOf(entry.plan.providerPlan.identity);
          const previous = groupPlans.get(key);
          if (previous !== undefined && previous !== physical) {
            return Effect.fail(new SandboxRunPlanningInvariantError({
              code: "sandbox.run-planning-invariant",
              message: `eval-group-incompatible: Eval Group ${JSON.stringify(group.id)} has different physical Sandbox plans across its selected members in Experiment ${JSON.stringify(entry.run.experimentId)}. Split the group by compatible template/provider identity.`,
            }));
          }
          groupPlans.set(key, physical);
        }
        return Effect.succeed(Object.freeze(prepared));
      },
    ),
  );
}

export function preparedPairsByKey(
  pairs: readonly PreparedRunPair[],
): ReadonlyMap<string, PreparedRunPair> {
  const snapshot = new Map(pairs.map((pair) => [pair.key, pair]));
  let view: ReadonlyMap<string, PreparedRunPair>;
  view = {
    get size() { return snapshot.size; },
    get: (key: string) => snapshot.get(key),
    has: (key: string) => snapshot.has(key),
    forEach: (
      callback: (value: PreparedRunPair, key: string, map: ReadonlyMap<string, PreparedRunPair>) => void,
      thisArg?: unknown,
    ) => snapshot.forEach((value, key) => callback.call(thisArg, value, key, view)),
    entries: () => snapshot.entries(),
    keys: () => snapshot.keys(),
    values: () => snapshot.values(),
    [Symbol.iterator]: () => snapshot[Symbol.iterator](),
  };
  return Object.freeze(view);
}

/** 结果记录只投影当前 pair 的实际计划，不虚构 Experiment 级默认 Sandbox。 */
export function sandboxRunInfoForPlan(
  plan: Extract<LinkedRunPlan, { readonly _tag: "Sandbox" }>,
): SandboxRunInfo {
  const identity = providerPlanRecordIdentity(plan.providerPlan);
  return Object.freeze({
    provider: plan.providerPlan.provider,
    params: { plan: identity },
    fingerprint: digestOf(identity),
  });
}

export interface PreparedSandboxScheduling {
  readonly recommendedConcurrency: number;
  readonly exclusive: boolean;
  readonly lanes: readonly {
    readonly key: string;
    readonly limit: number;
    readonly admission: "Shared" | "Exclusive";
  }[];
}

/** 调度器只消费 provider planner 给出的中性 lane/admission 元数据。 */
export function schedulingForPreparedPairs(
  pairs: readonly PreparedRunPair[],
): PreparedSandboxScheduling {
  const lanes = new Map<string, { key: string; limit: number; admission: "Shared" | "Exclusive" }>();
  for (const { plan } of pairs) {
    if (plan._tag === "Direct") continue;
    const scheduling = plan.providerPlan.scheduling;
    const admission = scheduling.admission._tag;
    const current = lanes.get(scheduling.lane.key);
    if (current === undefined) {
      lanes.set(scheduling.lane.key, {
        key: scheduling.lane.key,
        limit: scheduling.lane.limit,
        admission,
      });
      continue;
    }
    lanes.set(scheduling.lane.key, {
      key: current.key,
      limit: Math.min(current.limit, scheduling.lane.limit),
      admission: current.admission === "Exclusive" || admission === "Exclusive" ? "Exclusive" : "Shared",
    });
  }
  const values = Object.freeze([...lanes.values()].map((lane) => Object.freeze(lane)));
  return Object.freeze({
    recommendedConcurrency: values.length === 0 ? 10 : Math.min(...values.map(({ limit }) => limit)),
    exclusive: values.some(({ admission }) => admission === "Exclusive"),
    lanes: values,
  });
}

export function recommendedConcurrencyForPreparedPairs(pairs: readonly PreparedRunPair[]): number {
  return schedulingForPreparedPairs(pairs).recommendedConcurrency;
}
