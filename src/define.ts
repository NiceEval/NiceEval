// 定义入口:把用户对象规格化成核心认得的形状。路径即身份 —— 这里禁止手写 id,
// 由发现阶段从文件路径推导(见 runner/discover.ts)。

import type {
  Agent,
  Config,
  CustomSandboxSpec,
  DockerSandboxSpec,
  E2BSandboxSpec,
  EvalDef,
  ExperimentDef,
  LocalSandboxSpec,
  RemoteAgentDef,
  SandboxAgentDef,
  SandboxHook,
  SandboxHooks,
  ScoreEvalDef,
  VercelSandboxSpec,
} from "./types.ts";
import { t } from "./i18n/index.ts";

// 发现期必须区分 defineScoreEval 的真正产物与运行时手写 `{ scoring: "points" }` 的裸对象。
// WeakSet 是模块私有来源证明，不污染 EvalDef 的公开结构，也不能被用户对象伪造。
const definedScoreEvals = new WeakSet<EvalDef>();

/** @internal 仅供 discoverEvals 验证 points 题型来源。 */
export function isDefinedScoreEval(value: EvalDef): boolean {
  return definedScoreEvals.has(value);
}

/** 沙箱型 agent:在沙箱里 spawn 一个 coding agent 的 CLI,跑完读回 transcript。 */
export function defineSandboxAgent(def: SandboxAgentDef): Agent {
  if (!def.name) throw new Error(t("define.sandboxAgentNameRequired"));
  return {
    name: def.name,
    kind: "sandbox",
    coverage: def.coverage,
    setup: def.setup,
    tracing: def.tracing,
    spanMapper: def.spanMapper,
    send: def.send,
    classifyTurnError: def.classifyTurnError,
    teardown: def.teardown,
  };
}

/** 远程 / 进程内 agent:在 send 里直接驱动你的函数 / 服务。 */
export function defineAgent(def: RemoteAgentDef): Agent {
  if (!def.name) throw new Error(t("define.agentNameRequired"));
  return {
    name: def.name,
    kind: "remote",
    coverage: def.coverage,
    setup: def.setup,
    tracing: def.tracing,
    spanMapper: def.spanMapper,
    send: def.send,
    classifyTurnError: def.classifyTurnError,
    teardown: def.teardown,
  };
}

/** 会话型 eval(通过制:一个 eval 折叠成一分)。禁止提供 id —— 从路径推导。 */
export function defineEval(def: EvalDef): EvalDef {
  if ((def as { id?: unknown }).id !== undefined) {
    throw new Error(t("define.evalIdRejected"));
  }
  if ((def as { scoring?: unknown }).scoring !== undefined) {
    throw new Error(t("define.evalScoringRejected"));
  }
  if (typeof def.test !== "function") {
    throw new Error(t("define.evalTestRequired"));
  }
  if (def.environment !== undefined && def.environment.trim().length === 0) {
    throw new Error(t("define.evalEnvironmentEmpty"));
  }
  return { ...def, scoring: "pass" };
}

/**
 * 计分制 eval:题内用给分词汇(`.points(n)` / `t.score(label, n)`)叠加挣分,对比读总分而不是
 * 通过率。字段与 `defineEval` 完全同形,唯一区别是 `test(t)` 的 `t` 额外提供给分词汇——禁止
 * 提供 id,从路径推导(见 docs/feature/eval/README.md「defineScoreEval:计分制题型」)。
 */
export function defineScoreEval(def: ScoreEvalDef): EvalDef {
  if ((def as { id?: unknown }).id !== undefined) {
    throw new Error(t("define.scoreEvalIdRejected"));
  }
  if ((def as { scoring?: unknown }).scoring !== undefined) {
    throw new Error(t("define.scoreEvalScoringRejected"));
  }
  if (typeof def.test !== "function") {
    throw new Error(t("define.scoreEvalTestRequired"));
  }
  if (def.environment !== undefined && def.environment.trim().length === 0) {
    throw new Error(t("define.scoreEvalEnvironmentEmpty"));
  }
  // 两种题型的 `t` 是两套类型(计分制多 `.points`/`t.score`、少 `.atLeast`/`require`),
  // 互相不可赋值——这正是类型分离要的效果。运行时 `t` 是同一个对象,题型差异由 collector
  // 按 `scoring` 处理,所以这里显式收窄成 `EvalDef` 的 `test`。
  const result: EvalDef = { ...def, scoring: "points", test: def.test as unknown as EvalDef["test"] };
  definedScoreEvals.add(result);
  return result;
}

/** 实验:可签入的运行配置(怎么跑这批 eval)。 */
export function defineExperiment(def: ExperimentDef): ExperimentDef {
  if ((def as { id?: unknown }).id !== undefined) {
    throw new Error(t("define.experimentIdRejected"));
  }
  if (!def.agent) throw new Error(t("define.experimentAgentRequired"));
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
  // flags 必须可 JSON 序列化(进结果快照的 ExperimentRunInfo.flags):解析时即校验,
  // 非 JSON 值(函数 / undefined / 循环引用 / bigint)直接报错,不等到落盘才炸。
  if (def.flags !== undefined) {
    for (const [key, value] of Object.entries(def.flags)) {
      if (!isJsonValue(value)) {
        throw new Error(t("define.experimentFlagNotJson", { key }));
      }
    }
  }
  // labels 是报告归类坐标(进 ExperimentRunInfo.labels,不透传 ctx/t):值域 string | number,
  // 解析时即校验,布尔 / 对象 / NaN 直接报错,不等到落盘或报告分组才炸。
  if (def.labels !== undefined) {
    for (const [key, value] of Object.entries(def.labels)) {
      const ok = typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
      if (!ok) throw new Error(t("define.experimentLabelInvalid", { key }));
    }
  }
  return def;
}

function isJsonValue(v: unknown): boolean {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(isJsonValue);
  if (typeof v === "object") return Object.values(v as Record<string, unknown>).every(isJsonValue);
  return false;
}

/** 项目级配置。 */
export function defineConfig(config: Config): Config {
  return config;
}

// ───────────────────────── Sandbox 工厂 ─────────────────────────
// Sandbox 与 agent 一样用数据结构带参数(见 docs/feature/sandbox/library.md)。这些工厂只是把
// provider + 参数包成 spec 对象;真正的行为在 sandbox/<provider>.ts 里,由 resolve.ts 派发。
//
// 四个工厂都要挂上 `.setup()` / `.teardown()` 链式方法(见 sandbox/types.ts 的
// SandboxHooks<Self>):累积的钩子数组随 `HookState` 传递,每次链式调用都重新调
// `build()` 产出一个新对象,原 spec 不被修改。

/** 链式追加中累积的钩子(setup 按追加顺序执行,teardown 执行时逆序,见 SandboxHooks)。 */
interface HookState {
  readonly setupHooks: readonly SandboxHook[];
  readonly teardownHooks: readonly SandboxHook[];
}

/** 四个工厂共用:把当前钩子状态包成 `.setup()` / `.teardown()` 方法,调用即用新状态重新 build。 */
function hookMethods<TSpec>(
  state: HookState,
  rebuild: (state: HookState) => TSpec,
): Pick<SandboxHooks<TSpec>, "setup" | "teardown"> {
  return {
    setup: (fn) => rebuild({ setupHooks: [...state.setupHooks, fn], teardownHooks: state.teardownHooks }),
    teardown: (fn) => rebuild({ setupHooks: state.setupHooks, teardownHooks: [...state.teardownHooks, fn] }),
  };
}

const EMPTY_HOOKS: HookState = { setupHooks: [], teardownHooks: [] };

/** Docker 沙箱:本地容器。`image` 可覆盖默认 `node:*-slim`(预制模板:烘焙好 agent CLI 的镜像)。 */
export function dockerSandbox(
  opts: Omit<DockerSandboxSpec, "provider" | keyof SandboxHooks<unknown>> = {},
): DockerSandboxSpec {
  const build = (state: HookState): DockerSandboxSpec => ({
    provider: "docker",
    ...opts,
    setupHooks: state.setupHooks,
    teardownHooks: state.teardownHooks,
    ...hookMethods(state, build),
  });
  return build(EMPTY_HOOKS);
}

/** Vercel Sandbox:microVM。`snapshotId` 从已有快照起(预制模板:烘焙好 agent CLI 的快照)。 */
export function vercelSandbox(
  opts: Omit<VercelSandboxSpec, "provider" | keyof SandboxHooks<unknown>> = {},
): VercelSandboxSpec {
  const build = (state: HookState): VercelSandboxSpec => ({
    provider: "vercel",
    ...opts,
    setupHooks: state.setupHooks,
    teardownHooks: state.teardownHooks,
    ...hookMethods(state, build),
  });
  return build(EMPTY_HOOKS);
}

/** E2B 沙箱。`template` 选 e2b 模板名/ID(预制模板:如 `"niceeval-agents"`);省略用 e2b 默认 `"base"`。 */
export function e2bSandbox(
  opts: Omit<E2BSandboxSpec, "provider" | keyof SandboxHooks<unknown>> = {},
): E2BSandboxSpec {
  const build = (state: HookState): E2BSandboxSpec => ({
    provider: "e2b",
    ...opts,
    setupHooks: state.setupHooks,
    teardownHooks: state.teardownHooks,
    ...hookMethods(state, build),
  });
  return build(EMPTY_HOOKS);
}

/**
 * 本地沙箱:宿主机本地目录直接当 workdir 跑(见 docs/feature/sandbox/local.md)。`dir` 省略时
 * 从当前目录向上解析 git 仓库根;显式 `dir` 可以是任意本地目录,不要求已是 git 仓库。
 */
export function localSandbox(
  opts: Omit<LocalSandboxSpec, "provider" | keyof SandboxHooks<unknown>> = {},
): LocalSandboxSpec {
  const build = (state: HookState): LocalSandboxSpec => ({
    provider: "local",
    ...opts,
    setupHooks: state.setupHooks,
    teardownHooks: state.teardownHooks,
    ...hookMethods(state, build),
  });
  return build(EMPTY_HOOKS);
}

/**
 * 自定义沙箱 provider:`create` 直接返回一个实现 `Sandbox` 接口的实例,不需要 niceeval 内置支持
 * 这个 provider 名字。用于接入 docker/vercel/e2b 之外的运行环境(自建 VM、Modal、Fly 等)。
 */
export function defineSandbox(def: {
  name: string;
  create: CustomSandboxSpec["create"];
  recommendedConcurrency?: number;
  /**
   * 独占串行声明:该 provider 的所有 attempt 共享同一份不可并发的底层资源(如同一棵真实工作树)时
   * 声明 `true`——runner 加一道 provider 级串行闸,`--max-concurrency` / 实验级 `maxConcurrency`
   * 都不解除(内置 `local` provider 即声明它)。省略 = 不独占,照常按并发上限调度。
   */
  exclusive?: boolean;
  /** 可发布参数的投影(进结果快照);未实现时只落 provider 名。 */
  publicConfig?: CustomSandboxSpec["publicConfig"];
}): CustomSandboxSpec {
  if (!def.name) throw new Error(t("define.sandboxNameRequired"));
  if (typeof def.create !== "function") throw new Error(t("define.sandboxCreateRequired"));
  const build = (state: HookState): CustomSandboxSpec => ({
    provider: def.name,
    create: def.create,
    recommendedConcurrency: def.recommendedConcurrency,
    exclusive: def.exclusive,
    publicConfig: def.publicConfig,
    setupHooks: state.setupHooks,
    teardownHooks: state.teardownHooks,
    ...hookMethods(state, build),
  });
  return build(EMPTY_HOOKS);
}
