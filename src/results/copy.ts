// copyRun:把选中快照按格式感知地复制到另一个目录(设计见 docs/results-lib.md「复制与瘦身」)。
//
// 发布场景的原语:只带指定工件、只带选中的 attempt,布局知识不外泄。
// 工件复制忠实于源(copyFile 原字节,不重新序列化、不消毒);summary.json 按选中条目重建,
// 版本元数据保留,榜单计数按选中条目重算 —— 产物是一个 openResults / `niceeval view`
// 都能直接读的合法 run 目录。

import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { EvalResult, RunSummary } from "../runner/types.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../runner/types.ts";
import type { Usage } from "../o11y/types.ts";
import { artifactFileOf, attemptDirOf } from "./format.ts";
import { isNewerRun } from "./select.ts";
import type { ArtifactKind, AttemptHandle, RunHandle, SnapshotHandle } from "./types.ts";
import { ARTIFACT_KINDS } from "./types.ts";

export interface CopyRunOptions {
  /** 要带上的工件种类;省略 = 全部五类。diff 可达百 MB、o11y 查看器不读,发布时常见地不带。 */
  artifacts?: ArtifactKind[];
}

export interface CopiedRun {
  /** 目标 run 目录的绝对路径(summary.json 所在目录)。 */
  dir: string;
  /** 重建后的 summary(与写入磁盘的一致)。 */
  summary: RunSummary;
  /** 复制过程中的警告(如多个 attempt 落到同一目录);不静默。 */
  warnings: string[];
}

/**
 * 把 `snapshots` 里的全部 attempt 复制成 `destDir` 下的一个 run 目录。
 * 快照可以来自不同物理 run(latestPerExperiment 的典型输出);两个 attempt 落到同一
 * 工件目录时保留最新 run 的那份并出 warning —— 复制前先 dedupeAttempts 可避免。
 */
export async function copyRun(
  snapshots: SnapshotHandle | SnapshotHandle[],
  destDir: string,
  opts?: CopyRunOptions,
): Promise<CopiedRun> {
  const selected = Array.isArray(snapshots) ? snapshots : [snapshots];
  if (selected.length === 0) {
    throw new Error(
      "copyRun got no snapshots to copy. Check the experiments filter, or pass snapshots from openResults()/latestPerExperiment().",
    );
  }
  const kinds = opts?.artifacts ?? [...ARTIFACT_KINDS];
  const dest = resolve(destDir);

  const sourceRuns = uniqueRuns(selected);
  for (const run of sourceRuns) {
    if (resolve(run.dir) === dest) {
      throw new Error(`copyRun destination ${dest} is a source run directory. Pick a different destination.`);
    }
  }

  // 第一趟:按目标工件目录选出胜者(最新 run 的那份),顺序取首次出现处 —— 两趟避免
  // 「旧的先落盘、新的再去清理覆盖」的中间态。
  const winners = new Map<string, AttemptHandle>();
  const order: string[] = [];
  const warnings: string[] = [];
  for (const snapshot of selected) {
    for (const attempt of snapshot.attempts) {
      const relDir = attemptDirOf(attempt.result);
      const existing = winners.get(relDir);
      if (!existing) {
        winners.set(relDir, attempt);
        order.push(relDir);
        continue;
      }
      warnings.push(
        `warning: multiple attempts map to "${relDir}" in the copied run; kept the one from the newest run. Dedupe attempts or re-select snapshots before copyRun to avoid this.`,
      );
      if (isNewerRun(attempt.run, existing.run)) winners.set(relDir, attempt);
    }
  }

  // 第二趟:复制工件 + 生成瘦身条目(has* 按目标目录里真的有什么重算)。
  await mkdir(dest, { recursive: true });
  const results: EvalResult[] = [];
  for (const relDir of order) {
    const attempt = winners.get(relDir)!;
    const files = await findArtifactFiles(attempt, kinds);
    if (files.length > 0) {
      const attemptDest = join(dest, relDir);
      await mkdir(attemptDest, { recursive: true });
      await Promise.all(files.map(({ kind, source }) => copyFile(source, join(attemptDest, artifactFileOf(kind)))));
    }
    const copied = new Set(files.map((f) => f.kind));
    results.push(slimForCopy(attempt.result, relDir, copied));
  }

  const summary = rebuildSummary(selected, sourceRuns, results, dest);
  await writeFile(join(dest, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  return { dir: dest, summary, warnings };
}

/** 源工件定位:与读取面同一候选顺序(本 run 的 artifactsDir 优先,artifactBase 回退)。 */
async function findArtifactFiles(
  attempt: AttemptHandle,
  kinds: ArtifactKind[],
): Promise<{ kind: ArtifactKind; source: string }[]> {
  const candidates: string[] = [];
  if (attempt.result.artifactsDir) candidates.push(join(attempt.run.dir, attempt.result.artifactsDir));
  if (attempt.result.artifactBase) candidates.push(join(dirname(attempt.run.dir), attempt.result.artifactBase));

  const found: { kind: ArtifactKind; source: string }[] = [];
  for (const kind of kinds) {
    for (const dir of candidates) {
      const source = join(dir, artifactFileOf(kind));
      try {
        if ((await stat(source)).isFile()) {
          found.push({ kind, source });
          break;
        }
      } catch {
        // 缺文件跳过:某类数据为空本来就不生成对应 JSON(docs/results-format.md)。
      }
    }
  }
  return found;
}

/** 瘦身条目:去掉内联大字段与 view 注入的路径字段,artifactsDir / has* 按目标目录重算。 */
function slimForCopy(r: EvalResult, relDir: string, copied: Set<ArtifactKind>): EvalResult {
  const { events, sources, o11y, trace, diff, rawTranscript, artifactBase, artifactAbsBase, ...rest } = r;
  void events;
  void sources;
  void o11y;
  void trace;
  void diff;
  void rawTranscript;
  void artifactBase;
  void artifactAbsBase;
  return {
    ...rest,
    artifactsDir: relDir,
    hasEvents: copied.has("events"),
    hasTrace: copied.has("trace"),
    hasSources: copied.has("sources"),
  };
}

function rebuildSummary(
  selected: SnapshotHandle[],
  sourceRuns: RunHandle[],
  results: EvalResult[],
  dest: string,
): RunSummary {
  // 版本元数据与 run 级元数据取最新源 run 的(producer 缺失的 legacy 源保持缺失,不冒充)。
  let newest = sourceRuns[0];
  for (const run of sourceRuns) if (isNewerRun(run, newest)) newest = run;

  const counts = { passed: 0, failed: 0, skipped: 0, errored: 0 };
  for (const r of results) counts[r.outcome] += 1;

  return {
    format: RESULTS_FORMAT,
    schemaVersion: RESULTS_SCHEMA_VERSION,
    ...(newest.summary.producer ? { producer: newest.summary.producer } : {}),
    ...(newest.summary.name !== undefined ? { name: newest.summary.name } : {}),
    // 顶层 agent/model 沿用 runner 的「第一个配置」姿势;快照各自的 agent 在条目里。
    agent: selected[0].agent,
    ...(selected[0].model !== undefined ? { model: selected[0].model } : {}),
    startedAt: newest.summary.startedAt,
    completedAt: newest.summary.completedAt,
    ...counts,
    // 跨 run 拼装无法还原墙钟时长,这里是选中 attempt 的耗时合计。
    durationMs: results.reduce((total, r) => total + (r.durationMs ?? 0), 0),
    ...usageAndCost(results),
    results,
    outputDir: dest,
  };
}

/** usage / 成本按选中条目重算;口径同 runner 的 summarize(没有任何 usage 就不写)。 */
function usageAndCost(results: EvalResult[]): Pick<RunSummary, "usage" | "estimatedCostUSD"> {
  const usages = results.map((r) => r.usage).filter((u): u is Usage => u !== undefined);
  const cost = results.reduce((total, r) => total + (r.estimatedCostUSD ?? 0), 0);
  if (usages.length === 0) return { estimatedCostUSD: cost || undefined };
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  for (const u of usages) {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    for (const key of ["cacheReadTokens", "cacheWriteTokens", "requests", "costUSD"] as const) {
      const value = u[key];
      if (value !== undefined) usage[key] = (usage[key] ?? 0) + value;
    }
  }
  return { usage, estimatedCostUSD: cost || undefined };
}

function uniqueRuns(snapshots: SnapshotHandle[]): RunHandle[] {
  const runs: RunHandle[] = [];
  for (const snapshot of snapshots) {
    if (!runs.includes(snapshot.run)) runs.push(snapshot.run);
  }
  return runs;
}
