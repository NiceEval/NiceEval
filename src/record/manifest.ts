// `manifests.json` —— 指纹输入的可读清单,与 `run.json` 同层、逐 eval 一份。
//
// 这里只有**落盘形状与读回**;清单怎么算出(与指纹同一份输入)在 `runner/fingerprint.ts`,
// 新旧相减出具名差异在 `runner/manifest.ts`。
// 契约单源:docs/feature/record/architecture.md 与
// docs/feature/experiments/cache.md「manifest:哈希做索引,清单做解释」。

import type { JsonValue } from "../types.ts";

/** Run 记录根下清单文件的文件名。 */
export const MANIFESTS_FILE = "manifests.json";

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
  config: globalThis.Record<string, JsonValue>;
  source: globalThis.Record<string, string>;
  data: globalThis.Record<string, string>;
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
      config: entry.config as globalThis.Record<string, JsonValue>,
      source: (typeof entry.source === "object" && entry.source !== null ? entry.source : {}) as globalThis.Record<string, string>,
      data: (typeof entry.data === "object" && entry.data !== null ? entry.data : {}) as globalThis.Record<string, string>,
    };
  }
  return out;
}
