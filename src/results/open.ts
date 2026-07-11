// openResults:扫描结果目录,返回「实验 → 快照 → eval → attempt」的类型化层次
// (定稿见 docs/results-lib.md「读:openResults」)。
//
// 三条铁律:
// - 忠实磁盘:快照与实验归组只切片,不合并、不聚合、不去重;合并/聚合永远发生在消费方。
// - 读不了的落盘进 skipped(三种原因),不静默丢,也不抛错(单个坏 run 不拖垮整次扫描)。
// - 重工件全部懒加载:缺失返回 null(存在性判断被方法语义吸收),同一 handle 内记忆化。

import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import type { EvalResult, RunSummary } from "../types.ts";
import type { O11ySummary, StreamEvent, TraceSpan } from "../types.ts";
import type { DiffData, SourceArtifact } from "../types.ts";
import { artifactFileOf, classifySummary, experimentKeyOf } from "./format.ts";
import { isNewerRunDir, selectLatest } from "./select.ts";
import type {
  ArtifactKind,
  AttemptHandle,
  Eval,
  Experiment,
  Results,
  RunDir,
  Selection,
  SkippedRun,
  Snapshot,
} from "./types.ts";
import { ARTIFACT_KINDS } from "./types.ts";

// copySnapshots 补记 knownEvalIds 需要「复制时刻该实验的 evalIds」,而 Snapshot 上按定稿
// 不挂 Experiment 反向指针 —— 用模块级 WeakMap 记归属,只供库内部(copy.ts)取用。
const experimentBySnapshot = new WeakMap<Snapshot, Experiment>();

/** 库内部:快照所属的 Experiment(仅对 openResults 产出的快照存在)。 */
export function experimentOfSnapshot(snapshot: Snapshot): Experiment | undefined {
  return experimentBySnapshot.get(snapshot);
}

/**
 * 打开 `.niceeval/` 根目录、单个 run 目录,或直接指向某个 summary.json 的路径。
 * 目录不存在返回空集合(还没跑过 eval 不是错误);任何读不了的落盘进 skipped,不抛错。
 */
export async function openResults(dir: string): Promise<Results> {
  const target = resolve(dir);
  const runDirs: RunDir[] = [];
  const skipped: SkippedRun[] = [];

  let targetStat;
  try {
    targetStat = await stat(target);
  } catch {
    return makeResults([], skipped, runDirs);
  }

  const summaryPaths: string[] = [];
  if (targetStat.isFile()) {
    summaryPaths.push(target);
  } else {
    const direct = join(target, "summary.json");
    if (await fileExists(direct)) {
      // target 本身是 run 目录:它的子目录是 attempt 工件目录,不做 incomplete 探测。
      summaryPaths.push(direct, ...(await findSummaryFiles(target, direct)));
    } else {
      // target 是结果根:逐个 immediate child 判定 —— 有 summary 的收 run;
      // 没有 summary 但有 attempt 工件的 = crash 没收尾,进 skipped("incomplete")。
      const entries = await readdir(target, { withFileTypes: true });
      for (const entry of entries.filter((e) => e.isDirectory())) {
        const childDir = join(target, entry.name);
        const found = await findSummaryFiles(childDir);
        if (found.length > 0) {
          summaryPaths.push(...found);
        } else if (await hasArtifactFiles(childDir)) {
          skipped.push({ dir: childDir, reason: "incomplete" });
        }
      }
    }
  }

  for (const path of summaryPaths) {
    const verdict = await readRun(path);
    if (verdict.kind === "run") runDirs.push(verdict.run);
    else if (verdict.kind === "skipped") skipped.push(verdict.entry);
    // not-a-report:无关 JSON,静默忽略。
  }

  // 最新在前;run 目录名是时间戳,startedAt 同刻时按目录名降序兜底。
  runDirs.sort((a, b) => (isNewerRunDir(a, b) ? -1 : 1));
  skipped.sort((a, b) => b.dir.localeCompare(a.dir));

  const snapshots: Snapshot[] = [];
  for (const run of runDirs) snapshots.push(...sliceSnapshots(run));
  return makeResults(buildExperiments(snapshots), skipped, runDirs);
}

function makeResults(experiments: Experiment[], skipped: SkippedRun[], runDirs: RunDir[]): Results {
  return {
    experiments,
    skipped,
    runDirs,
    latest(opts?: { experiments?: string | string[] }): Selection {
      return selectLatest(experiments, opts);
    },
  };
}

// ───────────────────────── 单个 run 的读取 ─────────────────────────

type ReadRunVerdict =
  | { kind: "run"; run: RunDir }
  | { kind: "skipped"; entry: SkippedRun }
  | { kind: "not-a-report" };

async function readRun(path: string): Promise<ReadRunVerdict> {
  const runDir = dirname(path);
  const skippedEntry = (entry: Omit<SkippedRun, "dir">): ReadRunVerdict => ({
    kind: "skipped",
    entry: { dir: runDir, ...entry },
  });

  let text: string;
  try {
    text = await readFile(path, "utf-8");
  } catch (e) {
    return skippedEntry({ reason: "malformed", detail: `cannot read file (${e instanceof Error ? e.message : String(e)})` });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return skippedEntry({ reason: "malformed", detail: "invalid JSON" });
  }

  const classified = classifySummary(raw);
  switch (classified.kind) {
    case "not-a-report":
      return { kind: "not-a-report" };
    case "malformed":
      return skippedEntry({ reason: "malformed", detail: classified.detail });
    case "incompatible":
      return skippedEntry({
        reason: "incompatible-version",
        schemaVersion: classified.schemaVersion,
        ...(classified.producer ? { producer: classified.producer } : {}),
      });
    case "ok": {
      const run: RunDir = { dir: runDir, summary: classified.summary, attempts: [] };
      return { kind: "run", run };
    }
  }
}

// ───────────────────────── 快照切片与实验归组 ─────────────────────────

/**
 * 把一个 run 按 experiment 身份切成快照,同时填充 run.attempts(按 results[] 下标顺序)。
 * 只切片、不合并、不去重;experimentId 缺失时以 "<agent>/<model>" 合成键,synthetic: true
 * (对应警告由 latest() 生成,归属 Selection)。
 */
function sliceSnapshots(run: RunDir): Snapshot[] {
  const summary = run.summary;
  const byExperiment = new Map<string, Snapshot>();
  const evalsByExperiment = new Map<string, Map<string, Eval>>();

  summary.results.forEach((result, index) => {
    const key = experimentKeyOf(result);
    let snapshot = byExperiment.get(key.id);
    if (!snapshot) {
      const meta = summary.snapshots?.[key.id];
      snapshot = {
        experimentId: key.id,
        startedAt: meta?.startedAt ?? summary.startedAt,
        agent: result.agent,
        ...(result.model !== undefined ? { model: result.model } : {}),
        ...(summary.producer ? { producer: summary.producer } : {}),
        schemaVersion: summary.schemaVersion ?? 1,
        evals: [],
        attempts: [],
        runDir: run,
        ...(key.synthesized ? { synthetic: true } : {}),
        ...(meta?.knownEvalIds ? { knownEvalIds: [...meta.knownEvalIds] } : {}),
      };
      byExperiment.set(key.id, snapshot);
      evalsByExperiment.set(key.id, new Map());
    }
    const attempt = makeAttempt(run, key.id, result, index);
    run.attempts.push(attempt);
    const evals = evalsByExperiment.get(key.id)!;
    let ev = evals.get(result.id);
    if (!ev) {
      ev = { id: result.id, attempts: [] };
      evals.set(result.id, ev);
      snapshot.evals.push(ev);
    }
    ev.attempts.push(attempt);
  });

  for (const snapshot of byExperiment.values()) {
    // attempts 平铺 = evals 逐题展开(同题的重试相邻)。
    snapshot.attempts = snapshot.evals.flatMap((ev) => ev.attempts);
  }
  return [...byExperiment.values()];
}

/** 同一 experiment id 的历次快照归在一起;实验按 id 字典序,快照最新在前。 */
function buildExperiments(snapshots: Snapshot[]): Experiment[] {
  const byId = new Map<string, Snapshot[]>();
  for (const snapshot of snapshots) {
    const group = byId.get(snapshot.experimentId);
    if (group) group.push(snapshot);
    else byId.set(snapshot.experimentId, [snapshot]);
  }

  const experiments: Experiment[] = [];
  for (const [id, group] of byId) {
    group.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.runDir.dir.localeCompare(a.runDir.dir));
    // 已知并集 = 本地历史(各快照覆盖的题)∪ 各快照携带的 knownEvalIds ——
    // 不是「优先字段」:把快照复制进已有历史的目录时,本地并集可能更大,优先字段会让分母缩水。
    const ids = new Set<string>();
    for (const snapshot of group) {
      for (const ev of snapshot.evals) ids.add(ev.id);
      for (const known of snapshot.knownEvalIds ?? []) ids.add(known);
    }
    const experiment: Experiment = { id, snapshots: group, latest: group[0], evalIds: [...ids].sort() };
    for (const snapshot of group) experimentBySnapshot.set(snapshot, experiment);
    experiments.push(experiment);
  }
  experiments.sort((a, b) => a.id.localeCompare(b.id));
  return experiments;
}

// ───────────────────────── attempt 懒加载 ─────────────────────────

function makeAttempt(run: RunDir, experimentId: string, result: EvalResult, index: number): AttemptHandle {
  // 候选工件目录:本 run 下的 artifactsDir 为主;--resume / 跨实验携带合入的条目,其工件
  // 留在原 run 目录里,summary 里的 artifactBase(相对结果根目录)指向那里,作为回退。
  const candidates: string[] = [];
  if (result.artifactsDir) candidates.push(join(run.dir, result.artifactsDir));
  if (result.artifactBase) candidates.push(join(dirname(run.dir), result.artifactBase));

  return {
    evalId: result.id,
    experimentId,
    result,
    ref: { run: basename(run.dir), result: index },
    runDir: run,
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

// ───────────────────────── 目录扫描 ─────────────────────────

/** 递归找出全部 summary.json(run 目录嵌套深度不做假设);skip 用于排除已收录的直达文件。 */
async function findSummaryFiles(dir: string, skip?: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const direct = entries
    .filter((e) => e.isFile() && e.name === "summary.json")
    .map((e) => join(dir, e.name))
    .filter((p) => p !== skip);
  const nested = await Promise.all(
    entries.filter((e) => e.isDirectory()).map((e) => findSummaryFiles(join(dir, e.name), skip)),
  );
  return [...direct, ...nested.flat()];
}

/** 目录下(递归)是否存在任何 attempt 工件文件 —— incomplete 判定的依据。 */
async function hasArtifactFiles(dir: string): Promise<boolean> {
  const artifactNames = new Set<string>(ARTIFACT_KINDS.map((kind) => artifactFileOf(kind)));
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && artifactNames.has(entry.name)) return true;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && (await hasArtifactFiles(join(dir, entry.name)))) return true;
  }
  return false;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}
