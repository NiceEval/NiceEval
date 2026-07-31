// Sandbox case 的共享类型面:种类、source、能力、物化结果与注册表条目。
// 实现与协商逻辑见 case.ts;身份算法见 identity.ts。
// 契约单源:docs/feature/sandbox/case.md。

import type { JsonValue } from "../shared/types.ts";
import type { CommandResult, Sandbox } from "./types.ts";
import type { BuildKey, CaseKey, SandboxCaseKind } from "./identity.ts";

export type { SandboxCaseKind };

/** folder-local source 的 kind:与 SandboxSpec.materializers 表键对齐。 */
export type SandboxSourceKind = "compose" | "dockerfile";

/** 第一期能力位;声明即承担对应完整契约。 */
export type SandboxCapability = "services" | "group-keep";

/**
 * Eval 侧中性 sandbox source:只声明要什么执行空间,不选 provider。
 * 用 `composeSandbox` / `dockerfileSandbox` 构造;裸对象不算。
 */
export type SandboxSource = ComposeSandboxSource | DockerfileSandboxSource;

export interface ComposeSandboxSource {
  readonly kind: "compose";
  readonly file: string | URL;
  readonly mainService: string;
  readonly build?: "on-demand" | "prebuilt";
  readonly executionUser?: string;
  /**
   * Compose 插值环境变量(如 Terminal-Bench 的 `T_BENCH_*`)。
   * 只把键名计入 BuildKey;随机目录/容器名等值是物化事实,不进身份。
   */
  readonly env?: Readonly<globalThis.Record<string, string>>;
  /** 品牌标记:防同形误换;不要手写本字段。 */
  readonly __brand: "niceeval.sandboxSource.compose";
}

export interface DockerfileSandboxSource {
  readonly kind: "dockerfile";
  readonly context: string | URL;
  readonly dockerfile?: string;
  readonly buildArgs?: Readonly<globalThis.Record<string, string>>;
  readonly __brand: "niceeval.sandboxSource.dockerfile";
}

/** 逐服务采证与控制;不进 Sandbox 接口。 */
export interface ServiceController {
  exec(service: string, command: string[]): Promise<CommandResult>;
  collectLogs(service: string): Promise<Buffer>;
  stop(service: string): Promise<void>;
}

/** provider 可序列化、可 detached stop 的资源定位。 */
export type ProviderLocator = JsonValue;

export interface SandboxLocator {
  readonly sandboxId: string;
  readonly provider?: string;
}

/**
 * 留存注册表条目形状:不硬编码 services[] / network / namespace。
 * `resources` 是 provider 自己的定位数据。
 */
export interface SandboxGroupEntry {
  readonly provider: string;
  readonly profile: string;
  readonly primary: SandboxLocator;
  readonly resources: ProviderLocator;
  readonly state: "alive" | "dormant" | "partial";
}

/** case 返回的资源组:清理与留存对着它,不是对着主 Sandbox 单独 stop。 */
export interface SandboxResourceGroup {
  readonly primary: SandboxLocator;
  readonly resources: ProviderLocator;
  stop(): Promise<void>;
  readonly entry?: SandboxGroupEntry;
}

/** materialize 成功后的完整产物:永远只有一个主 Sandbox。 */
export interface MaterializedSandboxCase {
  /** 唯一主 Sandbox:Agent / Eval / 文件 API / workdir / 分类账 / diff 都观察它。 */
  readonly sandbox: Sandbox;
  readonly services?: ServiceController;
  readonly group: SandboxResourceGroup;
  readonly caseKind: SandboxCaseKind;
  readonly caseKey: CaseKey;
  readonly buildKeys: readonly BuildKey[];
  /** 纯数据身份;进指纹与运行记录。 */
  readonly identity: JsonValue;
  /** 缺稳定身份或浮动 tag 未解析时为 false——禁止携带。 */
  readonly carryEligible: boolean;
  /** 物化事实(locator、实际 digest、project name 等),不进 CaseKey。 */
  readonly facts: JsonValue;
}

/** Docker environments 表值:靠判别键区分的原生纯数据。 */
export type DockerEnvironmentCase =
  | { readonly image: string; readonly build?: undefined; readonly compose?: undefined }
  | {
      readonly build: DockerBuildDecl;
      readonly image?: undefined;
      readonly compose?: undefined;
    }
  | {
      readonly compose: DockerComposeDecl;
      readonly image?: undefined;
      readonly build?: undefined;
    };

export interface DockerBuildDecl {
  readonly context: string;
  readonly dockerfile?: string;
  readonly args?: Readonly<globalThis.Record<string, string>>;
  readonly target?: string;
}

export interface DockerComposeDecl {
  readonly file: string;
  readonly mainService: string;
  readonly env?: Readonly<globalThis.Record<string, string>>;
  readonly projectName?: string;
}

export type E2BEnvironmentCase =
  | { readonly template: string; readonly build?: undefined }
  | {
      /** E2B Template API 只接收 context + Dockerfile，不虚构 Docker CLI 的 args/target。 */
      readonly build: Pick<DockerBuildDecl, "context" | "dockerfile">;
      readonly template?: undefined;
    };

export type VercelEnvironmentCase = {
  readonly snapshotId: string;
};

/** 自定义 environments 表值:必须带纯数据 identity + materialize。 */
export interface CustomEnvironmentCase {
  readonly identity: JsonValue;
  readonly capabilities?: readonly SandboxCapability[];
  readonly materialize: (
    ctx: SandboxMaterializeContext,
  ) => Promise<CustomMaterializeResult>;
  /**
   * group keep 需要可序列化定位 + 跨进程恢复 + detached stop;
   * 未同时提供时不得声明 `"group-keep"`。
   */
  readonly groupKeep?: {
    readonly resources: ProviderLocator;
    wake(resources: ProviderLocator): Promise<CustomMaterializeResult>;
    destroy(resources: ProviderLocator): Promise<void>;
  };
}

export interface CustomMaterializeResult {
  readonly sandbox: Sandbox;
  readonly services?: ServiceController;
  readonly stop: () => Promise<void>;
  readonly resources?: ProviderLocator;
  readonly facts?: JsonValue;
}

export interface SandboxMaterializeContext {
  readonly evalId: string;
  readonly profile: string;
  readonly signal?: AbortSignal;
  /** 构建协调器放行后写入的 BuildKey → locator;无构建的 case 可为空。 */
  readonly buildLocators?: ReadonlyMap<BuildKey, string>;
}

/**
 * folder-local source 的物化器:按 source kind 挂在 SandboxSpec.materializers。
 * Compose 完整实现在 compose.ts;本内核只认接口。
 */
export interface SandboxMaterializer {
  readonly kind: SandboxSourceKind;
  readonly revision: string;
  materialize(
    source: SandboxSource,
    ctx: SandboxMaterializeContext,
  ): Promise<MaterializedSandboxCase>;
}

export type SandboxMaterializers = Readonly<Partial<globalThis.Record<SandboxSourceKind, SandboxMaterializer>>>;
