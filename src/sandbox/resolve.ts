// 沙箱后端解析:把 --sandbox / config.sandbox / experiment.sandbox(字符串后端名 或
// spec 数据结构)折叠成一个具体后端 + 参数,并按需创建实例。
// 后端名的行为分支只允许出现在 sandbox/ 内(见 docs/architecture.md)。

import { Effect } from "effect";
import type { Sandbox, SandboxBackend, SandboxOption, SandboxRuntime } from "../types.ts";
import { registerSandbox, stopSandbox } from "./registry.ts";
import { t } from "../i18n/index.ts";

/** 归一化后的沙箱描述:确定的后端 + 各后端参数(只有对应后端用得上的会有值)。 */
export interface ResolvedSandbox {
  backend: "docker" | "vercel" | "e2b";
  runtime?: SandboxRuntime;
  /** docker */
  image?: string;
  /** vercel */
  snapshotId?: string;
  /** e2b */
  template?: string;
}

/**
 * 决定用哪个后端:
 * - 显式指定且非 "auto" → 直接用。
 * - 否则:env 里有 VERCEL_TOKEN / VERCEL_OIDC_TOKEN → "vercel"。
 * - 再否则:env 里有 E2B_API_KEY → "e2b"。
 * - 再否则 → "docker"。
 */
export function resolveBackend(opts: { backend?: SandboxBackend }): SandboxBackend {
  const { backend } = opts;
  if (backend && backend !== "auto") {
    return backend;
  }
  if (process.env.VERCEL_TOKEN || process.env.VERCEL_OIDC_TOKEN) {
    return "vercel";
  }
  if (process.env.E2B_API_KEY) {
    return "e2b";
  }
  return "docker";
}

/** 把字符串后端名 或 spec 数据结构 归一化成 ResolvedSandbox(spec 的 backend 已是具体值,直接用)。 */
export function resolveSandbox(opt: SandboxOption | undefined, runtimeDefault?: SandboxRuntime): ResolvedSandbox {
  if (opt && typeof opt === "object") {
    return { ...opt, runtime: opt.runtime ?? runtimeDefault };
  }
  const backend = resolveBackend({ backend: opt });
  if (backend !== "docker" && backend !== "vercel" && backend !== "e2b") {
    throw new Error(t("sandbox.backendNotImplemented", { backend }));
  }
  return { backend, runtime: runtimeDefault };
}

/**
 * 各后端的推荐默认并发数。反映的是后端侧约束(daemon 容量、API quota、session 池大小),
 * 不是用户侧的 agent API 限速——后者由用户通过 --max-concurrency 或 config.maxConcurrency 设置。
 * docker:本地 daemon 创建容器有开销,10 是经验上稳健的上限。
 * e2b:云服务,20 是默认账户并发配额的保守估计。
 * vercel:sandbox session 有严格的并发限制,1 避免 429。
 */
export function sandboxRecommendedConcurrency(opt: SandboxOption | undefined): number {
  if (!opt) return 10;
  const r = resolveSandbox(opt);
  switch (r.backend) {
    case "docker":  return 10;
    case "e2b":     return 20;
    case "vercel":  return 1;
  }
}

/** 报告 / 日志用的简短标签:后端名,带上区分性的参数(镜像 / 快照 / 模板)。 */
export function sandboxLabel(opt: SandboxOption | undefined): string {
  const r = resolveSandbox(opt);
  const detail = r.image ?? r.snapshotId ?? r.template;
  return detail ? `${r.backend}:${detail}` : r.backend;
}

/**
 * 按解析出的后端 + 参数创建沙箱,并把 stop() 注册为 Scope 回收动作。
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
      const sb = await createBackend(r, opts.timeout);
      registerSandbox(sb);
      return sb;
    }),
    // release:成功 / 失败 / 中断都跑。带超时 + 失败不静默(stopSandbox 内做),并把它移出登记表。
    (sb) => Effect.promise(() => stopSandbox(sb)),
  );
}

async function createBackend(r: ResolvedSandbox, timeout?: number): Promise<Sandbox> {
  switch (r.backend) {
    case "docker": {
      const { DockerSandbox } = await import("./docker.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.docker"));
      });
      return DockerSandbox.create({ timeout, runtime: r.runtime, image: r.image });
    }
    case "vercel": {
      const { VercelSandbox } = await import("./vercel.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.vercel"));
      });
      return VercelSandbox.create({ timeout, runtime: r.runtime, snapshotId: r.snapshotId });
    }
    case "e2b": {
      const { E2BSandbox } = await import("./e2b.ts").catch(() => {
        throw new Error(t("sandbox.dependencyMissing.e2b"));
      });
      return E2BSandbox.create({ timeout, runtime: r.runtime, template: r.template });
    }
  }
}
