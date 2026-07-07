// openResults:扫描结果目录,返回类型化句柄(设计见 docs/results-lib.md「读:openResults」)。
//
// 三条铁律:
// - runs 忠实磁盘,不合并不去重;合并/聚合永远发生在消费方。
// - 读不了的 run 进 skipped,不静默丢,也不抛错(单个坏 run 不拖垮整次扫描)。
// - 重工件全部懒加载:缺失返回 null(存在性判断被方法语义吸收),同一 handle 内记忆化。

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { EvalResult } from "../runner/types.ts";
import type { O11ySummary, StreamEvent, TraceSpan } from "../o11y/types.ts";
import type { DiffData } from "../scoring/types.ts";
import type { SourceArtifact } from "../shared/types.ts";
import { artifactFileOf, classifySummary, experimentKeyOf } from "./format.ts";
import type { ArtifactKind, AttemptHandle, ResultsCollection, RunHandle, SkippedResultsRun, SnapshotHandle } from "./types.ts";

/**
 * 打开 `.niceeval/` 根目录、单个 run 目录,或直接指向某个 summary.json 的路径。
 * 目录不存在返回空集合(还没跑过 eval 不是错误);任何读不了的 run 进 skipped,不抛错。
 */
export async function openResults(dir: string): Promise<ResultsCollection> {
  const target = resolve(dir);
  const collection: ResultsCollection = { runs: [], snapshots: [], skipped: [], warnings: [] };

  let targetStat;
  try {
    targetStat = await stat(target);
  } catch {
    return collection;
  }
  const summaryPaths = targetStat.isFile() ? [target] : await findSummaryFiles(target);

  for (const path of summaryPaths) {
    const outcome = await readRun(path);
    if (outcome.kind === "run") collection.runs.push(outcome.run);
    else if (outcome.kind === "skipped") collection.skipped.push(outcome.entry);
    // not-a-report:无关 JSON,静默忽略。
  }

  // 最新在前;run 目录名是时间戳,startedAt 同刻时按目录名降序兜底。
  collection.runs.sort((a, b) => b.summary.startedAt.localeCompare(a.summary.startedAt) || b.dir.localeCompare(a.dir));
  collection.skipped.sort((a, b) => b.dir.localeCompare(a.dir));

  for (const run of collection.runs) {
    collection.snapshots.push(...sliceSnapshots(run, collection.warnings));
  }
  return collection;
}

type ReadRunOutcome =
  | { kind: "run"; run: RunHandle }
  | { kind: "skipped"; entry: SkippedResultsRun }
  | { kind: "not-a-report" };

async function readRun(path: string): Promise<ReadRunOutcome> {
  const runDir = dirname(path);
  const skipped = (entry: Omit<SkippedResultsRun, "dir" | "path">): ReadRunOutcome => ({
    kind: "skipped",
    entry: { dir: runDir, path, ...entry },
  });

  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (e) {
    return skipped({ reason: "malformed", detail: `cannot read file (${e instanceof Error ? e.message : String(e)})` });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return skipped({ reason: "malformed", detail: "invalid JSON" });
  }

  const classified = classifySummary(raw);
  switch (classified.kind) {
    case "not-a-report":
      return { kind: "not-a-report" };
    case "malformed":
      return skipped({ reason: "malformed", detail: classified.detail });
    case "incompatible":
      return skipped({
        reason: "incompatible-version",
        schemaVersion: classified.schemaVersion,
        producerVersion: classified.producerVersion,
      });
    case "ok": {
      const run: RunHandle = { dir: runDir, summary: classified.summary, attempts: [] };
      run.attempts = classified.summary.results.map((r, i) => makeAttempt(run, r, i));
      return { kind: "run", run };
    }
  }
}

// ───────────────────────── attempt 懒加载 ─────────────────────────

function makeAttempt(run: RunHandle, result: EvalResult, index: number): AttemptHandle {
  // 候选工件目录:本 run 下的 artifactsDir 为主;--resume / 跨实验携带合入的条目,其工件
  // 留在旧 run 目录里,summary 里的 artifactBase(相对结果根目录)指向那里,作为回退。
  const candidates: string[] = [];
  if (result.artifactsDir) candidates.push(join(run.dir, result.artifactsDir));
  if (result.artifactBase) candidates.push(join(dirname(run.dir), result.artifactBase));

  return {
    run,
    ref: { run: basename(run.dir), result: index },
    result,
    events: lazyArtifact<StreamEvent[]>(candidates, "events", result.events),
    trace: lazyArtifact<TraceSpan[]>(candidates, "trace", result.trace),
    o11y: lazyArtifact<O11ySummary>(candidates, "o11y", result.o11y),
    diff: lazyArtifact<DiffData>(candidates, "diff", result.diff),
    sources: lazyArtifact<SourceArtifact[]>(candidates, "sources", result.sources),
  };
}

/**
 * 单个工件的懒加载器:缺失返回 null(不抛错);同一 handle 内记忆化,diff 这类可达百 MB 的
 * 文件绝不读两遍。summary 里内联了该字段时直接用(Json reporter 全量输出/外部工具转换的场景)。
 * 文件存在但 JSON 损坏是真错误,抛英文错误而不是伪装成缺失;失败不缓存,允许重试。
 */
function lazyArtifact<T>(candidateDirs: string[], kind: ArtifactKind, inline: T | undefined): () => Promise<T | null> {
  let memo: Promise<T | null> | undefined;
  const load = async (): Promise<T | null> => {
    if (inline !== undefined) return inline;
    for (const dir of candidateDirs) {
      const file = join(dir, artifactFileOf(kind));
      let text: string;
      try {
        text = await readFile(file, "utf-8");
      } catch (e) {
        if (isMissingFile(e)) continue;
        throw new Error(`Cannot read artifact ${file} (${e instanceof Error ? e.message : String(e)}).`);
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new Error(`Artifact ${file} is not valid JSON. The file may be corrupted; re-run the eval or delete this attempt directory.`);
      }
    }
    return null;
  };
  return () => {
    memo ??= load().catch((e: unknown) => {
      memo = undefined;
      throw e;
    });
    return memo;
  };
}

function isMissingFile(e: unknown): boolean {
  const code = (e as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

// ───────────────────────── 快照切片 ─────────────────────────

/**
 * 把一个 run 按 experiment 身份切成快照;只切片、不合并、不去重。
 * experimentId 缺失时以 "<agent>/<model>" 合成键,并出集合级 warning(每 run 每键一条)。
 */
function sliceSnapshots(run: RunHandle, warnings: string[]): SnapshotHandle[] {
  const byExperiment = new Map<string, SnapshotHandle>();
  const evalIdSeen = new Map<string, Set<string>>();
  for (const attempt of run.attempts) {
    const key = experimentKeyOf(attempt.result);
    let snapshot = byExperiment.get(key.id);
    if (!snapshot) {
      if (key.synthesized) {
        warnings.push(
          `warning: run "${run.dir}" has results without experimentId; grouped as "${key.id}" for snapshot identity.`,
        );
      }
      snapshot = {
        experimentId: key.id,
        run,
        startedAt: run.summary.startedAt,
        agent: attempt.result.agent,
        model: attempt.result.model,
        attempts: [],
        evalIds: [],
        ...(key.synthesized ? { synthetic: true } : {}),
      };
      byExperiment.set(key.id, snapshot);
      evalIdSeen.set(key.id, new Set());
    }
    snapshot.attempts.push(attempt);
    const seen = evalIdSeen.get(key.id)!;
    if (!seen.has(attempt.result.id)) {
      seen.add(attempt.result.id);
      snapshot.evalIds.push(attempt.result.id);
    }
  }
  return [...byExperiment.values()];
}

// ───────────────────────── 目录扫描 ─────────────────────────

/** 递归找出全部 summary.json(与 view 的扫描同一姿势;run 目录嵌套深度不做假设)。 */
async function findSummaryFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const direct = entries.filter((e) => e.isFile() && e.name === "summary.json").map((e) => join(dir, e.name));
  const nested = await Promise.all(
    entries.filter((e) => e.isDirectory()).map((e) => findSummaryFiles(join(dir, e.name))),
  );
  return [...direct, ...nested.flat()];
}
