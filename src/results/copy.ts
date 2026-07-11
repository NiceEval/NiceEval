// copySnapshots:把选中快照按格式感知地复制到另一个目录(定稿见 docs/results-lib.md「复制与瘦身」)。
//
// 发布场景的原语:只带指定 artifact、只带选中的 attempt,布局知识不外泄。
// artifact 复制忠实于源(copyFile 原字节,不重新序列化、不消毒);summary.json 按选中条目重建,
// 版本元数据保留,榜单计数按选中条目重算 —— 产物是一个标准 run 目录,openResults /
// `niceeval view` 直接能读。唯一随行补记的是挑选时的覆盖事实:每个复制出的快照带上
// knownEvalIds(复制时刻该实验已知的 eval 并集),发布目录上重新 openResults().latest(),
// 残缺警告被同一套机制重新算出来,不靠发布者转述。

import { copyFile, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { EvalResult, RunSummary, Usage } from "../types.ts";
import { RESULTS_FORMAT, RESULTS_SCHEMA_VERSION } from "../types.ts";
import { artifactFileOf, attemptDirOf } from "./format.ts";
import { experimentOfSnapshot } from "./open.ts";
import { isNewerRunDir } from "./select.ts";
import type { ArtifactKind, AttemptHandle, RunDir, Selection, Snapshot } from "./types.ts";
import { ARTIFACT_KINDS } from "./types.ts";

export interface CopySnapshotsOptions {
  /** 要带上的 artifact 种类;省略 = 全部五类。diff 可达百 MB,发布时常见地不带;o11y 只有几 KB,报告用 turns 这类 artifact 档指标(见 docs/reports.md「两档内置指标」)时记得带上。 */
  artifacts?: ArtifactKind[];
}

export interface CopySnapshotsResult {
  /** 目标 run 目录的绝对路径(summary.json 所在目录)。 */
  dir: string;
  /** 重建后的 summary(与写入磁盘的一致)。 */
  summary: RunSummary;
  /** 复制过程中的警告(如多个 attempt 落到同一目录);不静默。 */
  warnings: string[];
}

/**
 * 把选中快照的全部 attempt 复制成 `destDir` 下的一个标准 run 目录。
 * 输入收 Selection 或手工挑的 Snapshot[](与 Reports 计算函数同一输入约定);
 * 快照可以来自不同物理 run(latest() 的典型输出)。目标目录非空即报错,不静默覆盖、不合并。
 */
export async function copySnapshots(
  selection: Selection | Snapshot[],
  destDir: string,
  opts?: CopySnapshotsOptions,
): Promise<CopySnapshotsResult> {
  const selected = Array.isArray(selection) ? selection : selection.snapshots;
  if (selected.length === 0) {
    throw new Error(
      "copySnapshots got no snapshots to copy. Check the experiments filter, or pass snapshots from openResults().latest().",
    );
  }
  const kinds = opts?.artifacts ?? [...ARTIFACT_KINDS];
  for (const kind of kinds) {
    if (!ARTIFACT_KINDS.includes(kind)) {
      throw new Error(
        `Unknown artifact kind "${String(kind)}" in copySnapshots options. Valid kinds: ${ARTIFACT_KINDS.join(", ")}.`,
      );
    }
  }
  const dest = resolve(destDir);
  await assertEmptyDestination(dest);

  // 第一趟:按目标 artifact 目录选出胜者(最新 run 的那份),顺序取首次出现处 —— 两趟避免
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
        `warning: multiple attempts map to "${relDir}" in the copied run; kept the one from the newest run. Dedupe attempts or re-select snapshots before copySnapshots to avoid this.`,
      );
      if (isNewerRunDir(attempt.runDir, existing.runDir)) winners.set(relDir, attempt);
    }
  }

  // 第二趟:复制 artifact + 生成瘦身条目(has* 按目标目录里真的有什么重算)。
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

  const summary = rebuildSummary(selected, results, dest);
  await writeFile(join(dest, "summary.json"), JSON.stringify(summary, null, 2), "utf-8");
  return { dir: dest, summary, warnings };
}

/** 目标目录非空即报错:盘上不该出现「我没写的东西被动过」的惊讶;发布脚本要幂等就自己先清目录。 */
async function assertEmptyDestination(dest: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dest);
  } catch (e) {
    if ((e as NodeJS.ErrnoException | null)?.code === "ENOENT") return;
    throw new Error(
      `Destination "${dest}" is not a usable directory (${e instanceof Error ? e.message : String(e)}). Pass a new or empty directory.`,
    );
  }
  if (entries.length > 0) {
    throw new Error(
      `Destination directory "${dest}" is not empty. copySnapshots never overwrites or merges; delete the directory first if you want to replace it.`,
    );
  }
}

/** 源 artifact 定位:与读取面同一候选顺序(本 run 的 artifactsDir 优先, artifactBase 回退)。 */
async function findArtifactFiles(
  attempt: AttemptHandle,
  kinds: ArtifactKind[],
): Promise<{ kind: ArtifactKind; source: string }[]> {
  const candidates: string[] = [];
  if (attempt.result.artifactsDir) candidates.push(join(attempt.runDir.dir, attempt.result.artifactsDir));
  if (attempt.result.artifactBase) candidates.push(join(dirname(attempt.runDir.dir), attempt.result.artifactBase));

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

/** 瘦身条目:去掉内联大字段与 view 注入的路径字段, artifactsDir / has* 按目标目录重算。 */
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

function rebuildSummary(selected: Snapshot[], results: EvalResult[], dest: string): RunSummary {
  // 版本元数据与 run 级元数据取最新源 run 的(producer 缺失的 legacy 源保持缺失,不冒充)。
  const sourceRuns = uniqueRuns(selected);
  let newest = sourceRuns[0];
  for (const run of sourceRuns) if (isNewerRunDir(run, newest)) newest = run;

  const counts = { passed: 0, failed: 0, skipped: 0, errored: 0 };
  for (const r of results) counts[r.verdict] += 1;

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
    snapshots: snapshotsMeta(selected, newest.summary.startedAt),
  };
}

/**
 * 快照级元数据补记:startedAt 保留各快照自己的时刻(它们可能来自不同源 run),
 * knownEvalIds = 复制时刻该实验已知的 eval 并集(openResults 产出的快照从所属实验取,
 * 手工构造的快照退回「同 id 输入快照的覆盖 ∪ 携带值」)—— 残缺检测的分母随数据走。
 */
function snapshotsMeta(selected: Snapshot[], summaryStartedAt: string): NonNullable<RunSummary["snapshots"]> {
  // 同一 experiment 被选了多个快照(未 dedupe)时取最新的那个,与 artifact 胜者规则一致。
  const bySnapshotId = new Map<string, Snapshot>();
  for (const snapshot of selected) {
    const existing = bySnapshotId.get(snapshot.experimentId);
    if (!existing || isNewerRunDir(snapshot.runDir, existing.runDir)) {
      bySnapshotId.set(snapshot.experimentId, snapshot);
    }
  }

  const meta: NonNullable<RunSummary["snapshots"]> = {};
  for (const [experimentId, snapshot] of bySnapshotId) {
    const union = experimentOfSnapshot(snapshot)?.evalIds ?? fallbackUnion(selected, experimentId);
    meta[experimentId] = {
      ...(snapshot.startedAt !== summaryStartedAt ? { startedAt: snapshot.startedAt } : {}),
      knownEvalIds: union,
    };
  }
  return meta;
}

function fallbackUnion(selected: Snapshot[], experimentId: string): string[] {
  const ids = new Set<string>();
  for (const snapshot of selected) {
    if (snapshot.experimentId !== experimentId) continue;
    for (const ev of snapshot.evals) ids.add(ev.id);
    for (const known of snapshot.knownEvalIds ?? []) ids.add(known);
  }
  return [...ids].sort();
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

function uniqueRuns(snapshots: Snapshot[]): RunDir[] {
  const runs: RunDir[] = [];
  for (const snapshot of snapshots) {
    if (!runs.includes(snapshot.runDir)) runs.push(snapshot.runDir);
  }
  return runs;
}
