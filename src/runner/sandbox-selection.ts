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
import {
  linkPluginPair,
  pluginLinkErrorFromIssues,
  preparePluginRun,
  PluginLinkError,
  type PluginPairLink,
} from "../plugin/link.ts";
import {
  createSelectedResourceEnvelope,
  ResourceEnvelopeConflictError,
  type ResourcePhysicalCohort,
  type SelectedResourceDemand,
  type SelectedResourceEnvelope,
} from "../plugin/resource-runtime.ts";
import { sandboxReusePoolDescriptor } from "./sandbox-reuse.ts";

export interface LinkedRunPair {
  readonly key: string;
  /** Original caller run; effective Plugin composition is held in `run`. */
  readonly sourceRun: AgentRun;
  readonly run: AgentRun;
  readonly evalDef: DiscoveredEval;
  readonly pair: LinkedSandboxLayerPair;
  readonly plugin: PluginPairLink;
  readonly authorBaseDirs: {
    readonly eval: string;
    readonly experiment: string;
  };
}

export interface PreparedRunPair {
  readonly key: string;
  readonly sourceRun: AgentRun;
  readonly run: AgentRun;
  readonly evalDef: DiscoveredEval;
  readonly plan: LinkedRunPlan;
  readonly identity: ReturnType<typeof linkedRunRecordIdentity>;
  readonly plugin: PluginPairLink;
  /** Frozen before carry: selected demand envelope for this actual physical cohort. */
  readonly resourceEnvelope?: SelectedResourceEnvelope;
}

export class SandboxRunPlanningInvariantError extends Data.TaggedError(
  "SandboxRunPlanningInvariantError",
)<{
  readonly code:
    | "sandbox.run-planning-invariant"
    | "eval-group-sandbox-reuse-conflict"
    | "eval-group-incompatible";
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
  | SandboxRunPairDuplicateError
  | PluginLinkError
  | ResourceEnvelopeConflictError;

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

/**
 * A cohort names the actual physical lifecycle, never an author declaration
 * position. Group members share one; ordinary fresh pairs intentionally do
 * not, even when their provider template happens to be identical.
 */
function resourceCohortFor(entry: Omit<PreparedRunPair, "resourceEnvelope">): ResourcePhysicalCohort | undefined {
  if (entry.plan._tag === "Direct") return undefined;
  const physical = digestOf(entry.plan.providerPlan.identity);
  const experimentId = entry.run.experimentId;
  const descriptor = sandboxReusePoolDescriptor({
    run: entry.run,
    evalId: entry.evalDef.id,
    ...(entry.evalDef.evalGroup === undefined ? {} : { evalGroupId: entry.evalDef.evalGroup.id }),
    plan: entry.plan,
  });
  if (descriptor?.scope.kind === "eval-group") {
    return Object.freeze({
      kind: "eval-group" as const,
      id: JSON.stringify(["eval-group", experimentId, descriptor.key]),
      physical,
    });
  }
  if (descriptor !== undefined) {
    return Object.freeze({
      kind: "sandbox-reuse" as const,
      id: JSON.stringify(["sandbox-reuse", experimentId, descriptor.key]),
      physical,
    });
  }
  return Object.freeze({
    kind: "fresh-pair" as const,
    id: JSON.stringify(["fresh-pair", experimentId, entry.evalDef.id, physical]),
    physical,
  });
}

/** 纯 link：全矩阵聚合错误，不读 provider 文件，不做网络或资源操作。 */
export function linkRunSandboxes(
  evals: readonly DiscoveredEval[],
  runs: readonly AgentRun[],
): Effect.Effect<
  readonly LinkedRunPair[],
  SandboxLayerLinkError | SandboxRunPlanningInvariantError | SandboxRunPairDuplicateError | PluginLinkError
> {
  const records: Array<Readonly<{
    input: SandboxLayerPairInput;
    ownerKey: string;
    key: string;
    sourceRun: AgentRun;
    run: AgentRun;
    evalDef: DiscoveredEval;
    plugin: PluginPairLink;
    authorBaseDirs: {
      readonly eval: string;
      readonly "eval-group"?: string;
      readonly experiment: string;
    };
  }>> = [];

  const pluginRuns = new Map<AgentRun, ReturnType<typeof preparePluginRun>>();
  const pluginIssues: import("../plugin/link.ts").PluginLinkIssue[] = [];
  for (const sourceRun of runs) {
    try {
      pluginRuns.set(sourceRun, preparePluginRun(sourceRun));
    } catch (error) {
      if (error instanceof PluginLinkError) pluginIssues.push(...error.issues);
      else throw error;
    }
  }
  if (pluginIssues.length > 0) return Effect.fail(pluginLinkErrorFromIssues(pluginIssues));

  for (const sourceRun of runs) {
    const pluginRun = pluginRuns.get(sourceRun);
    if (pluginRun === undefined) {
      return Effect.fail(new SandboxRunPlanningInvariantError({
        code: "sandbox.run-planning-invariant",
        message: "Plugin run preparation omitted a discovered AgentRun.",
      }));
    }
    const run = pluginRun.run;
    const { experimentId, experimentBaseDir, experimentSourcePath } = run;
    if (experimentId === undefined || experimentBaseDir === undefined || experimentSourcePath === undefined) {
      return Effect.fail(new SandboxRunPlanningInvariantError({
        code: "sandbox.run-planning-invariant",
        message: "Sandbox planning requires completed Experiment discovery facts: id, baseDir, and sourcePath.",
      }));
    }
    for (const evalDef of selectedEvalsForRun(evals, sourceRun)) {
      if (evalDef.evalGroup !== undefined && run.sandboxReuse === true) {
        return Effect.fail(new SandboxRunPlanningInvariantError({
          code: "eval-group-sandbox-reuse-conflict",
          message: `Experiment ${JSON.stringify(experimentId)} selects Eval Group ${JSON.stringify(evalDef.evalGroup.id)} while declaring sandboxReuse: true. Eval Groups own reuse; remove sandboxReuse.`,
        }));
      }
      let plugin: PluginPairLink;
      try {
        plugin = linkPluginPair(evalDef, pluginRun);
      } catch (error) {
        if (error instanceof PluginLinkError) {
          pluginIssues.push(...error.issues);
          continue;
        }
        throw error;
      }
      const input: SandboxLayerPairInput = {
        eval: {
          id: evalDef.id,
          layer: plugin.evalLayer,
          declaredAt: { file: evalDef.sourcePath },
        },
        ...(evalDef.evalGroup === undefined ? {} : { group: {
          id: evalDef.evalGroup.id,
          layer: plugin.groupLayer,
          declaredAt: { file: evalDef.evalGroup.sourcePath },
        } }),
        experiment: {
          id: experimentId,
          layer: plugin.experimentLayer,
          declaredAt: { file: experimentSourcePath },
        },
        agent: { kind: run.agent.kind, name: run.agent.name },
      };
      records.push(Object.freeze({
        input,
        ownerKey: JSON.stringify([experimentId, evalDef.id, run.agent.name]),
        key: runPairKey(experimentId, evalDef.id),
        sourceRun,
        run,
        evalDef,
        plugin,
        authorBaseDirs: Object.freeze({
          eval: evalDef.baseDir,
          ...(evalDef.evalGroup === undefined ? {} : { "eval-group": evalDef.evalGroup.baseDir }),
          experiment: experimentBaseDir,
        }),
      }));
    }
  }

  if (pluginIssues.length > 0) return Effect.fail(pluginLinkErrorFromIssues(pluginIssues));

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
        sourceRun: owner.sourceRun,
        run: owner.run,
        evalDef: owner.evalDef,
        pair,
        plugin: owner.plugin,
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
  if (options.keepSandbox !== undefined) {
    const conflicts = runs.flatMap((run) => selectedEvalsForRun(evals, run)
      .filter((evalDef) => evalDef.evalGroup !== undefined)
      .map((evalDef) => ({
        experimentId: run.experimentId,
        evalGroupId: evalDef.evalGroup!.id,
      })));
    const unique = [...new Map(conflicts.map((entry) => [
      JSON.stringify([entry.experimentId, entry.evalGroupId]),
      entry,
    ])).values()];
    if (unique.length > 0) {
      return Effect.fail(new SandboxRunPlanningInvariantError({
        code: "sandbox.run-planning-invariant",
        message:
          `--keep-sandbox cannot be combined with Eval Group reuse ` +
          `(${unique.map(({ experimentId, evalGroupId }) =>
            `${JSON.stringify(experimentId)} / ${JSON.stringify(evalGroupId)}`).join(", ")}). ` +
          "Drop --keep-sandbox or select only ungrouped Evals.",
      }));
    }
  }
  return Effect.flatMap(linkRunSandboxes(evals, runs), (linkedPairs) =>
    Effect.flatMap(
      planLinkedRuns(linkedPairs.map(({ pair, authorBaseDirs, run, evalDef }) => ({
        pair,
        authorBaseDirs,
        requirements: physicalCapabilityRequirements(run, evalDef, options),
      })), services),
      (planned): Effect.Effect<readonly PreparedRunPair[], SandboxRunPlanningError> => {
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
            sourceRun: linked.sourceRun,
            run: linked.run,
            evalDef: linked.evalDef,
            plan,
            identity: linkedRunRecordIdentity(plan),
            plugin: linked.plugin,
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
              code: "eval-group-incompatible",
              message: `Eval Group ${JSON.stringify(group.id)} has different physical Sandbox plans across its selected members in Experiment ${JSON.stringify(entry.run.experimentId)}. Split the group by compatible template/provider identity.`,
            }));
          }
          groupPlans.set(key, physical);
        }
        const cohorts = new Map<string, {
          cohort: ResourcePhysicalCohort;
          demands: SelectedResourceDemand[];
          groupDemandKeys: Set<string>;
        }>();
        const cohortByPair = new Map<PreparedRunPair, ResourcePhysicalCohort>();
        for (const entry of prepared) {
          const cohort = resourceCohortFor(entry);
          if (cohort === undefined) {
            if (entry.plugin.resources.length > 0) {
              return Effect.fail(new SandboxRunPlanningInvariantError({
                code: "sandbox.run-planning-invariant",
                message:
                  `Plugin resources require a physical Sandbox, but Eval ${JSON.stringify(entry.evalDef.id)} ` +
                  `in Experiment ${JSON.stringify(entry.run.experimentId)} uses a direct Agent plan.`,
              }));
            }
            continue;
          }
          cohortByPair.set(entry, cohort);
          let bucket = cohorts.get(cohort.id);
          if (bucket === undefined) {
            bucket = { cohort, demands: [], groupDemandKeys: new Set() };
            cohorts.set(cohort.id, bucket);
          }
          for (const linked of entry.plugin.resources) {
            if (linked.scope === "group") {
              const groupDemandKey = JSON.stringify([
                linked.occurrence.provenance.owner.id,
                linked.occurrence.provenance.owner.position,
                linked.position,
              ]);
              if (bucket.groupDemandKeys.has(groupDemandKey)) continue;
              bucket.groupDemandKeys.add(groupDemandKey);
            }
            bucket.demands.push(Object.freeze({
              pairKey: entry.key,
              evalId: entry.evalDef.id,
              experimentId: entry.run.experimentId,
              linked,
            }));
          }
        }
        const envelopes = new Map<string, SelectedResourceEnvelope>();
        try {
          for (const { cohort, demands } of cohorts.values()) {
            envelopes.set(cohort.id, createSelectedResourceEnvelope(cohort, Object.freeze([...demands])));
          }
        } catch (error) {
          if (error instanceof ResourceEnvelopeConflictError) return Effect.fail(error);
          throw error;
        }
        return Effect.succeed(Object.freeze(prepared.map((entry) => {
          const cohort = cohortByPair.get(entry);
          const resourceEnvelope = cohort === undefined ? undefined : envelopes.get(cohort.id);
          if (cohort !== undefined && resourceEnvelope === undefined) {
            throw new Error(`Missing selected resource envelope for physical cohort ${JSON.stringify(cohort.id)}.`);
          }
          return Object.freeze({
            ...entry,
            ...(resourceEnvelope === undefined ? {} : { resourceEnvelope }),
          });
        })));
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
