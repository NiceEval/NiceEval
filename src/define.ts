// 定义入口:把用户对象规格化成核心认得的形状。路径即身份 —— 这里禁止手写 id,
// 由发现阶段从文件路径推导(见 runner/discover.ts)。

import type {
  DirectAgent,
  DirectAgentDef,
  Config,
  EvalInput,
  EvalDefinition,
  ExperimentDefinition,
  ExperimentInput,
  SandboxAgent,
  SandboxAgentDef,
  ScoreEvalInput,
  ScoreTestContext,
  TestContext,
  JsonValue,
} from "./types.ts";
import { brandEvalDefinition, brandExperimentDefinition } from "./types.ts";
import { t } from "./i18n/index.ts";
import {
  customProviderSandbox,
  isSandboxLayer,
  type CustomProviderSandboxOptions,
  type SandboxLayer,
} from "./sandbox/layer.ts";
import { Either, Schema } from "effect";
import { assertEvidenceCoverage } from "./assertions/coverage.ts";

// 发现期必须区分 defineScoreEval 的真正产物与运行时手写 `{ evaluationKind: "points" }` 的裸对象。
// WeakSet 是模块私有来源证明；Definition 本身另有 types.ts 的私有 symbol 品牌供类型层使用。
const definedScoreEvals = new WeakSet<object>();

/** @internal 仅供 discoverEvals 验证 points 题型来源。 */
export function isDefinedScoreEval(value: object): boolean {
  return definedScoreEvals.has(value);
}

/** 沙箱型 agent:在沙箱里 spawn 一个 coding agent 的 CLI,跑完读回 transcript。 */
export function defineSandboxAgent(def: SandboxAgentDef): SandboxAgent {
  if (!def.name) throw new Error(t("define.sandboxAgentNameRequired"));
  assertEvidenceCoverage(def.evidenceCoverage, "defineSandboxAgent");
  if (def.ensure === undefined) throw new Error(t("define.sandboxAgentEnsureRequired"));
  const ensure = Array.isArray(def.ensure) ? def.ensure : [def.ensure];
  if (ensure.length === 0) throw new Error(t("define.sandboxAgentEnsureRequired"));
  return {
    name: def.name,
    kind: "sandbox",
    evidenceCoverage: def.evidenceCoverage,
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

/** Direct Agent:在 send 里直接驱动函数、SDK 或服务端点。 */
export function defineAgent(def: DirectAgentDef): DirectAgent {
  if (!def.name) throw new Error(t("define.agentNameRequired"));
  assertEvidenceCoverage(def.evidenceCoverage, "defineAgent");
  return {
    name: def.name,
    kind: "direct",
    evidenceCoverage: def.evidenceCoverage,
    setup: def.setup,
    tracing: def.tracing,
    spanMapper: def.spanMapper,
    send: def.send,
    classifySendFailure: def.classifySendFailure,
    teardown: def.teardown,
  };
}

/** @deprecated Use {@link defineAgent}. */
export const defineDirectAgent = defineAgent;

/** 会话型 eval(通过制:一个 eval 折叠成一分)。禁止提供 id —— 从路径推导。 */
export function defineEval(def: EvalInput): EvalDefinition<"pass", TestContext> {
  if (Object.hasOwn(def, "id")) {
    throw new Error(t("define.evalIdRejected"));
  }
  if (Object.hasOwn(def, "evaluationKind")) {
    throw new Error(t("define.evalEvaluationKindRejected"));
  }
  if (Object.hasOwn(def, "configHash")) {
    throw new Error(t("define.evalConfigHashRejected"));
  }
  if (typeof def.test !== "function") {
    throw new Error(t("define.evalTestRequired"));
  }
  assertSandboxLayer(def.sandbox, "defineEval");
  return brandEvalDefinition({ ...normalizeEvalFields(def), evaluationKind: "pass", test: def.test });
}

/**
 * 计分制 eval:题内用给分词汇(`.points(n)` / `t.score(label, n)`)叠加挣分,对比读总分而不是
 * 通过率。字段与 `defineEval` 完全同形,唯一区别是 `test(t)` 的 `t` 额外提供给分词汇——禁止
 * 提供 id,从路径推导(见 docs/feature/eval/README.md「defineScoreEval:计分制题型」)。
 */
export function defineScoreEval(
  def: ScoreEvalInput,
): EvalDefinition<"points", ScoreTestContext> {
  if (Object.hasOwn(def, "id")) {
    throw new Error(t("define.scoreEvalIdRejected"));
  }
  if (Object.hasOwn(def, "evaluationKind")) {
    throw new Error(t("define.scoreEvalEvaluationKindRejected"));
  }
  if (Object.hasOwn(def, "configHash")) {
    throw new Error(t("define.scoreEvalConfigHashRejected"));
  }
  if (typeof def.test !== "function") {
    throw new Error(t("define.scoreEvalTestRequired"));
  }
  assertSandboxLayer(def.sandbox, "defineScoreEval");
  const result = brandEvalDefinition({ ...normalizeEvalFields(def), evaluationKind: "points", test: def.test });
  definedScoreEvals.add(result);
  return result;
}

/** 实验:可签入的运行配置(怎么跑这批 eval)。 */
export function defineExperiment(def: ExperimentInput): ExperimentDefinition {
  if (Object.hasOwn(def, "id")) {
    throw new Error(t("define.experimentIdRejected"));
  }
  if (!def.agent) throw new Error(t("define.experimentAgentRequired"));
  assertSandboxLayer(def.sandbox, "defineExperiment");
  // setup 是实验级生命周期钩子(整场一次,宿主机侧,见 runner/types.ts 的 ExperimentDef.setup);
  // 传成非函数(如误把 sandbox 钩子对象塞进来)在解析时就报,不等到调度才炸。
  if (def.setup !== undefined && typeof def.setup !== "function") {
    throw new Error(t("define.experimentSetupNotFunction"));
  }
  // classifyFailure 是失败分类链上的实验通道(见 runner/types.ts 的 ExperimentDef.classifyFailure):
  // 传成非函数在解析时就报,不等到某条 attempt 撞死才发现这一路声明白写。
  if (def.classifyFailure !== undefined && typeof def.classifyFailure !== "function") {
    throw new Error(t("define.experimentClassifyFailureNotFunction"));
  }
  // labels 是报告归类坐标(进 ExperimentRunInfo.labels,不透传 ctx/t):值域 string | number,
  // 解析时即校验,布尔 / 对象 / NaN 直接报错,不等到落盘或报告分组才炸。
  if (def.labels !== undefined) {
    for (const [key, value] of Object.entries(def.labels)) {
      const ok = typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
      if (!ok) throw new Error(t("define.experimentLabelInvalid", { key }));
    }
  }
  const { id: _derivedId, ...author } = def;
  return brandExperimentDefinition({
    ...author,
    flags: decodeJsonRecord(def.flags ?? {}, "defineExperiment flags"),
    labels: Object.freeze({ ...(def.labels ?? {}) }),
    attempts: def.attempts ?? 1,
    earlyExit: def.earlyExit ?? false,
    evals: Array.isArray(def.evals) ? Object.freeze([...def.evals]) : (def.evals ?? "*"),
    sandboxReuse: def.sandboxReuse === true,
  });
}

function normalizeEvalFields(def: EvalInput | ScoreEvalInput) {
  return {
    ...(def.description !== undefined ? { description: def.description } : {}),
    tags: Object.freeze([...(def.tags ?? [])]),
    ...(def.sandbox !== undefined ? { sandbox: def.sandbox } : {}),
    ...(def.judge !== undefined ? { judge: def.judge } : {}),
    reporters: Object.freeze([...(def.reporters ?? [])]),
    ...(def.timeoutMs !== undefined ? { timeoutMs: def.timeoutMs } : {}),
    metadata: decodeJsonRecord(def.metadata ?? {}, "Eval metadata"),
    diff: Object.freeze({
      include: Object.freeze([...(def.diff?.include ?? [])]),
      ignore: Object.freeze([...(def.diff?.ignore ?? [])]),
    }),
  };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
}

const JsonValueSchema = Schema.declare<JsonValue>(isJsonValue);
const JsonRecordSchema = Schema.Record({ key: Schema.String, value: JsonValueSchema });

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
  value: Readonly<globalThis.Record<string, JsonValue>>,
  label: string,
): Readonly<globalThis.Record<string, JsonValue>> {
  const decoded = Schema.decodeUnknownEither(JsonRecordSchema, { errors: "all" })(value);
  if (Either.isLeft(decoded)) throw new TypeError(`${label} must be JSON-compatible: ${String(decoded.left)}`);
  return Object.freeze(Object.fromEntries(
    Object.entries(decoded.right).map(([key, child]) => [key, deepFreezeJson(child)]),
  ));
}

/**
 * `SandboxLayer` 的品牌只由 `niceeval/sandbox` 工厂写入。动态 TSX/JS 调用绕过静态类型时，
 * 不接受看似相同的裸对象，以免在 linker 阶段才得到难以定位的错误。
 */
function assertSandboxLayer(value: unknown, factory: string): void {
  if (value !== undefined && !isSandboxLayer(value)) {
    throw new TypeError(
      `${factory} sandbox must be a SandboxLayer created by a niceeval/sandbox factory (for example dockerImage(), dockerCompose(), e2bTemplate(), or localSandbox()).`,
    );
  }
}

/** 项目级配置。 */
export function defineConfig(config: Config): Config {
  return config;
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
