// Results Format 的布局与版本知识,规则见 docs/feature/results/architecture.md。
//
// 按 docs/feature/results/library.md,这份知识只住在本库:写入面(writer.ts / copy.ts)与
// 读取面(open.ts)共用这里的目录规则与版本判定;src/runner/reporters/artifacts.ts
// 是 writer 的薄壳,view(src/view/data.ts)经 openResults 消费,不自带布局知识。

import type { EvalResult } from "../types.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../types.ts";
import type { ArtifactKind, SnapshotMeta } from "./types.ts";

/** attempt 目录名:结果记录文件恒为 result.json,attempt 级判决权威落点。 */
export const RESULT_FILE = "result.json";
/** 快照元数据文件名。 */
export const SNAPSHOT_FILE = "snapshot.json";

/** attempt 目录(相对快照根):`<evalId>/a<attempt>`;evalId 里的 / 保留作目录层级,其余危险字符替换。 */
export function attemptDirOf(r: Pick<EvalResult, "id" | "attempt">): string {
  const id = r.id.replace(/[^\w./@-]/g, "_");
  return `${id}/a${r.attempt}`;
}

/** 实验目录名:experimentId 里的 / 与其它非 [\w.@-] 字符替换成 _。 */
export function experimentDirOf(experimentId: string): string {
  return experimentId.replace(/[^\w.@-]/g, "_");
}

/**
 * artifact 文件名。种类名是 TS 侧的驼峰(`agentSetup`),文件名是磁盘侧的 kebab
 * (`agent-setup.json`)——两边各自守自己的惯例,映射表是唯一的翻译点。
 */
const ARTIFACT_FILES: Record<ArtifactKind, string> = {
  events: "events.json",
  trace: "trace.json",
  o11y: "o11y.json",
  agentSetup: "agent-setup.json",
  diff: "diff.json",
  sources: "sources.json",
};

export function artifactFileOf(kind: ArtifactKind): string {
  return ARTIFACT_FILES[kind];
}

/** snapshot.json 的版本判定结果;openResults 按它分流 ok / skipped / 静默忽略。 */
export type SnapshotClassification =
  | { kind: "ok"; meta: SnapshotMeta }
  | { kind: "incompatible"; schemaVersion: number; producer?: SnapshotMeta["producer"] }
  | { kind: "malformed"; detail: string }
  | { kind: "not-a-report" };

/**
 * 版本判定与最小形状校验(docs/feature/results/architecture.md「版本不匹配时的读取行为」):
 * - 带 format 信封:format 不是 niceeval.results → 无关 JSON;schemaVersion 非数字 → malformed;
 *   schemaVersion 与当前不同 → 不兼容(不解析、不迁移、不降级),带 schemaVersion 与完整 producer;
 *   schemaVersion 相同时校验 experimentId / agent / startedAt 均为 string,不满足 → malformed。
 * - 无信封:v1 的 run 级 summary.json(results[] 是数组且 startedAt 是 string)按 incompatible
 *   (schemaVersion 1)处理 —— 这是版本识别,不是迁移;不满足启发式的当无关 JSON 忽略。
 * - v2/v3 的 summary.json 带 format + schemaVersion(≠ 4),自然落进 incompatible 档。
 */
export function classifySnapshot(raw: unknown): SnapshotClassification {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { kind: "malformed", detail: "not a JSON object" };
  }
  const data = raw as Partial<SnapshotMeta> & { results?: unknown };
  if (data.format !== undefined && data.format !== RESULTS_FORMAT) return { kind: "not-a-report" };
  if (data.format === RESULTS_FORMAT) {
    if (typeof data.schemaVersion !== "number") return { kind: "malformed", detail: "schemaVersion is not a number" };
    if (data.schemaVersion !== RESULTS_SCHEMA_VERSION) {
      // skipped 必须带完整 producer(name + version):npx 提示只对 name === "niceeval" 成立,
      // 第三方 harness 的落盘只给裸版本号的话,消费方连做对这个分支的信息都没有。
      return { kind: "incompatible", schemaVersion: data.schemaVersion, producer: data.producer };
    }
    if (typeof data.experimentId !== "string" || typeof data.agent !== "string" || typeof data.startedAt !== "string") {
      return { kind: "malformed", detail: "missing experimentId, agent or startedAt" };
    }
    return { kind: "ok", meta: data as SnapshotMeta };
  }
  // 无信封:引入版本信封之前的存量报告(v1 run 级 summary.json)。
  if (Array.isArray(data.results) && typeof (data as { startedAt?: unknown }).startedAt === "string") {
    return { kind: "incompatible", schemaVersion: 1 };
  }
  return { kind: "not-a-report" };
}
