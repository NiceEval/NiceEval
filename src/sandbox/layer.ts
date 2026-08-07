// SandboxLayer 作者声明面：不可变 prepare 链，以及由具体 factory 私下绑定的 Provider planner。
// Link 只消费 template 的纯数据 identity；planner callback 保存在 WeakMap 中，不进入声明或指纹。

import { isAbsolute, resolve } from "node:path";
import { Data, Effect, Option } from "effect";
import type { JsonValue } from "../shared/types.ts";
import type { ScopedFeedback } from "../shared/types.ts";
import type {
  MaterializedSandboxCase,
  SandboxMaterializeContext,
  SandboxResourceGroup,
  ServiceController,
} from "./case-types.ts";
import type { Sandbox, SandboxHook, SandboxRuntime } from "./types.ts";
import type { SandboxCommand, SandboxCommandDeclaration } from "./commands.ts";
import { sandboxCommandDeclarationOf } from "./commands.ts";
import {
  collectComposeBuilds,
  COMPOSE_MATERIALIZER_REVISION,
  composeCollectionIdentity,
  detectDockerBuildPlatform,
  normalizeBuildPlatform,
  type ComposeBuildCollection,
} from "./compose.ts";
import {
  assertPureDataIdentity,
  computeCaseKey,
  digestOf,
  looksLikeDigestRef,
  unresolvedProviderFingerprintMarker,
  type CaseKey,
} from "./identity.ts";
import {
  DOCKERFILE_MATERIALIZER_REVISION,
  resolveDockerfileBuildIdentity,
  type DockerfileBuildIdentity,
} from "./dockerfile-identity.ts";
import type { BuildKey, SandboxCaseKind } from "./identity.ts";
import type {
  SandboxRuntimeBuildPreparation,
  SandboxRuntimeMaterializationError,
  SandboxRuntimeMaterializeContext,
} from "./runtime.ts";
import { dockerProfileError } from "./docker-profile/errors.ts";
import type { DockerProfileRuntimeBinding } from "./docker-profile/runtime.ts";

export type SandboxLayerKind = "template-bearing" | "command-only";

const SANDBOX_LAYER: unique symbol = Symbol("niceeval.sandbox.layer");
const SANDBOX_LAYERS = new WeakSet<object>();
const SANDBOX_LAYER_STATES = new WeakMap<object, SandboxLayerState>();
const SANDBOX_TEMPLATE_PLANNERS = new WeakMap<object, SandboxTemplatePlanner>();
const SANDBOX_PROVIDER_BINDINGS = new WeakMap<object, SandboxProviderBinding>();
const SANDBOX_PROVIDER_PLAN: unique symbol = Symbol("niceeval.sandbox.provider-plan");

// Runtime resource/privileged coverage changed without changing Dockerfile build bytes. Keep the
// Dockerfile builder revision stable, but advance the provider-plan/fingerprint revision.
const DOCKERFILE_PROVIDER_PLANNER_REVISION = "dockerfile-3";
const DOCKER_IMAGE_PROVIDER_REVISION = "docker-image-2";

export interface SandboxLayer<Kind extends SandboxLayerKind = SandboxLayerKind> {
  readonly [SANDBOX_LAYER]: Kind;
  prepare(command: SandboxCommand): SandboxLayer<Kind>;
  setup(hook: SandboxHook): SandboxLayer<Kind>;
  teardown(hook: SandboxHook): SandboxLayer<Kind>;
}

export interface DockerComposeSandboxOptions {
  readonly file: string | URL;
  readonly workspaceService: string;
  readonly build?: "on-demand" | "prebuilt";
  /** 覆盖整个 Sandbox 的默认执行身份;省略时沿用 Compose service `user:` 或其镜像 `USER`。 */
  readonly user?: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  /** Compose 插值所需凭据；value 只进私有 runtime binding，identity 只认变量名与 revision。 */
  readonly credentialEnv?: Readonly<
    globalThis.Record<string, { readonly value: string; readonly revision?: string }>
  >;
  readonly lifetimeMs?: number;
  /**
   * 按序前置到受管 `PATH` 的目录;作用于本 Sandbox 内全部受管命令(agent 进程、两层 prepare、
   * ensure/install),hooks 与子进程自然继承。PATH 本身是受管变量,不接受经 `env` 覆盖——
   * 需要扩展 PATH 用这个字段(见 docs/feature/sandbox/library.md「PATH:受管变量与
   * pathPrepend」)。省略 = 不改 PATH。
   */
  readonly pathPrepend?: readonly string[];
}

export interface DockerfileSandboxOptions {
  readonly context: string | URL;
  readonly dockerfile?: string;
  readonly buildArgs?: Readonly<globalThis.Record<string, string>>;
  /** Docker profile v1 的宿主 alias；只保存为私有 runtime binding，不进入可分享 identity。 */
  readonly profile?: string;
  /** 起点构建的目标 stage。 */
  readonly target?: string;
  /** 覆盖整个 Sandbox 的默认执行身份;省略时沿用构建出的镜像 `USER`。 */
  readonly user?: string;
  /** 仅允许在 rootless Docker daemon 上请求 privileged；rootful daemon 会在创建前拒绝。 */
  readonly privileged?: "rootless";
  /** Agent在Sandbox内访问Docker的显式模式；与旧profile/privileged字段互斥。 */
  readonly dockerAccess?: DockerSandboxAccess;
  /** 单容器的 CPU / 内存 / PID / tmpfs 硬边界。 */
  readonly resources?: DockerSandboxResources;
  readonly readiness?: DockerSandboxReadiness;
  readonly lifetimeMs?: number;
  /** 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library.md)。 */
  readonly pathPrepend?: readonly string[];
}

export interface DockerImageSandboxOptions {
  readonly image: string;
  /** Docker profile v1 的宿主 alias；只保存为私有 runtime binding，不进入可分享 identity。 */
  readonly profile?: string;
  /** 覆盖整个 Sandbox 的默认执行身份;省略时沿用镜像 `USER`(未声明按 Docker 语义是 root)。 */
  readonly user?: string;
  /** 仅允许在 rootless Docker daemon 上请求 privileged；rootful daemon 会在创建前拒绝。 */
  readonly privileged?: "rootless";
  /** Agent在Sandbox内访问Docker的显式模式；与旧profile/privileged字段互斥。 */
  readonly dockerAccess?: DockerSandboxAccess;
  /** 单容器的 CPU / 内存 / PID / tmpfs 硬边界。 */
  readonly resources?: DockerSandboxResources;
  readonly readiness?: DockerSandboxReadiness;
  readonly lifetimeMs?: number;
  /** 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library.md)。 */
  readonly pathPrepend?: readonly string[];
}

export interface DockerSandboxTmpfsOptions {
  readonly sizeBytes: number;
  readonly mode?: number;
  readonly uid?: number;
  readonly gid?: number;
  /** 默认 false；仅显式 true 时允许执行。 */
  readonly executable?: boolean;
}

export interface DockerSandboxResources {
  readonly cpus?: number;
  readonly memoryBytes?: number;
  readonly pidsLimit?: number;
  /** 把镜像 rootfs 设为只读；需要写入的路径必须逐一声明为有界 tmpfs。 */
  readonly readOnlyRootfs?: boolean;
  readonly tmpfs?: Readonly<globalThis.Record<string, DockerSandboxTmpfsOptions>>;
}

export interface DockerImageSource {
  readonly type: "image";
  readonly image: string;
}

export interface DockerfileSource {
  readonly type: "dockerfile";
  readonly context: string | URL;
  readonly file?: string;
  readonly buildArgs?: Readonly<globalThis.Record<string, string>>;
  readonly target?: string;
}

export type DockerSandboxSource = DockerImageSource | DockerfileSource;

export interface ManagedDockerResources extends DockerSandboxResources {
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly pidsLimit: number;
  readonly readOnlyRootfs: true;
}

export interface DockerSandboxReadiness {
  readonly command: readonly [string, ...string[]];
  readonly user?: string;
  readonly timeoutMs: number;
  readonly intervalMs?: number;
}

export interface DockerSandboxCommonOptions {
  readonly source: DockerSandboxSource;
  readonly user?: string;
  readonly readiness?: DockerSandboxReadiness;
  readonly lifetimeMs?: number;
  readonly pathPrepend?: readonly string[];
}

export type DockerSandboxAccess =
  | {
      readonly mode: "socket";
      readonly socketPath: string;
    }
  | {
      readonly mode: "dind";
      readonly isolation: "raw-privileged";
    }
  | {
      readonly mode: "dind";
      readonly isolation: "managed-rootless";
      readonly profile: string;
    };

export type DockerSandboxOptions =
  | (DockerSandboxCommonOptions & {
      readonly dockerAccess?: undefined;
      readonly resources?: DockerSandboxResources;
    })
  | (DockerSandboxCommonOptions & {
      readonly dockerAccess:
        | { readonly mode: "socket"; readonly socketPath: string }
        | { readonly mode: "dind"; readonly isolation: "raw-privileged" };
      readonly resources?: DockerSandboxResources;
    })
  | (DockerSandboxCommonOptions & {
      readonly dockerAccess: {
        readonly mode: "dind";
        readonly isolation: "managed-rootless";
        readonly profile: string;
      };
      readonly resources: ManagedDockerResources;
    });

export interface E2BSandboxOptions {
  readonly template: string;
  /** 覆盖整个 Sandbox 的默认执行身份;省略时沿用 template 的默认用户。 */
  readonly user?: string;
  readonly lifetimeMs?: number;
  /** 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library.md)。 */
  readonly pathPrepend?: readonly string[];
}

export interface VercelSandboxOptions {
  readonly snapshotId: string;
  readonly lifetimeMs?: number;
  /** 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library.md)。 */
  readonly pathPrepend?: readonly string[];
}

export interface LocalSandboxOptions {
  readonly dir?: string;
  /** 按序前置到受管 `PATH` 的目录;省略 = 不改 PATH(见 docs/feature/sandbox/library.md)。 */
  readonly pathPrepend?: readonly string[];
}

export interface CustomProviderSandboxOptions {
  readonly name: string;
  readonly targetPlatform: SandboxTargetPlatform;
  readonly recommendedConcurrency?: number;
  readonly exclusive?: boolean;
  readonly create: (
    context: CustomProviderMaterializeContext,
  ) => Effect.Effect<Sandbox, CustomSandboxMaterializationError>;
}

export class CustomSandboxMaterializationError extends Data.TaggedError(
  "CustomSandboxMaterializationError",
)<{
  readonly code: string;
  readonly message: string;
  readonly cause: Error;
}> {}

export interface CustomProviderMaterializeContext {
  readonly deadline: SandboxRuntimeDeadlineDeclaration;
  readonly runtime: SandboxRuntime;
  readonly feedback: ScopedFeedback;
}

export type CustomCaseServices =
  | { readonly _tag: "Supported" }
  | { readonly _tag: "Unsupported" };

export type CustomCaseMaterializedServices =
  | { readonly _tag: "None" }
  | { readonly _tag: "Available"; readonly value: ServiceController };

export interface CustomCaseMaterializeResult {
  readonly sandbox: Sandbox;
  readonly group: SandboxResourceGroup;
  readonly services: CustomCaseMaterializedServices;
  readonly facts: JsonValue;
  /** Callback cases cannot provide detached retention without a discoverable provider plugin. */
  readonly retention?: never;
}

export interface CustomCaseSandboxOptions {
  readonly identity: JsonValue;
  readonly targetPlatform: SandboxTargetPlatform;
  readonly services: CustomCaseServices;
  readonly materialize: (
    context: SandboxMaterializeContext,
  ) => Effect.Effect<CustomCaseMaterializeResult, CustomSandboxMaterializationError>;
}

export type SandboxRuntimeDeadlineDeclaration =
  | { readonly _tag: "Unlimited" }
  | { readonly _tag: "Bounded"; readonly timeoutMs: number; readonly deadlineAt: number };

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

export type SandboxRuntimeRetention =
  | { readonly _tag: "DestroyOnly" }
  | { readonly _tag: "Suspendable" };

export type SandboxRuntimeReuse =
  | { readonly _tag: "Supported" }
  | { readonly _tag: "Unsupported"; readonly reason: string };

export type SandboxRuntimeSessionLimit =
  | { readonly _tag: "Unlimited" }
  | { readonly _tag: "Bounded"; readonly milliseconds: number }
  | {
      /** 上限由 provider 账号/plan 决定，只有真实创建或续期请求才能裁决。 */
      readonly _tag: "ProviderValidated";
      readonly reason: string;
    };

/** Provider 在 physical planning 时一并冻结的运行能力；core 不从 provider 名反推。 */
export interface SandboxProviderCapabilities {
  readonly retention: SandboxRuntimeRetention;
  readonly reuse: SandboxRuntimeReuse;
  readonly sessionLimit: SandboxRuntimeSessionLimit;
}

/**
 * Provider 私有的类型联系。`Plan` 只在 factory 与本模块内部存在；绑定到公开 plan 后被闭包捕获，
 * core 只看见已消去泛型的 `SandboxProviderBinding`，从不接触 `unknown` 或 JSON runtime input。
 */
export interface SandboxProviderModule<Plan> {
  readonly id: string;
  readonly capabilities: SandboxProviderCapabilities;
  readonly materialize: (
    plan: Plan,
    context: SandboxRuntimeMaterializeContext,
  ) => Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError>;
  readonly collectBuildPreparation: (
    plan: Plan,
    published: SandboxProviderPlan,
    evalId: string,
  ) => Effect.Effect<Option.Option<SandboxRuntimeBuildPreparation>, SandboxRuntimeMaterializationError>;
}

/** 泛型已经由闭包消去的 provider binding；只有合法 constructor 产物存在于 WeakMap 中。 */
export interface SandboxProviderBinding {
  readonly moduleId: string;
  readonly capabilities: SandboxProviderCapabilities;
  readonly materialize: (
    context: SandboxRuntimeMaterializeContext,
  ) => Effect.Effect<MaterializedSandboxCase, SandboxRuntimeMaterializationError>;
  readonly collectBuildPreparation: (
    evalId: string,
  ) => Effect.Effect<Option.Option<SandboxRuntimeBuildPreparation>, SandboxRuntimeMaterializationError>;
}

/**
 * physical planning 的唯一完成态。整个对象都可发布、可序列化；provider 私有的 runtime input
 * 只存在于 plan-keyed runtime binding，不会因调用方误做 `JSON.stringify(plan)` 而落盘。
 */
export interface SandboxProviderPlan {
  readonly [SANDBOX_PROVIDER_PLAN]: true;
  readonly provider: string;
  readonly plannerRevision: string;
  readonly caseKind: SandboxCaseKind;
  readonly target: SandboxPlannedTarget;
  readonly scheduling: SandboxProviderScheduling;
  readonly capabilities: SandboxProviderCapabilities;
  readonly build: SandboxProviderBuildPlan;
  readonly identity: JsonValue;
}

export type SandboxProviderBuildPlan =
  | { readonly _tag: "None"; readonly caseKey: CaseKey; readonly buildKeys: readonly [] }
  | {
      readonly _tag: "Required";
      readonly caseKey: CaseKey;
      readonly buildKeys: readonly [BuildKey, ...BuildKey[]];
    };

export interface SandboxProviderPlanInput<Plan> {
  readonly provider: string;
  readonly plannerRevision: string;
  readonly caseKind: SandboxCaseKind;
  readonly target: SandboxPlannedTarget;
  readonly scheduling: SandboxProviderScheduling;
  readonly module: SandboxProviderModule<Plan>;
  readonly runtimePlan: Plan;
  readonly build: SandboxProviderBuildPlan;
  /** 仅用于保留既有 provider fingerprint 的稳定身份投影；不参与携带裁决。 */
  readonly identityMarker?: JsonValue;
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
  readonly leakGate: SandboxLeakGate;
}

export interface SandboxTemplateDefinition {
  readonly provider: string;
  readonly kind: string;
  /** 可直接进入 pair-owned record projection 的 provider-owned 纯数据。 */
  readonly publishableIdentity: JsonValue;
  /** 影响 template identity 但不得直接进入 link / record 的作者输入。 */
  readonly privateFingerprintIdentity: JsonValue;
  readonly plan: SandboxTemplatePlanner;
  readonly leakGate: SandboxLeakGate;
}

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
  readonly setupHooks: readonly SandboxHook[];
  readonly teardownHooks: readonly SandboxHook[];
}

export interface TemplateBearingSandboxLayerState {
  readonly kind: "template-bearing";
  readonly template: SandboxTemplateDeclaration;
  readonly commands: readonly SandboxCommandDeclaration[];
  readonly setupHooks: readonly SandboxHook[];
  readonly teardownHooks: readonly SandboxHook[];
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
export function sandboxProviderPlan<Plan>(input: SandboxProviderPlanInput<Plan>): SandboxProviderPlan {
  const provider = nonEmptyString(input.provider, "sandbox provider plan.provider");
  const plannerRevision = nonEmptyString(input.plannerRevision, "sandbox provider plan.plannerRevision");
  const caseKind = input.caseKind;
  const target = freezeTarget(input.target);
  const scheduling = freezeScheduling(input.scheduling);
  const moduleId = nonEmptyString(input.module.id, "sandbox provider module.id");
  const capabilities = freezeProviderCapabilities(input.module.capabilities);
  const publishableIdentity = freezeJson(input.publishableIdentity);
  const privateIdentityDigest = digestOf(input.privateFingerprintIdentity);
  const build: SandboxProviderBuildPlan = input.build._tag === "None"
    ? Object.freeze({ _tag: "None", caseKey: input.build.caseKey, buildKeys: [] as const })
    : Object.freeze({
        _tag: "Required",
        caseKey: input.build.caseKey,
        buildKeys: freezeSortedNonEmptyBuildKeys(input.build.buildKeys, "sandbox provider plan.build.buildKeys"),
      });
  const identity = freezeJson({
    version: 3,
    provider,
    plannerRevision,
    caseKind,
    target: targetIdentity(target),
    scheduling: {
      recommendedConcurrency: scheduling.recommendedConcurrency,
      lane: { key: scheduling.lane.key, limit: scheduling.lane.limit },
      admission: { _tag: scheduling.admission._tag },
    },
    providerModule: moduleId,
    capabilities: {
      retention: { _tag: capabilities.retention._tag },
      reuse: capabilities.reuse,
      sessionLimit: capabilities.sessionLimit,
    },
    // Keep the old identity slot stable while carry eligibility is no longer a
    // provider/template concern. The marker is fingerprint data only.
    carry: input.identityMarker ?? { _tag: "Eligible" },
    build: { _tag: build._tag, caseKey: build.caseKey, buildKeys: [...build.buildKeys] },
    publishable: publishableIdentity,
    privateIdentityDigest,
  });
  const plan: SandboxProviderPlan = {
    [SANDBOX_PROVIDER_PLAN]: true,
    provider,
    plannerRevision,
    caseKind,
    target,
    scheduling,
    capabilities,
    build,
    identity,
  };
  const binding = Object.freeze({
    moduleId,
    capabilities,
    materialize: (context) => input.module.materialize(input.runtimePlan, context),
    collectBuildPreparation: (evalId) => input.module.collectBuildPreparation(input.runtimePlan, plan, evalId),
  } satisfies SandboxProviderBinding);
  SANDBOX_PROVIDER_BINDINGS.set(plan, binding);
  return Object.freeze(plan);
}

/** @internal core 只取得已经消去泛型的闭包；合法 planner 产物恒为 Some。 */
export function sandboxProviderBindingOf(plan: SandboxProviderPlan): Option.Option<SandboxProviderBinding> {
  return Option.fromNullable(SANDBOX_PROVIDER_BINDINGS.get(plan));
}

function freezeProviderCapabilities(capabilities: SandboxProviderCapabilities): SandboxProviderCapabilities {
  if (
    capabilities.sessionLimit._tag === "Bounded" &&
    (!Number.isFinite(capabilities.sessionLimit.milliseconds) || capabilities.sessionLimit.milliseconds <= 0)
  ) {
    throw new TypeError("sandbox provider bounded session limit must be a positive finite number");
  }
  return Object.freeze({
    retention: Object.freeze({ _tag: capabilities.retention._tag }),
    reuse: capabilities.reuse._tag === "Supported"
      ? Object.freeze({ _tag: "Supported" as const })
      : Object.freeze({
          _tag: "Unsupported" as const,
          reason: nonEmptyString(capabilities.reuse.reason, "sandbox provider capabilities.reuse.reason"),
        }),
    sessionLimit: capabilities.sessionLimit._tag === "Unlimited"
      ? Object.freeze({ _tag: "Unlimited" as const })
      : capabilities.sessionLimit._tag === "Bounded"
        ? Object.freeze({
            _tag: "Bounded" as const,
            milliseconds: capabilities.sessionLimit.milliseconds,
          })
        : Object.freeze({
            _tag: "ProviderValidated" as const,
            reason: nonEmptyString(
              capabilities.sessionLimit.reason,
              "sandbox provider capabilities.sessionLimit.reason",
            ),
          }),
  });
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

/** `pathPrepend`:省略即空;否则必须是非空字符串数组,按声明顺序前置到受管 PATH。 */
function pathPrependList(value: unknown, path: string): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array of strings`);
  return Object.freeze(value.map((entry, index) => nonEmptyString(entry, `${path}[${index}]`)));
}

/**
 * 可选字段缺省值不进身份序列化:空 `pathPrepend` 与省略该字段同义,因此在身份/哈希输入里
 * 一律省略键本身(absent ≡ default),不写 `pathPrepend: []`——否则「不声明」与「声明成空
 * 数组」这两种作者写法会产出不同的 digest,对使用者是无法解释的差异。非空时才带着键出现,
 * 值本身(顺序、内容)照常参与摘要。
 */
function pathPrependIdentityField(
  pathPrepend: readonly string[],
): globalThis.Record<string, never> | { readonly pathPrepend: string[] } {
  return pathPrepend.length === 0 ? {} : { pathPrepend: [...pathPrepend] };
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

function lifetime(value: unknown, path: string): SandboxProviderLifetime {
  if (value === undefined) return Object.freeze({ _tag: "ProviderDefault" });
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive finite number`);
  }
  return Object.freeze({ _tag: "Configured", milliseconds: value });
}

function dockerPrivileged(value: unknown, path: string): "disabled" | "rootless" {
  if (value === undefined) return "disabled";
  if (value !== "rootless") throw new TypeError(`${path} must be \"rootless\" when configured`);
  return "rootless";
}

function dockerAccess(value: unknown, path: string): Readonly<DockerSandboxAccess> | undefined {
  if (value === undefined) return undefined;
  assertRecord(value, path);
  const mode = nonEmptyString(value.mode, `${path}.mode`);
  if (mode === "socket") {
    assertOnlyKeys(value, ["mode", "socketPath"], path);
    const socketPath = nonEmptyString(value.socketPath, `${path}.socketPath`);
    if (!isAbsolute(socketPath) || resolve(socketPath) !== socketPath) {
      throw new TypeError(`${path}.socketPath must be a normalized absolute path`);
    }
    return Object.freeze({ mode: "socket", socketPath });
  }
  if (mode !== "dind") throw new TypeError(`${path}.mode must be "socket" or "dind"`);
  const isolation = nonEmptyString(value.isolation, `${path}.isolation`);
  if (isolation === "raw-privileged") {
    assertOnlyKeys(value, ["mode", "isolation"], path);
    return Object.freeze({ mode: "dind", isolation: "raw-privileged" });
  }
  if (isolation === "managed-rootless") {
    assertOnlyKeys(value, ["mode", "isolation", "profile"], path);
    return Object.freeze({
      mode: "dind",
      isolation: "managed-rootless",
      profile: nonEmptyString(value.profile, `${path}.profile`),
    });
  }
  throw new TypeError(`${path}.isolation must be "raw-privileged" or "managed-rootless"`);
}

function dockerAccessConfiguration(
  value: unknown,
  legacyProfile: unknown,
  legacyPrivileged: unknown,
  path: string,
): {
  readonly access?: Readonly<DockerSandboxAccess>;
  readonly profile?: string;
  readonly privileged: "disabled" | "raw" | "rootless";
} {
  const access = dockerAccess(value, path);
  if (access !== undefined) {
    if (legacyProfile !== undefined || legacyPrivileged !== undefined) {
      throw new TypeError(`${path} cannot be combined with profile or privileged`);
    }
    if (access.mode === "socket") return Object.freeze({ access, privileged: "disabled" });
    if (access.isolation === "raw-privileged") return Object.freeze({ access, privileged: "raw" });
    return Object.freeze({ access, profile: access.profile, privileged: "rootless" });
  }
  const profile = dockerProfileAlias(legacyProfile, path.replace(/dockerAccess$/, "profile"));
  const privileged = dockerPrivileged(legacyPrivileged, path.replace(/dockerAccess$/, "privileged"));
  return Object.freeze({
    ...(profile === undefined ? {} : { profile }),
    privileged,
  });
}

function dockerProfileAlias(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return nonEmptyString(value, path);
}

function dockerReadiness(value: unknown, path: string): Readonly<DockerSandboxReadiness> | undefined {
  if (value === undefined) return undefined;
  assertRecord(value, path);
  assertOnlyKeys(value, ["command", "user", "timeoutMs", "intervalMs"], path);
  if (!Array.isArray(value.command) || value.command.length === 0) {
    throw new TypeError(`${path}.command must be a non-empty array of strings`);
  }
  const commandValues = value.command.map((entry, index) => nonEmptyString(entry, `${path}.command[${index}]`));
  const first = commandValues[0];
  if (first === undefined) throw new TypeError(`${path}.command must contain an executable`);
  const command: readonly [string, ...string[]] = Object.freeze([first, ...commandValues.slice(1)]);
  const user = value.user === undefined ? undefined : nonEmptyString(value.user, `${path}.user`);
  const timeoutMs = positiveFinite(value.timeoutMs, `${path}.timeoutMs`);
  const intervalMs = value.intervalMs === undefined
    ? undefined
    : positiveFinite(value.intervalMs, `${path}.intervalMs`);
  return Object.freeze({
    command,
    ...(user === undefined ? {} : { user }),
    timeoutMs,
    ...(intervalMs === undefined ? {} : { intervalMs }),
  });
}

function dockerReadinessForAccess(
  access: Readonly<DockerSandboxAccess> | undefined,
  value: unknown,
  path: string,
): Readonly<DockerSandboxReadiness> | undefined {
  return dockerReadiness(
    value === undefined && access !== undefined
      ? { command: ["docker", "info"], timeoutMs: 30_000 }
      : value,
    path,
  );
}

function managedDockerResources(value: unknown, path: string): ManagedDockerResources {
  if (value === undefined) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-resources-required",
      path,
      message: "profile-bound Docker sandbox requires explicit CPU, memory, PID and readOnlyRootfs resources",
    });
  }
  const resources = dockerResources(value, path);
  if (
    resources.cpus === undefined ||
    resources.memoryBytes === undefined ||
    resources.pidsLimit === undefined ||
    resources.readOnlyRootfs !== true
  ) {
    throw dockerProfileError({
      code: "sandbox.docker-profile-resources-required",
      path,
      message: "profile-bound Docker sandbox requires explicit CPU, memory, PID and readOnlyRootfs: true resources",
    });
  }
  return Object.freeze({
    ...resources,
    cpus: resources.cpus,
    memoryBytes: resources.memoryBytes,
    pidsLimit: resources.pidsLimit,
    readOnlyRootfs: true,
  });
}

function dockerResourcesForProfile(
  profile: string | undefined,
  privileged: "disabled" | "raw" | "rootless",
  value: unknown,
  path: string,
): Readonly<DockerSandboxResources> {
  if (profile === undefined && privileged === "rootless") {
    throw dockerProfileError({
      code: "sandbox.docker-profile-required",
      path: `${path}.privileged`,
      message: 'privileged: "rootless" requires an explicit Docker profile alias',
    });
  }
  return profile === undefined ? dockerResources(value, path) : managedDockerResources(value, path);
}

function readinessIdentity(readiness: Readonly<DockerSandboxReadiness> | undefined): JsonValue {
  return readiness === undefined
    ? null
    : {
        command: [...readiness.command],
        ...(readiness.user === undefined ? {} : { user: readiness.user }),
      };
}

function positiveFinite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive finite number`);
  }
  return value;
}

function positiveSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${path} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer`);
  }
  return value;
}

function dockerResources(value: unknown, path: string): Readonly<DockerSandboxResources> {
  if (value === undefined) return Object.freeze({});
  assertRecord(value, path);
  assertOnlyKeys(value, ["cpus", "memoryBytes", "pidsLimit", "readOnlyRootfs", "tmpfs"], path);
  if (value.readOnlyRootfs !== undefined && typeof value.readOnlyRootfs !== "boolean") {
    throw new TypeError(`${path}.readOnlyRootfs must be a boolean`);
  }
  const tmpfs: globalThis.Record<string, DockerSandboxTmpfsOptions> = {};
  if (value.tmpfs !== undefined) {
    assertRecord(value.tmpfs, `${path}.tmpfs`);
    for (const mountPath of Object.keys(value.tmpfs).sort()) {
      if (!isAbsolute(mountPath) || resolve(mountPath) !== mountPath || mountPath === "/") {
        throw new TypeError(`${path}.tmpfs keys must be normalized absolute paths other than /`);
      }
      const entry = value.tmpfs[mountPath];
      assertRecord(entry, `${path}.tmpfs.${mountPath}`);
      assertOnlyKeys(entry, ["sizeBytes", "mode", "uid", "gid", "executable"], `${path}.tmpfs.${mountPath}`);
      const sizeBytes = positiveSafeInteger(entry.sizeBytes, `${path}.tmpfs.${mountPath}.sizeBytes`);
      if (
        entry.mode !== undefined &&
        (typeof entry.mode !== "number" || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o7777)
      ) {
        throw new TypeError(`${path}.tmpfs.${mountPath}.mode must be an integer between 0 and 0o7777`);
      }
      if (entry.executable !== undefined && typeof entry.executable !== "boolean") {
        throw new TypeError(`${path}.tmpfs.${mountPath}.executable must be a boolean`);
      }
      const uid = entry.uid === undefined ? undefined : nonNegativeSafeInteger(entry.uid, `${path}.tmpfs.${mountPath}.uid`);
      const gid = entry.gid === undefined ? undefined : nonNegativeSafeInteger(entry.gid, `${path}.tmpfs.${mountPath}.gid`);
      tmpfs[mountPath] = Object.freeze({
        sizeBytes,
        ...(entry.mode === undefined ? {} : { mode: entry.mode }),
        ...(uid === undefined ? {} : { uid }),
        ...(gid === undefined ? {} : { gid }),
        ...(entry.executable === true ? { executable: true } : {}),
      });
    }
  }
  return Object.freeze({
    ...(value.cpus === undefined ? {} : { cpus: positiveFinite(value.cpus, `${path}.cpus`) }),
    ...(value.memoryBytes === undefined
      ? {}
      : { memoryBytes: positiveSafeInteger(value.memoryBytes, `${path}.memoryBytes`) }),
    ...(value.pidsLimit === undefined
      ? {}
      : { pidsLimit: positiveSafeInteger(value.pidsLimit, `${path}.pidsLimit`) }),
    ...(value.readOnlyRootfs === true ? { readOnlyRootfs: true } : {}),
    ...(Object.keys(tmpfs).length === 0 ? {} : { tmpfs: Object.freeze(tmpfs) }),
  });
}

function dockerRuntimeIdentity(
  privileged: "disabled" | "raw" | "rootless",
  resources: Readonly<DockerSandboxResources>,
  access?: Readonly<DockerSandboxAccess>,
): globalThis.Record<string, JsonValue> {
  return {
    ...(access === undefined
      ? (privileged === "disabled" ? {} : { privileged })
      : {
          dockerAccess: access.mode === "socket"
            ? { mode: "socket" }
            : { mode: "dind", isolation: access.isolation },
        }),
    ...(Object.keys(resources).length === 0 ? {} : { resources: resources as JsonValue }),
  };
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
  const setupHooks = Object.freeze([...state.setupHooks]);
  const teardownHooks = Object.freeze([...state.teardownHooks]);
  const frozenState = state.kind === "command-only"
    ? Object.freeze({ kind: "command-only" as const, commands: frozenCommands, setupHooks, teardownHooks })
    : Object.freeze({ kind: "template-bearing" as const, template: state.template, commands: frozenCommands, setupHooks, teardownHooks });
  const layer = {
    prepare(command: SandboxCommand): SandboxLayer {
      const declaration = sandboxCommandDeclarationOf(command);
      return frozenState.kind === "command-only"
        ? createLayer({ kind: "command-only", commands: [...frozenCommands, declaration], setupHooks, teardownHooks })
        : createLayer({
            kind: "template-bearing",
            template: frozenState.template,
            commands: [...frozenCommands, declaration],
            setupHooks,
            teardownHooks,
          });
    },
    setup(hook: SandboxHook): SandboxLayer {
      if (typeof hook !== "function") throw new TypeError("sandbox setup hook must be a function");
      return frozenState.kind === "command-only"
        ? createLayer({ kind: "command-only", commands: frozenCommands, setupHooks: [...setupHooks, hook], teardownHooks })
        : createLayer({ kind: "template-bearing", template: frozenState.template, commands: frozenCommands, setupHooks: [...setupHooks, hook], teardownHooks });
    },
    teardown(hook: SandboxHook): SandboxLayer {
      if (typeof hook !== "function") throw new TypeError("sandbox teardown hook must be a function");
      return frozenState.kind === "command-only"
        ? createLayer({ kind: "command-only", commands: frozenCommands, setupHooks, teardownHooks: [...teardownHooks, hook] })
        : createLayer({ kind: "template-bearing", template: frozenState.template, commands: frozenCommands, setupHooks, teardownHooks: [...teardownHooks, hook] });
    },
  } as SandboxLayerRuntime<SandboxLayerKind>;
  Object.defineProperty(layer, SANDBOX_LAYER, { value: frozenState.kind });
  SANDBOX_LAYERS.add(layer);
  SANDBOX_LAYER_STATES.set(layer, frozenState);
  return Object.freeze(layer);
}

export function sandboxLayer(): SandboxLayer<"command-only"> {
  return createLayer({ kind: "command-only", commands: [], setupHooks: [], teardownHooks: [] });
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
    leakGate: freezeLeakGate(definition.leakGate),
  });
  SANDBOX_TEMPLATE_PLANNERS.set(declaration, definition.plan);
  return createLayer({ kind: "template-bearing", template: declaration, commands: [], setupHooks: [], teardownHooks: [] });
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

function providerBuildPlan(
  input: Parameters<typeof computeCaseKey>[0],
): SandboxProviderBuildPlan {
  const buildKeys = [...input.buildKeys].sort();
  const caseKey = computeCaseKey(input);
  return buildKeys.length === 0
    ? Object.freeze({ _tag: "None", caseKey, buildKeys: [] as const })
    : Object.freeze({
        _tag: "Required",
        caseKey,
        buildKeys: freezeSortedNonEmptyBuildKeys(buildKeys, "provider build collection.buildKeys"),
      });
}

/** 将动态 provider 输入收敛为 Required 完成态：非空不变量必须在这里验证，不能靠 tuple 断言伪造。 */
function freezeSortedNonEmptyBuildKeys(
  buildKeys: readonly BuildKey[],
  path: string,
): readonly [BuildKey, ...BuildKey[]] {
  const [first, ...rest] = [...buildKeys].sort();
  if (first === undefined) throw new TypeError(`${path} must contain at least one BuildKey when _tag is Required`);
  return Object.freeze(nonEmptyBuildKeys(first, rest));
}

function nonEmptyBuildKeys(
  first: BuildKey,
  rest: readonly BuildKey[],
): [BuildKey, ...BuildKey[]] {
  return [first, ...rest];
}

export type SandboxExecutionUser =
  | { readonly _tag: "EnvironmentDefault" }
  | { readonly _tag: "Configured"; readonly value: string };

export type SandboxProviderLifetime =
  | { readonly _tag: "ProviderDefault" }
  | { readonly _tag: "Configured"; readonly milliseconds: number };

export interface DockerComposeProviderPlan {
  readonly file: SandboxLocation;
  readonly workspaceService: string;
  readonly build: "on-demand" | "prebuilt";
  readonly user: SandboxExecutionUser;
  readonly env: Readonly<Record<string, string>>;
  readonly collection: ComposeBuildCollection;
  readonly lifetime: SandboxProviderLifetime;
  readonly pathPrepend: readonly string[];
}

export interface DockerfileProviderPlan {
  readonly context: SandboxLocation;
  readonly dockerfile: string;
  readonly buildArgs: Readonly<Record<string, string>>;
  readonly profile?: string;
  readonly profileBinding?: DockerProfileRuntimeBinding;
  readonly target?: string;
  readonly readiness?: DockerSandboxReadiness;
  readonly user: SandboxExecutionUser;
  readonly privileged: "disabled" | "raw" | "rootless";
  readonly dockerAccess?: DockerSandboxAccess;
  readonly resources: Readonly<DockerSandboxResources>;
  readonly build: DockerfileBuildIdentity;
  readonly buildKey: BuildKey;
  readonly platform: string;
  readonly lifetime: SandboxProviderLifetime;
  readonly pathPrepend: readonly string[];
}

export interface DockerImageProviderPlan {
  readonly image: string;
  readonly profile?: string;
  readonly profileBinding?: DockerProfileRuntimeBinding;
  readonly readiness?: DockerSandboxReadiness;
  readonly user: SandboxExecutionUser;
  readonly privileged: "disabled" | "raw" | "rootless";
  readonly dockerAccess?: DockerSandboxAccess;
  readonly resources: Readonly<DockerSandboxResources>;
  readonly lifetime: SandboxProviderLifetime;
  readonly pathPrepend: readonly string[];
}

export interface E2BProviderPlan {
  readonly template: string;
  readonly user: SandboxExecutionUser;
  readonly lifetime: SandboxProviderLifetime;
  readonly pathPrepend: readonly string[];
}

export interface VercelProviderPlan {
  readonly snapshotId: string;
  readonly lifetime: SandboxProviderLifetime;
  readonly pathPrepend: readonly string[];
}

export interface LocalProviderPlan {
  readonly directory: string;
  readonly pathPrepend: readonly string[];
}

export interface CustomProviderPlan {
  readonly name: string;
}

export interface CustomCaseProviderPlan {
  readonly identity: JsonValue;
  readonly services: { readonly _tag: "Supported" } | { readonly _tag: "Unsupported" };
}

function loadProviderRuntime() {
  return Effect.promise(() => import("./runtime.ts"));
}

const noBuildPreparation = (): Effect.Effect<Option.Option<SandboxRuntimeBuildPreparation>> =>
  Effect.succeed(Option.none());

const dockerComposeProviderModule = Object.freeze({
  id: "niceeval/docker-compose",
  capabilities: Object.freeze({
    retention: Object.freeze({ _tag: "DestroyOnly" }),
    reuse: Object.freeze({ _tag: "Supported" }),
    sessionLimit: Object.freeze({ _tag: "Unlimited" }),
  }),
  materialize: (plan, context) => Effect.flatMap(
    loadProviderRuntime(),
    (runtime) => runtime.materializeDockerComposeProviderPlan(plan, context),
  ),
  collectBuildPreparation: (plan, published, evalId) => Effect.flatMap(
    loadProviderRuntime(),
    (runtime) => runtime.collectDockerComposeProviderBuildPreparation(plan, published, evalId),
  ),
} satisfies SandboxProviderModule<DockerComposeProviderPlan>);

const dockerfileProviderModule = Object.freeze({
  id: "niceeval/dockerfile",
  capabilities: Object.freeze({
    retention: Object.freeze({ _tag: "Suspendable" }),
    reuse: Object.freeze({ _tag: "Supported" }),
    sessionLimit: Object.freeze({ _tag: "Unlimited" }),
  }),
  materialize: (plan, context) => Effect.flatMap(
    loadProviderRuntime(),
    (runtime) => runtime.materializeDockerfileProviderPlan(plan, context),
  ),
  collectBuildPreparation: (plan, published, evalId) => Effect.flatMap(
    loadProviderRuntime(),
    (runtime) => runtime.collectDockerfileProviderBuildPreparation(plan, published, evalId),
  ),
} satisfies SandboxProviderModule<DockerfileProviderPlan>);

/** tmpfs / 只读 rootfs 的状态不会跨 stop/restart 保留，不能向 --keep-sandbox 宣称 Suspendable。 */
const dockerfileEphemeralProviderModule = Object.freeze({
  ...dockerfileProviderModule,
  id: "niceeval/dockerfile-ephemeral",
  capabilities: Object.freeze({
    ...dockerfileProviderModule.capabilities,
    retention: Object.freeze({ _tag: "DestroyOnly" }),
  }),
} satisfies SandboxProviderModule<DockerfileProviderPlan>);

const dockerImageProviderModule = Object.freeze({
  id: "niceeval/docker-image",
  capabilities: Object.freeze({
    retention: Object.freeze({ _tag: "Suspendable" }),
    reuse: Object.freeze({ _tag: "Supported" }),
    sessionLimit: Object.freeze({ _tag: "Unlimited" }),
  }),
  materialize: (plan, context) => Effect.flatMap(
    loadProviderRuntime(),
    (runtime) => runtime.materializeDockerImageProviderPlan(plan, context),
  ),
  collectBuildPreparation: noBuildPreparation,
} satisfies SandboxProviderModule<DockerImageProviderPlan>);

const dockerImageEphemeralProviderModule = Object.freeze({
  ...dockerImageProviderModule,
  id: "niceeval/docker-image-ephemeral",
  capabilities: Object.freeze({
    ...dockerImageProviderModule.capabilities,
    retention: Object.freeze({ _tag: "DestroyOnly" }),
  }),
} satisfies SandboxProviderModule<DockerImageProviderPlan>);

const e2bProviderModule = Object.freeze({
  id: "niceeval/e2b-template",
  capabilities: Object.freeze({
    retention: Object.freeze({ _tag: "Suspendable" }),
    reuse: Object.freeze({ _tag: "Supported" }),
    sessionLimit: Object.freeze({
      _tag: "ProviderValidated",
      reason: "E2B validates lifetimeMs against the active account tier when the sandbox is created or renewed.",
    }),
  }),
  materialize: (plan, context) => Effect.flatMap(
    loadProviderRuntime(),
    (runtime) => runtime.materializeE2BProviderPlan(plan, context),
  ),
  collectBuildPreparation: noBuildPreparation,
} satisfies SandboxProviderModule<E2BProviderPlan>);

const vercelProviderModule = Object.freeze({
  id: "niceeval/vercel-snapshot",
  capabilities: Object.freeze({
    retention: Object.freeze({ _tag: "Suspendable" }),
    reuse: Object.freeze({ _tag: "Supported" }),
    sessionLimit: Object.freeze({
      _tag: "ProviderValidated",
      reason: "Vercel validates lifetimeMs against the active project plan when the sandbox session is created or extended.",
    }),
  }),
  materialize: (plan, context) => Effect.flatMap(
    loadProviderRuntime(),
    (runtime) => runtime.materializeVercelProviderPlan(plan, context),
  ),
  collectBuildPreparation: noBuildPreparation,
} satisfies SandboxProviderModule<VercelProviderPlan>);

const localProviderModule = Object.freeze({
  id: "niceeval/local-directory",
  capabilities: Object.freeze({
    retention: Object.freeze({ _tag: "DestroyOnly" }),
    reuse: Object.freeze({ _tag: "Unsupported", reason: "local sandbox state is shared with the host" }),
    sessionLimit: Object.freeze({ _tag: "Unlimited" }),
  }),
  materialize: (plan, context) => Effect.flatMap(
    loadProviderRuntime(),
    (runtime) => runtime.materializeLocalProviderPlan(plan, context),
  ),
  collectBuildPreparation: noBuildPreparation,
} satisfies SandboxProviderModule<LocalProviderPlan>);

function customProviderModule(
  name: string,
  create: CustomProviderSandboxOptions["create"],
): SandboxProviderModule<CustomProviderPlan> {
  return Object.freeze({
    id: `custom-provider:${name}`,
    capabilities: Object.freeze({
      retention: Object.freeze({ _tag: "DestroyOnly" }),
      reuse: Object.freeze({ _tag: "Unsupported", reason: "custom provider has no reset contract" }),
      sessionLimit: Object.freeze({ _tag: "Unlimited" }),
    }),
    materialize: (plan, context) => Effect.flatMap(
      loadProviderRuntime(),
      (runtime) => runtime.materializeCustomProviderPlan(plan, context, create),
    ),
    collectBuildPreparation: noBuildPreparation,
  } satisfies SandboxProviderModule<CustomProviderPlan>);
}

function customCaseProviderModule(
  materialize: CustomCaseSandboxOptions["materialize"],
): SandboxProviderModule<CustomCaseProviderPlan> {
  return Object.freeze({
    id: "custom-case",
    capabilities: Object.freeze({
      retention: Object.freeze({ _tag: "DestroyOnly" }),
      reuse: Object.freeze({ _tag: "Unsupported", reason: "custom case has no reset contract" }),
      sessionLimit: Object.freeze({ _tag: "Unlimited" }),
    }),
    materialize: (plan, context) => Effect.flatMap(
      loadProviderRuntime(),
      (runtime) => runtime.materializeCustomCaseProviderPlan(plan, context, materialize),
    ),
    collectBuildPreparation: noBuildPreparation,
  } satisfies SandboxProviderModule<CustomCaseProviderPlan>);
}

/** Built-in factory 集合只属于 provider 侧；测试通过 services 注入，不改全局状态。 */
export function createBuiltinSandboxFactories(
  services: BuiltinSandboxPlannerServices,
): BuiltinSandboxFactories {
  const dockerTarget = (): Effect.Effect<SandboxPlannedTarget, SandboxProviderPlanningError> =>
    Effect.flatMap(services.dockerBuildPlatform, targetFromDocker);
  const dockerTargetForProfile = (
    profile: string | undefined,
  ): Effect.Effect<{
    readonly target: SandboxPlannedTarget;
    readonly profileBinding?: DockerProfileRuntimeBinding;
  }, SandboxProviderPlanningError> => profile === undefined
    ? Effect.map(dockerTarget(), (target) => ({ target }))
    : Effect.flatMap(
        Effect.tryPromise({
          try: async () => (await import("./docker-profile/runtime.ts")).attestDockerProfile(profile),
          catch: (cause) => providerPlanningError(
            "sandbox.docker-profile-attestation-failed",
            "docker",
            cause instanceof Error ? cause.message : String(cause),
            [`Run niceeval docker profile doctor ${profile}.`],
          ),
        }),
        (profileBinding) => Effect.map(targetFromDocker(profileBinding.platform), (target) => ({ target, profileBinding })),
      );

  return Object.freeze({
    dockerComposeSandbox(options: DockerComposeSandboxOptions) {
      assertRecord(options, "dockerComposeSandbox options");
      assertOnlyKeys(
        options,
        ["file", "workspaceService", "build", "user", "env", "credentialEnv", "lifetimeMs", "pathPrepend"],
        "dockerComposeSandbox options",
      );
      if (options.build !== undefined && options.build !== "on-demand" && options.build !== "prebuilt") {
        throw new TypeError('dockerComposeSandbox options.build must be "on-demand" or "prebuilt"');
      }
      const file = location(options.file, "dockerComposeSandbox options.file");
      const workspaceService = nonEmptyString(options.workspaceService, "dockerComposeSandbox options.workspaceService");
      const build = options.build === undefined ? "on-demand" : options.build;
      const user: SandboxExecutionUser = options.user === undefined
        ? { _tag: "EnvironmentDefault" }
        : { _tag: "Configured", value: nonEmptyString(options.user, "dockerComposeSandbox options.user") };
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
      const plannedLifetime = lifetime(options.lifetimeMs, "dockerComposeSandbox options.lifetimeMs");
      const pathPrepend = pathPrependList(options.pathPrepend, "dockerComposeSandbox options.pathPrepend");
      const identity: JsonValue = {
        provider: "docker",
        kind: "compose",
        file,
        workspaceService,
        build,
        user,
        env: { ...env },
        credentialEnv: credentialIdentity,
        lifetime: plannedLifetime,
        ...pathPrependIdentityField(pathPrepend),
      };
      return defineSandboxTemplate({
        provider: "docker",
        kind: "compose",
        publishableIdentity: {
          workspaceService,
          build,
          user: { _tag: options.user === undefined ? "EnvironmentDefault" : "Configured" },
          envKeys: Object.keys(env).sort(),
          credentialEnv: credentialIdentity,
          lifetime: plannedLifetime,
          ...pathPrependIdentityField(pathPrepend),
        },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "Compose", file, workspaceService },
        plan: ({ authorBaseDir }) => Effect.flatMap(dockerTarget(), (target) => Effect.tryPromise({
          try: async () => {
          const plannedFile = plannedLocation(file, authorBaseDir);
          const collection = await collectComposeBuilds({
            file: plannedFile._tag === "Url" ? new URL(plannedFile.value) : plannedFile.value,
            mainService: workspaceService,
            platform: plannedTargetPlatform(target),
            env: runtimeEnv,
          });
          const caseIdentity = composeCollectionIdentity(collection);
          const identityInput: JsonValue = {
            file: plannedFile,
            workspaceService,
            build,
            user,
            env: { ...env },
            credentialEnv: credentialIdentity,
            lifetime: plannedLifetime,
            ...pathPrependIdentityField(pathPrepend),
            plannedBuildKeys: [...collection.buildKeys].sort(),
            plannedCaseIdentityDigest: digestOf(caseIdentity),
          };
          return sandboxProviderPlan({
            provider: "docker",
            plannerRevision: COMPOSE_MATERIALIZER_REVISION,
            caseKind: "compose",
            target,
            scheduling: sharedScheduling("docker", 10),
            module: dockerComposeProviderModule,
            build: providerBuildPlan({
              caseKind: "compose",
              materializerRevision: COMPOSE_MATERIALIZER_REVISION,
              composeBytes: collection.composeBytes,
              buildKeys: collection.buildKeys,
              serviceImageRefs: collection.imageRefs,
              bindMountDigests: collection.bindMountDigests,
              configContents: collection.configContents,
              caseParams: identityInput,
            }),
            runtimePlan: Object.freeze({
              file: plannedFile,
              workspaceService,
              build,
              user: Object.freeze({ ...user }),
              env: Object.freeze({ ...runtimeEnv }),
              collection,
              lifetime: plannedLifetime,
              pathPrepend,
            }),
            publishableIdentity: {
              workspaceService,
              build,
              user: { _tag: options.user === undefined ? "EnvironmentDefault" : "Configured" },
              envKeys: Object.keys(env).sort(),
              credentialEnv: credentialIdentity,
              lifetime: plannedLifetime,
              ...pathPrependIdentityField(pathPrepend),
              ...(caseIdentity as Record<string, JsonValue>),
            },
            privateFingerprintIdentity: {
              identityInput,
              caseIdentity,
            },
            identityMarker: collection.providerIdentityMarker,
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
      assertOnlyKeys(
        options,
        ["context", "dockerfile", "buildArgs", "profile", "target", "user", "privileged", "dockerAccess", "resources", "readiness", "lifetimeMs", "pathPrepend"],
        "dockerfileSandbox options",
      );
      const context = location(options.context, "dockerfileSandbox options.context");
      const dockerfile = options.dockerfile === undefined
        ? "Dockerfile"
        : nonEmptyString(options.dockerfile, "dockerfileSandbox options.dockerfile");
      const buildArgs = stringRecord(options.buildArgs, "dockerfileSandbox options.buildArgs");
      const accessConfig = dockerAccessConfiguration(
        options.dockerAccess,
        options.profile,
        options.privileged,
        "dockerfileSandbox options.dockerAccess",
      );
      const { access, profile, privileged } = accessConfig;
      const targetStage = options.target === undefined
        ? undefined
        : nonEmptyString(options.target, "dockerfileSandbox options.target");
      const user: SandboxExecutionUser = options.user === undefined
        ? { _tag: "EnvironmentDefault" }
        : { _tag: "Configured", value: nonEmptyString(options.user, "dockerfileSandbox options.user") };
      const resources = dockerResourcesForProfile(profile, privileged, options.resources, "dockerfileSandbox options.resources");
      const readiness = dockerReadinessForAccess(access, options.readiness, "dockerfileSandbox options.readiness");
      const plannedLifetime = lifetime(options.lifetimeMs, "dockerfileSandbox options.lifetimeMs");
      const pathPrepend = pathPrependList(options.pathPrepend, "dockerfileSandbox options.pathPrepend");
      const identity: JsonValue = {
        provider: "docker",
        kind: "dockerfile",
        context,
        dockerfile,
        buildArgs: { ...buildArgs },
        user,
        ...dockerRuntimeIdentity(privileged, resources, access),
        ...(targetStage === undefined ? {} : { target: targetStage }),
        readiness: readinessIdentity(readiness),
        lifetime: plannedLifetime,
        ...pathPrependIdentityField(pathPrepend),
      };
      return defineSandboxTemplate({
        provider: "docker",
        kind: "dockerfile",
        publishableIdentity: {
          buildArgKeys: Object.keys(buildArgs).sort(),
          user: { _tag: options.user === undefined ? "EnvironmentDefault" : "Configured" },
          ...dockerRuntimeIdentity(privileged, resources, access),
          ...(targetStage === undefined ? {} : { target: targetStage }),
          readiness: readinessIdentity(readiness),
          lifetime: plannedLifetime,
          ...pathPrependIdentityField(pathPrepend),
        },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "Dockerfile", context, dockerfile },
        plan: ({ authorBaseDir }) => Effect.flatMap(dockerTargetForProfile(profile), ({ target, profileBinding }) => Effect.tryPromise({
          try: async () => {
          const plannedContext = plannedLocation(context, authorBaseDir);
          const build = await resolveDockerfileBuildIdentity({
            provider: "docker",
            context: plannedContext._tag === "Url" ? new URL(plannedContext.value) : plannedContext.value,
            dockerfile,
            buildArgs,
            ...(targetStage === undefined ? {} : { target: targetStage }),
            platform: plannedTargetPlatform(target),
            label: "Dockerfile sandbox",
          });
          const runtimeIdentity: JsonValue = {
            context: plannedContext,
            dockerfile,
            buildArgs: { ...buildArgs },
            user,
            ...dockerRuntimeIdentity(privileged, resources, access),
            ...(targetStage === undefined ? {} : { target: targetStage }),
            readiness: readinessIdentity(readiness),
            plannedBuildKey: build.buildKey,
            lifetime: plannedLifetime,
            ...pathPrependIdentityField(pathPrepend),
          };
          return sandboxProviderPlan({
            provider: "docker",
            plannerRevision: DOCKERFILE_PROVIDER_PLANNER_REVISION,
            caseKind: "on-demand-build",
            target,
            scheduling: sharedScheduling("docker", 10),
            module: resources.readOnlyRootfs === true || resources.tmpfs !== undefined
              ? dockerfileEphemeralProviderModule
              : dockerfileProviderModule,
            build: providerBuildPlan({
              caseKind: "on-demand-build",
              materializerRevision: DOCKERFILE_MATERIALIZER_REVISION,
              buildKeys: [build.buildKey],
              caseParams: {
                provider: "docker",
                buildKey: build.buildKey,
                ...(profileBinding === undefined ? {} : {
                  dockerProfilePolicy: {
                    securityLevel: profileBinding.profile.securityLevel,
                    semanticPolicyRevision: profileBinding.profile.semanticPolicyRevision,
                  },
                }),
                ...(targetStage === undefined ? {} : { target: targetStage }),
                ...dockerRuntimeIdentity(privileged, resources, access),
                readiness: readinessIdentity(readiness),
                lifetime: plannedLifetime,
                ...pathPrependIdentityField(pathPrepend),
              },
            }),
            runtimePlan: Object.freeze({
              context: plannedContext,
              dockerfile,
              buildArgs,
              ...(profile === undefined ? {} : { profile }),
              ...(profileBinding === undefined ? {} : { profileBinding }),
              ...(targetStage === undefined ? {} : { target: targetStage }),
              ...(readiness === undefined ? {} : { readiness }),
              user: Object.freeze({ ...user }),
              privileged,
              ...(access === undefined ? {} : { dockerAccess: access }),
              resources,
              build,
              buildKey: build.buildKey,
              platform: plannedTargetPlatform(target),
              lifetime: plannedLifetime,
              pathPrepend,
            }),
            publishableIdentity: {
              buildArgKeys: Object.keys(buildArgs).sort(),
              user: { _tag: options.user === undefined ? "EnvironmentDefault" : "Configured" },
              ...dockerRuntimeIdentity(privileged, resources, access),
              buildKey: build.buildKey,
              ...(profileBinding === undefined ? {} : {
                dockerProfile: {
                  securityLevel: profileBinding.profile.securityLevel,
                  semanticPolicyRevision: profileBinding.profile.semanticPolicyRevision,
                },
              }),
              lifetime: plannedLifetime,
              ...pathPrependIdentityField(pathPrepend),
            },
            privateFingerprintIdentity: {
              runtimeIdentity,
              buildKey: build.buildKey,
              ...dockerRuntimeIdentity(privileged, resources, access),
              ...(targetStage === undefined ? {} : { target: targetStage }),
              readiness: readinessIdentity(readiness),
              ...(profileBinding === undefined ? {} : {
                dockerProfilePolicy: {
                  securityLevel: profileBinding.profile.securityLevel,
                  semanticPolicyRevision: profileBinding.profile.semanticPolicyRevision,
                },
              }),
              lifetime: plannedLifetime,
            },
            identityMarker: build.providerIdentityMarker,
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
      assertOnlyKeys(
        options,
        ["image", "profile", "user", "privileged", "dockerAccess", "resources", "readiness", "lifetimeMs", "pathPrepend"],
        "dockerImageSandbox options",
      );
      const image = nonEmptyString(options.image, "dockerImageSandbox options.image");
      const accessConfig = dockerAccessConfiguration(
        options.dockerAccess,
        options.profile,
        options.privileged,
        "dockerImageSandbox options.dockerAccess",
      );
      const { access, profile, privileged } = accessConfig;
      const user: SandboxExecutionUser = options.user === undefined
        ? { _tag: "EnvironmentDefault" }
        : { _tag: "Configured", value: nonEmptyString(options.user, "dockerImageSandbox options.user") };
      const resources = dockerResourcesForProfile(profile, privileged, options.resources, "dockerImageSandbox options.resources");
      const readiness = dockerReadinessForAccess(access, options.readiness, "dockerImageSandbox options.readiness");
      const plannedLifetime = lifetime(options.lifetimeMs, "dockerImageSandbox options.lifetimeMs");
      const pathPrepend = pathPrependList(options.pathPrepend, "dockerImageSandbox options.pathPrepend");
      const identity: JsonValue = {
        provider: "docker",
        kind: "image",
        image,
        user,
        ...dockerRuntimeIdentity(privileged, resources, access),
        readiness: readinessIdentity(readiness),
        lifetime: plannedLifetime,
        ...pathPrependIdentityField(pathPrepend),
      };
      const publishedUser = { _tag: options.user === undefined ? "EnvironmentDefault" as const : "Configured" as const };
      return defineSandboxTemplate({
        provider: "docker",
        kind: "image",
        publishableIdentity: {
          source: "configured-image",
          user: publishedUser,
          ...dockerRuntimeIdentity(privileged, resources, access),
          readiness: readinessIdentity(readiness),
          lifetime: plannedLifetime,
          ...pathPrependIdentityField(pathPrepend),
        },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "None" },
        plan: () => Effect.map(dockerTargetForProfile(profile), ({ target, profileBinding }) => {
          return sandboxProviderPlan({
            provider: "docker",
            plannerRevision: DOCKER_IMAGE_PROVIDER_REVISION,
            caseKind: "prebuilt",
            target,
            scheduling: sharedScheduling("docker", 10),
            module: resources.readOnlyRootfs === true || resources.tmpfs !== undefined
              ? dockerImageEphemeralProviderModule
              : dockerImageProviderModule,
            build: providerBuildPlan({
              caseKind: "prebuilt",
              materializerRevision: DOCKER_IMAGE_PROVIDER_REVISION,
              buildKeys: [],
              caseParams: {
                image,
                user,
                ...(profileBinding === undefined ? {} : {
                  dockerProfilePolicy: {
                    securityLevel: profileBinding.profile.securityLevel,
                    semanticPolicyRevision: profileBinding.profile.semanticPolicyRevision,
                  },
                }),
                ...dockerRuntimeIdentity(privileged, resources, access),
                readiness: readinessIdentity(readiness),
                lifetime: plannedLifetime,
                ...pathPrependIdentityField(pathPrepend),
              },
            }),
            runtimePlan: Object.freeze({
              image,
              ...(profile === undefined ? {} : { profile }),
              ...(profileBinding === undefined ? {} : { profileBinding }),
              ...(readiness === undefined ? {} : { readiness }),
              user: Object.freeze({ ...user }),
              privileged,
              ...(access === undefined ? {} : { dockerAccess: access }),
              resources,
              lifetime: plannedLifetime,
              pathPrepend,
            }),
            publishableIdentity: {
              source: "configured-image",
              user: publishedUser,
              ...dockerRuntimeIdentity(privileged, resources, access),
              readiness: readinessIdentity(readiness),
              ...(profileBinding === undefined ? {} : {
                dockerProfilePolicy: {
                  securityLevel: profileBinding.profile.securityLevel,
                  semanticPolicyRevision: profileBinding.profile.semanticPolicyRevision,
                },
              }),
              lifetime: plannedLifetime,
              ...pathPrependIdentityField(pathPrepend),
            },
            privateFingerprintIdentity: {
              image,
              user,
              ...dockerRuntimeIdentity(privileged, resources, access),
              readiness: readinessIdentity(readiness),
              ...(profileBinding === undefined ? {} : {
                dockerProfilePolicy: {
                  securityLevel: profileBinding.profile.securityLevel,
                  semanticPolicyRevision: profileBinding.profile.semanticPolicyRevision,
                },
              }),
              lifetime: plannedLifetime,
              ...pathPrependIdentityField(pathPrepend),
            },
            identityMarker: looksLikeDigestRef(image)
              ? undefined
              : unresolvedProviderFingerprintMarker(
                  "sandbox.image-unresolved",
                  "Docker image is not pinned to a sha256 digest.",
                ),
          });
        }),
      });
    },

    e2bSandbox(options: E2BSandboxOptions) {
      assertRecord(options, "e2bSandbox options");
      assertOnlyKeys(options, ["template", "user", "lifetimeMs", "pathPrepend"], "e2bSandbox options");
      const template = nonEmptyString(options.template, "e2bSandbox options.template");
      const user: SandboxExecutionUser = options.user === undefined
        ? { _tag: "EnvironmentDefault" }
        : { _tag: "Configured", value: nonEmptyString(options.user, "e2bSandbox options.user") };
      const publishedUser = { _tag: options.user === undefined ? "EnvironmentDefault" as const : "Configured" as const };
      const plannedLifetime = lifetime(options.lifetimeMs, "e2bSandbox options.lifetimeMs");
      const pathPrepend = pathPrependList(options.pathPrepend, "e2bSandbox options.pathPrepend");
      const identity: JsonValue = { provider: "e2b", kind: "template", template, user, lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) };
      return defineSandboxTemplate({
        provider: "e2b",
        kind: "template",
        publishableIdentity: { user: publishedUser, lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "None" },
        plan: () => {
          return Effect.succeed(sandboxProviderPlan({
            provider: "e2b",
            plannerRevision: "e2b-template-1",
            caseKind: "prebuilt",
            target: standardLinuxTarget(),
            scheduling: sharedScheduling("e2b", 20),
            module: e2bProviderModule,
            build: providerBuildPlan({
              caseKind: "prebuilt",
              materializerRevision: "e2b-template-1",
              buildKeys: [],
              caseParams: { template, user, lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) },
            }),
            runtimePlan: Object.freeze({ template, user: Object.freeze({ ...user }), lifetime: plannedLifetime, pathPrepend }),
            publishableIdentity: { user: publishedUser, lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) },
            privateFingerprintIdentity: { template, user, lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) },
          }));
        },
      });
    },

    vercelSandbox(options: VercelSandboxOptions) {
      assertRecord(options, "vercelSandbox options");
      assertOnlyKeys(options, ["snapshotId", "lifetimeMs", "pathPrepend"], "vercelSandbox options");
      const snapshotId = nonEmptyString(options.snapshotId, "vercelSandbox options.snapshotId");
      const plannedLifetime = lifetime(options.lifetimeMs, "vercelSandbox options.lifetimeMs");
      const pathPrepend = pathPrependList(options.pathPrepend, "vercelSandbox options.pathPrepend");
      const identity: JsonValue = { provider: "vercel", kind: "snapshot", snapshotId, lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) };
      return defineSandboxTemplate({
        provider: "vercel",
        kind: "snapshot",
        publishableIdentity: { lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "None" },
        plan: () => {
          return Effect.succeed(sandboxProviderPlan({
            provider: "vercel",
            plannerRevision: "vercel-snapshot-1",
            caseKind: "prebuilt",
            target: standardLinuxTarget(),
            scheduling: sharedScheduling("vercel", 1),
            module: vercelProviderModule,
            build: providerBuildPlan({
              caseKind: "prebuilt",
              materializerRevision: "vercel-snapshot-1",
              buildKeys: [],
              caseParams: { snapshotId, lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) },
            }),
            runtimePlan: Object.freeze({ snapshotId, lifetime: plannedLifetime, pathPrepend }),
            publishableIdentity: { lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) },
            privateFingerprintIdentity: { snapshotId, lifetime: plannedLifetime, ...pathPrependIdentityField(pathPrepend) },
          }));
        },
      });
    },

    localSandbox(options: LocalSandboxOptions = {}) {
      assertRecord(options, "localSandbox options");
      assertOnlyKeys(options, ["dir", "pathPrepend"], "localSandbox options");
      const directory = options.dir === undefined
        ? Object.freeze({ _tag: "AuthorBaseDir" as const })
        : Object.freeze({
            _tag: "Configured" as const,
            value: nonEmptyString(options.dir, "localSandbox options.dir"),
          });
      const pathPrepend = pathPrependList(options.pathPrepend, "localSandbox options.pathPrepend");
      const identity: JsonValue = { provider: "local", kind: "directory", directory, ...pathPrependIdentityField(pathPrepend) };
      return defineSandboxTemplate({
        provider: "local",
        kind: "directory",
        publishableIdentity: { directory: { _tag: directory._tag }, ...pathPrependIdentityField(pathPrepend) },
        privateFingerprintIdentity: identity,
        leakGate: { _tag: "None" },
        plan: ({ authorBaseDir }) => {
          const configured = directory._tag === "AuthorBaseDir"
            ? authorBaseDir
            : resolve(authorBaseDir, directory.value);
          return Effect.succeed(sandboxProviderPlan({
            provider: "local",
            plannerRevision: "local-directory-1",
            caseKind: "prebuilt",
            target: { platform: services.hostPlatform, source: "host" },
            scheduling: exclusiveScheduling("local-worktree"),
            module: localProviderModule,
            build: providerBuildPlan({
              caseKind: "prebuilt",
              materializerRevision: "local-directory-1",
              buildKeys: [],
              caseParams: { directory: configured, ...pathPrependIdentityField(pathPrepend) },
            }),
            runtimePlan: Object.freeze({ directory: configured, pathPrepend }),
            publishableIdentity: { directory: { _tag: directory._tag }, ...pathPrependIdentityField(pathPrepend) },
            privateFingerprintIdentity: { directory: configured, ...pathPrependIdentityField(pathPrepend) },
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

/**
 * 统一的单容器 Docker factory。Docker access用判别联合选择显式socket、raw DinD或managed DinD；
 * 宿主路径/profile只保存到私有runtime binding。本函数不连接Docker，provider接线由后续层负责。
 */
export function dockerSandbox(options: DockerSandboxOptions): SandboxLayer<"template-bearing"> {
  assertRecord(options, "dockerSandbox options");
  assertOnlyKeys(
    options,
    ["source", "dockerAccess", "resources", "user", "readiness", "lifetimeMs", "pathPrepend"],
    "dockerSandbox options",
  );
  const source = options.source;
  assertRecord(source, "dockerSandbox options.source");
  if (source.type === "image") {
    assertOnlyKeys(source, ["type", "image"], "dockerSandbox options.source");
    const access = dockerAccess(options.dockerAccess, "dockerSandbox options.dockerAccess");
    const resources = access?.mode === "dind" && access.isolation === "managed-rootless"
      ? managedDockerResources(options.resources, "dockerSandbox options.resources")
      : options.resources;
    return dockerImageSandbox({
      image: nonEmptyString(source.image, "dockerSandbox options.source.image"),
      ...(options.user === undefined ? {} : { user: options.user }),
      ...(access === undefined ? {} : { dockerAccess: access }),
      ...(resources === undefined ? {} : { resources }),
      ...(options.readiness === undefined ? {} : { readiness: options.readiness }),
      ...(options.lifetimeMs === undefined ? {} : { lifetimeMs: options.lifetimeMs }),
      ...(options.pathPrepend === undefined ? {} : { pathPrepend: options.pathPrepend }),
    });
  }
  if (source.type === "dockerfile") {
    assertOnlyKeys(source, ["type", "context", "file", "buildArgs", "target"], "dockerSandbox options.source");
    const access = dockerAccess(options.dockerAccess, "dockerSandbox options.dockerAccess");
    const resources = access?.mode === "dind" && access.isolation === "managed-rootless"
      ? managedDockerResources(options.resources, "dockerSandbox options.resources")
      : options.resources;
    return dockerfileSandbox({
      context: source.context,
      ...(source.file === undefined ? {} : { dockerfile: source.file }),
      ...(source.buildArgs === undefined ? {} : { buildArgs: source.buildArgs }),
      ...(source.target === undefined ? {} : { target: source.target }),
      ...(options.user === undefined ? {} : { user: options.user }),
      ...(access === undefined ? {} : { dockerAccess: access }),
      ...(resources === undefined ? {} : { resources }),
      ...(options.readiness === undefined ? {} : { readiness: options.readiness }),
      ...(options.lifetimeMs === undefined ? {} : { lifetimeMs: options.lifetimeMs }),
      ...(options.pathPrepend === undefined ? {} : { pathPrepend: options.pathPrepend }),
    });
  }
  throw dockerProfileError({
    code: "sandbox.docker-profile-schema-invalid",
    path: "dockerSandbox options.source.type",
    message: `dockerSandbox source type ${JSON.stringify(source.type)} is unsupported`,
  });
}

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
  const module = customProviderModule(name, options.create);
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
    plan: () => Effect.succeed(sandboxProviderPlan({
      provider: name,
      plannerRevision: "custom-provider-1",
      caseKind: "custom",
      target: { platform: targetPlatform, source: "provider-defined" },
      scheduling,
      module,
      build: providerBuildPlan({
        caseKind: "custom",
        materializerRevision: "custom-provider-1",
        buildKeys: [],
        caseParams: identity,
      }),
      runtimePlan: Object.freeze({ name }),
      publishableIdentity: {},
      privateFingerprintIdentity: identity,
      identityMarker: unresolvedProviderFingerprintMarker(
        "sandbox.custom-provider-opaque",
        `custom provider ${JSON.stringify(name)} owns an opaque create callback; use defineSandboxCase({ identity, materialize }) for cross-Run carry.`,
      ),
    })),
  });
}

export function defineSandboxCase(
  options: CustomCaseSandboxOptions,
): SandboxLayer<"template-bearing"> {
  assertRecord(options, "defineSandboxCase options");
  assertOnlyKeys(options, ["identity", "targetPlatform", "services", "materialize"], "defineSandboxCase options");
  if (typeof options.materialize !== "function") {
    throw new TypeError("defineSandboxCase options.materialize must be a function");
  }
  const targetPlatform = freezePlatform(options.targetPlatform);
  if (
    options.services === null ||
    typeof options.services !== "object" ||
    (options.services._tag !== "Supported" && options.services._tag !== "Unsupported") ||
    Object.keys(options.services).some((key) => key !== "_tag")
  ) {
    throw new TypeError(
      'defineSandboxCase options.services must be exactly { _tag: "Supported" } or { _tag: "Unsupported" }',
    );
  }
  const services = Object.freeze({ _tag: options.services._tag });
  const identity = freezeJson(assertPureDataIdentity(options.identity));
  const module = customCaseProviderModule(options.materialize);
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
    plan: () => Effect.succeed(sandboxProviderPlan({
      provider: "custom-case",
      plannerRevision: "custom-case-1",
      caseKind: "custom",
      target: { platform: targetPlatform, source: "provider-defined" },
      scheduling: sharedScheduling("custom-case", 5),
      module,
      build: providerBuildPlan({
        caseKind: "custom",
        materializerRevision: "custom-case-1",
        buildKeys: [],
        caseParams: declarationIdentity,
      }),
      runtimePlan: Object.freeze({ identity, services }),
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
