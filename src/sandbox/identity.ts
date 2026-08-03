// BuildKey / CaseKey 与携带门所需的身份解析。
// 契约单源:docs/feature/sandbox/case.md「BuildKey 与 CaseKey」「身份解析」。
// BuildKey 管构建产物复用;CaseKey 管完整 attempt 环境身份与携带指纹。
// 凭据值永不进身份;浮动 tag 解不出 digest 时保留声明值作为 opaque marker。

import { createHash } from "node:crypto";
import type { JsonValue } from "../shared/types.ts";

/** 五类完整 case;与 case-types 同源字面量。 */
export type SandboxCaseKind =
  | "prebuilt"
  | "on-demand-build"
  | "compose"
  | "cloud-compose"
  | "custom";

/** 构建产物身份:同 key 应得同一构建结果。 */
export type BuildKey = string;

/** 完整 sandbox case 身份:携带门与 eval fingerprint 认它。 */
export type CaseKey = string;

/** 计算 BuildKey 的纯数据输入(规划期、携带决策之前)。 */
export interface BuildKeyInput {
  readonly builderKind: string;
  readonly builderRevision: string;
  readonly platform: string;
  /** Dockerfile 原文或已读字节。 */
  readonly dockerfile: string | Uint8Array;
  /** `.dockerignore` 求值后的 build context 内容摘要(调用方负责求值)。 */
  readonly contextDigest: string;
  /** 非敏感、已解析的 build args。 */
  readonly buildArgs?: Readonly<globalThis.Record<string, string>>;
  /** 多阶段 Dockerfile 的目标 stage；省略表示最终 stage。 */
  readonly target?: string;
  /** FROM 解析后的 digest。 */
  readonly fromDigest: string;
  /** materializer 生成的 filtered context 规则自身进 BuildKey。 */
  readonly contextFilterRules?: string;
}

/** 计算 CaseKey 的纯数据输入。逐 attempt 的容器名 / 临时目录 / 随机 project name 不进。 */
export interface CaseKeyInput {
  readonly caseKind: SandboxCaseKind;
  readonly materializerRevision: string;
  readonly composeBytes?: string;
  readonly overlayBytes?: string;
  readonly buildKeys: readonly BuildKey[];
  readonly serviceImageDigests?: Readonly<globalThis.Record<string, string>>;
  readonly bindMountDigests?: Readonly<globalThis.Record<string, string>>;
  /** env_file / config / secret 的非敏感内容(或内容摘要)。 */
  readonly configContents?: Readonly<globalThis.Record<string, string>>;
  /** 影响主执行空间、网络与就绪语义的规范化 case 参数。 */
  readonly caseParams?: JsonValue;
}

/**
 * 浮动 image tag 的解析结果。
 * 解不出 digest 时仍可运行并记录 tag；是否发生变化由声明值或显式 rerun 表达。
 */
export type ImageRefResolution =
  | { readonly status: "resolved"; readonly ref: string; readonly digest: string }
  | { readonly status: "unresolved"; readonly ref: string };

/** 凭据引用:只记名字;选租户/数据集/权限面时另带非敏感 revision。 */
export interface CredentialRef {
  readonly name: string;
  /** 凭据同时选择了不同租户、数据集或权限面时必须提供;secret 值本身永不进身份。 */
  readonly revision?: string;
}

/** 键序稳定的 JSON 序列化,保证同一 payload 永远同一 digest。 */
export function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = value as globalThis.Record<string, JsonValue>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(",")}}`;
}

export function digestOf(value: JsonValue): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function digestBytes(bytes: string | Uint8Array): string {
  const hasher = createHash("sha256");
  hasher.update(typeof bytes === "string" ? Buffer.from(bytes) : bytes);
  return hasher.digest("hex");
}

export function computeBuildKey(input: BuildKeyInput): BuildKey {
  return digestOf({
    builderKind: input.builderKind,
    builderRevision: input.builderRevision,
    platform: input.platform,
    dockerfile: digestBytes(input.dockerfile),
    contextDigest: input.contextDigest,
    buildArgs: input.buildArgs ?? {},
    ...(input.target !== undefined ? { target: input.target } : {}),
    fromDigest: input.fromDigest,
    ...(input.contextFilterRules !== undefined ? { contextFilterRules: input.contextFilterRules } : {}),
  });
}

export function computeCaseKey(input: CaseKeyInput): CaseKey {
  return digestOf({
    caseKind: input.caseKind,
    materializerRevision: input.materializerRevision,
    ...(input.composeBytes !== undefined ? { composeBytes: digestBytes(input.composeBytes) } : {}),
    ...(input.overlayBytes !== undefined ? { overlayBytes: digestBytes(input.overlayBytes) } : {}),
    buildKeys: [...input.buildKeys].sort(),
    serviceImageDigests: input.serviceImageDigests ?? {},
    bindMountDigests: input.bindMountDigests ?? {},
    configContents: input.configContents ?? {},
    caseParams: input.caseParams ?? null,
  });
}

/**
 * 解析浮动 image tag。
 * `resolveDigest` 由 provider / registry 客户端提供:成功返回 digest,解不出返回 undefined。
 * 解不出时仍返回明确的 opaque 状态；调用方可把原始 ref 作为声明身份的一部分。
 */
export async function resolveFloatingImageTag(
  ref: string,
  resolveDigest: (ref: string) => Promise<string | undefined>,
): Promise<ImageRefResolution> {
  if (looksLikeDigestRef(ref)) {
    const digest = ref.includes("@") ? ref.slice(ref.indexOf("@") + 1) : ref;
    return { status: "resolved", ref, digest };
  }
  const digest = await resolveDigest(ref);
  if (digest === undefined || digest === "") {
    return { status: "unresolved", ref };
  }
  return { status: "resolved", ref, digest };
}

/** 形如 `repo@sha256:…` 或裸 `sha256:…` 已钉 digest,无需再问 registry。 */
export function looksLikeDigestRef(ref: string): boolean {
  return /@sha256:[a-f0-9]{64}$/i.test(ref) || /^sha256:[a-f0-9]{64}$/i.test(ref);
}

/**
 * Provider identity compatibility marker for plans written before carry
 * eligibility was removed. It remains fingerprint data and is never a gate.
 */
export function unresolvedProviderFingerprintMarker(code: string, reason: string): JsonValue {
  return { _tag: "Ineligible", code, reason };
}

/**
 * 凭据进身份的贡献:只含引用名与可选 revision,永不含 secret 值。
 * 轮换不改变环境语义时只传 `name`;选租户/数据集/权限面时调用方必须给 `revision`。
 */
export function credentialIdentityContribution(cred: CredentialRef): { name: string; revision?: string } {
  return cred.revision !== undefined ? { name: cred.name, revision: cred.revision } : { name: cred.name };
}

/** 值是否可序列化为 JSON 纯数据(无函数 / undefined / bigint / symbol / 非有限数 / 循环引用)。 */
export function isPureDataIdentity(value: unknown): value is JsonValue {
  return isPureDataTree(value, new Set());
}

function isPureDataTree(value: unknown, ancestors: ReadonlySet<object>): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) return value.every((child) => isPureDataTree(child, nextAncestors));
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return false;
  }
  for (const [key, child] of Object.entries(value as globalThis.Record<string, unknown>)) {
    if (typeof key !== "string") return false;
    if (!isPureDataTree(child, nextAncestors)) return false;
  }
  return true;
}

/**
 * 自定义 case 的 identity 必须是纯数据。
 * 函数体不参与自动哈希；需要稳定身份的 custom case 仍必须提供纯数据声明，
 * 不能用函数名或 toString() 冒充；opaque provider callback 的变化由作者 revision 或显式 rerun 表达。
 */
export function assertPureDataIdentity(identity: unknown): JsonValue {
  if (!isPureDataIdentity(identity)) {
    throw new Error(
      "sandbox case identity must be pure JSON data (no functions); provide a declared identity for fingerprinting",
    );
  }
  return identity;
}
