// Agent Ensure 协议实现:check → 缺失时 install → recheck。
// 契约单源:docs/feature/adapters/architecture/agent-ensure.md
//
// Runner 接线(run.ts / attempt.ts)由串行合流节点完成;本模块导出可调用的 Ensure API、
// Run 级 prepare single-flight 协调器,以及给 configHash 用的身份投影。

import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { t } from "../i18n/index.ts";
import type { Sandbox } from "../sandbox/types.ts";
import type {
  AgentArtifactPlatform,
  AgentEnsureOutcome,
  AgentIdentity,
  AgentInstallMode,
  AgentProvisioner,
  AgentProvisionerDef,
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
  /** Runner 已在 Run 级准备好的制品;省略时 staged 路径经 coordinator 懒准备。 */
  prepared?: AgentStagedArtifact;
  /** 目标平台;省略时用宿主 `process.platform` / `process.arch`。 */
  platform?: AgentArtifactPlatform;
  /** Run 级 prepare 协调器;多 attempt 应共享同一实例。 */
  coordinator?: ArtifactPrepareCoordinator;
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

function defaultMode(def: AgentProvisionerDef): AgentInstallMode {
  if (def.mode !== undefined) return def.mode;
  return def.prepare ? "staged" : "sandbox-network";
}

/**
 * 规格化用户 / 内置 provisioner。三种模式失败后不互相降级——mode 是配置,不是回退。
 */
export function defineAgentProvisioner(def: AgentProvisionerDef): AgentProvisioner {
  assertStableAgentIdentity(def.identity);
  const mode = defaultMode(def);
  if (mode === "staged" && def.prepare === undefined) {
    throw new Error(t("agent.ensure.stagedNeedsPrepare", { agent: def.identity.agent }));
  }
  if (mode === "verifyOnly" && def.prepare !== undefined) {
    // verifyOnly 不安装;带 prepare 易误导。点名而不是静默丢掉。
    throw new Error(t("agent.ensure.verifyOnlyHasPrepare", { agent: def.identity.agent }));
  }
  return {
    identity: def.identity,
    mode,
    check: def.check,
    install: def.install,
    prepare: def.prepare,
  };
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

export function hostArtifactPlatform(): AgentArtifactPlatform {
  return { os: process.platform, arch: process.arch };
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

  async prepare(
    provisioner: AgentProvisioner,
    platform: AgentArtifactPlatform = hostArtifactPlatform(),
  ): Promise<AgentStagedArtifact> {
    if (provisioner.mode !== "staged") {
      throw new Error(
        t("agent.ensure.prepareWrongMode", {
          agent: provisioner.identity.agent,
          mode: provisioner.mode,
        }),
      );
    }
    if (provisioner.prepare === undefined) {
      throw new Error(t("agent.ensure.stagedNeedsPrepare", { agent: provisioner.identity.agent }));
    }
    const key = artifactCacheKey(provisioner.identity, platform);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const runPrepare = async (): Promise<AgentStagedArtifact> => {
      const artifact = await provisioner.prepare!(platform);
      if (!artifact.digest.trim()) {
        throw new Error(t("agent.ensure.artifactMissingDigest", { agent: provisioner.identity.agent }));
      }
      this.cache.set(key, artifact);
      return artifact;
    };

    const promise = (
      this.timing
        ? this.timing.activity(
            AGENT_ARTIFACT_PREPARE_ACTIVITY,
            { identity: provisioner.identity, platform, cacheKey: key },
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
  phase: "check" | "recheck" | "verifyOnly";
  result: { actualVersion?: string; detail?: string };
}): string {
  return t("agent.ensure.failed", {
    agent: opts.identity.agent,
    expected: opts.identity.version,
    actual: opts.result.actualVersion ?? "(none)",
    phase: opts.phase,
    detail: opts.result.detail ?? "",
    next:
      opts.phase === "verifyOnly"
        ? t("agent.ensure.nextVerifyOnly")
        : t("agent.ensure.nextRecheck"),
  });
}

/**
 * Ensure 状态机:官方预装 / 自建预装 / 缺失 / 错版本 / verifyOnly 走同一路径。
 * 不改题面网络、不按 template 名短路、三种模式失败后不静默降级。
 */
export async function ensureAgent(
  provisioner: AgentProvisioner,
  sandbox: Sandbox,
  opts: EnsureAgentOptions = {},
): Promise<EnsureAgentResult> {
  assertStableAgentIdentity(provisioner.identity);

  const first = await provisioner.check(sandbox);
  if (first.ok) {
    reportFacts(opts.fact, "hit", first.actualVersion);
    return { outcome: "hit", actualVersion: first.actualVersion, artifact: opts.prepared };
  }

  if (provisioner.mode === "verifyOnly") {
    throw new Error(
      formatEnsureError({
        identity: provisioner.identity,
        phase: "verifyOnly",
        result: first,
      }),
    );
  }

  let artifact = opts.prepared;
  if (provisioner.mode === "staged") {
    if (!artifact) {
      const coordinator = opts.coordinator ?? sharedPrepareCoordinator;
      artifact = await coordinator.prepare(provisioner, opts.platform ?? hostArtifactPlatform());
    }
  }

  await provisioner.install(sandbox, artifact);

  const recheck = await provisioner.check(sandbox);
  if (!recheck.ok) {
    throw new Error(
      formatEnsureError({
        identity: provisioner.identity,
        phase: "recheck",
        result: recheck,
      }),
    );
  }

  reportFacts(opts.fact, "installed", recheck.actualVersion);
  return { outcome: "installed", actualVersion: recheck.actualVersion, artifact };
}

function reportFacts(
  fact: EnsureAgentOptions["fact"],
  outcome: AgentEnsureOutcome,
  actualVersion: string | undefined,
): void {
  if (!fact) return;
  fact(AGENT_ENSURE_FACT, outcome);
  if (actualVersion !== undefined) fact(AGENT_VERSION_ACTUAL_FACT, actualVersion);
}

/**
 * 进程级默认协调器:在 Runner 尚未注入 Run 级实例时,让 adapter setup 内的 ensure
 * 仍能 single-flight prepare。合流接线后应每 Run 新建 {@link ArtifactPrepareCoordinator}
 * 并经 {@link EnsureAgentOptions.coordinator} 传入。
 */
export const sharedPrepareCoordinator = new ArtifactPrepareCoordinator();

/** 计算文件内容 digest(sha256 hex),供 prepare 校验后写入 artifact。 */
export function sha256Hex(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}
