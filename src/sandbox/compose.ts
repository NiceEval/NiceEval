// Docker Compose case:原生 compose build/up/down、受管 overlay、黑名单、mainService 主 Sandbox、
// ServiceController、整组 finalizer、泄题门 hints 与 BuildKey 收集。
// NiceEval 不维护字段白名单解析器——未知字段原样交给 Compose;只拒绝破坏核心不变量的黑名单项。
// 契约单源:docs/feature/sandbox/case.md「Docker Compose case」。

import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative as relativePath, resolve as resolvePath, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Data, Effect, type Scope } from "effect";
import { parseDocument } from "yaml";
import type { JsonValue } from "../shared/types.ts";
import {
  attachLeakGateHints,
  buildContextIdentityContribution,
  pathContentDigest,
  type BindMountSpec,
  type BuildContextSpec,
  type LeakGateHints,
} from "../runner/leak-gate.ts";
import type { SandboxBuildExecutionContext, SandboxBuildProvider, SandboxBuildWork } from "./build-coordinator.ts";
import type {
  MaterializedSandboxCase,
  SandboxMaterializeContext,
  SandboxResourceGroup,
  ServiceController,
} from "./case-types.ts";
import {
  computeBuildKey,
  digestOf,
  looksLikeDigestRef,
  unresolvedProviderFingerprintMarker,
  type BuildKey,
} from "./identity.ts";
import { currentRunIdentity, dockerRunIdentityLabels, type RunIdentity } from "./run-identity.ts";
import { withProvisionRetry, type ProvisionSlot } from "./retry.ts";
import type { CommandResult } from "./types.ts";
import type { ScopedFeedback } from "../types.ts";
import { dockerfileBaseIdentity } from "./dockerfile-identity.ts";

/**
 * materializer / BuildKey 的 builder revision，只对成功输入定义：它决定成功输入得到什么
 * 构建字节、物理计划与身份。安全校验只把破坏所有权不变量的输入改为规划失败，不改变任何
 * 成功输入的结果，因此新增校验不得递增本 revision（memory/compose-project-namespace-escape-destabilizes-case-identity.md）。
 */
export const COMPOSE_MATERIALIZER_REVISION = "docker-compose-2";

const BUILDER_KIND = "docker-compose";

/**
 * physical planning 安全校验用的两个固定哨兵 project：同一份 file + env 分别求值有效模型，
 * 受管资源名必须随哨兵各自变化，写死其中一个哨兵名会在另一个模型失败。
 */
const COMPOSE_PLAN_SENTINEL_PROJECTS = ["niceeval-plan-a", "niceeval-plan-b"] as const;

/** Provider stop 的 TERM 边界；再加 1s KILL grace 后仍严格短于 runner 的 8s 看门狗。 */
const COMPOSE_STOP_TIMEOUT_MS = 6_500;
/** Compose 收到 TERM 后仍不退出时，升级成 KILL 并结束等待。 */
const COMPOSE_ABORT_KILL_GRACE_MS = 1_000;

export class ComposeBuildCollectionError extends Data.TaggedError("ComposeBuildCollectionError")<{
  readonly stage: "read" | "configuration" | "security" | "identity";
  readonly message: string;
}> {}

function composeCollectionError(
  stage: ComposeBuildCollectionError["stage"],
  cause: unknown,
): ComposeBuildCollectionError {
  return new ComposeBuildCollectionError({
    stage,
    message: cause instanceof Error ? cause.message : String(cause),
  });
}

// ---------------------------------------------------------------------------
// 目标平台:构建事实(case.md「BuildKey 与 CaseKey」)
// ---------------------------------------------------------------------------

/** 构建器传平台用的环境变量;探测值与用户指定值都经它进入 builder。 */
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
 * 目标平台从构建执行环境得出:优先用户显式指定的 `DOCKER_DEFAULT_PLATFORM`,
 * 其次 daemon 自报的 os/arch,都拿不到才回落到宿主架构(容器恒为 linux)。
 * 探测结果进 BuildKey,同一个值再传给构建器,身份与事实同源。
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
  /** Compose `build.platforms` 原样保留;进 BuildKey 前由收集器裁决(多元素拒绝)。 */
  readonly platforms?: readonly string[];
}

export interface ComposeServiceInspection {
  readonly name: string;
  readonly build?: ComposeBuildDecl;
  /** service 级 `platform`:Compose 用它决定构建与运行平台,压过 DOCKER_DEFAULT_PLATFORM。 */
  readonly platform?: string;
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
  /** Compose case 引用的宿主侧非敏感文件；内容摘要进入 CaseKey，绝对路径不落盘。 */
  readonly localFiles: readonly ComposeLocalFileRef[];
}

export interface ComposeLocalFileRef {
  readonly kind: "env_file" | "config" | "secret";
  readonly path: string;
  readonly label: string;
}

/** 从 Compose 原文抽取 services 的黑名单 / build / volume 面。未知字段忽略。 */
export function inspectComposeYaml(raw: string): ComposeInspection {
  const doc = parseYamlMapping(raw);
  const servicesNode = doc.services;
  if (servicesNode === undefined || servicesNode === null || typeof servicesNode !== "object" || Array.isArray(servicesNode)) {
    return { services: [], networkNames: [], raw, localFiles: topLevelLocalFiles(doc) };
  }
  const services: ComposeServiceInspection[] = [];
  const localFiles: ComposeLocalFileRef[] = topLevelLocalFiles(doc);
  for (const [name, value] of Object.entries(servicesNode as globalThis.Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      services.push({ name, volumes: [] });
      continue;
    }
    const svc = value as globalThis.Record<string, unknown>;
    for (const path of localPathValues(svc.env_file)) {
      localFiles.push({ kind: "env_file", path, label: `service ${name} env_file` });
    }
    services.push({
      name,
      ...(parseBuild(svc.build) !== undefined ? { build: parseBuild(svc.build)! } : {}),
      ...(typeof svc.platform === "string" ? { platform: svc.platform } : {}),
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
  return {
    services,
    networkNames: managedNetworkNames(doc, servicesNode as globalThis.Record<string, unknown>),
    raw,
    localFiles,
  };
}

function topLevelLocalFiles(doc: globalThis.Record<string, YamlNode>): ComposeLocalFileRef[] {
  const refs: ComposeLocalFileRef[] = [];
  for (const kind of ["config", "secret"] as const) {
    const node = doc[`${kind}s`];
    if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
    for (const [name, value] of Object.entries(node as globalThis.Record<string, unknown>)) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const file = (value as globalThis.Record<string, unknown>).file;
      if (typeof file === "string") refs.push({ kind, path: file, label: `${kind} ${name}` });
    }
  }
  return refs;
}

function localPathValues(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return [];
    const path = (entry as globalThis.Record<string, unknown>).path;
    return typeof path === "string" ? [path] : [];
  });
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
  const platforms = Array.isArray(b.platforms)
    ? b.platforms.filter((p): p is string => typeof p === "string")
    : undefined;
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
    ...(platforms !== undefined && platforms.length > 0 ? { platforms } : {}),
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
// 安全校验:合成声明 + 双哨兵有效模型(case.md「Docker Compose case」黑名单)
// ---------------------------------------------------------------------------

interface ComposeSecurityViolation {
  readonly field: string;
  readonly reason: string;
}

/**
 * 用正式 YAML parser(含 anchor/merge 展开)检测合成声明:
 * - 顶层 `include`:外部文件不在当前 CaseKey 输入闭包;
 * - 任何经 inline / anchor / merge 出现的 `services.*.extends.file`:该语法引入第二个文件入口，
 *   当前 CaseKey 没有为它建立输入闭包；同文件复用请使用 service-only extends。
 * 同文件 anchor、merge、插值与 service-only extends 不在这里拒绝,交给 Compose 有效模型求值。
 */
function assertComposeSyntheticScope(raw: string): void {
  let json: unknown;
  try {
    json = parseDocument(raw, { merge: true }).toJSON();
  } catch {
    // 解析失败时 docker compose config 也会失败,由有效模型阶段给出安全错误,这里不跳过检查。
    json = undefined;
  }
  const violations: ComposeSecurityViolation[] = [];
  if (json !== null && typeof json === "object" && !Array.isArray(json)) {
    const root = json as Readonly<Record<string, unknown>>;
    if ("include" in root) {
      violations.push({
        field: "include",
        reason:
          "top-level include pulls external Compose files into the run without entering the CaseKey input closure",
      });
    }
    const services = root.services;
    if (services !== null && typeof services === "object" && !Array.isArray(services)) {
      for (const [name, svc] of Object.entries(services as Readonly<Record<string, unknown>>)) {
        if (svc === null || typeof svc !== "object" || Array.isArray(svc)) continue;
        const ext = (svc as Readonly<Record<string, unknown>>).extends;
        if (ext === null || typeof ext !== "object" || Array.isArray(ext)) continue;
        if (!("file" in (ext as Readonly<Record<string, unknown>>))) continue;
        violations.push({
          field: `services.${name}.extends.file`,
          reason:
            "introduces a Compose file entry that is not part of the CaseKey input closure; use in-file anchors/merges or service-only extends",
        });
      }
    }
  }
  if (violations.length === 0) return;
  throw new Error(
    `Compose security validation rejected ${violations.length} declaration(s):\n` +
      violations.map((v) => `  ${v.field}: ${v.reason}`).join("\n"),
  );
}

interface ComposeEffectiveResource {
  readonly name?: unknown;
  readonly external?: unknown;
}

interface ComposeEffectiveModel {
  readonly services?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  readonly networks?: Readonly<Record<string, ComposeEffectiveResource>>;
  readonly volumes?: Readonly<Record<string, ComposeEffectiveResource>>;
  readonly configs?: Readonly<Record<string, ComposeEffectiveResource>>;
  readonly secrets?: Readonly<Record<string, ComposeEffectiveResource>>;
}

const COMPOSE_MANAGED_RESOURCE_KINDS = ["networks", "volumes", "configs", "secrets"] as const;

function composeConfigRunner(
  composePath: string,
  env?: Readonly<globalThis.Record<string, string>>,
): (projectName: string) => Promise<ComposeCommandResult> {
  return (projectName) =>
    runDockerCompose(
      ["-p", projectName, "-f", composePath, "config", "--format", "json"],
      {
        cwd: dirname(composePath),
        env: { ...env, COMPOSE_PROJECT_NAME: projectName },
        allowNonZero: true,
      },
    );
}

/**
 * 双哨兵有效模型校验(case.md 黑名单):
 * - 任一有效模型的 `services.*.container_name` 拒绝(绕开受管 project namespace);
 * - networks/volumes/configs/secrets 的 key 与 external 标记在两个哨兵模型间必须一致;
 * - 非 external 资源的有效名必须分别严格为 `<哨兵>_<logical-key>`——`${COMPOSE_PROJECT_NAME}_<key>`
 *   自然通过,写死全局名或写死某一个哨兵名会在另一模型失败;
 * - `external: true` 的资源保留外部名,接受。
 * 模型只在内存解码;config 失败只报安全阶段与 exit code,绝不带 stdout/stderr/模型原文。
 */
async function assertComposeEffectiveModelSecurity(opts: {
  readonly composePath: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  readonly runComposeConfig?: (projectName: string) => Promise<ComposeCommandResult>;
}): Promise<void> {
  const runConfig = opts.runComposeConfig ?? composeConfigRunner(opts.composePath, opts.env);
  const models = new Map<string, ComposeEffectiveModel>();
  for (const project of COMPOSE_PLAN_SENTINEL_PROJECTS) {
    let result: ComposeCommandResult;
    try {
      result = await runConfig(project);
    } catch {
      throw new Error(
        `Compose security validation failed at effective-model resolution for project ${project}; refused to plan without a valid model.`,
      );
    }
    if (result.exitCode !== 0) {
      throw new Error(
        `Compose security validation failed at effective-model resolution for project ${project} ` +
          `(docker compose config exited ${result.exitCode}); refused to plan without a valid model.`,
      );
    }
    let model: unknown;
    try {
      model = JSON.parse(result.stdout);
    } catch {
      throw new Error(
        `Compose security validation failed at effective-model decoding for project ${project}; refused to plan without a valid model.`,
      );
    }
    if (model === null || typeof model !== "object" || Array.isArray(model)) {
      throw new Error(
        `Compose security validation failed at effective-model decoding for project ${project}; refused to plan without a valid model.`,
      );
    }
    models.set(project, model as ComposeEffectiveModel);
  }

  const [sentinelA, sentinelB] = COMPOSE_PLAN_SENTINEL_PROJECTS as readonly [string, string];
  const modelA = models.get(sentinelA)!;
  const modelB = models.get(sentinelB)!;
  const violations: ComposeSecurityViolation[] = [];

  for (const model of models.values()) {
    for (const [name, svc] of Object.entries(model.services ?? {})) {
      if (svc === null || typeof svc !== "object") continue;
      if (typeof svc.container_name === "string") {
        violations.push({
          field: `services.${name}.container_name`,
          reason:
            "fixes the container name outside the managed Compose project namespace; concurrent cases would collide on the same host resource",
        });
      }
    }
  }

  for (const kind of COMPOSE_MANAGED_RESOURCE_KINDS) {
    const resourcesA = modelA[kind] ?? {};
    const resourcesB = modelB[kind] ?? {};
    const keysA = Object.keys(resourcesA).sort();
    const keysB = Object.keys(resourcesB).sort();
    if (keysA.join("\u0000") !== keysB.join("\u0000")) {
      const differing =
        keysA.find((k) => !keysB.includes(k)) ?? keysB.find((k) => !keysA.includes(k)) ?? keysA[0] ?? keysB[0]!;
      violations.push({
        field: `${kind}.${differing}`,
        reason: `resource key set differs between the two sentinel project evaluations (${sentinelA}/${sentinelB}); the two models must be consistent`,
      });
      continue;
    }
    for (const key of keysA) {
      const resourceA = resourcesA[key];
      const resourceB = resourcesB[key];
      const externalA = resourceA?.external === true;
      const externalB = resourceB?.external === true;
      if (externalA !== externalB) {
        violations.push({
          field: `${kind}.${key}`,
          reason: `external marker differs between the two sentinel project evaluations (${sentinelA}/${sentinelB}); the two models must be consistent`,
        });
        continue;
      }
      if (externalA) continue;
      const nameA = typeof resourceA?.name === "string" ? resourceA.name : undefined;
      const nameB = typeof resourceB?.name === "string" ? resourceB.name : undefined;
      if (nameA !== `${sentinelA}_${key}` || nameB !== `${sentinelB}_${key}`) {
        violations.push({
          field: `${kind}.${key}.name`,
          reason:
            `does not track the Compose project namespace (expected ${sentinelA}_${key} / ${sentinelB}_${key} across sentinel projects); ` +
            "declare it external or derive the name from ${COMPOSE_PROJECT_NAME}_<key>",
        });
      }
    }
  }

  if (violations.length === 0) return;
  const unique = [...new Map(violations.map((v) => [v.field, v])).values()];
  throw new Error(
    `Compose security validation rejected ${unique.length} declaration(s) that escape the managed Compose project namespace:\n` +
      unique.map((v) => `  ${v.field}: ${v.reason}`).join("\n"),
  );
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
export function leakGateHintsFromComposeFile(
  file: string | URL,
  opts: { readonly mainService: string; readonly baseDir?: string },
): Effect.Effect<
  { hints: LeakGateHints; inspection: ComposeInspection; composePath: string },
  ComposeBuildCollectionError
> {
  return Effect.gen(function* () {
    const composePath = resolveComposeFile(file, opts.baseDir);
    const raw = yield* Effect.tryPromise({
      try: () => readFile(composePath, "utf-8"),
      catch: (cause) => composeCollectionError("read", cause),
    });
    const inspection = yield* Effect.try({
      try: () => inspectComposeYaml(raw),
      catch: (cause) => composeCollectionError("configuration", cause),
    });
    if (!inspection.services.some((service) => service.name === opts.mainService)) {
      return yield* Effect.fail(new ComposeBuildCollectionError({
        stage: "configuration",
        message: `Compose file ${composePath} has no service ${JSON.stringify(opts.mainService)} (mainService)`,
      }));
    }
    const hints = yield* Effect.try({
      try: () => {
        assertComposeBlacklist(inspection, { mainService: opts.mainService });
        return leakGateHintsFromInspection(inspection, {
          composeDir: dirname(composePath),
          mainService: opts.mainService,
        });
      },
      catch: (cause) => composeCollectionError("configuration", cause),
    });
    return { hints, inspection, composePath };
  });
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
  /** 兼容旧 provider identity 的 inert fingerprint marker；不参与 carry gate。 */
  readonly providerIdentityMarker?: JsonValue;
  readonly bindMountDigests: Readonly<globalThis.Record<string, string>>;
  readonly configContents: Readonly<globalThis.Record<string, string>>;
}

/** physical planner 与 build collector 共用的安全 Case 输入投影。 */
export function composeCollectionIdentity(collection: ComposeBuildCollection): JsonValue {
  return {
    composeDigest: digestOf(collection.composeBytes),
    buildKeys: [...collection.buildKeys].sort(),
    imageRefs: collection.imageRefs,
    bindMountDigests: collection.bindMountDigests,
    configContents: collection.configContents,
  };
}

interface ComposeBuildCollectionOptions {
  readonly file: string | URL;
  readonly mainService: string;
  readonly baseDir?: string;
  /** 显式指定目标平台;省略时从构建执行环境探测。 */
  readonly platform?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  /** 注入平台探测通道(测试用)。 */
  readonly platformProbe?: () => Promise<string | undefined>;
}

/** 从 Compose 声明收集 BuildKey 与协调器 works(仅有 `build:` 的服务)。 */
export function collectComposeBuilds(
  opts: ComposeBuildCollectionOptions,
): Effect.Effect<ComposeBuildCollection, ComposeBuildCollectionError> {
  return collectComposeBuildsInternal(opts);
}

/** @internal 单测注入有效模型求值通道；不从 `niceeval/sandbox` 对外导出。 */
export function collectComposeBuildsForTest(
  opts: ComposeBuildCollectionOptions,
  runComposeConfig: (projectName: string) => Promise<ComposeCommandResult>,
): Effect.Effect<ComposeBuildCollection, ComposeBuildCollectionError> {
  return collectComposeBuildsInternal(opts, runComposeConfig);
}

function collectComposeBuildsInternal(
  opts: ComposeBuildCollectionOptions,
  runComposeConfig?: (projectName: string) => Promise<ComposeCommandResult>,
): Effect.Effect<ComposeBuildCollection, ComposeBuildCollectionError> {
  return Effect.gen(function* () {
    const { hints, inspection, composePath } = yield* leakGateHintsFromComposeFile(opts.file, {
      mainService: opts.mainService,
      baseDir: opts.baseDir,
    });
    // physical planning 安全门:合成声明 + 双哨兵有效模型,早于 BuildKey 收集与任何携带决策。
    const raw = yield* Effect.tryPromise({
      try: () => readFile(composePath, "utf-8"),
      catch: (cause) => composeCollectionError("read", cause),
    });
    yield* Effect.try({
      try: () => assertComposeSyntheticScope(raw),
      catch: (cause) => composeCollectionError("security", cause),
    });
    yield* Effect.tryPromise({
      try: () => assertComposeEffectiveModelSecurity({
        composePath,
        env: opts.env,
        runComposeConfig,
      }),
      catch: (cause) => composeCollectionError("security", cause),
    });
    const composeBytes = inspection.raw;
    const composeDir = dirname(composePath);
    // 目标平台是构建事实:硬编码一个默认值会让 arm64 宿主构出 arm64 镜像却按 amd64 记身份
    // (台账见 memory/buildkey-platform-declared-not-enforced.md)。
    const platform = opts.platform
      ? normalizeBuildPlatform(opts.platform)
      : yield* Effect.tryPromise({
          try: () => detectDockerBuildPlatform(
            opts.platformProbe ? { probe: opts.platformProbe } : undefined,
          ),
          catch: (cause) => composeCollectionError("identity", cause),
        });
    const works: SandboxBuildWork[] = [];
    const buildKeys: BuildKey[] = [];
    const imageRefs: globalThis.Record<string, string> = {};
    let providerIdentityMarker: JsonValue | undefined;
    const bindMountDigests: globalThis.Record<string, string> = {};
    yield* Effect.forEach(
      hints.bindMounts ?? [],
      (mount) => pathContentDigest(mount.source).pipe(
        Effect.mapError((cause) => composeCollectionError("identity", cause)),
        Effect.tap((digest) => Effect.sync(() => {
          const key = `${mount.label ?? "bind mount"}:${relativeIdentityPath(composeDir, mount.source)}`;
          bindMountDigests[key] = digest;
        })),
        Effect.asVoid,
      ),
      { concurrency: 1, discard: true },
    );
    const configContents: globalThis.Record<string, string> = {};
    yield* Effect.forEach(
      inspection.localFiles,
      (ref) => {
        const absolute = resolvePath(composeDir, ref.path);
        return pathContentDigest(absolute).pipe(
          Effect.mapError((cause) => composeCollectionError("identity", cause)),
          Effect.tap((digest) => Effect.sync(() => {
            const key = `${ref.kind}:${ref.label}:${relativeIdentityPath(composeDir, absolute)}`;
            configContents[key] = digest;
          })),
          Effect.asVoid,
        );
      },
      { concurrency: 1, discard: true },
    );

    yield* Effect.forEach(
      inspection.services,
      (service) => Effect.gen(function* () {
        if (service.image !== undefined && service.build === undefined) {
          yield* Effect.sync(() => {
            imageRefs[service.name] = service.image!;
            if (!looksLikeDigestRef(service.image!)) {
              providerIdentityMarker = unresolvedProviderFingerprintMarker(
                "sandbox.image-unresolved",
                "Compose references an image or FROM base that is not pinned to a sha256 digest.",
              );
            }
          });
          return;
        }
        const build = service.build;
        if (build === undefined) return;

        const contextDir = resolvePath(composeDir, build.context);
        const dockerfilePath = resolvePath(contextDir, build.dockerfile ?? "Dockerfile");
        const dockerfile = yield* Effect.tryPromise({
          try: () => readFile(dockerfilePath, "utf-8"),
          catch: () => new ComposeBuildCollectionError({
            stage: "read",
            message: `Compose service ${JSON.stringify(service.name)} build Dockerfile not found at ${dockerfilePath}`,
          }),
        });
        // Compose 声明的平台压过探测默认值:service `platform` 或单元素 `build.platforms` 是
        // 显式构建目标,必须逐服务进各自 BuildKey,否则声明不同平台的两个 case 会共用同一身份。
        const declaredPlatforms = build.platforms;
        if (declaredPlatforms !== undefined && declaredPlatforms.length > 1) {
          return yield* Effect.fail(new ComposeBuildCollectionError({
            stage: "configuration",
            message:
              `Compose service ${JSON.stringify(service.name)} declares build.platforms with ${declaredPlatforms.length} entries; ` +
              `NiceEval builds exactly one platform per BuildKey — keep a single entry (or the service-level platform) ` +
              `and do multi-platform publishing outside the task Compose`,
          }));
        }
        const declaredPlatform = declaredPlatforms?.[0] ?? service.platform;
        const workPlatform = declaredPlatform !== undefined ? normalizeBuildPlatform(declaredPlatform) : platform;
        const { contextDigest, contextFilterRules } = yield* buildContextIdentityContribution({
          contextDir,
          label: `compose service ${service.name}`,
        }).pipe(Effect.mapError((cause) => composeCollectionError("identity", cause)));
        const collected = yield* Effect.try({
          try: () => {
            const base = dockerfileBaseIdentity(dockerfile, build.target);
            const buildKey = computeBuildKey({
              builderKind: BUILDER_KIND,
              builderRevision: COMPOSE_MATERIALIZER_REVISION,
              platform: workPlatform,
              dockerfile,
              contextDigest,
              fromDigest: base.fromDigest,
              contextFilterRules,
              ...(build.args !== undefined ? { buildArgs: build.args } : {}),
              ...(build.target !== undefined ? { target: build.target } : {}),
            });
            return { buildKey, base };
          },
          catch: (cause) => composeCollectionError("identity", cause),
        });
        yield* Effect.sync(() => {
          if (collected.base.providerIdentityMarker !== undefined) {
            providerIdentityMarker = unresolvedProviderFingerprintMarker(
              "sandbox.image-unresolved",
              "Compose references an image or FROM base that is not pinned to a sha256 digest.",
            );
          }
          buildKeys.push(collected.buildKey);
          works.push({
            buildKey: collected.buildKey,
            provider: "docker",
            label: `compose:${service.name}`,
            inputs: {
              service: service.name,
              composeFile: composePath,
              // 进 BuildKey 的那个平台原样交给构建执行,provenance 里也留下这次构出的是哪种架构。
              platform: workPlatform,
              context: build.context,
              ...(build.dockerfile !== undefined ? { dockerfile: build.dockerfile } : {}),
              ...(build.args !== undefined ? { args: build.args } : {}),
              ...(build.target !== undefined ? { target: build.target } : {}),
              // 每条 work 自带插值 env:Run 级 provider 不得共用「最后一个 eval」的 env/baseDir。
              ...(opts.env !== undefined
                ? { composeEnv: opts.env, envNames: Object.keys(opts.env).sort() }
                : {}),
              contextFilterRules,
            },
          });
        });
      }),
      { concurrency: 1, discard: true },
    );

    return {
      buildKeys,
      works,
      leakHints: hints,
      composeBytes,
      composePath,
      inspection,
      imageRefs,
      platform,
      ...(providerIdentityMarker === undefined ? {} : { providerIdentityMarker }),
      bindMountDigests,
      configContents,
    };
  });
}

function relativeIdentityPath(baseDir: string, path: string): string {
  const relative = relativePath(baseDir, path).split(sep).join("/");
  return relative === "" ? "." : relative;
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
      // 平台传给 builder:BuildKey 里写的架构就是这次真正构出来的架构。
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
  /** Runner 持有的 provisioning 并发槽；退避期间临时归还，避免网络抖动拖住整批并发。 */
  readonly provisionSlot?: ProvisionSlot;
  /** Compose 资源组的最长物理寿命；附着的主 Sandbox 用同一完成态做复用确认。 */
  readonly lifetimeMs?: number;
  /** 测试可注入:跳过真实 docker compose,直接返回已构造的主 Sandbox。 */
  readonly _testHooks?: {
    readonly runCompose?: typeof runDockerCompose;
    readonly attachMain?: (containerId: string) => Promise<import("./types.ts").Sandbox>;
    readonly resolveMainContainerId?: (projectName: string, mainService: string) => Promise<string>;
  };
}

/** ProviderModule 的 typed Compose 完成态；不从作者输入逆向重建计划。 */
export interface DockerComposeProviderMaterializationPlan {
  readonly evalId: string;
  readonly profile: string;
  readonly mainService: string;
  readonly user?: string;
  readonly env: Readonly<Record<string, string>>;
  readonly pathPrepend?: readonly string[];
  readonly projectName?: string;
  readonly collection: ComposeBuildCollection;
  readonly caseKey: import("./identity.ts").CaseKey;
  readonly identity: JsonValue;
}

export class ComposeMaterializationError extends Data.TaggedError("ComposeMaterializationError")<{
  readonly projectName: string;
  readonly message: string;
  readonly cause?: Error;
}> {}

function composeMaterializationError(projectName: string, cause: unknown): ComposeMaterializationError {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  return new ComposeMaterializationError({
    projectName,
    message: error.message,
    cause: error,
  });
}

export function materializeDockerComposeProviderCase(
  plan: DockerComposeProviderMaterializationPlan,
  opts: MaterializeComposeOpts,
): Effect.Effect<MaterializedSandboxCase, ComposeMaterializationError, Scope.Scope> {
  const collection = plan.collection;

  const overlay = buildComposeOverlay({
    mainService: plan.mainService,
    evalId: plan.evalId,
    profile: plan.profile,
    ...(plan.projectName !== undefined ? { projectName: plan.projectName } : {}),
    serviceNames: collection.inspection.services.map((s) => s.name),
  });

  return Effect.gen(function* () {
    const overlayDir = yield* Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "niceeval-compose-")),
      catch: (cause) => composeMaterializationError(overlay.projectName, cause),
    });
    const overlayPath = join(overlayDir, "niceeval.overlay.yaml");
    yield* Effect.tryPromise({
      try: () => writeFile(overlayPath, overlay.yaml, "utf-8"),
      catch: (cause) => composeMaterializationError(overlay.projectName, cause),
    });

    const identityYaml = buildComposeIdentityOverlay({
      identity: currentRunIdentity(),
      serviceNames: collection.inspection.services.map((s) => s.name),
      networkNames: collection.inspection.networkNames,
    });
    const identityPath = join(overlayDir, "niceeval.identity.yaml");
    if (identityYaml !== "") {
      yield* Effect.tryPromise({
        try: () => writeFile(identityPath, identityYaml, "utf-8"),
        catch: (cause) => composeMaterializationError(overlay.projectName, cause),
      });
    }

    const composeFiles =
      identityYaml !== "" ? [collection.composePath, overlayPath, identityPath] : [collection.composePath, overlayPath];
    const cwd = dirname(collection.composePath);
    // 平台与 BuildKey 同源:物化期这次 compose build 构出的架构必须与身份里写的一致。
    const env = {
      ...process.env,
      ...plan.env,
      COMPOSE_PROJECT_NAME: overlay.projectName,
      [DOCKER_PLATFORM_ENV]: collection.platform,
    };
    const runCompose = opts._testHooks?.runCompose ?? runDockerCompose;

    // Attempt 的前向 signal 到这里往往已经 timeout/abort。收尾必须拿一条新的、独立且有界的
    // signal；复用 opts.ctx.signal 会让 runDockerCompose 在真正执行 down 前立刻抛错，整组资源
    // 原地变孤儿。--timeout 给服务 5s 优雅退出，剩余 1.5s 留给 CLI 与网络/volume 删除；
    // runDockerCompose 再给 TERM 1s KILL grace，总上界 7.5s，严格短于 runner 的 8s 看门狗。
    const composeDown = () => runCompose(
      [
        "-p",
        overlay.projectName,
        ...composeFileArgs(composeFiles),
        "down",
        "--timeout",
        "5",
        "--volumes",
        "--remove-orphans",
      ],
      { cwd, env, signal: AbortSignal.timeout(COMPOSE_STOP_TIMEOUT_MS) },
    );

    let finalized = false;
    let finalizing: Promise<void> | undefined;
    const finalizer = async () => {
      if (finalized) return;
      if (finalizing !== undefined) return finalizing;
      const pending = (async () => {
        await composeDown();
        finalized = true;
        await rm(overlayDir, { recursive: true, force: true }).catch(() => {});
      })();
      finalizing = pending;
      try {
        await pending;
      } finally {
        // 失败回 Open，保留 overlay 供 registry 强清路径重试；成功才永久封口。
        if (finalizing === pending) finalizing = undefined;
      }
    };
    // 清理失败只诊断、不覆盖原 Cause；finalizer 幂等，成功路径的 stop 与失败路径的 down 共用一份。
    const finalizerEffect = Effect.tryPromise({
      try: () => finalizer(),
      catch: (cause) => cause,
    }).pipe(Effect.catchAll((cleanupError) => Effect.sync(() => {
      opts.feedback?.diagnostic({
        code: "sandbox-stop-failed",
        level: "warning",
        message:
          `Compose project ${overlay.projectName} cleanup failed after materialization error: ` +
          `${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}. ` +
          "Inspect with `niceeval sandbox list --orphans`; remove with `niceeval sandbox prune`.",
        data: {
          provider: "docker",
          projectName: overlay.projectName,
          sandboxId: overlay.projectName,
        },
        dedupeKey: `sandbox-stop-failed:${overlay.projectName}`,
      });
    })));

    // 重试前对账先清半启动组:down 失败只诊断、继续重试,不覆盖原始 create 错误
    // (cleanup 失败不升格为 Cause;withProvisionRetry 的 reconcile 通道是 never 错误)。
    const composeDownReconcile = Effect.tryPromise({
      try: () => composeDown(),
      catch: (cause) => cause,
    }).pipe(Effect.asVoid);

    // 资源可能创建：先原子登记 best-effort finalizer。此后无论是中断还是失败，外层 Scope
    // 关闭都会执行 compose down；失败路径还会先显式跑一遍(幂等)，保持「先 down 再采证」的顺序。
    yield* Effect.addFinalizer(() => finalizerEffect);

    const failEnriched = (cause: unknown): Effect.Effect<never, ComposeMaterializationError> =>
      Effect.tryPromise({
        try: () => enrichComposeError(cause, overlay.projectName, composeFiles, cwd, env, runCompose),
        catch: (enrichCause) => enrichCause,
      }).pipe(Effect.matchEffect({
        onFailure: (enrichCause) => Effect.fail(composeMaterializationError(overlay.projectName, enrichCause)),
        onSuccess: (enriched) => Effect.fail(composeMaterializationError(overlay.projectName, enriched)),
      }));

    return yield* Effect.gen(function* () {
      if (opts.ctx.signal?.aborted) return yield* Effect.interrupt;

      // dockerode 是 optional peer：compose 实现在 materialize 热路径才加载 docker.ts。
      const { classifyProvisionError, DockerSandbox } = yield* Effect.tryPromise({
        try: () => import("./docker.ts"),
        catch: (cause) => cause,
      });

      // 构建:协调器 locator 命中时仍跑一次 compose build——BuildKit cache 很快,
      // 且把 BuildKey tag 对齐回本 eval 的 image: 插值名(避免多题共用 provider env 时串镜像)。
      const buildServices = collection.inspection.services.filter((s) => s.build !== undefined).map((s) => s.name);
      if (buildServices.length > 0) {
        yield* withProvisionRetry(
          Effect.tryPromise({
            try: () => runCompose(["-p", overlay.projectName, ...composeFileArgs(composeFiles), "build", ...buildServices], {
              cwd,
              env,
              signal: opts.ctx.signal,
            }),
            catch: (cause) => cause,
          }),
          classifyProvisionError,
          opts.provisionSlot,
          opts.feedback,
          // 构建产物没有计费实例泄漏面；同一 BuildKey 重建本身就是对账。
          Effect.void,
        );
      }

      yield* withProvisionRetry(
        Effect.tryPromise({
          try: () => runCompose(
            ["-p", overlay.projectName, ...composeFileArgs(composeFiles), "up", "--detach", "--wait", "--remove-orphans"],
            { cwd, env, signal: opts.ctx.signal },
          ),
          catch: (cause) => cause,
        }),
        classifyProvisionError,
        opts.provisionSlot,
        opts.feedback,
        // projectName 与 overlay 在整个重试闭包内固定；先清掉半启动组，再收敛同一个 project。
        composeDownReconcile,
      );

      const resolveId =
        opts._testHooks?.resolveMainContainerId ??
        ((project: string, service: string) => resolveComposeContainerId(project, service, composeFiles, cwd, env));
      const containerId = yield* Effect.tryPromise({
        try: () => resolveId(overlay.projectName, plan.mainService),
        catch: (cause) => cause,
      });

      const attach =
        opts._testHooks?.attachMain ??
        ((id: string) =>
          DockerSandbox.attach(id, {
            timeout: opts.timeout,
            lifetimeMs: opts.lifetimeMs,
            feedback: opts.feedback,
            releaseMode: "detach",
            ...(plan.user !== undefined ? { user: plan.user } : {}),
            ...(plan.pathPrepend !== undefined ? { pathPrepend: plan.pathPrepend } : {}),
          }));
      const sandbox = yield* Effect.tryPromise({
        try: () => attach(containerId),
        catch: (cause) => cause,
      });

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
          mainService: plan.mainService,
        },
        stop: finalizer,
        entry: {
          provider: "docker",
          profile: plan.profile,
          primary: { sandboxId: sandbox.sandboxId, provider: "docker" },
          resources: {
            kind: "docker-compose",
            projectName: overlay.projectName,
            mainService: plan.mainService,
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

      const materialized: MaterializedSandboxCase = {
        sandbox,
        services,
        group,
        caseKind: "compose",
        caseKey: plan.caseKey,
        buildKeys: collection.buildKeys,
        identity: plan.identity,
        facts: {
          projectName: overlay.projectName,
          mainService: plan.mainService,
          composeFile: collection.composePath,
          containerId: sandbox.sandboxId,
          imageRefs: collection.imageRefs,
        },
      };
      return materialized;
    }).pipe(
      Effect.catchAll((cause) => Effect.gen(function* () {
        yield* finalizerEffect;
        if (isAbortError(cause) || opts.ctx.signal?.aborted) return yield* Effect.interrupt;
        return yield* failEnriched(cause);
      })),
    );
  });
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
    let settled = false;
    let aborting: Error | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      opts.signal?.removeEventListener("abort", onAbort);
      if (killTimer !== undefined) clearTimeout(killTimer);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const resolveOnce = (result: ComposeCommandResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    const onAbort = () => {
      aborting = abortError(opts.signal);
      child.kill("SIGTERM");
      // close 事件本身不是可靠边界：CLI 或子进程若卡死，最多再等这段 grace，然后 KILL 并
      // 主动 reject，不能依赖一个可能永远不来的 close。
      killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        rejectOnce(aborting ?? abortError(opts.signal));
      }, COMPOSE_ABORT_KILL_GRACE_MS);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (err) => {
      rejectOnce(err);
    });
    child.on("close", (code) => {
      if (aborting !== undefined) {
        rejectOnce(aborting);
        return;
      }
      const exitCode = code ?? 1;
      if (exitCode !== 0 && !opts.allowNonZero) {
        rejectOnce(
          new Error(
            `docker compose ${args.join(" ")} failed (exit ${exitCode}):\n${stderr || stdout}`.trimEnd(),
          ),
        );
        return;
      }
      resolveOnce({ stdout, stderr, exitCode });
    });
    if (opts.signal?.aborted) onAbort();
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

export type { JsonValue };
