// 快照选择器与 attempt 去重(设计见 docs/results-lib.md「选择快照」「身份键与去重」)。
//
// 选择器不是 DSL,只是最常用的那次筛选;更细的口径消费方自己 .filter()。
// 选择器必须诚实:残缺(最新快照覆盖的 eval 少于历史并集)永远被算出来,以 warnings 返回,
// 渲染与否在消费方,但缺口不静默。

import { experimentKeyOf } from "./format.ts";
import type { AttemptHandle, RunHandle, SnapshotHandle } from "./types.ts";

/**
 * 每个 experiment 取最新一次快照(按所属 run 的 startedAt,同刻按 run 目录名兜底)。
 * `experiments` 是 experiment id 前缀过滤,同 CLI 位置参数语义("compare" 匹配自身与
 * "compare/..." 子级;允许写成 "compare/",等价)。
 */
export function latestPerExperiment(
  snapshots: SnapshotHandle[],
  opts?: { experiments?: string | string[] },
): { snapshots: SnapshotHandle[]; warnings: string[] } {
  const filtered = filterByExperiments(snapshots, opts?.experiments);

  const byExperiment = new Map<string, SnapshotHandle[]>();
  for (const snapshot of filtered) {
    const group = byExperiment.get(snapshot.experimentId);
    if (group) group.push(snapshot);
    else byExperiment.set(snapshot.experimentId, [snapshot]);
  }

  const picked: SnapshotHandle[] = [];
  const warnings: string[] = [];
  for (const [experimentId, group] of byExperiment) {
    let latest = group[0];
    for (const candidate of group) {
      if (isNewerRun(candidate.run, latest.run)) latest = candidate;
    }
    // 残缺检测:与该 experiment 全部历史快照的 evalId 并集对比。
    // 位置参数允许只重跑一道题,产出的「最新快照」可能只有一道题 —— 不能安静吞下。
    const historyIds = new Set<string>();
    for (const snapshot of group) for (const id of snapshot.evalIds) historyIds.add(id);
    if (latest.evalIds.length < historyIds.size) {
      // 合成键不是真实 experiment id,拼不出可执行的 `niceeval exp` 命令,提示退化成中性说法。
      const hint = latest.synthetic
        ? "  Re-run the experiment for a full snapshot, or pick another via .filter()."
        : `  Re-run \`niceeval exp ${experimentId}\` for a full snapshot, or pick another via .filter().`;
      warnings.push(
        `warning: snapshot "${experimentId}" @ ${latest.startedAt} covers ${latest.evalIds.length} of ${historyIds.size} evals seen in history.\n` +
          hint,
      );
    }
    picked.push(latest);
  }

  picked.sort((a, b) => a.experimentId.localeCompare(b.experimentId));
  return { snapshots: picked, warnings };
}

/**
 * 跨快照聚合前的身份键去重:(experimentId, evalId, attempt, startedAt)。
 * --resume 会把上一轮已通过的结果原样合入新 run 的 summary,同一 attempt 因此存在于多份落盘;
 * 重复时保留最新 run 里的那份(位置取首次出现处,顺序稳定)。
 * startedAt 缺失时宁可不去重也不误删,并记入 warnings。
 */
export function dedupeAttempts(attempts: AttemptHandle[]): { attempts: AttemptHandle[]; warnings: string[] } {
  const deduped: AttemptHandle[] = [];
  const indexByKey = new Map<string, number>();
  const warnings: string[] = [];

  for (const attempt of attempts) {
    const r = attempt.result;
    if (!r.startedAt) {
      warnings.push(
        `warning: attempt "${r.id}" (attempt ${r.attempt}) in run "${attempt.run.dir}" has no startedAt; kept as-is without dedupe.`,
      );
      deduped.push(attempt);
      continue;
    }
    const key = JSON.stringify([experimentKeyOf(r).id, r.id, r.attempt, r.startedAt]);
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(attempt);
    } else if (isNewerRun(attempt.run, deduped[existing].run)) {
      deduped[existing] = attempt;
    }
  }
  return { attempts: deduped, warnings };
}

/** run 新旧比较:startedAt 优先,同刻按目录名(时间戳目录,字典序即时序)。 */
export function isNewerRun(a: RunHandle, b: RunHandle): boolean {
  const byStart = a.summary.startedAt.localeCompare(b.summary.startedAt);
  if (byStart !== 0) return byStart > 0;
  return a.dir.localeCompare(b.dir) > 0;
}

function filterByExperiments(snapshots: SnapshotHandle[], experiments?: string | string[]): SnapshotHandle[] {
  if (experiments === undefined) return snapshots;
  const prefixes = (Array.isArray(experiments) ? experiments : [experiments])
    // 允许 "compare/" 这种带尾斜杠的写法,与 "compare" 等价。
    .map((p) => p.replace(/\/+$/, ""));
  return snapshots.filter((s) => prefixes.some((p) => s.experimentId === p || s.experimentId.startsWith(p + "/")));
}
