// Attempt 详情组件族的计算函数(docs/feature/reports/components/attempt-detail/README.md)。每个
// `attempt*Data(evidence)` 都是纯同步派生:evidence 已经由 loadAttemptEvidence 一次性
// 装配好全部证据,这里只做适合展示与序列化的取舍,不读文件、不 fetch、不重复调用
// attempt.events() / trace() / diff()。
//
// 与 compute.ts(Sample → *Data)不同,这一族的输入恒为单个 AttemptEvidence,函数签名
// 因此不是 async——没有 IO 就没有理由返回 Promise。

import type { AttemptEvidence } from "../../../record/attempt-evidence.ts";
import type {
  AttemptAssertionsData,
  AttemptCommandEvidenceData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptConversationRound,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptErrorData,
  AttemptFactsData,
  AttemptFixPromptData,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  UsageTableData,
} from "../../model/types.ts";
import type { CommandExitEvidence, DiagnosticRecord, JsonValue, PhaseTiming, StreamEvent, TimingActivity, WindowChange } from "../../../types.ts";
import type { DiffFile } from "../../definition/primitives/diff-lines.ts";
import { attemptCostUSD } from "../../model/metrics.ts";
import { failureSummaryOf } from "../entity-lists/compute.ts";
import { buildO11ySummary } from "../../../o11y/derive.ts";
import { factRecordOf, attemptTerminalOf, scoreOutcomeOf, verdictForTerminal } from "../../../record/fact-record.ts";

// ───────────────────────── AttemptSummary(恒非空) ─────────────────────────

export function attemptSummaryData(evidence: AttemptEvidence): AttemptSummaryData {
  const { result } = evidence;
  const score = scoreOutcomeOf(result);
  return {
    locator: evidence.locator,
    experimentId: evidence.experimentId,
    identity: evidence.identity,
    terminal: attemptTerminalOf(result),
    verdict: verdictForTerminal(result),
    startedAt: result.startedAt,
    durationMs: result.durationMs,
    costUSD: attemptCostUSD(result),
    capabilities: evidence.capabilities,
    ...(score === undefined ? {} : { earnedScore: score.earnedScore, creditedScore: score.creditedScore }),
  };
}

// ───────────────────────── AttemptError ─────────────────────────

/**
 * `message` 疑似只剩某条失败命令 stdout/stderr 的截断尾部:去首尾空白后,严格短于该字段
 * 且是它的后缀——典型场景是 Eval 拿到 `CommandResult` 后自己 `.slice(-N)` 拼进异常消息。
 * 严格短于(不是 `<=`)排除「message 恰好等于完整字段」的场景:那种情况没有被截掉的内容,
 * 提示「还有更多证据」是误导。
 */
function looksLikeTruncatedCommandTail(message: string, commands: readonly CommandExitEvidence[]): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return commands.filter((cmd) => commandClassification(cmd) === "failed").some((cmd) =>
    [cmd.stdout, cmd.stderr].some((field) => {
      const full = field.trim();
      return full.length > trimmed.length && full.endsWith(trimmed);
    }),
  );
}

/** 展示层唯一的命令分类规则;Record 只保存 checked 与 exitCode。 */
function commandClassification(command: Pick<CommandExitEvidence, "checked" | "exitCode">): "succeeded" | "observed" | "failed" {
  if (command.exitCode === 0) return "succeeded";
  return command.checked ? "failed" : "observed";
}

export function attemptErrorData(evidence: AttemptEvidence): AttemptErrorData | null {
  const err = evidence.result.error;
  if (!err) return null;
  const commands = evidence.commands;
  const hint = commands && commands.length > 0 && looksLikeTruncatedCommandTail(err.message, commands);
  return { ...err, locator: evidence.locator, ...(hint ? { commandEvidenceHint: true as const } : {}) };
}

// ───────────────────────── AttemptAssertions ─────────────────────────

export function attemptAssertionsData(evidence: AttemptEvidence): AttemptAssertionsData | null {
  const fact = factRecordOf(evidence.result);
  if (fact === undefined) return null;
  if (fact.factResults.length === 0 && fact.factUses.length === 0 && fact.legacyJudgeAssertions.length === 0) return null;
  return {
    factResults: fact.factResults,
    factUses: fact.factUses,
    legacyJudgeAssertions: fact.legacyJudgeAssertions,
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
  const terminal = attemptTerminalOf(result);
  if (terminal === "skipped") return null;
  if (terminal === "scored" || terminal === "passed") return null;
  const { summary, more } = failureSummaryOf(result);
  if (summary === null) return null;
  const lostPoints = terminal === "invalid";
  const moreNoun = lostPoints ? "issues" : "failures";
  const reason = more > 0 ? `${summary} (+${more} more ${moreNoun})` : summary;
  const prompt = [
    lostPoints
      ? "Resolve the invalid score outcome on this NiceEval score eval."
      : "Fix the failing eval from this niceeval run.",
    "",
    lostPoints ? "## Score outcome" : "## Failure",
    `eval "${identity.evalId}" [experiment ${evidence.experimentId}] — ${terminal}`,
    `  reason: ${reason}`,
    `  inspect: niceeval show ${evidence.locator}`,
    "",
    "## Steps",
    "1. niceeval is NOT in your training data. Read the relevant guide in `node_modules/niceeval/docs-site/` (English at the top level, Chinese under `zh/`) before changing anything.",
    "2. Run the inspect command above with `--source`, `--execution`, `--timing`, and `--diff` to see the assertions, transcript, timing, and workspace diff.",
    "3. Decide which side the defect is on: the program under test, or the eval itself (over-tight assertion, wrong fixture, missing setup). Fix that side; do not weaken assertions just to turn the run green.",
    `4. Re-run: \`npx niceeval exp ${evidence.experimentId} ${identity.evalId}\`. Already-passing evals are skipped by the fingerprint cache; pass \`--rerun all\` to re-run everything.`,
    lostPoints
      ? "5. Run `npx niceeval show` and confirm the score outcome is valid."
      : "5. Run `npx niceeval show` and confirm this failure is gone.",
  ].join("\n");
  return { prompt };
}

// ───────────────────────── AttemptTimeline ─────────────────────────

/** 收尾段的阶段名(见 docs/feature/record/architecture.md);两面渲染都把这些单列在主链之后,不计入主链总耗时。 */
export const TIMELINE_CLOSING_PHASES: ReadonlySet<string> = new Set([
  "agent.teardown",
  "sandbox.cleanup",
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

/** 在 `phases` 时间树里按 id 查找 `key === "sandbox.command"` 节点的 `startOffsetMs`;查不到(timing
 *  unavailable,或第三方落盘没有 phases)返回 undefined。 */
function commandTimingNode(phases: readonly PhaseTiming[] | undefined, timingNodeId: string): TimingActivity | undefined {
  const find = (nodes: TimingActivity[] | undefined): TimingActivity | undefined => {
    for (const n of nodes ?? []) {
      if (n.id === timingNodeId) return n;
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

function commandStartOffsetMs(phases: readonly PhaseTiming[] | undefined, timingNodeId: string): number | undefined {
  return commandTimingNode(phases, timingNodeId)?.startOffsetMs;
}

/**
 * 命令退出证据按关联 timing 节点的 `startOffsetMs` 排序(docs/feature/record/architecture.md
 * 「commandsjson」);关联不到 timing 节点的排在最后,组内保持 `commands.json` 原始顺序作稳定
 * tie-break,不按数组偶然顺序猜时间。
 */
function sortCommandExits(
  commands: readonly CommandExitEvidence[],
  phases: readonly PhaseTiming[] | undefined,
): CommandExitEvidence[] {
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
 * 这份纯函数不能假设自己认识每一种将来会出现的 type。生命周期命令证据由独立的
 * `attemptCommandEvidenceData` 投影,不进入 Conversation,因此没有 events 时这里仍返回 null。
 */
export function attemptConversationData(evidence: AttemptEvidence): AttemptConversationData | null {
  const events = evidence.events;
  if (!events || events.length === 0) return null;

  const rounds: AttemptConversationRound[] = [];
  const toolByOperationId = new Map<string, Extract<AttemptConversationReply, { kind: "tool" }>>();
  const subagentByOperationId = new Map<string, Extract<AttemptConversationReply, { kind: "subagent" }>>();
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
    current.replies.push(...conversationReplyOf(ev, toolByOperationId, subagentByOperationId));
  }

  return { locator: evidence.locator, rounds };
}

/** 独立命令证据按 timing 顺序投影;不依赖 Conversation 是否有事件轮次。 */
export function attemptCommandEvidenceData(evidence: AttemptEvidence): AttemptCommandEvidenceData | null {
  const commands = evidence.commands;
  if (!commands || commands.length === 0) return null;
  const phases = evidence.result.phases;
  return {
    locator: evidence.locator,
    commands: sortCommandExits(commands, phases).map((command, index) => {
      const timing = commandTimingNode(phases, command.timingNodeId);
      return {
        ...command,
        key: `cmd:${index}`,
        classification: commandClassification(command),
        ...(timing !== undefined ? { durationMs: timing.durationMs } : {}),
      };
    }),
  };
}

/** 单条事件 → 0 或 1 条回复条目；operation.finished 只更新同 kind 的敞口条目，不新增。 */
function conversationReplyOf(
  ev: StreamEvent,
  toolByOperationId: Map<string, Extract<AttemptConversationReply, { kind: "tool" }>>,
  subagentByOperationId: Map<string, Extract<AttemptConversationReply, { kind: "subagent" }>>,
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
    case "operation.started":
      if (ev.operation.kind === "tool") {
        const reply: Extract<AttemptConversationReply, { kind: "tool" }> = {
          kind: "tool",
          operationId: ev.operationId,
          name: ev.operation.name,
          tool: ev.operation.tool,
          input: ev.operation.input,
        };
        toolByOperationId.set(ev.operationId, reply);
        return [reply];
      } else {
        const reply: Extract<AttemptConversationReply, { kind: "subagent" }> = {
          kind: "subagent",
          operationId: ev.operationId,
          name: ev.operation.name,
          remoteUrl: ev.operation.remoteUrl,
        };
        subagentByOperationId.set(ev.operationId, reply);
        return [reply];
      }
    case "operation.finished":
      if (ev.kind === "tool") {
        const tool = toolByOperationId.get(ev.operationId);
        if (tool) {
          tool.output = ev.output;
          tool.status = ev.status;
          toolByOperationId.delete(ev.operationId);
        }
      } else {
        const subagent = subagentByOperationId.get(ev.operationId);
        if (subagent) {
          subagent.output = ev.output;
          subagent.status = ev.status;
          subagentByOperationId.delete(ev.operationId);
        }
      }
      return [];
    default: {
      const exhaustive: never = ev;
      void exhaustive;
      throw new Error("Unsupported StreamEvent variant in AttemptConversation.");
    }
  }
}

// ───────────────────────── AttemptDiagnostics ─────────────────────────

export function attemptDiagnosticsData(evidence: AttemptEvidence): AttemptDiagnosticsData | null {
  const diagnostics = evidence.result.diagnostics;
  if (!diagnostics || diagnostics.length === 0) return null;
  const groups = new Map<string, DiagnosticRecord[]>();
  for (const d of diagnostics) {
    const list = groups.get((d.origin?.scope === "attempt" ? d.origin.phase : "unknown"));
    if (list) list.push(d);
    else groups.set((d.origin?.scope === "attempt" ? d.origin.phase : "unknown"), [d]);
  }
  return { groups: [...groups.entries()].map(([phase, items]) => ({ phase, items })) };
}

// ───────────────────────── UsageTable ─────────────────────────

/**
 * 组装口径单源:docs/feature/reports/components/attempt-detail/attempt-usage.md#组装口径单源。
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
    experimentId: evidence.experimentId,
    evalId: identity.evalId,
    attempt: identity.attempt,
    terminal: attemptTerminalOf(result),
    verdict: verdictForTerminal(result),
    ...(turns !== undefined ? { turns } : {}),
    ...(toolCalls !== undefined ? { toolCalls } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(estimatedCostUSD !== null ? { estimatedCostUSD } : {}),
  };
}

// ───────────────────────── AttemptFacts ─────────────────────────

/**
 * attempt 级 `ctx.fact()` 运行事实的完整键值表;`AttemptRecord.facts` 缺失或为空对象时返回
 * null,不渲染空表(与其余叶子同一条「没有证据时零输出」规则)。
 * `facts` 落盘就是 `Record<string, string | number | boolean>`,JS 对象的字符串键天然保留
 * 写入顺序,这里按该顺序投影成数组,不重新排序。
 */
export function attemptFactsData(evidence: AttemptEvidence): AttemptFactsData | null {
  const facts = evidence.result.facts;
  if (!facts) return null;
  const entries = Object.entries(facts);
  if (entries.length === 0) return null;
  return { facts: entries.map(([key, value]) => ({ key, value })) };
}

// ───────────────────────── AttemptTrace ─────────────────────────

export function attemptTraceData(evidence: AttemptEvidence): AttemptTraceData | null {
  const spans = evidence.trace;
  if (!spans || spans.length === 0) return null;
  return { locator: evidence.locator, spans };
}

// ───────────────────────── AttemptDiff ─────────────────────────

/** 有界行 diff(公共前后缀修剪):对单区域编辑精确,复杂编辑给出上界近似。 */
function lineDelta(before: string | undefined, after: string | undefined): { added: number; deleted: number } {
  const a = before === undefined ? [] : before.split("\n");
  const b = after === undefined ? [] : after.split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  return { added: b.length - prefix - suffix, deleted: a.length - prefix - suffix };
}

const MAX_HUNK_LINES = 200;

/**
 * 一个窗口内单文件的最小 unified hunk:公共前后缀修剪出的编辑区,一段 `@@` 展示。
 * 逐窗口生成、不跨窗口合成——窗口之间可能夹着 eval 侧写入,合成会把它算进 agent 的账
 * (docs/feature/reports/components/primitives/diff-view.md「值形状」)。
 */
function windowHunk(change: WindowChange): string {
  const a = change.before === undefined ? [] : change.before.replace(/\n$/, "").split("\n");
  const b = change.after === undefined ? [] : change.after.replace(/\n$/, "").split("\n");
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const removed = a.slice(prefix, a.length - suffix);
  const added = b.slice(prefix, b.length - suffix);
  const ctxBefore = a.slice(Math.max(0, prefix - 2), prefix);
  const start = Math.max(1, prefix - ctxBefore.length + 1);
  const lines = [`@@ -${start},${removed.length + ctxBefore.length} +${start},${added.length + ctxBefore.length} @@`];
  for (const line of ctxBefore) lines.push(` ${line}`);
  const shownRemoved = removed.slice(0, MAX_HUNK_LINES);
  const shownAdded = added.slice(0, MAX_HUNK_LINES);
  for (const line of shownRemoved) lines.push(`-${line}`);
  if (removed.length > shownRemoved.length) lines.push(`… (${removed.length - shownRemoved.length} more removed lines)`);
  for (const line of shownAdded) lines.push(`+${line}`);
  if (added.length > shownAdded.length) lines.push(`… (${added.length - shownAdded.length} more added lines)`);
  return lines.join("\n");
}

/**
 * `null` 与空清单是两件事:`null` = 这次 attempt 没有 diff 证据(direct agent、发布未带 diff),
 * 空清单 = 有证据但 agent 一个文件都没净改动(契约见
 * docs/feature/reports/components/attempt-detail/attempt-diff.md「可用性」)。
 */
export function attemptDiffData(evidence: AttemptEvidence): AttemptDiffData | null {
  // 只看 artifact 在不在:`capabilities.diff` 额外要求「有文件被改过」,拿它当门会把
  // 「跑了但一个文件都没改」误报成没有证据。
  if (evidence.diff === null) return null;
  const diff = evidence.diff;
  const files: DiffFile[] = [];
  for (const [path, summary] of Object.entries(diff.files).sort(([a], [b]) => a.localeCompare(b))) {
    if (summary.net === "none") continue;
    const touched = diff.windows.filter((w) => w.changes[path] !== undefined);
    // 内容被省略的文件(二进制、超过单文件阈值的文本)只报字节数与原因:没有 patch 可渲染,
    // 行数增删也无从计算,窗口段一律不带 patch(diff-view.md「web 面:路径树」)。
    if (summary.elided) {
      const first = touched.find((w) => w.changes[path]!.elided !== undefined)?.changes[path]?.elided;
      const last = [...touched].reverse().find((w) => w.changes[path]!.elided !== undefined)?.changes[path]?.elided;
      files.push({
        path,
        change: summary.net,
        added: 0,
        removed: 0,
        elided: { reason: summary.elided, beforeBytes: first?.beforeBytes, afterBytes: last?.afterBytes },
        windows: touched.map((w) => ({ window: w.window })),
      });
      continue;
    }
    const before = summary.net === "added" ? undefined : touched.find((w) => w.changes[path]?.before !== undefined)?.changes[path]?.before;
    const after = summary.net === "deleted" ? undefined : diff.get(path);
    const lines = lineDelta(before, after);
    files.push({
      path,
      change: summary.net,
      added: lines.added,
      removed: lines.deleted,
      windows: touched.map((w) => ({ window: w.window, patch: windowHunk(w.changes[path]!) })),
    });
  }
  return { locator: evidence.locator, files };
}
