import { compactAssertionSummary, summaryText } from "../../assertions/display.ts";
import { encodeAttemptLocator } from "../../attempt-locator.ts";
import type {
  EvaluationFactResult,
  EvalResult,
  PrimaryFactSummary,
  ScoreFactUseResult,
  VerdictFactUseResult,
} from "../../types.ts";
import { firstLine } from "../../util.ts";
import { attemptTerminalOf } from "../../shared/verdict.ts";
import { runWho, type AgentRun, type FailureDetail } from "../types.ts";
import type { CurrentReusedAttemptReadback } from "../reuse-readback.ts";

/**
 * Fresh results and current Record readbacks use separate projections so the
 * latter never has to impersonate an EvalResult at the feedback boundary.
 */
export function failureDetailFromResult(result: EvalResult): FailureDetail | undefined {
  const locator = result.locator;
  if (!locator || (result.verdict !== "failed" && result.verdict !== "errored")) {
    return undefined;
  }

  const terminal = failureSummaryTerminal(result);
  const fact = terminal === undefined ? undefined : primaryFactSummary(result, terminal);
  // An errored terminal can only fall back to the runner error after every
  // evaluator-originated Fact cause has been considered.
  const fallbackError = terminal === "errored" && fact === undefined ? result.error : undefined;
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
    : fact !== undefined
      ? compactAssertionSummary(fact)
      : summaryText(result.verdict);
  const origin = fallbackError?.origin;
  const phase = origin?.scope === "attempt" ? origin.phase : undefined;
  // 只在真正的结构化执行错误（没有主 Fact 摘要）上携带 `code`。Fact unavailable/errored
  // 已经有更具体的结构化摘要，不需要也没有这个字段。
  const code = result.verdict === "errored" && fact === undefined ? fallbackError?.code : undefined;
  const factsCount = result.facts === undefined ? undefined : Object.keys(result.facts).length;

  return {
    locator,
    identity: { experimentId: result.experimentId, evalId: result.id, attempt: result.attempt },
    who: runWho({ agentName: result.agent, model: result.model, experimentId: result.experimentId }),
    verdict: result.verdict,
    reason,
    ...(fact !== undefined ? { fact } : {}),
    ...(phase !== undefined ? { phase } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(origin !== undefined ? { origin } : {}),
    ...(factsCount !== undefined && factsCount > 0 ? { factsCount } : {}),
  };
}

/**
 * A current Record reuse remains a readback ADT all the way to display. The
 * durable source identity is exact; display derives the current short alias.
 */
export function failureDetailFromCurrentReusedAttempt(
  readback: CurrentReusedAttemptReadback,
  run: Pick<AgentRun, "agent" | "model" | "experimentId">,
): FailureDetail | undefined {
  if (readback.verdict !== "failed") return undefined;
  const diagnostic = readback.executionErrors.state === "available"
    ? readback.executionErrors.value[0]
    : undefined;
  return {
    locator: encodeAttemptLocator(readback.source.attemptId),
    identity: {
      experimentId: readback.target.experimentId,
      evalId: readback.target.evalId,
      attempt: readback.target.attempt,
    },
    who: runWho({
      agentName: run.agent.name,
      model: run.model,
      experimentId: run.experimentId,
    }),
    verdict: "failed",
    reason: diagnostic === undefined
      ? summaryText(readback.verdict)
      : summaryText(firstLine(diagnostic.summary)),
  };
}

/**
 * 反馈行只投影已经落定的 Fact/use。
 * 只选择真正参与当前失败终态的 use；同一 Fact 同时用于 verdict 与 score 时只显示一次。
 * 反馈只投影 Fact/use 的因果关系，不重建另一套判定等级。
 */
type FailureSummaryTerminal = "failed" | "errored";

function failureSummaryTerminal(result: EvalResult): FailureSummaryTerminal | undefined {
  const terminal = attemptTerminalOf(result);
  return terminal === "failed" || terminal === "errored"
    ? terminal
    : undefined;
}

function primaryFactSummary(
  result: EvalResult,
  terminal: FailureSummaryTerminal,
): PrimaryFactSummary | undefined {
  const facts = new Map<string, EvaluationFactResult>(result.factResults.map((fact) => [fact.factId, fact]));
  const candidates = new Map<string, FactFailureCandidate>();
  for (const use of result.factUses) {
    const candidate = useCandidate(use, facts, terminal);
    if (candidate === undefined) continue;
    const identity = candidate.factId === undefined ? `use:${candidate.sourceOrder}` : `fact:${candidate.factId}`;
    const existing = candidates.get(identity);
    if (existing === undefined || candidate.sourceOrder < existing.sourceOrder) candidates.set(identity, candidate);
  }
  // A dependency Fact can be the evaluator root cause even when no use points
  // to it directly. Uses keep their labels when present; these rows fill only
  // the otherwise invisible roots.
  if (terminal === "errored") {
    for (const fact of result.factResults) {
      const candidate = factCandidate(fact, result.factUses, terminal);
      if (candidate !== undefined && !candidates.has(`fact:${fact.factId}`)) {
        candidates.set(`fact:${fact.factId}`, candidate);
      }
    }
  }
  const ordered = [...candidates.values()].sort((left, right) => left.sourceOrder - right.sourceOrder);
  const primary = ordered[0];
  if (primary === undefined) return undefined;
  return {
    title: summaryText(primary.title),
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
  const isFailure = terminal === "failed"
    ? use.useKind === "verdict" && use.outcome === "failed"
    : use.outcome === "errored" || use.outcome === "unavailable";
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
  terminal: Extract<FailureSummaryTerminal, "errored">,
): FactFailureCandidate | undefined {
  if (terminal === "errored" && fact.outcome === "errored") {
    return {
      sourceOrder: fact.sourceOrder,
      factId: fact.factId,
      title: fact.name,
      reason: fact.error.message,
    };
  }
  if (fact.outcome !== "unavailable") return undefined;
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

function compactFactSummary(summary: PrimaryFactSummary): string {
  const parts = [summary.title];
  if (summary.matcher !== undefined) parts.push(summary.matcher);
  if (summary.reason !== undefined) parts.push(`reason ${summary.reason}`);
  if (summary.additionalFailures > 0) parts.push(`+${summary.additionalFailures} more`);
  return parts.join(" · ");
}
