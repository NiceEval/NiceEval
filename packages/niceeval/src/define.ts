import type { Adapter } from "./adapter.ts";
import { parseAdapterFlags } from "./adapter-flags.ts";
import { decodeExperimentFlags } from "./experiment/flags.ts";
// 定义入口:把用户对象规格化成核心认得的形状。路径即身份 —— 这里禁止手写 id,
// 由发现阶段从文件路径推导(见 runner/discover.ts)。

import type {
  DirectAgent,
  DirectAgentDef,
  Config,
  EvalInput,
  EvalGroupDefinition,
  EvalGroupInput,
  EvalDefinition,
  EvalDefinitionFields,
  ExperimentDefinition,
  ExperimentInput,
  SharedStateConfig,
  SandboxCacheConfig,
  SandboxAgent,
  SandboxAgentDef,
  ScoreEvalInput,
  ScoreTestContext,
  TestContext,
  JsonValue,
} from "./types.ts";
import { normalizeJudgeSelection } from "./runner/judge-config.ts";
import { isJudgeProvider } from "./judge/provider.ts";
import { MigrationRequiredError, captureMigrationSource } from "./error-assistance/index.ts";

import {
  brandEvalDefinition,
  brandEvalGroupDefinition,
  brandExperimentDefinition,
  isEvalDefinition,
} from "./types.ts";
import {
  customProviderSandbox,
  isSandboxLayer,
  sandboxLayerStateOf,
  type CustomProviderSandboxOptions,
  type SandboxLayer,
} from "./sandbox/layer.ts";
import { Result, Schema } from "effect";
import { assertEvidenceCoverage } from "./assertions/coverage.ts";
import {
  effectAgentCallback,
  registerAgentEffectRuntime,
  type InternalDirectAgentDefinition,
  type InternalSandboxAgentDefinition,
} from "./agents/effect-runtime.ts";
import { isPluginInstance, pluginInstanceDataOf, type PluginInstance, type PluginOwner } from "./plugin/contracts.ts";

/** Recognize only the retired flat configuration, without evaluating getters. */
function normalizeDefinitionJudge(value: unknown, label: string) {
  if (!isJudgeProvider(value) && typeof value === "object" && value !== null && !Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    const legacyKeys = ["model", "baseUrl", "apiKeyEnv", "timeoutMs", "maxOutputTokens"];
    if ((prototype === Object.prototype || prototype === null) && Reflect.ownKeys(value).every((key) => {
      const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
      return typeof key === "string" && legacyKeys.includes(key) && descriptor !== undefined && "value" in descriptor;
    })) {
      throw new MigrationRequiredError({ occurrences: [{
        guideId: "judge-provider",
        subject: label.replace("() ", "."),
        source: captureMigrationSource(),
      }] });
    }
  }
  return normalizeJudgeSelection(value, label);
}
// 发现期必须区分 defineScoreEval 的真正产物与运行时手写 `{ evaluationKind: "score" }` 的裸对象。
// WeakSet 是模块私有来源证明；Definition 本身另有 types.ts 的私有 symbol 品牌供类型层使用。
const definedScoreEvals = new WeakSet<object>();

/** Define a closed set of real Eval definitions sharing one physical Sandbox. */
export function defineEvalGroup<const Sandbox extends SandboxLayer | undefined>(
  input: EvalGroupInput<Sandbox>,
): EvalGroupDefinition {
  if (!Array.isArray(input.evals) || input.evals.length === 0) {
    throw new TypeError("defineEvalGroup evals must be a non-empty array of defineEval()/defineScoreEval() definitions.");
  }
  input.evals.forEach((member, index) => {
    if (!isEvalDefinition(member)) {
      throw new TypeError(
        `defineEvalGroup evals[${index}] must be the object returned by defineEval() or defineScoreEval().`,
      );
    }
  });
  assertSandboxLayer(input.sandbox, "defineEvalGroup");
  if (input.onUnavailable !== "stop-group" && input.onUnavailable !== "replace-sandbox") {
    throw new TypeError("defineEvalGroup onUnavailable must be \"stop-group\" or \"replace-sandbox\".");
  }
  const [first, ...rest] = input.evals;
  return brandEvalGroupDefinition({
    evals: Object.freeze([first, ...rest]),
    onUnavailable: input.onUnavailable,
    ...(input.sandbox ? { sandbox: input.sandbox } : {}),
    ...(input.plugins === undefined ? {} : { plugins: normalizePlugins(input.plugins, "defineEvalGroup plugins", "group") }),
  });
}

/** @internal 仅供 discoverEvals 验证 score 题型来源。 */
export function isDefinedScoreEval(value: object): boolean {
  return definedScoreEvals.has(value);
}

/** 沙箱型 agent:在沙箱里 spawn 一个 coding agent 的 CLI,跑完读回 transcript。 */
export function defineSandboxAgent(def: SandboxAgentDef): SandboxAgent {
  if (!def.name) throw new Error(`defineSandboxAgent requires name.`);
  assertEvidenceCoverage(def.evidenceCoverage, "defineSandboxAgent");
  if (def.ensure === undefined) throw new Error(`defineSandboxAgent requires an ensure declaration.`);
  const ensure = Array.isArray(def.ensure) ? def.ensure : [def.ensure];
  if (ensure.length === 0) throw new Error(`defineSandboxAgent requires an ensure declaration.`);
  if (def.sandbox !== undefined) {
    if (!isSandboxLayer(def.sandbox)) {
      throw new TypeError(
        "defineSandboxAgent sandbox must be a SandboxLayer created by sandboxLayer().",
      );
    }
    if (sandboxLayerStateOf(def.sandbox).kind !== "command-only") {
      throw new TypeError(
        "defineSandboxAgent sandbox must be command-only; an Agent cannot provide a Sandbox template.",
      );
    }
  }
  return {
    name: def.name,
    kind: "sandbox",
    defineEval,
    defineScoreEval,
    evidenceCoverage: def.evidenceCoverage,
    ...(def.sandbox === undefined ? {} : { sandbox: def.sandbox }),
    ensure,
    installers: def.installers ?? [],
    setup: def.setup,
    tracing: def.tracing,
    spanMapper: def.spanMapper,
    send: def.send,
    classifySendFailure: def.classifySendFailure,
    teardown: def.teardown,
  };
}

/** @internal Creates a Promise facade while retaining a built-in Effect runtime. */
export function makeSandboxAgent(
  def: Omit<SandboxAgentDef, "send" | "setup" | "teardown"> & InternalSandboxAgentDefinition,
): SandboxAgent {
  const { send, setup, teardown, ...publicDefinition } = def;
  const agent = defineSandboxAgent({
    ...publicDefinition,
    send: effectAgentCallback(send, (_input, context) => context.signal),
    ...(setup === undefined ? {} : {
      setup: effectAgentCallback(setup, (_sandbox, context) => context.signal),
    }),
    ...(teardown === undefined ? {} : {
      teardown: effectAgentCallback(teardown, (_sandbox, context) => context.signal),
    }),
  });
  return registerAgentEffectRuntime(agent, {
    send: send as InternalDirectAgentDefinition["send"],
    sandboxSetup: setup,
    sandboxTeardown: teardown,
  });
}

/** Direct Agent:在 send 里直接驱动函数、SDK 或服务端点。 */
export function defineAgent(def: DirectAgentDef): DirectAgent {
  if (!def.name) throw new Error(`defineAgent requires name.`);
  assertEvidenceCoverage(def.evidenceCoverage, "defineAgent");
  return {
    name: def.name,
    kind: "direct",
    defineEval,
    defineScoreEval,
    evidenceCoverage: def.evidenceCoverage,
    setup: def.setup,
    tracing: def.tracing,
    spanMapper: def.spanMapper,
    send: def.send,
    classifySendFailure: def.classifySendFailure,
    teardown: def.teardown,
  };
}

/** @internal Creates a Promise facade while retaining a built-in Effect runtime. */
export function makeDirectAgent(
  def: Omit<DirectAgentDef, "send" | "setup" | "teardown"> & InternalDirectAgentDefinition,
): DirectAgent {
  const { send, setup, teardown, ...publicDefinition } = def;
  const agent = defineAgent({
    ...publicDefinition,
    send: effectAgentCallback(send, (_input, context) => context.signal),
    ...(setup === undefined ? {} : {
      setup: effectAgentCallback(setup, (context) => context.signal),
    }),
    ...(teardown === undefined ? {} : {
      teardown: effectAgentCallback(teardown, (context) => context.signal),
    }),
  });
  return registerAgentEffectRuntime(agent, {
    send,
    directSetup: setup,
    directTeardown: teardown,
  });
}

/** 会话型 eval(通过制:一个 eval 折叠成一分)。禁止提供 id —— 从路径推导。 */
export function defineEval<
  const Sandbox extends SandboxLayer | undefined = undefined,
>(def: EvalInput<Sandbox>): EvalDefinition<"pass", TestContext, Sandbox> {
  return defineEvalForContext("pass", def);
}

/**
 * 计分制 eval:Fact verdict uses 与 Fact score uses 可以读取同一份证据；正常返回由 Runner
 * 自动关闭计分收集器。字段与 `defineEval` 同形，禁止提供 id，由发现期推导。
 */
export function defineScoreEval<
  const Sandbox extends SandboxLayer | undefined = undefined,
>(
  def: ScoreEvalInput<Sandbox>,
): EvalDefinition<"score", ScoreTestContext, Sandbox> {
  return defineEvalForContext("score", def);
}

type EvalFactoryInput<Sandbox extends SandboxLayer | undefined> =
  Omit<EvalInput<Sandbox> | ScoreEvalInput<Sandbox>, "test"> & {
    readonly test: (...args: never[]) => ReturnType<EvalDefinition<"pass", unknown, Sandbox>["test"]>;
  };

/** @internal Shared normalization and provenance path for root and Adapter-bound Eval factories. */
export function defineEvalForContext<
  Kind extends "pass" | "score",
  Context,
  const Sandbox extends SandboxLayer | undefined = undefined,
>(
  kind: Kind,
  def: EvalFactoryInput<Sandbox>,
  internalFields: Readonly<Record<PropertyKey, unknown>> = {},
): EvalDefinition<Kind, Context, Sandbox> {
  const factory = kind === "pass" ? "defineEval" : "defineScoreEval";
  if (Object.hasOwn(def, "id")) {
    throw new Error(`${factory} does not accept id; ids are derived from file paths.`);
  }
  if (Object.hasOwn(def, "evaluationKind")) {
    throw new Error(
      `${factory} does not accept evaluationKind; it is always set to ${JSON.stringify(kind)}.`,
    );
  }
  if (Object.hasOwn(def, "configHash")) {
    throw new Error(`${factory} does not accept configHash; configHash is computed during run planning.`);
  }
  if (typeof def.test !== "function") {
    throw new Error(`${factory} requires an async test(t) function.`);
  }
  assertSandboxLayer(def.sandbox, factory);
  const result = brandEvalDefinition({
    ...normalizeEvalFields(def),
    ...internalFields,
    evaluationKind: kind,
    test: def.test,
  });
  if (kind === "score") definedScoreEvals.add(result);
  return result as EvalDefinition<Kind, Context, Sandbox>;
}

/** 实验:可签入的运行配置(怎么跑这批 eval)。 */
export function defineExperiment<const A extends Adapter>(def: ExperimentInput<A>): ExperimentDefinition<A>;
export function defineExperiment(def: Omit<ExperimentInput, "flags"> & { readonly flags?: unknown }): ExperimentDefinition {
  if (Object.hasOwn(def, "id")) {
    throw new Error(`defineExperiment does not accept id; ids are derived from file paths.`);
  }
  if ((def.agent === undefined) === (def.adapter === undefined)) {
    throw new Error(`defineExperiment requires exactly one of agent or adapter.`);
  }
  const adapter = def.adapter ?? def.agent!;
  const judgeRuntime = def.judgeRuntime === undefined
    ? undefined
    : normalizeDefinitionJudge(def.judgeRuntime, "defineExperiment() judgeRuntime");
  assertSandboxLayer(def.sandbox, "defineExperiment");
  if (adapter.kind === "custom") {
    if (def.sandbox !== undefined || def.sandboxReuse === true || def.sandboxCache !== undefined) {
      throw new Error(`Custom Adapter experiments do not support sandbox, sandboxReuse, or sandboxCache.`);
    }
    if (def.budget !== undefined) {
      throw new Error(`Custom Adapter experiments do not support budget because Adapter usage is not collected.`);
    }
  }
  // setup 是实验级生命周期钩子(整场一次,宿主机侧,见 runner/types.ts 的 ExperimentDef.setup);
  // 传成非函数(如误把 sandbox 钩子对象塞进来)在解析时就报,不等到调度才炸。
  if (def.setup !== undefined && typeof def.setup !== "function") {
    throw new Error(`experiment.setup must be a function ((ctx) => void); use experiment.teardown for cleanup; to prepare the in-sandbox environment per experiment, chain .setup() hooks on the sandbox spec instead.`);
  }
  // teardown 与 setup 是同一个 Experiment lifecycle 边界。非函数值绝不能
  // 伪装成已声明的 cleanup，否则 explicit sharedState recovery 可能在没有
  // 执行补偿的情况下释放 immutable owner generation。
  if (def.teardown !== undefined && typeof def.teardown !== "function") {
    throw new Error(`Experiment teardown must be a function ((ctx) => void); use a function-valued paired lifecycle hook so normal cleanup and explicit sharedState recovery can both execute it.`);
  }
  // classifyFailure 是失败分类链上的实验通道(见 runner/types.ts 的 ExperimentDef.classifyFailure):
  // 传成非函数在解析时就报,不等到某条 attempt 撞死才发现这一路声明白写。
  if (def.classifyFailure !== undefined && typeof def.classifyFailure !== "function") {
    throw new Error(`experiment.classifyFailure must be a function ((failure) => FailureClass | undefined); it classifies failures that surface as third-party errors and must return undefined for anything it does not recognize.`);
  }
  // labels 是报告归类坐标(进 ExperimentRunInfo.labels,不透传 ctx/t):值域 string | number,
  // 解析时即校验,布尔 / 对象 / NaN 直接报错,不等到落盘或报告分组才炸。
  if (def.labels !== undefined) {
    for (const [key, value] of Object.entries(def.labels)) {
      const ok = typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
      if (!ok) throw new Error(`experiment.labels.${key} must be a string or a finite number; labels are report-side grouping coordinates persisted verbatim into result runs.`);
    }
  }
  const sharedState = normalizeSharedState(def.sharedState);
  const sandboxCache = normalizeSandboxCache(def.sandboxCache, "defineExperiment");
  const {
    id: _derivedId,
    agent: _agent,
    adapter: _adapter,
    sharedState: _sharedState,
    sandboxCache: _sandboxCache,
    ...author
  } = def;
  const flags = decodeExperimentFlags(def.flags === undefined ? {} : def.flags);
  return brandExperimentDefinition({
    ...author,
    adapter,
    ...(adapter.kind === "custom" ? {} : { agent: adapter }),
    flags: adapter.kind === "custom" && adapter.parseFlags !== undefined
      ? parseAdapterFlags(adapter.parseFlags, flags)
      : flags,
    labels: Object.freeze({ ...(def.labels ?? {}) }),
    attempts: def.attempts ?? 1,
    earlyExit: def.earlyExit ?? false,
    evals: Array.isArray(def.evals) ? Object.freeze([...def.evals]) : (def.evals ?? "*"),
    sandboxReuse: def.sandboxReuse === true,
    ...(judgeRuntime === undefined ? {} : { judgeRuntime }),
    ...(sharedState === undefined ? {} : { sharedState }),
    ...(sandboxCache === undefined ? {} : { sandboxCache }),
    plugins: normalizePlugins(def.plugins ?? [], "defineExperiment plugins", "experiment"),
  });
}

function normalizeSandboxCache(
  value: unknown,
  factory: "defineConfig" | "defineExperiment",
): SandboxCacheConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${factory} sandboxCache must be an object with optional setup "use" or "bypass".`);
  }
  const keys = Object.keys(value);
  const setup = Reflect.get(value, "setup");
  if (
    keys.some((key) => key !== "setup") ||
    (setup !== undefined && setup !== "use" && setup !== "bypass")
  ) {
    throw new TypeError(`${factory} sandboxCache must be an object with optional setup "use" or "bypass".`);
  }
  return Object.freeze(setup === undefined ? {} : { setup });
}

const SharedStateKeyPattern = /^[a-z0-9][a-z0-9._/-]{0,127}$/u;

function normalizeSharedState(value: unknown): SharedStateConfig | undefined {
  if (value === undefined) return undefined;
  const candidate = value as { key?: unknown };
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, "key") ||
    Object.keys(value).length !== 1 ||
    typeof candidate.key !== "string" ||
    !SharedStateKeyPattern.test(candidate.key)
  ) {
    throw new TypeError(`experiment.sharedState must be exactly { key }, where key is a stable, non-secret string matching [a-z0-9][a-z0-9._/-]{0,127}.`);
  }
  return Object.freeze({ key: candidate.key });
}

function normalizeEvalFields<
  const Sandbox extends SandboxLayer | undefined,
>(def: EvalInput<Sandbox> | ScoreEvalInput<Sandbox>): EvalDefinitionFields<Sandbox> {
  const judge = def.judge === undefined
    ? undefined
    : normalizeDefinitionJudge(def.judge, "defineEval() judge");
  return {
    ...(def.description !== undefined ? { description: def.description } : {}),
    tags: Object.freeze([...(def.tags ?? [])]),
    ...(def.sandbox !== undefined ? { sandbox: def.sandbox } : {}),
    plugins: normalizePlugins(def.plugins ?? [], "defineEval plugins", "eval"),
    ...(judge !== undefined ? { judge } : {}),
    reporters: Object.freeze([...(def.reporters ?? [])]),
    ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
    metadata: decodeJsonRecord(def.metadata ?? {}, "Eval metadata"),
    diff: Object.freeze({
      include: Object.freeze([...(def.diff?.include ?? [])]),
      ignore: Object.freeze([...(def.diff?.ignore ?? [])]),
    }),
  };
}

function normalizePlugins<Owner extends PluginOwner>(
  value: readonly PluginInstance<Owner>[],
  label: string,
  owner: Owner,
): readonly PluginInstance<Owner>[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  return Object.freeze(value.map((plugin, index) => {
    if (!isPluginInstance(plugin)) throw new TypeError(`${label}[${index}] must be created by definePlugin().`);
    if (pluginInstanceDataOf(plugin)[owner] === undefined) {
      throw new TypeError(`${label}[${index}] does not support ${owner} attachment.`);
    }
    return plugin;
  }));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

const JsonValueSchema = Schema.declare<JsonValue>(isJsonValue);
const JsonRecordSchema = Schema.Record(Schema.String, JsonValueSchema);

function deepFreezeJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const items: JsonValue[] = value.map(deepFreezeJson);
    Object.freeze(items);
    return items;
  }
  if (value !== null && typeof value === "object") {
    const record: globalThis.Record<string, JsonValue> = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, deepFreezeJson(child)]),
    );
    Object.freeze(record);
    return record;
  }
  return value;
}

function decodeJsonRecord(
  value: unknown,
  label: string,
): Readonly<globalThis.Record<string, JsonValue>> {
  const decoded = Schema.decodeUnknownResult(JsonRecordSchema, { errors: "all" })(value);
  if (Result.isFailure(decoded)) throw new TypeError(`${label} must be JSON-compatible: ${String(decoded.failure)}`);
  return Object.freeze(Object.fromEntries(
    Object.entries(decoded.success).map(([key, child]) => [key, deepFreezeJson(child)]),
  ));
}

/**
 * `SandboxLayer` 的品牌只由 `niceeval/sandbox` 工厂写入。动态 TSX/JS 调用绕过静态类型时，
 * 不接受看似相同的裸对象，以免在 linker 阶段才得到难以定位的错误。
 */
function assertSandboxLayer(value: unknown, factory: string): void {
  if (value !== undefined && !isSandboxLayer(value)) {
    throw new TypeError(
      `${factory} sandbox must be a SandboxLayer created by a niceeval/sandbox factory (for example dockerSandbox(), dockerComposeSandbox(), e2bSandbox(), or vercelSandbox()).`,
    );
  }
}

/** 项目级配置。 */
export function defineConfig(config: Config): Config {
  const sandboxCache = normalizeSandboxCache(config.sandboxCache, "defineConfig");
  const judgeRuntime = config.judgeRuntime === undefined
    ? undefined
    : normalizeDefinitionJudge(config.judgeRuntime, "defineConfig() judgeRuntime");
  if (judgeRuntime !== undefined && !isJudgeProvider(judgeRuntime)) {
    throw new TypeError("defineConfig() judgeRuntime must be a Judge Provider created by niceeval/judge");
  }
  return Object.freeze({
    ...config,
    ...(sandboxCache === undefined ? {} : { sandboxCache }),
    ...(judgeRuntime === undefined ? {} : { judgeRuntime }),
  });
}

/**
 * 自定义沙箱 provider:`create` 直接返回一个实现 `Sandbox` 接口的实例,不需要 niceeval 内置支持
 * 这个 provider 名字。用于接入 docker/vercel/e2b 之外的运行环境(自建 VM、Modal、Fly 等)。
 */
export function defineSandbox(
  def: CustomProviderSandboxOptions,
): SandboxLayer<"template-bearing"> {
  return customProviderSandbox(def);
}
