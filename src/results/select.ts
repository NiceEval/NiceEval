// 快照 Selection 与 attempt 去重(定稿见 docs/feature/results/library.md「选择快照」「身份键与去重」)。
//
// 选择器只有一个(latest),长在集合上;它不是 DSL,只是最常用的那次筛选。
// 选择器必须诚实:残缺、落后、未收尾都被算出来,以结构化 warnings 随 Selection 走 ——
// 渲染与否在消费方(message 是渲染好的英文句子),但缺口不静默。

import type {
  AttemptHandle,
  DedupeWarning,
  Eval,
  Experiment,
  Results,
  Selection,
  SelectionWarning,
  Snapshot,
} from "./types.ts";
import { evalPrefixPredicate } from "../shared/aggregate.ts";

/** Results.latest() 的实现:每个实验取最新一次快照(= exp.snapshots[0]),生成挑选警告。 */
export function selectLatest(
  experiments: Experiment[],
  opts?: { experiments?: string | string[] },
): Selection {
  const selected = filterExperiments(experiments, opts?.experiments);
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
      warnings.push({
        kind: "partial-coverage",
        experimentId: exp.id,
        covered,
        total,
        message: `snapshot covers ${covered} of ${total} evals seen in history; re-run \`niceeval exp ${exp.id}\` for a full snapshot`,
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
    if (!snapshot.completedAt) {
      warnings.push({
        kind: "unfinished-snapshot",
        experimentId: exp.id,
        startedAt: snapshot.startedAt,
        dir: snapshot.dir,
        message: `snapshot "${exp.id}" (${snapshot.startedAt}) has no completedAt — the run was interrupted; results may be incomplete`,
      });
    }
  }
  return makeSelection(snapshots, warnings);
}

/** selectCurrentResults 的范围输入:experiment id 前缀与 eval id 前缀,都可缺省。 */
export interface ResultScope {
  /** experiment id 前缀(--experiment),分段匹配语义同 filterExperiments。 */
  experiment?: string;
  /** eval id 前缀(位置参数),收窄 Selection 覆盖的 eval;覆盖警告分母同步收窄到范围内。 */
  patterns?: string[];
}

/**
 * 两个宿主(show / view)共用的现刻水位选择器:每个 experiment × eval 取时间上最新的那份
 * 判定,跨 run 合成。results.latest() 只挑「每实验最新快照」,带 eval 前缀的局部重跑会产出
 * 残缺快照;现刻水位承诺「不会因为一次局部重跑变残缺」,所以在实验的全部历史快照上逐 eval
 * 向更早的 run 补齐,再把合成好的 Selection 交给宿主注入报告槽——内置默认报告与 --report 吃
 * 同一份。
 *
 * 同一 eval 的全部 attempts 必须整批取自包含它的最新快照,不把历史快照的 attempts 平铺后
 * 按 eval 聚合——否则会把不同运行的重试混成一次虚构运行。合成快照的 dir/元数据只服务报告
 * 分组与来源展示,证据身份一律来自 attempt 自己的 ref。
 * 警告随 Selection 重算:partial-coverage 的分母 = 已知并集 ∩ 范围(范围收窄时分母同步收窄,
 * 不让范围外的缺口刷屏);stale / unfinished 与 results.latest() 同口径。
 */
export function selectCurrentResults(results: Results, scope: ResultScope = {}): Selection {
  const match =
    scope.patterns && scope.patterns.length > 0 ? evalPrefixPredicate(scope.patterns) : () => true;
  const experiments = filterExperiments(results.experiments, scope.experiment);

  const snapshots: Snapshot[] = [];
  const warnings: SelectionWarning[] = [];

  for (const exp of experiments) {
    // 逐题取最新:快照按最新在前,首个出现即最新判定
    const taken = new Map<string, { ev: Eval; snapshot: Snapshot }>();
    for (const snapshot of exp.snapshots) {
      for (const ev of snapshot.evals) {
        if (!match(ev.id) || taken.has(ev.id)) continue;
        taken.set(ev.id, { ev, snapshot });
      }
    }
    if (taken.size === 0) continue;

    const picks = [...taken.values()].sort((a, b) => a.ev.id.localeCompare(b.ev.id));
    let startedAt = "";
    let newest: Snapshot = picks[0].snapshot;
    for (const pick of picks) {
      if (pick.snapshot.startedAt > startedAt) {
        startedAt = pick.snapshot.startedAt;
        newest = pick.snapshot;
      }
    }
    const evals = picks.map((p) => p.ev);
    const base = exp.latest;
    snapshots.push({
      experimentId: exp.id,
      startedAt,
      agent: base.agent,
      ...(base.model !== undefined ? { model: base.model } : {}),
      producer: base.producer,
      schemaVersion: base.schemaVersion,
      evals,
      attempts: evals.flatMap((ev) => ev.attempts),
      dir: newest.dir,
      ...(newest.completedAt !== undefined ? { completedAt: newest.completedAt } : {}),
      ...(base.knownEvalIds ? { knownEvalIds: [...base.knownEvalIds] } : {}),
    });

    // 残缺检测:跨快照补齐后仍缺,只可能是历史上见过(或 knownEvalIds 声明过)
    // 却从未在可读落盘里出现的题 —— 分母收窄到范围内,不让范围外的缺口刷屏。
    const total = exp.evalIds.filter(match).length;
    if (evals.length < total) {
      warnings.push({
        kind: "partial-coverage",
        experimentId: exp.id,
        covered: evals.length,
        total,
        message: `verdicts cover ${evals.length} of ${total} evals seen in history; re-run \`niceeval exp ${exp.id}\` for a full snapshot`,
      });
    }
  }

  let latestStartedAt = "";
  for (const snapshot of snapshots) {
    if (snapshot.startedAt > latestStartedAt) latestStartedAt = snapshot.startedAt;
  }
  for (const snapshot of snapshots) {
    if (snapshot.startedAt < latestStartedAt) {
      warnings.push({
        kind: "stale-snapshot",
        experimentId: snapshot.experimentId,
        startedAt: snapshot.startedAt,
        latestStartedAt,
        message: `verdicts for "${snapshot.experimentId}" were produced at ${snapshot.startedAt}, before the latest run in this selection (${latestStartedAt})`,
      });
    }
    if (snapshot.completedAt === undefined) {
      warnings.push({
        kind: "unfinished-snapshot",
        experimentId: snapshot.experimentId,
        startedAt: snapshot.startedAt,
        dir: snapshot.dir,
        message: `snapshot "${snapshot.experimentId}" (${snapshot.startedAt}) is unfinished (the process was interrupted); completed attempts are read as-is, but the set may be incomplete`,
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
 * --resume 会把上一轮已通过的结果原样合入新快照,同一 attempt 因此存在于多份落盘;
 * 重复时保留最新快照里的那份(内容相同,取新快照的副本让 ref 落在最新落盘上;
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
    const key = JSON.stringify([attempt.experimentId, r.id, r.attempt, r.startedAt]);
    const existing = indexByKey.get(key);
    if (existing === undefined) {
      indexByKey.set(key, deduped.length);
      deduped.push(attempt);
    } else if (isNewerSnapshot(attempt.snapshot, deduped[existing].snapshot)) {
      deduped[existing] = attempt;
    }
  }
  return { attempts: deduped, warnings };
}

/** 快照新旧比较:startedAt 优先,同刻按快照目录名(时间戳 + 随机后缀,字典序即时序)。 */
export function isNewerSnapshot(a: Snapshot, b: Snapshot): boolean {
  const byStart = a.startedAt.localeCompare(b.startedAt);
  if (byStart !== 0) return byStart > 0;
  return a.dir.localeCompare(b.dir) > 0;
}

/** experiment id 分段前缀过滤(--experiment / latest({ experiments }) 同一语义);包内使用,不进公共 barrel。 */
export function filterExperiments(experiments: Experiment[], filter?: string | string[]): Experiment[] {
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
