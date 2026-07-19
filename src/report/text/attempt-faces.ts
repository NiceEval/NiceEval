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
} from "../types.ts";
import type { AssertionResult, TimingNode } from "../../types.ts";
import type { TextContext } from "../tree.ts";
import { localeText } from "../locale.ts";
import { formatDurationMs, formatMetricValue, formatUSD, verdictMark } from "../format.ts";
import { TIMELINE_CLOSING_PHASES } from "../attempt-compute.ts";

// ───────────────────────── AttemptSummary ─────────────────────────

export function attemptSummaryText(data: AttemptSummaryData, ctx: TextContext): string {
  const locale = ctx.locale;
  const parts = [
    data.locator,
    data.identity.evalId,
    data.identity.experimentId,
    `${verdictMark(data.verdict)} ${localeText(locale, `verdict.${data.verdict}`)}`,
    formatDurationMs(data.durationMs),
  ];
  if (data.costUSD !== null) parts.push(formatUSD(data.costUSD));
  return parts.join(" · ");
}

// ───────────────────────── AttemptError ─────────────────────────

export function attemptErrorText(data: AttemptErrorData | null, _ctx: TextContext): string {
  if (data === null) return "";
  const lines = [`error: ${data.code}`, `  phase: ${data.phase}`, `  message: ${data.message}`];
  if (data.cause) lines.push(`  cause: ${data.cause.name ? `${data.cause.name} · ${data.cause.message}` : data.cause.message}`);
  const stack = data.stack?.replace(/\n+$/, "");
  return stack ? `${lines.join("\n")}\n\n${stack}` : lines.join("\n");
}

// ───────────────────────── AttemptAssertions ─────────────────────────

function assertionLine(a: AssertionResult): string {
  const group = a.groupPath && a.groupPath.length > 0 ? `${a.groupPath.join(" > ")} · ` : "";
  if (a.outcome === "unavailable") return `◌ unavailable · ${group}${a.name} — ${a.reason}`;
  const mark = a.outcome === "passed" ? "✓" : "✗";
  const detail = a.detail && a.detail !== a.name ? `: ${a.detail}` : "";
  const evidence = [
    a.expected !== undefined ? `expected: ${a.expected}` : undefined,
    a.received !== undefined ? `received: ${a.received}` : undefined,
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

export function attemptSourceText(data: AttemptSourceData | null, _ctx: TextContext): string {
  if (data === null) return "";
  const header = `${data.sourcePath} · ${data.summary.annotatedLines}/${data.summary.totalLines} lines annotated · niceeval show --source`;
  const failed = data.lines.filter((l) => l.assertions.some((a) => a.outcome !== "passed"));
  const lines = failed.flatMap((line) => line.assertions.filter((a) => a.outcome !== "passed").map((a) => `  ${line.line}: ${assertionLine(a)}`));
  return [header, ...lines].join("\n");
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

export function attemptTimelineText(data: AttemptTimelineData | null, _ctx: TextContext): string {
  if (data === null) return "";
  const main = data.phases.filter((p) => !TIMELINE_CLOSING_PHASES.has(p.name));
  const closing = data.phases.filter((p) => TIMELINE_CLOSING_PHASES.has(p.name));
  const total = main.reduce((sum, p) => sum + p.durationMs, 0);
  const anyFailed = data.phases.some((p) => p.failed);
  const lines = [`timing: ${fmtMs(total)}${anyFailed ? " ✗" : ""} · niceeval show --timing`];
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

function replySummary(reply: AttemptConversationReply): string {
  switch (reply.kind) {
    case "assistant":
      return `assistant: ${reply.text}`;
    case "user":
      return `user: ${reply.text}`;
    case "thinking":
      return `thinking: ${reply.text}`;
    case "error":
      return `error: ${reply.text}`;
    case "tool":
      return `tool ${reply.name}${reply.status ? ` (${reply.status})` : ""}`;
    case "skill":
      return `skill loaded: ${reply.skill}`;
    case "subagent":
      return `subagent ${reply.name}${reply.status ? ` (${reply.status})` : ""}`;
    case "input":
      return `input requested${reply.request.prompt ? `: ${reply.request.prompt}` : ""}`;
    case "compaction":
      return `compaction${reply.reason ? `: ${reply.reason}` : ""}`;
    case "raw":
      return `unrecognized event: ${JSON.stringify(reply.raw)}`;
  }
}

export function attemptConversationText(data: AttemptConversationData | null, _ctx: TextContext): string {
  if (data === null) return "";
  const lines = [`conversation: ${data.rounds.length} round${data.rounds.length === 1 ? "" : "s"} · niceeval show --execution`];
  data.rounds.forEach((round, i) => {
    lines.push(`  round ${i + 1}${round.sentText ? `: ${round.sentText}` : ""}`);
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
      lines.push(`  ${d.level} · ${d.code} — ${d.message}${count}`);
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

export function attemptTraceText(data: AttemptTraceData | null, _ctx: TextContext): string {
  if (data === null) return "";
  return `trace: ${data.spans.length} span${data.spans.length === 1 ? "" : "s"} · niceeval show --timing`;
}

// ───────────────────────── AttemptDiff ─────────────────────────

function netLetter(net: "added" | "modified" | "deleted"): string {
  return net === "added" ? "A" : net === "deleted" ? "D" : "M";
}

export function attemptDiffText(data: AttemptDiffData | null, _ctx: TextContext): string {
  if (data === null) return "";
  const lines = [`changes: ${data.files.length} file${data.files.length === 1 ? "" : "s"} changed by agent · niceeval show --diff`];
  for (const f of data.files) {
    const delta = f.binary ? "binary" : `+${f.lines.added}/-${f.lines.deleted}`;
    lines.push(`  ${netLetter(f.net)} ${f.path} (${delta})`);
  }
  return lines.join("\n");
}
