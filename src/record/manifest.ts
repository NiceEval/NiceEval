// `manifests.json` —— 指纹输入的可读清单,与 `run.json` 同层、逐 eval 一份。
//
// 这里只有**落盘形状与读回**;清单怎么算出(与指纹同一份输入)在 `runner/fingerprint.ts`,
// 新旧相减出具名差异在 `runner/manifest.ts`。
// 契约单源:docs/feature/record/architecture.md 与
// docs/feature/experiments/cache.md「manifest:哈希做索引,清单做解释」。

import type { JsonValue } from "../types.ts";

/** Run 记录根下清单文件的文件名。 */
export const MANIFESTS_FILE = "manifests.json";

/** 指纹算法与清单覆盖面的持久化版本；旧清单缺字段时按 legacy 0 读取。 */
export const LEGACY_FINGERPRINT_VERSION = 0;
export const FINGERPRINT_ALGORITHM_VERSION = 2;
// v2 adds actual reachable dependency identities, the canonical runtime revision,
// and static transfer evidence.  Schema stays 15: this is an input-coverage gate,
// so old records conservatively fresh-run instead of becoming unreadable.
export const FINGERPRINT_COVERAGE_VERSION = 2;

/**
 * 一条 eval 的指纹输入清单。三块与指纹输入一一对应:
 *
 * - `config` —— configHash 各字段的解析后值,键就是 `--accept config:<字段路径>` 里那个路径。
 *   凭据本来就不进指纹,也不进清单。
 * - `source` —— 源码闭包逐文件的「项目根相对路径 × 内容哈希」。
 * - `data` —— loader 登记文件(`loadYaml` / `loadJson` / `loadText` 读入,`loadCriteria` 登记)
 *   的同口径清单。
 */
export interface EvalManifest {
  /** 哈希 payload 与稳定编码的口径版本。 */
  algorithmVersion: number;
  /** manifest 覆盖的 fingerprint 输入集合版本。 */
  coverageVersion: number;
  config: globalThis.Record<string, JsonValue>;
  /**
   * pair-owned link + provider physical plan 的完整身份；新写入恒存在。
   * 可选只为读取升级前的 manifests.json：缺失必须在比较时保守地产生 plan 差异。
   */
  plan?: JsonValue;
  source: globalThis.Record<string, string>;
  data: globalThis.Record<string, string>;
  /** Actual reachable bare dependency identities, keyed by stable specifier/locator. */
  dependencies: globalThis.Record<string, string>;
  /** Canonical NiceEval runtime-contract revision and hook protocol facts. */
  runtime: globalThis.Record<string, string>;
  /** Static transfer plan facts.  Dynamic transfer intentionally appears as a limitation instead. */
  transfer: globalThis.Record<string, string>;
}

/** `manifests.json` 的落盘形状:evalId → 该 eval 的清单。 */
export type RunManifests = globalThis.Record<string, EvalManifest>;

/**
 * 磁盘上读到的任意 JSON → 清单表。形状对不上的条目按「这条没有清单」处理:半份清单相减出的
 * 差异会指着没变的东西说变了,比「算不出」更坏。
 */
export function parseRunManifests(raw: unknown): RunManifests {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: RunManifests = {};
  for (const [evalId, value] of Object.entries(raw as globalThis.Record<string, unknown>)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const entry = value as Partial<EvalManifest>;
    if (typeof entry.config !== "object" || entry.config === null) continue;
    out[evalId] = {
      algorithmVersion: manifestVersion(entry.algorithmVersion),
      coverageVersion: manifestVersion(entry.coverageVersion),
      config: entry.config as globalThis.Record<string, JsonValue>,
      ...(entry.plan === undefined ? {} : { plan: entry.plan }),
      source: (typeof entry.source === "object" && entry.source !== null ? entry.source : {}) as globalThis.Record<string, string>,
      data: (typeof entry.data === "object" && entry.data !== null ? entry.data : {}) as globalThis.Record<string, string>,
      dependencies: (typeof entry.dependencies === "object" && entry.dependencies !== null
        ? entry.dependencies
        : {}) as globalThis.Record<string, string>,
      runtime: (typeof entry.runtime === "object" && entry.runtime !== null
        ? entry.runtime
        : {}) as globalThis.Record<string, string>,
      transfer: (typeof entry.transfer === "object" && entry.transfer !== null
        ? entry.transfer
        : {}) as globalThis.Record<string, string>,
    };
  }
  return out;
}

function manifestVersion(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : LEGACY_FINGERPRINT_VERSION;
}
