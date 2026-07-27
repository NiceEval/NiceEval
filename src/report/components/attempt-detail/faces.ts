// Attempt 详情组件族的 text 面(docs/feature/reports/components/attempt-detail/README.md「在 show 与
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
  UsageTableData,
} from "../../model/types.ts";
import type { AssertionResult, FailedCommandEvidence, ScoreEntry, TimingNode } from "../../../types.ts";
import type { AttemptLocator } from "../../../results/locator.ts";
import type { TextContext } from "../../definition/tree.ts";
import { localeText } from "../../model/locale.ts";
import { formatDurationMs, formatMetricValue, formatPoints, formatPointsSuffix, formatReportDateTime, formatUSD, verdictMark } from "../../model/format.ts";
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
  // 计分制:头行 verdict 后跟本轮挣分——详情页总分位的唯一出现处
  // (docs/feature/reports/show/attempt.md 计分制示例头行)。
  if (data.totalScore !== undefined) parts.push(formatPoints(data.totalScore));
  if (data.startedAt !== undefined) parts.push(formatReportDateTime(data.startedAt, locale));
  parts.push(formatDurationMs(data.durationMs));
  if (data.costUSD !== null) parts.push(formatUSD(data.costUSD));
  return parts.join(" · ");
}

// ───────────────────────── AttemptError ─────────────────────────

export function attemptErrorText(data: AttemptErrorData | null, ctx: TextContext): string {
  if (data === null) return "";
  // message/cause 折单行加上限(同 assertionLine 的 summaryText 规则);stack 是唯一没有替代
  // 查看入口的自由文本,原样保留多行,不折。
  const lines = [`error: ${data.code}`, `  phase: ${data.phase}`, `  message: ${summaryText(data.message)}`];
  if (data.cause) {
    const causeMessage = summaryText(data.cause.message);
    lines.push(`  cause: ${data.cause.name ? `${data.cause.name} · ${causeMessage}` : causeMessage}`);
  }
  const stack = data.stack?.replace(/\n+$/, "");
  const body = stack ? `${lines.join("\n")}\n\n${stack}` : lines.join("\n");
  // message 疑似只剩截断尾部时,在错误摘要后明确提示失败命令证据的完整下钻入口
  // (docs/feature/reports/show/execution.md)。
  if (!data.commandEvidenceHint) return body;
  const command = evidenceCommand(ctx, data.locator, "--execution");
  return command ? `${body}\n\nfailed command evidence: ${command}` : body;
}

// ───────────────────────── AttemptAssertions ─────────────────────────

/** `loc` 是断言在 eval 源码里的调用点,独立于整份源码是否被捕获(`AttemptSource` 的能力位);
 *  失败断言只要带 loc 就给可复制定位的源码锚,不必等 AttemptSource 可用才显示。 */
function locAnchor(loc: { file: string; line: number; column?: number }): string {
  return `${loc.file}:${loc.line}${loc.column ? `:${loc.column}` : ""}`;
}

function assertionLine(a: AssertionResult & { aborted?: true }, ctx: TextContext): string {
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
  // 计分制(defineScoreEval)才有:.points(n) 挣到的分,0 分也如实显示,不隐藏
  // (docs/feature/assertions/library/display.md「计分制:.points 与给分记录」)。
  const pointsSuffix = a.points !== undefined ? ` · ${formatPointsSuffix(a.points)}` : "";
  // 前置中止:这条断言让 test() 就地结束,其后不再有任何断言或给分记录
  // (docs/feature/assertions/library/display.md「前置中止」)。
  const abortSuffix = a.aborted ? ` · ⤓ ${localeText(ctx.locale, "attemptSource.abortReason")}` : "";
  return `${mark} ${a.severity} · ${group}${a.name}${detail}${evidenceSuffix}${pointsSuffix}${abortSuffix}`;
}

/** 组内 `.points` 挣分之和;组内没有任何断言带 points 时返回 undefined(该组不是计分制组)。 */
function groupPointsTotal(items: readonly AssertionResult[]): number | undefined {
  const withPoints = items.filter((a) => a.outcome !== "unavailable" && a.points !== undefined);
  if (withPoints.length === 0) return undefined;
  return withPoints.reduce((sum, a) => sum + (a as { points: number }).points, 0);
}

/** `t.score(label, n)` 一条记录的紧凑行:group 前缀 + label + 挣分,同 assertionLine 的 group 拼接规则。 */
function scoreEntryLine(group: string, entry: ScoreEntry): string {
  const prefix = group ? `${group} · ` : "";
  return `  ${prefix}${entry.label} · ${formatPointsSuffix(entry.points)}`;
}

export function attemptAssertionsText(data: AttemptAssertionsData | null, ctx: TextContext): string {
  if (data === null) return "";
  const lines: string[] = [];
  // 顶层计数:计分制 attempt 加一项得分点挣满计数(docs/feature/assertions/library/display.md「计分制」)。
  if (data.scorePointsEarned) {
    lines.push(localeText(ctx.locale, "attemptAssertions.scorePointsEarned", data.scorePointsEarned));
  }
  lines.push(...data.attention.map((a) => assertionLine(a, ctx)));
  for (const { group, items } of data.passedGroups) {
    const total = groupPointsTotal(items);
    const pointsSuffix = total === undefined ? "" : ` · ${formatPointsSuffix(total)}`;
    lines.push(`✓ passed · ${group || "(ungrouped)"} · ${items.length}${pointsSuffix}`);
  }
  if (data.scoreEntries && data.scoreEntries.length > 0) {
    const total = data.scoreEntries.reduce((sum, g) => sum + g.items.reduce((s, e) => s + e.points, 0), 0);
    lines.push(`${localeText(ctx.locale, "attemptAssertions.scoreEntries")} · ${formatPointsSuffix(total)}`);
    for (const { group, items } of data.scoreEntries) {
      for (const entry of items) lines.push(scoreEntryLine(group, entry));
    }
  }
  return lines.join("\n");
}

// ───────────────────────── AttemptSource ─────────────────────────

export function attemptSourceText(data: AttemptSourceData | null, ctx: TextContext): string {
  if (data === null) return "";
  const command = evidenceCommand(ctx, data.locator, "--source");
  const headerParts = [data.sourcePath];
  // 得分点挣满计数排在行数标注之前(docs/feature/reports/show/attempt.md 计分制示例的框上边框)。
  if (data.scorePointsEarned !== undefined) {
    headerParts.push(localeText(ctx.locale, "attemptAssertions.scorePointsEarned", data.scorePointsEarned));
  }
  headerParts.push(`${data.summary.annotatedLines}/${data.summary.totalLines} lines annotated`);
  if (command) headerParts.push(command);
  const hasConversation = data.unlocatedTurns.length > 0 || data.lines.some((line) => line.turns.length > 0);
  const executionCommand = hasConversation ? evidenceCommand(ctx, data.locator, "--execution") : null;
  if (executionCommand) headerParts.push(executionCommand);
  // 源码锚由 assertionLine 自己按 a.loc 拼(与 AttemptAssertions 共用同一份逻辑);这里只负责挑出
  // 要展开的条目——得分点(带 .points)豁免 passed 收纳,即使 passed 也逐条列出(与
  // attemptAssertionsData 同一条规则,docs/feature/assertions/library/display.md「得分点不参与
  // passed 收纳」)。
  const isAttention = (a: AssertionResult & { aborted?: true }) => a.outcome !== "passed" || a.points !== undefined;
  const attention = data.lines.flatMap((line) => line.assertions.filter(isAttention));
  // 全通过折叠只在真的没有失败可看时触发:unmapped 区(没有 loc、指向别的文件或越界)同样要检查
  // 是否藏着非 passed 条目,否则会把「unmapped 里有一条真实失败,但行内 attention 恰好是空」的
  // attempt 错误地折成一条「✓ passed」(docs/feature/reports/show/attempt.md「全通过折叠」)。
  const hasUnmappedAttention = data.unmapped.some(isAttention);
  const lines =
    attention.length > 0 || hasUnmappedAttention
      ? attention.map((a) => `  ${assertionLine(a, ctx)}`)
      : data.passedGroups.map(({ group, items }) => `  ✓ passed · ${group || "(ungrouped)"} · ${items.length}`);
  // t.score(...) 给分记录:行内映射的按行序收集,unmapped 的按既有分组顺序接在后面
  // (docs/feature/assertions/library/display.md「源码面同样承载给分证据」)。
  const scoreEntries: { group: string; entry: ScoreEntry }[] = [
    ...data.lines.flatMap((line) => line.scoreEntries.map((entry) => ({ group: entry.groupPath?.join(" > ") ?? "", entry }))),
    ...(data.unmappedScoreEntries ?? []).flatMap((g) => g.items.map((entry) => ({ group: g.group, entry }))),
  ];
  if (scoreEntries.length > 0) {
    const total = scoreEntries.reduce((sum, { entry }) => sum + entry.points, 0);
    lines.push(`  ${localeText(ctx.locale, "attemptAssertions.scoreEntries")} · ${formatPointsSuffix(total)}`);
    for (const { group, entry } of scoreEntries) lines.push(scoreEntryLine(group, entry));
  }
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
  // 超时 attempt 的 workspace.diff 是收尾段补折叠(证据保全),不入主链口径——与 show --timing 同一条归类。
  const isClosing = (name: string) => TIMELINE_CLOSING_PHASES.has(name) || (data.timedOut === true && name === "workspace.diff");
  const main = data.phases.filter((p) => !isClosing(p.name));
  const closing = data.phases.filter((p) => isClosing(p.name));
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
    case "context":
      return `context injected${reply.source ? ` (${reply.source})` : ""}: ${summaryText(reply.text)}`;
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

/** 失败 Sandbox 命令的紧凑摘要行(与其它回复条目同一收口规则:自由文本折单行加上限;
 *  完整 stdout/stderr 与逐字段展开在 `--execution` 里原样可查)。 */
function failedCommandSummary(command: FailedCommandEvidence): string[] {
  const lines = [`FAILED COMMAND · ${command.phase} · exit ${command.exitCode}: ${summaryText(command.display)}`];
  if (command.stdout) lines.push(`  stdout: ${summaryText(command.stdout)}`);
  if (command.stderr) lines.push(`  stderr: ${summaryText(command.stderr)}`);
  return lines;
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
  if (data.failedCommands && data.failedCommands.length > 0) {
    for (const failedCommand of data.failedCommands) {
      for (const line of failedCommandSummary(failedCommand)) lines.push(`  ${line}`);
    }
  }
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

// ───────────────────────── UsageTable ─────────────────────────

/**
 * 单行装配形态,与 docs/feature/reports/components/attempt-detail/usage-table.md#组装口径单源
 * 的示例行文案是同一形态本身,不是它的近似摘要:
 *   `usage: 6 turns · 21 tool calls · 62.3k uncached in + 942.6k cache read / 6.7k out · 24 requests · $1.14`
 * 每个片段独立地只在对应事实存在时出现,顺序保持不变;全部缺失时整行不出现(返回 ""),
 * 与「没有 usage 时零输出」同一条规则。
 */
export function usageTableText(data: UsageTableData | null, _ctx: TextContext): string {
  if (data === null) return "";
  const usage = data.usage;

  // 桶恒互斥,inputTokens 就是未缓存输入;"uncached" 标注只在 cache 拆分真实在场时给,
  // cache 桶缺席的数字不贴标注——不给没有拆分事实的数字暗示拆分。
  const inFragment =
    usage?.inputTokens !== undefined
      ? usage.cacheReadTokens !== undefined
        ? `${formatMetricValue(usage.inputTokens)} uncached in`
        : `${formatMetricValue(usage.inputTokens)} in`
      : undefined;
  const cacheFragment = usage?.cacheReadTokens !== undefined ? `${formatMetricValue(usage.cacheReadTokens)} cache read` : undefined;
  const outFragment = usage?.outputTokens !== undefined ? `${formatMetricValue(usage.outputTokens)} out` : undefined;
  const inCache = [inFragment, cacheFragment].filter((s): s is string => s !== undefined).join(" + ");
  const tokenSegment = [inCache || undefined, outFragment].filter((s): s is string => s !== undefined).join(" / ");

  const parts = [
    data.turns !== undefined ? `${data.turns} turn${data.turns === 1 ? "" : "s"}` : undefined,
    data.toolCalls !== undefined ? `${data.toolCalls} tool call${data.toolCalls === 1 ? "" : "s"}` : undefined,
    tokenSegment || undefined,
    // requests 只在协议真实提供时显示——协议不提供就整段省略,绝不凑一个 1
    // (docs/feature/reports/components/attempt-detail/usage-table.md#组装口径单源)。
    usage?.requests !== undefined ? `${usage.requests} requests` : undefined,
    data.estimatedCostUSD !== undefined ? formatUSD(data.estimatedCostUSD) : undefined,
  ].filter((s): s is string => s !== undefined);
  return parts.length > 0 ? `usage: ${parts.join(" · ")}` : "";
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
