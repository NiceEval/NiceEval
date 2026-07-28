// Attempt 详情 Content 投影:compute 领域结果 → 原语 Content 形状。

import { Text } from "../../definition/primitives.tsx";
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
import type { AssertionResult, TraceSpan } from "../../../types.ts";
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
  return {
    number: line.line,
    text: line.text,
    tone: line.sends.length > 0 || line.turns.length > 0 ? "send" : lineTone(line),
    ...(hasPoints ? { pill: formatPointsSuffix(points) } : {}),
    ...(line.aborted ? { aborted: true } : {}),
    details:
      line.assertions.length > 0 || line.turns.length > 0
        ? [
            <Text key="d">
              {[
                ...line.turns.map((t) => `${t.label}: ${t.sentText}`),
                ...line.assertions.map((a) => `${a.name} ${a.outcome}${a.detail ? ` — ${stripControl(a.detail)}` : ""}`),
              ].join("\n")}
            </Text>,
          ]
        : undefined,
  };
}

export function attemptSourceContent(data: AttemptSourceData | null): SourceContent | null {
  if (data === null) return null;
  return {
    spine: { path: data.sourcePath, lines: data.lines.map(sourceLineOf) },
    detached: [],
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

function traceSpansToNodes(spans: readonly TraceSpan[]): WaterfallNode[] {
  if (spans.length === 0) return [];
  const t0 = Math.min(...spans.map((s) => s.startMs));
  const ids = new Set(spans.map((s) => s.spanId));
  return spans
    .filter((s) => s.parentSpanId === undefined || !ids.has(s.parentSpanId))
    .map((s, i) => ({
      key: s.spanId || String(i),
      label: s.name,
      kind: spanKind(s),
      startOffsetMs: s.startMs - t0,
      durationMs: Math.max(0, s.endMs - s.startMs),
      failed: s.status === "error",
    }))
    .sort((a, b) => a.startOffsetMs - b.startOffsetMs);
}

export function attemptTimelineContent(data: AttemptTimelineData | null): WaterfallContent | null {
  if (data === null) return null;
  const nodes: WaterfallNode[] = data.phases.map((p, i) => ({
    key: `phase:${i}:${p.name}`,
    label: p.name,
    kind: "phase",
    startOffsetMs: 0,
    durationMs: p.durationMs,
  }));
  if (data.trace && data.trace.length > 0) nodes.push(...traceSpansToNodes(data.trace));
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
  const nodes = traceSpansToNodes(data.spans);
  const t0 = Math.min(...data.spans.map((s) => s.startMs));
  const t1 = Math.max(...data.spans.map((s) => s.endMs));
  return [
    {
      key: data.locator,
      label: data.locator,
      durationMs: Math.max(0, t1 - t0),
      locator: data.locator,
      nodes,
    },
  ];
}

function conversationEntryOf(reply: AttemptConversationReply): ConversationEntry {
  switch (reply.kind) {
    case "assistant":
    case "user":
    case "thinking":
    case "error":
      return { kind: reply.kind, preview: reply.text, failed: reply.kind === "error" };
    case "tool":
      return { kind: "tool", preview: `${reply.name}(${JSON.stringify(reply.input)})` };
    default:
      return { kind: reply.kind, preview: reply.kind };
  }
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

const NET_TO_CHANGE: Record<string, DiffFile["change"]> = {
  added: "generated",
  modified: "modified",
  deleted: "deleted",
};

export function attemptDiffContent(data: AttemptDiffData | null): DiffContent | null {
  if (data === null) return null;
  return data.files.map((file) => ({
    path: file.path,
    change: NET_TO_CHANGE[file.net] ?? "modified",
    added: file.lines.added,
    removed: file.lines.deleted,
  }));
}

export function attemptNoticesContent(
  error: AttemptErrorData | null,
  diagnostics: AttemptDiagnosticsData | null,
): readonly CalloutGroup[] | null {
  const groups = [...(attemptErrorContent(error) ?? []), ...(attemptDiagnosticsContent(diagnostics) ?? [])];
  return groups.length > 0 ? groups : null;
}
