// Plugin is deliberately a small lifecycle composition surface. It owns
// stable identity and scoped setup/teardown only; configuration, commands and
// resource handles stay with their existing owners.

import type { ExperimentHookContext } from "../runner/types.ts";
import type { FactValue } from "../shared/facts.ts";
import type { JsonValue, ScopedFeedback } from "../shared/types.ts";
import type { Sandbox, SandboxHookContext } from "../sandbox/types.ts";

export type PluginScope = "experiment" | "group" | "sandbox" | "eval";
/** @deprecated Internal compatibility alias while the runner migrates to scope terminology. */
export type PluginOwner = Exclude<PluginScope, "sandbox">;
export type PluginOnUnavailable = "stop-group" | "replace-sandbox";

declare const PLUGIN_INSTANCE: unique symbol;

export interface PluginInstance<Scopes extends PluginScope = PluginScope> {
  readonly [PLUGIN_INSTANCE]: (scope: Scopes) => void;
}

export type PluginHook<Context> = (context: Context) => void | Promise<void>;
export type SandboxPluginHook = (sandbox: Sandbox, context: SandboxHookContext) => void | Promise<void>;

export interface GroupPluginContext extends ScopedFeedback {
  readonly experimentId: string;
  readonly evalGroupId: string;
  readonly signal: AbortSignal;
  fact(key: string, value: FactValue): void;
}

export interface EvalPluginContext extends ScopedFeedback {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly evalGroupId?: string;
  readonly signal: AbortSignal;
  fact(key: string, value: FactValue): void;
}

export type ExperimentPluginContext = ExperimentHookContext;
export type SandboxPluginContext = SandboxHookContext;

export type PluginLifecycleFragment<Hook> = Readonly<{
  readonly identity?: Readonly<globalThis.Record<string, JsonValue>>;
} & (
  | { readonly setup: Hook; readonly teardown?: Hook }
  | { readonly setup?: Hook; readonly teardown: Hook }
)>;

export type ExperimentPluginFragment = PluginLifecycleFragment<PluginHook<ExperimentHookContext>>;
export type GroupPluginFragment = PluginLifecycleFragment<PluginHook<GroupPluginContext>>;
export type SandboxPluginFragment = PluginLifecycleFragment<SandboxPluginHook>;
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

type ScopesOf<Definition> =
  | (Definition extends { readonly experiment: (...args: any[]) => unknown } ? "experiment" : never)
  | (Definition extends { readonly group: (...args: any[]) => unknown } ? "group" : never)
  | (Definition extends { readonly sandbox: (...args: any[]) => unknown } ? "sandbox" : never)
  | (Definition extends { readonly eval: (...args: any[]) => unknown } ? "eval" : never);

export interface PluginInstanceData {
  readonly name: string;
  readonly behaviorRevision: string;
  readonly instanceKey: string;
  readonly experiment?: ExperimentPluginFragment;
  readonly group?: GroupPluginFragment;
  readonly sandbox?: SandboxPluginFragment;
  readonly eval?: EvalPluginFragment;
}

export interface LinkedPluginLifecycle {
  readonly scope: PluginScope;
  readonly name: string;
  readonly behaviorRevision: string;
  readonly instanceKey: string;
  readonly identity: Readonly<globalThis.Record<string, JsonValue>>;
  readonly arrayPosition: number;
  readonly hasSetup: boolean;
  readonly hasTeardown: boolean;
  readonly setup?: PluginHook<any> | SandboxPluginHook;
  readonly teardown?: PluginHook<any> | SandboxPluginHook;
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
      return Object.freeze(value.map((item, index) => normalizeJson(item, `${path}[${index}]`, ancestors))) as JsonValue;
    }
    if (!isPlainRecord(value)) throw new TypeError(`${path} must contain only plain JSON objects.`);
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeJson(item, `${path}.${key}`, ancestors)]),
    ));
  } finally {
    ancestors.delete(value);
  }
}

function normalizeFragment<Hook>(value: unknown, path: string): PluginLifecycleFragment<Hook> {
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
    ...(value.setup === undefined ? {} : { setup: value.setup as Hook }),
    ...(value.teardown === undefined ? {} : { teardown: value.teardown as Hook }),
  }) as PluginLifecycleFragment<Hook>;
}

export function definePlugin<const Definition extends PluginDefinition<void> & AtLeastOneScope<void>>(
  definition: Definition & { readonly instanceKey?: never },
): () => PluginInstance<ScopesOf<Definition>>;
export function definePlugin<Options, const Definition extends PluginDefinition<Options> & AtLeastOneScope<Options>>(
  definition: Definition & { readonly instanceKey: (options: Options) => string },
): (options: Options) => PluginInstance<ScopesOf<Definition>>;
/** Explicit `definePlugin<Options>(...)` form; runtime link still validates the exact attachment scope. */
export function definePlugin<Options>(
  definition: PluginDefinition<Options> & AtLeastOneScope<Options> & {
    readonly instanceKey: (options: Options) => string;
  },
): (options: Options) => PluginInstance<PluginScope>;
export function definePlugin(
  definition: PluginDefinition<any> & AtLeastOneScope<any>,
): (...args: readonly unknown[]) => PluginInstance<PluginScope> {
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
  return (...args: readonly unknown[]): PluginInstance<PluginScope> => {
    if (definition.instanceKey === undefined && args.length !== 0) throw new TypeError(`Plugin ${name} takes no options.`);
    if (definition.instanceKey !== undefined && args.length !== 1) throw new TypeError(`Plugin ${name} requires exactly one options value.`);
    const options = args[0];
    const instanceKey = definition.instanceKey === undefined
      ? "default"
      : assertNonEmptyString(definition.instanceKey(options), `Plugin ${name} instanceKey`);
    const data: PluginInstanceData = Object.freeze({
      name,
      behaviorRevision,
      instanceKey,
      ...Object.fromEntries(scopes.flatMap((scope) => {
        const factory = definition[scope];
        return factory === undefined ? [] : [[scope, normalizeFragment(factory(options), `Plugin ${name}.${scope}`)]];
      })),
    });
    const instance = Object.freeze({}) as PluginInstance<PluginScope>;
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

export function linkPluginLifecycles<Scope extends PluginScope>(
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
      identity: fragment.identity ?? Object.freeze({}),
      arrayPosition,
      hasSetup: fragment.setup !== undefined,
      hasTeardown: fragment.teardown !== undefined,
      ...(fragment.setup === undefined ? {} : { setup: fragment.setup }),
      ...(fragment.teardown === undefined ? {} : { teardown: fragment.teardown }),
    });
  }));
}

/** @internal Project an optional secondary fragment (currently sandbox) from an existing attachment. */
export function projectPluginLifecycles<Scope extends PluginScope>(
  plugins: readonly PluginInstance<any>[],
  scope: Scope,
): readonly LinkedPluginLifecycle[] {
  return Object.freeze(plugins.flatMap((plugin, arrayPosition) => {
    const data = pluginInstanceDataOf(plugin);
    const fragment = data[scope];
    if (fragment === undefined) return [];
    return [Object.freeze({
      scope,
      name: data.name,
      behaviorRevision: data.behaviorRevision,
      instanceKey: data.instanceKey,
      identity: fragment.identity ?? Object.freeze({}),
      arrayPosition,
      hasSetup: fragment.setup !== undefined,
      hasTeardown: fragment.teardown !== undefined,
      ...(fragment.setup === undefined ? {} : { setup: fragment.setup }),
      ...(fragment.teardown === undefined ? {} : { teardown: fragment.teardown }),
    })];
  }));
}

export function pluginLifecycleProjection(lifecycles: readonly LinkedPluginLifecycle[]): JsonValue {
  return lifecycles.map(({ scope, name, behaviorRevision, instanceKey, identity, arrayPosition, hasSetup, hasTeardown }) => ({
    scope, name, behaviorRevision, instanceKey, identity, arrayPosition, hasSetup, hasTeardown,
  }));
}
