// reporter 编排与运行级汇总。reporter 是「结果消费方」:单个 reporter 抛错只记
// diagnostic,不能让整次调度崩。

import type {
  EvalResult,
  LocalizedText,
  Reporter,
  ReporterEvent,
  ReporterRegistration,
  RunShape,
  RunSummary,
} from "../types.ts";
import { firstLine, formatThrown } from "../util.ts";
import { reportReporterError } from "./feedback/sink.ts";

/**
 * reporter 调用的统一兜错。返回 void,永不 reject(供 Promise.all 安全聚合,单个 reporter
 * 抛错不终止其它 reporter 的收尾,也不中断在飞的 attempt)。`reg.name`/`reg.required` 决定
 * `reportReporterError()` 收到的诊断身份与判定权重(见 `ReporterRegistration` 的字段注释:
 * 同一个 reporter 反复失败按 `name` 去重折叠,`required` 决定它是否让 completion/CI 退出码
 * 判红)。`stage` 只是这次失败发生在哪个回调阶段的次要上下文,拼进 message,不参与去重身份——
 * 同一 reporter 在 onEvalComplete 与 onRunComplete 两个阶段各失败一次,仍然折成同一条诊断、
 * count 累加到 2,而不是拆成两条互不相关的诊断。message 只取 `formatThrown()` 的第一行(与
 * run.ts 的 `describeFailureReason` 同一原则)——reporter 抛出的 Error 完整 `.stack` 含本地
 * 绝对文件路径和调用帧,不适合塞进 agent/ci 那种单行、稳定、机器消费的 envelope;这里没有
 * `EvalResult.error` 那样的落盘字段能保留完整栈,所以「一层可行动摘要」就是这条诊断的全部内容,
 * 不是从更详细的记录里摘出来的简化版——排查真正需要栈时,重跑该 reporter 单独复现更可靠。
 */
export async function runReporter(reg: ReporterRegistration, stage: string, fn: () => unknown): Promise<void> {
  try {
    await fn();
  } catch (e) {
    reportReporterError({ reporter: reg.name, required: reg.required, message: `${stage}: ${firstLine(formatThrown(e))}` });
  }
}

export async function emitReporterEvent(
  registrations: readonly ReporterRegistration[],
  event: ReporterEvent,
): Promise<void> {
  await Promise.all(
    registrations.map((reg) => runReporter(reg, `event:${event.type}`, () => reg.reporter.onEvent?.(event))),
  );
}

/** 按 eval id 过滤 RunSummary 并重新计数 —— eval 级 reporter 只看它观测的那部分。 */
export function filterSummary(summary: RunSummary, ids: ReadonlySet<string>): RunSummary {
  const results = summary.results.filter((r) => ids.has(r.id));
  const sub = summarize(results, summary.agent, summary.startedAt, summary.durationMs, summary.name, summary.model);
  // completedAt 用原值(summarize 会重新取 now);name 等其余字段原样保留。
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
  model?: string,
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
    model,
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
