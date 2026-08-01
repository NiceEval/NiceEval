// SandboxLayer 作者声明面：不可变 prepare 链，以及由具体 factory 私下绑定的 Provider planner。
// Link 只消费 template 的纯数据 identity；planner callback 保存在 WeakMap 中，不进入声明或指纹。

import { isAbsolute, resolve } from "node:path";
import { Data, Effect, Option } from "effect";
import type { JsonValue } from "../shared/types.ts";
import type { ScopedFeedback } from "../shared/types.ts";
import type {
  SandboxMaterializeContext,
  SandboxResourceGroup,
  ServiceController,
} from "./case-types.ts";
import type { Sandbox, SandboxRuntime } from "./types.ts";
import type { SandboxCommand, SandboxCommandDeclaration } from "./commands.ts";
import { sandboxCommandDeclarationOf } from "./commands.ts";
import {
  collectComposeBuilds,
  COMPOSE_MATERIALIZER_REVISION,
  composeCollectionIdentity,
  detectDockerBuildPlatform,
  normalizeBuildPlatform,
} from "./compose.ts";
import { digestOf, looksLikeDigestRef } from "./identity.ts";
import {
  DOCKERFILE_MATERIALIZER_REVISION,
  resolveDockerfileBuildIdentity,
} from "./dockerfile-identity.ts";

export type SandboxLayerKind = "template-bearing" | "command-only";

const SANDBOX_LAYER: unique symbol = Symbol("niceeval.sandbox.layer");
const SANDBOX_LAYERS = new WeakSet<object>();
const SANDBOX_LAYER_STATES = new WeakMap<object, SandboxLayerState>();
const SANDBOX_TEMPLATE_PLANNERS = new WeakMap<object, SandboxTemplatePlanner>();
const SANDBOX_TEMPLATE_RUNTIMES = new WeakMap<object, CustomSandboxTemplateRuntime>();
const SANDBOX_PROVIDER_RUNTIMES = new WeakMap<object, SandboxRuntimePlan>();

export interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  readonly [SANDBOX_LAYER]: Kind;
  prepare(command: SandboxCommand): SandboxLayer<Kind>;
}

export interface DockerComposeSandboxOptions {
  readonly file: string | URL;
  readonly workspaceService: string;
  readonly build?: "on-demand" | "prebuilt";
  readonly executionUser?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  /** Compose 插值所需凭据；value 只进私有 runtime binding，identity 只认变量名与 revision。 */
  readonly credentialEnv?: Readonly<
    globalThis.Record<string, { readonly value: string; readonly revision?: string }>
  >;
}

export interface DockerfileSandboxOptions {
  readonly context: string | URL;
  readonly dockerfile?: string;
  readonly buildArgs?: Readonly<globalThis.Record<string, string>>;
}

export interface DockerImageSandboxOptions {
  readonly image: string;
}

export interface E2BSandboxOptions {
  readonly template: string;
  readonly lifetimeMs?: number;
}

export interface VercelSandboxOptions {
  readonly snapshotId: string;
  readonly lifetimeMs?: number;
}

export interface LocalSandboxOptions {
  readonly dir?: string;
}

export interface CustomProviderSandboxOptions {
  readonly name: string;
  readonly targetPlatform: SandboxTargetPlatform;
  readonly recommendedConcurrency?: number;
  readonly exclusive?: boolean;
  readonly create: (options: {
    readonly timeout?: number;
    readonly deadlineAt?: number;
    readonly runtime?: SandboxRuntime;
    readonly feedback: ScopedFeedback;
  }) => Promise<Sandbox>;
}

export interface CustomCaseSandboxOptions {
  readonly identity: JsonValue;
  readonly targetPlatform: SandboxTargetPlatform;
  readonly services?: boolean;
  readonly materialize: (context: SandboxMaterializeContext) => Promise<{
    readonly sandbox: Sandbox;
    readonly group: SandboxResourceGroup;
    readonly services?: ServiceController;
    readonly facts?: JsonValue;
  }>;
}

export type SandboxLocation =
  | { readonly _tag: "Path"; readonly value: string }
  | { readonly _tag: "Url"; readonly value: string };

/**
 * Discovery 泄题门唯一消费的 provider-neutral 声明。它只描述需要检查的作者输入，
 * 不要求 discovery 解读 provider identity，也不把「缺字段」当作一种状态。
 */
export type SandboxLeakGate =
  | { readonly _tag: "None" }
  | {
      readonly _tag: "Dockerfile";
      readonly context: SandboxLocation;
      readonly dockerfile: string;
    }
  | {
      readonly _tag: "Compose";
      readonly file: SandboxLocation;
      readonly workspaceService: string;
    };

export type SandboxTargetPlatform =
  | { readonly _tag: "Linux"; readonly os: "linux"; readonly arch: string; readonly libc: "gnu" | "musl" }
  | { readonly _tag: "Darwin"; readonly os: "darwin"; readonly arch: string }
  | { readonly _tag: "Windows"; readonly os: "windows"; readonly arch: string };

export type SandboxPlanningSource = "docker-daemon" | "provider-standard" | "host" | "provider-defined";

export interface SandboxPlannedTarget {
  readonly platform: SandboxTargetPlatform;
  readonly source: SandboxPlanningSource;
}

export type SandboxAdmission =
  | { readonly _tag: "Shared" }
  | { readonly _tag: "Exclusive" };

export interface SandboxProviderScheduling {
  readonly recommendedConcurrency: number;
  readonly lane: {
    readonly key: string;
    readonly limit: number;
  };
  readonly admission: SandboxAdmission;
}

/**
 * Provider-owned runtime adapter 的中性定位数据。Runner 不解析 input，也不按 provider 名分支；
 * 物化边界把 adapter + input 原样交回注册该 adapter 的 provider 模块。
 */
export interface SandboxRuntimePlan {
  readonly adapter: string;
  readonly input: JsonValue;
}

/**
 * physical planning 的唯一完成态。整个对象都可发布、可序列化；provider 私有的 runtime input
 * 只存在于 plan-keyed runtime binding，不会因调用方误做 `JSON.stringify(plan)` 而落盘。
 */
export interface SandboxProviderPlan {
  readonly provider: string;
  readonly plannerRevision: string;
  readonly caseKind: string;
  readonly target: SandboxPlannedTarget;
  readonly scheduling: SandboxProviderScheduling;
  readonly runtimeAdapter: string;
  readonly carry: SandboxTemplateCarry;
  readonly identity: JsonValue;
}

export interface SandboxProviderPlanInput {
  readonly provider: string;
  readonly plannerRevision: string;
  readonly caseKind: string;
  readonly target: SandboxPlannedTarget;
  readonly scheduling: SandboxProviderScheduling;
  readonly runtime: SandboxRuntimePlan;
  /** physical planning 才能裁决的动态携带资格；省略表示可携带。 */
  readonly carry?: SandboxTemplateCarry;
  /** 可直接出现在 record / manifest 的 provider-owned 纯数据。 */
  readonly publishableIdentity: JsonValue;
  /** 影响 fingerprint 但不得落盘的值；plan 只保存它的稳定摘要。 */
  readonly privateFingerprintIdentity: JsonValue;
}

export class SandboxProviderPlanningError extends Data.TaggedError(
  "SandboxProviderPlanningError",
)<{
  readonly code: string;
  readonly provider: string;
  readonly summary: string;
  readonly actions: readonly string[];
}> {}

export interface SandboxTemplatePlanningInput {
  readonly authorBaseDir: string;
}

export type SandboxTemplatePlanner = (
  input: SandboxTemplatePlanningInput,
) => Effect.Effect<SandboxProviderPlan, SandboxProviderPlanningError>;

/** Template 声明只暴露 link 与 fingerprint 所需纯数据；planner 在 WeakMap 中私有绑定。 */
export interface SandboxTemplateDeclaration {
  readonly provider: string;
  readonly kind: string;
  readonly identity: JsonValue;
  readonly carry: SandboxTemplateCarry;
  readonly leakGate: SandboxLeakGate;
}

export type SandboxTemplateCarry =
  | { readonly _tag: "Eligible" }
  | { readonly _tag: "Ineligible"; readonly code: string; readonly reason: string };

export interface SandboxTemplateDefinition {
  readonly provider: string;
  readonly kind: string;
  /** 可直接进入 pair-owned record projection 的 provider-owned 纯数据。 */
  readonly publishableIdentity: JsonValue;
  /** 影响 template identity 但不得直接进入 link / record 的作者输入。 */
  readonly privateFingerprintIdentity: JsonValue;
  readonly plan: SandboxTemplatePlanner;
  readonly leakGate: SandboxLeakGate;
  readonly runtime?: CustomSandboxTemplateRuntime;
  readonly carry?: SandboxTemplateCarry;
}

export type CustomSandboxTemplateRuntime =
  | { readonly _tag: "CustomProvider"; readonly create: CustomProviderSandboxOptions["create"] }
  | { readonly _tag: "CustomCase"; readonly materialize: CustomCaseSandboxOptions["materialize"] };

export type CustomSandboxTemplateRuntimeBinding =
  | { readonly _tag: "Unbound" }
  | { readonly _tag: "Bound"; readonly runtime: CustomSandboxTemplateRuntime };

/** Effect Option 明确表达非法伪造 plan 的无绑定状态；合法 planner 产物恒为 Some。 */
export type SandboxProviderRuntimeBinding = Option.Option<SandboxRuntimePlan>;

export interface BuiltinSandboxPlannerServices {
  /** 只读 control-plane 探测；测试可注入确定值或 typed failure。 */
  readonly dockerBuildPlatform: Effect.Effect<string, SandboxProviderPlanningError>;
  readonly hostPlatform: SandboxTargetPlatform;
}

export interface BuiltinSandboxFactories {
  readonly dockerComposeSandbox: (
    options: DockerComposeSandboxOptions,
  ) => SandboxLayer<"template-bearing">;
  readonly dockerfileSandbox: (
    options: DockerfileSandboxOptions,
  ) => SandboxLayer<"template-bearing">;
  readonly dockerImageSandbox: (
    options: DockerImageSandboxOptions,
  ) => SandboxLayer<"template-bearing">;
  readonly e2bSandbox: (options: E2BSandboxOptions) => SandboxLayer<"template-bearing">;
  readonly vercelSandbox: (options: VercelSandboxOptions) => SandboxLayer<"template-bearing">;
  readonly localSandbox: (options?: LocalSandboxOptions) => SandboxLayer<"template-bearing">;
}

export interface CommandOnlySandboxLayerState {
  readonly kind: "command-only";
  readonly commands: readonly SandboxCommandDeclaration[];
}

export interface TemplateBearingSandboxLayerState {
  readonly kind: "template-bearing";
  readonly template: SandboxTemplateDeclaration;
  readonly commands: readonly SandboxCommandDeclaration[];
}

export type SandboxLayerState<Kind extends SandboxLayerKind = SandboxLayerKind> =
  Kind extends "command-only" ? CommandOnlySandboxLayerState : TemplateBearingSandboxLayerState;

type SandboxLayerRuntime<Kind extends SandboxLayerKind> = SandboxLayer<Kind>;

function freezeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const children: JsonValue[] = value.map(freezeJson);
    Object.freeze(children);
    return children;
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, freezeJson(child)]),
  ));
}

function freezePlatform(platform: SandboxTargetPlatform): SandboxTargetPlatform {
  return Object.freeze({ ...platform });
}

function freezeTarget(target: SandboxPlannedTarget): SandboxPlannedTarget {
  return Object.freeze({ platform: freezePlatform(target.platform), source: target.source });
}

function freezeLocation(value: SandboxLocation): SandboxLocation {
  return Object.freeze({ _tag: value._tag, value: value.value });
}

function freezeLeakGate(value: SandboxLeakGate): SandboxLeakGate {
  switch (value._tag) {
    case "None":
      return Object.freeze({ _tag: "None" });
    case "Dockerfile":
      return Object.freeze({
        _tag: "Dockerfile",
        context: freezeLocation(value.context),
        dockerfile: nonEmptyString(value.dockerfile, "sandbox leakGate.dockerfile"),
      });
    case "Compose":
      return Object.freeze({
        _tag: "Compose",
        file: freezeLocation(value.file),
        workspaceService: nonEmptyString(value.workspaceService, "sandbox leakGate.workspaceService"),
      });
  }
}

function freezeScheduling(scheduling: SandboxProviderScheduling): SandboxProviderScheduling {
  if (!Number.isInteger(scheduling.recommendedConcurrency) || scheduling.recommendedConcurrency <= 0) {
    throw new TypeError("sandbox provider recommendedConcurrency must be a positive integer");
  }
  if (!Number.isInteger(scheduling.lane.limit) || scheduling.lane.limit <= 0) {
    throw new TypeError("sandbox provider scheduling lane limit must be a positive integer");
  }
  return Object.freeze({
    recommendedConcurrency: scheduling.recommendedConcurrency,
    lane: Object.freeze({
      key: nonEmptyString(scheduling.lane.key, "sandbox provider scheduling lane.key"),
      limit: scheduling.lane.limit,
    }),
    admission: Object.freeze({ _tag: scheduling.admission._tag }),
  });
}

/** Provider planner 统一用本 helper 构造完整、冻结、可安全发布的计划。 */
export function sandboxProviderPlan(input: SandboxProviderPlanInput): SandboxProviderPlan {
  const provider = nonEmptyString(input.provider, "sandbox provider plan.provider");
  const plannerRevision = nonEmptyString(input.plannerRevision, "sandbox provider plan.plannerRevision");
  const caseKind = nonEmptyString(input.caseKind, "sandbox provider plan.caseKind");
  const target = freezeTarget(input.target);
  const scheduling = freezeScheduling(input.scheduling);
  const runtime = Object.freeze({
    adapter: nonEmptyString(input.runtime.adapter, "sandbox provider plan.runtime.adapter"),
    input: freezeJson(input.runtime.input),
  });
  const carry = input.carry === undefined
    ? Object.freeze({ _tag: "Eligible" as const })
    : Object.freeze({ ...input.carry });
  const publishableIdentity = freezeJson(input.publishableIdentity);
  const privateIdentityDigest = digestOf(input.privateFingerprintIdentity);
  const identity = freezeJson({
    version: 2,
    provider,
    plannerRevision,
    caseKind,
    target: targetIdentity(target),
    scheduling: {
      recommendedConcurrency: scheduling.recommendedConcurrency,
      lane: { key: scheduling.lane.key, limit: scheduling.lane.limit },
      admission: { _tag: scheduling.admission._tag },
    },
    runtimeAdapter: runtime.adapter,
    carry,
    publishable: publishableIdentity,
    privateIdentityDigest,
  });
  const plan = Object.freeze({
    provider,
    plannerRevision,
    caseKind,
    target,
    scheduling,
    runtimeAdapter: runtime.adapter,
    carry,
    identity,
  });
  SANDBOX_PROVIDER_RUNTIMES.set(plan, runtime);
  return plan;
}

/** @internal materializer 取得 provider 私有 runtime input；完成态 planner 产物恒为 Some。 */
export function sandboxProviderRuntimeOf(plan: SandboxProviderPlan): SandboxProviderRuntimeBinding {
  return Option.fromNullable(SANDBOX_PROVIDER_RUNTIMES.get(plan));
}

function targetIdentity(target: SandboxPlannedTarget): JsonValue {
  const platform = target.platform;
  return {
    source: target.source,
    platform: platform._tag === "Linux"
      ? { _tag: "Linux", os: "linux", arch: platform.arch, libc: platform.libc }
      : { _tag: platform._tag, os: platform.os, arch: platform.arch },
  };
}

function assertRecord(value: unknown, path: string): asserts value is globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
}

function assertOnlyKeys(value: globalThis.Record<string, unknown>, allowed: readonly string[], path: string): void {
  const known = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!known.has(key)) throw new TypeError(`${path}.${key} is not supported`);
  }
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${path} must be a non-empty string`);
  }
  return value;
}

function location(value: unknown, path: string): SandboxLocation {
  if (value instanceof URL) return Object.freeze({ _tag: "Url", value: value.href });
  return Object.freeze({ _tag: "Path", value: nonEmptyString(value, path) });
}

function plannedLocation(location: SandboxLocation, authorBaseDir: string): SandboxLocation {
  return location._tag === "Url"
    ? location
    : Object.freeze({ _tag: "Path", value: resolve(authorBaseDir, location.value) });
}

function lifetime(value: unknown, path: string): JsonValue {
  if (value === undefined) return Object.freeze({ _tag: "ProviderDefault" });
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive finite number`);
  }
  return Object.freeze({ _tag: "Configured", milliseconds: value });
}

function stringRecord(value: unknown, path: string): Readonly<globalThis.Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  assertRecord(value, path);
  const result: globalThis.Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "") throw new TypeError(`${path} keys must be non-empty strings`);
    if (typeof child !== "string") throw new TypeError(`${path}.${key} must be a string`);
    result[key] = child;
  }
  return Object.freeze(result);
}

function credentialEnvRecord(
  value: unknown,
  path: string,
): Readonly<globalThis.Record<string, { readonly value: string; readonly revision?: string }>> {
  if (value === undefined) return Object.freeze({});
  assertRecord(value, path);
  const result: globalThis.Record<string, { readonly value: string; readonly revision?: string }> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "") throw new TypeError(`${path} keys must be non-empty strings`);
    assertRecord(child, `${path}.${key}`);
    assertOnlyKeys(child, ["value", "revision"], `${path}.${key}`);
    const credential = {
      value: nonEmptyString(child.value, `${path}.${key}.value`),
      ...(child.revision === undefined
        ? {}
        : { revision: nonEmptyString(child.revision, `${path}.${key}.revision`) }),
    };
    result[key] = Object.freeze(credential);
  }
  return Object.freeze(result);
}

function normalizeArch(arch: string): string {
  return arch === "amd64" || arch === "x86_64" || arch === "x64"
    ? "x64"
    : arch === "aarch64" ? "arm64" : arch;
}

function targetFromDocker(value: string): Effect.Effect<SandboxPlannedTarget, SandboxProviderPlanningError> {
  const normalized = normalizeBuildPlatform(value);
  const [os, arch, extra] = normalized.split("/");
  if (os === undefined || arch === undefined || extra !== undefined || os === "" || arch === "") {
    return Effect.fail(providerPlanningError(
      "sandbox.target-platform-invalid",
      "docker",
      `Docker returned an invalid target platform ${JSON.stringify(value)}.`,
      ["Configure DOCKER_DEFAULT_PLATFORM as os/arch or repair the Docker daemon response."],
    ));
  }
  const platform: SandboxTargetPlatform = os === "linux"
    ? { _tag: "Linux", os: "linux", arch: normalizeArch(arch), libc: "gnu" }
    : os === "darwin"
      ? { _tag: "Darwin", os: "darwin", arch: normalizeArch(arch) }
      : os === "windows"
        ? { _tag: "Windows", os: "windows", arch: normalizeArch(arch) }
        : { _tag: "Linux", os: "linux", arch: normalizeArch(arch), libc: "gnu" };
  if (os !== "linux" && os !== "darwin" && os !== "windows") {
    return Effect.fail(providerPlanningError(
      "sandbox.target-platform-unsupported",
      "docker",
      `Docker target operating system ${JSON.stringify(os)} is not supported.`,
      ["Use a Linux, Darwin, or Windows Docker target platform."],
    ));
  }
  return Effect.succeed(Object.freeze({ platform: freezePlatform(platform), source: "docker-daemon" }));
}

/** Provider target ADT → Docker builder 使用的 canonical os/arch 字符串。 */
function plannedTargetPlatform(target: SandboxPlannedTarget): string {
  const arch = target.platform.arch === "x64" ? "amd64" : target.platform.arch;
  return normalizeBuildPlatform(`${target.platform.os}/${arch}`);
}

function providerPlanningError(
  code: string,
  provider: string,
  summary: string,
  actions: readonly string[],
): SandboxProviderPlanningError {
  return new SandboxProviderPlanningError({
    code,
    provider,
    summary,
    actions: Object.freeze([...actions]),
  });
}

function createLayer(state: CommandOnlySandboxLayerState): SandboxLayer<"command-only">;
function createLayer(state: TemplateBearingSandboxLayerState): SandboxLayer<"template-bearing">;
function createLayer(state: SandboxLayerState): SandboxLayer {
  const frozenCommands = Object.freeze([...state.commands]);
  const frozenState = state.kind === "command-only"
    ? Object.freeze({ kind: "command-only" as const, commands: frozenCommands })
    : Object.freeze({ kind: "template-bearing" as const, template: state.template, commands: frozenCommands });
  const layer = {
    prepare(command: SandboxCommand): SandboxLayer {
      const declaration = sandboxCommandDeclarationOf(command);
      return frozenState.kind === "command-only"
        ? createLayer({ kind: "command-only", commands: [...frozenCommands, declaration] })
        : createLayer({
            kind: "template-bearing",
            template: frozenState.template,
            commands: [...frozenCommands, declaration],
          });
    },
  } as SandboxLayerRuntime<SandboxLayerKind>;
  Object.defineProperty(layer, SANDBOX_LAYER, { value: frozenState.kind });
  SANDBOX_LAYERS.add(layer);
  SANDBOX_LAYER_STATES.set(layer, frozenState);
  return Object.freeze(layer);
}

export function sandboxLayer(): SandboxLayer<"command-only"> {
  return createLayer({ kind: "command-only", commands: [] });
}

/** @internal Provider factory 用它一次性绑定纯数据声明与 Effect planner。 */
export function defineSandboxTemplate(
  definition: SandboxTemplateDefinition,
): SandboxLayer<"template-bearing"> {
  const provider = nonEmptyString(definition.provider, "sandbox template.provider");
  const kind = nonEmptyString(definition.kind, "sandbox template.kind");
  const declaration = Object.freeze({
    provider,
    kind,
    identity: freezeJson({
      version: 2,
      provider,
      kind,
      publishable: freezeJson(definition.publishableIdentity),
      privateIdentityDigest: digestOf(definition.privateFingerprintIdentity),
    }),
    carry: definition.carry === undefined
      ? Object.freeze({ _tag: "Eligible" as const })
      : Object.freeze({ ...definition.carry }),
    leakGate: freezeLeakGate(definition.leakGate),
  });
  SANDBOX_TEMPLATE_PLANNERS.set(declaration, definition.plan);
  if (definition.runtime !== undefined) SANDBOX_TEMPLATE_RUNTIMES.set(declaration, definition.runtime);
  return createLayer({ kind: "template-bearing", template: declaration, commands: [] });
}

function sharedScheduling(laneKey: string, recommendedConcurrency: number): SandboxProviderScheduling {
  return Object.freeze({
    recommendedConcurrency,
    lane: Object.freeze({ key: laneKey, limit: recommendedConcurrency }),
    admission: Object.freeze({ _tag: "Shared" }),
  });
}

function exclusiveScheduling(laneKey: string): SandboxProviderScheduling {
  return Object.freeze({
    recommendedConcurrency: 1,
    lane: Object.freeze({ key: laneKey, limit: 1 }),
    admission: Object.freeze({ _tag: "Exclusive" }),
  });
}

function standardLinuxTarget(): SandboxPlannedTarget {
  return Object.freeze({
    platform: Object.freeze({ _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" }),
    source: "provider-standard",
  });
}

/** Built-in factory 集合只属于 provider 侧；测试通过 services 注入，不改全局状态。 */
export function createBuiltinSandboxFactories(
  services: BuiltinSandboxPlannerServices,
): BuiltinSandboxFactories {
  const dockerTarget = (): Effect.Effect<SandboxPlannedTarget, SandboxProviderPlanningError> =>
    Effect.flatMap(services.dockerBuildPlatform, targetFromDocker);

  return Object.freeze({
    dockerComposeSandbox(options: DockerComposeSandboxOptions) {
      assertRecord(options, "dockerComposeSandbox options");
      assertOnlyKeys(
        options,
        ["file", "workspaceService", "build", "executionUser", "env", "credentialEnv"],
        "dockerComposeSandbox options",
      );
      if (options.build !== undefined && options.build !== "on-demand" && options.build !== "prebuilt") {
        throw new TypeError('dockerComposeSandbox options.build must be "on-demand" or "prebuilt"');
      }
      const file = location(options.file, "dockerComposeSandbox options.file");
      const workspaceService = nonEmptyString(options.workspaceService, "dockerComposeSandbox options.workspaceService");
      const build = options.build === undefined ? "on-demand" : options.build;
      const executionUser: JsonValue = options.executionUser === undefined
        ? { _tag: "ImageDefault" }
        : { _tag: "Configured", value: nonEmptyString(options.executionUser, "dockerComposeSandbox options.executionUser") };
      const env = stringRecord(options.env, "dockerComposeSandbox options.env");
      const credentialEnv = credentialEnvRecord(options.credentialEnv, "dockerComposeSandbox options.credentialEnv");
      for (const key of Object.keys(credentialEnv)) {
        if (key in env) throw new TypeError(`dockerComposeSandbox env and credentialEnv both define ${JSON.stringify(key)}`);
      }
      const credentialIdentity: globalThis.Record<string, JsonValue> = Object.fromEntries(
        Object.entries(credentialEnv).map(([name, credential]): readonly [string, JsonValue] => [
          name,
          credential.revision === undefined ? {} : { revision: credential.revision },
        ]),
      );
      const runtimeEnv = {
        ...env,
        ...Object.fromEntries(Object.entries(credentialEnv).map(([name, credential]) => [name, credential.value])),
      };
      const identity: JsonValue = {
        provider: "docker",
        kind: "compose",
        file,
        workspaceService,
        build,
        executionUser,
        env: { ...env },
        credentialEnv: credentialIdentity,
      };
      return defineSandboxTemplate({
        provider: "docker",
        kind: "compose",
        publishableIdentity: {
          workspaceService,
          build,
          executionUser: { _tag: options.executionUser === undefined ? "ImageDefault" : "Configured" },
          envKeys: Object.keys(env).sort(),
          credentialEnv: credentialIdentity,
        },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "Compose", file, workspaceService },
        plan: ({ authorBaseDir }) => Effect.flatMap(dockerTarget(), (target) => Effect.tryPromise({
          try: async () => {
          const plannedFile = plannedLocation(file, authorBaseDir);
          const runtimeBase: JsonValue = {
            file: plannedFile,
            workspaceService,
            build,
            executionUser,
            env: runtimeEnv,
          };
          const collection = await collectComposeBuilds({
            file: plannedFile._tag === "Url" ? new URL(plannedFile.value) : plannedFile.value,
            mainService: workspaceService,
            platform: plannedTargetPlatform(target),
            env: runtimeEnv,
          });
          const caseIdentity = composeCollectionIdentity(collection);
          const runtimeInput: JsonValue = {
            ...(runtimeBase as Record<string, JsonValue>),
            plannedBuildKeys: [...collection.buildKeys].sort(),
            plannedCaseIdentityDigest: digestOf(caseIdentity),
          };
          const identityInput: JsonValue = {
            file: plannedFile,
            workspaceService,
            build,
            executionUser,
            env: { ...env },
            credentialEnv: credentialIdentity,
            plannedBuildKeys: [...collection.buildKeys].sort(),
            plannedCaseIdentityDigest: digestOf(caseIdentity),
          };
          return sandboxProviderPlan({
            provider: "docker",
            plannerRevision: COMPOSE_MATERIALIZER_REVISION,
            caseKind: "compose",
            target,
            scheduling: sharedScheduling("docker", 10),
            runtime: { adapter: "niceeval/docker-compose", input: runtimeInput },
            publishableIdentity: {
              workspaceService,
              build,
              executionUser: { _tag: options.executionUser === undefined ? "ImageDefault" : "Configured" },
              envKeys: Object.keys(env).sort(),
              credentialEnv: credentialIdentity,
              ...(caseIdentity as Record<string, JsonValue>),
            },
            privateFingerprintIdentity: {
              identityInput,
              caseIdentity,
            },
            ...(collection.carryEligible
              ? {}
              : {
                  carry: {
                    _tag: "Ineligible" as const,
                    code: "sandbox.image-unresolved",
                    reason: "Compose references an image or FROM base that is not pinned to a sha256 digest.",
                  },
                }),
          });
          },
          catch: (cause) => providerPlanningError(
            "sandbox.case-identity-unavailable",
            "docker",
            cause instanceof Error ? cause.message : String(cause),
            ["Make the Compose file and every filtered build context readable during physical planning."],
          ),
        })),
      });
    },

    dockerfileSandbox(options: DockerfileSandboxOptions) {
      assertRecord(options, "dockerfileSandbox options");
      assertOnlyKeys(options, ["context", "dockerfile", "buildArgs"], "dockerfileSandbox options");
      const context = location(options.context, "dockerfileSandbox options.context");
      const dockerfile = options.dockerfile === undefined
        ? "Dockerfile"
        : nonEmptyString(options.dockerfile, "dockerfileSandbox options.dockerfile");
      const buildArgs = stringRecord(options.buildArgs, "dockerfileSandbox options.buildArgs");
      const identity: JsonValue = {
        provider: "docker",
        kind: "dockerfile",
        context,
        dockerfile,
        buildArgs: { ...buildArgs },
      };
      return defineSandboxTemplate({
        provider: "docker",
        kind: "dockerfile",
        publishableIdentity: {
          buildArgKeys: Object.keys(buildArgs).sort(),
        },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "Dockerfile", context, dockerfile },
        plan: ({ authorBaseDir }) => Effect.flatMap(dockerTarget(), (target) => Effect.tryPromise({
          try: async () => {
          const runtimeBase: JsonValue = {
            context: plannedLocation(context, authorBaseDir),
            dockerfile,
            buildArgs: { ...buildArgs },
          };
          const plannedContext = runtimeBase.context as SandboxLocation;
          const build = await resolveDockerfileBuildIdentity({
            provider: "docker",
            context: plannedContext._tag === "Url" ? new URL(plannedContext.value) : plannedContext.value,
            dockerfile,
            buildArgs,
            platform: plannedTargetPlatform(target),
            label: "Dockerfile sandbox",
          });
          const runtimeInput: JsonValue = {
            ...(runtimeBase as Record<string, JsonValue>),
            plannedBuildKey: build.buildKey,
          };
          return sandboxProviderPlan({
            provider: "docker",
            plannerRevision: DOCKERFILE_MATERIALIZER_REVISION,
            caseKind: "on-demand-build",
            target,
            scheduling: sharedScheduling("docker", 10),
            runtime: { adapter: "niceeval/dockerfile", input: runtimeInput },
            publishableIdentity: {
              buildArgKeys: Object.keys(buildArgs).sort(),
              buildKey: build.buildKey,
            },
            privateFingerprintIdentity: { runtimeInput, buildKey: build.buildKey },
            ...(build.carryEligible
              ? {}
              : {
                  carry: {
                    _tag: "Ineligible" as const,
                    code: "sandbox.base-image-unresolved",
                    reason: "Dockerfile FROM is not pinned to a sha256 digest.",
                  },
                }),
          });
          },
          catch: (cause) => providerPlanningError(
            "sandbox.build-identity-unavailable",
            "docker",
            cause instanceof Error ? cause.message : String(cause),
            ["Make the Dockerfile and its filtered build context readable during physical planning."],
          ),
        })),
      });
    },

    dockerImageSandbox(options: DockerImageSandboxOptions) {
      assertRecord(options, "dockerImageSandbox options");
      assertOnlyKeys(options, ["image"], "dockerImageSandbox options");
      const image = nonEmptyString(options.image, "dockerImageSandbox options.image");
      const identity: JsonValue = { provider: "docker", kind: "image", image };
      return defineSandboxTemplate({
        provider: "docker",
        kind: "image",
        publishableIdentity: { source: "configured-image" },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "None" },
        plan: () => Effect.map(dockerTarget(), (target) => {
          const runtimeInput: JsonValue = { image };
          return sandboxProviderPlan({
            provider: "docker",
            plannerRevision: "docker-image-1",
            caseKind: "prebuilt",
            target,
            scheduling: sharedScheduling("docker", 10),
            runtime: { adapter: "niceeval/docker-image", input: runtimeInput },
            publishableIdentity: { source: "configured-image" },
            privateFingerprintIdentity: runtimeInput,
            ...(looksLikeDigestRef(image)
              ? {}
              : {
                  carry: {
                    _tag: "Ineligible" as const,
                    code: "sandbox.image-unresolved",
                    reason: "Docker image is not pinned to a sha256 digest.",
                  },
                }),
          });
        }),
      });
    },

    e2bSandbox(options: E2BSandboxOptions) {
      assertRecord(options, "e2bSandbox options");
      assertOnlyKeys(options, ["template", "lifetimeMs"], "e2bSandbox options");
      const template = nonEmptyString(options.template, "e2bSandbox options.template");
      const plannedLifetime = lifetime(options.lifetimeMs, "e2bSandbox options.lifetimeMs");
      const identity: JsonValue = { provider: "e2b", kind: "template", template, lifetime: plannedLifetime };
      return defineSandboxTemplate({
        provider: "e2b",
        kind: "template",
        publishableIdentity: { lifetime: plannedLifetime },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "None" },
        plan: () => {
          const runtimeInput: JsonValue = { template, lifetime: plannedLifetime };
          return Effect.succeed(sandboxProviderPlan({
            provider: "e2b",
            plannerRevision: "e2b-template-1",
            caseKind: "prebuilt",
            target: standardLinuxTarget(),
            scheduling: sharedScheduling("e2b", 20),
            runtime: { adapter: "niceeval/e2b-template", input: runtimeInput },
            publishableIdentity: { lifetime: plannedLifetime },
            privateFingerprintIdentity: runtimeInput,
          }));
        },
      });
    },

    vercelSandbox(options: VercelSandboxOptions) {
      assertRecord(options, "vercelSandbox options");
      assertOnlyKeys(options, ["snapshotId", "lifetimeMs"], "vercelSandbox options");
      const snapshotId = nonEmptyString(options.snapshotId, "vercelSandbox options.snapshotId");
      const plannedLifetime = lifetime(options.lifetimeMs, "vercelSandbox options.lifetimeMs");
      const identity: JsonValue = { provider: "vercel", kind: "snapshot", snapshotId, lifetime: plannedLifetime };
      return defineSandboxTemplate({
        provider: "vercel",
        kind: "snapshot",
        publishableIdentity: { lifetime: plannedLifetime },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "None" },
        plan: () => {
          const runtimeInput: JsonValue = { snapshotId, lifetime: plannedLifetime };
          return Effect.succeed(sandboxProviderPlan({
            provider: "vercel",
            plannerRevision: "vercel-snapshot-1",
            caseKind: "prebuilt",
            target: standardLinuxTarget(),
            scheduling: sharedScheduling("vercel", 1),
            runtime: { adapter: "niceeval/vercel-snapshot", input: runtimeInput },
            publishableIdentity: { lifetime: plannedLifetime },
            privateFingerprintIdentity: runtimeInput,
          }));
        },
      });
    },

    localSandbox(options: LocalSandboxOptions = {}) {
      assertRecord(options, "localSandbox options");
      assertOnlyKeys(options, ["dir"], "localSandbox options");
      const directory = options.dir === undefined
        ? Object.freeze({ _tag: "AuthorBaseDir" as const })
        : Object.freeze({
            _tag: "Configured" as const,
            value: nonEmptyString(options.dir, "localSandbox options.dir"),
          });
      const identity: JsonValue = { provider: "local", kind: "directory", directory };
      return defineSandboxTemplate({
        provider: "local",
        kind: "directory",
        publishableIdentity: { directory: { _tag: directory._tag } },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "None" },
        plan: ({ authorBaseDir }) => {
          const configured = directory._tag === "AuthorBaseDir"
            ? authorBaseDir
            : resolve(authorBaseDir, directory.value);
          const runtimeInput: JsonValue = { directory: configured };
          return Effect.succeed(sandboxProviderPlan({
            provider: "local",
            plannerRevision: "local-directory-1",
            caseKind: "prebuilt",
            target: { platform: services.hostPlatform, source: "host" },
            scheduling: exclusiveScheduling("local-worktree"),
            runtime: { adapter: "niceeval/local-directory", input: runtimeInput },
            publishableIdentity: { directory: { _tag: directory._tag } },
            privateFingerprintIdentity: runtimeInput,
          }));
        },
      });
    },
  });
}

function hostPlatform(): SandboxTargetPlatform {
  const arch = normalizeArch(process.arch);
  return process.platform === "linux"
    ? Object.freeze({ _tag: "Linux", os: "linux", arch, libc: "gnu" })
    : process.platform === "darwin"
      ? Object.freeze({ _tag: "Darwin", os: "darwin", arch })
      : Object.freeze({ _tag: "Windows", os: "windows", arch });
}

const LIVE_FACTORIES = createBuiltinSandboxFactories({
  dockerBuildPlatform: Effect.tryPromise({
    try: () => detectDockerBuildPlatform(),
    catch: (cause) => providerPlanningError(
      "sandbox.target-platform-unavailable",
      "docker",
      cause instanceof Error ? cause.message : String(cause),
      ["Make the Docker control plane available or set DOCKER_DEFAULT_PLATFORM."],
    ),
  }),
  hostPlatform: hostPlatform(),
});

export const dockerComposeSandbox = LIVE_FACTORIES.dockerComposeSandbox;
export const dockerfileSandbox = LIVE_FACTORIES.dockerfileSandbox;
export const dockerImageSandbox = LIVE_FACTORIES.dockerImageSandbox;
export const e2bSandbox = LIVE_FACTORIES.e2bSandbox;
export const vercelSandbox = LIVE_FACTORIES.vercelSandbox;
export const localSandbox = LIVE_FACTORIES.localSandbox;

export function customProviderSandbox(
  options: CustomProviderSandboxOptions,
): SandboxLayer<"template-bearing"> {
  assertRecord(options, "defineSandbox options");
  assertOnlyKeys(
    options,
    ["name", "targetPlatform", "recommendedConcurrency", "exclusive", "create"],
    "defineSandbox options",
  );
  if (typeof options.create !== "function") throw new TypeError("defineSandbox options.create must be a function");
  const name = nonEmptyString(options.name, "defineSandbox options.name");
  const targetPlatform = freezePlatform(options.targetPlatform);
  const recommendedConcurrency = options.recommendedConcurrency ?? 5;
  const scheduling = options.exclusive === true
    ? exclusiveScheduling(name)
    : sharedScheduling(name, recommendedConcurrency);
  const identity: JsonValue = {
    provider: name,
    kind: "custom-provider",
    targetPlatform: targetIdentity({ platform: targetPlatform, source: "provider-defined" }),
    scheduling: {
      recommendedConcurrency: scheduling.recommendedConcurrency,
      lane: { key: scheduling.lane.key, limit: scheduling.lane.limit },
      admission: { _tag: scheduling.admission._tag },
    },
    create: { _tag: "OpaqueCallback" },
    retention: { _tag: "Unsupported" },
    reuse: { _tag: "Unsupported" },
  };
  return defineSandboxTemplate({
    provider: name,
    kind: "custom-provider",
    publishableIdentity: {},
    privateFingerprintIdentity: identity,
    leakGate: { _tag: "None" },
    carry: Object.freeze({
      _tag: "Ineligible",
      code: "sandbox.custom-provider-opaque",
      reason:
        `custom provider ${JSON.stringify(name)} owns an opaque create callback; ` +
        "use defineSandboxCase({ identity, materialize }) for cross-Run carry.",
    }),
    runtime: Object.freeze({ _tag: "CustomProvider", create: options.create }),
    plan: () => Effect.succeed(sandboxProviderPlan({
      provider: name,
      plannerRevision: "custom-provider-1",
      caseKind: "custom-provider",
      target: { platform: targetPlatform, source: "provider-defined" },
      scheduling,
      runtime: {
        adapter: "niceeval/custom-provider",
        input: {
          name,
          retention: { _tag: "Unsupported" },
          reuse: { _tag: "Unsupported" },
        },
      },
      publishableIdentity: {},
      privateFingerprintIdentity: identity,
    })),
  });
}

export function customCaseSandbox(
  options: CustomCaseSandboxOptions,
): SandboxLayer<"template-bearing"> {
  assertRecord(options, "defineSandboxCase options");
  assertOnlyKeys(options, ["identity", "targetPlatform", "services", "materialize"], "defineSandboxCase options");
  if (typeof options.materialize !== "function") {
    throw new TypeError("defineSandboxCase options.materialize must be a function");
  }
  const targetPlatform = freezePlatform(options.targetPlatform);
  const services = options.services === true
    ? Object.freeze({ _tag: "Supported" })
    : Object.freeze({ _tag: "Unsupported" });
  const identity = freezeJson(options.identity);
  const declarationIdentity: JsonValue = {
    provider: "custom-case",
    kind: "custom-case",
    identity,
    targetPlatform: targetIdentity({ platform: targetPlatform, source: "provider-defined" }),
    services: { _tag: services._tag },
    group: { _tag: "Required" },
    retention: { _tag: "Unsupported" },
  };
  return defineSandboxTemplate({
    provider: "custom-case",
    kind: "custom-case",
    publishableIdentity: {},
    privateFingerprintIdentity: declarationIdentity,
    leakGate: { _tag: "None" },
    runtime: Object.freeze({ _tag: "CustomCase", materialize: options.materialize }),
    plan: () => Effect.succeed(sandboxProviderPlan({
      provider: "custom-case",
      plannerRevision: "custom-case-1",
      caseKind: "custom",
      target: { platform: targetPlatform, source: "provider-defined" },
      scheduling: sharedScheduling("custom-case", 5),
      runtime: {
        adapter: "niceeval/custom-case",
        input: {
          identity,
          services: { _tag: services._tag },
          group: { _tag: "Required" },
          retention: { _tag: "Unsupported" },
        },
      },
      publishableIdentity: {},
      privateFingerprintIdentity: declarationIdentity,
    })),
  });
}

export function sandboxTemplateIdentity(template: SandboxTemplateDeclaration): JsonValue {
  return template.identity;
}

/** physical planner 的唯一 callback 入口；link 不调用本函数。 */
export function planSandboxTemplate(
  template: SandboxTemplateDeclaration,
  input: SandboxTemplatePlanningInput,
): Effect.Effect<SandboxProviderPlan, SandboxProviderPlanningError> {
  if (!isAbsolute(input.authorBaseDir)) {
    return Effect.fail(providerPlanningError(
      "sandbox.author-base-dir-invalid",
      template.provider,
      `Sandbox template author baseDir must be absolute, got ${JSON.stringify(input.authorBaseDir)}.`,
      ["Complete discovery before physical planning."],
    ));
  }
  const planner = SANDBOX_TEMPLATE_PLANNERS.get(template);
  return planner === undefined
    ? Effect.fail(providerPlanningError(
        "sandbox.template-planner-missing",
        template.provider,
        `Sandbox template ${template.provider}:${template.kind} has no bound planner.`,
        ["Construct templates through their provider factory."],
      ))
    : planner(input);
}

/** @internal scoped materializer 根据 link 选定的 template 取得私有 callback；identity 永不含函数。 */
export function customSandboxTemplateRuntimeOf(
  template: SandboxTemplateDeclaration,
): CustomSandboxTemplateRuntimeBinding {
  const runtime = SANDBOX_TEMPLATE_RUNTIMES.get(template);
  return runtime === undefined
    ? Object.freeze({ _tag: "Unbound" })
    : Object.freeze({ _tag: "Bound", runtime });
}

export function isSandboxLayer(value: unknown): value is SandboxLayer {
  if (value === null || typeof value !== "object") return false;
  if (!SANDBOX_LAYERS.has(value)) return false;
  const candidate = value as Partial<SandboxLayerRuntime<SandboxLayerKind>>;
  const kind = candidate[SANDBOX_LAYER];
  const state = SANDBOX_LAYER_STATES.get(value);
  return (
    (kind === "command-only" || kind === "template-bearing") &&
    state?.kind === kind &&
    Array.isArray(state.commands) &&
    typeof candidate.prepare === "function"
  );
}

/** 仅供 linker/fingerprint/runner 使用，不从 niceeval/sandbox 公开。 */
export function sandboxLayerStateOf(layer: SandboxLayer<"command-only">): CommandOnlySandboxLayerState;
export function sandboxLayerStateOf(layer: SandboxLayer<"template-bearing">): TemplateBearingSandboxLayerState;
export function sandboxLayerStateOf(layer: SandboxLayer): SandboxLayerState;
export function sandboxLayerStateOf(layer: SandboxLayer): SandboxLayerState {
  if (!isSandboxLayer(layer)) throw new TypeError("sandbox must be a SandboxLayer factory product");
  const state = SANDBOX_LAYER_STATES.get(layer);
  if (state === undefined) throw new TypeError("sandbox must be a SandboxLayer factory product");
  return state;
}
