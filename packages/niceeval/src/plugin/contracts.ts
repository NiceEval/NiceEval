// @concord-file
// @concord-implements docs/feature/plugins/README.md
// @concord-implements docs/feature/compile-time-contracts/README.md
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { registerSandboxContent } from "../sandbox/content.ts";
import type { ExperimentHookContext } from "../runner/types.ts";
import type { JsonValue, ScopedFeedback } from "../shared/types.ts";
import { isSandboxLayer, sandboxLayerStateOf, sandboxLayer, type SandboxLayer } from "../sandbox/layer.ts";
import type { SandboxAction, SandboxAfterAction } from "../sandbox/action.ts";
import type {
  SandboxCommand,
  SandboxCommandContext,
  SandboxCommandTarget,
  SandboxCleanupCommand,
} from "../sandbox/commands.ts";
import type { CodexConfig } from "../agents/codex.ts";
import type { ClaudeCodeConfig } from "../agents/claude-code.ts";
import type { BubConfig } from "../agents/bub.ts";
import type { SkillSpec, McpServer } from "../agents/types.ts";

/** Identifies where a Plugin is mounted; each owner allows only its supported contribution fields. */
export type PluginOwner = "experiment" | "group" | "eval";
/** Identifies which lifecycle a Plugin contribution participates in; mount ownership and execution scope are separate concepts. */
export type PluginScope = "experiment" | "group" | "sandbox" | "attempt";
/** Chooses whether an unavailable grouped Sandbox stops the Group or is replaced; the policy concerns the physical instance rather than an ordinary assertion failure. */
export type PluginOnUnavailable = "stop-group" | "replace-sandbox";
declare const PLUGIN_INSTANCE: unique symbol;
/** An opaque frozen condition returned by definePlugin; its allowed owners constrain where it may be mounted. */
export interface PluginInstance<Owners extends PluginOwner = PluginOwner> {
  readonly [PLUGIN_INSTANCE]: (owner: Owners) => void;
}
export type PluginHook<Context> = (context: Context) => void | Promise<void>;
/** Provides feedback and cancellation for one Eval Group lane; group lifecycle is not run for ungrouped Evals. */
export interface GroupPluginContext extends ScopedFeedback {
  readonly experimentId: string;
  readonly evalGroupId: string;
  readonly signal: AbortSignal;
}
type EvalGroupRef = NonNullable<SandboxCommandContext["evalGroup"]>;
/** Provides feedback, cancellation and identity for one fresh Attempt; evalGroup is available only when the selected Eval belongs to a Group. */
export interface AttemptPluginContext extends ScopedFeedback {
  readonly experimentId: string;
  readonly evalId: string;
  readonly attempt: number;
  readonly evalGroup?: EvalGroupRef;
  readonly signal: AbortSignal;
}
/** Provides selected Eval identities and feedback for Experiment lifecycle work; this scope is shared across its Attempts. */
export type ExperimentPluginContext = ExperimentHookContext;
export type PluginElements<Element> = Element | readonly Element[];
/** Declares before and after elements as one value or a readonly array; lifecycle scheduling is owned by the receiving scope. */
export type PluginLifecycleFragment<Hook> = Readonly<{
  readonly before?: PluginElements<Hook>;
  readonly after?: PluginElements<Hook>;
}>;
/** Declares Experiment-level lifecycle work; it is distinct from per-Attempt and per-Sandbox preparation. */
export type ExperimentPluginFragment = PluginLifecycleFragment<PluginHook<ExperimentHookContext>>;
/** Declares lifecycle work once per Group lane; use this for lane-wide work rather than per-Attempt Sandbox fragments. */
export type GroupPluginFragment = PluginLifecycleFragment<PluginHook<GroupPluginContext>>;
type GroupContext<Context, Required extends boolean> = Required extends true
  ? Omit<Context, "evalGroup"> & { readonly evalGroup: EvalGroupRef }
  : Context;
/** Declares before and after work for each fresh Attempt; requiring an Eval Group makes its context mandatory at selection time. */
export type AttemptPluginFragment<Required extends boolean = false> = PluginLifecycleFragment<
  PluginHook<GroupContext<AttemptPluginContext, Required>>
>;
/** Adds managed actions or callbacks to the owner's Sandbox lifecycle; these run for fresh Attempts and do not create a separate physical Sandbox lifecycle. */
export interface SandboxPluginFragment<Required extends boolean = false> {
  readonly before?: PluginElements<
    | SandboxAction
    | ((sandbox: SandboxCommandTarget, context: GroupContext<SandboxCommandContext, Required>) => void | Promise<void>)
  >;
  readonly after?: PluginElements<
    | SandboxAfterAction
    | ((
        sandbox: SandboxCommandTarget,
        context: GroupContext<Omit<SandboxCommandContext, "onCleanup">, Required>,
      ) => void | Promise<void>)
  >;
}
/** Adds supported Agent skills, servers and native configuration from an Experiment-mounted Plugin; custom Adapters do not accept Agent extensions. */
export interface PluginAgentExtensions {
  readonly skills?: readonly SkillSpec[];
  readonly mcpServers?: readonly McpServer[];
  readonly codex?: Pick<CodexConfig, "plugins" | "configFile" | "before" | "after">;
  readonly claudeCode?: Pick<ClaudeCodeConfig, "plugins" | "settingsFile" | "before" | "after">;
  readonly bub?: Pick<BubConfig, "pythonPlugins" | "before" | "after">;
}
interface PluginFields<Required extends boolean> {
  readonly agent?: PluginAgentExtensions;
  readonly experiment?: ExperimentPluginFragment;
  readonly group?: GroupPluginFragment;
  readonly sandbox?: SandboxPluginFragment<Required>;
  readonly attempt?: AttemptPluginFragment<Required>;
}
type NonEmptyFields<Required extends boolean> = PluginFields<Required> &
  (
    | { readonly agent: PluginAgentExtensions }
    | { readonly experiment: ExperimentPluginFragment }
    | { readonly group: GroupPluginFragment }
    | { readonly sandbox: SandboxPluginFragment<Required> }
    | { readonly attempt: AttemptPluginFragment<Required> }
  );
interface PluginIdentity {
  readonly behaviorRevision?: never;
  readonly instanceKey?: never;
  readonly eval?: never;
  readonly name: string;
  readonly key?: string;
  readonly identity: Readonly<globalThis.Record<string, JsonValue>>;
}
type GroupRequiredPluginDefinition = PluginIdentity & {
  readonly requires: { readonly evalGroup: true };
} & NonEmptyFields<true>;
type OptionalGroupPluginDefinition = PluginIdentity & {
  readonly requires?: { readonly evalGroup?: false };
} & NonEmptyFields<false>;
/** Declares a reusable condition's identity and scoped contributions; bump identity when callback semantics change because callback bodies are not fingerprinted. */
export type PluginDefinition = GroupRequiredPluginDefinition | OptionalGroupPluginDefinition;
type OwnersOf<Definition> = Definition extends { readonly agent: unknown } | { readonly experiment: unknown }
  ? "experiment"
  : Definition extends { readonly group: unknown }
    ? "experiment" | "group"
    : PluginOwner;
interface NormalizedLifecycle<Context> {
  readonly before: readonly PluginHook<Context>[];
  readonly after: readonly PluginHook<Context>[];
}
export interface PluginInstanceData {
  readonly name: string;
  readonly key: string;
  readonly identity: Readonly<globalThis.Record<string, JsonValue>>;
  readonly requires: Readonly<{ evalGroup?: true }>;
  readonly agent?: PluginAgentExtensions;
  readonly experiment?: NormalizedLifecycle<ExperimentHookContext>;
  readonly group?: NormalizedLifecycle<GroupPluginContext>;
  readonly attempt?: NormalizedLifecycle<AttemptPluginContext>;
  readonly sandbox?: SandboxLayer<"command-only">;
  readonly shape: JsonValue;
  readonly agentProjection?: JsonValue;
}
// setup/teardown remain private execution slots shared with the runner.
export interface LinkedPluginLifecycle {
  readonly scope: PluginOwner;
  readonly name: string;
  readonly key: string;
  readonly identity: Readonly<globalThis.Record<string, JsonValue>>;
  readonly requires: PluginInstanceData["requires"];
  readonly shape: JsonValue;
  readonly agentProjection?: JsonValue;
  readonly arrayPosition: number;
  readonly beforeCount: number;
  readonly afterCount: number;
  readonly hasSetup: boolean;
  readonly hasTeardown: boolean;
  readonly hostDeclared: boolean;
  readonly sandboxLayer?: SandboxLayer<"command-only">;
  readonly setup?: PluginHook<any>;
  readonly teardown?: PluginHook<any>;
}
const sandboxPluginSources = new WeakMap<object, string>();
export function pluginSourceOf(declaration: object): string | undefined {
  return sandboxPluginSources.get(declaration);
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
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, normalizeJson(item, `${path}.${key}`, ancestors)]),
      ),
    );
  } finally {
    ancestors.delete(value);
  }
}

function elements<Element>(value: PluginElements<Element> | undefined): readonly Element[] {
  return value === undefined ? [] : Array.isArray(value) ? [...value] : [value as Element];
}
function fragment(value: unknown, path: string): globalThis.Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${path} must be an object with before or after.`);
  for (const key of Object.keys(value)) {
    if (key !== "before" && key !== "after")
      throw new TypeError(`${path}.${key} is not supported; use before or after.`);
  }
  if (value.before === undefined && value.after === undefined)
    throw new TypeError(`${path} must declare before or after.`);
  return value;
}
function normalizeLifecycle<Context>(value: unknown, path: string): NormalizedLifecycle<Context> {
  const spec = fragment(value, path);
  const before = elements(spec.before);
  const after = elements(spec.after);
  for (const hook of [...before, ...after])
    if (typeof hook !== "function") throw new TypeError(`${path} hooks must be functions.`);
  return Object.freeze({
    before: Object.freeze(before) as readonly PluginHook<Context>[],
    after: Object.freeze(after) as readonly PluginHook<Context>[],
  });
}
function createPlugin(spec: unknown): PluginInstance {
  if (!isPlainRecord(spec)) throw new TypeError("definePlugin requires a specification object.");
  for (const field of Object.keys(spec)) {
    if (
      !["name", "key", "identity", "requires", "agent", "experiment", "group", "sandbox", "attempt"].includes(field)
    ) {
      throw new TypeError(
        `definePlugin ${field} is not supported; use name, key, identity and before/after fields (eval is now attempt).`,
      );
    }
  }
  const name = assertNonEmptyString(spec.name, "definePlugin name");
  const key = spec.key === undefined ? "default" : assertNonEmptyString(spec.key, `Plugin ${name} key`);
  const identity = normalizeJson(spec.identity, `Plugin ${name}.identity`);
  if (!isPlainRecord(identity)) throw new TypeError(`Plugin ${name}.identity must be a JSON object.`);
  if (!["agent", "experiment", "group", "sandbox", "attempt"].some((field) => spec[field] !== undefined))
    throw new TypeError(`Plugin ${name} must declare at least one behavior field.`);
  if (
    spec.requires !== undefined &&
    (!isPlainRecord(spec.requires) ||
      Object.keys(spec.requires).some((field) => field !== "evalGroup") ||
      (spec.requires.evalGroup !== undefined && typeof spec.requires.evalGroup !== "boolean"))
  )
    throw new TypeError(`Plugin ${name}.requires accepts only evalGroup: boolean.`);
  const requires = Object.freeze(
    isPlainRecord(spec.requires) && spec.requires.evalGroup === true ? { evalGroup: true as const } : {},
  );
  const experiment =
    spec.experiment === undefined
      ? undefined
      : normalizeLifecycle<ExperimentHookContext>(spec.experiment, `Plugin ${name}.experiment`);
  const group =
    spec.group === undefined ? undefined : normalizeLifecycle<GroupPluginContext>(spec.group, `Plugin ${name}.group`);
  const attempt =
    spec.attempt === undefined
      ? undefined
      : normalizeLifecycle<AttemptPluginContext>(spec.attempt, `Plugin ${name}.attempt`);
  let sandbox: SandboxLayer<"command-only"> | undefined;
  let sandboxShape: JsonValue | undefined;
  if (spec.sandbox !== undefined) {
    if (isSandboxLayer(spec.sandbox))
      throw new TypeError(`Plugin ${name}.sandbox must declare before or after hooks, not a SandboxLayer.`);
    const declaration = fragment(spec.sandbox, `Plugin ${name}.sandbox`);
    const before = elements(declaration.before);
    const after = elements(declaration.after);
    sandbox = sandboxLayer();
    for (const entry of before) sandbox = sandbox.before(entry as SandboxAction | SandboxCommand);
    for (const entry of after) sandbox = sandbox.after(entry as SandboxAfterAction | SandboxCleanupCommand);
    sandboxShape = { before: before.length, after: after.length };
  }
  if (spec.agent !== undefined && !isPlainRecord(spec.agent))
    throw new TypeError(`Plugin ${name}.agent must be an object.`);
  const count = (value: NormalizedLifecycle<any>) => ({ before: value.before.length, after: value.after.length });
  let agentProjection: JsonValue | undefined;
  if (isPlainRecord(spec.agent)) {
    for (const field of Object.keys(spec.agent))
      if (!["skills", "mcpServers", "codex", "claudeCode", "bub"].includes(field))
        throw new TypeError(`Plugin ${name}.agent.${field} is not supported.`);
    const extension = spec.agent as PluginAgentExtensions;
    const digest = (path: string) => registerSandboxContent(pathToFileURL(resolve(path))).digest;
    const targets: globalThis.Record<string, JsonValue> = {};
    for (const kind of ["codex", "claudeCode", "bub"] as const) {
      const target = extension[kind];
      if (target === undefined) continue;
      if (!isPlainRecord(target)) throw new TypeError(`Plugin ${name}.agent.${kind} must be an object.`);
      const allowed =
        kind === "bub"
          ? ["pythonPlugins", "before", "after"]
          : ["plugins", kind === "codex" ? "configFile" : "settingsFile", "before", "after"];
      for (const field of Object.keys(target))
        if (!allowed.includes(field))
          throw new TypeError(
            `Plugin ${name}.agent.${kind}.${field} is not supported; use before or after for lifecycle hooks.`,
          );
      for (const phase of ["before", "after"] as const)
        if (
          target[phase] !== undefined &&
          (!Array.isArray(target[phase]) || target[phase].some((hook: unknown) => typeof hook !== "function"))
        )
          throw new TypeError(`Plugin ${name}.agent.${kind}.${phase} must be an array of commands.`);
      targets[kind] = normalizeJson(
        {
          ...("plugins" in target && target.plugins !== undefined ? { plugins: target.plugins } : {}),
          ...("pythonPlugins" in target && target.pythonPlugins !== undefined
            ? { pythonPlugins: target.pythonPlugins }
            : {}),
          ...("configFile" in target && typeof target.configFile === "string"
            ? { configFile: { path: target.configFile, digest: digest(target.configFile) } }
            : {}),
          ...("settingsFile" in target && typeof target.settingsFile === "string"
            ? { settingsFile: { path: target.settingsFile, digest: digest(target.settingsFile) } }
            : {}),
          before: target.before?.length ?? 0,
          after: target.after?.length ?? 0,
        },
        `Plugin ${name}.agent.${kind}`,
      );
    }
    agentProjection = normalizeJson(
      {
        ...(extension.skills === undefined
          ? {}
          : {
              skills: extension.skills.map((skill) =>
                skill.kind === "local" ? { ...skill, digest: digest(skill.path) } : skill,
              ),
            }),
        ...(extension.mcpServers === undefined
          ? {}
          : {
              mcpServers: extension.mcpServers.map((server) => ({
                name: server.name,
                ...(server.command === undefined ? {} : { command: server.command }),
                ...(server.args === undefined ? {} : { args: server.args }),
                ...(server.url === undefined ? {} : { url: server.url }),
              })),
            }),
        ...targets,
      },
      `Plugin ${name}.agent`,
    );
  }
  const shape = Object.freeze({
    ...(experiment === undefined ? {} : { experiment: count(experiment) }),
    ...(group === undefined ? {} : { group: count(group) }),
    ...(attempt === undefined ? {} : { attempt: count(attempt) }),
    ...(sandboxShape === undefined ? {} : { sandbox: sandboxShape }),
    ...(spec.agent === undefined ? {} : { agent: true }),
  });
  if (sandbox !== undefined) {
    const state = sandboxLayerStateOf(sandbox);
    for (const declaration of [...state.before, ...state.after])
      sandboxPluginSources.set(declaration, `${name}:${key}`);
  }
  const data: PluginInstanceData = Object.freeze({
    name,
    key,
    identity: identity as Readonly<globalThis.Record<string, JsonValue>>,
    requires,
    shape,
    ...(agentProjection === undefined ? {} : { agentProjection }),
    ...(experiment === undefined ? {} : { experiment }),
    ...(group === undefined ? {} : { group }),
    ...(attempt === undefined ? {} : { attempt }),
    ...(sandbox === undefined ? {} : { sandbox }),
    ...(spec.agent === undefined ? {} : { agent: spec.agent as PluginAgentExtensions }),
  });
  const instance = Object.freeze({}) as PluginInstance;
  pluginInstances.set(instance, data);
  return instance;
}
/** Creates a frozen reusable experiment condition or a single-options factory. Declare explicit JSON identity because callback body changes alone do not invalidate reuse. */
export function definePlugin<const Definition extends GroupRequiredPluginDefinition>(
  spec: Definition,
): PluginInstance<OwnersOf<Definition>>;
/** Creates a frozen reusable experiment condition or a single-options factory. Declare explicit JSON identity because callback body changes alone do not invalidate reuse. */
export function definePlugin<const Definition extends OptionalGroupPluginDefinition>(
  spec: Definition,
): PluginInstance<OwnersOf<Definition>>;
/** Creates a frozen reusable experiment condition or a single-options factory. Declare explicit JSON identity because callback body changes alone do not invalidate reuse. */
export function definePlugin<
  Options,
  const Required extends boolean = false,
  const Definition extends PluginIdentity = PluginIdentity,
>(
  factory: (
    options: Options,
  ) => Definition & { readonly requires?: { readonly evalGroup: Required } } & NonEmptyFields<Required>,
): (options: Options) => PluginInstance<OwnersOf<Definition>>;
// @concord-code
// @concord-implements docs/feature/plugins/library.md
/** Creates a frozen reusable experiment condition or a single-options factory. Declare explicit JSON identity because callback body changes alone do not invalidate reuse. */
export function definePlugin(spec: unknown): PluginInstance | ((options: unknown) => PluginInstance) {
  if (typeof spec !== "function") return createPlugin(spec);
  return (...args: readonly unknown[]) => {
    if (args.length !== 1) throw new TypeError("Plugin factory requires exactly one options value.");
    return createPlugin(spec(args[0]));
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
export function assertPluginOwner(plugin: PluginInstance<any>, scope: PluginOwner, label: string): void {
  const data = pluginInstanceDataOf(plugin);
  const forbidden =
    scope === "experiment"
      ? []
      : scope === "group"
        ? (["agent", "experiment"] as const)
        : (["agent", "experiment", "group"] as const);
  for (const field of forbidden)
    if (data[field] !== undefined)
      throw new TypeError(`${label}: Plugin ${data.name} field ${field} is not allowed at ${scope} attachment.`);
}
export function linkPluginLifecycles<Scope extends PluginOwner>(
  plugins: readonly PluginInstance<Scope>[],
  scope: Scope,
  field: "experiment" | "group" | "attempt" = scope === "eval" ? "attempt" : scope,
): readonly LinkedPluginLifecycle[] {
  const seen = new Set<string>();
  return Object.freeze(
    plugins.map((plugin, arrayPosition) => {
      assertPluginOwner(plugin, scope, `${scope}.plugins[${arrayPosition}]`);
      const data = pluginInstanceDataOf(plugin);
      const duplicate = JSON.stringify([data.name, data.key]);
      if (seen.has(duplicate)) throw new TypeError(`Duplicate ${scope} Plugin (${data.name}, ${data.key}).`);
      seen.add(duplicate);
      const lifecycle = data[field];
      return Object.freeze({
        scope,
        name: data.name,
        key: data.key,
        identity: data.identity,
        requires: data.requires,
        shape: data.shape,
        arrayPosition,
        ...(data.agentProjection === undefined ? {} : { agentProjection: data.agentProjection }),
        beforeCount: lifecycle?.before.length ?? 0,
        afterCount: lifecycle?.after.length ?? 0,
        hasSetup: (lifecycle?.before.length ?? 0) > 0,
        hasTeardown: (lifecycle?.after.length ?? 0) > 0,
        hostDeclared: lifecycle !== undefined,
        ...(data.sandbox === undefined ? {} : { sandboxLayer: data.sandbox }),
        ...(lifecycle === undefined
          ? {}
          : {
              setup: async (context: any) => {
                for (const hook of lifecycle.before) await hook(context);
              },
              teardown: async (context: any) => {
                const failures: unknown[] = [];
                for (const hook of [...lifecycle.after].reverse()) {
                  try {
                    await hook(context);
                  } catch (error) {
                    failures.push(error);
                  }
                }
                if (failures.length > 0) throw new AggregateError(failures, `Plugin ${data.name} after failed.`);
              },
            }),
      });
    }),
  );
}
export function pluginLifecycleIdentity({
  scope,
  name,
  key,
  identity,
  requires,
  shape,
  agentProjection,
  arrayPosition,
}: LinkedPluginLifecycle): JsonValue {
  return Object.freeze({
    scope,
    name,
    key,
    identity,
    requires,
    shape,
    arrayPosition,
    ...(agentProjection === undefined ? {} : { agent: agentProjection }),
  });
}
export function pluginLifecycleProjection(lifecycles: readonly LinkedPluginLifecycle[]): JsonValue {
  return Object.freeze(lifecycles.map(pluginLifecycleIdentity)) as JsonValue;
}
