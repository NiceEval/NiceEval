// 沙箱 provider 解析:把 config.sandbox / experiment.sandbox(工厂函数产出的 spec 数据结构)
// 折叠成一个具体 provider + 参数,并按需创建实例。`sandbox` 没有默认值也没有按名字选的入口——
// 沙箱型 agent 必须显式给 dockerSandbox() / vercelSandbox() / e2bSandbox() / defineSandbox(),
// 省略时 resolveSandbox() 直接抛错,不猜环境、不兜底。
// provider 名的行为分支只允许出现在 sandbox/ 内(见 docs/architecture.md)。

import { createHash, randomUUID } from "node:crypto";
import { Effect } from "effect";
import type { CustomSandboxSpec, JsonValue, Sandbox, SandboxOption, SandboxRuntime, ScopedFeedback } from "../types.ts";
import { registerSandbox, stopSandbox } from "./registry.ts";
import { normalizeSandboxPaths } from "./paths.ts";
import { t } from "../i18n/index.ts";
import { reportActivity, reportDiagnostic } from "../runner/feedback/sink.ts";
import { withProvisionRetry, type ProvisionSlot } from "./retry.ts";

/** 归一化后的沙箱描述:确定的 provider + 各 provider 参数(只有对应 provider 用得上的会有值)。 */
export interface ResolvedSandbox {
  provider: string;
  runtime?: SandboxRuntime;
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
 * `publicConfig()` 时只落 provider 名(见 docs/feature/results/architecture.md)。
 */
export function sandboxRunInfo(
  opt: SandboxOption | undefined,
): { provider: string; params?: Record<string, JsonValue>; fingerprint?: string } | undefined {
  if (!opt) return undefined;
  const r = resolveSandbox(opt);
  let params: Record<string, JsonValue> | undefined;
  if (r.create) {
    // 自定义 provider:只有显式实现了 publicConfig() 投影才落参数。
    params = (opt as CustomSandboxSpec).publicConfig?.();
  } else {
    const p: Record<string, JsonValue> = {};
    if (r.image !== undefined) p.image = r.image;
    if (r.snapshotId !== undefined) p.snapshotId = r.snapshotId;
    if (r.template !== undefined) p.template = r.template;
    if (r.dir !== undefined) p.dir = r.dir;
    if (r.runtime !== undefined) p.runtime = r.runtime;
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
 * 按解析出的 provider + 参数创建沙箱,并把 stop() 注册为 Scope 回收动作。
 * 在 Effect.scoped / Effect.gen 里 yield* 即可;成功/失败/中断都保证 stop。
 */
/** 没有 runner 绑定 feedback 时(测试直调等)的兜底:退回全局 sink,行为与旧接线一致。 */
function fallbackFeedback(): ScopedFeedback {
  return {
    progress: (u) =>
      reportActivity(u.current !== undefined && u.total !== undefined ? `${u.message} (${u.current}/${u.total})` : u.message),
    diagnostic: (d) =>
      reportDiagnostic({ key: d.dedupeKey ?? d.code, severity: d.level, message: d.message, data: d.data }),
  };
}

export function createSandbox(opts: {
  sandbox?: SandboxOption;
  timeout?: number;
  runtime?: SandboxRuntime;
  /** 调用方并发槽位的临时归还/收回,传给 withProvisionRetry 在退避睡眠期间释放(见 retry.ts)。 */
  provisionSlot?: ProvisionSlot;
  /** runner 绑定到 `sandbox.create` 阶段的反馈句柄;provider 的进度/诊断都走它。 */
  feedback?: ScopedFeedback;
  /**
   * release 覆写(留存路径用):Scope 关闭时按调用方的 disposition 决定 stop 还是 suspend。
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
      const sb = normalizeSandboxPaths(await createProvider(r, feedback, opts.timeout, opts.provisionSlot));
      registerSandbox(sb);
      return sb;
    }),
    // release:成功 / 失败 / 中断都跑。带超时 + 失败不静默(stopSandbox 内做),并把它移出登记表。
    (sb) => Effect.promise(() => (opts.release ? opts.release(sb) : stopSandbox(sb))),
  );
}

async function createProvider(
  r: ResolvedSandbox,
  feedback: ScopedFeedback,
  timeout?: number,
  provisionSlot?: ProvisionSlot,
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
      return withProvisionRetry(
        () => DockerSandbox.create({ timeout, runtime: r.runtime, image: r.image, feedback, provisionToken: token }),
        classifyProvisionError,
        provisionSlot,
        feedback,
        () => reconcileProvision(token),
      );
    }
    case "vercel": {
      const { VercelSandbox, classifyProvisionError } = await import("./vercel.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.vercel"));
      });
      // vercel SDK 没有按元数据检索实例的通道:不传 reconcile,歧义类第一次抛出。
      return withProvisionRetry(
        () => VercelSandbox.create({ timeout, runtime: r.runtime, snapshotId: r.snapshotId, feedback }),
        classifyProvisionError,
        provisionSlot,
        feedback,
      );
    }
    case "e2b": {
      const { E2BSandbox, classifyProvisionError, reconcileProvision } = await import("./e2b.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.e2b"));
      });
      const token = randomUUID();
      return withProvisionRetry(
        () => E2BSandbox.create({ timeout, runtime: r.runtime, template: r.template, provisionToken: token }),
        classifyProvisionError,
        provisionSlot,
        feedback,
        () => reconcileProvision(token),
      );
    }
    case "local": {
      // 不参与 provisioning 重试(见 docs/feature/sandbox/local.md「非目标」):创建不经网络
      // 控制面,失败(目录不存在/不可写/不在 git 仓库内)都是确定性错误,第一次如实抛出。
      const { LocalSandbox } = await import("./local.ts");
      return LocalSandbox.create({ timeout, dir: r.dir });
    }
    default:
      throw new Error(t("sandbox.providerNotImplemented", { provider: r.provider }));
  }
}
