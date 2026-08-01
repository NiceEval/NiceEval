// Agent Ensure 协议实现:probe → 缺失时按 identity 配对 installer → install → 同一 probe 复检。
// 契约单源:docs/feature/adapters/architecture/agent-ensure.md
//
// Runner 接线(run.ts / attempt.ts)由串行合流节点完成;本模块导出可调用的 Ensure API、
// Run 级 prepare single-flight 协调器,以及给 configHash 用的身份投影。

import { homedir } from "node:os";
import { join } from "node:path";
import { Data, Effect, Exit, Option, Schema } from "effect";
import { t } from "../i18n/index.ts";
import type { SandboxOperations } from "../sandbox/types.ts";
import { createSandboxCommandTarget, SandboxCommandExitError } from "../sandbox/operations.ts";
import { isRegisteredSandboxContent } from "../sandbox/content.ts";
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

export interface AgentEnsureContext {
  /** 上报 attempt facts(`ctx.fact`)。 */
  fact(key: string, value: string | number | boolean): void;
  /** Run 级 prepare 协调器;多 attempt 应共享同一实例。 */
  readonly coordinator: Option.Option<ArtifactPrepareCoordinator>;
  /** ProviderPlan 已经确定的目标平台；实际 uname/ldd 只负责验证它，不反向决定制品。 */
  readonly targetPlatform: AgentArtifactPlatform;
  readonly signal: AbortSignal;
  progress(update: { message: string }): void;
}

export type AgentEnsureResult =
  | { readonly outcome: "hit"; readonly identity: AgentIdentity }
  | {
      readonly outcome: "installed";
      readonly identity: AgentIdentity;
      readonly installMode: "staged";
      readonly targetPlatform: AgentArtifactPlatform;
      readonly artifact: AgentStagedArtifact;
    }
  | {
      readonly outcome: "installed";
      readonly identity: AgentIdentity;
      readonly installMode: "sandbox-network";
      readonly targetPlatform: AgentArtifactPlatform;
    };

export type AgentEnsureFailureReason =
  | "coordinator-missing"
  | "probe-failed"
  | "installer-missing"
  | "verify-only"
  | "platform-detect-failed"
  | "platform-unsupported"
  | "artifact-prepare-failed"
  | "artifact-invalid"
  | "install-failed"
  | "recheck-missed";

/** Runner 的 agent.ensure 失败通道；attempt 层只消费这一种具名 ADT。 */
export class AgentEnsureError extends Data.TaggedError("AgentEnsureError")<{
  readonly reason: AgentEnsureFailureReason;
  readonly phase: "probe" | "installer" | "install" | "recheck";
  readonly identity: AgentIdentity;
  readonly message: string;
}> {}

export class SandboxTargetVerificationError extends Data.TaggedError("SandboxTargetVerificationError")<{
  readonly planned: AgentArtifactPlatform;
  readonly actual: AgentArtifactPlatform | { readonly _tag: "Unreadable"; readonly detail: string };
  readonly message: string;
}> {}

/** Sandbox create 后的单一平台核验；planning 决定目标，本函数不得反向改写计划。 */
export function verifySandboxTargetPlatform(
  sandbox: SandboxOperations,
  planned: AgentArtifactPlatform,
): Effect.Effect<AgentArtifactPlatform, SandboxTargetVerificationError> {
  return Effect.tryPromise({
    try: () => detectSandboxPlatform(sandbox),
    catch: (cause) => new SandboxTargetVerificationError({
      planned,
      actual: { _tag: "Unreadable", detail: errorMessage(cause) },
      message: `Cannot verify Sandbox platform against planned target ${platformKey(planned)}: ${errorMessage(cause)}`,
    }),
  }).pipe(Effect.flatMap((actual) =>
    platformKey(actual) === platformKey(planned)
      ? Effect.succeed(actual)
      : Effect.fail(new SandboxTargetVerificationError({
          planned,
          actual,
          message: `Sandbox platform ${platformKey(actual)} does not match planned target ${platformKey(planned)}.`,
        }))
  ));
}

const AgentStagedArtifactShape = Schema.Struct({
  platform: Schema.Union(
    Schema.Struct({
      _tag: Schema.Literal("Linux"),
      os: Schema.Literal("linux"),
      arch: Schema.NonEmptyTrimmedString,
      libc: Schema.Literal("gnu", "musl"),
    }),
    Schema.Struct({
      _tag: Schema.Literal("Darwin"),
      os: Schema.Literal("darwin"),
      arch: Schema.NonEmptyTrimmedString,
    }),
    Schema.Struct({
      _tag: Schema.Literal("Windows"),
      os: Schema.Literal("windows"),
      arch: Schema.NonEmptyTrimmedString,
    }),
  ),
  content: Schema.Unknown,
  targetPath: Schema.NonEmptyTrimmedString,
  install: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("npm-tarball") }),
    Schema.Struct({ kind: Schema.Literal("self-contained"), binPath: Schema.NonEmptyTrimmedString }),
  ),
});

function decodePreparedArtifact(
  value: unknown,
  identity: AgentIdentity,
  targetPlatform: AgentArtifactPlatform,
): Effect.Effect<AgentStagedArtifact, AgentEnsureError> {
  return Schema.decodeUnknown(AgentStagedArtifactShape)(value).pipe(
    Effect.mapError((cause) => new AgentEnsureError({
      reason: "artifact-invalid",
      phase: "installer",
      identity,
      message: String(cause),
    })),
    Effect.flatMap((decoded) => {
      if (!isRegisteredSandboxContent(decoded.content) || decoded.content.kind !== "file") {
        return Effect.fail(new AgentEnsureError({
          reason: "artifact-invalid",
          phase: "installer",
          identity,
          message: t("agent.ensure.artifactMissingDigest", { agent: identity.agent }),
        }));
      }
      if (platformKey(decoded.platform) !== platformKey(targetPlatform)) {
        return Effect.fail(new AgentEnsureError({
          reason: "artifact-invalid",
          phase: "installer",
          identity,
          message: `Prepared artifact platform ${platformKey(decoded.platform)} does not match requested platform ${platformKey(targetPlatform)}.`,
        }));
      }
      return Effect.succeed({
        platform: decoded.platform,
        content: decoded.content,
        targetPath: decoded.targetPath,
        install: decoded.install,
      });
    }),
  );
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
  artifact?: Pick<AgentStagedArtifact, "content" | "platform">,
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
          artifactDigest: artifact.content.digest,
          artifactPlatform: platformKey(artifact.platform),
        }
      : {}),
  };
}

export function platformKey(platform: AgentArtifactPlatform): string {
  return platform.os === "linux" && platform.libc !== undefined
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
export async function detectSandboxPlatform(sandbox: SandboxOperations): Promise<AgentArtifactPlatform> {
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
  const os = unameS.toLowerCase();
  const arch =
    unameM === "x86_64" || unameM === "amd64"
      ? "x64"
      : unameM === "aarch64" || unameM === "arm64"
        ? "arm64"
        : unameM;
  if (!os || !arch) {
    throw new Error(t("agent.ensure.platformDetectFailed", { tail: probe.stdout.trim().slice(0, 200) }));
  }
  if (os === "linux") return { _tag: "Linux", os: "linux", arch, libc: /musl/i.test(ldd) ? "musl" : "gnu" };
  if (os === "darwin") return { _tag: "Darwin", os: "darwin", arch };
  if (os === "windows" || os.startsWith("mingw") || os.startsWith("msys")) {
    return { _tag: "Windows", os: "windows", arch };
  }
  throw new Error(t("agent.ensure.platformDetectFailed", { tail: probe.stdout.trim().slice(0, 200) }));
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
  private readonly inflight = new Map<string, Promise<Exit.Exit<AgentStagedArtifact, AgentEnsureError>>>();
  private readonly timing: ArtifactPrepareTimingHook | undefined;

  constructor(timing?: ArtifactPrepareTimingHook) {
    this.timing = timing;
  }

  /** 已缓存或正在准备的制品;没有则 undefined。 */
  peek(identity: AgentIdentity, platform: AgentArtifactPlatform): AgentStagedArtifact | undefined {
    return this.cache.get(artifactCacheKey(identity, platform));
  }

  prepare(
    installer: Extract<AgentInstaller, { installMode: "staged" }>,
    platform: AgentArtifactPlatform,
    signal: AbortSignal,
  ): Effect.Effect<AgentStagedArtifact, AgentEnsureError> {
    const key = artifactCacheKey(installer.identity, platform);
    const hit = this.cache.get(key);
    if (hit) return Effect.succeed(hit);

    const pending = this.inflight.get(key);
    if (pending) {
      return Effect.promise(() => pending).pipe(
        Effect.flatMap(Exit.match({ onFailure: Effect.failCause, onSuccess: Effect.succeed })),
      );
    }

    const retain = (artifact: AgentStagedArtifact): Effect.Effect<AgentStagedArtifact> => {
      this.cache.set(key, artifact);
      return Effect.succeed(artifact);
    };
    const prepare = Effect.tryPromise({
      try: () => Promise.resolve(installer.prepareArtifact({ targetPlatform: platform, signal })),
      catch: (cause) => new AgentEnsureError({
        reason: "artifact-prepare-failed",
        phase: "installer",
        identity: installer.identity,
        message: formatEnsureError({
          identity: installer.identity,
          phase: "installer",
          result: { detail: errorMessage(cause) },
        }),
      }),
    }).pipe(
      Effect.flatMap((artifact) => decodePreparedArtifact(artifact, installer.identity, platform)),
      Effect.flatMap(retain),
    );
    const measured = this.timing
      ? Effect.tryPromise({
          try: () => this.timing!.activity(
            AGENT_ARTIFACT_PREPARE_ACTIVITY,
            { identity: installer.identity, platform, cacheKey: key },
            () => Effect.runPromise(prepare),
          ),
          catch: (cause) =>
            cause instanceof AgentEnsureError
              ? cause
              : new AgentEnsureError({
                  reason: "artifact-prepare-failed",
                  phase: "installer",
                  identity: installer.identity,
                  message: formatEnsureError({
                    identity: installer.identity,
                    phase: "installer",
                    result: { detail: errorMessage(cause) },
                  }),
                }),
        })
      : prepare;
    const promise = Effect.runPromiseExit(measured).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, promise);
    return Effect.promise(() => promise).pipe(
      Effect.flatMap(Exit.match({ onFailure: Effect.failCause, onSuccess: Effect.succeed })),
    );
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
        : opts.phase === "installer"
          ? t("agent.ensure.nextInstallerMissing")
          : t("agent.ensure.nextRecheck"),
  });
}

/**
 * Runner 唯一调用的 Ensure 循环。Adapter 只声明 probe，不能在 setup 内自行绕过。
 * 不改题面网络、不按 template 名短路、三种模式失败后不静默降级。
 */
export function runAgentEnsure(
  ensures: readonly AgentEnsure[],
  installers: readonly AgentInstaller[],
  sandbox: SandboxOperations,
  context: AgentEnsureContext,
): Effect.Effect<readonly AgentEnsureResult[], AgentEnsureError> {
  const target = createSandboxCommandTarget(sandbox);
  return Effect.gen(function* () {
    const results: AgentEnsureResult[] = [];
    for (const ensure of ensures) {
      yield* Effect.try({
        try: () => assertStableAgentIdentity(ensure.identity),
        catch: (cause) => new AgentEnsureError({
          reason: "probe-failed",
          phase: "probe",
          identity: ensure.identity,
          message: errorMessage(cause),
        }),
      });
      const hit = yield* probeMatches(ensure, target, context, "probe");
      if (hit) {
        reportFacts(context.fact, "hit");
        results.push({ outcome: "hit", identity: ensure.identity });
        continue;
      }
      const installer = installers.find((candidate) => sameIdentity(candidate.identity, ensure.identity));
      if (installer === undefined) {
        return yield* new AgentEnsureError({
          reason: "installer-missing",
          phase: "installer",
          identity: ensure.identity,
          message: formatEnsureError({ identity: ensure.identity, phase: "installer" }),
        });
      }
      if (installer.installMode === "verify-only") {
        return yield* new AgentEnsureError({
          reason: "verify-only",
          phase: "installer",
          identity: ensure.identity,
          message: formatEnsureError({ identity: ensure.identity, phase: "verify-only" }),
        });
      }
      const platform = context.targetPlatform;
      if (installer.platforms !== undefined && !installer.platforms.includes(platformKey(platform))) {
        return yield* new AgentEnsureError({
          reason: "platform-unsupported",
          phase: "installer",
          identity: ensure.identity,
          message: `Agent installer for ${ensure.identity.agent}@${ensure.identity.version} does not support ${platformKey(platform)}.`,
        });
      }
      if (installer.installMode === "staged") {
        const coordinator = yield* Option.match(context.coordinator, {
          onNone: () => Effect.fail(new AgentEnsureError({
            reason: "coordinator-missing",
            phase: "installer",
            identity: ensure.identity,
            message: `Run-level ArtifactPrepareCoordinator is required for ${ensure.identity.agent}.`,
          })),
          onSome: Effect.succeed,
        });
        const artifact = yield* coordinator.prepare(installer, platform, context.signal);
        yield* runInstaller(
          installer,
          () => installer.install(target, {
            identity: ensure.identity,
            targetPlatform: platform,
            artifact,
            signal: context.signal,
            progress: context.progress,
          }),
        );
        if (!(yield* probeMatches(ensure, target, context, "recheck"))) {
          return yield* recheckMissed(ensure.identity);
        }
        results.push({
          outcome: "installed",
          identity: ensure.identity,
          installMode: "staged",
          targetPlatform: platform,
          artifact,
        });
      } else {
        yield* runInstaller(
          installer,
          () => installer.install(target, {
            identity: ensure.identity,
            targetPlatform: platform,
            signal: context.signal,
            progress: context.progress,
          }),
        );
        if (!(yield* probeMatches(ensure, target, context, "recheck"))) {
          return yield* recheckMissed(ensure.identity);
        }
        results.push({
          outcome: "installed",
          identity: ensure.identity,
          installMode: "sandbox-network",
          targetPlatform: platform,
        });
      }
      reportFacts(context.fact, "installed");
    }
    return results;
  });
}

function reportFacts(
  fact: AgentEnsureContext["fact"],
  outcome: AgentEnsureOutcome,
  actualVersion?: string,
): void {
  fact(AGENT_ENSURE_FACT, outcome);
  if (actualVersion !== undefined) fact(AGENT_VERSION_ACTUAL_FACT, actualVersion);
}

function sameIdentity(a: AgentIdentity, b: AgentIdentity): boolean {
  return a.agent === b.agent && a.version === b.version && a.revision === b.revision;
}

function probeMatches(
  ensure: AgentEnsure,
  sandbox: SandboxCommandTarget,
  context: AgentEnsureContext,
  phase: "probe" | "recheck",
): Effect.Effect<boolean, AgentEnsureError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(ensure.probe(sandbox, {
      phase: "prepare",
      owner: { kind: "experiment", id: `agent.ensure/${ensure.identity.agent}` },
      attempt: { id: "agent.ensure", index: 0 },
      signal: context.signal,
      progress: context.progress,
      diagnostic: () => {},
      facts: () => {},
      onCleanup: () => {},
    } satisfies SandboxCommandContext)).then(() => true),
    catch: (cause) => cause,
  }).pipe(
    Effect.catchAll((cause) => cause instanceof SandboxCommandExitError
      ? Effect.succeed(false)
      : Effect.fail(new AgentEnsureError({
          reason: "probe-failed",
          phase,
          identity: ensure.identity,
          message: `${formatEnsureError({ identity: ensure.identity, phase })}: ${errorMessage(cause)}`,
        }))),
  );
}

function runInstaller(
  installer: Exclude<AgentInstaller, { installMode: "verify-only" }>,
  install: () => void | Promise<void>,
): Effect.Effect<void, AgentEnsureError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(install()),
    catch: (cause) => new AgentEnsureError({
      reason: "install-failed",
      phase: "install",
      identity: installer.identity,
      message: formatEnsureError({
        identity: installer.identity,
        phase: "recheck",
        result: { detail: errorMessage(cause) },
      }),
    }),
  });
}

function recheckMissed(identity: AgentIdentity): AgentEnsureError {
  return new AgentEnsureError({
    reason: "recheck-missed",
    phase: "recheck",
    identity,
    message: formatEnsureError({ identity, phase: "recheck" }),
  });
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
