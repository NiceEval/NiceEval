// 快照 Selection 与 attempt 去重(定稿见 docs/results-lib.md「选择快照」「身份键与去重」)。
//
// 选择器只有一个(latest),长在集合上;它不是 DSL,只是最常用的那次筛选。
// 选择器必须诚实:残缺、落后、合成键都被算出来,以结构化 warnings 随 Selection 走 ——
// 渲染与否在消费方(message 是渲染好的英文句子),但缺口不静默。

import { experimentKeyOf } from "./format.ts";
import type {
  AttemptHandle,
  DedupeWarning,
  Experiment,
  RunDir,
  Selection,
  SelectionWarning,
  Snapshot,
} from "./types.ts";

/** Results.latest() 的实现:每个实验取最新一次快照(= exp.snapshots[0]),生成挑选警告。 */
export function selectLatest(
  experiments: Experiment[],
  opts?: { experiments?: string | string[] },
): Selection {
  const selected = filterByExperimentPrefix(experiments, opts?.experiments);
  const snapshots = selected.map((exp) => exp.latest);
  const warnings: SelectionWarning[] = [];

  // stale 的基准:Selection 中最新的落盘(无阈值,如实触发;要阈值消费方按字段自比)。
  let latestStartedAt = "";
  for (const snapshot of snapshots) {
    if (snapshot.startedAt > latestStartedAt) latestStartedAt = snapshot.startedAt;
  }

  for (const exp of selected) {
    const snapshot = exp.latest;
    // 残缺检测:分母 = 该实验已知 eval 并集(本地历史 ∪ 各快照携带的 knownEvalIds)。
    // 位置参数允许只重跑一道题,产出的「最新快照」可能只有一道题 —— 不能安静吞下。
    const covered = snapshot.evals.length;
    const total = exp.evalIds.length;
    if (covered < total) {
      // 合成键不是真实 experiment id,拼不出可执行的 `niceeval exp` 命令,提示退化成中性说法。
      const hint = snapshot.synthetic
        ? "re-run the experiment for a full snapshot"
        : `re-run \`niceeval exp ${exp.id}\` for a full snapshot`;
      warnings.push({
        kind: "partial-coverage",
        experimentId: exp.id,
        covered,
        total,
        message: `snapshot covers ${covered} of ${total} evals seen in history; ${hint}`,
      });
    }
    if (snapshot.startedAt < latestStartedAt) {
      warnings.push({
        kind: "stale-snapshot",
        experimentId: exp.id,
        startedAt: snapshot.startedAt,
        latestStartedAt,
        message: `snapshot "${exp.id}" (${snapshot.startedAt}) predates the latest run in this selection by ${humanizeGap(snapshot.startedAt, latestStartedAt)}`,
      });
    }
    if (snapshot.synthetic) {
      warnings.push({
        kind: "synthetic-experiment-id",
        experimentId: exp.id,
        runDir: snapshot.runDir.dir,
        message: `run "${snapshot.runDir.dir}" has results without experimentId; grouped as "${exp.id}" by agent/model`,
      });
    }
  }
  return makeSelection(snapshots, warnings);
}

/**
 * Selection 构造:filter 只删不换 —— 快照删减,warnings 修剪规则是
 * 「experimentId 不在幸存快照中的丢弃,非实验作用域的保留」(为将来非 per-experiment 的 kind 留位置)。
 */
export function makeSelection(snapshots: Snapshot[], warnings: SelectionWarning[]): Selection {
  return {
    snapshots,
    warnings,
    filter(predicate: (snapshot: Snapshot) => boolean): Selection {
      const kept = snapshots.filter(predicate);
      const survivors = new Set(kept.map((s) => s.experimentId));
      const keptWarnings = warnings.filter((w) => {
        const scope = (w as { experimentId?: unknown }).experimentId;
        return typeof scope !== "string" || survivors.has(scope);
      });
      return makeSelection(kept, keptWarnings);
    },
  };
}

/**
 * 跨快照聚合前的身份键去重:(experimentId, evalId, attempt, startedAt)。
 * --resume 会把上一轮已通过的结果原样合入新 run 的 summary,同一 attempt 因此存在于多份落盘;
 * 重复时保留最新 run 目录里的那份(内容相同,取新 run 的副本让 ref 落在最新落盘上;
 * 位置取首次出现处,顺序稳定)。startedAt 缺失时宁可不去重也不误删,记入 warnings。
 */
export function dedupeAttempts(attempts: AttemptHandle[]): { attempts: AttemptHandle[]; warnings: DedupeWarning[] } {
  const deduped: AttemptHandle[] = [];
  const indexByKey = new Map<string, number>();
  const warnings: DedupeWarning[] = [];

  for (const attempt of attempts) {
    const r = attempt.result;
    if (!r.startedAt) {
      warnings.push({
        kind: "missing-startedAt",
        experimentId: attempt.experimentId,
        evalId: attempt.evalId,
        message: `attempt ${r.attempt} of eval "${attempt.evalId}" in experiment "${attempt.experimentId}" has no startedAt; kept as-is without dedupe`,
      });
      deduped.push(attempt);
      continue;
    }
    const key = JSON.stringify([experimentKeyOf(r).id, r.id, r.attempt, r.startedAt]);
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(attempt);
    } else if (isNewerRunDir(attempt.runDir, deduped[existing].runDir)) {
      deduped[existing] = attempt;
    }
  }
  return { attempts: deduped, warnings };
}

/** run 新旧比较:startedAt 优先,同刻按目录名(时间戳目录,字典序即时序)。 */
export function isNewerRunDir(a: RunDir, b: RunDir): boolean {
  const byStart = a.summary.startedAt.localeCompare(b.summary.startedAt);
  if (byStart !== 0) return byStart > 0;
  return a.dir.localeCompare(b.dir) > 0;
}

function filterByExperimentPrefix(experiments: Experiment[], filter?: string | string[]): Experiment[] {
  if (filter === undefined) return experiments;
  // 允许 "compare/" 这种带尾斜杠的写法,与 "compare" 等价;分段匹配不误配 "compare2"。
  const prefixes = (Array.isArray(filter) ? filter : [filter]).map((p) => p.replace(/\/+$/, ""));
  return experiments.filter((exp) => prefixes.some((p) => exp.id === p || exp.id.startsWith(p + "/")));
}

/** stale 警告的人话时距:选粒度最大的单位,四舍五入。 */
function humanizeGap(fromIso: string, toIso: string): string {
  const ms = Math.max(0, Date.parse(toIso) - Date.parse(fromIso));
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}
