import { Data } from "effect";
import { relative, sep } from "node:path";
import type { AgentRun, DiscoveredEval, ExperimentHookContext } from "../runner/types.ts";
import type { JsonValue } from "../shared/types.ts";
import {
  appendCommandOnlySandboxLayer,
  type SandboxLayer,
} from "../sandbox/layer.ts";
import { sandboxLayerDefinitionIdentity } from "../sandbox/link.ts";
import {
  linkPluginLifecycles,
  pluginLifecycleIdentity,
  pluginLifecycleProjection,
  type LinkedPluginLifecycle,
  type PluginInstance,
  type PluginOwner,
} from "./contracts.ts";

export type PluginLinkIssueCode = "plugin-instance-invalid" | "plugin-owner-unsupported" | "plugin-pair-instance-conflict";

export interface PluginOccurrenceProvenance {
  readonly attachment: PluginOwner;
  readonly owner: { readonly id: string; readonly source: string; readonly position: number };
}

export interface LinkedPluginOccurrence {
  readonly name: string;
  readonly instanceKey: string;
  readonly behaviorRevision: string;
  readonly provenance: PluginOccurrenceProvenance;
  readonly projection: JsonValue;
  readonly audit: JsonValue;
}

/** Kept empty during the resource-envelope removal so runner planning stays source-compatible. */
export interface LinkedPluginResourceDemand { readonly _removed?: never }

export interface PluginPairLink {
  readonly evalLayer?: SandboxLayer;
  readonly groupLayer?: SandboxLayer;
  readonly experimentLayer?: SandboxLayer;
  readonly occurrences: readonly LinkedPluginOccurrence[];
  readonly resources: readonly LinkedPluginResourceDemand[];
  readonly experimentLifecycles: readonly LinkedPluginLifecycle[];
  readonly groupLifecycles: readonly LinkedPluginLifecycle[];
  readonly evalLifecycles: readonly LinkedPluginLifecycle[];
  readonly sandboxLifecycles: Readonly<{
    readonly experiment: readonly LinkedPluginLifecycle[];
    readonly group: readonly LinkedPluginLifecycle[];
    readonly eval: readonly LinkedPluginLifecycle[];
  }>;
  readonly pairProjection: JsonValue;
}

export interface PreparedPluginRun {
  readonly sourceRun: AgentRun;
  readonly run: AgentRun;
  readonly experimentOccurrences: readonly LinkedPluginOccurrence[];
  readonly experimentLifecycles: readonly LinkedPluginLifecycle[];
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

function pluginError(issues: readonly PluginLinkIssue[]): PluginLinkError {
  const frozen = Object.freeze(issues.map((issue) => Object.freeze({ ...issue, actions: Object.freeze([...issue.actions]) })));
  return new PluginLinkError({
    code: "plugin.link-failed",
    issues: frozen,
    message: `Plugin link failed for ${frozen.length} occurrences. No Sandbox was created.`,
  });
}

export function pluginLinkErrorFromIssues(issues: readonly PluginLinkIssue[]): PluginLinkError {
  return pluginError(issues);
}

function sourceLabel(path: string): string {
  return relative(process.cwd(), path).split(sep).join("/") || ".";
}

function sandboxDeclaration(lifecycle: LinkedPluginLifecycle): JsonValue | undefined {
  return lifecycle.sandboxLayer === undefined
    ? undefined
    : Object.freeze({
        present: true,
        declaration: sandboxLayerDefinitionIdentity(lifecycle.sandboxLayer),
      });
}

function pluginLifecycleAttachmentIdentity(lifecycle: LinkedPluginLifecycle): JsonValue {
  const sandbox = sandboxDeclaration(lifecycle);
  if (sandbox === undefined) return pluginLifecycleIdentity(lifecycle);
  return Object.freeze({
    scope: lifecycle.scope,
    name: lifecycle.name,
    behaviorRevision: lifecycle.behaviorRevision,
    instanceKey: lifecycle.instanceKey,
    identity: lifecycle.identity,
    arrayPosition: lifecycle.arrayPosition,
    hasSetup: lifecycle.hasSetup,
    hasTeardown: lifecycle.hasTeardown,
    sandbox,
  });
}

function pluginOccurrenceProjection(lifecycle: LinkedPluginLifecycle): JsonValue {
  const sandbox = sandboxDeclaration(lifecycle);
  return Object.freeze({
    // Keep the established occurrence field order for attachments without a
    // sandbox fragment; some persisted projections are byte-sensitive.
    scope: lifecycle.scope,
    name: lifecycle.name,
    instanceKey: lifecycle.instanceKey,
    behaviorRevision: lifecycle.behaviorRevision,
    identity: lifecycle.identity,
    arrayPosition: lifecycle.arrayPosition,
    hasSetup: lifecycle.hasSetup,
    hasTeardown: lifecycle.hasTeardown,
    ...(sandbox === undefined ? {} : { sandbox }),
  });
}

function pluginAttachmentProjection(lifecycles: readonly LinkedPluginLifecycle[]): JsonValue {
  if (lifecycles.every((lifecycle) => lifecycle.sandboxLayer === undefined)) {
    return pluginLifecycleProjection(lifecycles);
  }
  const projection: JsonValue[] = lifecycles.map(pluginLifecycleAttachmentIdentity);
  Object.freeze(projection);
  return projection;
}

function occurrences(
  lifecycles: readonly LinkedPluginLifecycle[],
  scope: PluginOwner,
  ownerId: string,
  sourcePath: string,
): readonly LinkedPluginOccurrence[] {
  return Object.freeze(lifecycles.map((lifecycle) => {
    const provenance = Object.freeze({
      attachment: scope,
      owner: Object.freeze({ id: ownerId, source: sourceLabel(sourcePath), position: lifecycle.arrayPosition }),
    });
    const projection = pluginOccurrenceProjection(lifecycle);
    const sandbox = sandboxDeclaration(lifecycle);
    const contributions = [
      ...(lifecycle.hostDeclared ? ["lifecycle"] : []),
      ...(sandbox === undefined ? [] : ["sandbox"]),
    ];
    return Object.freeze({
      name: lifecycle.name,
      instanceKey: lifecycle.instanceKey,
      behaviorRevision: lifecycle.behaviorRevision,
      provenance,
      projection,
      audit: Object.freeze({
        scope,
        name: lifecycle.name,
        instanceKey: lifecycle.instanceKey,
        behaviorRevision: lifecycle.behaviorRevision,
        identity: lifecycle.identity,
        arrayPosition: lifecycle.arrayPosition,
        hasSetup: lifecycle.hasSetup,
        hasTeardown: lifecycle.hasTeardown,
        ...(sandbox === undefined ? {} : { sandbox }),
        ownerSource: provenance.owner,
        contributions,
      }) as JsonValue,
    });
  }));
}

function appendPluginSandboxLayers(
  base: SandboxLayer | undefined,
  lifecycles: readonly LinkedPluginLifecycle[],
): SandboxLayer | undefined {
  let layer = base;
  for (const lifecycle of lifecycles) {
    if (lifecycle.sandboxLayer === undefined) continue;
    layer = layer === undefined
      ? appendCommandOnlySandboxLayer(undefined, lifecycle.sandboxLayer)
      : appendCommandOnlySandboxLayer(layer, lifecycle.sandboxLayer);
  }
  return layer;
}

async function runTeardowns(
  lifecycles: readonly LinkedPluginLifecycle[],
  activated: number,
  context: ExperimentHookContext,
): Promise<void> {
  const failures: unknown[] = [];
  for (const lifecycle of lifecycles.slice(0, activated).reverse()) {
    if (lifecycle.teardown === undefined) continue;
    try { await (lifecycle.teardown as (ctx: ExperimentHookContext) => void | Promise<void>)(context); }
    catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Experiment Plugin teardown failed.");
}

export function preparePluginRun(run: AgentRun): PreparedPluginRun {
  let lifecycles: readonly LinkedPluginLifecycle[];
  try {
    lifecycles = linkPluginLifecycles(run.plugins as readonly PluginInstance<"experiment">[], "experiment");
  } catch (error) {
    throw pluginError([{ code: "plugin-owner-unsupported", experimentId: run.experimentId, message: String(error), actions: ["Attach each plugin only to a scope it declares."] }]);
  }
  const linkedOccurrences = occurrences(lifecycles, "experiment", run.experimentId, run.experimentSourcePath);
  const authorSetup = run.setup;
  const authorTeardown = run.teardown;
  let activated = 0;
  const setup = authorSetup === undefined && lifecycles.every((entry) => entry.setup === undefined)
    ? undefined
    : async (context: ExperimentHookContext): Promise<void> => {
        if (authorSetup !== undefined) await authorSetup(context);
        for (const lifecycle of lifecycles) {
          activated += 1;
          if (lifecycle.setup !== undefined) await (lifecycle.setup as (ctx: ExperimentHookContext) => void | Promise<void>)(context);
        }
      };
  const teardown = authorTeardown === undefined && lifecycles.every((entry) => entry.teardown === undefined)
    ? undefined
    : async (context: ExperimentHookContext): Promise<void> => {
        let pluginFailure: unknown;
        try { await runTeardowns(lifecycles, activated, context); } catch (error) { pluginFailure = error; }
        try { if (authorTeardown !== undefined) await authorTeardown(context); }
        catch (error) { if (pluginFailure === undefined) throw error; throw new AggregateError([pluginFailure, error], "Experiment teardown failed."); }
        if (pluginFailure !== undefined) throw pluginFailure;
      };
  const pluginBehavior = Object.freeze({ version: 1, lifecycles: pluginAttachmentProjection(lifecycles) }) as JsonValue;
  const effective = Object.freeze({ ...run, ...(setup === undefined ? {} : { setup }), ...(teardown === undefined ? {} : { teardown }), pluginBehavior }) as AgentRun;
  return Object.freeze({ sourceRun: run, run: effective, experimentOccurrences: linkedOccurrences, experimentLifecycles: lifecycles });
}

export function linkPluginPair(evalDef: DiscoveredEval, preparedRun: PreparedPluginRun): PluginPairLink {
  try {
    const evalLifecycles = linkPluginLifecycles(evalDef.plugins as readonly PluginInstance<"eval">[], "eval");
    const groupLifecycles = evalDef.evalGroup === undefined
      ? Object.freeze([]) as readonly LinkedPluginLifecycle[]
      : linkPluginLifecycles(evalDef.evalGroup.plugins ?? [], "group");
    const allLifecycles = [...preparedRun.experimentLifecycles, ...groupLifecycles, ...evalLifecycles];
    if (preparedRun.run.agent.kind === "direct" && allLifecycles.some((entry) => entry.sandboxLayer !== undefined)) {
      throw new TypeError("Plugin sandbox layer requires a Sandbox Agent and a physical Sandbox plan.");
    }
    const evalOccurrences = occurrences(evalLifecycles, "eval", evalDef.id, evalDef.sourcePath);
    const groupOccurrences = evalDef.evalGroup === undefined
      ? Object.freeze([]) as readonly LinkedPluginOccurrence[]
      : occurrences(groupLifecycles, "group", evalDef.evalGroup.id, evalDef.evalGroup.sourcePath);
    const all = Object.freeze([...preparedRun.experimentOccurrences, ...groupOccurrences, ...evalOccurrences]);
    const experimentLayer = appendPluginSandboxLayers(preparedRun.run.sandbox, preparedRun.experimentLifecycles);
    const groupLayer = evalDef.evalGroup === undefined
      ? undefined
      : appendPluginSandboxLayers(evalDef.evalGroup.sandbox, groupLifecycles);
    const evalLayer = appendPluginSandboxLayers(evalDef.sandbox, evalLifecycles);
    const noSandboxLifecycles = Object.freeze({
      experiment: Object.freeze([]),
      group: Object.freeze([]),
      eval: Object.freeze([]),
    });
    return Object.freeze({
      ...(evalLayer === undefined ? {} : { evalLayer }),
      ...(groupLayer === undefined ? {} : { groupLayer }),
      ...(experimentLayer === undefined ? {} : { experimentLayer }),
      occurrences: all,
      resources: Object.freeze([]),
      experimentLifecycles: preparedRun.experimentLifecycles,
      groupLifecycles,
      evalLifecycles,
      // The runner field remains source-compatible while the old sandbox
      // lifecycle data path is retired. Plugin layers are already composed
      // into their actual owner layer above.
      sandboxLifecycles: noSandboxLifecycles,
      pairProjection: Object.freeze({
        version: 1,
        occurrences: all.map((entry) => entry.projection),
      }) as JsonValue,
    });
  } catch (error) {
    throw pluginError([{ code: "plugin-owner-unsupported", experimentId: preparedRun.run.experimentId, evalId: evalDef.id, message: String(error), actions: ["Attach each plugin only to a scope it declares, without duplicates in one scope."] }]);
  }
}

export function pluginBehaviorProjection(run: AgentRun): JsonValue {
  if (run.pluginBehavior !== undefined) return run.pluginBehavior;
  const empty: JsonValue[] = [];
  Object.freeze(empty);
  return empty;
}
