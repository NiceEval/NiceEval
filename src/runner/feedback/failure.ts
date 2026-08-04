import { decodeAttemptLocator, type AttemptLocator } from "../../record/locator.ts";
import { compactAssertionSummary, primaryAssertionSummary, summaryText } from "../../assertions/display.ts";
import type { EvalResult } from "../../types.ts";
import { firstLine } from "../../util.ts";
import { runWho, type FailureDetail } from "../types.ts";

function isAttemptLocator(value: string): value is AttemptLocator {
  return decodeAttemptLocator(value).valid;
}

/**
 * 把落定的结果投影成反馈层失败事实。fresh 与 carry 共用这一处，区别只在消费者：
 * fresh 作为 durable event，carry 作为 plan seed，因此不会把历史失败重放成实时事件。
 */
export function failureDetailFromResult(result: EvalResult): FailureDetail | undefined {
  const locator = result.locator;
  if (!locator || !isAttemptLocator(locator) || (result.verdict !== "failed" && result.verdict !== "errored")) {
    return undefined;
  }

  const assertion = result.error === undefined
    ? primaryAssertionSummary(result.assertions, result.verdict, result.evaluationKind === "points" ? "points" : "pass")
    : undefined;
  // 执行错误只给一层可行动摘要(docs/feature/experiments/cli.md「运行反馈」):message 取首行
  // ——多行 message 的后续行(如 diagnose 的 output tail)归 `show @locator` 展开,不进
  // scrollback;再过 summaryText 剥控制字节并按摘要上限收口,adapter 组装的文本里混进
  // ANSI 着色时不泄漏进终端事实行。
  // 超时的那条 reason 后面直接接归属:哪层时限、上限多少、值从哪来。一行里说清「谁把它掐的」,
  // 不让人先去 `show --timing` 才知道自己撞的是哪条线(见 docs/feature/sandbox/architecture.md
  // 「时限归属」)。
  const timeout = result.error?.timeout;
  const attribution = timeout
    ? ` (${timeout.trigger} · limit ${timeout.limitMs}ms · from ${timeout.source})`
    : "";
  const reason = result.verdict === "errored"
    ? `${summaryText(firstLine(result.error?.message ?? result.verdict))}${attribution}`
    : assertion
      ? compactAssertionSummary(assertion)
      : summaryText(firstLine(result.error?.message ?? result.verdict));
  const origin = result.verdict === "errored" ? result.error?.origin : undefined;
  const phase = origin?.scope === "attempt" ? origin.phase : undefined;
  // 只在真正的结构化执行错误(没有主断言摘要,即 assertion-unavailable 之外的 errored)上携带
  // `code`——human 单行事实行拼 `errored · <phase> · <code>` 时按它作稳定词法,assertion-unavailable
  // 造成的 errored 已经有更具体的断言摘要可展示,不需要也没有这个字段(见 types.ts 的字段注释)。
  const code = result.verdict === "errored" && assertion === undefined ? result.error?.code : undefined;

  return {
    locator,
    identity: { experimentId: result.experimentId, evalId: result.id, attempt: result.attempt },
    who: runWho({ agentName: result.agent, model: result.model, experimentId: result.experimentId }),
    verdict: result.verdict,
    reason,
    ...(assertion !== undefined ? { assertion } : {}),
    ...(phase !== undefined ? { phase } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(origin !== undefined ? { origin } : {}),
  };
}
