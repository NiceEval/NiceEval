// Plugin owns stable identity and scoped host setup/teardown. Its optional
// command-only SandboxLayer is projected onto that host owner; templates,
// configuration, and resource handles stay with their existing owners.

import type { ExperimentHookContext } from "../runner/types.ts";
import type { JsonValue, ScopedFeedback } from "../shared/types.ts";
import {
  isSandboxLayer,
  sandboxLayerStateOf,
  type SandboxLayer,
} from "../sandbox/layer.ts";

export type PluginOwner = "experiment" | "group" | "eval";
export type PluginScope = PluginOwner | "sandbox";
export type PluginOnUnavailable = "stop-group" | "replace-sandbox";

declare const PLUGIN_INSTANCE: unique symbol;

export interface PluginInstance<Owners extends PluginOwner = PluginOwner> {
  readonly [PLUGIN_INSTANCE]: (owner: Owners) => void;
}

export type PluginHook<Context> = (context: Context) => void | Promise<void>;

export interface GroupPluginContext extends ScopedFeedback {
  readonly experimentId: string;
  readonly evalGroupId: string;
  readonly signal: AbortSignal;
}

export interface EvalPluginContext extends ScopedFeedback {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly evalGroupId?: string;
  readonly signal: AbortSignal;
}

export type ExperimentPluginContext = ExperimentHookContext;

export type PluginLifecycleFragment<Hook> = Readonly<{
  readonly identity?: Readonly<globalThis.Record<string, JsonValue>>;
} & (
  | { readonly setup: Hook; readonly teardown?: Hook }
  | { readonly setup?: Hook; readonly teardown: Hook }
)>;

export type ExperimentPluginFragment = PluginLifecycleFragment<PluginHook<ExperimentHookContext>>;
export type GroupPluginFragment = PluginLifecycleFragment<PluginHook<GroupPluginContext>>;
export type SandboxPluginFragment = SandboxLayer<"command-only">;
export type EvalPluginFragment = PluginLifecycleFragment<PluginHook<EvalPluginContext>>;

export interface PluginDefinition<Options> {
  readonly name: string;
  readonly behaviorRevision: string;
  readonly instanceKey?: (options: Options) => string;
  readonly experiment?: (options: Options) => ExperimentPluginFragment;
  readonly group?: (options: Options) => GroupPluginFragment;
  readonly sandbox?: (options: Options) => SandboxPluginFragment;
  readonly eval?: (options: Options) => EvalPluginFragment;
}

type AtLeastOneScope<Options> =
  | { readonly experiment: (options: Options) => ExperimentPluginFragment }
  | { readonly group: (options: Options) => GroupPluginFragment }
  | { readonly sandbox: (options: Options) => SandboxPluginFragment }
  | { readonly eval: (options: Options) => EvalPluginFragment };

type HostFragmentFactories<Options> = Readonly<{
  experiment: (options: Options) => ExperimentPluginFragment;
  group: (options: Options) => GroupPluginFragment;
  eval: (options: Options) => EvalPluginFragment;
}>;

type ExactHostFragments<Options, Owners extends PluginOwner> =
  & { readonly [Owner in Owners]-?: HostFragmentFactories<Options>[Owner] }
  & { readonly [Owner in Exclude<PluginOwner, Owners>]?: never };

type OptionedPluginDefinition<Options, Owners extends PluginOwner> =
  & Omit<PluginDefinition<Options>, PluginOwner | "instanceKey">
  & ExactHostFragments<Options, Owners>
  & { readonly instanceKey: (options: Options) => string };

type OptionedSandboxOnlyPluginDefinition<Options> =
  & Omit<PluginDefinition<Options>, PluginOwner | "sandbox" | "instanceKey">
  & { readonly [Owner in PluginOwner]?: never }
  & {
    readonly sandbox: (options: Options) => SandboxPluginFragment;
    readonly instanceKey: (options: Options) => string;
  };

type HostScopesOf<Definition> =
  | (Definition extends { readonly experiment: (...args: any[]) => unknown } ? "experiment" : never)
  | (Definition extends { readonly group: (...args: any[]) => unknown } ? "group" : never)
  | (Definition extends { readonly eval: (...args: any[]) => unknown } ? "eval" : never);

type ScopesOf<Definition> = [HostScopesOf<Definition>] extends [never]
  ? Definition extends { readonly sandbox: (...args: any[]) => unknown } ? PluginOwner : never
  : HostScopesOf<Definition>;

type NormalizedPluginLifecycleFragment<Hook> = Readonly<{
  readonly identity: Readonly<globalThis.Record<string, JsonValue>>;
  readonly setup?: Hook;
  readonly teardown?: Hook;
  readonly hostDeclared: boolean;
}>;

export interface PluginInstanceData {
  readonly name: string;
  readonly behaviorRevision: string;
  readonly instanceKey: string;
  readonly experiment?: NormalizedPluginLifecycleFragment<PluginHook<ExperimentHookContext>>;
  readonly group?: NormalizedPluginLifecycleFragment<PluginHook<GroupPluginContext>>;
  readonly sandbox?: SandboxPluginFragment;
  readonly eval?: NormalizedPluginLifecycleFragment<PluginHook<EvalPluginContext>>;
}

export interface LinkedPluginLifecycle {
  readonly scope: PluginOwner;
  readonly name: string;
  readonly behaviorRevision: string;
  readonly instanceKey: string;
  readonly identity: Readonly<globalThis.Record<string, JsonValue>>;
  readonly arrayPosition: number;
  readonly hasSetup: boolean;
  readonly hasTeardown: boolean;
  readonly hostDeclared: boolean;
  readonly sandboxLayer?: SandboxPluginFragment;
  readonly setup?: PluginHook<any>;
  readonly teardown?: PluginHook<any>;
}

const pluginInstances = new WeakMap<object, PluginInstanceData>();

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
      const normalized: JsonValue[] = value.map((item, index) => normalizeJson(item, `${path}[${index}]`, ancestors));
      Object.freeze(normalized);
      return normalized;
    }
    if (!isPlainRecord(value)) throw new TypeError(`${path} must contain only plain JSON objects.`);
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeJson(item, `${path}.${key}`, ancestors)]),
    ));
  } finally {
    ancestors.delete(value);
  }
}

function normalizeFragment<Hook>(value: unknown, path: string): NormalizedPluginLifecycleFragment<Hook> {
  if (!isPlainRecord(value)) throw new TypeError(`${path} must return an object.`);
  for (const key of Object.keys(value)) {
    if (!["identity", "setup", "teardown"].includes(key)) {
      throw new TypeError(`${path}.${key} is not supported by lifecycle plugins.`);
    }
  }
  if (value.setup === undefined && value.teardown === undefined) {
    throw new TypeError(`${path} must declare setup or teardown.`);
  }
  if (value.setup !== undefined && typeof value.setup !== "function") throw new TypeError(`${path}.setup must be a function.`);
  if (value.teardown !== undefined && typeof value.teardown !== "function") throw new TypeError(`${path}.teardown must be a function.`);
  const identity = value.identity === undefined ? Object.freeze({}) : normalizeJson(value.identity, `${path}.identity`);
  if (!isPlainRecord(identity)) throw new TypeError(`${path}.identity must be a JSON object.`);
  return Object.freeze({
    identity: identity as Readonly<globalThis.Record<string, JsonValue>>,
    hostDeclared: true,
    ...(value.setup === undefined ? {} : { setup: value.setup as Hook }),
    ...(value.teardown === undefined ? {} : { teardown: value.teardown as Hook }),
  });
}

function normalizeSandboxFragment(value: unknown, path: string): SandboxPluginFragment {
  if (!isSandboxLayer(value)) {
    throw new TypeError(`${path} must return a branded SandboxLayer.`);
  }
  const state = sandboxLayerStateOf(value);
  if (state.kind !== "command-only") {
    throw new TypeError(`${path} must return a command-only SandboxLayer.`);
  }
  return value as SandboxPluginFragment;
}

const SANDBOX_ONLY_HOST_FRAGMENT = Object.freeze({
  identity: Object.freeze({}),
  hostDeclared: false,
});

export function definePlugin<
  Options,
  const Definition extends PluginDefinition<Options> & AtLeastOneScope<Options>,
>(
  definition: Definition & { readonly instanceKey: (options: Options) => string },
): (options: Options) => PluginInstance<ScopesOf<Definition>>;
export function definePlugin<Options>(
  definition: OptionedPluginDefinition<Options, PluginOwner>,
): (options: Options) => PluginInstance<PluginOwner>;
export function definePlugin<Options>(
  definition: OptionedPluginDefinition<Options, "experiment" | "group">,
): (options: Options) => PluginInstance<"experiment" | "group">;
export function definePlugin<Options>(
  definition: OptionedPluginDefinition<Options, "experiment" | "eval">,
): (options: Options) => PluginInstance<"experiment" | "eval">;
export function definePlugin<Options>(
  definition: OptionedPluginDefinition<Options, "group" | "eval">,
): (options: Options) => PluginInstance<"group" | "eval">;
export function definePlugin<Options>(
  definition: OptionedPluginDefinition<Options, "experiment">,
): (options: Options) => PluginInstance<"experiment">;
export function definePlugin<Options>(
  definition: OptionedPluginDefinition<Options, "group">,
): (options: Options) => PluginInstance<"group">;
export function definePlugin<Options>(
  definition: OptionedPluginDefinition<Options, "eval">,
): (options: Options) => PluginInstance<"eval">;
export function definePlugin<Options>(
  definition: OptionedSandboxOnlyPluginDefinition<Options>,
): (options: Options) => PluginInstance<PluginOwner>;
/** Broadly annotated dynamic definitions retain runtime owner validation. */
export function definePlugin<Options>(
  definition: PluginDefinition<Options> & AtLeastOneScope<Options> & {
    readonly instanceKey: (options: Options) => string;
  },
): (options: Options) => PluginInstance<PluginOwner>;
export function definePlugin<const Definition extends PluginDefinition<void> & AtLeastOneScope<void>>(
  definition: Definition & { readonly instanceKey?: never },
): () => PluginInstance<ScopesOf<Definition>>;
export function definePlugin(
  definition: PluginDefinition<any> & AtLeastOneScope<any>,
): (...args: readonly unknown[]) => PluginInstance<PluginOwner> {
  if (!isPlainRecord(definition)) throw new TypeError("definePlugin requires an object.");
  const name = assertNonEmptyString(definition.name, "definePlugin name");
  const behaviorRevision = assertNonEmptyString(definition.behaviorRevision, "definePlugin behaviorRevision");
  if (definition.instanceKey !== undefined && typeof definition.instanceKey !== "function") {
    throw new TypeError("definePlugin instanceKey must be a function when provided.");
  }
  const scopes = ["experiment", "group", "sandbox", "eval"] as const;
  if (!scopes.some((scope) => definition[scope] !== undefined)) {
    throw new TypeError("definePlugin must declare at least one scope callback.");
  }
  for (const scope of scopes) {
    if (definition[scope] !== undefined && typeof definition[scope] !== "function") {
      throw new TypeError(`definePlugin ${scope} must be a function.`);
    }
  }
  return (...args: readonly unknown[]): PluginInstance<PluginOwner> => {
    if (definition.instanceKey === undefined && args.length !== 0) throw new TypeError(`Plugin ${name} takes no options.`);
    if (definition.instanceKey !== undefined && args.length !== 1) throw new TypeError(`Plugin ${name} requires exactly one options value.`);
    const options = args[0];
    const instanceKey = definition.instanceKey === undefined
      ? "default"
      : assertNonEmptyString(definition.instanceKey(options), `Plugin ${name} instanceKey`);
    const sandboxOnly = definition.sandbox !== undefined &&
      definition.experiment === undefined &&
      definition.group === undefined &&
      definition.eval === undefined;
    const experiment: PluginInstanceData["experiment"] = definition.experiment === undefined
      ? sandboxOnly ? SANDBOX_ONLY_HOST_FRAGMENT : undefined
      : normalizeFragment<PluginHook<ExperimentHookContext>>(
          definition.experiment(options),
          `Plugin ${name}.experiment`,
        );
    const group: PluginInstanceData["group"] = definition.group === undefined
      ? sandboxOnly ? SANDBOX_ONLY_HOST_FRAGMENT : undefined
      : normalizeFragment<PluginHook<GroupPluginContext>>(
          definition.group(options),
          `Plugin ${name}.group`,
        );
    const sandbox = definition.sandbox === undefined
      ? undefined
      : normalizeSandboxFragment(definition.sandbox(options), `Plugin ${name}.sandbox`);
    const evalFragment: PluginInstanceData["eval"] = definition.eval === undefined
      ? sandboxOnly ? SANDBOX_ONLY_HOST_FRAGMENT : undefined
      : normalizeFragment<PluginHook<EvalPluginContext>>(
          definition.eval(options),
          `Plugin ${name}.eval`,
        );
    const data: PluginInstanceData = Object.freeze({
      name,
      behaviorRevision,
      instanceKey,
      ...(experiment === undefined ? {} : { experiment }),
      ...(group === undefined ? {} : { group }),
      ...(sandbox === undefined ? {} : { sandbox }),
      ...(evalFragment === undefined ? {} : { eval: evalFragment }),
    });
    const instance = Object.freeze({}) as PluginInstance<PluginOwner>;
    pluginInstances.set(instance, data);
    return instance;
  };
}

export function isPluginInstance(value: unknown): value is PluginInstance {
  return typeof value === "object" && value !== null && pluginInstances.has(value);
}

export function pluginInstanceDataOf(value: PluginInstance<any>): PluginInstanceData {
  const data = pluginInstances.get(value);
  if (data === undefined) throw new TypeError("Plugin instance must be created by definePlugin().");
  return data;
}

export function linkPluginLifecycles<Scope extends PluginOwner>(
  plugins: readonly PluginInstance<Scope>[],
  scope: Scope,
): readonly LinkedPluginLifecycle[] {
  const seen = new Set<string>();
  return Object.freeze(plugins.map((plugin, arrayPosition) => {
    const data = pluginInstanceDataOf(plugin);
    const fragment = data[scope];
    if (fragment === undefined) throw new TypeError(`Plugin ${JSON.stringify(data.name)} does not support ${scope} attachment.`);
    const duplicateKey = JSON.stringify([data.name, data.instanceKey]);
    if (seen.has(duplicateKey)) {
      throw new TypeError(`Duplicate ${scope} plugin occurrence (${JSON.stringify(data.name)}, ${JSON.stringify(data.instanceKey)}).`);
    }
    seen.add(duplicateKey);
    return Object.freeze({
      scope,
      name: data.name,
      behaviorRevision: data.behaviorRevision,
      instanceKey: data.instanceKey,
      identity: fragment.identity,
      arrayPosition,
      hasSetup: fragment.setup !== undefined,
      hasTeardown: fragment.teardown !== undefined,
      hostDeclared: fragment.hostDeclared,
      ...(data.sandbox === undefined ? {} : { sandboxLayer: data.sandbox }),
      ...(fragment.setup === undefined ? {} : { setup: fragment.setup }),
      ...(fragment.teardown === undefined ? {} : { teardown: fragment.teardown }),
    });
  }));
}

export function pluginLifecycleIdentity(
  { scope, name, behaviorRevision, instanceKey, identity, arrayPosition, hasSetup, hasTeardown }: LinkedPluginLifecycle,
): JsonValue {
  return Object.freeze({
    scope,
    name,
    behaviorRevision,
    instanceKey,
    identity,
    arrayPosition,
    hasSetup,
    hasTeardown,
  });
}

export function pluginLifecycleProjection(lifecycles: readonly LinkedPluginLifecycle[]): JsonValue {
  const projection: JsonValue[] = lifecycles.map(pluginLifecycleIdentity);
  Object.freeze(projection);
  return projection;
}
