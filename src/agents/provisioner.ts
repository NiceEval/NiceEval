// Agent Ensure 协议实现:probe → 缺失时按 identity 配对 installer → install → 同一 probe 复检。
// 契约单源:docs/feature/adapters/architecture/agent-ensure.md
//
// Runner 接线(run.ts / attempt.ts)由串行合流节点完成;本模块导出可调用的 Ensure API、
// Run 级 prepare single-flight 协调器,以及给 configHash 用的身份投影。

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { t } from "../i18n/index.ts";
import type { Sandbox } from "../sandbox/types.ts";
import { createSandboxCommandTarget } from "../sandbox/operations.ts";
import type { SandboxCommandContext, SandboxCommandTarget } from "../sandbox/commands.ts";
import type {
  AgentArtifactPlatform,
  AgentEnsureOutcome,
  AgentEnsure,
  AgentIdentity,
  AgentInstaller,
  AgentStagedArtifact,
} from "./types.ts";

/** attempt facts:`agent.ensure` / `agent.version.actual`。 */
export const AGENT_ENSURE_FACT = "agent.ensure" as const;
export const AGENT_VERSION_ACTUAL_FACT = "agent.version.actual" as const;

/** Run 级开放 activity key;落盘形状由 Record timing 线拥有。 */
export const AGENT_ARTIFACT_PREPARE_ACTIVITY = "agent.artifact.prepare" as const;

/**
 * Timing recorder 钩子:Record 线尚未合流时可为 no-op / 注入测试观察器。
 * Runner 接线后传入真实 Run 级 recorder,把 prepare 记为 `agent.artifact.prepare`。
 */
export interface ArtifactPrepareTimingHook {
  activity<T>(
    key: typeof AGENT_ARTIFACT_PREPARE_ACTIVITY,
    attrs: { identity: AgentIdentity; platform: AgentArtifactPlatform; cacheKey: string },
    run: () => Promise<T>,
  ): Promise<T>;
}

export interface EnsureAgentOptions {
  /** 上报 attempt facts(`ctx.fact`)。 */
  fact?(key: string, value: string | number | boolean): void;
  /** Run 级 prepare 协调器;多 attempt 应共享同一实例。 */
  coordinator?: ArtifactPrepareCoordinator;
  signal?: AbortSignal;
  progress?(update: { message: string }): void;
}

export interface EnsureAgentResult {
  readonly outcome: AgentEnsureOutcome;
  readonly actualVersion?: string;
  readonly artifact?: AgentStagedArtifact;
}

/** 拒绝无精确版本的身份;`latest` / 空串启动期报错。 */
export function assertStableAgentIdentity(identity: AgentIdentity): void {
  const version = identity.version.trim();
  if (!identity.agent.trim()) {
    throw new Error(t("agent.ensure.identityMissingAgent"));
  }
  if (!version || version.toLowerCase() === "latest" || version.includes("*")) {
    throw new Error(
      t("agent.ensure.unstableVersion", { agent: identity.agent, version: identity.version }),
    );
  }
  if (!identity.revision.trim()) {
    throw new Error(t("agent.ensure.identityMissingRevision", { agent: identity.agent }));
  }
}

/** identity (+ 可选制品 digest/platform) → 指纹 / configHash 输入投影。 */
export function agentInstallIdentityInput(
  identity: AgentIdentity,
  artifact?: Pick<AgentStagedArtifact, "digest" | "platform">,
): {
  agent: string;
  version: string;
  revision: string;
  artifactDigest?: string;
  artifactPlatform?: string;
} {
  assertStableAgentIdentity(identity);
  return {
    agent: identity.agent,
    version: identity.version,
    revision: identity.revision,
    ...(artifact
      ? {
          artifactDigest: artifact.digest,
          artifactPlatform: platformKey(artifact.platform),
        }
      : {}),
  };
}

export function platformKey(platform: AgentArtifactPlatform): string {
  return platform.libc
    ? `${platform.os}-${platform.arch}-${platform.libc}`
    : `${platform.os}-${platform.arch}`;
}

export function artifactCacheKey(identity: AgentIdentity, platform: AgentArtifactPlatform): string {
  return `${identity.agent}@${identity.version}+r${identity.revision}|${platformKey(platform)}`;
}

/**
 * 从主 Sandbox 探测 staged payload 的**目标**平台。
 *
 * 制品要装进沙箱,不是装进宿主:cache key 与下载内容都必须按沙箱的 os / arch / libc 取。
 * 宿主 macOS-arm64 起一个 linux-x64 容器是常态,拿宿主平台去 prepare 会准备出跑不了的二进制。
 */
export async function detectSandboxPlatform(sandbox: Sandbox): Promise<AgentArtifactPlatform> {
  const probe = await sandbox.runShell(
    [
      "printf '%s\\n' \"$(uname -s)\"",
      "printf '%s\\n' \"$(uname -m)\"",
      // musl 的 ldd 把版本写在 stderr;两条流都看,认不出就留空,由调用方决定要不要 libc。
      "if command -v ldd >/dev/null 2>&1; then ldd --version 2>&1 | head -1; else printf '\\n'; fi",
    ].join("\n"),
  );
  if (probe.exitCode !== 0) {
    throw new Error(t("agent.ensure.platformDetectFailed", { tail: (probe.stdout + probe.stderr).trim().slice(0, 200) }));
  }
  const [unameS = "", unameM = "", ldd = ""] = probe.stdout.split("\n").map((line) => line.trim());
  const os = unameS.toLowerCase() === "darwin" ? "darwin" : unameS.toLowerCase() === "linux" ? "linux" : unameS.toLowerCase();
  const arch =
    unameM === "x86_64" || unameM === "amd64"
      ? "x64"
      : unameM === "aarch64" || unameM === "arm64"
        ? "arm64"
        : unameM;
  if (!os || !arch) {
    throw new Error(t("agent.ensure.platformDetectFailed", { tail: probe.stdout.trim().slice(0, 200) }));
  }
  if (os !== "linux") return { os, arch };
  return { os, arch, libc: /musl/i.test(ldd) ? "musl" : "gnu" };
}

/** 默认宿主 cache 根:`~/.cache/niceeval/agent-artifacts`。 */
export function defaultArtifactCacheDir(): string {
  return join(homedir(), ".cache", "niceeval", "agent-artifacts");
}

/**
 * Run 级 staged payload single-flight / cache。
 * 多个 attempt 共享同一 coordinator 实例;prepare 时间经 timing hook 记 `agent.artifact.prepare`。
 */
export class ArtifactPrepareCoordinator {
  private readonly cache = new Map<string, AgentStagedArtifact>();
  private readonly inflight = new Map<string, Promise<AgentStagedArtifact>>();
  private readonly timing: ArtifactPrepareTimingHook | undefined;

  constructor(timing?: ArtifactPrepareTimingHook) {
    this.timing = timing;
  }

  /** 已缓存或正在准备的制品;没有则 undefined。 */
  peek(identity: AgentIdentity, platform: AgentArtifactPlatform): AgentStagedArtifact | undefined {
    return this.cache.get(artifactCacheKey(identity, platform));
  }

  async prepare(installer: Extract<AgentInstaller, { installMode: "staged" }>, platform: AgentArtifactPlatform): Promise<AgentStagedArtifact> {
    if (installer.installMode !== "staged") {
      throw new Error(
        t("agent.ensure.prepareWrongMode", {
          agent: installer.identity.agent,
          mode: installer.installMode,
        }),
      );
    }
    const key = artifactCacheKey(installer.identity, platform);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const runPrepare = async (): Promise<AgentStagedArtifact> => {
      const artifact = await installer.prepareArtifact(platform);
      if (!artifact.digest.trim()) {
        throw new Error(t("agent.ensure.artifactMissingDigest", { agent: installer.identity.agent }));
      }
      this.cache.set(key, artifact);
      return artifact;
    };

    const promise = (
      this.timing
        ? this.timing.activity(
            AGENT_ARTIFACT_PREPARE_ACTIVITY,
            { identity: installer.identity, platform, cacheKey: key },
            runPrepare,
          )
        : runPrepare()
    ).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return promise;
  }
}

function formatEnsureError(opts: {
  identity: AgentIdentity;
  phase: "probe" | "recheck" | "verify-only" | "installer";
  result?: { detail?: string };
}): string {
  return t("agent.ensure.failed", {
    agent: opts.identity.agent,
    expected: opts.identity.version,
    actual: "(none)",
    phase: opts.phase,
    detail: opts.result?.detail ?? "",
    next:
      opts.phase === "verify-only"
        ? t("agent.ensure.nextVerifyOnly")
        : t("agent.ensure.nextRecheck"),
  });
}

/**
 * Runner 唯一调用的 Ensure 循环。Adapter 只声明 probe，不能在 setup 内自行绕过。
 * 不改题面网络、不按 template 名短路、三种模式失败后不静默降级。
 */
export async function runAgentEnsure(
  ensures: readonly AgentEnsure[],
  installers: readonly AgentInstaller[],
  sandbox: Sandbox,
  opts: EnsureAgentOptions = {},
): Promise<readonly EnsureAgentResult[]> {
  const target = createSandboxCommandTarget(sandbox);
  const signal = opts.signal ?? new AbortController().signal;
  const results: EnsureAgentResult[] = [];
  for (const ensure of ensures) {
    assertStableAgentIdentity(ensure.identity);
    if (await probeMatches(ensure, target, signal, opts.progress)) {
      reportFacts(opts.fact, "hit");
      results.push({ outcome: "hit" });
      continue;
    }
    const installer = installers.find((candidate) => sameIdentity(candidate.identity, ensure.identity));
    if (!installer || installer.installMode === "verify-only") {
      throw new Error(formatEnsureError({ identity: ensure.identity, phase: installer ? "verify-only" : "installer" }));
    }
    const platform = await detectSandboxPlatform(sandbox);
    if (installer.platforms && !installer.platforms.includes(platformKey(platform))) {
      throw new Error(`Agent installer for ${ensure.identity.agent}@${ensure.identity.version} does not support ${platformKey(platform)}.`);
    }
    let artifact: AgentStagedArtifact | undefined;
    if (installer.installMode === "staged") {
      artifact = await (opts.coordinator ?? sharedPrepareCoordinator).prepare(installer, platform);
      await installer.install(target, { identity: ensure.identity, targetPlatform: platform, artifact, signal, progress: opts.progress ?? (() => {}) });
    } else {
      await installer.install(target, { identity: ensure.identity, targetPlatform: platform, signal, progress: opts.progress ?? (() => {}) });
    }
    if (!(await probeMatches(ensure, target, signal, opts.progress))) {
      throw new Error(formatEnsureError({ identity: ensure.identity, phase: "recheck" }));
    }
    reportFacts(opts.fact, "installed");
    results.push({ outcome: "installed", artifact });
  }
  return results;
}

function reportFacts(
  fact: EnsureAgentOptions["fact"],
  outcome: AgentEnsureOutcome,
  actualVersion?: string,
): void {
  if (!fact) return;
  fact(AGENT_ENSURE_FACT, outcome);
  if (actualVersion !== undefined) fact(AGENT_VERSION_ACTUAL_FACT, actualVersion);
}

/**
 * 进程级默认协调器只服务直接单元调用；Runner 正常执行时每 Run 注入自己的实例。
 */
export const sharedPrepareCoordinator = new ArtifactPrepareCoordinator();

function sameIdentity(a: AgentIdentity, b: AgentIdentity): boolean {
  return a.agent === b.agent && a.version === b.version && a.revision === b.revision;
}

async function probeMatches(
  ensure: AgentEnsure,
  sandbox: SandboxCommandTarget,
  signal: AbortSignal,
  progress: EnsureAgentOptions["progress"],
): Promise<boolean> {
  try {
    await ensure.probe(sandbox, {
      phase: "prepare",
      owner: { kind: "experiment", id: `agent.ensure/${ensure.identity.agent}` },
      attempt: { id: "agent.ensure", index: 0 },
      signal,
      progress: progress ?? (() => {}),
      diagnostic: () => {},
      facts: () => {},
      onCleanup: () => {},
    } satisfies SandboxCommandContext);
    return true;
  } catch {
    return false;
  }
}

/** 计算文件内容 digest(sha256 hex),供 prepare 校验后写入 artifact。 */
export function sha256Hex(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}
