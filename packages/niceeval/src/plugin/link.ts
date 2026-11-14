// @concord-file
// @concord-implements docs/feature/plugins/architecture/lifecycle.md
// @concord-implements docs/feature/plugins/use-case/terminal-bench-harness.md
import { Data } from "effect";
import { extendCodingAgent } from "../agents/plugin-extensions.ts";
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
  pluginInstanceDataOf,
  pluginLifecycleIdentity,
  type LinkedPluginLifecycle,
  type PluginInstance,
  type PluginOwner,
} from "./contracts.ts";

export type PluginLinkIssueCode = "plugin-instance-invalid" | "plugin-owner-unsupported" | "plugin-pair-instance-conflict" | "plugin-requires-eval-group";

export interface PluginOccurrenceProvenance {
  readonly attachment: PluginOwner;
  readonly owner: { readonly id: string; readonly source: string; readonly position: number };
}

export interface LinkedPluginOccurrence {
  readonly name: string;
  readonly key: string;
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
  return { ...pluginLifecycleIdentity(lifecycle) as object, ...(sandboxDeclaration(lifecycle) === undefined ? {} : { sandbox: sandboxDeclaration(lifecycle)! }) } as JsonValue;
}
function pluginOccurrenceProjection(lifecycle: LinkedPluginLifecycle): JsonValue { return pluginLifecycleAttachmentIdentity(lifecycle); }
function pluginAttachmentProjection(lifecycles: readonly LinkedPluginLifecycle[]): JsonValue {
  return lifecycles.map(pluginLifecycleAttachmentIdentity);
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
      key: lifecycle.key,
      provenance,
      projection,
      audit: Object.freeze({
        scope,
        name: lifecycle.name,
        key: lifecycle.key,
        identity: lifecycle.identity,
        requires: lifecycle.requires,
        shape: lifecycle.shape,
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
  for (const lifecycle of lifecycles.slice(0, activated).reverse()) {
    if (lifecycle.teardown === undefined) continue;
    try { await (lifecycle.teardown as (ctx: ExperimentHookContext) => void | Promise<void>)(context); }
    catch (error) { context.diagnostic({ code: "plugin-after-failed", level: "warning", message: String(error) }); }
  }
}

// @concord-code
// @concord-implements docs/feature/plugins/architecture/lifecycle.md
export function preparePluginRun(run: AgentRun): PreparedPluginRun {
  let lifecycles: readonly LinkedPluginLifecycle[];
  try {
    lifecycles = linkPluginLifecycles(run.plugins ?? [], "experiment");

  } catch (error) {
    throw pluginError([{ code: "plugin-owner-unsupported", experimentId: run.experimentId, message: String(error), actions: ["Attach each plugin only to a scope it declares."] }]);
  }
  const contributions = (run.plugins ?? []).flatMap((plugin, position) => {
    const data = pluginInstanceDataOf(plugin);
    return data.agent === undefined ? [] : [{ extension: data.agent, source: `${run.experimentSourcePath}:plugins[${position}] ${data.name} (${data.key})` }];
  });
  let adapter = run.adapter;
  if (contributions.length > 0) {
    if (adapter === undefined || adapter.kind === "custom") throw pluginError([{ code: "plugin-owner-unsupported", experimentId: run.experimentId,
      message: "Custom Adapters do not support Plugin agent extensions.", actions: ["Use a built-in coding Agent for agent extensions."] }]);
    try { adapter = extendCodingAgent(adapter, contributions); }
    catch (error) { throw pluginError([{ code: "plugin-owner-unsupported", experimentId: run.experimentId,
      message: String(error), actions: ["Resolve Agent extension conflicts at the reported declarations."] }]); }
  }
  const linkedOccurrences = occurrences(lifecycles, "experiment", run.experimentId, run.experimentSourcePath);
  const authorSetup = run.setup;
  const authorTeardown = run.teardown;
  let activated = 0;
  const setup = authorSetup === undefined && lifecycles.every((entry) => !entry.hostDeclared)
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
  const effective = Object.freeze({ ...run, adapter, ...(adapter === undefined || adapter.kind === "custom" ? {} : { agent: adapter }), ...(setup === undefined ? {} : { setup }), ...(teardown === undefined ? {} : { teardown }), pluginBehavior }) as AgentRun;
  return Object.freeze({ sourceRun: run, run: effective, experimentOccurrences: linkedOccurrences, experimentLifecycles: lifecycles });
}

// @concord-code
// @concord-implements docs/feature/plugins/architecture/lifecycle.md
export function linkPluginPair(evalDef: DiscoveredEval, preparedRun: PreparedPluginRun): PluginPairLink {
  try {
    const ownEvalLifecycles = linkPluginLifecycles(evalDef.plugins as readonly PluginInstance<"eval">[], "eval");
    const ownGroupLifecycles = evalDef.evalGroup === undefined
      ? Object.freeze([]) as readonly LinkedPluginLifecycle[]
      : linkPluginLifecycles(evalDef.evalGroup.plugins ?? [], "group");
    const allLifecycles = [...preparedRun.experimentLifecycles, ...ownGroupLifecycles, ...ownEvalLifecycles];
    const seen = new Map<string, LinkedPluginLifecycle>();
    for (const lifecycle of allLifecycles) {
      if (lifecycle.requires.evalGroup && evalDef.evalGroup === undefined) {
        throw pluginError([{ code: "plugin-requires-eval-group", experimentId: preparedRun.run.experimentId, evalId: evalDef.id,
          message: `Plugin ${lifecycle.name} (${lifecycle.key}) requires an Eval Group: ${evalDef.id}.`, actions: ["Group every selected Eval in this Plugin's scope."] }]);
      }
      const id = JSON.stringify([lifecycle.name, lifecycle.key]);
      const previous = seen.get(id);
      if (previous !== undefined) throw pluginError([{ code: "plugin-pair-instance-conflict", experimentId: preparedRun.run.experimentId, evalId: evalDef.id,
        message: `Duplicate Plugin (${lifecycle.name}, ${lifecycle.key}) at ${previous.scope}.plugins[${previous.arrayPosition}] and ${lifecycle.scope}.plugins[${lifecycle.arrayPosition}].`, actions: ["Use a distinct key for each condition in one Attempt."] }]);
      seen.set(id, lifecycle);
    }
    const groupLifecycles = groupPluginLifecycles(evalDef, preparedRun.run);
    const evalLifecycles = attemptPluginLifecycles(evalDef, preparedRun.run);
    if (preparedRun.run.adapter?.kind !== "sandbox" && allLifecycles.some((entry) => entry.sandboxLayer !== undefined)) {
      throw new TypeError("Plugin sandbox layer requires a Sandbox Agent and a physical Sandbox plan.");
    }
    const evalOccurrences = occurrences(ownEvalLifecycles, "eval", evalDef.id, evalDef.sourcePath);
    const groupOccurrences = evalDef.evalGroup === undefined
      ? Object.freeze([]) as readonly LinkedPluginOccurrence[]
      : occurrences(ownGroupLifecycles, "group", evalDef.evalGroup.id, evalDef.evalGroup.sourcePath);
    const all = Object.freeze([...preparedRun.experimentOccurrences, ...groupOccurrences, ...evalOccurrences]);
    const experimentLayer = appendPluginSandboxLayers(preparedRun.run.sandbox, preparedRun.experimentLifecycles);
    const groupLayer = evalDef.evalGroup === undefined
      ? undefined
      : appendPluginSandboxLayers(evalDef.evalGroup.sandbox, ownGroupLifecycles);
    const evalLayer = appendPluginSandboxLayers(evalDef.sandbox, ownEvalLifecycles);
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
    if (error instanceof PluginLinkError) throw error;
    throw pluginError([{ code: "plugin-owner-unsupported", experimentId: preparedRun.run.experimentId, evalId: evalDef.id, message: String(error), actions: ["Attach each plugin only to a scope it declares, without duplicates in one scope."] }]);
  }
}

export function pluginBehaviorProjection(run: AgentRun): JsonValue {
  if (run.pluginBehavior !== undefined) return run.pluginBehavior;
  const empty: JsonValue[] = [];
  Object.freeze(empty);
  return empty;
}

/** Expand host timing independently from the attachment owner. */
export function groupPluginLifecycles(evalDef: DiscoveredEval, run: AgentRun): readonly LinkedPluginLifecycle[] {
  if (evalDef.evalGroup === undefined) return [];
  return [...linkPluginLifecycles(run.plugins ?? [], "experiment", "group"),
    ...linkPluginLifecycles(evalDef.evalGroup.plugins ?? [], "group", "group")];
}
export function attemptPluginLifecycles(evalDef: DiscoveredEval, run: AgentRun): readonly LinkedPluginLifecycle[] {
  return [...linkPluginLifecycles(run.plugins ?? [], "experiment", "attempt"),
    ...linkPluginLifecycles(evalDef.evalGroup?.plugins ?? [], "group", "attempt"),
    ...linkPluginLifecycles(evalDef.plugins, "eval", "attempt")];
}
