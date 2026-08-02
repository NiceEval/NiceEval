// Sandbox case 的共享类型面:种类、source、能力、物化结果与注册表条目。
// provider 完成态与 materializer 见 layer.ts / runtime.ts；身份算法见 identity.ts。
// 契约单源:docs/feature/sandbox/case.md。

import type { JsonValue } from "../shared/types.ts";
import type { CommandResult, Sandbox } from "./types.ts";
import type { BuildKey, CaseKey, SandboxCaseKind } from "./identity.ts";

export type { SandboxCaseKind };

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

export interface SandboxMaterializeContext {
  readonly evalId: string;
  readonly profile: string;
  readonly signal: AbortSignal;
  /** 构建协调器放行后写入的 BuildKey → locator;无构建的 case 可为空。 */
  readonly buildLocators: ReadonlyMap<BuildKey, JsonValue>;
}
