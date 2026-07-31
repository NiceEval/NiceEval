// Docker Compose case:原生 compose build/up/down、受管 overlay、黑名单、mainService 主 Sandbox、
// ServiceController、整组 finalizer、泄题门 hints 与 BuildKey 收集。
// NiceEval 不维护字段白名单解析器——未知字段原样交给 Compose;只拒绝破坏核心不变量的黑名单项。
// 契约单源:docs/feature/sandbox/case.md「Docker Compose case」。

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { JsonValue } from "../shared/types.ts";
import {
  attachLeakGateHints,
  buildContextIdentityContribution,
  type BindMountSpec,
  type BuildContextSpec,
  type LeakGateHints,
} from "../runner/leak-gate.ts";
import type { SandboxBuildExecutionContext, SandboxBuildProvider, SandboxBuildWork } from "./build-coordinator.ts";
import type {
  ComposeSandboxSource,
  DockerComposeDecl,
  MaterializedSandboxCase,
  SandboxMaterializeContext,
  SandboxMaterializer,
  SandboxResourceGroup,
  SandboxSource,
  ServiceController,
} from "./case-types.ts";
import type { PlannedSandboxCase } from "./case.ts";
import { DockerSandbox } from "./docker.ts";
import { computeBuildKey, type BuildKey } from "./identity.ts";
import { currentRunIdentity, dockerRunIdentityLabels, type RunIdentity } from "./run-identity.ts";
import type { CommandResult } from "./types.ts";
import type { ScopedFeedback } from "../types.ts";

/** materializer / BuildKey 的 builder revision;改 overlay 或黑名单语义时递增。 */
export const COMPOSE_MATERIALIZER_REVISION = "docker-compose-1";

const BUILDER_KIND = "docker-compose";

// ---------------------------------------------------------------------------
// 目标平台:构建事实(case.md「BuildKey 与 CaseKey」)
// ---------------------------------------------------------------------------

/** 构建器传平台用的环境变量;探测值与钉死值都经它进入 builder。 */
const DOCKER_PLATFORM_ENV = "DOCKER_DEFAULT_PLATFORM";

/** 归一成 `os/arch`:daemon 与 Node 各有各的写法(aarch64 / x86_64 / arm64 / x64)。 */
export function normalizeBuildPlatform(value: string): string {
  const [rawOs, rawArch] = value.trim().toLowerCase().split("/");
  const os = rawOs && rawArch ? rawOs : "linux";
  const arch = rawArch ?? rawOs ?? "";
  const normalizedArch =
    arch === "x86_64" || arch === "x64" || arch === "amd64"
      ? "amd64"
      : arch === "aarch64" || arch === "arm64"
        ? "arm64"
        : arch;
  return `${os}/${normalizedArch}`;
}

let dockerPlatformProbe: Promise<string> | undefined;

/**
 * 目标平台从构建执行环境得出:优先用户钉死的 `DOCKER_DEFAULT_PLATFORM`,
 * 其次 daemon 自报的 os/arch,都拿不到才回落到宿主架构(容器恒为 linux)。
 * 探测结果进 BuildKey,同一个值再钉给构建器,身份与事实同源。
 */
export async function detectDockerBuildPlatform(opts?: {
  readonly env?: NodeJS.ProcessEnv;
  /** 注入探测通道(测试用);默认问本机 docker daemon。 */
  readonly probe?: () => Promise<string | undefined>;
}): Promise<string> {
  const env = opts?.env ?? process.env;
  const pinned = env[DOCKER_PLATFORM_ENV];
  if (pinned) return normalizeBuildPlatform(pinned);
  if (opts?.probe) {
    const probed = await opts.probe();
    return normalizeBuildPlatform(probed ?? hostBuildPlatform());
  }
  dockerPlatformProbe ??= probeDockerServerPlatform().then((probed) =>
    normalizeBuildPlatform(probed ?? hostBuildPlatform()),
  );
  return dockerPlatformProbe;
}

function hostBuildPlatform(): string {
  return `linux/${process.arch}`;
}

function probeDockerServerPlatform(): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    let out = "";
    child.stdout?.on("data", (c: Buffer) => {
      out += c.toString();
    });
    child.on("error", () => resolve(undefined));
    child.on("close", (code) => {
      const value = out.trim();
      resolve(code === 0 && value.includes("/") ? value : undefined);
    });
  });
}

// ---------------------------------------------------------------------------
// Compose 结构面(只为黑名单 / BuildKey / 泄题门抽取字段;不是白名单运行时)
// ---------------------------------------------------------------------------

export interface ComposeBuildDecl {
  readonly context: string;
  readonly dockerfile?: string;
  readonly args?: Readonly<globalThis.Record<string, string>>;
  readonly target?: string;
}

export interface ComposeServiceInspection {
  readonly name: string;
  readonly build?: ComposeBuildDecl;
  readonly image?: string;
  readonly networkMode?: string;
  readonly workingDir?: string;
  /** 原始 volume 条目(短语法字符串或长语法摘要)。 */
  readonly volumes: readonly string[];
}

export interface ComposeInspection {
  readonly services: readonly ComposeServiceInspection[];
  /** 受管网络名:服务实际加入的非 external 网络;没有任何服务声明网络时是 Compose 的 `default`。 */
  readonly networkNames: readonly string[];
  readonly raw: string;
}

/** 从 Compose 原文抽取 services 的黑名单 / build / volume 面。未知字段忽略。 */
export function inspectComposeYaml(raw: string): ComposeInspection {
  const doc = parseYamlMapping(raw);
  const servicesNode = doc.services;
  if (servicesNode === undefined || servicesNode === null || typeof servicesNode !== "object" || Array.isArray(servicesNode)) {
    return { services: [], networkNames: [], raw };
  }
  const services: ComposeServiceInspection[] = [];
  for (const [name, value] of Object.entries(servicesNode as globalThis.Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      services.push({ name, volumes: [] });
      continue;
    }
    const svc = value as globalThis.Record<string, unknown>;
    services.push({
      name,
      ...(parseBuild(svc.build) !== undefined ? { build: parseBuild(svc.build)! } : {}),
      ...(typeof svc.image === "string" ? { image: svc.image } : {}),
      ...(typeof svc.network_mode === "string"
        ? { networkMode: svc.network_mode }
        : typeof svc.networkMode === "string"
          ? { networkMode: svc.networkMode }
          : {}),
      ...(typeof svc.working_dir === "string"
        ? { workingDir: svc.working_dir }
        : typeof svc.workingDir === "string"
          ? { workingDir: svc.workingDir }
          : {}),
      volumes: volumeStrings(svc.volumes),
    });
  }
  return { services, networkNames: managedNetworkNames(doc, servicesNode as globalThis.Record<string, unknown>), raw };
}

/**
 * 受管网络名。Compose 给容器和网络都打 `com.docker.compose.project`,孤儿核对靠它把资源组拼回来;
 * 网络那一半要能被单独核对,必须在创建期就带上运行标识 label,而 label 只能加在这些名字上。
 * `external: true` 的网络是用户自己的资源,不改它的 label、也不进受管清单。
 */
function managedNetworkNames(
  doc: globalThis.Record<string, YamlNode>,
  servicesNode: globalThis.Record<string, unknown>,
): string[] {
  const external = new Set<string>();
  const top = doc.networks;
  if (top !== undefined && top !== null && typeof top === "object" && !Array.isArray(top)) {
    for (const [name, value] of Object.entries(top as globalThis.Record<string, unknown>)) {
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const net = value as globalThis.Record<string, unknown>;
        if (net.external === true || net.external === "true") external.add(name);
      }
    }
  }
  const used = new Set<string>();
  for (const value of Object.values(servicesNode)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const nets = (value as globalThis.Record<string, unknown>).networks;
    if (Array.isArray(nets)) {
      for (const n of nets) if (typeof n === "string") used.add(n);
    } else if (nets !== null && typeof nets === "object") {
      for (const n of Object.keys(nets as globalThis.Record<string, unknown>)) used.add(n);
    }
  }
  const managed = [...used].filter((n) => !external.has(n));
  // 没有服务显式声明网络时,Compose 建的是 project 的 default 网络。
  return managed.length > 0 ? managed : used.size > 0 ? [] : ["default"];
}

function parseBuild(value: unknown): ComposeBuildDecl | undefined {
  if (typeof value === "string") {
    return { context: value };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const b = value as globalThis.Record<string, unknown>;
  const context = typeof b.context === "string" ? b.context : ".";
  const dockerfile = typeof b.dockerfile === "string" ? b.dockerfile : undefined;
  const target = typeof b.target === "string" ? b.target : undefined;
  const args =
    b.args !== undefined && b.args !== null && typeof b.args === "object" && !Array.isArray(b.args)
      ? Object.fromEntries(
          Object.entries(b.args as globalThis.Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : undefined;
  return {
    context,
    ...(dockerfile !== undefined ? { dockerfile } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(target !== undefined ? { target } : {}),
  };
}

function volumeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string") {
      out.push(entry);
      continue;
    }
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      const v = entry as globalThis.Record<string, unknown>;
      const source = typeof v.source === "string" ? v.source : typeof v.Source === "string" ? v.Source : "";
      const target = typeof v.target === "string" ? v.target : typeof v.Target === "string" ? v.Target : "";
      const type = typeof v.type === "string" ? v.type : "";
      out.push([type, source, target].filter(Boolean).join(":"));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 黑名单:只保护核心不变量
// ---------------------------------------------------------------------------

export interface ComposeBlacklistFinding {
  readonly service: string;
  readonly field: string;
  readonly value: string;
  readonly reason: string;
}

/**
 * 黑名单检查。点名 service.field 与理由。
 * - Docker socket 挂载(任意服务)
 * - main 脱离受管 Compose 网络(`network_mode: host|none|container:*`)
 * - main 覆盖受管 workdir(仅当调用方声明了 managedWorkdir 且与 compose 冲突)
 */
export function findComposeBlacklistViolations(
  inspection: ComposeInspection,
  opts: { readonly mainService: string; readonly managedWorkdir?: string },
): ComposeBlacklistFinding[] {
  const findings: ComposeBlacklistFinding[] = [];
  for (const svc of inspection.services) {
    for (const vol of svc.volumes) {
      if (volumeTouchesDockerSock(vol)) {
        findings.push({
          service: svc.name,
          field: "volumes",
          value: vol,
          reason: "mounts the Docker socket, which escapes the sandbox boundary and breaks NiceEval isolation",
        });
      }
    }
    const isMain = svc.name === opts.mainService;
    if (isMain && svc.networkMode !== undefined && isDetachedNetworkMode(svc.networkMode)) {
      findings.push({
        service: svc.name,
        field: "network_mode",
        value: svc.networkMode,
        reason:
          "detaches the main service from the managed Compose project network; Agent and sidecars would lose shared DNS/network semantics",
      });
    }
    if (
      isMain &&
      opts.managedWorkdir !== undefined &&
      svc.workingDir !== undefined &&
      normalizePath(svc.workingDir) !== normalizePath(opts.managedWorkdir)
    ) {
      findings.push({
        service: svc.name,
        field: "working_dir",
        value: svc.workingDir,
        reason: `overrides the NiceEval-managed workdir ${JSON.stringify(opts.managedWorkdir)}`,
      });
    }
  }
  return findings;
}

export function assertComposeBlacklist(
  inspection: ComposeInspection,
  opts: { readonly mainService: string; readonly managedWorkdir?: string },
): void {
  const findings = findComposeBlacklistViolations(inspection, opts);
  if (findings.length === 0) return;
  const body = findings
    .map(
      (f, i) =>
        `  ${i + 1}. services.${f.service}.${f.field}=${JSON.stringify(f.value)}\n     ${f.reason}`,
    )
    .join("\n");
  throw new Error(
    `Compose blacklist rejected ${findings.length} field(s) that break NiceEval core invariants:\n${body}`,
  );
}

function volumeTouchesDockerSock(vol: string): boolean {
  return /docker\.sock(?:$|[:\s])/i.test(vol) || /\/var\/run\/docker\.sock/i.test(vol);
}

function isDetachedNetworkMode(mode: string): boolean {
  const m = mode.trim().toLowerCase();
  return m === "host" || m === "none" || m.startsWith("container:");
}

function normalizePath(p: string): string {
  return p.replace(/\/+$/, "") || "/";
}

// ---------------------------------------------------------------------------
// 泄题门:build contexts + 相对 bind mounts
// ---------------------------------------------------------------------------

export function leakGateHintsFromInspection(
  inspection: ComposeInspection,
  opts: { readonly composeDir: string; readonly mainService: string },
): LeakGateHints {
  const buildContexts: BuildContextSpec[] = [];
  const bindMounts: BindMountSpec[] = [];
  for (const svc of inspection.services) {
    if (svc.build !== undefined) {
      const contextDir = resolvePath(opts.composeDir, svc.build.context);
      buildContexts.push({
        contextDir,
        label: `compose service ${svc.name}`,
        ...(svc.build.dockerfile !== undefined && isAbsolute(svc.build.dockerfile)
          ? { dockerignorePath: undefined }
          : {}),
      });
    }
    for (const vol of svc.volumes) {
      const source = relativeBindSource(vol, opts.composeDir);
      if (source === undefined) continue;
      const agentReachable = svc.name === opts.mainService;
      bindMounts.push({
        source,
        phase: "any",
        agentReachable,
        label: `compose service ${svc.name} volume`,
      });
    }
  }
  return {
    buildContexts,
    ...(bindMounts.length > 0 ? { bindMounts } : {}),
  };
}

/** 读 Compose 文件并产出泄题门 hints(供 discover / prepare 挂 attachLeakGateHints)。 */
export async function leakGateHintsFromComposeFile(
  file: string | URL,
  opts: { readonly mainService: string; readonly baseDir?: string },
): Promise<{ hints: LeakGateHints; inspection: ComposeInspection; composePath: string }> {
  const composePath = resolveComposeFile(file, opts.baseDir);
  const raw = await readFile(composePath, "utf-8");
  const inspection = inspectComposeYaml(raw);
  if (!inspection.services.some((s) => s.name === opts.mainService)) {
    throw new Error(
      `Compose file ${composePath} has no service ${JSON.stringify(opts.mainService)} (mainService)`,
    );
  }
  assertComposeBlacklist(inspection, { mainService: opts.mainService });
  const hints = leakGateHintsFromInspection(inspection, {
    composeDir: dirname(composePath),
    mainService: opts.mainService,
  });
  return { hints, inspection, composePath };
}

/** 把泄题门 hints 挂到 folder-local compose source 上。 */
export async function attachComposeLeakGateHints(
  source: ComposeSandboxSource,
  opts?: { readonly baseDir?: string },
): Promise<ComposeSandboxSource> {
  const { hints } = await leakGateHintsFromComposeFile(source.file, {
    mainService: source.mainService,
    baseDir: opts?.baseDir,
  });
  return attachLeakGateHints(source, hints);
}

function relativeBindSource(vol: string, composeDir: string): string | undefined {
  // 短语法: ./foo:/app/foo[:ro] 或 foo:/bar(命名卷跳过)
  const short = vol.match(/^([^:]+):([^:]+)(?::([^:]+))?$/);
  if (short) {
    const src = short[1]!;
    if (src.startsWith(".") || src.startsWith("/")) {
      return resolvePath(composeDir, src);
    }
    // 命名卷 / 变量插值宿主机路径:变量在发现期可能未展开;含 `$` 的跳过 bind 检查
    if (src.includes("$")) return undefined;
    // 无路径分隔的名字 = named volume
    if (!src.includes("/") && !src.includes("\\")) return undefined;
    return resolvePath(composeDir, src);
  }
  return undefined;
}

function resolveComposeFile(file: string | URL, baseDir?: string): string {
  if (typeof file !== "string") return fileURLToPath(file);
  if (isAbsolute(file)) return file;
  return resolvePath(baseDir ?? process.cwd(), file);
}

// ---------------------------------------------------------------------------
// BuildKey 收集 + SandboxBuildProvider
// ---------------------------------------------------------------------------

export interface ComposeBuildCollection {
  readonly buildKeys: readonly BuildKey[];
  readonly works: readonly SandboxBuildWork[];
  readonly leakHints: LeakGateHints;
  readonly composeBytes: string;
  readonly composePath: string;
  readonly inspection: ComposeInspection;
  /** service → 解析中的 image 引用(无 build 的服务);digest 留给协调器/物化期填写。 */
  readonly imageRefs: Readonly<globalThis.Record<string, string>>;
  /** 本次进 BuildKey 的目标平台;构建执行拿同一个值。 */
  readonly platform: string;
}

/** 从 Compose 声明收集 BuildKey 与协调器 works(仅有 `build:` 的服务)。 */
export async function collectComposeBuilds(opts: {
  readonly file: string | URL;
  readonly mainService: string;
  readonly baseDir?: string;
  /** 显式钉死目标平台;省略时从构建执行环境探测。 */
  readonly platform?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  /** 注入平台探测通道(测试用)。 */
  readonly platformProbe?: () => Promise<string | undefined>;
}): Promise<ComposeBuildCollection> {
  const { hints, inspection, composePath } = await leakGateHintsFromComposeFile(opts.file, {
    mainService: opts.mainService,
    baseDir: opts.baseDir,
  });
  const composeBytes = inspection.raw;
  const composeDir = dirname(composePath);
  // 目标平台是构建事实:硬编码一个默认值会让 arm64 宿主构出 arm64 镜像却按 amd64 记身份
  // (台账见 memory/buildkey-platform-declared-not-enforced.md)。
  const platform = opts.platform
    ? normalizeBuildPlatform(opts.platform)
    : await detectDockerBuildPlatform(opts.platformProbe ? { probe: opts.platformProbe } : undefined);
  const works: SandboxBuildWork[] = [];
  const buildKeys: BuildKey[] = [];
  const imageRefs: globalThis.Record<string, string> = {};

  for (const svc of inspection.services) {
    if (svc.image !== undefined && svc.build === undefined) {
      imageRefs[svc.name] = svc.image;
      continue;
    }
    if (svc.build === undefined) continue;

    const contextDir = resolvePath(composeDir, svc.build.context);
    const dockerfilePath = resolvePath(contextDir, svc.build.dockerfile ?? "Dockerfile");
    const dockerfile = await readFile(dockerfilePath, "utf-8").catch(() => {
      throw new Error(
        `Compose service ${JSON.stringify(svc.name)} build Dockerfile not found at ${dockerfilePath}`,
      );
    });
    const contextSpec: BuildContextSpec = {
      contextDir,
      label: `compose service ${svc.name}`,
    };
    const { contextDigest, contextFilterRules } = await buildContextIdentityContribution(contextSpec);
    const fromDigest = extractFromDigestHint(dockerfile) ?? `unresolved:${svc.name}`;
    const buildKey = computeBuildKey({
      builderKind: BUILDER_KIND,
      builderRevision: COMPOSE_MATERIALIZER_REVISION,
      platform,
      dockerfile,
      contextDigest,
      fromDigest,
      contextFilterRules,
      ...(svc.build.args !== undefined ? { buildArgs: svc.build.args } : {}),
    });
    buildKeys.push(buildKey);
    works.push({
      buildKey,
      provider: "docker",
      label: `compose:${svc.name}`,
      inputs: {
        service: svc.name,
        composeFile: composePath,
        // 进 BuildKey 的那个平台原样交给构建执行,provenance 里也留下这次构出的是哪种架构。
        platform,
        context: svc.build.context,
        ...(svc.build.dockerfile !== undefined ? { dockerfile: svc.build.dockerfile } : {}),
        ...(svc.build.args !== undefined ? { args: svc.build.args } : {}),
        // 每条 work 自带插值 env:Run 级 provider 不得共用「最后一个 eval」的 env/baseDir。
        ...(opts.env !== undefined
          ? { composeEnv: opts.env, envNames: Object.keys(opts.env).sort() }
          : {}),
        contextFilterRules,
      },
    });
  }

  return {
    buildKeys,
    works,
    leakHints: hints,
    composeBytes,
    composePath,
    inspection,
    imageRefs,
    platform,
  };
}

/**
 * 从 PlannedSandboxCase 抽 Compose BuildKey / works。
 * 非 compose 或缺声明时返回空集合。
 */
export async function composeBuildWorksFromPlan(
  plan: PlannedSandboxCase,
  opts?: { readonly baseDir?: string; readonly platform?: string },
): Promise<ComposeBuildCollection | undefined> {
  const decl = composeDeclFromPlan(plan);
  if (decl === undefined) return undefined;
  return collectComposeBuilds({
    file: decl.file,
    mainService: decl.mainService,
    baseDir: opts?.baseDir,
    platform: opts?.platform,
    env: decl.env,
  });
}

function composeDeclFromPlan(
  plan: PlannedSandboxCase,
): {
  file: string | URL;
  mainService: string;
  env?: Readonly<globalThis.Record<string, string>>;
  executionUser?: string;
} | undefined {
  if (plan.caseKind !== "compose") return undefined;
  const d = plan.declaration;
  if (d.form === "docker" && d.value.compose !== undefined) {
    return {
      file: d.value.compose.file,
      mainService: d.value.compose.mainService,
      ...(d.value.compose.env !== undefined ? { env: d.value.compose.env } : {}),
    };
  }
  if (d.form === "source" && d.value.kind === "compose") {
    return {
      file: d.value.file,
      mainService: d.value.mainService,
      ...(d.value.env !== undefined ? { env: d.value.env } : {}),
      ...(d.value.executionUser !== undefined ? { executionUser: d.value.executionUser } : {}),
    };
  }
  return undefined;
}

function extractFromDigestHint(dockerfile: string): string | undefined {
  const m = dockerfile.match(/^\s*FROM\s+(\S+)/im);
  if (!m) return undefined;
  const ref = m[1]!;
  if (/@sha256:[a-f0-9]{64}$/i.test(ref)) return ref.slice(ref.indexOf("@") + 1);
  return undefined;
}

/**
 * Compose build 作为 SandboxBuildProvider:cache 查本地镜像 tag,miss 时 `docker compose build`。
 * works.inputs 需含 composeFile + service。
 */
export function dockerComposeBuildProvider(opts?: {
  readonly baseDir?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  /** 注入 compose CLI(测试用)。 */
  readonly runCompose?: typeof runDockerCompose;
}): SandboxBuildProvider {
  const runCompose = opts?.runCompose ?? runDockerCompose;
  return {
    async lookup(work) {
      const tag = composeBuildTag(work.buildKey);
      const hit = await dockerImageExists(tag);
      return hit ? tag : undefined;
    },
    async build(work, ctx) {
      const inputs = work.inputs as globalThis.Record<string, unknown>;
      const composeFile = String(inputs.composeFile ?? "");
      const service = String(inputs.service ?? "");
      if (!composeFile || !service) {
        throw new Error(`compose build work ${work.buildKey.slice(0, 12)}… missing composeFile/service in inputs`);
      }
      const composeEnv =
        inputs.composeEnv !== undefined &&
        typeof inputs.composeEnv === "object" &&
        inputs.composeEnv !== null &&
        !Array.isArray(inputs.composeEnv)
          ? (inputs.composeEnv as Readonly<globalThis.Record<string, string>>)
          : opts?.env;
      // cwd 必须跟 compose 文件走,不能用 Run 级「最后一个 eval」的 baseDir。
      const cwd = dirname(composeFile);
      const tag = composeBuildTag(work.buildKey);
      // 平台钉给 builder:BuildKey 里写的架构就是这次真正构出来的架构。
      const platform = typeof inputs.platform === "string" ? inputs.platform : undefined;
      const buildEnv =
        platform !== undefined ? { ...composeEnv, [DOCKER_PLATFORM_ENV]: platform } : composeEnv;
      await runCompose(
        ["-f", composeFile, "build", "--build-arg", `NICEEVAL_BUILD_KEY=${work.buildKey}`, service],
        {
          cwd,
          env: buildEnv,
          signal: ctx.signal,
          timing: ctx,
        },
      );
      // 构建产物以 service 镜像为准;再打 BuildKey tag 便于 lookup。
      const imageId = await composeServiceImageId(composeFile, service, cwd, composeEnv, runCompose);
      if (imageId) await dockerTag(imageId, tag);
      return tag;
    },
  };
}

function composeBuildTag(buildKey: BuildKey): string {
  return `niceeval-build:${buildKey.slice(0, 32)}`;
}

// ---------------------------------------------------------------------------
// Overlay + materialize
// ---------------------------------------------------------------------------

export interface ComposeOverlay {
  readonly yaml: string;
  readonly projectName: string;
  readonly overlayPath?: string;
}

/** 生成受管 overlay:labels / 可选 project 名。不改 dns、extra_hosts、volumes、depends_on。 */
export function buildComposeOverlay(opts: {
  readonly mainService: string;
  readonly evalId: string;
  readonly profile: string;
  readonly projectName?: string;
  readonly serviceNames: readonly string[];
  readonly managedWorkdir?: string;
}): ComposeOverlay {
  const projectName =
    opts.projectName ??
    `ne-${slug(opts.evalId).slice(0, 24)}-${randomBytes(3).toString("hex")}`;
  const lines: string[] = ["services:"];
  for (const name of opts.serviceNames) {
    lines.push(`  ${name}:`);
    lines.push(`    labels:`);
    lines.push(`      niceeval.eval-id: ${JSON.stringify(opts.evalId)}`);
    lines.push(`      niceeval.profile: ${JSON.stringify(opts.profile)}`);
    lines.push(`      niceeval.case: "compose"`);
    lines.push(`      niceeval.keep-candidate: "true"`);
    if (name === opts.mainService) {
      lines.push(`      niceeval.main-service: "true"`);
      if (opts.managedWorkdir !== undefined) {
        lines.push(`    working_dir: ${JSON.stringify(opts.managedWorkdir)}`);
      }
    }
  }
  return { yaml: `${lines.join("\n")}\n`, projectName };
}

/**
 * 运行标识 overlay:把 `host` / `pid` / `startedAt` 打到本组的每个服务与每个受管网络上,
 * 让强杀后残留的整组资源(含主容器已消失、只剩网络的情形)能被孤儿核对认领
 * (契约见 docs/feature/sandbox/architecture.md「孤儿核对」)。
 *
 * 与受管 overlay 分成两份文件是因为它逐次运行都不同(pid、时刻),混进受管 overlay 会让
 * caseKey 每次都变、携带与缓存全部失效——caseKey 只按受管 overlay 的字节算。
 */
export function buildComposeIdentityOverlay(opts: {
  readonly identity: RunIdentity;
  readonly serviceNames: readonly string[];
  readonly networkNames: readonly string[];
}): string {
  const labels = dockerRunIdentityLabels(opts.identity);
  const labelLines = (indent: string) =>
    Object.entries(labels).map(([k, v]) => `${indent}${k}: ${JSON.stringify(v)}`);
  const lines: string[] = [];
  if (opts.serviceNames.length > 0) {
    lines.push("services:");
    for (const name of opts.serviceNames) {
      lines.push(`  ${name}:`, `    labels:`, ...labelLines("      "));
    }
  }
  if (opts.networkNames.length > 0) {
    lines.push("networks:");
    for (const name of opts.networkNames) {
      lines.push(`  ${name}:`, `    labels:`, ...labelLines("      "));
    }
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

export interface MaterializeComposeOpts {
  readonly ctx: SandboxMaterializeContext;
  readonly timeout?: number;
  readonly feedback?: ScopedFeedback;
  readonly baseDir?: string;
  readonly platform?: string;
  /** 测试可注入:跳过真实 docker compose,直接返回已构造的主 Sandbox。 */
  readonly _testHooks?: {
    readonly runCompose?: typeof runDockerCompose;
    readonly attachMain?: (containerId: string) => Promise<import("./types.ts").Sandbox>;
    readonly resolveMainContainerId?: (projectName: string, mainService: string) => Promise<string>;
  };
}

/** environments 表 / source materializer 共用的 Compose 物化。 */
export async function materializeDockerComposeCase(
  plan: PlannedSandboxCase,
  opts: MaterializeComposeOpts,
): Promise<MaterializedSandboxCase> {
  if (plan.caseKind !== "compose") {
    throw new Error(`materializeDockerComposeCase requires caseKind "compose", got ${JSON.stringify(plan.caseKind)}`);
  }
  const decl = composeDeclFromPlan(plan);
  if (decl === undefined) {
    throw new Error(`compose case ${JSON.stringify(plan.evalId)} has no compose declaration`);
  }

  const collection = await collectComposeBuilds({
    file: decl.file,
    mainService: decl.mainService,
    baseDir: opts.baseDir,
    platform: opts.platform,
    env: decl.env,
  });

  const overlay = buildComposeOverlay({
    mainService: decl.mainService,
    evalId: plan.evalId,
    profile: plan.profile,
    projectName: plan.declaration.form === "docker" ? plan.declaration.value.compose?.projectName : undefined,
    serviceNames: collection.inspection.services.map((s) => s.name),
  });

  const overlayDir = await mkdtemp(join(tmpdir(), "niceeval-compose-"));
  const overlayPath = join(overlayDir, "niceeval.overlay.yaml");
  await writeFile(overlayPath, overlay.yaml, "utf-8");

  const identityYaml = buildComposeIdentityOverlay({
    identity: currentRunIdentity(),
    serviceNames: collection.inspection.services.map((s) => s.name),
    networkNames: collection.inspection.networkNames,
  });
  const identityPath = join(overlayDir, "niceeval.identity.yaml");
  if (identityYaml !== "") await writeFile(identityPath, identityYaml, "utf-8");

  const composeFiles =
    identityYaml !== "" ? [collection.composePath, overlayPath, identityPath] : [collection.composePath, overlayPath];
  const cwd = dirname(collection.composePath);
  // 平台与 BuildKey 同源:物化期这次 compose build 构出的架构必须与身份里写的一致。
  const env = {
    ...process.env,
    ...decl.env,
    COMPOSE_PROJECT_NAME: overlay.projectName,
    [DOCKER_PLATFORM_ENV]: collection.platform,
  };
  const runCompose = opts._testHooks?.runCompose ?? runDockerCompose;

  let finalized = false;
  const finalizer = async () => {
    if (finalized) return;
    finalized = true;
    try {
      await runCompose(["-p", overlay.projectName, ...composeFileArgs(composeFiles), "down", "--remove-orphans"], {
        cwd,
        env,
        signal: opts.ctx.signal,
      });
    } catch {
      // 尽力清理;最终再删 overlay 目录。
    }
    await rm(overlayDir, { recursive: true, force: true }).catch(() => {});
  };

  try {
    if (opts.ctx.signal?.aborted) {
      await finalizer();
      throw abortError(opts.ctx.signal);
    }

    // 构建:协调器 locator 命中时仍跑一次 compose build——BuildKit cache 很快,
    // 且把 BuildKey tag 对齐回本 eval 的 image: 插值名(避免多题共用 provider env 时串镜像)。
    const buildServices = collection.inspection.services.filter((s) => s.build !== undefined).map((s) => s.name);
    if (buildServices.length > 0) {
      await runCompose(["-p", overlay.projectName, ...composeFileArgs(composeFiles), "build", ...buildServices], {
        cwd,
        env,
        signal: opts.ctx.signal,
      });
    }

    await runCompose(
      ["-p", overlay.projectName, ...composeFileArgs(composeFiles), "up", "--detach", "--wait", "--remove-orphans"],
      { cwd, env, signal: opts.ctx.signal },
    );

    const resolveId =
      opts._testHooks?.resolveMainContainerId ??
      ((project: string, service: string) => resolveComposeContainerId(project, service, composeFiles, cwd, env));
    const containerId = await resolveId(overlay.projectName, decl.mainService);

    const attach =
      opts._testHooks?.attachMain ??
      ((id: string) =>
        DockerSandbox.attach(id, {
          timeout: opts.timeout,
          feedback: opts.feedback,
          releaseMode: "detach",
          ...(decl.executionUser !== undefined ? { executionUser: decl.executionUser as "image" | string } : {}),
        }));
    const sandbox = await attach(containerId);

    const services = createComposeServiceController({
      projectName: overlay.projectName,
      composeFiles,
      cwd,
      env,
      runCompose,
    });

    const group: SandboxResourceGroup = {
      primary: { sandboxId: sandbox.sandboxId, provider: "docker" },
      resources: {
        kind: "docker-compose",
        projectName: overlay.projectName,
        composeFiles,
        mainService: decl.mainService,
      },
      stop: finalizer,
      entry: {
        provider: "docker",
        profile: plan.profile,
        primary: { sandboxId: sandbox.sandboxId, provider: "docker" },
        resources: {
          kind: "docker-compose",
          projectName: overlay.projectName,
          mainService: decl.mainService,
        },
        state: "alive",
      },
    };

    // 主 Sandbox.stop 走 detach;真正回收挂在 group.stop(= finalizer)。
    const originalStop = sandbox.stop.bind(sandbox);
    (sandbox as { stop: () => Promise<void> }).stop = async () => {
      await originalStop();
      await finalizer();
    };

    return {
      sandbox,
      services,
      group,
      caseKind: "compose",
      caseKey: plan.caseKey,
      buildKeys: collection.buildKeys.length > 0 ? collection.buildKeys : plan.buildKeys,
      identity: plan.identity,
      carryEligible: plan.carryEligible,
      facts: {
        projectName: overlay.projectName,
        mainService: decl.mainService,
        composeFile: collection.composePath,
        containerId: sandbox.sandboxId,
        imageRefs: collection.imageRefs,
      },
    };
  } catch (e) {
    await finalizer();
    if (isAbortError(e) || opts.ctx.signal?.aborted) throw abortError(opts.ctx.signal, e);
    throw await enrichComposeError(e, overlay.projectName, composeFiles, cwd, env, runCompose);
  }
}

/** folder-local `materializers.compose` 工厂。 */
export function dockerComposeMaterializer(opts?: {
  readonly baseDir?: string;
  readonly platform?: string;
}): SandboxMaterializer {
  const materializer: SandboxMaterializer = {
    kind: "compose",
    revision: COMPOSE_MATERIALIZER_REVISION,
    async materialize(source: SandboxSource, ctx: SandboxMaterializeContext): Promise<MaterializedSandboxCase> {
      if (source.kind !== "compose") {
        throw new Error(`dockerComposeMaterializer expected compose source, got ${JSON.stringify(source.kind)}`);
      }
      const collection = await collectComposeBuilds({
        file: source.file,
        mainService: source.mainService,
        baseDir: opts?.baseDir,
        platform: opts?.platform,
        ...(source.env !== undefined ? { env: source.env } : {}),
      });
      const overlay = buildComposeOverlay({
        mainService: source.mainService,
        evalId: ctx.evalId,
        profile: ctx.profile,
        serviceNames: collection.inspection.services.map((s) => s.name),
      });
      const { computeCaseKey } = await import("./identity.ts");
      const identity = {
        caseKind: "compose" as const,
        sourceKind: "compose" as const,
        file: typeof source.file === "string" ? source.file : source.file.href,
        mainService: source.mainService,
        ...(source.build !== undefined ? { build: source.build } : {}),
        ...(source.executionUser !== undefined ? { executionUser: source.executionUser } : {}),
        ...(source.env !== undefined ? { envNames: Object.keys(source.env).sort() } : {}),
      };
      const caseKey = computeCaseKey({
        caseKind: "compose",
        materializerRevision: COMPOSE_MATERIALIZER_REVISION,
        composeBytes: collection.composeBytes,
        overlayBytes: overlay.yaml,
        buildKeys: collection.buildKeys,
        caseParams: identity,
      });
      const plan: PlannedSandboxCase = {
        evalId: ctx.evalId,
        profile: ctx.profile,
        caseKind: "compose",
        sourceKind: "compose",
        via: "materializer",
        caseKey,
        buildKeys: collection.buildKeys,
        identity,
        carryEligible: true,
        declaration: { form: "source", value: source, materializer },
      };
      return materializeDockerComposeCase(plan, {
        ctx,
        baseDir: opts?.baseDir,
        platform: opts?.platform,
      });
    },
  };
  return materializer;
}

function composeFileArgs(files: readonly string[]): string[] {
  return files.flatMap((f) => ["-f", f]);
}

function createComposeServiceController(opts: {
  readonly projectName: string;
  readonly composeFiles: readonly string[];
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly runCompose: typeof runDockerCompose;
}): ServiceController {
  const base = ["-p", opts.projectName, ...composeFileArgs(opts.composeFiles)];
  return {
    async exec(service, command) {
      const result = await opts.runCompose([...base, "exec", "-T", service, ...command], {
        cwd: opts.cwd,
        env: opts.env,
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    },
    async collectLogs(service) {
      const result = await opts.runCompose([...base, "logs", "--no-color", "--no-log-prefix", service], {
        cwd: opts.cwd,
        env: opts.env,
        allowNonZero: true,
      });
      return Buffer.from(`${result.stdout}${result.stderr}`);
    },
    async stop(service) {
      await opts.runCompose([...base, "stop", service], { cwd: opts.cwd, env: opts.env });
    },
  };
}

async function enrichComposeError(
  e: unknown,
  projectName: string,
  composeFiles: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  runCompose: typeof runDockerCompose,
): Promise<never> {
  let evidence = "";
  try {
    const ps = await runCompose(["-p", projectName, ...composeFileArgs(composeFiles), "ps", "-a"], {
      cwd,
      env,
      allowNonZero: true,
    });
    const logs = await runCompose(["-p", projectName, ...composeFileArgs(composeFiles), "logs", "--no-color", "--tail", "80"], {
      cwd,
      env,
      allowNonZero: true,
    });
    evidence =
      `\n--- compose ps ---\n${ps.stdout || ps.stderr}` +
      `\n--- compose logs (tail) ---\n${logs.stdout || logs.stderr}`;
  } catch {
    // 采证失败不掩盖原错误
  }
  const msg = e instanceof Error ? e.message : String(e);
  throw new Error(`Compose environment failed for project ${projectName}: ${msg}${evidence}`, {
    cause: e instanceof Error ? e : undefined,
  });
}

// ---------------------------------------------------------------------------
// docker / compose CLI
// ---------------------------------------------------------------------------

export interface ComposeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export async function runDockerCompose(
  args: readonly string[],
  opts: {
    readonly cwd: string;
    readonly env?: NodeJS.ProcessEnv | Readonly<globalThis.Record<string, string>>;
    readonly signal?: AbortSignal;
    readonly allowNonZero?: boolean;
    readonly timing?: SandboxBuildExecutionContext;
  },
): Promise<ComposeCommandResult> {
  if (opts.signal?.aborted) throw abortError(opts.signal);
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", ...args], {
      cwd: opts.cwd,
      // 必须叠在 process.env 上:协调器若只传 Compose 插值表,裸 env 会丢掉 PATH → spawn docker ENOENT。
      env: { ...process.env, ...(opts.env as NodeJS.ProcessEnv | undefined) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    const onAbort = () => {
      child.kill("SIGTERM");
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", onAbort);
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !opts.allowNonZero) {
        reject(
          new Error(
            `docker compose ${args.join(" ")} failed (exit ${exitCode}):\n${stderr || stdout}`.trimEnd(),
          ),
        );
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });
  });
}

async function resolveComposeContainerId(
  projectName: string,
  service: string,
  composeFiles: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const result = await runDockerCompose(
    ["-p", projectName, ...composeFileArgs(composeFiles), "ps", "-q", "--status", "running", service],
    { cwd, env, allowNonZero: true },
  );
  const id = result.stdout.trim().split(/\s+/)[0];
  if (!id) {
    throw new Error(
      `Compose project ${projectName} has no running container for mainService ${JSON.stringify(service)}`,
    );
  }
  return id;
}

async function composeServiceImageId(
  composeFile: string,
  service: string,
  cwd: string,
  env?: Readonly<globalThis.Record<string, string>>,
  runCompose: typeof runDockerCompose = runDockerCompose,
): Promise<string | undefined> {
  const result = await runCompose(["-f", composeFile, "images", "-q", service], {
    cwd,
    env: { ...process.env, ...env },
    allowNonZero: true,
  });
  const id = result.stdout.trim().split(/\s+/)[0];
  return id || undefined;
}

async function dockerImageExists(tag: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["image", "inspect", tag], { stdio: "ignore" });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function dockerTag(imageId: string, tag: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", ["tag", imageId, tag], { stdio: "ignore" });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker tag ${imageId} ${tag} failed (exit ${code})`));
    });
  });
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "eval";
}

function abortError(signal?: AbortSignal, cause?: unknown): Error {
  const err = new Error("Compose operation aborted");
  err.name = "AbortError";
  if (cause instanceof Error) (err as Error & { cause?: unknown }).cause = cause;
  if (signal?.reason !== undefined) (err as Error & { cause?: unknown }).cause ??= signal.reason;
  return err;
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && e.name === "AbortError";
}

// ---------------------------------------------------------------------------
// 极简 YAML 映射解析(Compose 黑名单 / build / volumes 够用;不做完整 YAML 1.2)
// ---------------------------------------------------------------------------

type YamlNode = null | boolean | number | string | YamlNode[] | { [k: string]: YamlNode };

type ParseFrame =
  | { kind: "map"; indent: number; map: globalThis.Record<string, YamlNode> }
  | { kind: "seq"; indent: number; arr: YamlNode[]; parentMap: globalThis.Record<string, YamlNode>; key: string };

function parseYamlMapping(text: string): globalThis.Record<string, YamlNode> {
  const lines = text.replace(/\t/g, "  ").split(/\r?\n/);
  const root: globalThis.Record<string, YamlNode> = {};
  const stack: ParseFrame[] = [{ kind: "map", indent: -1, map: root }];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(#|$)/.test(line)) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    const trimmed = line.slice(indent);
    while (stack.length > 1 && indent <= stack[stack.length - 1]!.indent) stack.pop();
    const frame = stack[stack.length - 1]!;

    if (trimmed.startsWith("- ")) {
      if (frame.kind !== "seq") continue;
      const itemText = trimmed.slice(2).trim();
      if (itemText.includes(":") && !/^['"]/.test(itemText) && !itemText.startsWith("[")) {
        // 体积条目里的 `./a:/b:ro` 含冒号但不是 map item——短语法 volume 当标量。
        const looksLikeVolume = /^[^:]+:[^:]+(?::[^:]+)?$/.test(itemText) && !/^\w+:\s/.test(itemText);
        if (looksLikeVolume || /^\$\{/.test(itemText) || itemText.includes("/")) {
          frame.arr.push(parseScalar(itemText));
        } else {
          const itemMap: globalThis.Record<string, YamlNode> = {};
          const colon = itemText.indexOf(":");
          const k = itemText.slice(0, colon).trim();
          const v = itemText.slice(colon + 1).trim();
          itemMap[k] = v === "" ? {} : parseScalar(v);
          frame.arr.push(itemMap);
          stack.push({ kind: "map", indent, map: itemMap });
        }
      } else {
        frame.arr.push(parseScalar(itemText));
      }
      continue;
    }

    const colon = trimmed.indexOf(":");
    if (colon < 0) continue;
    const key = trimmed.slice(0, colon).trim();
    const rest = trimmed.slice(colon + 1).trim();
    const mapFrame =
      frame.kind === "map"
        ? frame
        : (() => {
            // 序列项内的嵌套 key:切回最近 map
            for (let s = stack.length - 1; s >= 0; s--) {
              if (stack[s]!.kind === "map") return stack[s] as Extract<ParseFrame, { kind: "map" }>;
            }
            return undefined;
          })();
    if (mapFrame === undefined) continue;

    if (rest === "" || rest === "|" || rest === ">" || rest === ">-" || rest === "|-") {
      const next = peekNextContent(lines, i + 1);
      if (next && next.trimmed.startsWith("- ") && next.indent > indent) {
        const arr: YamlNode[] = [];
        mapFrame.map[key] = arr;
        stack.push({ kind: "seq", indent, arr, parentMap: mapFrame.map, key });
      } else {
        const child: globalThis.Record<string, YamlNode> = {};
        mapFrame.map[key] = child;
        stack.push({ kind: "map", indent, map: child });
      }
    } else {
      mapFrame.map[key] = parseScalar(rest);
    }
  }
  return root;
}

function peekNextContent(
  lines: string[],
  from: number,
): { indent: number; trimmed: string } | undefined {
  for (let i = from; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*(#|$)/.test(line)) continue;
    const indent = line.match(/^ */)?.[0].length ?? 0;
    return { indent, trimmed: line.slice(indent) };
  }
  return undefined;
}

function parseScalar(text: string): YamlNode {
  if (text === "null" || text === "~") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  if (
    (text.startsWith('"') && text.endsWith('"')) ||
    (text.startsWith("'") && text.endsWith("'"))
  ) {
    return text.slice(1, -1);
  }
  // 内联序列: [ "a", "b" ]
  if (text.startsWith("[") && text.endsWith("]")) {
    const inner = text.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((p) => parseScalar(p.trim()));
  }
  return text;
}

/** 供类型导出与测试:把 DockerComposeDecl 转成可挂 hints 的对象。 */
export function composeDeclAsSource(decl: DockerComposeDecl): ComposeSandboxSource {
  return {
    kind: "compose",
    file: decl.file,
    mainService: decl.mainService,
    __brand: "niceeval.sandboxSource.compose",
  };
}

export type { JsonValue };
