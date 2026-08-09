import { decodeAttemptLocator, type AttemptLocator } from "../../record/locator.ts";
import { compactAssertionSummary, summaryText } from "../../assertions/display.ts";
import type {
  EvaluationFactResult,
  EvalResult,
  LegacyJudgeAssertionResult,
  PrimaryAssertionSummary,
  ScoreFactUseResult,
  VerdictFactUseResult,
} from "../../types.ts";
import { firstLine } from "../../util.ts";
import { attemptTerminalOf } from "../../shared/verdict.ts";
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

  const terminal = failureSummaryTerminal(result);
  const assertion = terminal === undefined ? undefined : primaryFactSummary(result, terminal);
  // A score `invalid` deliberately wins over later execution errors. Conversely,
  // an errored terminal can only fall back to the runner error after every
  // evaluator-originated Fact / legacy Judge cause has been considered.
  const fallbackError = terminal === "errored" && assertion === undefined ? result.error : undefined;
  // 执行错误只给一层可行动摘要(docs/feature/experiments/cli.md「运行反馈」):message 取首行
  // ——多行 message 的后续行(如 diagnose 的 output tail)归 `show @locator` 展开,不进
  // scrollback;再过 summaryText 剥控制字节并按摘要上限收口,adapter 组装的文本里混进
  // ANSI 着色时不泄漏进终端事实行。
  // 超时的那条 reason 后面直接接归属:哪层时限、上限多少、值从哪来。一行里说清「谁把它掐的」,
  // 不让人先去 `show --timing` 才知道自己撞的是哪条线(见 docs/feature/sandbox/architecture.md
  // 「时限归属」)。
  const timeout = fallbackError?.timeout;
  const attribution = timeout
    ? ` (${timeout.trigger} · limit ${timeout.limitMs}ms · from ${timeout.source})`
    : "";
  const reason = fallbackError !== undefined
    ? `${summaryText(firstLine(fallbackError.message))}${attribution}`
    : assertion !== undefined
      ? compactAssertionSummary(assertion)
      : summaryText(result.verdict);
  const origin = fallbackError?.origin;
  const phase = origin?.scope === "attempt" ? origin.phase : undefined;
  // 只在真正的结构化执行错误（没有主 Fact 摘要）上携带 `code`。Fact unavailable/errored
  // 已经有更具体的结构化摘要，不需要也没有这个字段。
  const code = result.verdict === "errored" && assertion === undefined ? fallbackError?.code : undefined;
  const factsCount = result.facts === undefined ? undefined : Object.keys(result.facts).length;

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
    ...(factsCount !== undefined && factsCount > 0 ? { factsCount } : {}),
  };
}

/**
 * 反馈行只投影已经落定的 Fact/use；不把新结果反向伪造成 legacy AssertionResult。
 * 只选择真正参与当前失败终态的 use；同一 Fact 同时用于 verdict 与 score 时只显示一次。
 * 旧反馈 DTO 的 severity 槽固定投影为 gate，不反向伪造 legacy AssertionResult。
 */
type FailureSummaryTerminal = "failed" | "invalid" | "errored" | "unavailable";

function failureSummaryTerminal(result: EvalResult): FailureSummaryTerminal | undefined {
  const terminal = attemptTerminalOf(result);
  return terminal === "failed" || terminal === "invalid" || terminal === "errored" || terminal === "unavailable"
    ? terminal
    : undefined;
}

function primaryFactSummary(
  result: EvalResult,
  terminal: FailureSummaryTerminal,
): PrimaryAssertionSummary | undefined {
  const trace = result.factTrace;
  if (trace === undefined) return undefined;
  const facts = new Map(trace.facts.map((fact) => [fact.factId, fact]));
  const candidates = new Map<string, FactFailureCandidate>();
  for (const use of trace.uses) {
    const candidate = useCandidate(use, facts, terminal);
    if (candidate === undefined) continue;
    const identity = candidate.factId === undefined ? `use:${candidate.sourceOrder}` : `fact:${candidate.factId}`;
    const existing = candidates.get(identity);
    if (existing === undefined || candidate.sourceOrder < existing.sourceOrder) candidates.set(identity, candidate);
  }
  // A dependency Fact can be the evaluator root cause even when no use points
  // to it directly. Uses keep their labels when present; these rows fill only
  // the otherwise invisible roots.
  if (terminal === "errored" || terminal === "unavailable") {
    for (const fact of trace.facts) {
      const candidate = factCandidate(fact, trace.uses, terminal);
      if (candidate !== undefined && !candidates.has(`fact:${fact.factId}`)) {
        candidates.set(`fact:${fact.factId}`, candidate);
      }
    }
  }
  for (const legacy of trace.legacyJudgeAssertions) {
    const candidate = legacyCandidate(legacy, terminal);
    if (candidate !== undefined) candidates.set(`legacy:${legacy.sourceOrder}`, candidate);
  }
  const ordered = [...candidates.values()].sort((left, right) => left.sourceOrder - right.sourceOrder);
  const primary = ordered[0];
  if (primary === undefined) return undefined;
  return {
    severity: "gate",
    assertion: summaryText(primary.title),
    ...(primary.matcher === undefined ? {} : { matcher: summaryText(primary.matcher) }),
    ...(primary.expected === undefined ? {} : { expected: summaryText(primary.expected) }),
    ...(primary.received === undefined ? {} : { received: summaryText(primary.received) }),
    ...(primary.reason === undefined ? {} : { reason: summaryText(primary.reason) }),
    additionalFailures: ordered.length - 1,
  };
}

interface FactFailureCandidate {
  readonly sourceOrder: number;
  readonly factId?: string;
  readonly title: string;
  readonly matcher?: string;
  readonly expected?: string;
  readonly received?: string;
  readonly reason?: string;
}

function useCandidate(
  use: VerdictFactUseResult | ScoreFactUseResult,
  facts: ReadonlyMap<string, EvaluationFactResult>,
  terminal: FailureSummaryTerminal,
): FactFailureCandidate | undefined {
  const isFailure = terminal === "failed" || terminal === "invalid"
    ? use.useKind === "verdict" && use.outcome === "failed"
    : terminal === "errored"
      ? use.outcome === "errored"
      : use.outcome === "unavailable";
  if (!isFailure) return undefined;
  const factId = use.useKind === "verdict"
    ? use.target.factId
    : use.input.kind === "fact"
      ? use.input.factId
      : undefined;
  if (factId === undefined) return undefined;
  const fact = facts.get(factId);
  const label = use.label;
  const title = label ?? use.key ?? fact?.name ?? factId;
  const matcher = fact?.name === undefined || fact.name === title ? undefined : fact.name;
  const reason = use.outcome === "unavailable"
    ? use.reason
    : use.outcome === "errored"
      ? use.error.message
      : undefined;
  return {
    sourceOrder: use.sourceOrder,
    factId,
    title,
    ...(matcher === undefined ? {} : { matcher }),
    ...(fact?.expected === undefined ? {} : { expected: fact.expected }),
    ...(fact?.received === undefined ? {} : { received: fact.received }),
    ...(reason === undefined ? {} : { reason }),
  };
}

function factCandidate(
  fact: EvaluationFactResult,
  uses: readonly (VerdictFactUseResult | ScoreFactUseResult)[],
  terminal: Extract<FailureSummaryTerminal, "errored" | "unavailable">,
): FactFailureCandidate | undefined {
  if (terminal === "errored" && fact.outcome === "errored") {
    return {
      sourceOrder: fact.sourceOrder,
      factId: fact.factId,
      title: fact.name,
      reason: fact.error.message,
    };
  }
  if (terminal !== "unavailable" || fact.outcome !== "unavailable") return undefined;
  const consumers = uses.filter((use) =>
    use.useKind === "verdict"
      ? use.target.factId === fact.factId
      : use.input.kind === "fact" && use.input.factId === fact.factId,
  );
  if (consumers.length > 0 && consumers.every((use) => use.outcome !== "unavailable")) return undefined;
  return {
    sourceOrder: fact.sourceOrder,
    factId: fact.factId,
    title: fact.name,
    reason: fact.reason,
  };
}

function legacyCandidate(
  legacy: LegacyJudgeAssertionResult,
  terminal: FailureSummaryTerminal,
): FactFailureCandidate | undefined {
  const causal = terminal === "failed" || terminal === "invalid"
    ? legacy.outcome === "failed" && legacy.policy.verdict.kind === "gate"
    : terminal === "errored"
      ? legacy.outcome === "errored"
      : legacy.outcome === "unavailable" && !legacy.policy.optional;
  if (!causal) return undefined;
  const reason = legacy.outcome === "unavailable"
    ? legacy.reason
    : legacy.outcome === "errored"
      ? legacy.error.message
      : undefined;
  return {
    sourceOrder: legacy.sourceOrder,
    title: legacy.name,
    ...(legacy.detail === legacy.name ? {} : { matcher: legacy.detail }),
    ...(reason === undefined ? {} : { reason }),
  };
}
