// 单 Dockerfile case 的 Run 级按需构建：Docker 产出内容寻址 image tag，E2B 产出
// 内容寻址 template alias。构建只发生在 build coordinator；attempt 只消费 locator。
// 契约单源：docs/feature/sandbox/case.md「按需构建单 Sandbox」「Run 级构建协调」。

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { Data, Effect } from "effect";
import {
  materializationScopeId,
  sandboxBuildRef,
  type SandboxBuildArtifactSource,
  type SandboxBuildExecutionContext,
  type SandboxBuildProvider,
  type SandboxBuildWork,
} from "./build-coordinator.ts";
import { detectDockerBuildPlatform, normalizeBuildPlatform } from "./compose.ts";
import { computeCaseKey, type BuildKey, type CaseKey } from "./identity.ts";
import { dockerTaskBuildAuthorityFingerprint, makeTaskBuildCacheService } from "./docker-task-build-cache.ts";
import {
  DOCKERFILE_MATERIALIZER_REVISION,
  resolveDockerfileBuildIdentity,
  type DockerfileBuildIdentity,
} from "./dockerfile-identity.ts";
import type { SandboxLocation } from "./layer.ts";

export { DOCKERFILE_MATERIALIZER_REVISION } from "./dockerfile-identity.ts";

interface DockerfileBuildDetails {
  readonly provider: "docker" | "e2b";
  readonly contextDir: string;
  readonly dockerfilePath: string;
  readonly dockerfile: string;
  readonly buildArgs?: Readonly<globalThis.Record<string, string>>;
  readonly target?: string;
  readonly platform: string;
  readonly dockerSocketPath?: string;
  /** managed profile 在 daemon bridge=none 时为本次 build 创建的独占 bridge。 */
  readonly dockerNetworkMode?: string;
}

export interface DockerfileBuildCollection {
  readonly buildKey: BuildKey;
  readonly caseKey: CaseKey;
  readonly work: SandboxBuildWork;
  readonly details: DockerfileBuildDetails;
  readonly providerIdentityMarker?: import("../shared/types.ts").JsonValue;
}

export class DockerfileBuildCollectionError extends Data.TaggedError("DockerfileBuildCollectionError")<{
  readonly message: string;
}> {}

/** ProviderModule 的 typed Dockerfile 收集入口；不从作者输入逆向重建计划。 */
export function collectDockerfileBuildFromIdentity(input: {
  readonly provider: "docker" | "e2b";
  readonly profile: string;
  readonly context: SandboxLocation;
  readonly dockerfile: string;
  readonly buildArgs: Readonly<Record<string, string>>;
  readonly target?: string;
  readonly platform: string;
  readonly expected: DockerfileBuildIdentity;
  readonly dockerSocketPath?: string;
}): Effect.Effect<DockerfileBuildCollection, DockerfileBuildCollectionError> {
  return Effect.gen(function* () {
    const context = input.context._tag === "Url" ? new URL(input.context.value) : input.context.value;
    const identity = yield* resolveDockerfileBuildIdentity({
      provider: input.provider,
      context,
      dockerfile: input.dockerfile,
      buildArgs: input.buildArgs,
      ...(input.target === undefined ? {} : { target: input.target }),
      platform: input.platform,
      label: `sandbox profile ${input.profile}`,
    }).pipe(Effect.mapError((cause) => new DockerfileBuildCollectionError({ message: cause.message })));
    if (identity.buildKey !== input.expected.buildKey) {
      return yield* Effect.fail(new DockerfileBuildCollectionError({
        message: "Dockerfile build inputs changed after physical planning. Restart the Run to plan the new inputs.",
      }));
    }
    const authorityFingerprint = input.provider === "docker" && input.dockerSocketPath === undefined
      ? yield* Effect.tryPromise({
          try: () => dockerTaskBuildAuthorityFingerprint(),
          catch: (cause) => new DockerfileBuildCollectionError({ message: cause instanceof Error ? cause.message : String(cause) }),
        })
      : JSON.stringify(identity.providerIdentityMarker ?? [input.provider, input.dockerSocketPath ?? "default"]);
    return yield* Effect.try({
      try: () => {
        const caseKey = computeCaseKey({
          caseKind: "on-demand-build",
          materializerRevision: DOCKERFILE_MATERIALIZER_REVISION,
          buildKeys: [identity.buildKey],
          caseParams: { provider: input.provider, profile: input.profile, buildKey: identity.buildKey },
        });
        const details: DockerfileBuildDetails = {
          provider: input.provider,
          contextDir: identity.contextDir,
          dockerfilePath: identity.dockerfilePath,
          dockerfile: identity.dockerfile,
          buildArgs: input.buildArgs,
          ...(input.target === undefined ? {} : { target: input.target }),
          platform: input.platform,
          ...(input.dockerSocketPath === undefined ? {} : { dockerSocketPath: input.dockerSocketPath }),
        };
        const scopeId = materializationScopeId({
          providerFamily: input.provider,
          authorityFingerprint,
          materializationProtocolVersion: 1,
        });
        return Object.freeze({
          buildKey: identity.buildKey,
          caseKey,
          details,
          ...(identity.providerIdentityMarker === undefined ? {} : { providerIdentityMarker: identity.providerIdentityMarker }),
          work: Object.freeze({
            ref: sandboxBuildRef(scopeId, identity.buildKey),
            scopeId,
            buildKey: identity.buildKey,
            provider: input.provider,
            label: `${input.provider}:dockerfile:${input.profile}`,
            inputs: Object.freeze({
              kind: "dockerfile",
              profile: input.profile,
              platform: input.platform,
              context: identity.contextDir,
              dockerfile: identity.dockerfilePath,
              contextFilterRules: identity.contextFilterRules,
              args: input.buildArgs,
            }),
          }),
        });
      },
      catch: (cause) => new DockerfileBuildCollectionError({
        message: cause instanceof Error ? cause.message : String(cause),
      }),
    });
  });
}

interface DockerfileProviderHooks {
  readonly dockerImageExists?: (tag: string, dockerSocketPath?: string) => Promise<boolean>;
  readonly runDockerBuild?: (
    details: DockerfileBuildDetails,
    tag: string,
    ctx: SandboxBuildExecutionContext,
  ) => Promise<void>;
  readonly e2bTemplateExists?: (name: string, signal: AbortSignal) => Promise<boolean>;
  readonly buildE2BTemplate?: (
    details: DockerfileBuildDetails,
    name: string,
    ctx: SandboxBuildExecutionContext,
  ) => Promise<void>;
}

/** collection 同批创建 provider，避免从公开 JsonValue provenance 反解本地绝对路径。 */
export function dockerfileBuildProvider(
  collections: readonly DockerfileBuildCollection[],
  hooks: DockerfileProviderHooks = {},
): SandboxBuildProvider {
  const details = new Map(collections.map((collection) => [collection.buildKey, collection.details]));
  const imageExists = hooks.dockerImageExists ?? defaultDockerImageExists;
  const runDockerBuild = hooks.runDockerBuild ?? defaultRunDockerBuild;
  const templateExists = hooks.e2bTemplateExists ?? defaultE2BTemplateExists;
  const buildE2BTemplate = hooks.buildE2BTemplate ?? defaultBuildE2BTemplate;
  const managedDockerCache = hooks.dockerImageExists === undefined && hooks.runDockerBuild === undefined &&
    collections.every((collection) => collection.details.dockerSocketPath === undefined)
    ? makeTaskBuildCacheService()
    : undefined;

  const source = (
    work: SandboxBuildWork,
    locator: string,
    origin: "cache" | "build",
    detail: DockerfileBuildDetails,
  ): SandboxBuildArtifactSource => ({
    locator,
    source: origin,
    acquireUse: async () => {
      const lease = detail.provider === "docker" && managedDockerCache !== undefined
        ? await managedDockerCache.acquireUse(work.buildKey, locator, buildManifestDigest(work), detail.dockerSocketPath)
        : { release() {} };
      return { locator, release: () => lease.release() };
    },
    release() {},
  });

  const detailFor = (work: SandboxBuildWork): DockerfileBuildDetails => {
    const detail = details.get(work.buildKey);
    if (detail === undefined) {
      throw new Error(`unknown Dockerfile BuildKey ${work.buildKey.slice(0, 12)}…`);
    }
    return detail;
  };

  return {
    async lookup(work, signal) {
      const detail = detailFor(work);
      if (detail.provider === "docker") {
        const tag = dockerBuildTag(work.buildKey);
        if (managedDockerCache !== undefined) {
          return await managedDockerCache.lookup(work.buildKey, tag, buildManifestDigest(work), detail.dockerSocketPath)
            ? { _tag: "Hit", source: source(work, tag, "cache", detail) }
            : { _tag: "Miss" };
        }
        return (await imageExists(tag, detail.dockerSocketPath))
          ? { _tag: "Hit", source: source(work, tag, "cache", detail) }
          : { _tag: "Miss" };
      }
      const name = e2bBuildName(work.buildKey);
      return (await templateExists(name, signal))
        ? { _tag: "Hit", source: source(work, name, "cache", detail) }
        : { _tag: "Miss" };
    },
    async build(work, ctx) {
      const detail = detailFor(work);
      if (detail.provider === "docker") {
        const tag = dockerBuildTag(work.buildKey);
        await runDockerBuild(detail, tag, ctx);
        await managedDockerCache?.publish(work.buildKey, tag, buildManifestDigest(work), ctx.operationId, detail.dockerSocketPath);
        return source(work, tag, "build", detail);
      }
      const name = e2bBuildName(work.buildKey);
      await buildE2BTemplate(detail, name, ctx);
      return source(work, name, "build", detail);
    },
  };
}

function buildManifestDigest(work: SandboxBuildWork): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: 1,
    scopeId: work.scopeId,
    buildKey: work.buildKey,
    provider: work.provider,
    inputs: work.inputs,
  })).digest("hex");
}

export function routeBuildProviders(
  routes: ReadonlyMap<import("./build-coordinator.ts").SandboxBuildRef, SandboxBuildProvider>,
): SandboxBuildProvider {
  const providerFor = (work: SandboxBuildWork): SandboxBuildProvider => {
    const provider = routes.get(work.ref);
    if (provider === undefined) throw new Error(`no sandbox build provider for BuildKey ${work.buildKey.slice(0, 12)}…`);
    return provider;
  };
  return {
    lookup: (work, signal) => providerFor(work).lookup(work, signal),
    build: (work, ctx) => providerFor(work).build(work, ctx),
    async cancel(work) {
      await providerFor(work).cancel?.(work);
    },
  };
}

function dockerBuildTag(buildKey: BuildKey): string {
  return `niceeval-build:${buildKey.slice(0, 32)}`;
}

function e2bBuildName(buildKey: BuildKey): string {
  return `niceeval-build-${buildKey.slice(0, 40)}`;
}

async function defaultDockerImageExists(tag: string, dockerSocketPath?: string): Promise<boolean> {
  return await commandSucceeded("docker", [
    ...(dockerSocketPath === undefined ? [] : ["--host", `unix://${dockerSocketPath}`]),
    "image", "inspect", tag,
  ]);
}

async function defaultRunDockerBuild(
  details: DockerfileBuildDetails,
  tag: string,
  ctx: SandboxBuildExecutionContext,
): Promise<void> {
  const connection = details.dockerSocketPath === undefined ? [] : ["--host", `unix://${details.dockerSocketPath}`];
  const buildArgs = [
    "--platform",
    details.platform,
    "--file",
    details.dockerfilePath,
    "--tag",
    tag,
    ...Object.entries(details.buildArgs ?? {}).flatMap(([key, value]) => ["--build-arg", `${key}=${value}`]),
    ...(details.target !== undefined ? ["--target", details.target] : []),
    details.contextDir,
  ];
  if (details.dockerNetworkMode === undefined) {
    await runBuildCommand("docker", [...connection, "build", ...buildArgs], ctx.signal);
    return;
  }

  // managed daemon 关闭默认 bridge。现代 BuildKit 不接受任意 network ID 作为
  // `docker build --network`，所以为 reservation 建短生命周期 docker-container builder，
  // 把 builder 自身绑定到 watchdog 所有的独占网络，并将结果显式 load 回 profile daemon。
  const builderName = `niceeval-${details.dockerNetworkMode.slice(0, 24)}`;
  await runBuildCommand("docker", [
    ...connection,
    "buildx", "create",
    "--driver", "docker-container",
    "--driver-opt", `network=${details.dockerNetworkMode}`,
    "--name", builderName,
  ], ctx.signal);
  try {
    await runBuildCommand("docker", [
      ...connection,
      "buildx", "build",
      "--builder", builderName,
      "--load",
      ...buildArgs,
    ], ctx.signal);
  } finally {
    await runBuildCommand("docker", [
      ...connection,
      "buildx", "rm", "--force", builderName,
    ], new AbortController().signal).catch(() => undefined);
  }
}

async function defaultE2BTemplateExists(name: string, signal: AbortSignal): Promise<boolean> {
  // e2b 是 optional peer；仅 E2B Dockerfile 构建路径加载。
  const { Template } = await import("e2b");
  return await Template.exists(name, { signal });
}

async function defaultBuildE2BTemplate(
  details: DockerfileBuildDetails,
  name: string,
  ctx: SandboxBuildExecutionContext,
): Promise<void> {
  if (details.buildArgs !== undefined && Object.keys(details.buildArgs).length > 0) {
    throw new Error("E2B Dockerfile builds do not support build args; bake stable values into the Dockerfile");
  }
  if (details.target !== undefined) {
    throw new Error("E2B Dockerfile builds do not support a target stage; make the desired stage the final stage");
  }
  // e2b 是 optional peer；仅 E2B Dockerfile 构建路径加载。
  const { Template } = await import("e2b");
  const ignore = await dockerIgnorePatterns(details.contextDir);
  const template = Template({
    fileContextPath: details.contextDir,
    ...(ignore.length > 0 ? { fileIgnorePatterns: ignore } : {}),
  }).fromDockerfile(details.dockerfile);
  await Template.build(template, name, { signal: ctx.signal });
}

async function dockerIgnorePatterns(contextDir: string): Promise<string[]> {
  const raw = await readFile(resolvePath(contextDir, ".dockerignore"), "utf8").catch(() => "");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function commandSucceeded(command: string, args: readonly string[]): Promise<boolean> {
  try {
    await runBuildCommand(command, args, new AbortController().signal);
    return true;
  } catch {
    return false;
  }
}

const BUILD_STDERR_LIMIT = 64 * 1024;

/**
 * 运行会持续输出进度的 builder CLI。stdout 必须主动 drain：若只创建 pipe 却无人读取，
 * Docker/BuildKit 写满 OS pipe buffer 后会永久阻塞，看起来像一个无 CPU 的超长构建。
 * stderr 只保留尾部用于失败诊断，避免长构建把进度输出无限堆进内存。
 */
export function runBuildCommand(command: string, args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal });
    let stderr = "";
    child.stdout?.resume();
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > BUILD_STDERR_LIMIT) stderr = stderr.slice(-BUILD_STDERR_LIMIT);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${code ?? "signal"}): ${stderr.trim()}`));
    });
  });
}
