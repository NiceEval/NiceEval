// 沙箱 provider 解析:把 config.sandbox / experiment.sandbox(工厂函数产出的 spec 数据结构)
// 折叠成一个具体 provider + 参数,并按需创建实例。`sandbox` 没有默认值也没有按名字选的入口——
// 沙箱型 agent 必须显式给 dockerSandbox() / vercelSandbox() / e2bSandbox() / defineSandbox(),
// 省略时 resolveSandbox() 直接抛错,不猜环境、不兜底。
// provider 名的行为分支只允许出现在 sandbox/ 内(见 docs/architecture.md)。

import { Effect } from "effect";
import type { CustomSandboxSpec, Sandbox, SandboxOption, SandboxRuntime } from "../types.ts";
import { registerSandbox, stopSandbox } from "./registry.ts";
import { normalizeSandboxPaths } from "./paths.ts";
import { t } from "../i18n/index.ts";
import { withProvisionRetry } from "./retry.ts";

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
  /** 自定义 provider(defineSandbox):有它就直接调用,跳过下面的内置 provider switch。 */
  create?: CustomSandboxSpec["create"];
  recommendedConcurrency?: number;
}

/** 把 spec 数据结构归一化成 ResolvedSandbox;省略(undefined)直接报错——没有默认 provider。 */
export function resolveSandbox(opt: SandboxOption | undefined, runtimeDefault?: SandboxRuntime): ResolvedSandbox {
  if (!opt) throw new Error(t("sandbox.missingSpec"));
  return { ...opt, runtime: opt.runtime ?? runtimeDefault };
}

/**
 * 各 provider 的推荐默认并发数。反映的是 provider 侧约束(daemon 容量、API quota、session 池大小),
 * 不是用户侧的 agent API 限速——后者由用户通过 --max-concurrency 或 config.maxConcurrency 设置。
 * docker:本地 daemon 创建容器有开销,10 是经验上稳健的上限。
 * e2b:云服务,20 是默认账户并发配额的保守估计。
 * vercel:sandbox session 有严格的并发限制,1 避免 429。
 */
export function sandboxRecommendedConcurrency(opt: SandboxOption | undefined): number {
  if (!opt) return 10;
  const r = resolveSandbox(opt);
  switch (r.provider) {
    case "docker":  return 10;
    case "e2b":     return 20;
    case "vercel":  return 1;
    default:        return r.recommendedConcurrency ?? 5;
  }
}

/** 报告 / 日志用的简短标签:provider 名,带上区分性的参数(镜像 / 快照 / 模板)。 */
export function sandboxLabel(opt: SandboxOption | undefined): string {
  const r = resolveSandbox(opt);
  const detail = r.image ?? r.snapshotId ?? r.template;
  return detail ? `${r.provider}:${detail}` : r.provider;
}

/**
 * 按解析出的 provider + 参数创建沙箱,并把 stop() 注册为 Scope 回收动作。
 * 在 Effect.scoped / Effect.gen 里 yield* 即可;成功/失败/中断都保证 stop。
 */
export function createSandbox(opts: {
  sandbox?: SandboxOption;
  timeout?: number;
  runtime?: SandboxRuntime;
}) {
  const r = resolveSandbox(opts.sandbox, opts.runtime);
  return Effect.acquireRelease(
    Effect.promise<Sandbox>(async () => {
      // 起好就登记:让 cli 的兜底强清(二次 Ctrl+C / 看门狗超时)能直接停到它,不只靠下面的
      // release。即便本 fiber 创建后立刻被中断、release 还没来得及跑,登记表也已认得这个沙箱。
      const sb = normalizeSandboxPaths(await createProvider(r, opts.timeout));
      registerSandbox(sb);
      return sb;
    }),
    // release:成功 / 失败 / 中断都跑。带超时 + 失败不静默(stopSandbox 内做),并把它移出登记表。
    (sb) => Effect.promise(() => stopSandbox(sb)),
  );
}

async function createProvider(r: ResolvedSandbox, timeout?: number): Promise<Sandbox> {
  // 自定义 provider(defineSandbox):不认 provider 名,直接调用用户给的 create()。
  if (r.create) return r.create({ timeout, runtime: r.runtime });
  switch (r.provider) {
    case "docker": {
      const { DockerSandbox, classifyProvisionError } = await import("./docker.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.docker"));
      });
      return withProvisionRetry(
        () => DockerSandbox.create({ timeout, runtime: r.runtime, image: r.image }),
        classifyProvisionError,
      );
    }
    case "vercel": {
      const { VercelSandbox, classifyProvisionError } = await import("./vercel.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.vercel"));
      });
      return withProvisionRetry(
        () => VercelSandbox.create({ timeout, runtime: r.runtime, snapshotId: r.snapshotId }),
        classifyProvisionError,
      );
    }
    case "e2b": {
      const { E2BSandbox, classifyProvisionError } = await import("./e2b.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.e2b"));
      });
      return withProvisionRetry(
        () => E2BSandbox.create({ timeout, runtime: r.runtime, template: r.template }),
        classifyProvisionError,
      );
    }
    default:
      throw new Error(t("sandbox.providerNotImplemented", { provider: r.provider }));
  }
}
