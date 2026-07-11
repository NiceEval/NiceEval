// show 宿主的 Selection 合成与时间轴口径(docs-site/zh/guides/viewing-results.mdx 是行为规范)。
//
// 「现刻水位」= 每个 experiment × eval 取时间上最新的那份判定,跨 run 合成:
// results.latest() 只挑「每实验最新快照」,带 eval 前缀的局部重跑会产出残缺快照;
// 榜单承诺「不会因为一次局部重跑变残缺」,所以宿主在实验的全部历史快照上逐 eval
// 向更早的 run 补齐,再把合成好的 Selection 注入报告槽——内置默认报告与 --report 吃同一份,
// 默认报告口径 = 宿主注入口径。本文件只消费 niceeval/results 的读取面。

import { foldEvalVerdict } from "../shared/verdict.ts";
import { evalPrefixPredicate } from "../report/aggregate.ts";
import { attemptCostUSD } from "../report/metrics.ts";
import { makeSelection } from "../results/select.ts";
import type { Verdict } from "../types.ts";
import type {
  AttemptHandle,
  Eval,
  Experiment,
  Results,
  Selection,
  SelectionWarning,
  Snapshot,
} from "../results/index.ts";

export interface ComposeOptions {
  /** experiment id 前缀(--experiment),与 latest({ experiments }) 同一分段匹配语义。 */
  experiment?: string;
  /** eval id 前缀(位置参数),收窄 Selection 覆盖的 eval;覆盖警告分母 = 已知并集 ∩ 范围。 */
  patterns?: string[];
}

/** --experiment 的实验过滤,同 results.latest({ experiments }) 的分段前缀语义。 */
export function filterExperiments(experiments: Experiment[], prefix?: string): Experiment[] {
  if (prefix === undefined) return experiments;
  const p = prefix.replace(/\/+$/, "");
  return experiments.filter((exp) => exp.id === p || exp.id.startsWith(p + "/"));
}

/**
 * 合成「现刻水位」Selection:每个实验一份合成快照,快照里每道题的判定取该题最后一次
 * 出现的快照(--resume 携带的复印件身份与原判定相同,取到哪份内容都一致)。
 * 警告随 Selection 重算:partial-coverage 的分母 = 已知并集 ∩ 范围;stale / synthetic
 * 与 results.latest() 同口径。
 */
export function composeShowSelection(results: Results, opts: ComposeOptions = {}): Selection {
  const match =
    opts.patterns && opts.patterns.length > 0 ? evalPrefixPredicate(opts.patterns) : () => true;
  const experiments = filterExperiments(results.experiments, opts.experiment);

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
      ...(base.producer ? { producer: base.producer } : {}),
      schemaVersion: base.schemaVersion,
      evals,
      attempts: evals.flatMap((ev) => ev.attempts),
      runDir: newest.runDir,
      ...(base.synthetic ? { synthetic: true } : {}),
      ...(base.knownEvalIds ? { knownEvalIds: [...base.knownEvalIds] } : {}),
    });

    // 残缺检测:跨 run 补齐后仍缺,只可能是历史上见过(或 knownEvalIds 声明过)
    // 却从未在可读落盘里出现的题 —— 分母收窄到范围内,不让范围外的缺口刷屏。
    const total = exp.evalIds.filter(match).length;
    if (evals.length < total) {
      const hint = base.synthetic
        ? "re-run the experiment for a full snapshot"
        : `re-run \`niceeval exp ${exp.id}\` for a full snapshot`;
      warnings.push({
        kind: "partial-coverage",
        experimentId: exp.id,
        covered: evals.length,
        total,
        message: `verdicts cover ${evals.length} of ${total} evals seen in history; ${hint}`,
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
    if (snapshot.synthetic) {
      warnings.push({
        kind: "synthetic-experiment-id",
        experimentId: snapshot.experimentId,
        runDir: snapshot.runDir.dir,
        message: `run "${snapshot.runDir.dir}" has results without experimentId; grouped as "${snapshot.experimentId}" by agent/model`,
      });
    }
  }

  return makeSelection(snapshots, warnings);
}

// ───────────────────────── 时间轴(--history)─────────────────────────

export interface EvalHistoryRow {
  /** 该次真实执行所在 run(快照)的时刻。 */
  startedAt: string;
  verdict: Verdict;
  attempts: number;
  costUSD: number | null;
  /** 最新一次 attempt 的第一条失败断言("gate calledTool(...)")。 */
  failedAssertion?: string;
  /** errored 时的错误摘要。 */
  error?: string;
}

/** attempt 的身份键(去重口径与 dedupeAttempts 一致);缺 startedAt 时不参与去重(宁可多列不误删)。 */
function attemptKey(attempt: AttemptHandle): string | undefined {
  const r = attempt.result;
  return r.startedAt === undefined ? undefined : `${r.attempt}|${r.startedAt}`;
}

/**
 * 单 eval 的跨 run 时间轴:每次真实执行一行,新→旧。--resume 携带的复印件
 * (身份键与原判定相同的条目)不占行 —— 否则趋势会被复印件灌满假数据。
 */
export function evalHistory(exp: Experiment, evalId: string): EvalHistoryRow[] {
  const rows: EvalHistoryRow[] = [];
  const seen = new Set<string>();
  // 旧→新扫描,首次出现的身份键 = 真实执行;最后整体反转成新→旧
  for (const snapshot of [...exp.snapshots].reverse()) {
    const ev = snapshot.evals.find((e) => e.id === evalId);
    if (!ev) continue;
    const fresh: AttemptHandle[] = [];
    for (const attempt of ev.attempts) {
      const key = attemptKey(attempt);
      if (key === undefined) {
        fresh.push(attempt);
        continue;
      }
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push(attempt);
    }
    if (fresh.length === 0) continue; // 纯复印件:判定在更早的行里已经出现过
    let cost: number | null = null;
    for (const attempt of fresh) {
      const c = attemptCostUSD(attempt.result);
      if (c !== null) cost = (cost ?? 0) + c;
    }
    const latest = fresh[fresh.length - 1];
    const failed = latest.result.assertions.find((a) => !a.passed);
    rows.push({
      startedAt: snapshot.startedAt,
      verdict: foldEvalVerdict(fresh.map((a) => a.result)),
      attempts: fresh.length,
      costUSD: cost,
      ...(failed ? { failedAssertion: `${failed.severity} ${failed.name}` } : {}),
      ...(latest.result.error !== undefined ? { error: latest.result.error } : {}),
    });
  }
  return rows.reverse();
}

export interface ExperimentHistoryRow {
  startedAt: string;
  passedEvals: number;
  totalEvals: number;
  costUSD: number | null;
}

/** 实验级 per-run 通过率序列(裸 `show --history`):每个快照一行,新→旧。 */
export function experimentHistory(exp: Experiment): ExperimentHistoryRow[] {
  return exp.snapshots.map((snapshot) => {
    let passed = 0;
    for (const ev of snapshot.evals) {
      if (foldEvalVerdict(ev.attempts.map((a) => a.result)) === "passed") passed += 1;
    }
    let cost: number | null = null;
    for (const attempt of snapshot.attempts) {
      const c = attemptCostUSD(attempt.result);
      if (c !== null) cost = (cost ?? 0) + c;
    }
    return { startedAt: snapshot.startedAt, passedEvals: passed, totalEvals: snapshot.evals.length, costUSD: cost };
  });
}
