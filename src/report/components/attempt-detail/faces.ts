// Attempt 详情组件族的 text 面(docs/feature/reports/library/attempt-detail.md「在 show 与
// view 怎样渲染」):与 web 面共享同一次 resolve 产出的 data 事实(verdict、计数、能力位、
// 引用),允许把大块内容折成摘要 + 专用证据命令,但不得改变判定、计数或引用。
// 零 react、零 IO、纯同步——text 宿主不需要 react-dom 的那一半。

import type {
  AttemptAssertionsData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptSourceData,
  AttemptSummaryData,
  AttemptTimelineData,
  AttemptTraceData,
  AttemptUsageData,
} from "../../model/types.ts";
import type { AssertionResult, TimingNode } from "../../../types.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import type { TextContext } from "../../definition/tree.ts";
import { localeText } from "../../model/locale.ts";
import { formatDurationMs, formatMetricValue, formatReportDateTime, formatUSD, verdictMark } from "../../model/format.ts";
import { TIMELINE_CLOSING_PHASES } from "./compute.ts";
import { summaryText } from "../../../scoring/display.ts";

/**
 * 证据切面下钻命令:`ctx.attemptCommand` 由宿主按当前 report 是否有 attempt-input page
 * 注入(见 report.ts DEFAULT_ATTEMPT_COMMAND);没有时不生成假命令,调用方直接省略这一段
 * (与 traceWaterfallText 同一套退化规则,architecture.md「Attempt 详情是一张参数化 page」)。
 */
function evidenceCommand(ctx: TextContext, locator: AttemptLocator, flag: string): string | undefined {
  return ctx.attemptCommand ? `${ctx.attemptCommand(locator)} ${flag}` : undefined;
}

// ───────────────────────── AttemptSummary ─────────────────────────

export function attemptSummaryText(data: AttemptSummaryData, ctx: TextContext): string {
  const locale = ctx.locale;
  const parts = [
    data.locator,
    data.identity.evalId,
    data.identity.experimentId,
    localeText(locale, "attemptSummary.attempt", { n: data.identity.attempt + 1 }),
    `${verdictMark(data.verdict)} ${localeText(locale, `verdict.${data.verdict}`)}`,
  ];
  if (data.startedAt !== undefined) parts.push(formatReportDateTime(data.startedAt, locale));
  parts.push(formatDurationMs(data.durationMs));
  if (data.costUSD !== null) parts.push(formatUSD(data.costUSD));
  return parts.join(" · ");
}

// ───────────────────────── AttemptError ─────────────────────────

export function attemptErrorText(data: AttemptErrorData | null, _ctx: TextContext): string {
  if (data === null) return "";
  // message/cause 折单行加上限(同 assertionLine 的 summaryText 规则);stack 是唯一没有替代
  // 查看入口的自由文本,原样保留多行,不折。
  const lines = [`error: ${data.code}`, `  phase: ${data.phase}`, `  message: ${summaryText(data.message)}`];
  if (data.cause) {
    const causeMessage = summaryText(data.cause.message);
    lines.push(`  cause: ${data.cause.name ? `${data.cause.name} · ${causeMessage}` : causeMessage}`);
  }
  const stack = data.stack?.replace(/\n+$/, "");
  return stack ? `${lines.join("\n")}\n\n${stack}` : lines.join("\n");
}

// ───────────────────────── AttemptAssertions ─────────────────────────

/** `loc` 是断言在 eval 源码里的调用点,独立于整份源码是否被捕获(`AttemptSource` 的能力位);
 *  失败断言只要带 loc 就给可复制定位的源码锚,不必等 AttemptSource 可用才显示。 */
function locAnchor(loc: { file: string; line: number; column?: number }): string {
  return `${loc.file}:${loc.line}${loc.column ? `:${loc.column}` : ""}`;
}

function assertionLine(a: AssertionResult): string {
  const group = a.groupPath && a.groupPath.length > 0 ? `${a.groupPath.join(" > ")} · ` : "";
  if (a.outcome === "unavailable") return `◌ unavailable · ${group}${a.name} — ${a.reason}`;
  const mark = a.outcome === "passed" ? "✓" : "✗";
  const detail = a.detail && a.detail !== a.name ? `: ${a.detail}` : "";
  // expected/received 折单行 + 加字符上限(与 scoring 摘要面同一条 summaryText 规则):
  // received 常常就是被检查的整份文本(如 includes() 对全文匹配),不收口会把整份源码/工具
  // 输出灌进这一行;完整值仍在 web 面(可展开的完整结构化细节)与 --source 里原样可查。
  const evidence = [
    a.expected !== undefined ? `expected: ${summaryText(a.expected)}` : undefined,
    a.received !== undefined ? `received: ${summaryText(a.received)}` : undefined,
    a.outcome === "failed" && a.loc ? `source: ${locAnchor(a.loc)}` : undefined,
  ].filter((part): part is string => part !== undefined);
  const evidenceSuffix = evidence.length > 0 ? ` · ${evidence.join(" · ")}` : "";
  return `${mark} ${a.severity} · ${group}${a.name}${detail}${evidenceSuffix}`;
}

export function attemptAssertionsText(data: AttemptAssertionsData | null, _ctx: TextContext): string {
  if (data === null) return "";
  const lines = data.attention.map(assertionLine);
  for (const { group, items } of data.passedGroups) {
    lines.push(`✓ passed · ${group || "(ungrouped)"} · ${items.length}`);
  }
  return lines.join("\n");
}

// ───────────────────────── AttemptSource ─────────────────────────

export function attemptSourceText(data: AttemptSourceData | null, ctx: TextContext): string {
  if (data === null) return "";
  const command = evidenceCommand(ctx, data.locator, "--source");
  const headerParts = [`${data.sourcePath} · ${data.summary.annotatedLines}/${data.summary.totalLines} lines annotated`];
  if (command) headerParts.push(command);
  const hasConversation = data.unlocatedTurns.length > 0 || data.lines.some((line) => line.turns.length > 0);
  const executionCommand = hasConversation ? evidenceCommand(ctx, data.locator, "--execution") : null;
  if (executionCommand) headerParts.push(executionCommand);
  // 源码锚由 assertionLine 自己按 a.loc 拼(与 AttemptAssertions 共用同一份逻辑);这里只负责
  // 挑出非 passed 的条目,不重复算锚点。
  const failed = data.lines.flatMap((line) => line.assertions.filter((a) => a.outcome !== "passed"));
  const lines = failed.map((a) => `  ${assertionLine(a)}`);
  return [headerParts.join(" · "), ...lines].join("\n");
}

// ───────────────────────── AttemptFixPrompt ─────────────────────────

/** text 面零输出:终端已有 attemptSummaryText 里的 locator,直接跑 `niceeval show @<locator>` 即可;这里不重复整段 prompt。 */
export function attemptFixPromptText(_data: AttemptFixPromptData | null, _ctx: TextContext): string {
  return "";
}

// ───────────────────────── AttemptTimeline ─────────────────────────

function fmtMs(ms: number): string {
  if (ms >= 60_000) return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function countTimingNodes(nodes: readonly TimingNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countTimingNodes(n.children ?? []), 0);
}

export function attemptTimelineText(data: AttemptTimelineData | null, ctx: TextContext): string {
  if (data === null) return "";
  const main = data.phases.filter((p) => !TIMELINE_CLOSING_PHASES.has(p.name));
  const closing = data.phases.filter((p) => TIMELINE_CLOSING_PHASES.has(p.name));
  const total = main.reduce((sum, p) => sum + p.durationMs, 0);
  const anyFailed = data.phases.some((p) => p.failed);
  const command = evidenceCommand(ctx, data.locator, "--timing");
  const head = [`timing: ${fmtMs(total)}${anyFailed ? " ✗" : ""}`];
  if (command) head.push(command);
  const lines = [head.join(" · ")];
  for (const p of main) {
    const kids = p.children ?? [];
    const suffix = kids.length > 0 ? ` (${countTimingNodes(kids)} children collapsed)` : "";
    lines.push(`  ${p.failed ? "✗" : "·"} ${p.name} ${fmtMs(p.durationMs)}${suffix}`);
  }
  if (closing.length > 0) {
    lines.push("  teardown:");
    for (const p of closing) lines.push(`    ${p.failed ? "✗" : "·"} ${p.name} ${fmtMs(p.durationMs)}`);
  }
  return lines.join("\n");
}

// ───────────────────────── AttemptConversation ─────────────────────────

// 每条回复的自由文本(消息正文、发起请求的 prompt、未识别事件的原始 payload)都可能是任意大小的
// 块——system prompt、完整工具输出等——同一条 summaryText 规则折单行加上限;完整内容仍在
// --execution 里原样可查。
function replySummary(reply: AttemptConversationReply): string {
  switch (reply.kind) {
    case "assistant":
      return `assistant: ${summaryText(reply.text)}`;
    case "user":
      return `user: ${summaryText(reply.text)}`;
    case "thinking":
      return `thinking: ${summaryText(reply.text)}`;
    case "error":
      return `error: ${summaryText(reply.text)}`;
    case "tool":
      return `tool ${reply.name}${reply.status ? ` (${reply.status})` : ""}`;
    case "skill":
      return `skill loaded: ${reply.skill}`;
    case "subagent":
      return `subagent ${reply.name}${reply.status ? ` (${reply.status})` : ""}`;
    case "input":
      return `input requested${reply.request.prompt ? `: ${summaryText(reply.request.prompt)}` : ""}`;
    case "compaction":
      return `compaction${reply.reason ? `: ${summaryText(reply.reason)}` : ""}`;
    case "raw":
      return `unrecognized event: ${summaryText(JSON.stringify(reply.raw))}`;
  }
}

export function attemptConversationText(data: AttemptConversationData | null, ctx: TextContext): string {
  if (data === null) return "";
  const command = evidenceCommand(ctx, data.locator, "--execution");
  const head = [`conversation: ${data.rounds.length} round${data.rounds.length === 1 ? "" : "s"}`];
  if (command) head.push(command);
  const lines = [head.join(" · ")];
  data.rounds.forEach((round, i) => {
    lines.push(`  round ${i + 1}${round.sentText ? `: ${summaryText(round.sentText)}` : ""}`);
    for (const reply of round.replies) lines.push(`    ${replySummary(reply)}`);
  });
  return lines.join("\n");
}

// ───────────────────────── AttemptDiagnostics ─────────────────────────

export function attemptDiagnosticsText(data: AttemptDiagnosticsData | null, _ctx: TextContext): string {
  if (data === null) return "";
  const lines: string[] = [];
  for (const { phase, items } of data.groups) {
    lines.push(`${phase}:`);
    for (const d of items) {
      const count = d.count && d.count > 1 ? ` (${d.count} occurrences)` : "";
      lines.push(`  ${d.level} · ${d.code} — ${summaryText(d.message)}${count}`);
    }
  }
  return lines.join("\n");
}

// ───────────────────────── AttemptUsage ─────────────────────────

export function attemptUsageText(data: AttemptUsageData | null, _ctx: TextContext): string {
  if (data === null) return "";
  const { usage } = data;
  const total = usage.inputTokens + usage.outputTokens;
  const parts = [`usage: ${formatMetricValue(total)} tokens (${formatMetricValue(usage.inputTokens)} in / ${formatMetricValue(usage.outputTokens)} out)`];
  if (usage.cacheReadTokens !== undefined) parts.push(`cache read ${formatMetricValue(usage.cacheReadTokens)}`);
  if (usage.cacheWriteTokens !== undefined) parts.push(`cache write ${formatMetricValue(usage.cacheWriteTokens)}`);
  if (usage.requests !== undefined) parts.push(`${usage.requests} requests`);
  if (data.costUSD !== null) parts.push(formatUSD(data.costUSD));
  return parts.join(" · ");
}

// ───────────────────────── AttemptTrace ─────────────────────────

export function attemptTraceText(data: AttemptTraceData | null, ctx: TextContext): string {
  if (data === null) return "";
  const command = evidenceCommand(ctx, data.locator, "--timing");
  const head = [`trace: ${data.spans.length} span${data.spans.length === 1 ? "" : "s"}`];
  if (command) head.push(command);
  return head.join(" · ");
}

// ───────────────────────── AttemptDiff ─────────────────────────

function netLetter(net: "added" | "modified" | "deleted"): string {
  return net === "added" ? "A" : net === "deleted" ? "D" : "M";
}

export function attemptDiffText(data: AttemptDiffData | null, ctx: TextContext): string {
  if (data === null) return "";
  const command = evidenceCommand(ctx, data.locator, "--diff");
  const head = [`changes: ${data.files.length} file${data.files.length === 1 ? "" : "s"} changed by agent`];
  if (command) head.push(command);
  const lines = [head.join(" · ")];
  for (const f of data.files) {
    const delta = f.binary ? "binary" : `+${f.lines.added}/-${f.lines.deleted}`;
    lines.push(`  ${netLetter(f.net)} ${f.path} (${delta})`);
  }
  return lines.join("\n");
}
