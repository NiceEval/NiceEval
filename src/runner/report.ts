// reporter 编排与运行级汇总。reporter 是「结果消费方」:单个 reporter 抛错只记
// diagnostic,不能让整次调度崩。

import type { EvalResult, LocalizedText, Reporter, ReporterEvent, RunShape, RunSummary } from "../types.ts";
import { t } from "../i18n/index.ts";
import { formatThrown } from "../util.ts";

/** reporter 调用的统一兜错。返回 void,永不 reject(供 Promise.all 安全聚合)。 */
export async function runReporter(stage: string, fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (e) {
    process.stderr.write(t("runner.reporterDiagnostic", { stage, message: formatThrown(e) }));
  }
}

export async function emitReporterEvent(reporters: readonly Reporter[], event: ReporterEvent): Promise<void> {
  await Promise.all(reporters.map((r) => runReporter(`event:${event.type}`, () => r.onEvent?.(event))));
}

/** 按 eval id 过滤 RunSummary 并重新计数 —— eval 级 reporter 只看它观测的那部分。 */
export function filterSummary(summary: RunSummary, ids: ReadonlySet<string>): RunSummary {
  const results = summary.results.filter((r) => ids.has(r.id));
  const sub = summarize(results, summary.agent, summary.startedAt, summary.durationMs, summary.name);
  // completedAt 用原值(summarize 会重新取 now);format / producer / outputDir 等元数据原样保留。
  return { ...summary, ...sub, completedAt: summary.completedAt };
}

/**
 * eval 级 reporter 的作用域包装:实例只观测「引用它的那些 eval」。
 * 结果类回调按 eval id 过滤,汇总类回调收到重新计数的子集汇总;
 * shape 由调用方按作用域预先算好(包装器自己看不到 attempts)。
 */
export function scopeReporter(r: Reporter, ids: ReadonlySet<string>, shape?: RunShape): Reporter {
  const scoped: Reporter = {};
  if (r.onRunStart) {
    scoped.onRunStart = (evals, agent, fullShape) =>
      r.onRunStart!(evals.filter((e) => ids.has(e.id)), agent, shape ?? fullShape);
  }
  if (r.onEvalComplete) {
    scoped.onEvalComplete = (result) => (ids.has(result.id) ? r.onEvalComplete!(result) : undefined);
  }
  if (r.onRunComplete) {
    scoped.onRunComplete = (summary) => r.onRunComplete!(filterSummary(summary, ids));
  }
  if (r.onEvent) {
    scoped.onEvent = (event) => {
      switch (event.type) {
        case "run:start":
          return r.onEvent!({
            ...event,
            evals: event.evals.filter((e) => ids.has(e.id)),
            shape: shape ?? event.shape,
          });
        case "eval:start":
          return ids.has(event.eval.id) ? r.onEvent!(event) : undefined;
        case "eval:complete":
          return ids.has(event.result.id) ? r.onEvent!(event) : undefined;
        case "run:earlyExit":
          return ids.has(event.evalId) ? r.onEvent!(event) : undefined;
        case "run:summary":
        case "run:saved":
          return r.onEvent!({ ...event, summary: filterSummary(event.summary, ids) });
        default:
          return r.onEvent!(event);
      }
    };
  }
  return scoped;
}

/** 全局汇总:verdict 计数 + token / cost 折叠。按 attempt 计(eval 级折叠见 shared/verdict.ts)。 */
export function summarize(
  results: EvalResult[],
  agent: string,
  startedAt: string,
  durationMs: number,
  name?: LocalizedText,
): RunSummary {
  const counts = { passed: 0, failed: 0, skipped: 0, errored: 0 };
  let inTok = 0;
  let outTok = 0;
  let cost = 0;
  for (const r of results) {
    counts[r.verdict] += 1;
    inTok += r.usage?.inputTokens ?? 0;
    outTok += r.usage?.outputTokens ?? 0;
    cost += r.estimatedCostUSD ?? 0;
  }
  return {
    name,
    agent,
    startedAt,
    completedAt: new Date().toISOString(),
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    errored: counts.errored,
    durationMs,
    usage: { inputTokens: inTok, outputTokens: outTok },
    estimatedCostUSD: cost || undefined,
    results,
  };
}
