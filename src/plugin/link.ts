// Zero-resource Plugin linker. It evaluates no plugin callbacks: every
// occurrence was normalized by definePlugin() at author construction time.

import { Data } from "effect";
import { relative, sep } from "node:path";
import type { AgentRun, DiscoveredEval, ExperimentHookContext } from "../runner/types.ts";
import type { JsonValue } from "../shared/types.ts";
import { sandboxLayer, sandboxLayerStateOf, type SandboxLayer } from "../sandbox/layer.ts";
import { sandboxLayerDefinitionIdentity } from "../sandbox/link.ts";
import { stableJson } from "../sandbox/identity.ts";
import {
  agentExtensionDataOf,
  agentExtensionsProjection,
  isPluginInstance,
  pluginInstanceDataOf,
  receiverExtensionsFor,
  sandboxResourceDemandDataOf,
  type AgentExtension,
  type PluginInstance,
  type PluginInstanceData,
  type PluginOwner,
  type SandboxResourceDemand,
} from "./contracts.ts";

export type PluginLinkIssueCode =
  | "plugin-instance-invalid"
  | "plugin-owner-unsupported"
  | "plugin-pair-instance-conflict"
  | "plugin-agent-receiver-unsupported"
  | "plugin-fragment-conflict";

export interface PluginOccurrenceProvenance {
  readonly attachment: PluginOwner;
  readonly owner: {
    readonly id: string;
    readonly source: string;
    readonly position: number;
  };
}

export interface LinkedPluginOccurrence {
  readonly name: string;
  readonly instanceKey: string;
  readonly behaviorRevision: string;
  readonly provenance: PluginOccurrenceProvenance;
  readonly projection: JsonValue;
}

export interface LinkedPluginResourceDemand {
  readonly demand: SandboxResourceDemand;
  readonly receiver: string;
  readonly behaviorRevision: string;
  readonly projection: JsonValue;
  readonly occurrence: LinkedPluginOccurrence;
}

export interface PluginPairLink {
  readonly evalLayer?: SandboxLayer;
  readonly groupLayer?: SandboxLayer;
  readonly experimentLayer?: SandboxLayer;
  readonly occurrences: readonly LinkedPluginOccurrence[];
  readonly resources: readonly LinkedPluginResourceDemand[];
  /** Pair-only canonical behavior, including Eval / Group provenance. */
  readonly pairProjection: JsonValue;
}

export interface PreparedPluginRun {
  readonly sourceRun: AgentRun;
  readonly run: AgentRun;
  readonly experimentOccurrences: readonly LinkedPluginOccurrence[];
}

export interface PluginLinkIssue {
  readonly code: PluginLinkIssueCode;
  readonly experimentId: string;
  readonly evalId?: string;
  readonly message: string;
  readonly actions: readonly string[];
}

export class PluginLinkError extends Data.TaggedError("PluginLinkError")<{
  readonly code: "plugin.link-failed";
  readonly issues: readonly PluginLinkIssue[];
  readonly message: string;
}> {}

function sourceLabel(path: string): string {
  return relative(process.cwd(), path).split(sep).join("/") || ".";
}

function pluginError(issues: readonly PluginLinkIssue[]): PluginLinkError {
  const frozen = Object.freeze(issues.map((issue) => Object.freeze({ ...issue, actions: Object.freeze([...issue.actions]) })));
  return new PluginLinkError({
    code: "plugin.link-failed",
    issues: frozen,
    message: `Plugin link failed for ${frozen.length} occurrence${frozen.length === 1 ? "" : "s"}. No Sandbox or resource was created.`,
  });
}

export function pluginLinkErrorFromIssues(issues: readonly PluginLinkIssue[]): PluginLinkError {
  return pluginError(issues);
}

function ownerFragment<Owner extends PluginOwner>(data: PluginInstanceData, owner: Owner): PluginInstanceData[Owner] {
  return data[owner];
}

function occurrenceProjection(
  data: PluginInstanceData,
  owner: PluginOwner,
  provenance: PluginOccurrenceProvenance,
): JsonValue {
  const fragment = ownerFragment(data, owner);
  if (fragment === undefined) throw new TypeError(`Plugin ${data.name} has no ${owner} fragment.`);
  const resources = owner === "eval"
    ? ((fragment as NonNullable<PluginInstanceData["eval"]>).resources ?? []).map((demand) => {
        const resource = sandboxResourceDemandDataOf(demand);
        return Object.freeze({
          receiver: resource.receiver,
          behaviorRevision: resource.behaviorRevision,
          demand: resource.projection,
        });
      })
    : [];
  return Object.freeze({
    name: data.name,
    instanceKey: data.instanceKey,
    behaviorRevision: data.behaviorRevision,
    attachment: provenance.attachment,
    owner: provenance.owner,
    ...(fragment.identity === undefined ? {} : { identity: fragment.identity }),
    ...(fragment.requirements === undefined || fragment.requirements.length === 0
      ? {}
      : { requirements: [...fragment.requirements] }),
    ...(owner === "experiment" && (fragment as NonNullable<PluginInstanceData["experiment"]>).flags !== undefined
      ? { flags: (fragment as NonNullable<PluginInstanceData["experiment"]>).flags }
      : {}),
    ...((owner === "eval" || owner === "experiment") && (fragment as { readonly sandbox?: SandboxLayer<"command-only"> }).sandbox !== undefined
      ? { sandbox: sandboxLayerDefinitionIdentity((fragment as { readonly sandbox: SandboxLayer<"command-only"> }).sandbox) }
      : {}),
    ...(resources.length === 0 ? {} : { resources: Object.freeze(resources) }),
  }) as unknown as JsonValue;
}

function collectOwnerOccurrences(
  owner: PluginOwner,
  plugins: readonly PluginInstance[] | undefined,
  ownerId: string,
  sourcePath: string,
  experimentId: string,
  evalId: string | undefined,
): { readonly occurrences: readonly LinkedPluginOccurrence[]; readonly issues: readonly PluginLinkIssue[] } {
  const occurrences: LinkedPluginOccurrence[] = [];
  const issues: PluginLinkIssue[] = [];
  for (const [position, plugin] of (plugins ?? []).entries()) {
    if (!isPluginInstance(plugin)) {
      issues.push({
        code: "plugin-instance-invalid",
        experimentId,
        ...(evalId === undefined ? {} : { evalId }),
        message: `${owner} plugin at position ${position} for ${JSON.stringify(ownerId)} was not made by definePlugin().`,
        actions: ["Construct plugin occurrences through definePlugin(...)(options)."],
      });
      continue;
    }
    const data = pluginInstanceDataOf(plugin);
    if (ownerFragment(data, owner) === undefined) {
      issues.push({
        code: "plugin-owner-unsupported",
        experimentId,
        ...(evalId === undefined ? {} : { evalId }),
        message: `Plugin ${JSON.stringify(data.name)} does not support ${owner} attachment.`,
        actions: [`Declare a ${owner} callback on the plugin family or remove this attachment.`],
      });
      continue;
    }
    const provenance: PluginOccurrenceProvenance = Object.freeze({
      attachment: owner,
      owner: Object.freeze({ id: ownerId, source: sourceLabel(sourcePath), position }),
    });
    occurrences.push(Object.freeze({
      name: data.name,
      instanceKey: data.instanceKey,
      behaviorRevision: data.behaviorRevision,
      provenance,
      projection: occurrenceProjection(data, owner, provenance),
    }));
  }
  return Object.freeze({ occurrences: Object.freeze(occurrences), issues: Object.freeze(issues) });
}

function fragmentsFor<Owner extends PluginOwner>(
  plugins: readonly PluginInstance[] | undefined,
  owner: Owner,
): readonly NonNullable<PluginInstanceData[Owner]>[] {
  const fragments: NonNullable<PluginInstanceData[Owner]>[] = [];
  for (const plugin of plugins ?? []) {
    if (!isPluginInstance(plugin)) continue;
    const fragment = pluginInstanceDataOf(plugin)[owner];
    if (fragment !== undefined) fragments.push(fragment);
  }
  return Object.freeze(fragments);
}

function appendCommandOnlyLayers(
  authorLayer: SandboxLayer | undefined,
  fragments: readonly { readonly sandbox?: SandboxLayer<"command-only"> }[],
): SandboxLayer | undefined {
  if (!fragments.some((fragment) => fragment.sandbox !== undefined)) return authorLayer;
  let layer = authorLayer ?? sandboxLayer();
  for (const fragment of fragments) {
    if (fragment.sandbox === undefined) continue;
    for (const command of sandboxLayerStateOf(fragment.sandbox).commands) layer = layer.prepare(command.command);
  }
  return layer;
}

function sameJson(left: JsonValue, right: JsonValue): boolean {
  return stableJson(left) === stableJson(right);
}

function mergeJsonRecord(
  base: Readonly<globalThis.Record<string, JsonValue>>,
  additions: readonly Readonly<globalThis.Record<string, JsonValue>>[],
  label: string,
): Readonly<globalThis.Record<string, JsonValue>> {
  const result: globalThis.Record<string, JsonValue> = { ...base };
  for (const addition of additions) {
    for (const [key, value] of Object.entries(addition)) {
      if (Object.hasOwn(result, key) && !sameJson(result[key]!, value)) {
        throw new TypeError(`Plugin ${label} conflicts with an existing value for ${JSON.stringify(key)}.`);
      }
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

function mergeLabels(
  base: Readonly<globalThis.Record<string, string | number>> | undefined,
  additions: readonly Readonly<globalThis.Record<string, string | number>>[],
): Readonly<globalThis.Record<string, string | number>> | undefined {
  if (base === undefined && additions.length === 0) return undefined;
  const result: globalThis.Record<string, string | number> = { ...(base ?? {}) };
  for (const addition of additions) {
    for (const [key, value] of Object.entries(addition)) {
      if (Object.hasOwn(result, key) && result[key] !== value) {
        throw new TypeError(`Plugin label conflicts with an existing value for ${JSON.stringify(key)}.`);
      }
      result[key] = value;
    }
  }
  return Object.freeze(result);
}

function composeExperimentLifecycle(
  author: AgentRun,
  fragments: readonly NonNullable<PluginInstanceData["experiment"]>[],
): Pick<AgentRun, "setup" | "teardown"> {
  const setupHooks = [author.setup, ...fragments.map((fragment) => fragment.setup)].filter((hook): hook is NonNullable<typeof hook> => hook !== undefined);
  const teardownHooks = [...fragments.map((fragment) => fragment.teardown).filter((hook): hook is NonNullable<typeof hook> => hook !== undefined).reverse(), author.teardown]
    .filter((hook): hook is NonNullable<typeof hook> => hook !== undefined);
  const setup = setupHooks.length === 0
    ? undefined
    : async (context: ExperimentHookContext): Promise<void> => {
        for (const hook of setupHooks) await hook(context);
      };
  const teardown = teardownHooks.length === 0
    ? undefined
    : async (context: ExperimentHookContext): Promise<void> => {
        const failures: unknown[] = [];
        for (const hook of teardownHooks) {
          try {
            await hook(context);
          } catch (error) {
            failures.push(error);
          }
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, "Experiment Plugin teardown failed.");
      };
  return Object.freeze({ ...(setup === undefined ? {} : { setup }), ...(teardown === undefined ? {} : { teardown }) });
}

/** Prepare the Experiment portion once, before physical link/planning. */
export function preparePluginRun(run: AgentRun): PreparedPluginRun {
  const occurrenceResult = collectOwnerOccurrences(
    "experiment",
    run.plugins as readonly PluginInstance[] | undefined,
    run.experimentId,
    run.experimentSourcePath,
    run.experimentId,
    undefined,
  );
  if (occurrenceResult.issues.length > 0) throw pluginError(occurrenceResult.issues);
  const fragments = fragmentsFor(run.plugins as readonly PluginInstance[] | undefined, "experiment");
  const extensions = Object.freeze(fragments.flatMap((fragment) => fragment.agentExtensions ?? []));
  let agent = run.agent;
  let extensionProjection: JsonValue = Object.freeze([]) as unknown as JsonValue;
  if (extensions.length > 0) {
    const receiver = agent.pluginReceiver;
    if (receiver === undefined) {
      throw pluginError([{
        code: "plugin-agent-receiver-unsupported",
        experimentId: run.experimentId,
        message: `Agent ${JSON.stringify(agent.name)} does not support Experiment Plugin AgentExtensions.`,
        actions: ["Use an adapter with the matching receiver, such as codexAgent() or claudeCodeAgent()."],
      }]);
    }
    try {
      const accepted = receiverExtensionsFor(receiver, extensions);
      extensionProjection = receiver.projection(accepted);
      agent = receiver.compose(agent, accepted);
    } catch (error) {
      throw pluginError([{
        code: "plugin-agent-receiver-unsupported",
        experimentId: run.experimentId,
        message: error instanceof Error ? error.message : String(error),
        actions: ["Attach only receiver-branded extensions accepted by this Agent."],
      }]);
    }
  }
  const flags = mergeJsonRecord(run.flags, fragments.flatMap((fragment) => fragment.flags === undefined ? [] : [fragment.flags]), "flags");
  const labels = mergeLabels(run.labels, fragments.flatMap((fragment) => fragment.labels === undefined ? [] : [fragment.labels]));
  const lifecycle = composeExperimentLifecycle(run, fragments);
  const pluginBehavior = Object.freeze({
    version: 1,
    occurrences: occurrenceResult.occurrences.map((occurrence) => occurrence.projection),
    ...(extensions.length === 0 ? {} : { agentExtensions: extensionProjection }),
  }) as JsonValue;
  const effective = Object.freeze({
    ...run,
    agent,
    flags,
    ...(labels === undefined ? {} : { labels }),
    ...lifecycle,
    pluginBehavior,
  }) as AgentRun;
  return Object.freeze({ sourceRun: run, run: effective, experimentOccurrences: occurrenceResult.occurrences });
}

/** Link all three owner sides for one Eval × Experiment pair. */
export function linkPluginPair(
  evalDef: DiscoveredEval,
  preparedRun: PreparedPluginRun,
): PluginPairLink {
  const run = preparedRun.run;
  const evalResult = collectOwnerOccurrences(
    "eval",
    evalDef.plugins as readonly PluginInstance[] | undefined,
    evalDef.id,
    evalDef.sourcePath,
    run.experimentId,
    evalDef.id,
  );
  const groupResult = evalDef.evalGroup === undefined
    ? Object.freeze({ occurrences: Object.freeze([]) as readonly LinkedPluginOccurrence[], issues: Object.freeze([]) as readonly PluginLinkIssue[] })
    : collectOwnerOccurrences(
        "group",
        evalDef.evalGroup.plugins as readonly PluginInstance[] | undefined,
        evalDef.evalGroup.id,
        evalDef.evalGroup.sourcePath,
        run.experimentId,
        evalDef.id,
      );
  const issues: PluginLinkIssue[] = [...evalResult.issues, ...groupResult.issues];
  const occurrences = [...preparedRun.experimentOccurrences, ...groupResult.occurrences, ...evalResult.occurrences];
  const keys = new Map<string, LinkedPluginOccurrence>();
  for (const occurrence of occurrences) {
    const key = JSON.stringify([occurrence.name, occurrence.instanceKey]);
    const prior = keys.get(key);
    if (prior !== undefined) {
      issues.push({
        code: "plugin-pair-instance-conflict",
        experimentId: run.experimentId,
        evalId: evalDef.id,
        message: `Plugin (${JSON.stringify(occurrence.name)}, ${JSON.stringify(occurrence.instanceKey)}) appears more than once in this Eval × Experiment pair (${prior.provenance.attachment} and ${occurrence.provenance.attachment}).`,
        actions: ["Keep one occurrence for each (name, instanceKey) in a pair."],
      });
    } else keys.set(key, occurrence);
  }
  if (issues.length > 0) throw pluginError(issues);

  const evalFragments = fragmentsFor(evalDef.plugins as readonly PluginInstance[] | undefined, "eval");
  const groupFragments = evalDef.evalGroup === undefined
    ? Object.freeze([]) as readonly NonNullable<PluginInstanceData["group"]>[]
    : fragmentsFor(evalDef.evalGroup.plugins as readonly PluginInstance[] | undefined, "group");
  const experimentFragments = fragmentsFor(run.plugins as readonly PluginInstance[] | undefined, "experiment");
  const resources: LinkedPluginResourceDemand[] = [];
  for (let i = 0; i < evalFragments.length; i++) {
    const fragment = evalFragments[i]!;
    const occurrence = evalResult.occurrences[i]!;
    for (const demand of fragment.resources ?? []) {
      const data = sandboxResourceDemandDataOf(demand);
      resources.push(Object.freeze({
        demand,
        receiver: data.receiver,
        behaviorRevision: data.behaviorRevision,
        projection: data.projection,
        occurrence,
      }));
    }
  }
  const pairProjection = Object.freeze({
    version: 1,
    occurrences: occurrences.map((occurrence) => occurrence.projection),
    ...(resources.length === 0
      ? {}
      : { ownResourceDemand: resources.map((resource) => Object.freeze({
          receiver: resource.receiver,
          behaviorRevision: resource.behaviorRevision,
          demand: resource.projection,
          plugin: resource.occurrence.projection,
        })) }),
  }) as JsonValue;
  return Object.freeze({
    evalLayer: appendCommandOnlyLayers(evalDef.sandbox, evalFragments),
    ...(evalDef.evalGroup === undefined
      ? {}
      : { groupLayer: evalDef.evalGroup.sandbox }),
    experimentLayer: appendCommandOnlyLayers(run.sandbox, experimentFragments),
    occurrences: Object.freeze(occurrences),
    resources: Object.freeze(resources),
    pairProjection,
  });
}

/** Useful for configHash construction without exposing AgentExtension payload. */
export function pluginBehaviorProjection(run: AgentRun): JsonValue {
  return run.pluginBehavior ?? (Object.freeze([]) as unknown as JsonValue);
}

/** Defensive assertion for callers that only need receiver behavior details. */
export function extensionReceiverOf(extension: AgentExtension): string {
  return agentExtensionDataOf(extension).receiver;
}
