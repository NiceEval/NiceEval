// 复用污染的收尾诊断(契约见 docs/feature/sandbox/reuse.md「复用污染的可观察性」)。
//
// 「setup 幂等、不依赖 workdir 外残留」是作者义务,违约的症状(下游 Eval 莫名失败)不指向复用。
// Run 收尾按 Sandbox 实例与承接序号聚合:首承接正常、而同一实例序号 ≥ 2 的 Attempt 集中失败或
// 集中 errored 在同一生命周期阶段时,追加一条运行级 diagnostic 点名实例、序号区间与阶段。
// 只指路,不改判定 —— 这里既不读也不写任何 verdict。

import type { EvalResult, LifecyclePhase } from "./types.ts";

/** 同一阶段上至少这么多条后承接失败才算「集中」;低于它是零散失败,不发诊断(不误报)。 */
const CLUSTER_MIN = 2;

export interface ReuseContaminationNotice {
  /** 承接这些 Attempt 的实验;裸 run(无 experimentId)用 undefined。 */
  experimentId?: string;
  /** 本次 Run 内的 Sandbox 编号。 */
  reuseSandbox: number;
  /** 集中失败所在的生命周期阶段。 */
  phase: LifecyclePhase;
  /** 集中失败的承接序号区间(闭区间)与条数。 */
  fromOrdinal: number;
  toOrdinal: number;
  count: number;
}

function failing(result: EvalResult): boolean {
  return result.verdict === "failed" || result.verdict === "errored";
}

/** 失败落在哪个阶段:errored 读 `error.phase`;断言失败没有 error,归 `eval.run`(判定发生地)。 */
function phaseOf(result: EvalResult): LifecyclePhase {
  return (result.error?.origin.scope === "attempt" ? result.error.origin.phase : undefined) ?? "eval.run";
}

/**
 * 按实例 × 承接序号聚合出复用污染线索。只看声明了复用(`sandbox.reused`)且带完整调度事实的
 * 结果;首承接(序号 1)缺失或本身失败的实例整个跳过——那种失败与「上一条 Attempt 的残留」
 * 无关,报出来就是误报。
 */
export function detectReuseContamination(results: readonly EvalResult[]): ReuseContaminationNotice[] {
  const byInstance = new Map<string, { experimentId?: string; reuseSandbox: number; attempts: EvalResult[] }>();
  for (const result of results) {
    const sandbox = result.sandbox;
    if (!sandbox?.reused || sandbox.reuseSandbox === undefined || sandbox.reuseOrdinal === undefined) continue;
    const key = `${result.experimentId ?? ""}#${sandbox.reuseSandbox}`;
    let group = byInstance.get(key);
    if (!group) {
      group = { ...(result.experimentId !== undefined ? { experimentId: result.experimentId } : {}), reuseSandbox: sandbox.reuseSandbox, attempts: [] };
      byInstance.set(key, group);
    }
    group.attempts.push(result);
  }

  const notices: ReuseContaminationNotice[] = [];
  for (const group of byInstance.values()) {
    const first = group.attempts.find((r) => r.sandbox!.reuseOrdinal === 1);
    // 首承接没跑到、或首承接自己就失败:这台实例的失败不能归因到「前一条 Attempt 的残留」。
    if (!first || failing(first)) continue;
    const laterFailures = group.attempts.filter((r) => r.sandbox!.reuseOrdinal! >= 2 && failing(r));
    const byPhase = new Map<LifecyclePhase, number[]>();
    for (const attempt of laterFailures) {
      const phase = phaseOf(attempt);
      const ordinals = byPhase.get(phase) ?? [];
      ordinals.push(attempt.sandbox!.reuseOrdinal!);
      byPhase.set(phase, ordinals);
    }
    for (const [phase, ordinals] of byPhase) {
      if (ordinals.length < CLUSTER_MIN) continue;
      const sorted = [...ordinals].sort((a, b) => a - b);
      notices.push({
        ...(group.experimentId !== undefined ? { experimentId: group.experimentId } : {}),
        reuseSandbox: group.reuseSandbox,
        phase,
        fromOrdinal: sorted[0]!,
        toOrdinal: sorted[sorted.length - 1]!,
        count: sorted.length,
      });
    }
  }
  return notices;
}

/** 诊断正文:点名实例、序号区间与阶段,并说清它只是线索。 */
export function reuseContaminationMessage(notice: ReuseContaminationNotice): string {
  const where = notice.experimentId !== undefined ? ` in experiment "${notice.experimentId}"` : "";
  return (
    `  · [sandbox] reused sandbox #${notice.reuseSandbox}${where} handled its first attempt cleanly, but ` +
    `${notice.count} later attempts (handoff ${notice.fromOrdinal}-${notice.toOrdinal}) all stopped in ${notice.phase}. ` +
    "State left outside workdir by an earlier attempt is a likely cause: setup must be idempotent and must not " +
    "depend on anything the previous attempt left behind. This only points at a suspect; it changes no verdict."
  );
}
