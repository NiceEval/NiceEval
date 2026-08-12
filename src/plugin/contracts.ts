// Plugin public contract. This module is intentionally only reachable through
// `niceeval/plugin`: resource callbacks use Effect v3 and must not widen the
// root package surface.

import type { Effect } from "effect";
import type { Agent } from "../agents/types.ts";
import type { ExperimentHook, ExperimentHookContext } from "../runner/types.ts";
import type { DiagnosticInput, JsonValue, ProgressUpdate } from "../shared/types.ts";
import type { FactValue } from "../shared/facts.ts";
import { isSandboxLayer, sandboxLayerStateOf, type SandboxLayer } from "../sandbox/layer.ts";
import type { SandboxCommand } from "../sandbox/commands.ts";
import type { Sandbox } from "../sandbox/types.ts";

export type PluginOwner = "eval" | "experiment" | "group";
export type PluginOnUnavailable = "stop-group" | "replace-sandbox";

declare const PLUGIN_INSTANCE: unique symbol;
declare const AGENT_EXTENSION: unique symbol;
declare const SANDBOX_RESOURCE: unique symbol;
declare const SANDBOX_RESOURCE_DEMAND: unique symbol;

/**
 * A plugin occurrence is an evaluated, immutable value. Its brand uses a
 * contravariant callback so a family supporting several owners can be used at
 * each supported definition site while an unsupported owner remains a type
 * error.
 */
export interface PluginInstance<Owners extends PluginOwner = PluginOwner> {
  readonly [PLUGIN_INSTANCE]: (owner: Owners) => void;
}

export interface AgentExtension<Receiver extends string = any> {
  readonly [AGENT_EXTENSION]: (receiver: Receiver) => void;
}

export interface SandboxResourceDemand<Receiver extends string = any> {
  readonly [SANDBOX_RESOURCE_DEMAND]: (receiver: Receiver) => void;
}

/**
 * The value handed to a resource callback. It is a deep-frozen, JSON-normalized
 * copy of the value that the resource constructor received; the opaque demand
 * token itself never exposes an accessor for core to depend on.
 */
export type SandboxResourceDemandPayload<Value extends JsonValue> =
  Value extends readonly (infer Item)[]
    ? readonly SandboxResourceDemandPayload<Extract<Item, JsonValue>>[]
    : Value extends object
      ? { readonly [Key in keyof Value]: SandboxResourceDemandPayload<Extract<Value[Key], JsonValue>> }
      : Value;

export interface SandboxResourceContext {
  readonly sandbox: Sandbox;
  readonly signal: AbortSignal;
  /** Stable physical instance identity, never an Attempt identity. */
  readonly physicalId: string;
  /** Short-lived, credential-free progress receipt for materialize/release work. */
  progress(update: ProgressUpdate): void;
  /** Persistent, credential-free diagnostic receipt for materialize/release work. */
  diagnostic(input: DiagnosticInput): void;
  /** Scalar physical-resource fact. Pool materialization facts belong to the Run. */
  fact(key: string, value: FactValue): void;
  /**
   * Append an open plugin-owned timing activity. `durationMs` is measured by
   * the plugin; the runner supplies its current timing domain and start offset.
   */
  timing(input: SandboxResourceTiming): void;
}

export interface SandboxResourceTiming {
  readonly key: string;
  readonly label: string;
  readonly durationMs: number;
  readonly failed?: boolean;
}

export interface SandboxResourceAttemptContext extends SandboxResourceContext {
  readonly evalId: string;
  readonly evalGroupId?: string;
  readonly experimentId: string;
  readonly attempt: number;
}

/**
 * Receiver-branded physical Sandbox resource. `projection` and `demand` are
 * pure, JSON-only planning inputs; callbacks run only after the physical
 * Sandbox exists and are Effect-native so Scope owns all finalization.
 */
export interface SandboxResourceDefinition<Receiver extends string, Demand extends JsonValue, Handle> {
  readonly receiver: Receiver;
  readonly behaviorRevision: string;
  readonly demand: (value: Demand) => JsonValue;
  readonly materialize: (
    demands: readonly SandboxResourceDemandPayload<Demand>[],
    context: SandboxResourceContext,
  ) => Effect.Effect<Handle, Error>;
  readonly prepare?: (
    handle: Handle,
    demand: SandboxResourceDemandPayload<Demand>,
    context: SandboxResourceAttemptContext,
  ) => Effect.Effect<void, Error>;
  readonly release?: (handle: Handle, context: SandboxResourceContext) => Effect.Effect<void, Error>;
}

export interface SandboxResource<Receiver extends string, Demand extends JsonValue, Handle> {
  readonly [SANDBOX_RESOURCE]: (receiver: Receiver) => void;
  (value: Demand): SandboxResourceDemand<Receiver>;
}

export interface EvalPluginFragment {
  readonly identity?: Readonly<globalThis.Record<string, JsonValue>>;
  readonly resources?: readonly SandboxResourceDemand<any>[];
  readonly sandbox?: SandboxLayer<"command-only">;
}

export interface ExperimentPluginFragment {
  readonly identity?: Readonly<globalThis.Record<string, JsonValue>>;
  readonly flags?: Readonly<globalThis.Record<string, JsonValue>>;
  /** Labels are deliberately kept out of behavior hashes. */
  readonly labels?: Readonly<globalThis.Record<string, string | number>>;
  readonly sandbox?: SandboxLayer<"command-only">;
  /** Runs with the same Experiment lifecycle context as an author hook. */
  readonly setup?: ExperimentHook;
  /** Runs in reverse plugin order with the same Experiment lifecycle context. */
  readonly teardown?: ExperimentHook;
  readonly agentExtensions?: readonly AgentExtension[];
}

export interface GroupPluginFragment {
  readonly identity?: Readonly<globalThis.Record<string, JsonValue>>;
  readonly resources?: readonly SandboxResourceDemand<any>[];
  readonly sandbox?: SandboxLayer<"command-only">;
}

export interface PluginDefinition<Options> {
  readonly name: string;
  readonly behaviorRevision: string;
  readonly instanceKey?: (options: Options) => string;
  readonly eval?: (options: Options) => EvalPluginFragment;
  readonly experiment?: (options: Options) => ExperimentPluginFragment;
  readonly group?: (options: Options) => GroupPluginFragment;
}

type AtLeastOneOwner<Options> =
  | { readonly eval: (options: Options) => EvalPluginFragment }
  | { readonly experiment: (options: Options) => ExperimentPluginFragment }
  | { readonly group: (options: Options) => GroupPluginFragment };

interface LinkedResourceDemand {
  readonly receiver: string;
  readonly behaviorRevision: string;
  readonly projection: JsonValue;
  /** Internal only: callbacks receive this typed JSON payload, not the brand. */
  readonly payload: JsonValue;
  readonly resource: SandboxResource<string, JsonValue, unknown>;
}

export interface PluginInstanceData {
  readonly name: string;
  readonly behaviorRevision: string;
  readonly instanceKey: string;
  readonly eval?: Readonly<EvalPluginFragment>;
  readonly experiment?: Readonly<ExperimentPluginFragment>;
  readonly group?: Readonly<GroupPluginFragment>;
}

export interface AgentExtensionData {
  readonly receiver: string;
  readonly behaviorRevision: string;
  readonly projection: JsonValue;
  readonly payload: unknown;
}

const pluginInstances = new WeakMap<object, PluginInstanceData>();
const agentExtensions = new WeakMap<object, AgentExtensionData>();
const resourceDefinitions = new WeakMap<object, SandboxResourceDefinition<string, JsonValue, unknown>>();
const resourceDemands = new WeakMap<object, LinkedResourceDemand>();

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

function isPlainRecord(value: unknown): value is globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeJson(value: unknown, path: string, ancestors = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must not contain a non-finite number.`);
    return value;
  }
  if (typeof value !== "object") throw new TypeError(`${path} must be JSON-compatible.`);
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain a cycle.`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(value.map((item, index) => normalizeJson(item, `${path}[${index}]`, ancestors))) as unknown as JsonValue;
    }
    if (!isPlainRecord(value)) throw new TypeError(`${path} must contain only plain JSON objects.`);
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeJson(item, `${path}.${key}`, ancestors)]),
    ));
  } finally {
    ancestors.delete(value);
  }
}

function normalizeJsonRecord(value: unknown, path: string): Readonly<globalThis.Record<string, JsonValue>> {
  if (!isPlainRecord(value)) throw new TypeError(`${path} must be a JSON object.`);
  return normalizeJson(value, path) as Readonly<globalThis.Record<string, JsonValue>>;
}

function normalizeLabels(value: unknown, path: string): Readonly<globalThis.Record<string, string | number>> {
  if (!isPlainRecord(value)) throw new TypeError(`${path} must be an object.`);
  const normalized: globalThis.Record<string, string | number> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string" && (typeof item !== "number" || !Number.isFinite(item))) {
      throw new TypeError(`${path}.${key} must be a string or finite number.`);
    }
    normalized[key] = item;
  }
  return Object.freeze(normalized);
}

function normalizeCommandOnlyLayer(value: unknown, path: string): SandboxLayer<"command-only"> | undefined {
  if (value === undefined) return undefined;
  if (!isSandboxLayer(value) || sandboxLayerStateOf(value).kind !== "command-only") {
    throw new TypeError(`${path} must be a command-only SandboxLayer.`);
  }
  return value as SandboxLayer<"command-only">;
}

function normalizeResources(value: unknown, path: string): readonly SandboxResourceDemand[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return Object.freeze(value.map((entry, index) => {
    if (!isSandboxResourceDemand(entry)) throw new TypeError(`${path}[${index}] must be made by defineSandboxResource().`);
    return entry;
  }));
}

function normalizeAgentExtensions(value: unknown, path: string): readonly AgentExtension[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return Object.freeze(value.map((entry, index) => {
    if (!isAgentExtension(entry)) throw new TypeError(`${path}[${index}] must be receiver-branded.`);
    return entry;
  }));
}

function normalizeEvalFragment(value: unknown, path: string): Readonly<EvalPluginFragment> {
  if (!isPlainRecord(value)) throw new TypeError(`${path} must return an object.`);
  for (const key of Object.keys(value)) {
    if (!["identity", "resources", "sandbox"].includes(key)) {
      throw new TypeError(`${path}.${key} is not supported by Eval plugins.`);
    }
  }
  const identity = value.identity === undefined ? undefined : normalizeJsonRecord(value.identity, `${path}.identity`);
  const resources = normalizeResources(value.resources, `${path}.resources`);
  const sandbox = normalizeCommandOnlyLayer(value.sandbox, `${path}.sandbox`);
  return Object.freeze({
    ...(identity === undefined ? {} : { identity }),
    ...(resources.length === 0 ? {} : { resources }),
    ...(sandbox === undefined ? {} : { sandbox }),
  });
}

function normalizeExperimentFragment(value: unknown, path: string): Readonly<ExperimentPluginFragment> {
  if (!isPlainRecord(value)) throw new TypeError(`${path} must return an object.`);
  for (const key of Object.keys(value)) {
    if (!["identity", "flags", "labels", "sandbox", "setup", "teardown", "agentExtensions"].includes(key)) {
      throw new TypeError(`${path}.${key} is not supported by Experiment plugins.`);
    }
  }
  const identity = value.identity === undefined ? undefined : normalizeJsonRecord(value.identity, `${path}.identity`);
  const flags = value.flags === undefined ? undefined : normalizeJsonRecord(value.flags, `${path}.flags`);
  const labels = value.labels === undefined ? undefined : normalizeLabels(value.labels, `${path}.labels`);
  const sandbox = normalizeCommandOnlyLayer(value.sandbox, `${path}.sandbox`);
  if (value.setup !== undefined && typeof value.setup !== "function") throw new TypeError(`${path}.setup must be a function.`);
  if (value.teardown !== undefined && typeof value.teardown !== "function") throw new TypeError(`${path}.teardown must be a function.`);
  const agentExtensions = normalizeAgentExtensions(value.agentExtensions, `${path}.agentExtensions`);
  return Object.freeze({
    ...(identity === undefined ? {} : { identity }),
    ...(flags === undefined ? {} : { flags }),
    ...(labels === undefined ? {} : { labels }),
    ...(sandbox === undefined ? {} : { sandbox }),
    ...(value.setup === undefined ? {} : { setup: value.setup as ExperimentHook }),
    ...(value.teardown === undefined ? {} : { teardown: value.teardown as ExperimentHook }),
    ...(agentExtensions.length === 0 ? {} : { agentExtensions }),
  });
}

function normalizeGroupFragment(value: unknown, path: string): Readonly<GroupPluginFragment> {
  if (!isPlainRecord(value)) throw new TypeError(`${path} must return an object.`);
  for (const key of Object.keys(value)) {
    if (!["identity", "resources", "sandbox"].includes(key)) {
      throw new TypeError(`${path}.${key} is not supported by Eval Group plugins.`);
    }
  }
  const identity = value.identity === undefined ? undefined : normalizeJsonRecord(value.identity, `${path}.identity`);
  const resources = normalizeResources(value.resources, `${path}.resources`);
  const sandbox = normalizeCommandOnlyLayer(value.sandbox, `${path}.sandbox`);
  return Object.freeze({
    ...(identity === undefined ? {} : { identity }),
    ...(resources.length === 0 ? {} : { resources }),
    ...(sandbox === undefined ? {} : { sandbox }),
  });
}

type KeyedPluginDefinition<Options> = PluginDefinition<Options> & {
  readonly instanceKey: (options: Options) => string;
};

/** A no-option family has one stable occurrence identity and remains an explicit factory call. */
export function definePlugin(
  definition: PluginDefinition<void> & {
    readonly eval: () => EvalPluginFragment;
    readonly experiment: () => ExperimentPluginFragment;
    readonly group: () => GroupPluginFragment;
  },
): () => PluginInstance<PluginOwner>;
export function definePlugin(
  definition: PluginDefinition<void> & {
    readonly eval: () => EvalPluginFragment;
    readonly experiment: () => ExperimentPluginFragment;
  },
): () => PluginInstance<"eval" | "experiment">;
export function definePlugin(
  definition: PluginDefinition<void> & {
    readonly eval: () => EvalPluginFragment;
    readonly group: () => GroupPluginFragment;
  },
): () => PluginInstance<"eval" | "group">;
export function definePlugin(
  definition: PluginDefinition<void> & {
    readonly experiment: () => ExperimentPluginFragment;
    readonly group: () => GroupPluginFragment;
  },
): () => PluginInstance<"experiment" | "group">;
export function definePlugin(
  definition: PluginDefinition<void> & { readonly eval: () => EvalPluginFragment },
): () => PluginInstance<"eval">;
export function definePlugin(
  definition: PluginDefinition<void> & { readonly experiment: () => ExperimentPluginFragment },
): () => PluginInstance<"experiment">;
export function definePlugin(
  definition: PluginDefinition<void> & { readonly group: () => GroupPluginFragment },
): () => PluginInstance<"group">;

/** Construct a parameterized plugin family spanning all three supported owners. */
export function definePlugin<Options>(
  definition: KeyedPluginDefinition<Options> & {
    readonly eval: (options: Options) => EvalPluginFragment;
    readonly experiment: (options: Options) => ExperimentPluginFragment;
    readonly group: (options: Options) => GroupPluginFragment;
  },
): (options: Options) => PluginInstance<PluginOwner>;
/** Construct an Eval and Experiment plugin family. */
export function definePlugin<Options>(
  definition: KeyedPluginDefinition<Options> & {
    readonly eval: (options: Options) => EvalPluginFragment;
    readonly experiment: (options: Options) => ExperimentPluginFragment;
  },
): (options: Options) => PluginInstance<"eval" | "experiment">;
/** Construct an Eval and Group plugin family. */
export function definePlugin<Options>(
  definition: KeyedPluginDefinition<Options> & {
    readonly eval: (options: Options) => EvalPluginFragment;
    readonly group: (options: Options) => GroupPluginFragment;
  },
): (options: Options) => PluginInstance<"eval" | "group">;
/** Construct an Experiment and Group plugin family. */
export function definePlugin<Options>(
  definition: KeyedPluginDefinition<Options> & {
    readonly experiment: (options: Options) => ExperimentPluginFragment;
    readonly group: (options: Options) => GroupPluginFragment;
  },
): (options: Options) => PluginInstance<"experiment" | "group">;
/** Construct an Eval-only plugin family and normalize each occurrence immediately. */
export function definePlugin<Options>(
  definition: KeyedPluginDefinition<Options> & { readonly eval: (options: Options) => EvalPluginFragment },
): (options: Options) => PluginInstance<"eval">;
/** Construct an Experiment-only plugin family and normalize each occurrence immediately. */
export function definePlugin<Options>(
  definition: KeyedPluginDefinition<Options> & { readonly experiment: (options: Options) => ExperimentPluginFragment },
): (options: Options) => PluginInstance<"experiment">;
/** Construct a Group-only plugin family and normalize each occurrence immediately. */
export function definePlugin<Options>(
  definition: KeyedPluginDefinition<Options> & { readonly group: (options: Options) => GroupPluginFragment },
): (options: Options) => PluginInstance<"group">;
/** Runtime implementation shared by the public ownership overloads. */
export function definePlugin(
  definition: PluginDefinition<any> & AtLeastOneOwner<any>,
): (...options: readonly unknown[]) => PluginInstance<PluginOwner> {
  if (!isPlainRecord(definition)) throw new TypeError("definePlugin requires an object.");
  const name = assertNonEmptyString(definition.name, "definePlugin name");
  const behaviorRevision = assertNonEmptyString(definition.behaviorRevision, "definePlugin behaviorRevision");
  if (definition.instanceKey !== undefined && typeof definition.instanceKey !== "function") {
    throw new TypeError("definePlugin instanceKey must be a function when provided.");
  }
  if (definition.eval === undefined && definition.experiment === undefined && definition.group === undefined) {
    throw new TypeError("definePlugin must declare at least one owner callback.");
  }
  for (const [owner, callback] of [
    ["eval", definition.eval],
    ["experiment", definition.experiment],
    ["group", definition.group],
  ] as const) {
    if (callback !== undefined && typeof callback !== "function") throw new TypeError(`definePlugin ${owner} must be a function.`);
  }
  return (...args: readonly unknown[]): PluginInstance<PluginOwner> => {
    if (definition.instanceKey === undefined && args.length !== 0) {
      throw new TypeError(`Plugin ${name} takes no options.`);
    }
    if (definition.instanceKey !== undefined && args.length !== 1) {
      throw new TypeError(`Plugin ${name} requires exactly one options value.`);
    }
    const options = args[0];
    const instanceKey = definition.instanceKey === undefined
      ? "default"
      : assertNonEmptyString(definition.instanceKey(options), `Plugin ${name} instanceKey`);
    const data: PluginInstanceData = Object.freeze({
      name,
      behaviorRevision,
      instanceKey,
      ...(definition.eval === undefined ? {} : { eval: normalizeEvalFragment(definition.eval(options), `Plugin ${name}.eval`) }),
      ...(definition.experiment === undefined
        ? {}
        : { experiment: normalizeExperimentFragment(definition.experiment(options), `Plugin ${name}.experiment`) }),
      ...(definition.group === undefined ? {} : { group: normalizeGroupFragment(definition.group(options), `Plugin ${name}.group`) }),
    });
    const instance = Object.freeze({}) as PluginInstance<PluginOwner>;
    pluginInstances.set(instance, data);
    return instance;
  };
}

/** Create an opaque, receiver-branded agent extension from normalized behavior. */
export function defineAgentExtension<Receiver extends string>(input: {
  readonly receiver: Receiver;
  readonly behaviorRevision: string;
  readonly projection: JsonValue;
  readonly payload: unknown;
}): AgentExtension<Receiver> {
  const receiver = assertNonEmptyString(input.receiver, "AgentExtension receiver") as Receiver;
  const behaviorRevision = assertNonEmptyString(input.behaviorRevision, "AgentExtension behaviorRevision");
  const extension = Object.freeze({}) as AgentExtension<Receiver>;
  agentExtensions.set(extension, Object.freeze({
    receiver,
    behaviorRevision,
    projection: normalizeJson(input.projection, "AgentExtension projection"),
    payload: input.payload,
  }));
  return extension;
}

/** Define a resource receiver and return its demand constructor. */
export function defineSandboxResource<Receiver extends string, Demand extends JsonValue, Handle>(
  definition: SandboxResourceDefinition<Receiver, Demand, Handle>,
): SandboxResource<Receiver, Demand, Handle> {
  if (!isPlainRecord(definition)) throw new TypeError("defineSandboxResource requires an object.");
  const receiver = assertNonEmptyString(definition.receiver, "SandboxResource receiver") as Receiver;
  const behaviorRevision = assertNonEmptyString(definition.behaviorRevision, "SandboxResource behaviorRevision");
  if (typeof definition.demand !== "function" || typeof definition.materialize !== "function") {
    throw new TypeError("defineSandboxResource requires demand and materialize callbacks.");
  }
  if (definition.prepare !== undefined && typeof definition.prepare !== "function") throw new TypeError("SandboxResource prepare must be a function.");
  if (definition.release !== undefined && typeof definition.release !== "function") throw new TypeError("SandboxResource release must be a function.");
  const normalizedDefinition = Object.freeze({ ...definition, receiver, behaviorRevision }) as unknown as SandboxResourceDefinition<string, JsonValue, unknown>;
  const resource = ((value: Demand): SandboxResourceDemand<Receiver> => {
    // Both the projection and the callback payload become JSON-only immutable
    // values before the opaque token leaves this factory. Core plans only with
    // `projection`; only this module can hand `payload` back to its resource.
    const payload = normalizeJson(value, `SandboxResource ${receiver} value`);
    const projection = normalizeJson(normalizedDefinition.demand(payload), `SandboxResource ${receiver} demand`);
    const demand = Object.freeze({}) as SandboxResourceDemand<Receiver>;
    resourceDemands.set(demand, Object.freeze({
      receiver,
      behaviorRevision,
      projection,
      payload,
      resource: resource as unknown as SandboxResource<string, JsonValue, unknown>,
    }));
    return demand;
  }) as SandboxResource<Receiver, Demand, Handle>;
  resourceDefinitions.set(resource, normalizedDefinition);
  return resource;
}

export function isPluginInstance(value: unknown): value is PluginInstance {
  return typeof value === "object" && value !== null && pluginInstances.has(value);
}

export function pluginInstanceDataOf(value: PluginInstance): PluginInstanceData {
  const data = pluginInstances.get(value);
  if (data === undefined) throw new TypeError("Plugin instance must be created by definePlugin().");
  return data;
}

export function isAgentExtension(value: unknown): value is AgentExtension {
  return typeof value === "object" && value !== null && agentExtensions.has(value);
}

export function agentExtensionDataOf(value: AgentExtension<any>): AgentExtensionData {
  const data = agentExtensions.get(value);
  if (data === undefined) throw new TypeError("AgentExtension must be receiver-branded.");
  return data;
}

export function isSandboxResourceDemand(value: unknown): value is SandboxResourceDemand {
  return typeof value === "object" && value !== null && resourceDemands.has(value);
}

export function sandboxResourceDemandDataOf(value: SandboxResourceDemand): LinkedResourceDemand {
  const data = resourceDemands.get(value);
  if (data === undefined) throw new TypeError("Sandbox resource demand must be created by defineSandboxResource().");
  return data;
}

export function sandboxResourceDefinitionOf(
  resource: SandboxResource<string, JsonValue, unknown>,
): SandboxResourceDefinition<string, JsonValue, unknown> {
  const definition = resourceDefinitions.get(resource);
  if (definition === undefined) throw new TypeError("Sandbox resource must be created by defineSandboxResource().");
  return definition;
}

/** The core only calls this receiver method; it never inspects adapter payload. */
export interface PluginAgentReceiver {
  readonly id: string;
  compose(agent: Agent, extensions: readonly AgentExtension[]): Agent;
  projection(extensions: readonly AgentExtension[]): JsonValue;
}

/** Internal helper shared by adapters and the zero-resource linker. */
export function receiverExtensionsFor(
  receiver: PluginAgentReceiver,
  extensions: readonly AgentExtension<any>[],
): readonly AgentExtension<any>[] {
  for (const extension of extensions) {
    const data = agentExtensionDataOf(extension);
    if (data.receiver !== receiver.id) {
      throw new TypeError(
        `Agent extension receiver ${JSON.stringify(data.receiver)} is unsupported by ${JSON.stringify(receiver.id)}.`,
      );
    }
  }
  return Object.freeze([...extensions]);
}

/** Public composition helper. Unsupported receivers fail before any Sandbox is created. */
export function composeAgentExtensions(agent: Agent, extensions: readonly AgentExtension<any>[]): Agent {
  const receiver = agent.pluginReceiver;
  if (receiver === undefined) {
    const requested = extensions.map((extension) => agentExtensionDataOf(extension).receiver).join(", ");
    throw new TypeError(`Agent ${JSON.stringify(agent.name)} does not support plugin extension receiver(s): ${requested}.`);
  }
  return receiver.compose(agent, receiverExtensionsFor(receiver, extensions));
}

/** Internal projection used by configHash; no runtime credentials are present. */
export function agentExtensionsProjection(extensions: readonly AgentExtension<any>[]): JsonValue {
  return Object.freeze(extensions.map((extension) => {
    const data = agentExtensionDataOf(extension);
    return Object.freeze({ receiver: data.receiver, behaviorRevision: data.behaviorRevision, behavior: data.projection });
  })) as unknown as JsonValue;
}

/** Public narrow command type for extension constructors. */
export type AgentExtensionCommand = SandboxCommand;
