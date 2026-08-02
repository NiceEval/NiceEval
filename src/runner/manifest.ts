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

export { MANIFESTS_FILE, parseRunManifests, type EvalManifest, type RunManifests } from "../record/manifest.ts";

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

/** 值摘要:与 `config-identity.ts` 的同名口径一致,单条不铺满一行终端。 */
function summarize(value: JsonValue): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}

function planDelta(historical: EvalManifest, current: EvalManifest): ConfigFieldDelta[] {
  if (JSON.stringify(historical.plan) === JSON.stringify(current.plan)) return [];
  if (historical.plan === undefined) return [addedConfigField("plan:physical", summarize(current.plan!))];
  if (current.plan === undefined) return [removedConfigField("plan:physical", summarize(historical.plan))];
  return [changedConfigField("plan:physical", summarize(historical.plan), summarize(current.plan))];
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
      ...(historicalConfig === undefined ? [] : faceDeltas("config", historicalConfig, current.config ?? {}, summarize)),
      opaqueManifestDelta(),
    ];
  }
  return [
    ...faceDeltas("config", historical.config ?? {}, current.config ?? {}, summarize),
    ...planDelta(historical, current),
    ...faceDeltas("source", historical.source ?? {}, current.source ?? {}, shortHash),
    ...faceDeltas("data", historical.data ?? {}, current.data ?? {}, shortHash),
  ];
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
