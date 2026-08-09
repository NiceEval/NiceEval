// Attempt 详情 Content 投影:compute 领域结果 → 原语 Content 形状。

import { Conversation, Text } from "../../definition/primitives.tsx";
import type { ReportNode } from "../../definition/tree.ts";
import type { CalloutGroup, CalloutItem } from "../../definition/primitives/callouts-logic.ts";
import type { CopyBlockContent } from "../../definition/primitives/copy-block.tsx";
import type { CommandEvidenceContent, ConversationContent, ConversationEntry, ConversationTurn } from "../../definition/primitives/conversation.tsx";
import type { DiffContent, DiffFile } from "../../definition/primitives/diff-view.tsx";
import type {
  SourceBlockContent,
  SourceCallContent,
  SourceContent,
  SourceLine,
  SourceLineTone,
} from "../../definition/primitives/source-view.tsx";
import type { WaterfallContent, WaterfallNode } from "../../definition/primitives/waterfall.tsx";
import type { TableContent, TableContentRow } from "../../definition/cell.ts";
import type {
  AttemptAssertionsData,
  AttemptCommandEvidenceData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptDiffData,
  AttemptDiagnosticsData,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptTimelineData,
  AttemptTraceData,
} from "../../model/types.ts";
import type { AssertionResult, JsonValue, ScoreEntry, TimingActivity, TraceSpan } from "../../../types.ts";
import { stripControl } from "../../../assertions/display.ts";
import { formatDurationMs, formatPointsSuffix } from "../../model/format.ts";
import { localizedMessage } from "../../model/locale.ts";
import { normalizeTurnLabel } from "../../../shared/turn-label.ts";
import type {
  LineAnnotation,
  ProjectedSourceCall,
  ProjectedSourceLine,
  SourceContent as ProjectedSourceContent,
  SourceContentNode as ProjectedSourceNode,
  SourceCallSummary,
} from "../../../record/annotated-source.ts";

function projectedLineTone(line: ProjectedSourceLine): SourceLineTone | undefined {
  const assertions = line.annotations.flatMap((annotation) =>
    annotation.kind === "assertion" ? [annotation.assertion] : []
  );
  if (assertions.some((assertion) => assertion.outcome === "failed" && assertion.severity === "gate")) return "gate-fail";
  if (assertions.some((assertion) => assertion.outcome === "failed")) return "soft-fail";
  if (assertions.some((assertion) => assertion.outcome === "unavailable")) return "unavailable";
  if (assertions.some((assertion) => assertion.outcome === "passed")) return "passed";
  return line.annotations.some((annotation) => annotation.kind === "send") ? "send" : undefined;
}

function annotationNodes(annotation: LineAnnotation, key: string): ReportNode[] {
  if (annotation.kind === "assertion") return assertionNodes(annotation.assertion, key);
  if (annotation.kind === "score") return [scoreEntryNode(annotation.score, key)];
  const send = annotation.send;
  return [
    <Text key={key}>
      {[send.status, send.durationMs === undefined ? undefined : formatDurationMs(send.durationMs)]
        .filter((part): part is string => part !== undefined)
        .join(" · ")}
    </Text>,
  ];
}

function sourceCallSummaryText(summary: SourceCallSummary): string {
  const parts = [
    `${summary.checks} checks`,
    `${summary.passed} ✓`,
    `${summary.failed} ✗`,
    ...(summary.unavailable > 0 ? [`${summary.unavailable} unavailable`] : []),
    ...(summary.points ? [`${summary.points.earned}/${summary.points.available} pts`] : []),
    ...(summary.aborted ? ["aborted"] : []),
  ];
  return parts.join(" · ");
}

function projectedCallTone(
  call: ProjectedSourceCall,
): import("../../definition/primitives/source-view.tsx").SourceCallContent["tone"] {
  let gateFailed = false;
  let softFailed = false;
  const visitAnnotations = (annotations: readonly LineAnnotation[]) => {
    for (const annotation of annotations) {
      if (annotation.kind !== "assertion" || annotation.assertion.outcome !== "failed") continue;
      if (annotation.assertion.severity === "gate") gateFailed = true;
      else softFailed = true;
    }
  };
  const visitCalls = (calls: readonly ProjectedSourceCall[]) => {
    for (const child of calls) visitCall(child);
  };
  const visitNode = (node: ProjectedSourceNode) => {
    for (const line of node.lines) {
      visitAnnotations(line.annotations);
      visitCalls(line.calls);
    }
  };
  const visitCall = (candidate: ProjectedSourceCall) => {
    if (candidate.target.kind === "source") visitNode(candidate.target.node);
    else {
      if (candidate.target.kind === "unavailable") visitAnnotations(candidate.target.annotations);
      visitCalls(candidate.target.calls);
    }
  };
  visitCall(call);
  if (gateFailed || call.summary.aborted) return "gate-fail";
  if (softFailed || (call.summary.points !== undefined && call.summary.points.earned < call.summary.points.available)) {
    return "soft-fail";
  }
  if (call.summary.unavailable > 0) return "unavailable";
  return "passed";
}

function projectedCallContent(call: ProjectedSourceCall): import("../../definition/primitives/source-view.tsx").SourceCallContent {
  const tone = projectedCallTone(call);
  if (call.target.kind === "source") {
    return {
      summary: sourceCallSummaryText(call.summary),
      tone,
      open: call.open,
      target: { kind: "source", block: projectedBlockContent(call.target.node) },
    };
  }
  const calls = call.target.calls.map(projectedCallContent);
  return {
    summary: sourceCallSummaryText(call.summary),
    tone,
    open: call.open,
    target: {
      kind: "opaque",
      label: call.target.kind === "package"
        ? `package: ${call.target.package}`
        : `source unavailable: ${call.target.file}${call.target.line === undefined ? "" : `:${call.target.line}`}`,
      ...(calls.length > 0 ? { calls } : {}),
    },
  };
}

function projectedBlockContent(node: ProjectedSourceNode): import("../../definition/primitives/source-view.tsx").SourceBlockContent {
  return {
    path: node.file,
    lines: node.lines.map((line): SourceLine => {
      const details = line.annotations.flatMap((annotation, index) => annotationNodes(annotation, `${node.file}:${line.line}:${index}`));
      const calls = line.calls.map(projectedCallContent);
      const points = line.annotations.reduce((sum, annotation) => {
        if (annotation.kind === "score") return sum + annotation.score.points;
        if (annotation.kind === "assertion" && annotation.assertion.outcome !== "unavailable") {
          return sum + (annotation.assertion.points ?? 0);
        }
        return sum;
      }, 0);
      const hasPoints = line.annotations.some((annotation) =>
        annotation.kind === "score" ||
        (annotation.kind === "assertion" && annotation.assertion.outcome !== "unavailable" && annotation.assertion.points !== undefined)
      );
      return {
        number: line.line,
        text: line.text,
        ...(projectedLineTone(line) !== undefined ? { tone: projectedLineTone(line) } : {}),
        ...(hasPoints ? { pill: formatPointsSuffix(points) } : {}),
        ...(line.aborted ? { aborted: true } : {}),
        ...(details.length > 0 ? { details } : {}),
        ...(calls.length > 0 ? { calls } : {}),
      };
    }),
  };
}

type SendLineRef = {
  key: string;
  line: SourceLine;
};

function collectSendLines(source: SourceContent): SendLineRef[] {
  const lines: SendLineRef[] = [];
  const visitCall = (call: SourceCallContent): void => {
    if (call.target.kind === "source") {
      visitBlock(call.target.block);
      return;
    }
    for (const child of call.target.calls ?? []) visitCall(child);
  };
  const visitBlock = (block: SourceBlockContent): void => {
    for (const line of block.lines) {
      if (line.tone === "send") lines.push({ key: `${block.path}:${line.number}`, line });
      for (const call of line.calls ?? []) visitCall(call);
    }
  };
  visitBlock(source.spine);
  for (const block of source.detached) visitBlock(block);
  return lines;
}

/** 将 Conversation 轮嵌入源码 send 行；没有对应源码行的轮留在页尾。 */
export function embedConversationInSource(
  source: SourceContent | null,
  conversation: ConversationContent | null,
): { source: SourceContent | null; conversation: ConversationContent | null } {
  const sendLines = source === null ? [] : collectSendLines(source);
  const sendLinesByKey = new Map<string, SendLineRef[]>();
  for (const sendLine of sendLines) {
    const bucket = sendLinesByKey.get(sendLine.key);
    if (bucket) bucket.push(sendLine);
    else sendLinesByKey.set(sendLine.key, [sendLine]);
  }

  const occupied = new Set<SourceLine>();
  const turnsByLine = new Map<SourceLine, ConversationTurn>();
  const turns = conversation?.turns ?? [];
  const mappedTurnIndexes = new Set<number>();
  const assign = (turnIndex: number, target: SendLineRef): void => {
    const turn = turns[turnIndex]!;
    occupied.add(target.line);
    turnsByLine.set(target.line, turn);
    mappedTurnIndexes.add(turnIndex);
  };

  // 先按显式源码标签定位，避免流首无 loc 的轮抢走后续有 loc 轮的 send 行。
  for (const [turnIndex, turn] of turns.entries()) {
    const labeledCandidates = typeof turn.label === "string" ? sendLinesByKey.get(turn.label) : undefined;
    const labeled = labeledCandidates?.find((candidate) => !occupied.has(candidate.line));
    if (labeled) assign(turnIndex, labeled);
  }
  // 再按原 turns 顺序把没有命中标签的轮放入剩余 send 行。
  for (const [turnIndex] of turns.entries()) {
    if (mappedTurnIndexes.has(turnIndex)) continue;
    const target = sendLines.find((candidate) => !occupied.has(candidate.line));
    if (target) assign(turnIndex, target);
  }

  const cloneCall = (call: SourceCallContent): SourceCallContent => {
    if (call.target.kind === "source") {
      return {
        ...call,
        target: { kind: "source", block: cloneBlock(call.target.block) },
      };
    }
    return {
      ...call,
      target: {
        ...call.target,
        ...(call.target.calls ? { calls: call.target.calls.map(cloneCall) } : {}),
      },
    };
  };
  const cloneLine = (line: SourceLine): SourceLine => {
    const turn = turnsByLine.get(line);
    const details =
      line.details === undefined && turn === undefined
        ? undefined
        : [...(line.details ?? []), ...(turn === undefined ? [] : [<Conversation data={{ turns: [turn] }} />])];
    return {
      ...line,
      ...(details === undefined ? {} : { details }),
      ...(line.calls === undefined ? {} : { calls: line.calls.map(cloneCall) }),
    };
  };
  const cloneBlock = (block: SourceBlockContent): SourceBlockContent => ({
    ...block,
    lines: block.lines.map(cloneLine),
  });

  const embeddedSource = source === null
    ? null
    : {
        ...source,
        spine: cloneBlock(source.spine),
        detached: source.detached.map(cloneBlock),
      };
  const remainingTurns = turns.filter((_turn, turnIndex) => !mappedTurnIndexes.has(turnIndex));
  const remainingConversation = conversation === null ||
      remainingTurns.length === 0
    ? null
    : { ...conversation, turns: remainingTurns };
  return { source: embeddedSource, conversation: remainingConversation };
}

/** AnnotatedSourceResult 的完整调用树到 SourceView Content；不再做裁行或展开决策。 */
export function projectedSourceContent(
  data: ProjectedSourceContent | null,
  locator?: import("../../../record/locator.ts").AttemptLocator,
): SourceContent | null {
  if (data === null) return null;
  const unmapped: ReportNode[] = [
    ...data.unmapped.assertions.flatMap((assertion, index) => assertionNodes(assertion, `unmapped:a${index}`)),
    ...data.unmapped.scores.map((score, index) => scoreEntryNode(score, `unmapped:s${index}`)),
  ];
  return {
    spine: projectedBlockContent(data.spine),
    detached: data.detached.map(projectedBlockContent),
    ...(unmapped.length > 0 ? { unmapped } : {}),
    ...(locator !== undefined ? { locator } : {}),
  };
}

export function attemptAssertionsContent(data: AttemptAssertionsData | null): TableContent | null {
  if (data === null || (data.attention.length === 0 && data.passedGroups.length === 0)) return null;
  const rows: TableContentRow[] = [];
  for (const assertion of data.attention) {
    const detail: string[] = [];
    if (assertion.detail) detail.push(stripControl(assertion.detail));
    if (assertion.outcome === "unavailable") {
      detail.push(`reason: ${assertion.reason}`);
      if (assertion.evidence !== undefined) detail.push(`evidence: ${stripControl(assertion.evidence)}`);
    }
    rows.push({
      key: assertion.name,
      cells: {
        name: { kind: "text", text: assertion.name },
        severity: { kind: "text", text: assertion.severity },
        outcome: { kind: "verdict", verdict: assertion.outcome === "unavailable" ? "skipped" : assertion.outcome },
        detail: detail.length > 0 ? { kind: "text", text: detail.join(" · ") } : { kind: "notApplicable" },
      },
    });
  }
  return {
    columns: [
      { key: "name", header: localizedMessage("attemptAssertions.name") },
      { key: "severity", header: localizedMessage("attemptAssertions.severity") },
      { key: "outcome", header: localizedMessage("attemptAssertions.outcome") },
      { key: "detail", header: localizedMessage("attemptAssertions.detail") },
    ],
    rows,
  };
}

function spanKind(span: TraceSpan): string {
  return span.kind === "turn" ? "agent" : (span.kind ?? "other");
}

/**
 * span 列表 → 按 `parentSpanId` 保留采集侧层级的时间树;偏移换算成
 * `anchorOffsetMs + (startMs - t0)`,即挂载点起点加 span 相对时序
 * (docs/feature/reports/README.md「自上而下有什么」)。
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

/** `TimingActivity` 子树 → 节点;带 `traceId` 的 turn 把同 trace 的 spans 收为 children,锚在该轮起点。 */
function timingNodeToWaterfall(
  node: TimingActivity,
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
    label: node.key === "agent.turn" ? normalizeTurnLabel(node.label) : node.label,
    kind: node.key,
    startOffsetMs: node.startOffsetMs,
    durationMs: node.durationMs,
    ...(node.failed ? { failed: true as const } : {}),
    // turn 是主干:默认展开,打开页面直接看到轮内 agent 活动(presentation.md「自上而下有什么」)。
    ...(node.key === "agent.turn" ? { open: true as const } : {}),
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
  // phase 主链沿累计偏移排布;TimingActivity 的偏移本就是 attempt 时钟绝对偏移,原样进节点。
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
 * (docs/feature/reports/README.md「源码行展开区里有什么」)。
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
  if (turns.length === 0) return null;
  return {
    turns,
    locator: data.locator,
  };
}

export function attemptCommandEvidenceContent(data: AttemptCommandEvidenceData | null): CommandEvidenceContent | null {
  if (data === null || data.commands.length === 0) return null;
  return { locator: data.locator, commands: data.commands };
}

export const executionEvidenceUnavailableCallouts: readonly CalloutGroup[] = [
  {
    title: "Execution evidence unavailable",
    items: [
      {
        level: "warning",
        message: "The events artifact is missing or was not published.",
      },
    ],
  },
];

export function attemptDiagnosticsContent(data: AttemptDiagnosticsData | null): readonly CalloutGroup[] | null {
  if (data === null) return null;
  return data.groups.map((group) => ({
    title: group.phase,
    items: group.items.map(
      (d): CalloutItem => ({
        level: d.level === "error" ? "error" : "warning",
        message: d.detail,
        command: typeof d.context?.command === "string" ? d.context.command : undefined,
        count: d.count,
      }),
    ),
  }));
}

export function attemptErrorContent(data: AttemptErrorData | null): readonly CalloutGroup[] | null {
  if (data === null) return null;
  const phase = data.origin.scope === "attempt" ? data.origin.phase : data.origin.timingNodeId;
  return [
    {
      title: phase,
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
  return data.files.map((file) => ({
    ...file,
    windows: file.windows.map((window) => ({
      ...window,
      window: normalizeTurnLabel(window.window),
    })),
  }));
}

export function attemptNoticesContent(
  error: AttemptErrorData | null,
  diagnostics: AttemptDiagnosticsData | null,
): readonly CalloutGroup[] | null {
  const groups = [...(attemptErrorContent(error) ?? []), ...(attemptDiagnosticsContent(diagnostics) ?? [])];
  return groups.length > 0 ? groups : null;
}
