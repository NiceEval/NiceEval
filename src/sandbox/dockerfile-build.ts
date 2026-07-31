// 单 Dockerfile case 的 Run 级按需构建：Docker 产出内容寻址 image tag，E2B 产出
// 内容寻址 template alias。构建只发生在 build coordinator；attempt 只消费 locator。
// 契约单源：docs/feature/sandbox/case.md「按需构建单 Sandbox」「Run 级构建协调」。

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isAbsolute, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { Template } from "e2b";
import { buildContextIdentityContribution, type BuildContextSpec } from "../runner/leak-gate.ts";
import type { SandboxBuildExecutionContext, SandboxBuildProvider, SandboxBuildWork } from "./build-coordinator.ts";
import type { DockerBuildDecl } from "./case-types.ts";
import type { PlannedSandboxCase } from "./case.ts";
import { detectDockerBuildPlatform, normalizeBuildPlatform } from "./compose.ts";
import { computeBuildKey, computeCaseKey, type BuildKey, type CaseKey } from "./identity.ts";

export const DOCKERFILE_MATERIALIZER_REVISION = "dockerfile-1";

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
  /** FROM 已解析为 digest 才允许跨 Invocation 携带。 */
  readonly carryEligible: boolean;
}

/** 从 environments[profile].build 抽出一条单 Dockerfile 构建工作。 */
export async function collectDockerfileBuildFromPlan(
  plan: PlannedSandboxCase,
  opts?: {
    readonly baseDir?: string;
    readonly dockerPlatform?: string;
    readonly dockerPlatformProbe?: () => Promise<string | undefined>;
  },
): Promise<DockerfileBuildCollection | undefined> {
  const declaration = buildDeclaration(plan);
  if (declaration === undefined) return undefined;

  const baseDir = opts?.baseDir ?? process.cwd();
  const contextDir = isAbsolute(declaration.build.context)
    ? declaration.build.context
    : resolvePath(baseDir, declaration.build.context);
  const dockerfilePath = resolvePath(contextDir, declaration.build.dockerfile ?? "Dockerfile");
  const dockerfile = await readFile(dockerfilePath, "utf8").catch(() => {
    throw new Error(`Dockerfile for profile ${JSON.stringify(plan.profile)} not found at ${dockerfilePath}`);
  });
  const contextSpec: BuildContextSpec = {
    contextDir,
    label: `sandbox profile ${plan.profile}`,
  };
  const { contextDigest, contextFilterRules } = await buildContextIdentityContribution(contextSpec);
  const from = firstFromReference(dockerfile);
  const resolvedFromDigest = digestFromReference(from);
  const fromDigest = resolvedFromDigest ?? `unresolved:${from ?? "missing"}`;
  const platform =
    declaration.provider === "e2b"
      ? "linux/amd64"
      : opts?.dockerPlatform !== undefined
        ? normalizeBuildPlatform(opts.dockerPlatform)
        : await detectDockerBuildPlatform(
            opts?.dockerPlatformProbe !== undefined ? { probe: opts.dockerPlatformProbe } : undefined,
          );
  const buildKey = computeBuildKey({
    builderKind: `${declaration.provider}-dockerfile`,
    builderRevision: DOCKERFILE_MATERIALIZER_REVISION,
    platform,
    dockerfile,
    contextDigest,
    fromDigest,
    contextFilterRules,
    ...(declaration.build.args !== undefined ? { buildArgs: declaration.build.args } : {}),
    ...(declaration.build.target !== undefined ? { target: declaration.build.target } : {}),
  });
  const caseKey = caseKeyForDockerfileBuild(plan, buildKey);
  const details: DockerfileBuildDetails = {
    provider: declaration.provider,
    contextDir,
    dockerfilePath,
    dockerfile,
    platform,
    ...(declaration.build.args !== undefined ? { buildArgs: declaration.build.args } : {}),
    ...(declaration.build.target !== undefined ? { target: declaration.build.target } : {}),
  };
  return {
    buildKey,
    caseKey,
    details,
    carryEligible: resolvedFromDigest !== undefined,
    work: {
      buildKey,
      provider: declaration.provider,
      label: `${declaration.provider}:dockerfile:${plan.profile}`,
      inputs: {
        kind: "dockerfile",
        profile: plan.profile,
        platform,
        context: contextDir,
        dockerfile: dockerfilePath,
        contextFilterRules,
        ...(declaration.build.args !== undefined ? { args: declaration.build.args } : {}),
        ...(declaration.build.target !== undefined ? { target: declaration.build.target } : {}),
      },
    },
  };
}

/** 收集期与 attempt 物化期共用，保证 result.json 的 CaseKey 与携带规划看到的是同一个。 */
export function caseKeyForDockerfileBuild(plan: PlannedSandboxCase, buildKey: BuildKey): CaseKey {
  const provider =
    plan.declaration.form === "docker" || plan.declaration.form === "e2b"
      ? plan.declaration.form
      : plan.declaration.form === "dockerfile"
        ? plan.declaration.provider
        : "custom";
  return computeCaseKey({
    caseKind: "on-demand-build",
    materializerRevision: DOCKERFILE_MATERIALIZER_REVISION,
    buildKeys: [buildKey],
    caseParams: { provider, profile: plan.profile, buildKey },
  });
}

function buildDeclaration(
  plan: PlannedSandboxCase,
): { readonly provider: "docker" | "e2b"; readonly build: DockerBuildDecl } | undefined {
  if (plan.caseKind !== "on-demand-build") return undefined;
  if (plan.declaration.form === "docker" && plan.declaration.value.build !== undefined) {
    return { provider: "docker", build: plan.declaration.value.build };
  }
  if (plan.declaration.form === "e2b" && plan.declaration.value.build !== undefined) {
    return { provider: "e2b", build: plan.declaration.value.build };
  }
  if (plan.declaration.form === "dockerfile") {
    return {
      provider: plan.declaration.provider,
      build: {
        context:
          typeof plan.declaration.value.context === "string"
            ? plan.declaration.value.context
            : fileURLToPath(plan.declaration.value.context),
        ...(plan.declaration.value.dockerfile !== undefined
          ? { dockerfile: plan.declaration.value.dockerfile }
          : {}),
        ...(plan.declaration.value.buildArgs !== undefined
          ? { args: plan.declaration.value.buildArgs }
          : {}),
      },
    };
  }
  return undefined;
}

function firstFromReference(dockerfile: string): string | undefined {
  return dockerfile.match(/^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/im)?.[1];
}

function digestFromReference(ref: string | undefined): string | undefined {
  if (ref === undefined) return undefined;
  const index = ref.indexOf("@sha256:");
  if (index < 0) return undefined;
  const digest = ref.slice(index + 1);
  return /^sha256:[a-f0-9]{64}$/i.test(digest) ? digest : undefined;
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
