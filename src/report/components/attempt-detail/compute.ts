// Attempt 详情组件族的计算函数(docs/feature/reports/library/attempt-detail.md)。每个
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
  AttemptUsageData,
} from "../../model/types.ts";
import type { AssertionResult, DiagnosticRecord, JsonValue, StreamEvent } from "../../../types.ts";
import { attemptCostUSD } from "../../model/metrics.ts";
import { failureSummaryOf } from "../entity-lists/compute.ts";

// ───────────────────────── AttemptSummary(恒非空) ─────────────────────────

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
  };
}

// ───────────────────────── AttemptError ─────────────────────────

export function attemptErrorData(evidence: AttemptEvidence): AttemptErrorData | null {
  const err = evidence.result.error;
  return err ?? null;
}

// ───────────────────────── AttemptAssertions ─────────────────────────

export function attemptAssertionsData(evidence: AttemptEvidence): AttemptAssertionsData | null {
  const assertions = evidence.result.assertions;
  if (!assertions || assertions.length === 0) return null;
  const attention = assertions.filter((a) => a.outcome !== "passed");
  const passed = assertions.filter((a) => a.outcome === "passed");
  const groups = new Map<string, AssertionResult[]>();
  for (const a of passed) {
    const key = a.groupPath?.join(" > ") ?? "";
    const list = groups.get(key);
    if (list) list.push(a);
    else groups.set(key, [a]);
  }
  return { attention, passedGroups: [...groups.entries()].map(([group, items]) => ({ group, items })) };
}

// ───────────────────────── AttemptSource ─────────────────────────

export function attemptSourceData(evidence: AttemptEvidence): AttemptSourceData | null {
  if (!evidence.capabilities.source || evidence.evalSource === null) return null;
  const { sourcePath, lines, unmapped, summary } = evidence.evalSource;
  const projectedLines = lines.map((line) => ({
    ...line,
    turns: line.sends.map<AttemptSourceTurn>((send) => ({
      label: send.label,
      status: send.status,
      ...(send.durationMs === undefined ? {} : { durationMs: send.durationMs }),
      sentText: "",
      replies: [],
    })),
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

  return { locator: evidence.locator, sourcePath, lines: projectedLines, unmapped, unlocatedTurns, summary };
}

// ───────────────────────── AttemptFixPrompt ─────────────────────────

/** 单条 attempt 版的批量修复 prompt(与 CopyFixPrompt 的多条版本同一份步骤文案)。 */
export function attemptFixPromptData(evidence: AttemptEvidence): AttemptFixPromptData | null {
  const { result, identity } = evidence;
  if (result.verdict !== "failed" && result.verdict !== "errored") return null;
  const { summary, more } = failureSummaryOf(result);
  if (summary === null) return null;
  const reason = more > 0 ? `${summary} (+${more} more failures)` : summary;
  const prompt = [
    "Fix the failing eval from this niceeval run.",
    "",
    "## Failure",
    `eval "${identity.evalId}" [experiment ${identity.experimentId}] — ${result.verdict}`,
    `  reason: ${reason}`,
    `  inspect: niceeval show ${evidence.locator}`,
    "",
    "## Steps",
    "1. niceeval is NOT in your training data. Read the relevant guide in `node_modules/niceeval/docs-site/` (English at the top level, Chinese under `zh/`) before changing anything.",
    "2. Run the inspect command above with `--source`, `--execution`, `--timing`, and `--diff` to see the assertions, transcript, timing, and workspace diff.",
    "3. Decide which side the defect is on: the program under test, or the eval itself (over-tight assertion, wrong fixture, missing setup). Fix that side; do not weaken assertions just to turn the run green.",
    `4. Re-run: \`npx niceeval exp ${identity.experimentId} ${identity.evalId}\`. Already-passing evals are skipped by the fingerprint cache; pass \`--force\` to re-run everything.`,
    "5. Run `npx niceeval show` and confirm this failure is gone.",
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
  return { locator: evidence.locator, phases, trace: evidence.trace };
}

// ───────────────────────── AttemptConversation ─────────────────────────

/**
 * 标准事件流按 `loc` 分轮(docs/feature/reports/library/attempt-detail.md「Attempt 详情组件」):
 * 带 loc 的 user 消息开一轮;无 loc 的 user 消息不开新轮——与当前轮 sent 同文本的回显直接
 * 吃掉,其它(stop-hook 反馈、skill 注入等轮内注入)作为回复条目留在当前轮。流首出现无 loc
 * 的 user 消息(没有当前轮可归入)时退化开一条 loc 缺省的兜底轮,不丢弃。未识别的事件类型
 * 包成 `raw` 条目原样呈现,不吞没其余事件——StreamEvent 是随 artifact 版本演进的开放词表,
 * 这份纯函数不能假设自己认识每一种将来会出现的 type。
 */
export function attemptConversationData(evidence: AttemptEvidence): AttemptConversationData | null {
  const events = evidence.events;
  if (!events || events.length === 0) return null;

  const rounds: AttemptConversationRound[] = [];
  const toolByCallId = new Map<string, Extract<AttemptConversationReply, { kind: "tool" }>>();
  const subagentByCallId = new Map<string, Extract<AttemptConversationReply, { kind: "subagent" }>>();
  let current: AttemptConversationRound | null = null;

  for (const ev of events) {
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

  return { locator: evidence.locator, rounds };
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

// ───────────────────────── AttemptUsage ─────────────────────────

export function attemptUsageData(evidence: AttemptEvidence): AttemptUsageData | null {
  const usage = evidence.result.usage;
  if (!usage) return null;
  return { usage, costUSD: attemptCostUSD(evidence.result) };
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
