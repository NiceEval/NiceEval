// Attempt 详情组件族的计算函数(docs/feature/reports/components/attempt-detail/README.md)。每个
// `attempt*Data(evidence)` 都是纯同步派生:evidence 已经由 loadAttemptEvidence 一次性
// 装配好全部证据,这里只做适合展示与序列化的取舍,不读文件、不 fetch、不重复调用
// attempt.events() / trace() / diff()。
//
// 与 compute.ts(Scope → *Data)不同,这一族的输入恒为单个 AttemptEvidence,函数签名
// 因此不是 async——没有 IO 就没有理由返回 Promise。

import type { AttemptEvidence } from "../../../results/attempt-evidence.ts";
import type {
  AttemptAssertionsData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptConversationRound,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptDiffFileEntry,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptSourceData,
  AttemptSourceTurn,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  UsageTableData,
} from "../../model/types.ts";
import type { AssertionResult, DiagnosticRecord, EvalResult, FailedCommandEvidence, JsonValue, PhaseTiming, ScoreEntry, StreamEvent, TimingNode } from "../../../types.ts";
import { attemptCostUSD } from "../../model/metrics.ts";
import { failureSummaryOf } from "../entity-lists/compute.ts";
import { buildO11ySummary } from "../../../o11y/derive.ts";

// ───────────────────────── AttemptSummary(恒非空) ─────────────────────────

/**
 * 计分制 attempt 本轮挣分:`assertions[].points`(排除 unavailable)之和 + `scoreEntries[].points`
 * 之和——纯累加,与 model/metrics.ts 的 `totalScore` 指标同一条口径,但这里恒返回一个数字
 * (不为 errored/skipped 归 null):详情页总分位「不摆 null 占位」,只在通过制时整字段省略。
 */
function earnedPoints(result: EvalResult): number {
  let total = 0;
  for (const assertion of result.assertions) {
    if (assertion.outcome !== "unavailable" && typeof assertion.points === "number") total += assertion.points;
  }
  for (const entry of result.scoreEntries ?? []) total += entry.points;
  return total;
}

export function attemptSummaryData(evidence: AttemptEvidence): AttemptSummaryData {
  const { result } = evidence;
  return {
    locator: evidence.locator,
    identity: evidence.identity,
    verdict: result.verdict,
    startedAt: result.startedAt,
    durationMs: result.durationMs,
    costUSD: attemptCostUSD(result),
    capabilities: evidence.capabilities,
    // 题型判定读定义期 result.scoring,不从 assertions 是否带 points 推断。
    ...(result.scoring === "points" ? { totalScore: earnedPoints(result) } : {}),
  };
}

// ───────────────────────── AttemptError ─────────────────────────

/**
 * `message` 疑似只剩某条失败命令 stdout/stderr 的截断尾部:去首尾空白后,严格短于该字段
 * 且是它的后缀——典型场景是 Eval 拿到 `CommandResult` 后自己 `.slice(-N)` 拼进异常消息。
 * 严格短于(不是 `<=`)排除「message 恰好等于完整字段」的场景:那种情况没有被截掉的内容,
 * 提示「还有更多证据」是误导。
 */
function looksLikeTruncatedCommandTail(message: string, commands: readonly FailedCommandEvidence[]): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return commands.some((cmd) =>
    [cmd.stdout, cmd.stderr].some((field) => {
      const full = field.trim();
      return full.length > trimmed.length && full.endsWith(trimmed);
    }),
  );
}

export function attemptErrorData(evidence: AttemptEvidence): AttemptErrorData | null {
  const err = evidence.result.error;
  if (!err) return null;
  const commands = evidence.commands;
  const hint = commands && commands.length > 0 && looksLikeTruncatedCommandTail(err.message, commands);
  return { ...err, locator: evidence.locator, ...(hint ? { commandEvidenceHint: true as const } : {}) };
}

// ───────────────────────── AttemptAssertions ─────────────────────────

/** 按 `groupPath.join(" > ")` 分组(无分组归到空键 ""),组内保持传入顺序;passedGroups 与
 *  scoreEntries 共用同一套算法(docs/feature/scoring/library/display.md「计分制」)。 */
function groupByPath<T extends { groupPath?: string[] }>(items: readonly T[]): { group: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = item.groupPath?.join(" > ") ?? "";
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }
  return [...groups.entries()].map(([group, items]) => ({ group, items }));
}

/**
 * 得分点挣满计数("2/5 得分点挣满"):分母是全部带 `.points` 的断言(unavailable 结构上不携带
 * `points`,天然不计入);挣满 = `score === 1`——连续打分断言(如 judge)挣到 `n × 0.8` 时
 * `score` 恰是 0.8,不算挣满(docs/feature/scoring/library/display.md「计分制」)。
 */
function scorePointsEarnedOf(assertions: readonly AssertionResult[]): { earned: number; total: number } | undefined {
  const scorePoints = assertions.filter((a) => a.outcome !== "unavailable" && a.points !== undefined);
  if (scorePoints.length === 0) return undefined;
  const earned = scorePoints.filter((a) => a.outcome !== "unavailable" && a.score === 1).length;
  return { earned, total: scorePoints.length };
}

/**
 * 计分制前置中止的中止断言:`failed` 只有前置中止一个来源,中止点恒为记录顺序最后一条
 * `AssertionResult`(必为 failed gate)——从既有事实推导,不加落盘字段(见本 plan「实现判据」)。
 * 按引用标注(不是按行号):这条断言无论展示在哪个面(平铺列表、还是投影回某行源码)都是
 * 同一个对象,标注一次两处都认得出,循环产生的同行多条断言也不会被行级粒度混淆。
 */
function abortAssertionOf(result: EvalResult): AssertionResult | undefined {
  return result.scoring === "points" && result.verdict === "failed" && result.assertions.length > 0
    ? result.assertions[result.assertions.length - 1]
    : undefined;
}

/** 中止断言追加 `aborted` 标注(⤓ 前置未过,详情见 docs/feature/scoring/library/display.md「前置中止」);其余原样返回。 */
function markAborted<T extends AssertionResult>(items: readonly T[], abortAssertion: AssertionResult | undefined): (T & { aborted?: true })[] {
  if (abortAssertion === undefined) return items.slice();
  return items.map((a) => (a === abortAssertion ? { ...a, aborted: true as const } : a));
}

export function attemptAssertionsData(evidence: AttemptEvidence): AttemptAssertionsData | null {
  const { result } = evidence;
  const assertions = result.assertions ?? [];
  // t.score(label, n) 直接给分记录:与 assertions 分属两个数组,只在计分制 eval 上出现
  // (见 docs/feature/scoring/architecture.md「断言记录」)。
  const scoreEntries: readonly ScoreEntry[] = result.scoreEntries ?? [];
  if (assertions.length === 0 && scoreEntries.length === 0) return null;
  // 得分点(带 .points)豁免 passed 收纳:即使 passed 也进平铺列表,不折进 passedGroups 计数——
  // 收纳只作用于不带 .points 的观测断言(docs/feature/scoring/library/display.md「得分点不参与
  // passed 收纳」)。中止断言(若存在)恒是 failed,天然落在这个平铺列表里,不需要额外分支。
  const attentionBase = assertions.filter((a) => a.outcome !== "passed" || a.points !== undefined);
  const passed = assertions.filter((a) => a.outcome === "passed" && a.points === undefined);
  const scorePointsEarned = scorePointsEarnedOf(assertions);
  const attention = markAborted(attentionBase, abortAssertionOf(result));
  return {
    attention,
    passedGroups: groupByPath(passed),
    ...(scoreEntries.length > 0 ? { scoreEntries: groupByPath(scoreEntries) } : {}),
    ...(scorePointsEarned ? { scorePointsEarned } : {}),
  };
}

// ───────────────────────── AttemptSource ─────────────────────────

export function attemptSourceData(evidence: AttemptEvidence): AttemptSourceData | null {
  if (!evidence.capabilities.source || evidence.evalSource === null) return null;
  const { sourcePath, lines, unmapped, summary } = evidence.evalSource;
  const { result } = evidence;
  const scorePointsEarned = scorePointsEarnedOf(result.assertions);
  // 全通过折叠:同一份输入(result.assertions)、同一套算法(groupByPath)、同一条过滤规则
  // (得分点豁免 passed 收纳)——与 attemptAssertionsData 的 passedGroups 保持一致;`lines` 与
  // `unmapped` 是 result.assertions 的一个划分,这里不需要分别过滤两处再合并。
  const passedGroups = groupByPath(result.assertions.filter((a) => a.outcome === "passed" && a.points === undefined));

  // t.score(...) 给分记录按 loc 投影到源码行,原位标注给分;不在展示源码内的落
  // unmappedScoreEntries——与断言的 unmapped 桶同一条「不映射就进末尾分组」规则
  // (docs/feature/scoring/library/display.md「源码面同样承载给分证据」)。
  const scoreEntriesByLine = new Map<number, ScoreEntry[]>();
  const unmappedScoreEntries: ScoreEntry[] = [];
  for (const entry of result.scoreEntries ?? []) {
    const loc = entry.loc;
    if (loc && loc.file === sourcePath && loc.line >= 1 && loc.line <= lines.length) {
      const list = scoreEntriesByLine.get(loc.line);
      if (list) list.push(entry);
      else scoreEntriesByLine.set(loc.line, [entry]);
    } else {
      unmappedScoreEntries.push(entry);
    }
  }

  // 计分制前置中止:中止断言(若存在)按引用标注(与 attemptAssertionsData 同一份判据);中止点
  // 之后的源码行即未到达区。abortLoc 不在展示源码内时(未捕获或指向别的文件)不标注任何行——
  // 这条断言仍会出现在 attention/unmapped 里(带 aborted 标注),只是没有可锚定的行。
  const abortAssertion = abortAssertionOf(result);
  const abortLoc = abortAssertion?.loc;
  const abortLine =
    abortLoc && abortLoc.file === sourcePath && abortLoc.line >= 1 && abortLoc.line <= lines.length
      ? abortLoc.line
      : undefined;

  const projectedLines = lines.map((line) => ({
    ...line,
    assertions: markAborted(line.assertions, abortAssertion),
    turns: line.sends.map<AttemptSourceTurn>((send) => ({
      label: send.label,
      status: send.status,
      ...(send.durationMs === undefined ? {} : { durationMs: send.durationMs }),
      sentText: "",
      replies: [],
    })),
    scoreEntries: scoreEntriesByLine.get(line.line) ?? [],
    ...(abortLine === line.line ? { aborted: true as const } : {}),
    ...(abortLine !== undefined && line.line > abortLine ? { unreached: true as const } : {}),
  }));
  const usedTurns = new Map<number, number>();
  const unlocatedTurns: AttemptSourceTurn[] = [];
  const conversation = attemptConversationData(evidence);

  for (const [roundIndex, round] of (conversation?.rounds ?? []).entries()) {
    const status = round.replies.some(
      (reply) =>
        reply.kind === "error" ||
        ((reply.kind === "tool" || reply.kind === "subagent") && reply.status === "failed"),
    )
      ? "failed"
      : round.replies.some((reply) => reply.kind === "input")
        ? "waiting"
        : "completed";
    const fallback: AttemptSourceTurn = {
      label: `t${roundIndex + 1}`,
      status,
      sentText: round.sentText,
      replies: round.replies,
    };
    const loc = round.loc;
    if (!loc || loc.file !== sourcePath || loc.line < 1 || loc.line > projectedLines.length) {
      unlocatedTurns.push(fallback);
      continue;
    }

    const line = projectedLines[loc.line - 1]!;
    const turnIndex = usedTurns.get(loc.line) ?? 0;
    usedTurns.set(loc.line, turnIndex + 1);
    const annotated = line.turns[turnIndex];
    if (annotated) {
      annotated.sentText = round.sentText;
      annotated.replies = round.replies;
    } else {
      line.turns.push(fallback);
    }
  }

  return {
    locator: evidence.locator,
    sourcePath,
    lines: projectedLines,
    unmapped: markAborted(unmapped, abortAssertion),
    passedGroups,
    ...(unmappedScoreEntries.length > 0 ? { unmappedScoreEntries: groupByPath(unmappedScoreEntries) } : {}),
    unlocatedTurns,
    summary,
    // 源码不可用时换成 AttemptAssertions「规则完全一致」(docs/feature/reports/show/attempt.md):
    // 得分点挣满计数同一条判据,不因为有源码就换一套算法。
    ...(scorePointsEarned ? { scorePointsEarned } : {}),
  };
}

// ───────────────────────── AttemptFixPrompt ─────────────────────────

/**
 * 单条 attempt 版的批量修复 prompt(与 CopyFixPrompt 的多条版本同一份步骤文案)。三态
 * (docs/feature/reports/components/attempt-detail/README.md「`AttemptFixPrompt`」):计分制丢分或中止 →
 * 非 null(围绕丢分检查点组装);计分制挣满且未中止、或通过制 passed → null;skipped 恒 null。
 */
export function attemptFixPromptData(evidence: AttemptEvidence): AttemptFixPromptData | null {
  const { result, identity } = evidence;
  if (result.verdict === "skipped") return null;
  // 通过制(省略或 "pass")passed 恒 null;计分制 passed 是否可操作看下面的 failureSummaryOf——
  // 挣满(或没有得分点)时它同样返回 null summary,不需要在这里重复判断。
  if (result.verdict === "passed" && result.scoring !== "points") return null;
  const { summary, more } = failureSummaryOf(result);
  if (summary === null) return null;
  // 计分制 passed 但有丢分:可操作失败,但这条 attempt 并没有"失败"——措辞与真正的 failed/
  // errored 分开,不把丢分说成失败。
  const lostPoints = result.verdict === "passed";
  const moreNoun = lostPoints ? "lost points" : "failures";
  const reason = more > 0 ? `${summary} (+${more} more ${moreNoun})` : summary;
  const prompt = [
    lostPoints
      ? "Recover the lost points on this niceeval scoring eval."
      : "Fix the failing eval from this niceeval run.",
    "",
    lostPoints ? "## Lost points" : "## Failure",
    `eval "${identity.evalId}" [experiment ${identity.experimentId}] — ${result.verdict}`,
    `  reason: ${reason}`,
    `  inspect: niceeval show ${evidence.locator}`,
    "",
    "## Steps",
    "1. niceeval is NOT in your training data. Read the relevant guide in `node_modules/niceeval/docs-site/` (English at the top level, Chinese under `zh/`) before changing anything.",
    "2. Run the inspect command above with `--source`, `--execution`, `--timing`, and `--diff` to see the assertions, transcript, timing, and workspace diff.",
    "3. Decide which side the defect is on: the program under test, or the eval itself (over-tight assertion, wrong fixture, missing setup). Fix that side; do not weaken assertions just to turn the run green.",
    `4. Re-run: \`npx niceeval exp ${identity.experimentId} ${identity.evalId}\`. Already-passing evals are skipped by the fingerprint cache; pass \`--force\` to re-run everything.`,
    lostPoints
      ? "5. Run `npx niceeval show` and confirm the score improved."
      : "5. Run `npx niceeval show` and confirm this failure is gone.",
  ].join("\n");
  return { prompt };
}

// ───────────────────────── AttemptTimeline ─────────────────────────

/** 收尾段的阶段名(见 docs/feature/results/architecture.md);两面渲染都把这些单列在主链之后,不计入主链总耗时。 */
export const TIMELINE_CLOSING_PHASES: ReadonlySet<string> = new Set([
  "eval.teardown",
  "agent.teardown",
  "sandbox.teardown",
  "sandbox.suspend",
  "sandbox.stop",
]);

export function attemptTimelineData(evidence: AttemptEvidence): AttemptTimelineData | null {
  const phases = evidence.result.phases;
  if (!phases || phases.length === 0) return null;
  const timedOut = evidence.result.error?.code === "timeout";
  return { locator: evidence.locator, phases, trace: evidence.trace, ...(timedOut ? { timedOut: true as const } : {}) };
}

// ───────────────────────── AttemptConversation ─────────────────────────

/** 在 `phases` 时间树里按 id 查找 `kind === "command"` 节点的 `startOffsetMs`;查不到(timing
 *  unavailable,或第三方落盘没有 phases)返回 undefined。 */
function commandStartOffsetMs(phases: readonly PhaseTiming[] | undefined, timingNodeId: string): number | undefined {
  const find = (nodes: TimingNode[] | undefined): number | undefined => {
    for (const n of nodes ?? []) {
      if (n.id === timingNodeId) return n.startOffsetMs;
      const found = find(n.children);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  for (const p of phases ?? []) {
    const found = find(p.children);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 失败命令按关联 timing 节点的 `startOffsetMs` 排序(docs/feature/results/architecture.md
 * 「commandsjson」);关联不到 timing 节点的排在最后,组内保持 `commands.json` 原始顺序作稳定
 * tie-break,不按数组偶然顺序猜时间。
 */
function sortFailedCommands(
  commands: readonly FailedCommandEvidence[],
  phases: readonly PhaseTiming[] | undefined,
): FailedCommandEvidence[] {
  return commands
    .map((command, index) => ({ command, index, offset: commandStartOffsetMs(phases, command.timingNodeId) }))
    .sort((a, b) => (a.offset ?? Number.POSITIVE_INFINITY) - (b.offset ?? Number.POSITIVE_INFINITY) || a.index - b.index)
    .map((entry) => entry.command);
}

/**
 * 标准事件流按 `loc` 分轮(docs/feature/reports/components/attempt-detail/README.md「Attempt 详情组件」):
 * 带 loc 的 user 消息开一轮;无 loc 的 user 消息不开新轮——与当前轮 sent 同文本的回显直接
 * 吃掉,其它(stop-hook 反馈、skill 注入等轮内注入)作为回复条目留在当前轮。流首出现无 loc
 * 的 user 消息(没有当前轮可归入)时退化开一条 loc 缺省的兜底轮,不丢弃。未识别的事件类型
 * 包成 `raw` 条目原样呈现,不吞没其余事件——StreamEvent 是随 artifact 版本演进的开放词表,
 * 这份纯函数不能假设自己认识每一种将来会出现的 type。除标准事件流外还携带 `failedCommands`
 * (`commands.json` 的投影);没有 events 但有失败命令时仍非空——事件骨架与命令证据是两个
 * 独立的非空条件,任一非空这个组件就有内容可显示。
 */
export function attemptConversationData(evidence: AttemptEvidence): AttemptConversationData | null {
  const events = evidence.events;
  const failedCommands =
    evidence.commands && evidence.commands.length > 0 ? sortFailedCommands(evidence.commands, evidence.result.phases) : undefined;
  if ((!events || events.length === 0) && failedCommands === undefined) return null;

  const rounds: AttemptConversationRound[] = [];
  const toolByCallId = new Map<string, Extract<AttemptConversationReply, { kind: "tool" }>>();
  const subagentByCallId = new Map<string, Extract<AttemptConversationReply, { kind: "subagent" }>>();
  let current: AttemptConversationRound | null = null;

  for (const ev of events ?? []) {
    if (ev.type === "message" && ev.role === "user") {
      if (!ev.loc && current) {
        if (current.replies.length === 0 && (ev.text || "") === current.sentText) continue;
        current.replies.push({ kind: "user", text: ev.text || "" });
        continue;
      }
      current = { loc: ev.loc, sentText: ev.text || "", replies: [] };
      rounds.push(current);
      continue;
    }
    if (!current) {
      // 流首没有开轮的用户消息就先来了其它事件(旧 artifact 的边界情况):开一条无 loc 兜底轮。
      current = { sentText: "", replies: [] };
      rounds.push(current);
    }
    current.replies.push(...conversationReplyOf(ev, toolByCallId, subagentByCallId));
  }

  return { locator: evidence.locator, rounds, ...(failedCommands ? { failedCommands } : {}) };
}

/** 单条事件 → 0 或 1 条回复条目;action.result/subagent.completed 只更新已有条目,不新增。 */
function conversationReplyOf(
  ev: StreamEvent,
  toolByCallId: Map<string, Extract<AttemptConversationReply, { kind: "tool" }>>,
  subagentByCallId: Map<string, Extract<AttemptConversationReply, { kind: "subagent" }>>,
): AttemptConversationReply[] {
  switch (ev.type) {
    case "message":
      // role === "user" 已在主循环处理(开轮 / 回显吃掉 / 轮内注入),这里只剩 assistant。
      return [{ kind: "assistant", text: ev.text }];
    case "thinking":
      return [{ kind: "thinking", text: ev.text }];
    case "error":
      return [{ kind: "error", text: ev.message }];
    case "skill.loaded":
      return [{ kind: "skill", skill: ev.skill }];
    case "context.injected":
      return [{ kind: "context", text: ev.text, ...(ev.source !== undefined ? { source: ev.source } : {}) }];
    case "input.requested":
      return [{ kind: "input", request: ev.request }];
    case "compaction":
      return [{ kind: "compaction", reason: ev.reason }];
    case "action.called": {
      const reply: Extract<AttemptConversationReply, { kind: "tool" }> = {
        kind: "tool",
        callId: ev.callId,
        name: ev.name,
        tool: ev.tool,
        input: ev.input,
      };
      toolByCallId.set(ev.callId, reply);
      return [reply];
    }
    case "action.result": {
      const tool = toolByCallId.get(ev.callId);
      if (tool) {
        tool.output = ev.output;
        tool.status = ev.status;
      }
      return [];
    }
    case "subagent.called": {
      const reply: Extract<AttemptConversationReply, { kind: "subagent" }> = {
        kind: "subagent",
        callId: ev.callId,
        name: ev.name,
        remoteUrl: ev.remoteUrl,
      };
      subagentByCallId.set(ev.callId, reply);
      return [reply];
    }
    case "subagent.completed": {
      const subagent = subagentByCallId.get(ev.callId);
      if (subagent) {
        subagent.output = ev.output;
        subagent.status = ev.status;
      }
      return [];
    }
    default: {
      // 穷尽性检查在这里刻意不做:StreamEvent 是随 artifact 版本演进的开放词表,未识别的
      // 事件(将来的新 type,或第三方 harness 的自定义变体)包成 raw 原样呈现,不静默丢弃、
      // 也不因为一个不认识的条目让整个装配失败。
      return [{ kind: "raw", raw: ev as unknown as JsonValue }];
    }
  }
}

// ───────────────────────── AttemptDiagnostics ─────────────────────────

export function attemptDiagnosticsData(evidence: AttemptEvidence): AttemptDiagnosticsData | null {
  const diagnostics = evidence.result.diagnostics;
  if (!diagnostics || diagnostics.length === 0) return null;
  const groups = new Map<string, DiagnosticRecord[]>();
  for (const d of diagnostics) {
    const list = groups.get(d.phase);
    if (list) list.push(d);
    else groups.set(d.phase, [d]);
  }
  return { groups: [...groups.entries()].map(([phase, items]) => ({ phase, items })) };
}

// ───────────────────────── UsageTable ─────────────────────────

/**
 * 组装口径单源:docs/feature/reports/components/attempt-detail/usage-table.md#组装口径单源。
 * identity 字段(locator/experimentId/evalId/attempt/verdict)恒有;turns/toolCalls 是 events
 * 派生(与 o11y.json 行为摘要同源,buildO11ySummary 与 o11y.json 落盘走同一份纯函数),没有
 * events 就整对省略——不因为其中一个恰好是 0 就当作"缺失"处理,0 是观测到的事实。
 * token 桶恒互斥,inputTokens 本身就是未缓存输入,不派生第二个字段。
 * turns/toolCalls/usage 三者全部缺失时返回 null——
 * 没有任何用量事实可摆,与其余叶子同一条"没有 usage 时零输出"规则。
 */
export function usageTableData(evidence: AttemptEvidence): UsageTableData | null {
  const { result, identity } = evidence;
  const o11y = evidence.events ? buildO11ySummary(evidence.events) : null;
  const turns = o11y ? o11y.totalTurns : undefined;
  const toolCalls = o11y ? o11y.totalToolCalls : undefined;
  const usage = result.usage;
  if (turns === undefined && toolCalls === undefined && usage === undefined) return null;

  const estimatedCostUSD = attemptCostUSD(result);

  return {
    locator: evidence.locator,
    experimentId: identity.experimentId,
    evalId: identity.evalId,
    attempt: identity.attempt,
    verdict: result.verdict,
    ...(turns !== undefined ? { turns } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(estimatedCostUSD !== null ? { estimatedCostUSD } : {}),
  };
}

// ───────────────────────── AttemptTrace ─────────────────────────

export function attemptTraceData(evidence: AttemptEvidence): AttemptTraceData | null {
  const spans = evidence.trace;
  if (!spans || spans.length === 0) return null;
  return { locator: evidence.locator, spans };
}

// ───────────────────────── AttemptDiff ─────────────────────────

/** 有界行 diff(公共前后缀修剪):对单区域编辑精确,复杂编辑给出上界近似;与 `niceeval show --diff` 同一算法。 */
function lineDelta(before: string | undefined, after: string | undefined): { added: number; deleted: number } {
  const a = before === undefined ? [] : before.split("\n");
  const b = after === undefined ? [] : after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return { added: b.length - prefix - suffix, deleted: a.length - prefix - suffix };
}

export function attemptDiffData(evidence: AttemptEvidence): AttemptDiffData | null {
  if (!evidence.capabilities.diff || evidence.diff === null) return null;
  const diff = evidence.diff;
  const files: AttemptDiffFileEntry[] = [];
  for (const [path, summary] of Object.entries(diff.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (summary.net === "none") continue;
    const windows = diff.windows.filter((w) => w.changes[path] !== undefined).map((w) => w.window);
    if (summary.binary) {
      files.push({ path, net: summary.net, lines: { added: 0, deleted: 0 }, binary: true, windows });
      continue;
    }
    const before = summary.net === "added" ? undefined : diff.windows.find((w) => w.changes[path]?.before !== undefined)?.changes[path]?.before;
    const after = summary.net === "deleted" ? undefined : diff.get(path);
    files.push({ path, net: summary.net, lines: lineDelta(before, after), windows });
  }
  return files.length > 0 ? { locator: evidence.locator, files } : null;
}
