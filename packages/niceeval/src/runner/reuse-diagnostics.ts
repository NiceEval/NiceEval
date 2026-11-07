// 复用失败的收尾诊断(契约见 docs/feature/sandbox/library/reuse.md「复用失败的可观察性」)。
//
// 有意持久状态是合法的实验输入；失败序列本身不能证明污染或根因。
// Run 收尾按 Sandbox 实例与承接序号聚合:首承接正常、而同一实例序号 ≥ 2 的 Attempt 集中失败或
// 集中 errored 在同一生命周期阶段时,追加一条运行级 diagnostic 点名实例、序号区间与阶段。
// 只指路,不改判定 —— 这里既不读也不写任何 verdict。

import type { EvalResult, LifecyclePhase } from "./types.ts";

/** 同一阶段上至少这么多条后承接失败才算「集中」;低于它是零散失败,不发诊断(不误报)。 */
const CLUSTER_MIN = 2;

export interface ReuseFailureClusterNotice {
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
 * 按实例 × 承接序号聚合复用后的失败。只看声明了复用且带完整调度事实的结果；
 * 首承接缺失或本身失败时没有成功基准，不报告后续失败聚集。
 */
export function detectReuseFailureClusters(results: readonly EvalResult[]): ReuseFailureClusterNotice[] {
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

  const notices: ReuseFailureClusterNotice[] = [];
  for (const group of byInstance.values()) {
    const first = group.attempts.find((r) => r.sandbox!.reuseOrdinal === 1);
    // 首承接缺失或失败时，没有成功基准可供比较。
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
export function reuseFailureClusterMessage(notice: ReuseFailureClusterNotice): string {
  const where = notice.experimentId !== undefined ? ` in experiment "${notice.experimentId}"` : "";
  return (
    `  · [sandbox] reused sandbox #${notice.reuseSandbox}${where} handled its first attempt cleanly, but ` +
    `${notice.count} later attempts (handoff ${notice.fromOrdinal}-${notice.toOrdinal}) all stopped in ${notice.phase}. ` +
    "This failure pattern does not establish a cause. Intentional persistent memory and checkpoints are supported; " +
    "check expected state, unexpected leftovers, and repeatable setup against the experiment's design. No verdict is changed."
  );
}
