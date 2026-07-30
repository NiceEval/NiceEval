// Attempt 详情 Content 投影:compute 领域结果 → 原语 Content 形状。

import { Conversation, Text } from "../../definition/primitives.tsx";
import type { ReportNode } from "../../definition/tree.ts";
import type { CalloutGroup, CalloutItem } from "../../definition/primitives/callouts-logic.ts";
import type { CopyBlockContent } from "../../definition/primitives/copy-block.tsx";
import type { ConversationContent, ConversationEntry, ConversationTurn } from "../../definition/primitives/conversation.tsx";
import type { DiffContent, DiffFile } from "../../definition/primitives/diff-view.tsx";
import type { SourceContent, SourceLine, SourceLineTone } from "../../definition/primitives/source-view.tsx";
import type { WaterfallContent, WaterfallNode } from "../../definition/primitives/waterfall.tsx";
import type { TableContent, TableContentRow } from "../../definition/cell.ts";
import type {
  AttemptAssertionsData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptDiffData,
  AttemptDiagnosticsData,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptSourceData,
  AttemptSourceLineData,
  AttemptTimelineData,
  AttemptTraceData,
} from "../../model/types.ts";
import type { AssertionResult, JsonValue, ScoreEntry, TimingNode, TraceSpan } from "../../../types.ts";
import { stripControl } from "../../../scoring/display.ts";
import { formatPointsSuffix } from "../../model/format.ts";

function lineTone(line: AttemptSourceLineData): SourceLineTone | undefined {
  if (line.assertions.length === 0) return line.sends.length > 0 ? "send" : undefined;
  if (line.assertions.some((a) => a.outcome === "failed" && a.severity === "gate")) return "gate-fail";
  if (line.assertions.some((a) => a.outcome === "failed")) return "soft-fail";
  if (line.assertions.some((a) => a.outcome === "unavailable")) return "unavailable";
  if (line.assertions.some((a) => a.outcome === "passed")) return "passed";
  if (line.sends.length > 0) return "send";
  return undefined;
}

function sourceLineOf(line: AttemptSourceLineData): SourceLine {
  const points =
    line.assertions.reduce(
      (sum, a) => sum + (a.outcome !== "unavailable" && typeof a.points === "number" ? a.points : 0),
      0,
    ) + line.scoreEntries.reduce((sum, e) => sum + e.points, 0);
  const hasPoints =
    line.assertions.some((a) => a.outcome !== "unavailable" && a.points !== undefined) || line.scoreEntries.length > 0;
  // 展开区顺序:该行的轮次回复 → 每条 assertion 的判定与细节 → 该行的给分记录。
  const turns = lineTurnsNode(line);
  const details: ReportNode[] = [
    ...(turns === null ? [] : [turns]),
    ...line.assertions.flatMap((assertion, i) => assertionNodes(assertion, `a${i}`)),
    ...line.scoreEntries.map((entry, i) => scoreEntryNode(entry, `s${i}`)),
  ];
  return {
    number: line.line,
    text: line.text,
    tone: line.sends.length > 0 || line.turns.length > 0 ? "send" : lineTone(line),
    ...(hasPoints ? { pill: formatPointsSuffix(points) } : {}),
    ...(line.aborted ? { aborted: true } : {}),
    ...(details.length > 0 ? { details } : {}),
  };
}

export function attemptSourceContent(data: AttemptSourceData | null): SourceContent | null {
  if (data === null) return null;
  // 兜底区:没有 loc 的 assertion、给分记录与轮次都不丢弃,列在全部源码块之后
  // (docs/feature/reports/components/attempt-detail/presentation.md「源码行展开区里有什么」)。
  const unmapped: ReportNode[] = [
    ...data.unmapped.flatMap((assertion, i) => assertionNodes(assertion, `u${i}`)),
    ...(data.unmappedScoreEntries ?? []).flatMap((group, gi) =>
      group.items.map((entry, i) => scoreEntryNode(entry, `us${gi}:${i}`)),
    ),
    ...data.unlocatedTurns.map((turn, i) => (
      <Conversation
        key={`ut${i}`}
        data={{
          turns: [
            {
              key: `turn:${i}`,
              label: turn.label,
              verdict: turn.status === "failed" ? ("failed" as const) : turn.status === "waiting" ? ("skipped" as const) : ("passed" as const),
              entries: turn.replies.map(conversationEntryOf),
            },
          ],
        }}
      />
    )),
  ];
  return {
    spine: { path: data.sourcePath, lines: data.lines.map(sourceLineOf) },
    detached: [],
    ...(unmapped.length > 0 ? { unmapped } : {}),
    locator: data.locator,
  };
}

export function attemptAssertionsContent(data: AttemptAssertionsData | null): TableContent | null {
  if (data === null || (data.attention.length === 0 && data.passedGroups.length === 0)) return null;
  const rows: TableContentRow[] = [];
  for (const assertion of data.attention) {
    rows.push({
      key: assertion.name,
      cells: {
        name: { kind: "text", text: assertion.name },
        severity: { kind: "text", text: assertion.severity },
        outcome: { kind: "verdict", verdict: assertion.outcome === "unavailable" ? "skipped" : assertion.outcome },
        detail: assertion.detail ? { kind: "text", text: stripControl(assertion.detail) } : { kind: "notApplicable" },
      },
    });
  }
  return {
    columns: [{ key: "name" }, { key: "severity" }, { key: "outcome" }, { key: "detail" }],
    rows,
  };
}

function spanKind(span: TraceSpan): string {
  return span.kind === "turn" ? "agent" : (span.kind ?? "other");
}

/**
 * span 列表 → 按 `parentSpanId` 保留采集侧层级的时间树;偏移换算成
 * `anchorOffsetMs + (startMs - t0)`,即挂载点起点加 span 相对时序
 * (docs/feature/reports/components/attempt-detail/presentation.md「自上而下有什么」)。
 */
function spanTreeNodes(spans: readonly TraceSpan[], anchorOffsetMs: number, t0: number): WaterfallNode[] {
  if (spans.length === 0) return [];
  const ids = new Set(spans.map((s) => s.spanId));
  const byParent = new Map<string | undefined, TraceSpan[]>();
  for (const s of spans) {
    const parent = s.parentSpanId !== undefined && ids.has(s.parentSpanId) ? s.parentSpanId : undefined;
    const bucket = byParent.get(parent);
    if (bucket) bucket.push(s);
    else byParent.set(parent, [s]);
  }
  const build = (parent: string | undefined): WaterfallNode[] =>
    (byParent.get(parent) ?? [])
      .map((s, i) => {
        const children = s.spanId ? build(s.spanId) : [];
        return {
          key: s.spanId || `span:${i}`,
          label: s.name,
          kind: spanKind(s),
          startOffsetMs: anchorOffsetMs + (s.startMs - t0),
          durationMs: Math.max(0, s.endMs - s.startMs),
          ...(s.status === "error" ? { failed: true as const } : {}),
          ...(children.length > 0 ? { children } : {}),
        };
      })
      .sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  return build(undefined);
}

/** `TimingNode` 子树 → 节点;带 `traceId` 的 turn 把同 trace 的 spans 收为 children,锚在该轮起点。 */
function timingNodeToWaterfall(
  node: TimingNode,
  spansByTraceId: Map<string, TraceSpan[]>,
  usedTraceIds: Set<string>,
): WaterfallNode {
  const children = (node.children ?? []).map((child) => timingNodeToWaterfall(child, spansByTraceId, usedTraceIds));
  const traceSpans = node.traceId !== undefined ? spansByTraceId.get(node.traceId) : undefined;
  if (node.traceId !== undefined && traceSpans !== undefined) {
    usedTraceIds.add(node.traceId);
    const t0 = Math.min(...traceSpans.map((s) => s.startMs));
    children.push(...spanTreeNodes(traceSpans, node.startOffsetMs, t0));
    children.sort((a, b) => a.startOffsetMs - b.startOffsetMs);
  }
  return {
    key: node.id,
    label: node.label,
    kind: node.kind,
    startOffsetMs: node.startOffsetMs,
    durationMs: node.durationMs,
    ...(node.failed ? { failed: true as const } : {}),
    // turn 是主干:默认展开,打开页面直接看到轮内 agent 活动(presentation.md「自上而下有什么」)。
    ...(node.kind === "turn" ? { open: true as const } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

export function attemptTimelineContent(data: AttemptTimelineData | null): WaterfallContent | null {
  if (data === null) return null;
  const spansByTraceId = new Map<string, TraceSpan[]>();
  for (const s of data.trace ?? []) {
    const bucket = spansByTraceId.get(s.traceId);
    if (bucket) bucket.push(s);
    else spansByTraceId.set(s.traceId, [s]);
  }
  const usedTraceIds = new Set<string>();
  // phase 主链沿累计偏移排布;TimingNode 的偏移本就是 attempt 时钟绝对偏移,原样进节点。
  let cursor = 0;
  const nodes: WaterfallNode[] = data.phases.map((p, i) => {
    const startOffsetMs = cursor;
    cursor += p.durationMs;
    const children = (p.children ?? []).map((child) => timingNodeToWaterfall(child, spansByTraceId, usedTraceIds));
    return {
      key: `phase:${i}:${p.name}`,
      label: p.name,
      kind: "phase",
      startOffsetMs,
      durationMs: p.durationMs,
      ...(p.failed ? { failed: true as const } : {}),
      ...(p.name === "eval.run" ? { open: true as const } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
  });
  // 关联不上任何 turn 的 span 不丢弃,落在 eval.run 层;没有 eval.run phase 时接在顶层。
  const leftovers = (data.trace ?? []).filter((s) => !usedTraceIds.has(s.traceId));
  if (leftovers.length > 0) {
    const t0 = Math.min(...leftovers.map((s) => s.startMs));
    const evalRun = nodes.find((n) => n.label === "eval.run");
    const extra = spanTreeNodes(leftovers, evalRun?.startOffsetMs ?? 0, t0);
    if (evalRun !== undefined) {
      (evalRun as { children?: WaterfallNode[] }).children = [...(evalRun.children ?? []), ...extra].sort(
        (a, b) => a.startOffsetMs - b.startOffsetMs,
      );
    } else {
      nodes.push(...extra);
    }
  }
  return [
    {
      key: data.locator,
      label: data.locator,
      durationMs: data.phases.reduce((sum, p) => sum + p.durationMs, 0),
      locator: data.locator,
      nodes,
    },
  ];
}

export function attemptTraceContent(data: AttemptTraceData | null): WaterfallContent | null {
  if (data === null) return null;
  const t0 = Math.min(...data.spans.map((s) => s.startMs));
  const t1 = Math.max(...data.spans.map((s) => s.endMs));
  return [
    {
      key: data.locator,
      label: data.locator,
      durationMs: Math.max(0, t1 - t0),
      locator: data.locator,
      nodes: spanTreeNodes(data.spans, 0, t0),
    },
  ];
}

/** 工具出入参:结构化值 JSON 化后交原语收口成单行预览(Conversation 的 preview 契约)。 */
function jsonPreview(value: JsonValue | undefined): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function conversationEntryOf(reply: AttemptConversationReply): ConversationEntry {
  switch (reply.kind) {
    case "assistant":
    case "user":
    case "thinking":
    case "error":
      return { kind: reply.kind, preview: reply.text, failed: reply.kind === "error" };
    case "context":
      return { kind: "context", preview: reply.source ? `${reply.source}: ${reply.text}` : reply.text };
    case "tool": {
      const output = jsonPreview(reply.output);
      return {
        kind: "tool",
        preview: `${reply.name}(${jsonPreview(reply.input)})`,
        ...(reply.status !== undefined && reply.status !== "completed" ? { failed: true } : {}),
        ...(output ? { detail: <Text>{`${reply.status ?? "completed"}\n${output}`}</Text> } : {}),
      };
    }
    case "subagent": {
      const output = jsonPreview(reply.output);
      return {
        kind: "subagent",
        preview: reply.remoteUrl ? `${reply.name} → ${reply.remoteUrl}` : reply.name,
        ...(reply.status === "failed" ? { failed: true } : {}),
        ...(output ? { detail: <Text>{output}</Text> } : {}),
      };
    }
    case "skill":
      return { kind: "skill", preview: reply.skill };
    case "input":
      return { kind: "input", preview: reply.request.display ?? reply.request.prompt ?? reply.request.action ?? "input requested" };
    case "compaction":
      return { kind: "compaction", preview: reply.reason ?? "context compacted" };
    case "raw":
      return { kind: "raw", preview: jsonPreview(reply.raw) };
  }
}

/** 该行 assertion 的判定摘要行 tone:与源码行状态同一套色。 */
function assertionToneClass(assertion: AssertionResult): string {
  if (assertion.outcome === "unavailable") return "niceeval-tone-na";
  if (assertion.outcome === "passed") return "niceeval-tone-good";
  return assertion.severity === "gate" ? "niceeval-tone-bad" : "niceeval-tone-warn";
}

/**
 * 一条 assertion 在展开区里的呈现:一行判定摘要,失败与 soft 项接一段 expected / received 正文
 * (docs/feature/reports/components/attempt-detail/presentation.md「源码行展开区里有什么」)。
 */
function assertionNodes(assertion: AssertionResult, key: string): ReportNode[] {
  const points =
    assertion.outcome !== "unavailable" && assertion.points !== undefined
      ? ` ${formatPointsSuffix(assertion.points)}`
      : "";
  const head = `${assertion.name} · ${assertion.severity} ${assertion.outcome}${points}`;
  const body: string[] = [];
  if (assertion.detail) body.push(`check: ${stripControl(assertion.detail)}`);
  if (assertion.outcome === "unavailable") {
    body.push(`reason: ${assertion.reason}`);
  } else {
    if (assertion.expected !== undefined) body.push(`expected: ${stripControl(assertion.expected)}`);
    if (assertion.received !== undefined) body.push(`received: ${stripControl(assertion.received)}`);
    if (assertion.threshold !== undefined) body.push(`threshold: ${assertion.threshold} · score: ${assertion.score}`);
  }
  if (assertion.evidence !== undefined) body.push(`evidence: ${stripControl(assertion.evidence)}`);
  const nodes: ReportNode[] = [
    <Text key={`${key}:head`} className={`niceeval-source-assertion ${assertionToneClass(assertion)}`}>
      {head}
    </Text>,
  ];
  if (body.length > 0) {
    nodes.push(
      <Text key={`${key}:body`} className="niceeval-source-assertion-body">
        {body.join("\n")}
      </Text>,
    );
  }
  return nodes;
}

/** 该行发出的轮次:复用 Conversation 的条目呈现,轮头在展开区里由 stylesheet 收起。 */
function lineTurnsNode(line: AttemptSourceLineData): ReportNode | null {
  if (line.turns.length === 0) return null;
  return (
    <Conversation
      key="turns"
      data={{
        turns: line.turns.map((turn, i) => ({
          key: `turn:${i}`,
          label: turn.label,
          verdict: turn.status === "failed" ? "failed" : turn.status === "waiting" ? "skipped" : "passed",
          entries: turn.replies.map(conversationEntryOf),
        })),
      }}
    />
  );
}

function scoreEntryNode(entry: ScoreEntry, key: string): ReportNode {
  const group = entry.groupPath?.length ? `${entry.groupPath.join(" > ")} · ` : "";
  return (
    <Text key={key} className="niceeval-source-score-entry">
      {`${group}${entry.label} ${formatPointsSuffix(entry.points)}`}
    </Text>
  );
}

export function attemptConversationContent(data: AttemptConversationData | null): ConversationContent | null {
  if (data === null) return null;
  const turns: ConversationTurn[] = data.rounds.map((round, i) => ({
    key: `round:${i}`,
    label: round.loc ? `${round.loc.file}:${round.loc.line}` : `Round ${i + 1}`,
    entries: round.replies.map(conversationEntryOf),
  }));
  if (turns.length === 0 && !data.failedCommands?.length) return null;
  return {
    turns,
    failedCommands: data.failedCommands?.map((cmd, i) => ({
      key: `cmd:${i}`,
      phase: cmd.phase,
      display: cmd.display,
      exitCode: cmd.exitCode,
      stdout: cmd.stdout,
      stderr: cmd.stderr,
    })),
    locator: data.locator,
  };
}

export function attemptDiagnosticsContent(data: AttemptDiagnosticsData | null): readonly CalloutGroup[] | null {
  if (data === null) return null;
  return data.groups.map((group) => ({
    title: group.phase,
    items: group.items.map(
      (d): CalloutItem => ({
        level: d.level === "error" ? "error" : "warning",
        message: d.message,
        command: d.command,
        count: d.count,
      }),
    ),
  }));
}

export function attemptErrorContent(data: AttemptErrorData | null): readonly CalloutGroup[] | null {
  if (data === null) return null;
  return [
    {
      title: data.phase,
      items: [{ level: "error", message: `${data.code}: ${data.message}` }],
    },
  ];
}

export function attemptFixPromptContent(data: AttemptFixPromptData | null): CopyBlockContent | null {
  if (data === null) return null;
  return { title: { en: "Fix prompt", "zh-CN": "修复 prompt" }, text: data.prompt };
}

/** 投影已经是 `DiffFile[]`,这里只把「没有证据」与「没有改动」都收成组件的零输出。 */
export function attemptDiffContent(data: AttemptDiffData | null): DiffContent | null {
  if (data === null || data.files.length === 0) return null;
  return data.files;
}

export function attemptNoticesContent(
  error: AttemptErrorData | null,
  diagnostics: AttemptDiagnosticsData | null,
): readonly CalloutGroup[] | null {
  const groups = [...(attemptErrorContent(error) ?? []), ...(attemptDiagnosticsContent(diagnostics) ?? [])];
  return groups.length > 0 ? groups : null;
}
