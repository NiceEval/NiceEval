// Sandbox case 协商与物化内核:profile/source 双入口、两类缺失、主 Sandbox 不变量。
// Docker Compose 原生物化见 compose.ts;本文件在 docker compose 表项上委派过去。
// 契约单源:docs/feature/sandbox/case.md。

import { Data } from "effect";
import type { JsonValue } from "../shared/types.ts";
import {
  assertPureDataIdentity,
  computeCaseKey,
  type BuildKey,
  type CaseKey,
} from "./identity.ts";
import type {
  ComposeSandboxSource,
  DockerBuildDecl,
  DockerComposeDecl,
  DockerEnvironmentCase,
  DockerfileSandboxSource,
  E2BEnvironmentCase,
  MaterializedSandboxCase,
  SandboxCaseKind,
  SandboxMaterializeContext,
  SandboxMaterializer,
  SandboxMaterializers,
  SandboxResourceGroup,
  SandboxSource,
  SandboxSourceKind,
  ServiceController,
  VercelEnvironmentCase,
} from "./case-types.ts";
import type { Sandbox, SandboxOption, SandboxSpec } from "./types.ts";
import {
  customCaseSandbox,
  type CustomCaseSandboxOptions,
  type SandboxLayer,
} from "./layer.ts";

export type {
  ComposeSandboxSource,
  DockerComposeDecl,
  DockerEnvironmentCase,
  DockerfileSandboxSource,
  E2BEnvironmentCase,
  MaterializedSandboxCase,
  ProviderLocator,
  SandboxCaseKind,
  SandboxGroupEntry,
  SandboxLocator,
  SandboxMaterializeContext,
  SandboxMaterializer,
  SandboxMaterializers,
  SandboxResourceGroup,
  SandboxSource,
  SandboxSourceKind,
  ServiceController,
  VercelEnvironmentCase,
} from "./case-types.ts";

/** folder-local Compose source:不选 provider,由当前 spec 的 materializer 物化。 */
export function composeSandbox(opts: {
  file: string | URL;
  mainService: string;
  build?: "on-demand" | "prebuilt";
  executionUser?: string;
  env?: Readonly<globalThis.Record<string, string>>;
}): ComposeSandboxSource {
  if (!opts.mainService) {
    throw new Error("composeSandbox requires mainService (the sole primary Sandbox)");
  }
  return {
    kind: "compose",
    file: opts.file,
    mainService: opts.mainService,
    ...(opts.build !== undefined ? { build: opts.build } : {}),
    ...(opts.executionUser !== undefined ? { executionUser: opts.executionUser } : {}),
    ...(opts.env !== undefined ? { env: opts.env } : {}),
    __brand: "niceeval.sandboxSource.compose",
  };
}

/** folder-local 单 Dockerfile source。 */
export function dockerfileSandbox(opts: {
  context: string | URL;
  dockerfile?: string;
  buildArgs?: Readonly<globalThis.Record<string, string>>;
}): DockerfileSandboxSource {
  return {
    kind: "dockerfile",
    context: opts.context,
    ...(opts.dockerfile !== undefined ? { dockerfile: opts.dockerfile } : {}),
    ...(opts.buildArgs !== undefined ? { buildArgs: opts.buildArgs } : {}),
    __brand: "niceeval.sandboxSource.dockerfile",
  };
}

export function isSandboxSource(value: unknown): value is SandboxSource {
  if (value === null || typeof value !== "object") return false;
  const v = value as { kind?: unknown; __brand?: unknown };
  return (
    (v.kind === "compose" && v.__brand === "niceeval.sandboxSource.compose") ||
    (v.kind === "dockerfile" && v.__brand === "niceeval.sandboxSource.dockerfile")
  );
}

/**
 * 自定义 case:强制纯数据 identity;materialize 必须返回唯一主 Sandbox。
 * 缺稳定身份时 `carryEligible` 为 false——禁止结果携带。
 */
export function defineSandboxCase(
  def: CustomCaseSandboxOptions,
): SandboxLayer<"template-bearing"> {
  return customCaseSandbox(def);
}

/** 规划期选中的 case:尚未物化,已带身份与携带资格。 */
export interface PlannedSandboxCase {
  readonly evalId: string;
  readonly profile: string;
  readonly caseKind: SandboxCaseKind;
  readonly sourceKind?: SandboxSourceKind;
  /** 显式 environments 表项优先时为 "environments",否则 "materializer"。 */
  readonly via: "environments" | "materializer" | "builtin" | "base";
  readonly caseKey: CaseKey;
  readonly buildKeys: readonly BuildKey[];
  readonly identity: JsonValue;
  readonly carryEligible: boolean;
  readonly declaration: PlannedCaseDeclaration;
}

export type PlannedCaseDeclaration =
  | { readonly form: "docker"; readonly value: DockerEnvironmentCase }
  | { readonly form: "e2b"; readonly value: E2BEnvironmentCase }
  | {
      readonly form: "dockerfile";
      readonly provider: "docker" | "e2b";
      readonly value: DockerfileSandboxSource;
    }
  | { readonly form: "vercel"; readonly value: VercelEnvironmentCase }
  | { readonly form: "source"; readonly value: SandboxSource; readonly materializer: SandboxMaterializer }
  | { readonly form: "base"; readonly provider: string; readonly product: JsonValue };

export type CasePlanResult =
  | { readonly status: "ready"; readonly plan: PlannedSandboxCase }
  | {
      readonly status: "unavailable";
      readonly gap: SandboxCasePlanningGap;
    };

export type SandboxCasePlanningGap =
  | {
      readonly code: "sandbox.locator-unavailable";
      readonly evalId: string;
      readonly profile: string;
      readonly provider: string;
      readonly summary: string;
      readonly actions: readonly string[];
    }
  | {
      readonly code: "sandbox.capability-unavailable";
      readonly evalId: string;
      readonly profile: string;
      readonly provider: string;
      readonly capability: { readonly _tag: "SourceMaterializer"; readonly sourceKind: SandboxSourceKind };
      readonly summary: string;
      readonly actions: readonly string[];
    };

export type SandboxCasePlanningGaps = readonly [
  SandboxCasePlanningGap,
  ...SandboxCasePlanningGap[],
];

export class SandboxCasePlanningError extends Data.TaggedError("SandboxCasePlanningError")<{
  readonly code: "sandbox.case-planning-failed";
  readonly provider: string;
  readonly gaps: SandboxCasePlanningGaps;
  readonly message: string;
}> {}

export interface PlanSandboxCaseInput {
  readonly evalId: string;
  /** 共享 profile id,或 folder-local SandboxSource。 */
  readonly environment?: string | SandboxSource;
  /**
   * folder-local source 的默认 profile id(通常是 eval 目录路径)。
   * 省略时用 evalId。
   */
  readonly defaultProfileId?: string;
  readonly spec: SandboxOption;
}

/** 从 SandboxSpec 读取 environments 表(中性,不认 provider 名)。 */
export function specEnvironments(
  spec: SandboxOption,
): Readonly<globalThis.Record<string, unknown>> | undefined {
  const environments = (spec as { environments?: unknown }).environments;
  if (typeof environments !== "object" || environments === null) return undefined;
  return environments as Readonly<globalThis.Record<string, unknown>>;
}

/** 从 SandboxSpec 读取 materializers 表。 */
export function specMaterializers(spec: SandboxOption): SandboxMaterializers | undefined {
  const materializers = (spec as { materializers?: unknown }).materializers;
  if (typeof materializers !== "object" || materializers === null) return undefined;
  return materializers as SandboxMaterializers;
}

/**
 * 规划一条 eval 的 sandbox case。
 * 优先级:显式 environments[profile] > materializers[source.kind] > 无 environment 时的基础产物。
 * locator / capability 两类 gap 分开返回，调用方对完整选中集合穷举后统一失败。
 */
export function planSandboxCase(input: PlanSandboxCaseInput): CasePlanResult {
  const { evalId, spec } = input;
  const environments = specEnvironments(spec);
  const materializers = specMaterializers(spec);

  if (input.environment === undefined) {
    const base = baseProductOf(spec);
    if (base === undefined) {
      return {
        status: "unavailable",
        gap: locatorGap({ evalId, profile: "(base)", provider: String(spec.provider) }),
      };
    }
    const identity = { caseKind: "prebuilt" as const, provider: spec.provider, product: base.product };
    const caseKey = computeCaseKey({
      caseKind: "prebuilt",
      materializerRevision: "base",
      buildKeys: [],
      caseParams: identity,
    });
    return {
      status: "ready",
      plan: {
        evalId,
        profile: "(base)",
        caseKind: "prebuilt",
        via: "base",
        caseKey,
        buildKeys: [],
        identity,
        carryEligible: true,
        declaration: { form: "base", provider: String(spec.provider), product: base.product },
      },
    };
  }

  if (isSandboxSource(input.environment)) {
    const source = input.environment;
    const profile = input.defaultProfileId ?? evalId;
    const explicit = environments?.[profile];
    if (explicit !== undefined) {
      return planFromEnvironmentEntry({ evalId, profile, spec, entry: explicit, via: "environments" });
    }
    const materializer = materializers?.[source.kind];
    if (materializer !== undefined) {
      return planFromSource({ evalId, profile, source, materializer });
    }
    if (source.kind === "dockerfile" && (spec.provider === "docker" || spec.provider === "e2b")) {
      return planFromBuiltinDockerfile({ evalId, profile, source, provider: spec.provider });
    }
    return {
      status: "unavailable",
      gap: capabilityGap({
        evalId,
        profile,
        sourceKind: source.kind,
        provider: String(spec.provider),
      }),
    };
  }

  const profile = input.environment;
  const explicit = environments?.[profile];
  if (explicit !== undefined) {
    return planFromEnvironmentEntry({ evalId, profile, spec, entry: explicit, via: "environments" });
  }

  // 纯 profile 字符串、表里没有、也没有 folder-local source → 键名笔误(配置错误)。
  return {
    status: "unavailable",
    gap: locatorGap({ evalId, profile, provider: String(spec.provider) }),
  };
}

/** 穷举完整规划集合中的 locator / capability gap；与 ready 条目混合时也不降级。 */
export function collectSandboxCasePlanningGaps(
  results: readonly CasePlanResult[],
): readonly SandboxCasePlanningGap[] {
  return Object.freeze(results.flatMap((result) => result.status === "unavailable" ? [result.gap] : []));
}

export function sandboxCasePlanningError(
  provider: string,
  gaps: SandboxCasePlanningGaps,
): SandboxCasePlanningError {
  const frozen = Object.freeze([
    gaps[0],
    ...gaps.slice(1),
  ] as [SandboxCasePlanningGap, ...SandboxCasePlanningGap[]]);
  return new SandboxCasePlanningError({
    code: "sandbox.case-planning-failed",
    provider,
    gaps: frozen,
    message:
      `Sandbox case planning failed for ${frozen.length} selected eval${frozen.length === 1 ? "" : "s"} ` +
      `on provider ${JSON.stringify(provider)}. No provider build or Sandbox creation was started.`,
  });
}

/**
 * 判别键合法性:同一表值只能有一个 case 判别键。
 * 在规划期调用;工厂也可在构造时调用。
 */
export function assertEnvironmentCaseShape(provider: string, entry: unknown, profile: string): void {
  if (entry === null || typeof entry !== "object") {
    throw new Error(`environments[${JSON.stringify(profile)}] must be an object`);
  }
  if (provider === "docker") {
    const keys = discriminantKeys(entry, ["image", "build", "compose"]);
    if (keys.length !== 1) {
      throw new Error(
        `environments[${JSON.stringify(profile)}] for docker must have exactly one of image | build | compose (got ${keys.join(", ") || "none"})`,
      );
    }
    decodeDockerEnvironmentCase(entry);
    return;
  }
  if (provider === "e2b") {
    const keys = discriminantKeys(entry, ["template", "build"]);
    if (keys.length !== 1) {
      throw new Error(
        `environments[${JSON.stringify(profile)}] for e2b must have exactly one of template | build (got ${keys.join(", ") || "none"})`,
      );
    }
    decodeE2BEnvironmentCase(entry);
    return;
  }
  if (provider === "vercel") {
    const keys = discriminantKeys(entry, ["snapshotId"]);
    if (keys.length !== 1) {
      throw new Error(
        `environments[${JSON.stringify(profile)}] for vercel must have snapshotId (got ${keys.join(", ") || "none"})`,
      );
    }
    decodeVercelEnvironmentCase(entry);
    return;
  }
  const record = jsonRecord(entry, `environment case for provider ${JSON.stringify(provider)}`);
  if (record.compose === undefined) {
    throw new Error(`unsupported environment case shape for provider ${JSON.stringify(provider)}`);
  }
}

function discriminantKeys(entry: object, keys: readonly string[]): string[] {
  return keys.filter((k) => (entry as globalThis.Record<string, unknown>)[k] !== undefined);
}

function locatorGap(opts: {
  evalId: string;
  profile: string;
  provider: string;
}): Extract<SandboxCasePlanningGap, { readonly code: "sandbox.locator-unavailable" }> {
  return Object.freeze({
    code: "sandbox.locator-unavailable",
    evalId: opts.evalId,
    profile: opts.profile,
    provider: opts.provider,
    summary:
      `eval ${JSON.stringify(opts.evalId)} references sandbox profile ${JSON.stringify(opts.profile)}, ` +
      `but provider ${JSON.stringify(opts.provider)} has no locator for it.`,
    actions: Object.freeze([
      "Add the profile to the provider environments table, or select a template with an available locator.",
    ]),
  });
}

function capabilityGap(opts: {
  evalId: string;
  profile: string;
  sourceKind: SandboxSourceKind;
  provider: string;
}): Extract<SandboxCasePlanningGap, { readonly code: "sandbox.capability-unavailable" }> {
  return Object.freeze({
    code: "sandbox.capability-unavailable",
    evalId: opts.evalId,
    profile: opts.profile,
    provider: opts.provider,
    capability: Object.freeze({ _tag: "SourceMaterializer", sourceKind: opts.sourceKind }),
    summary:
      `eval ${JSON.stringify(opts.evalId)} profile ${JSON.stringify(opts.profile)} needs source kind ` +
      `${JSON.stringify(opts.sourceKind)}, but provider ${JSON.stringify(opts.provider)} cannot materialize it.`,
    actions: Object.freeze([
      `Add environments[${JSON.stringify(opts.profile)}], register materializers.${opts.sourceKind}, or exclude this pair with a selector.`,
    ]),
  });
}

function planFromSource(opts: {
  evalId: string;
  profile: string;
  source: SandboxSource;
  materializer: SandboxMaterializer;
}): CasePlanResult {
  const caseKind: SandboxCaseKind = opts.source.kind === "compose" ? "compose" : "on-demand-build";
  const identity = {
    caseKind,
    sourceKind: opts.source.kind,
    source: sourceIdentity(opts.source),
    materializerRevision: opts.materializer.revision,
  };
  const caseKey = computeCaseKey({
    caseKind,
    materializerRevision: opts.materializer.revision,
    buildKeys: [],
    caseParams: identity,
  });
  return {
    status: "ready",
    plan: {
      evalId: opts.evalId,
      profile: opts.profile,
      caseKind,
      sourceKind: opts.source.kind,
      via: "materializer",
      caseKey,
      buildKeys: [],
      identity,
      carryEligible: true,
      declaration: { form: "source", value: opts.source, materializer: opts.materializer },
    },
  };
}

function planFromBuiltinDockerfile(opts: {
  readonly evalId: string;
  readonly profile: string;
  readonly source: DockerfileSandboxSource;
  readonly provider: "docker" | "e2b";
}): CasePlanResult {
  const identity = {
    caseKind: "on-demand-build" as const,
    sourceKind: "dockerfile" as const,
    provider: opts.provider,
    source: sourceIdentity(opts.source),
  };
  const caseKey = computeCaseKey({
    caseKind: "on-demand-build",
    materializerRevision: `${opts.provider}:dockerfile`,
    buildKeys: [],
    caseParams: identity,
  });
  return {
    status: "ready",
    plan: {
      evalId: opts.evalId,
      profile: opts.profile,
      caseKind: "on-demand-build",
      sourceKind: "dockerfile",
      via: "builtin",
      caseKey,
      buildKeys: [],
      identity,
      carryEligible: true,
      declaration: { form: "dockerfile", provider: opts.provider, value: opts.source },
    },
  };
}

function sourceIdentity(source: SandboxSource): JsonValue {
  if (source.kind === "compose") {
    return {
      kind: "compose",
      file: typeof source.file === "string" ? source.file : source.file.href,
      mainService: source.mainService,
      ...(source.build !== undefined ? { build: source.build } : {}),
      ...(source.executionUser !== undefined ? { executionUser: source.executionUser } : {}),
      // 只记键名:值常含 attempt 临时目录,不能进身份。
      ...(source.env !== undefined ? { envNames: Object.keys(source.env).sort() } : {}),
    };
  }
  return {
    kind: "dockerfile",
    context: typeof source.context === "string" ? source.context : source.context.href,
    ...(source.dockerfile !== undefined ? { dockerfile: source.dockerfile } : {}),
    ...(source.buildArgs !== undefined ? { buildArgs: source.buildArgs } : {}),
  };
}

function planFromEnvironmentEntry(opts: {
  evalId: string;
  profile: string;
  spec: SandboxOption;
  entry: unknown;
  via: "environments";
}): CasePlanResult {
  assertEnvironmentCaseShape(String(opts.spec.provider), opts.entry, opts.profile);

  const classified = classifyBuiltinCase(String(opts.spec.provider), opts.entry);
  const identity = { caseKind: classified.caseKind, provider: opts.spec.provider, declaration: classified.identity };
  const caseKey = computeCaseKey({
    caseKind: classified.caseKind,
    materializerRevision: `${opts.spec.provider}:${classified.caseKind}`,
    buildKeys: [],
    caseParams: identity,
  });
  return {
    status: "ready",
    plan: {
      evalId: opts.evalId,
      profile: opts.profile,
      caseKind: classified.caseKind,
      via: opts.via,
      caseKey,
      buildKeys: [],
      identity,
      carryEligible: true,
      declaration: classified.declaration,
    },
  };
}

function classifyBuiltinCase(
  provider: string,
  entry: unknown,
): {
  caseKind: SandboxCaseKind;
  identity: JsonValue;
  declaration: PlannedCaseDeclaration;
} {
  if (provider === "docker") {
    const declaration = decodeDockerEnvironmentCase(entry);
    if (declaration.compose !== undefined) {
      const compose = declaration.compose;
      return {
        caseKind: "compose",
        identity: { compose: jsonDockerComposeDecl(compose) },
        declaration: { form: "docker", value: declaration },
      };
    }
    if (declaration.build !== undefined) {
      return {
        caseKind: "on-demand-build",
        identity: { build: jsonDockerBuildDecl(declaration.build) },
        declaration: { form: "docker", value: declaration },
      };
    }
    return {
      caseKind: "prebuilt",
      identity: { image: declaration.image },
      declaration: { form: "docker", value: declaration },
    };
  }
  if (provider === "e2b") {
    const declaration = decodeE2BEnvironmentCase(entry);
    if (declaration.build !== undefined) {
      return {
        caseKind: "on-demand-build",
        identity: {
          build: {
            context: declaration.build.context,
            ...(declaration.build.dockerfile !== undefined ? { dockerfile: declaration.build.dockerfile } : {}),
          },
        },
        declaration: { form: "e2b", value: declaration },
      };
    }
    return {
      caseKind: "prebuilt",
      identity: { template: declaration.template },
      declaration: { form: "e2b", value: declaration },
    };
  }
  if (provider === "vercel") {
    const declaration = decodeVercelEnvironmentCase(entry);
    return {
      caseKind: "prebuilt",
      identity: { snapshotId: declaration.snapshotId },
      declaration: { form: "vercel", value: declaration },
    };
  }
  const e = jsonRecord(entry, `environment case for provider ${JSON.stringify(provider)}`);
  // 云端 Compose 表值由声明支持的云 provider 自定;内核只认「带 compose 判别键」这一形状,
  // 物化必须走该 provider 注册的 materializer(不得在此降级成单 Sandbox)。
  if (e.compose !== undefined) {
    return {
      caseKind: "cloud-compose",
      identity: e,
      declaration: {
        form: "base",
        provider,
        product: { ...e, caseKind: "cloud-compose" },
      },
    };
  }
  throw new Error(`unsupported environment case shape for provider ${JSON.stringify(provider)}`);
}

function jsonRecord(value: unknown, path: string): globalThis.Record<string, JsonValue> {
  const json = assertPureDataIdentity(value);
  if (json === null || Array.isArray(json) || typeof json !== "object") {
    throw new Error(`${path} must be a JSON object`);
  }
  return json;
}

function assertOnlyKeys(
  value: globalThis.Record<string, JsonValue>,
  allowed: readonly string[],
  path: string,
): void {
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new Error(`${path} has unsupported field(s): ${extra.join(", ")}`);
}

function requiredString(value: globalThis.Record<string, JsonValue>, key: string, path: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`${path}.${key} must be a string`);
  return field;
}

function optionalString(
  value: globalThis.Record<string, JsonValue>,
  key: string,
  path: string,
): string | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  if (typeof field !== "string") throw new Error(`${path}.${key} must be a string`);
  return field;
}

function optionalStringRecord(
  value: globalThis.Record<string, JsonValue>,
  key: string,
  path: string,
): Readonly<globalThis.Record<string, string>> | undefined {
  const field = value[key];
  if (field === undefined) return undefined;
  const record = jsonRecord(field, `${path}.${key}`);
  const strings: globalThis.Record<string, string> = {};
  for (const [entryKey, entryValue] of Object.entries(record)) {
    if (typeof entryValue !== "string") throw new Error(`${path}.${key}.${entryKey} must be a string`);
    strings[entryKey] = entryValue;
  }
  return strings;
}

function decodeDockerBuildDecl(value: unknown, path: string): DockerBuildDecl {
  const record = jsonRecord(value, path);
  assertOnlyKeys(record, ["context", "dockerfile", "args", "target"], path);
  const dockerfile = optionalString(record, "dockerfile", path);
  const args = optionalStringRecord(record, "args", path);
  const target = optionalString(record, "target", path);
  return {
    context: requiredString(record, "context", path),
    ...(dockerfile !== undefined ? { dockerfile } : {}),
    ...(args !== undefined ? { args } : {}),
    ...(target !== undefined ? { target } : {}),
  };
}

function decodeDockerComposeDecl(value: unknown, path: string): DockerComposeDecl {
  const record = jsonRecord(value, path);
  assertOnlyKeys(record, ["file", "mainService", "env", "projectName"], path);
  const env = optionalStringRecord(record, "env", path);
  const projectName = optionalString(record, "projectName", path);
  return {
    file: requiredString(record, "file", path),
    mainService: requiredString(record, "mainService", path),
    ...(env !== undefined ? { env } : {}),
    ...(projectName !== undefined ? { projectName } : {}),
  };
}

function decodeDockerEnvironmentCase(value: unknown): DockerEnvironmentCase {
  const record = jsonRecord(value, "docker environment case");
  assertOnlyKeys(record, ["image", "build", "compose"], "docker environment case");
  if (record.compose !== undefined) {
    return { compose: decodeDockerComposeDecl(record.compose, "docker environment case.compose") };
  }
  if (record.build !== undefined) {
    return { build: decodeDockerBuildDecl(record.build, "docker environment case.build") };
  }
  return { image: requiredString(record, "image", "docker environment case") };
}

function decodeE2BEnvironmentCase(value: unknown): E2BEnvironmentCase {
  const record = jsonRecord(value, "e2b environment case");
  assertOnlyKeys(record, ["template", "build"], "e2b environment case");
  if (record.build !== undefined) {
    const build = jsonRecord(record.build, "e2b environment case.build");
    assertOnlyKeys(build, ["context", "dockerfile"], "e2b environment case.build");
    const dockerfile = optionalString(build, "dockerfile", "e2b environment case.build");
    return {
      build: {
        context: requiredString(build, "context", "e2b environment case.build"),
        ...(dockerfile !== undefined ? { dockerfile } : {}),
      },
    };
  }
  return { template: requiredString(record, "template", "e2b environment case") };
}

function decodeVercelEnvironmentCase(value: unknown): VercelEnvironmentCase {
  const record = jsonRecord(value, "vercel environment case");
  assertOnlyKeys(record, ["snapshotId"], "vercel environment case");
  return { snapshotId: requiredString(record, "snapshotId", "vercel environment case") };
}

function jsonDockerBuildDecl(value: DockerBuildDecl): JsonValue {
  return {
    context: value.context,
    ...(value.dockerfile !== undefined ? { dockerfile: value.dockerfile } : {}),
    ...(value.args !== undefined ? { args: { ...value.args } } : {}),
    ...(value.target !== undefined ? { target: value.target } : {}),
  };
}

function jsonDockerComposeDecl(value: DockerComposeDecl): JsonValue {
  return {
    file: value.file,
    mainService: value.mainService,
    ...(value.env !== undefined ? { env: { ...value.env } } : {}),
    ...(value.projectName !== undefined ? { projectName: value.projectName } : {}),
  };
}

function baseProductOf(spec: SandboxSpec): { product: JsonValue } | undefined {
  if (spec.provider === "docker") {
    const image = (spec as { image?: string }).image;
    if (image !== undefined) return { product: { image } };
    // 省略 image 时 docker 仍有默认 runtime 镜像——基础产物存在。
    return { product: { image: "(runtime-default)" } };
  }
  if (spec.provider === "e2b") {
    const template = (spec as { template?: string }).template ?? "base";
    return { product: { template } };
  }
  if (spec.provider === "vercel") {
    const snapshotId = (spec as { snapshotId?: string }).snapshotId;
    if (snapshotId === undefined) return undefined;
    return { product: { snapshotId } };
  }
  if (spec.provider === "local") {
    const dir = (spec as { dir?: string }).dir;
    return { product: dir !== undefined ? { dir } : { dir: "(git-root)" } };
  }
  return { product: { provider: spec.provider } };
}

/**
 * 把 PlannedSandboxCase 物化成主 Sandbox + 可选能力句柄 + 资源组。
 * - prebuilt / base:调用方传入已创建的主 Sandbox;
 * - custom / source materializer:走声明的 materialize;
 * - docker Compose environments 表项:走 compose.ts 原生物化,不得用 primarySandbox 降级;
 * - cloud-compose 无物化器时拒绝降级。
 */
export async function materializePlannedCase(
  plan: PlannedSandboxCase,
  opts: {
    readonly ctx: SandboxMaterializeContext;
    /** prebuilt / base 路径:调用方(或后续协调器)提供已就绪的主 Sandbox。 */
    readonly primarySandbox?: Sandbox;
    readonly baseDir?: string;
    readonly timeout?: number;
    readonly feedback?: import("../types.ts").ScopedFeedback;
  },
): Promise<MaterializedSandboxCase> {
  const decl = plan.declaration;

  if (decl.form === "source") {
    return decl.materializer.materialize(decl.value, opts.ctx);
  }

  if (plan.caseKind === "compose" && decl.form === "docker") {
    const { materializeDockerComposeCase } = await import("./compose.ts");
    return materializeDockerComposeCase(plan, {
      ctx: opts.ctx,
      ...(opts.baseDir !== undefined ? { baseDir: opts.baseDir } : {}),
      ...(opts.timeout !== undefined ? { timeout: opts.timeout } : {}),
      ...(opts.feedback !== undefined ? { feedback: opts.feedback } : {}),
    });
  }

  if (plan.caseKind === "compose" || plan.caseKind === "cloud-compose") {
    throw new Error(
      `sandbox case kind ${JSON.stringify(plan.caseKind)} for ${JSON.stringify(plan.evalId)} ` +
        `requires a Compose materializer — refusing to degrade to a single Sandbox`,
    );
  }

  if (plan.caseKind === "on-demand-build" && opts.primarySandbox === undefined) {
    throw new Error(
      `sandbox case kind "on-demand-build" for ${JSON.stringify(plan.evalId)} ` +
        `needs build locators from the run build coordinator before materialization`,
    );
  }

  if (opts.primarySandbox === undefined) {
    throw new Error(`materializePlannedCase requires primarySandbox for case kind ${JSON.stringify(plan.caseKind)}`);
  }

  return wrapPrimaryOnly(plan, opts.primarySandbox);
}

function wrapPrimaryOnly(plan: PlannedSandboxCase, sandbox: Sandbox): MaterializedSandboxCase {
  const group: SandboxResourceGroup = {
    primary: { sandboxId: sandbox.sandboxId },
    resources: { kind: "primary-only", sandboxId: sandbox.sandboxId },
    async stop() {
      await sandbox.stop();
    },
  };
  return {
    sandbox,
    group,
    caseKind: plan.caseKind,
    caseKey: plan.caseKey,
    buildKeys: plan.buildKeys,
    identity: plan.identity,
    carryEligible: plan.carryEligible,
    facts: { sandboxId: sandbox.sandboxId },
  };
}

/**
 * 构造期校验:environments 表里每条声明的判别键合法。
 * 供 dockerSandbox / e2bSandbox / … 工厂或规划入口调用。
 */
export function validateSpecEnvironmentCases(spec: SandboxOption): void {
  const environments = specEnvironments(spec);
  if (environments === undefined) return;
  for (const [profile, entry] of Object.entries(environments)) {
    assertEnvironmentCaseShape(String(spec.provider), entry, profile);
  }
}
