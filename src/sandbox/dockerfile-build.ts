// 单 Dockerfile case 的 Run 级按需构建：Docker 产出内容寻址 image tag，E2B 产出
// 内容寻址 template alias。构建只发生在 build coordinator；attempt 只消费 locator。
// 契约单源：docs/feature/sandbox/case.md「按需构建单 Sandbox」「Run 级构建协调」。

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { Template } from "e2b";
import type { SandboxBuildExecutionContext, SandboxBuildProvider, SandboxBuildWork } from "./build-coordinator.ts";
import { detectDockerBuildPlatform, normalizeBuildPlatform } from "./compose.ts";
import { computeCaseKey, type BuildKey, type CaseKey } from "./identity.ts";
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
}

export interface DockerfileBuildCollection {
  readonly buildKey: BuildKey;
  readonly caseKey: CaseKey;
  readonly work: SandboxBuildWork;
  readonly details: DockerfileBuildDetails;
  readonly providerIdentityMarker?: import("../shared/types.ts").JsonValue;
}

/** ProviderModule 的 typed Dockerfile 收集入口；不从作者输入逆向重建计划。 */
export async function collectDockerfileBuildFromIdentity(input: {
  readonly provider: "docker" | "e2b";
  readonly profile: string;
  readonly context: SandboxLocation;
  readonly dockerfile: string;
  readonly buildArgs: Readonly<Record<string, string>>;
  readonly platform: string;
  readonly expected: DockerfileBuildIdentity;
}): Promise<DockerfileBuildCollection> {
  const context = input.context._tag === "Url" ? new URL(input.context.value) : input.context.value;
  const identity = await resolveDockerfileBuildIdentity({
    provider: input.provider,
    context,
    dockerfile: input.dockerfile,
    buildArgs: input.buildArgs,
    platform: input.platform,
    label: `sandbox profile ${input.profile}`,
  });
  if (identity.buildKey !== input.expected.buildKey) {
    throw new Error("Dockerfile build inputs changed after physical planning. Restart the Run to plan the new inputs.");
  }
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
    platform: input.platform,
  };
  return Object.freeze({
    buildKey: identity.buildKey,
    caseKey,
    details,
    ...(identity.providerIdentityMarker === undefined ? {} : { providerIdentityMarker: identity.providerIdentityMarker }),
    work: Object.freeze({
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
}

interface DockerfileProviderHooks {
  readonly dockerImageExists?: (tag: string) => Promise<boolean>;
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
        return (await imageExists(tag)) ? tag : undefined;
      }
      const name = e2bBuildName(work.buildKey);
      return (await templateExists(name, signal)) ? name : undefined;
    },
    async build(work, ctx) {
      const detail = detailFor(work);
      if (detail.provider === "docker") {
        const tag = dockerBuildTag(work.buildKey);
        await runDockerBuild(detail, tag, ctx);
        return tag;
      }
      const name = e2bBuildName(work.buildKey);
      await buildE2BTemplate(detail, name, ctx);
      return name;
    },
  };
}

export function routeBuildProviders(
  routes: ReadonlyMap<BuildKey, SandboxBuildProvider>,
): SandboxBuildProvider {
  const providerFor = (work: SandboxBuildWork): SandboxBuildProvider => {
    const provider = routes.get(work.buildKey);
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

async function defaultDockerImageExists(tag: string): Promise<boolean> {
  return await commandSucceeded("docker", ["image", "inspect", tag]);
}

async function defaultRunDockerBuild(
  details: DockerfileBuildDetails,
  tag: string,
  ctx: SandboxBuildExecutionContext,
): Promise<void> {
  const args = [
    "build",
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
  await runCommand("docker", args, ctx.signal);
}

async function defaultE2BTemplateExists(name: string, signal: AbortSignal): Promise<boolean> {
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
    await runCommand(command, args, new AbortController().signal);
    return true;
  } catch {
    return false;
  }
}

function runCommand(command: string, args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], signal });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} failed (${code ?? "signal"}): ${stderr.trim()}`));
    });
  });
}
