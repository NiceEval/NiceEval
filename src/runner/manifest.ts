// manifest 相减:哈希做索引,清单做解释。
//
// 指纹是扁平哈希,只回答「等不等」;回答「哪里变了」的是清单。新旧两份相减得到带名字的精确
// 差异,`--dry` 拿它解释、`--accept` 拿它作授权单位。清单的落盘形状在 `record/manifest.ts`,
// 算出在 `fingerprint.ts` 的 `fingerprintWithManifest`(与指纹同一份输入)。
//
// 契约单源:docs/feature/experiments/cache.md「manifest:哈希做索引,清单做解释」。

import type { EvalManifest } from "../record/manifest.ts";
import type { JsonValue } from "../types.ts";
import {
  addedConfigField,
  changedConfigField,
  removedConfigField,
  type ConfigFieldDelta,
} from "./config-identity.ts";

export {
  FINGERPRINT_ALGORITHM_VERSION,
  FINGERPRINT_COVERAGE_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  MANIFESTS_FILE,
  parseRunManifests,
  type EvalManifest,
  type RunManifests,
} from "../record/manifest.ts";

export type FingerprintDiagnosticFact =
  | {
      readonly label: string;
      readonly value: JsonValue;
    }
  | {
      readonly label: string;
      readonly from: JsonValue;
      readonly to: JsonValue;
    };

export interface FingerprintDiagnostic {
  /** producer 命名空间内的开放 code。 */
  readonly code: string;
  /** 不依赖 code 才能理解的单句摘要。 */
  readonly summary: string;
  /** 已脱敏、有序且有界的事实。 */
  readonly facts?: readonly FingerprintDiagnosticFact[];
  /** 省略=不可比较，[]=完成可比较字段相减但无差异，非空=观察到具名差异。 */
  readonly observedDeltas?: readonly FingerprintDelta[];
  /** 现有事实仍不足以证明可携带的限制。 */
  readonly limitations?: readonly string[];
  /** 更底层 owner 产出的递归原因链。 */
  readonly causes?: readonly FingerprintDiagnostic[];
}

export type FingerprintComparison =
  | {
      readonly kind: "match";
    }
  | {
      readonly kind: "changed";
      readonly deltas: readonly [FingerprintDelta, ...FingerprintDelta[]];
    }
  | {
      readonly kind: "unexplained";
      readonly diagnostic: FingerprintDiagnostic;
    };

/** 历史条目缺清单时源码面与数据面的合并差异:算不出就如实算不出,不按「没差异」放过、也不猜。 */
export const OPAQUE_SELECTOR = "opaque:no-manifest";

export interface OpaqueManifestDelta {
  readonly _tag: "Unknown";
  readonly selector: typeof OPAQUE_SELECTOR;
  readonly from?: never;
  readonly to?: never;
}

export type FingerprintDelta = ConfigFieldDelta | OpaqueManifestDelta;

function opaqueManifestDelta(): OpaqueManifestDelta {
  return Object.freeze({ _tag: "Unknown", selector: OPAQUE_SELECTOR });
}

/** 内容哈希的有界摘要:差异明细里印的是「变没变」,64 位十六进制铺满一行没有额外信息量。 */
export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}

/** 值的字符串投影:与 `config-identity.ts` 的同名口径一致,完整值——有界呈现是人读 renderer 的职责。 */
function serializeValue(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function planDelta(historical: EvalManifest, current: EvalManifest): ConfigFieldDelta[] {
  if (JSON.stringify(historical.plan) === JSON.stringify(current.plan)) return [];
  if (historical.plan === undefined) return [addedConfigField("plan:physical", serializeValue(current.plan!))];
  if (current.plan === undefined) return [removedConfigField("plan:physical", serializeValue(historical.plan))];
  return [changedConfigField("plan:physical", serializeValue(historical.plan), serializeValue(current.plan))];
}

/**
 * 两份清单相减,得到带名字的精确差异(selector 原样可复制进 `--accept`)。
 *
 * `historical` 缺席(那一轮早于清单落盘,或第三方 harness 写的结果)时只有源码面与数据面算不
 * 出,合并成一条 `opaque:no-manifest`——明知旧结果仍然成立的人可以显式采信它,框架自己不猜。
 * 配置面另有出处:它落盘在 `run.json`,由调用方用 `historicalConfig` 传进来(重建口径见
 * `config-identity.ts` 的 `configIdentityFromResult`),照常给具名差异。
 */
export function manifestDeltas(
  historical: EvalManifest | undefined,
  current: EvalManifest,
  historicalConfig?: globalThis.Record<string, JsonValue>,
): FingerprintDelta[] {
  if (historical === undefined) {
    return [
      ...(historicalConfig === undefined ? [] : faceDeltas("config", historicalConfig, current.config ?? {}, serializeValue)),
      opaqueManifestDelta(),
    ];
  }
  return [
    ...faceDeltas("config", historical.config ?? {}, current.config ?? {}, serializeValue),
    ...planDelta(historical, current),
    ...faceDeltas("plugins", historical.plugins ?? {}, current.plugins ?? {}, serializeValue),
    ...faceDeltas("resources", historical.resources ?? {}, current.resources ?? {}, serializeValue),
    ...faceDeltas("source", historical.source ?? {}, current.source ?? {}, shortHash),
    ...faceDeltas("data", historical.data ?? {}, current.data ?? {}, shortHash),
  ];
}

/**
 * 指纹比较与诊断的唯一 owner：相等显式返回 `match`；不等时只能是带非空差异的
 * `changed`，或携带开放诊断的 `unexplained`。人读、JSON、carry 与 accept 都消费这个
 * 结果，不能再各自相减或把空差异降成没有语义的 fallback 文案。
 */
export function compareFingerprints(
  historicalFingerprint: string | undefined,
  currentFingerprint: string,
  historical: EvalManifest | undefined,
  current: EvalManifest,
  historicalConfig?: globalThis.Record<string, JsonValue>,
): FingerprintComparison {
  if (historicalFingerprint === currentFingerprint) return Object.freeze({ kind: "match" as const });
  if (historical === undefined) {
    return unexplainedDiagnostic(
      "manifest-missing",
      "The prior result has no manifest, so fingerprint equivalence cannot be proven.",
      manifestDeltas(historical, current, historicalConfig),
      ["The prior source and data inputs cannot be compared without its manifest."],
    );
  }

  if (historical.algorithmVersion !== current.algorithmVersion || historical.coverageVersion !== current.coverageVersion) {
    const algorithmChanged = historical.algorithmVersion !== current.algorithmVersion;
    const legacyCoverage = historical.coverageVersion === 0 && current.coverageVersion > 0;
    const facts: FingerprintDiagnosticFact[] = [];
    const limitations: string[] = [];
    if (algorithmChanged) {
      facts.push({
        label: "algorithm",
        from: historical.algorithmVersion,
        to: current.algorithmVersion,
      });
      limitations.push("Fingerprints produced by different algorithms are not directly comparable.");
    }
    if (historical.coverageVersion !== current.coverageVersion) {
      facts.push({
        label: "coverage",
        from: historical.coverageVersion,
        to: current.coverageVersion,
      });
      limitations.push("The manifest coverage changed, so equivalence is not proven.");
    }
    return unexplainedDiagnostic(
      legacyCoverage && !algorithmChanged ? "legacy-untracked-input" : "fingerprint-version-changed",
      "The current fingerprint cannot be proven equivalent to the prior result.",
      manifestDeltas(historical, current, historicalConfig),
      limitations,
      facts,
    );
  }

  const deltas = manifestDeltas(historical, current, historicalConfig);
  if (deltas.length > 0) {
    const first = deltas[0];
    if (first === undefined) throw new Error("A changed fingerprint comparison requires at least one delta.");
    const changedDeltas: [FingerprintDelta, ...FingerprintDelta[]] = [first, ...deltas.slice(1)];
    return Object.freeze({
      kind: "changed" as const,
      deltas: Object.freeze(changedDeltas),
    });
  }
  return unexplainedDiagnostic(
    "fingerprint-invariant-violation",
    "The fingerprints differ even though comparable manifest fields show no differences.",
    [],
    ["The fingerprint changed without a corresponding comparable manifest delta."],
  );
}

function unexplainedDiagnostic(
  code: string,
  summary: string,
  observedDeltas: readonly FingerprintDelta[] | undefined,
  limitations: readonly string[] | undefined,
  facts: readonly FingerprintDiagnosticFact[] = [],
  causes: readonly FingerprintDiagnostic[] = [],
): FingerprintComparison {
  const diagnostic: FingerprintDiagnostic = {
    code,
    summary,
    ...(facts.length === 0 ? {} : { facts: Object.freeze(facts.map(freezeDiagnosticFact)) }),
    ...(observedDeltas === undefined
      ? {}
      : { observedDeltas: Object.freeze(observedDeltas.map(freezeFingerprintDelta)) }),
    ...(limitations === undefined || limitations.length === 0
      ? {}
      : { limitations: Object.freeze([...limitations]) }),
    ...(causes.length === 0 ? {} : { causes: Object.freeze(causes.map(freezeDiagnostic)) }),
  };
  return Object.freeze({ kind: "unexplained" as const, diagnostic: Object.freeze(diagnostic) });
}

function freezeDiagnosticFact(fact: FingerprintDiagnosticFact): FingerprintDiagnosticFact {
  return "value" in fact
    ? Object.freeze({ label: fact.label, value: freezeJsonValue(fact.value) })
    : Object.freeze({
        label: fact.label,
        from: freezeJsonValue(fact.from),
        to: freezeJsonValue(fact.to),
      });
}

function freezeFingerprintDelta(delta: FingerprintDelta): FingerprintDelta {
  return Object.freeze({ ...delta });
}

function freezeDiagnostic(diagnostic: FingerprintDiagnostic): FingerprintDiagnostic {
  return Object.freeze({
    ...diagnostic,
    ...(diagnostic.facts === undefined
      ? {}
      : { facts: Object.freeze(diagnostic.facts.map(freezeDiagnosticFact)) }),
    ...(diagnostic.observedDeltas === undefined
      ? {}
      : { observedDeltas: Object.freeze(diagnostic.observedDeltas.map(freezeFingerprintDelta)) }),
    ...(diagnostic.limitations === undefined
      ? {}
      : { limitations: Object.freeze([...diagnostic.limitations]) }),
    ...(diagnostic.causes === undefined
      ? {}
      : { causes: Object.freeze(diagnostic.causes.map(freezeDiagnostic)) }),
  });
}

function freezeJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freezeJsonValue)) as JsonValue;
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, freezeJsonValue(child)]),
  )) as JsonValue;
}

/**
 * 一面的逐键相减,按键字典序。**键的增删同样是一条差异**——一侧没有这个键与「有这个键、值是
 * 别的」是两回事,`flags` 增删键、闭包里加删一个文件正是靠这条各自成为一条差异。
 */
function faceDeltas<T extends JsonValue>(
  prefix: string,
  from: globalThis.Record<string, T>,
  to: globalThis.Record<string, T>,
  render: (value: T) => string,
): ConfigFieldDelta[] {
  const keys = [...new Set([...Object.keys(from), ...Object.keys(to)])].sort();
  const out: ConfigFieldDelta[] = [];
  for (const key of keys) {
    const hasFrom = Object.hasOwn(from, key);
    const hasTo = Object.hasOwn(to, key);
    if (hasFrom && hasTo && JSON.stringify(from[key]) === JSON.stringify(to[key])) continue;
    const selector = `${prefix}:${key}`;
    if (!hasFrom) out.push(addedConfigField(selector, render(to[key]!)));
    else if (!hasTo) out.push(removedConfigField(selector, render(from[key]!)));
    else out.push(changedConfigField(selector, render(from[key]!), render(to[key]!)));
  }
  return out;
}
