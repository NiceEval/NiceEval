import { decodeAttemptLocator, type AttemptLocator } from "../../results/locator.ts";
import { compactAssertionSummary, primaryAssertionSummary } from "../../scoring/display.ts";
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
    ? primaryAssertionSummary(result.assertions, result.verdict)
    : undefined;
  const reason = result.verdict === "errored"
    ? firstLine(result.error?.message ?? result.verdict)
    : assertion
      ? compactAssertionSummary(assertion)
      : firstLine(result.error?.message ?? result.verdict);
  const phase = result.verdict === "errored" ? result.error?.phase : undefined;

  return {
    locator,
    identity: { experimentId: result.experimentId, evalId: result.id, attempt: result.attempt },
    who: runWho({ agentName: result.agent, model: result.model, experimentId: result.experimentId }),
    verdict: result.verdict,
    reason,
    ...(assertion !== undefined ? { assertion } : {}),
    ...(phase !== undefined ? { phase } : {}),
  };
}
