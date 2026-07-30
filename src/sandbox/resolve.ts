// 沙箱 provider 解析:把 config.sandbox / experiment.sandbox(工厂函数产出的 spec 数据结构)
// 折叠成一个具体 provider + 参数,并按需创建实例。`sandbox` 没有默认值也没有按名字选的入口——
// 沙箱型 agent 必须显式给 dockerSandbox() / vercelSandbox() / e2bSandbox() / defineSandbox(),
// 省略时 resolveSandbox() 直接抛错,不猜环境、不兜底。
// provider 名的行为分支只允许出现在 sandbox/ 内(见 docs/architecture.md)。

import { createHash, randomUUID } from "node:crypto";
import { Effect } from "effect";
import type {
  CustomSandboxSpec,
  JsonValue,
  Sandbox,
  SandboxOption,
  SandboxReuseCapability,
  SandboxRuntime,
  ScopedFeedback,
} from "../types.ts";
import { registerSandbox, stopSandbox, unregisterSandbox } from "./registry.ts";
import { normalizeSandboxPaths } from "./paths.ts";
import { t } from "../i18n/index.ts";
import { reportActivity, reportDiagnostic } from "../runner/feedback/sink.ts";
import { withProvisionRetry, type ProvisionSlot } from "./retry.ts";
import { currentRunIdentity } from "./run-identity.ts";
import {
  attachProvisionFailureScope,
  classifyProvisionConfigCause,
  provisionConfigCauseScope,
  type SandboxProvisionErrorKind,
} from "./errors.ts";
import {
  allSkippedStartupError,
  materializePlannedCase,
  missingProfilesError,
  planSandboxCase,
  validateSpecEnvironmentCases,
  type MaterializedSandboxCase,
  type SandboxSource,
} from "./case.ts";
import type { BuildKey } from "./identity.ts";
import {
  assertCustomCapabilitiesHonored,
  assertKeepAllowedForCase,
  hasGroupKeep,
  prebuiltProductSlotsOf,
  specWithPrebuiltProduct,
} from "./single-case.ts";
import { registerCustomGroupKeep } from "./custom-group-keep.ts";

export {
  planSandboxCase,
  materializePlannedCase,
  collectMissingProfiles,
  collectCapabilityGaps,
  allSelectedCapabilitySkipped,
  missingProfilesError,
  allSkippedStartupError,
  validateSpecEnvironmentCases,
} from "./case.ts";
export type { CasePlanResult, PlannedSandboxCase, PlanSandboxCaseInput } from "./case.ts";
export {
  computeBuildKey,
  computeCaseKey,
  resolveFloatingImageTag,
  credentialIdentityContribution,
  assertPureDataIdentity,
  caseCarryEligible,
} from "./identity.ts";
export type { BuildKey, CaseKey, BuildKeyInput, CaseKeyInput, ImageRefResolution, CredentialRef } from "./identity.ts";
export {
  prebuiltProductSlotsOf,
  specWithPrebuiltProduct,
  assertKeepAllowedForCase,
  assertCustomCapabilitiesHonored,
  hasGroupKeep,
  caseCapabilitiesOf,
  isSingleSandboxCaseKind,
  SINGLE_SANDBOX_CASE_KINDS,
} from "./single-case.ts";
export type { PrebuiltProductSlots, SingleSandboxCaseKind } from "./single-case.ts";
export {
  registerCustomGroupKeep,
  lookupCustomGroupKeep,
  destroyCustomGroupKeep,
  wakeCustomGroupKeep,
  clearCustomGroupKeepRegistry,
} from "./custom-group-keep.ts";

/** 归一化后的沙箱描述:确定的 provider + 各 provider 参数(只有对应 provider 用得上的会有值)。 */
export interface ResolvedSandbox {
  provider: string;
  runtime?: SandboxRuntime;
  lifetimeMs?: number;
  /** docker */
  image?: string;
  /** vercel */
  snapshotId?: string;
  /** e2b */
  template?: string;
  /** local:显式 workdir;省略时从当前目录向上解析 git 仓库根(见 sandbox/local.ts)。 */
  dir?: string;
  /** 自定义 provider(defineSandbox):有它就直接调用,跳过下面的内置 provider switch。 */
  create?: CustomSandboxSpec["create"];
  recommendedConcurrency?: number;
  /**
   * 独占串行声明(见 docs/runner.md「调度:有界并发」):runner 对声明了它的 provider 加一道
   * provider 级串行闸,`--max-concurrency` / 实验级 `maxConcurrency` 都不解除。内置 `local`
   * provider 恒为 true;自定义 provider 由 `defineSandbox({ exclusive })` 声明,省略即 false。
   */
  exclusive: boolean;
}

/** 把 spec 数据结构归一化成 ResolvedSandbox;省略(undefined)直接报错——没有默认 provider。 */
export function resolveSandbox(opt: SandboxOption | undefined, runtimeDefault?: SandboxRuntime): ResolvedSandbox {
  if (!opt) throw new Error(t("sandbox.missingSpec"));
  // environments 表判别键在归一化时一次穷举;非法组合(如同时 image+compose)启动期失败。
  validateSpecEnvironmentCases(opt);
  // local 的独占串行是内置事实(同一棵真实工作树,见 docs/feature/sandbox/local.md);自定义
  // provider 走各自声明的 exclusive 字段——两条路径都归一成同一个布尔字段,runner 只读它。
  const exclusive = opt.provider === "local" ? true : (opt as CustomSandboxSpec).exclusive === true;
  return { ...opt, runtime: opt.runtime ?? runtimeDefault, exclusive };
}

/**
 * 各 provider 的推荐默认并发数。反映的是 provider 侧约束(daemon 容量、API quota、session 池大小、
 * 独占串行的正确性约束),不是用户侧的 agent API 限速——后者由用户通过 --max-concurrency 或
 * config.maxConcurrency 设置。
 * docker:本地 daemon 创建容器有开销,10 是经验上稳健的上限。
 * e2b:云服务,20 是默认账户并发配额的保守估计。
 * vercel:sandbox session 有严格的并发限制,1 避免 429。
 * local:同一棵真实工作树不允许并发写,1 是独占串行约束的自然默认值。
 */
export function sandboxRecommendedConcurrency(opt: SandboxOption | undefined): number {
  if (!opt) return 10;
  const r = resolveSandbox(opt);
  switch (r.provider) {
    case "docker":  return 10;
    case "e2b":     return 20;
    case "vercel":  return 1;
    case "local":   return 1;
    default:        return r.recommendedConcurrency ?? 5;
  }
}

/**
 * ExperimentRunInfo.sandbox 的投影:provider 名 + 公开参数(镜像/快照/模板/runtime)+ 配置指纹。
 * 参数只经这个投影落盘——token、凭据路径永不进来;defineSandbox 自定义 provider 未实现
 * `publicConfig()` 时只落 provider 名(见 docs/feature/record/architecture.md)。
 */
export function sandboxRunInfo(
  opt: SandboxOption | undefined,
): { provider: string; params?: globalThis.Record<string, JsonValue>; fingerprint?: string } | undefined {
  if (!opt) return undefined;
  const r = resolveSandbox(opt);
  let params: globalThis.Record<string, JsonValue> | undefined;
  if (r.create) {
    // 自定义 provider:只有显式实现了 publicConfig() 投影才落参数。
    params = (opt as CustomSandboxSpec).publicConfig?.();
  } else {
    const p: globalThis.Record<string, JsonValue> = {};
    if (r.image !== undefined) p.image = r.image;
    if (r.snapshotId !== undefined) p.snapshotId = r.snapshotId;
    if (r.template !== undefined) p.template = r.template;
    if (r.dir !== undefined) p.dir = r.dir;
    if (r.runtime !== undefined) p.runtime = r.runtime;
    if (r.lifetimeMs !== undefined) p.lifetimeMs = r.lifetimeMs;
    params = Object.keys(p).length > 0 ? p : undefined;
  }
  if (params === undefined) return { provider: r.provider };
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ provider: r.provider, params }))
    .digest("hex")
    .slice(0, 16);
  return { provider: r.provider, params, fingerprint };
}

/** 报告 / 日志用的简短标签:provider 名,带上区分性的参数(镜像 / 快照 / 模板)。 */
export function sandboxLabel(opt: SandboxOption | undefined): string {
  const r = resolveSandbox(opt);
  const detail = r.image ?? r.snapshotId ?? r.template ?? r.dir;
  return detail ? `${r.provider}:${detail}` : r.provider;
}

/**
 * 按解析出的 provider + 参数创建沙箱,并把 stop() 注册为 Sample 回收动作。
 * 在 Effect.scoped / Effect.gen 里 yield* 即可;成功/失败/中断都保证 stop。
 */
/** 没有 runner 绑定 feedback 时(测试直调等)的兜底:退回全局 sink,行为与旧接线一致。 */
function fallbackFeedback(): ScopedFeedback {
  return {
    progress: (u) =>
      reportActivity(u.current !== undefined && u.total !== undefined ? `${u.message} (${u.current}/${u.total})` : u.message),
    // key 只管折叠到多细(dedupeKey 里常编进 sandboxId 之类的实例细节),对外的稳定词法
    // 一律是 code —— 不带 code 时 json.ts 会回落成 `code ?? key`,把复合去重串当成词法透出去。
    diagnostic: (d) =>
      reportDiagnostic({ key: d.dedupeKey ?? d.code, code: d.code, severity: d.level, message: d.message, data: d.data }),
  };
}

export function createSandbox(opts: {
  sandbox?: SandboxOption;
  timeout?: number;
  /**
   * attempt deadline 的截止时刻(epoch ms)。沙箱内一切时限从它派生——单条命令未显式传
   * `timeout` 时上限就是它的剩余量(见 deadline.ts);省略 = 本 attempt 没有 deadline。
   */
  deadlineAt?: number;
  runtime?: SandboxRuntime;
  /** 调用方并发槽位的临时归还/收回,传给 withProvisionRetry 在退避睡眠期间释放(见 retry.ts)。 */
  provisionSlot?: ProvisionSlot;
  /** runner 绑定到 `sandbox.create` 阶段的反馈句柄;provider 的进度/诊断都走它。 */
  feedback?: ScopedFeedback;
  /**
   * release 覆写(留存路径用):Sample 关闭时按调用方的 disposition 决定 stop 还是 suspend。
   * 省略 = 恒 stopSandbox(默认销毁)。
   */
  release?: (sb: Sandbox) => Promise<void>;
}) {
  const r = resolveSandbox(opts.sandbox, opts.runtime);
  const feedback = opts.feedback ?? fallbackFeedback();
  return Effect.acquireRelease(
    Effect.promise<Sandbox>(async () => {
      // 起好就登记:让 cli 的兜底强清(二次 Ctrl+C / 看门狗超时)能直接停到它,不只靠下面的
      // release。即便本 fiber 创建后立刻被中断、release 还没来得及跑,登记表也已认得这个沙箱。
      const sb = normalizeSandboxPaths(await createProvider(r, feedback, opts.timeout, opts.provisionSlot, opts.deadlineAt), r.provider);
      registerSandbox(sb);
      return sb;
    }),
    // release:成功 / 失败 / 中断都跑。带超时 + 失败不静默(stopSandbox 内做),并把它移出登记表。
    (sb) => Effect.promise(() => (opts.release ? opts.release(sb) : stopSandbox(sb))),
  );
}

/**
 * 创建并登记一个可由复用池显式接管的实例；调用方必须用 stopSandbox 收尾。
 *
 * 返回的是裸 `Sandbox`：复用寿命能力只能由 provider 自己实现（见
 * docs/feature/sandbox/reuse.md「派发前确认」），这里不套任何通用记账层——本地时钟记账没有
 * 把寿命写进 provider 后端，`ready: true` 就是在把「没实现」伪装成「实现了」，实例照样在远处
 * 被按默认寿命回收。调用方用 `sandboxReuseCapability()` 探测,探不到就硬失败。
 */
export async function createSandboxInstance(opts: {
  sandbox?: SandboxOption;
  timeout?: number;
  /** attempt deadline 的截止时刻(epoch ms),语义同 `createSandbox`。 */
  deadlineAt?: number;
  runtime?: SandboxRuntime;
  provisionSlot?: ProvisionSlot;
  feedback?: ScopedFeedback;
}): Promise<Sandbox> {
  const r = resolveSandbox(opts.sandbox, opts.runtime);
  const feedback = opts.feedback ?? fallbackFeedback();
  const sandbox = normalizeSandboxPaths(await createProvider(r, feedback, opts.timeout, opts.provisionSlot, opts.deadlineAt), r.provider);
  registerSandbox(sandbox);
  return sandbox;
}

/**
 * 探测实例自带的复用寿命能力(`Sandbox` 接口不因复用扩大,与 `suspend()` 同一种「接口之外的
 * 可选能力」)。provider 没实现就是 undefined —— 调用方据此在第一条 Attempt 派发前硬失败,
 * 不存在「探不到就兜一个」的分支。
 */
export function sandboxReuseCapability(sandbox: Sandbox): SandboxReuseCapability | undefined {
  const ensureLifetime = (sandbox as Partial<SandboxReuseCapability>).ensureLifetime;
  return typeof ensureLifetime === "function" ? { ensureLifetime: (ms) => ensureLifetime.call(sandbox, ms) } : undefined;
}

/**
 * spec 是否带 `environments` 表:决定「模板不存在」死因的 scope 定档(见 errors.ts 的
 * `provisionConfigCauseScope`)。查表本身(profile → 具体产物)是 runner/sandbox-selection.ts
 * 的规划期职责;这里只读字段是否存在——`environments` 在 spec 声明了就会随 `resolveSandbox()`
 * 的展开(以及 profile 派生 spec 的浅覆盖)原样带到这里,不需要重新解析 profile。
 */
function hasEnvironmentsTable(r: ResolvedSandbox): boolean {
  const environments = (r as { environments?: unknown }).environments;
  return typeof environments === "object" && environments !== null;
}

/**
 * provisioning 失败向外浮出确定性配置死因的 scope(契约见
 * docs/feature/sandbox/architecture.md#provisioning-失败与重试「对外的空间轴映射」)。
 * `work` 失败后,只有 provider 自身分类判定为 `"unknown"`(确定性)时才进一步细分死因;
 * 瞬时失败(拒绝类/歧义类)不论是否重试耗尽都原样抛出,不附带 scope——死因不可证明为
 * 兄弟共享。导出供单测直接注入 `work`/`classify`,不需要经过真实 provider SDK。
 */
export async function withDeterministicProvisionScope<T>(
  work: () => Promise<T>,
  classify: (e: unknown) => SandboxProvisionErrorKind,
  r: ResolvedSandbox,
): Promise<T> {
  try {
    return await work();
  } catch (e) {
    if (classify(e) === "unknown") {
      const cause = classifyProvisionConfigCause(e);
      if (cause) attachProvisionFailureScope(e, provisionConfigCauseScope(cause, hasEnvironmentsTable(r)));
    }
    throw e;
  }
}

export interface CreateMaterializedCaseOpts {
  readonly evalId: string;
  readonly environment?: string | SandboxSource;
  readonly defaultProfileId?: string;
  readonly sandbox: SandboxOption;
  readonly timeout?: number;
  readonly runtime?: SandboxRuntime;
  readonly provisionSlot?: ProvisionSlot;
  readonly feedback?: ScopedFeedback;
  readonly signal?: AbortSignal;
  readonly buildLocators?: ReadonlyMap<BuildKey, string>;
  /** 为 true 时在创建前跑 keep 守卫(自定义缺 group-keep / local 等会硬失败)。 */
  readonly keepRequested?: boolean;
}

/**
 * 规划并物化单 Sandbox、自定义或 Docker Compose case。
 * Docker image / E2B template / Vercel snapshot / Local base 走既有 create 路径,
 * 再经 materializePlannedCase 包成 primary-only 资源组(现有行为的严格子集)。
 * Docker Compose 走 compose.ts 原生物化;cloud-compose 无物化器时拒绝降级。
 */
export async function createMaterializedCase(
  opts: CreateMaterializedCaseOpts,
): Promise<MaterializedSandboxCase> {
  const planned = planSandboxCase({
    evalId: opts.evalId,
    environment: opts.environment,
    defaultProfileId: opts.defaultProfileId,
    spec: opts.sandbox,
  });

  if (planned.status === "missing-profile") {
    throw missingProfilesError(String(opts.sandbox.provider), [
      { evalId: planned.evalId, profile: planned.profile },
    ]);
  }
  if (planned.status === "capability-missing") {
    throw allSkippedStartupError(String(opts.sandbox.provider), [
      { evalId: planned.evalId, skipReason: planned.skipReason },
    ]);
  }

  const plan = planned.plan;
  assertKeepAllowedForCase({
    plan,
    provider: String(opts.sandbox.provider),
    keepRequested: opts.keepRequested === true,
  });

  const ctx = {
    evalId: opts.evalId,
    profile: plan.profile,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.buildLocators !== undefined ? { buildLocators: opts.buildLocators } : {}),
  };

  if (plan.declaration.form === "custom") {
    const materialized = await materializePlannedCase(plan, { ctx });
    assertCustomCapabilitiesHonored(plan, materialized);
    attachCaseLifecycle(materialized);
    registerGroupKeepIfPresent(plan, materialized, String(opts.sandbox.provider));
    return materialized;
  }

  if (plan.caseKind === "compose") {
    const materialized = await materializePlannedCase(plan, {
      ctx,
      timeout: opts.timeout,
      feedback: opts.feedback,
    });
    attachCaseLifecycle(materialized);
    return materialized;
  }

  if (plan.caseKind === "cloud-compose") {
    throw new Error(
      `sandbox case kind ${JSON.stringify(plan.caseKind)} for ${JSON.stringify(plan.evalId)} ` +
        `requires a Compose materializer — refusing to degrade to a single Sandbox`,
    );
  }

  if (plan.caseKind === "on-demand-build") {
    const locator = firstBuildLocator(opts.buildLocators);
    if (locator === undefined) {
      throw new Error(
        `sandbox case kind "on-demand-build" for ${JSON.stringify(plan.evalId)} ` +
          `needs build locators from the run build coordinator before materialization`,
      );
    }
    const createSpec = onDemandCreateSpec(opts.sandbox, plan.evalId, locator);
    const primary = await createSandboxInstance({
      sandbox: createSpec,
      timeout: opts.timeout,
      runtime: opts.runtime,
      provisionSlot: opts.provisionSlot,
      feedback: opts.feedback,
    });
    const materialized = await materializePlannedCase(plan, { ctx, primarySandbox: primary });
    attachCaseLifecycle(materialized);
    return withCaseFacts(materialized, { buildLocator: locator, sandboxId: primary.sandboxId });
  }

  // prebuilt / base:既有 Docker/E2B/Vercel/Local create 路径的严格子集。
  const createSpec = specWithPrebuiltProduct(opts.sandbox, plan);
  const primary = await createSandboxInstance({
    sandbox: createSpec,
    timeout: opts.timeout,
    runtime: opts.runtime,
    provisionSlot: opts.provisionSlot,
    feedback: opts.feedback,
  });
  const materialized = await materializePlannedCase(plan, { ctx, primarySandbox: primary });
  const slots = prebuiltProductSlotsOf(plan) ?? {};
  attachCaseLifecycle(materialized);
  return withCaseFacts(materialized, {
    ...slots,
    sandboxId: primary.sandboxId,
  });
}

function firstBuildLocator(locators: ReadonlyMap<BuildKey, string> | undefined): string | undefined {
  if (locators === undefined || locators.size === 0) return undefined;
  return locators.values().next().value;
}

function onDemandCreateSpec(spec: SandboxOption, evalId: string, locator: string): SandboxOption {
  if (spec.provider === "docker") return { ...spec, image: locator } as SandboxOption;
  if (spec.provider === "e2b") return { ...spec, template: locator } as SandboxOption;
  throw new Error(
    `on-demand-build locator for ${JSON.stringify(evalId)} is not supported on provider ${JSON.stringify(spec.provider)}`,
  );
}

function attachCaseLifecycle(materialized: MaterializedSandboxCase): void {
  registerSandbox(materialized.sandbox);
  const innerStop = materialized.group.stop.bind(materialized.group);
  const sandbox = materialized.sandbox;
  (materialized.group as { stop: () => Promise<void> }).stop = async () => {
    try {
      await innerStop();
    } finally {
      unregisterSandbox(sandbox);
    }
  };
}

function registerGroupKeepIfPresent(
  plan: import("./case.ts").PlannedSandboxCase,
  materialized: MaterializedSandboxCase,
  provider: string,
): void {
  if (plan.declaration.form !== "custom") return;
  const custom = plan.declaration.value;
  if (!hasGroupKeep(custom) || custom.groupKeep === undefined) return;
  registerCustomGroupKeep({
    provider,
    profile: plan.profile,
    primarySandboxId: materialized.sandbox.sandboxId,
    handlers: {
      resources: custom.groupKeep.resources,
      wake: custom.groupKeep.wake,
      destroy: custom.groupKeep.destroy,
    },
  });
}

function withCaseFacts(materialized: MaterializedSandboxCase, extra: JsonValue): MaterializedSandboxCase {
  const base =
    typeof materialized.facts === "object" && materialized.facts !== null && !Array.isArray(materialized.facts)
      ? (materialized.facts as globalThis.Record<string, JsonValue>)
      : {};
  const merged =
    typeof extra === "object" && extra !== null && !Array.isArray(extra)
      ? { ...base, ...(extra as globalThis.Record<string, JsonValue>) }
      : { ...base, extra };
  return { ...materialized, facts: merged };
}

async function createProvider(
  r: ResolvedSandbox,
  feedback: ScopedFeedback,
  timeout?: number,
  provisionSlot?: ProvisionSlot,
  deadlineAt?: number,
): Promise<Sandbox> {
  // 自定义 provider(defineSandbox):不认 provider 名,直接调用用户给的 create();
  // feedback 已绑定到 sandbox.create 阶段(见 docs/feature/sandbox/library.md)。
  if (r.create) return r.create({ timeout, runtime: r.runtime, feedback });
  switch (r.provider) {
    case "docker": {
      const { DockerSandbox, classifyProvisionError, reconcileProvision } = await import("./docker.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.docker"));
      });
      // 一次性 provision token:歧义类失败重试前按它对账(销毁可能已创建的实例再重建)。
      const token = randomUUID();
      // 运行标识(host/pid/startedAt)与 provision token 同一 label 机制:强杀之后
      // `sandbox list --orphans` / `prune` 按它事后核对与收回(见 run-identity.ts)。
      const runIdentity = currentRunIdentity();
      return withDeterministicProvisionScope(
        () =>
          withProvisionRetry(
            () =>
              DockerSandbox.create({
                timeout,
                deadlineAt,
                lifetimeMs: r.lifetimeMs,
                runtime: r.runtime,
                image: r.image,
                feedback,
                provisionToken: token,
                runIdentity,
              }),
            classifyProvisionError,
            provisionSlot,
            feedback,
            () => reconcileProvision(token),
          ),
        classifyProvisionError,
        r,
      );
    }
    case "vercel": {
      const { VercelSandbox, classifyProvisionError } = await import("./vercel.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.vercel"));
      });
      // vercel SDK 没有按元数据检索实例的通道:不传 reconcile,歧义类第一次抛出。
      return withDeterministicProvisionScope(
        () =>
          withProvisionRetry(
            () => VercelSandbox.create({ timeout, deadlineAt, runtime: r.runtime, snapshotId: r.snapshotId, feedback }),
            classifyProvisionError,
            provisionSlot,
            feedback,
          ),
        classifyProvisionError,
        r,
      );
    }
    case "e2b": {
      const { E2BSandbox, classifyProvisionError, reconcileProvision } = await import("./e2b.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.e2b"));
      });
      const token = randomUUID();
      const runIdentity = currentRunIdentity();
      return withDeterministicProvisionScope(
        () =>
          withProvisionRetry(
            () =>
              E2BSandbox.create({
                timeout,
                deadlineAt,
                runtime: r.runtime,
                template: r.template,
                lifetimeMs: r.lifetimeMs,
                provisionToken: token,
                runIdentity,
              }),
            classifyProvisionError,
            provisionSlot,
            feedback,
            () => reconcileProvision(token),
          ),
        classifyProvisionError,
        r,
      );
    }
    case "local": {
      // 不参与 provisioning 重试(见 docs/feature/sandbox/local.md「非目标」):创建不经网络
      // 控制面,失败(目录不存在/不可写/不在 git 仓库内)都是确定性错误,第一次如实抛出。
      const { LocalSandbox } = await import("./local.ts");
      return LocalSandbox.create({ timeout, deadlineAt, dir: r.dir });
    }
    default:
      throw new Error(t("sandbox.providerNotImplemented", { provider: r.provider }));
  }
}
