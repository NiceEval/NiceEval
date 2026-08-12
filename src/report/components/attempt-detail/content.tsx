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
import type { AssertionEntryReadV1 } from "../../../assertions/record/model.ts";
import type { ScoreProjectionV1 } from "../../../eval/record/score.ts";
import type { AttemptSlotProjectedEntry } from "../../../projection/index.ts";
import type {
  AttemptAssertionsData,
  AttemptCommandEvidenceData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptDiffData,
  AttemptDiagnosticsData,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptLocator,
  AttemptSourceDisplayAnnotation,
  AttemptSourceDisplayCall,
  AttemptSourceDisplayInput,
  AttemptSourceDisplayLine,
  AttemptSourceDisplayNode,
  AttemptSourceDisplaySummary,
  AttemptTimelineData,
  AttemptTraceData,
} from "../../model/types.ts";
import type { JsonValue, TimingActivity, TraceSpan } from "../../../types.ts";
import { summaryText } from "../../../assertions/display.ts";
import { formatDurationMs, formatPointsSuffix } from "../../model/format.ts";
import { normalizeTurnLabel } from "../../../shared/turn-label.ts";

function sourceLocation(location: { readonly file: string; readonly line: number } | undefined): string {
  return location === undefined ? "unmapped" : `${location.file}:${location.line}`;
}

function sourceOutcome<BlobRef>(annotation: AttemptSourceDisplayAnnotation<BlobRef>): string[] {
  switch (annotation.kind) {
    case "send":
      return [];
    case "assertion-site":
      if (annotation.entry.state !== "available") return ["unavailable"];
      switch (annotation.entry.entry.result.state) {
        case "matched":
          return ["passed"];
        case "mismatched":
          return ["failed"];
        case "errored":
          return ["errored"];
        case "unavailable":
        case "not-applicable":
          return ["unavailable"];
      }
  }
}

function isGateFailure<BlobRef>(annotation: AttemptSourceDisplayAnnotation<BlobRef>): boolean {
  return annotation.kind === "assertion-site" &&
    annotation.roles.includes("gate") &&
    annotation.entry.state === "available" &&
    annotation.entry.entry.result.gate === "failed";
}

/** Restore source-line status from role-tagged sites of current Assertion entries. */
function projectedLineTone<BlobRef>(line: AttemptSourceDisplayLine<BlobRef>): SourceLineTone | undefined {
  const outcomes = line.annotations.flatMap(sourceOutcome);
  if (line.annotations.some(isGateFailure)) return "gate-fail";
  if (outcomes.some((outcome) => outcome === "failed" || outcome === "errored")) return "soft-fail";
  if (outcomes.some((outcome) => outcome === "unavailable" || outcome === "skipped")) return "unavailable";
  if (outcomes.some((outcome) => outcome === "passed" || outcome === "scored")) return "passed";
  return line.annotations.some((annotation) => annotation.kind === "send") ? "send" : undefined;
}

function sourceToneClass(outcome: string, gate = false): string {
  if (outcome === "passed" || outcome === "scored" || outcome === "matched") return "niceeval-tone-good";
  if (
    outcome === "unavailable" ||
    outcome === "not-applicable" ||
    outcome === "skipped" ||
    outcome === "unsupported" ||
    outcome === "invalid"
  ) return "niceeval-tone-na";
  return gate ? "niceeval-tone-bad" : "niceeval-tone-warn";
}

function sourceAssertionDetail<BlobRef>(
  annotation: Extract<AttemptSourceDisplayAnnotation<BlobRef>, { readonly kind: "assertion-site" }>,
  location: string,
): string {
  const parts = [`roles: ${annotation.roles.join(", ")}`, assertionDetail(annotation.entry, location)];
  for (const detail of annotation.details ?? []) {
    parts.push(`${detail.label}: ${summaryText(detail.value)}`);
  }
  return parts.join(" · ");
}

function assertionNodes<BlobRef>(
  annotation: Extract<AttemptSourceDisplayAnnotation<BlobRef>, { readonly kind: "assertion-site" }>,
  key: string,
  location: string,
): ReportNode[] {
  const entry = annotation.entry;
  const outcome = entry.state === "available" ? entry.entry.result.state : entry.state;
  return [
    <Text key={`${key}:head`} className={`niceeval-source-assertion ${sourceToneClass(outcome, isGateFailure(annotation))}`}>
      {`Assertion ${assertionKey(entry)} [${entry.entry.entryId}] · ${annotation.roles.join(" + ")} · ${assertionCriterion(entry)} ${outcome}`}
    </Text>,
    <Text key={`${key}:body`} className="niceeval-source-assertion-body">
      {sourceAssertionDetail(annotation, location)}
    </Text>,
  ];
}

function annotationNodes<BlobRef>(
  annotation: AttemptSourceDisplayAnnotation<BlobRef>,
  key: string,
  fallback?: { readonly file: string; readonly line: number },
): ReportNode[] {
  const location = sourceLocation(fallback);
  switch (annotation.kind) {
    case "assertion-site":
      return assertionNodes(annotation, key, location);
    case "send":
      return [
        <Text key={key}>
          {[annotation.status, annotation.durationMs === undefined ? undefined : formatDurationMs(annotation.durationMs)]
            .filter((part): part is string => part !== undefined)
            .join(" · ")}
        </Text>,
      ];
  }
}

/** One coordinate renders an Assertion entry once, with all of its roles. */
function mergeAssertionSites<BlobRef>(
  annotations: readonly AttemptSourceDisplayAnnotation<BlobRef>[],
): readonly AttemptSourceDisplayAnnotation<BlobRef>[] {
  const out: AttemptSourceDisplayAnnotation<BlobRef>[] = [];
  const indexes = new Map<string, number>();
  for (const annotation of annotations) {
    if (annotation.kind !== "assertion-site") {
      out.push(annotation);
      continue;
    }
    const entryId = String(annotation.entry.entry.entryId);
    const index = indexes.get(entryId);
    if (index === undefined) {
      indexes.set(entryId, out.length);
      out.push(annotation);
      continue;
    }
    const existing = out[index];
    if (existing === undefined || existing.kind !== "assertion-site") continue;
    const roles = [...new Set([...existing.roles, ...annotation.roles])];
    const [firstRole, ...otherRoles] = roles;
    if (firstRole === undefined) continue;
    const details = [...(existing.details ?? []), ...(annotation.details ?? [])].filter(
      (detail, detailIndex, all) => all.findIndex((candidate) =>
        candidate.label === detail.label && candidate.value === detail.value
      ) === detailIndex,
    );
    out[index] = {
      ...existing,
      roles: [firstRole, ...otherRoles],
      ...(existing.sourceOrder === undefined || annotation.sourceOrder === undefined
        ? {}
        : { sourceOrder: Math.min(existing.sourceOrder, annotation.sourceOrder) }),
      ...(details.length > 0 ? { details } : {}),
    };
  }
  return out;
}

function sourceCallSummaryText(summary: AttemptSourceDisplaySummary): string {
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

function projectedCallTone<BlobRef>(
  call: AttemptSourceDisplayCall<BlobRef>,
): import("../../definition/primitives/source-view.tsx").SourceCallContent["tone"] {
  let gateFailed = false;
  let softFailed = false;
  const visitAnnotations = (annotations: readonly AttemptSourceDisplayAnnotation<BlobRef>[]) => {
    for (const annotation of mergeAssertionSites(annotations)) {
      if (isGateFailure(annotation)) gateFailed = true;
      if (sourceOutcome(annotation).some((outcome) => outcome === "failed" || outcome === "errored")) softFailed = true;
    }
  };
  const visitCalls = (calls: readonly AttemptSourceDisplayCall<BlobRef>[]) => {
    for (const child of calls) visitCall(child);
  };
  const visitNode = (node: AttemptSourceDisplayNode<BlobRef>) => {
    for (const line of node.lines) {
      visitAnnotations(line.annotations);
      visitCalls(line.calls);
    }
  };
  const visitCall = (candidate: AttemptSourceDisplayCall<BlobRef>) => {
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

function projectedCallContent<BlobRef>(
  call: AttemptSourceDisplayCall<BlobRef>,
): import("../../definition/primitives/source-view.tsx").SourceCallContent {
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

function annotationEarnedPoints<BlobRef>(annotation: AttemptSourceDisplayAnnotation<BlobRef>): number | undefined {
  if (annotation.kind !== "assertion-site" || !annotation.roles.includes("score")) return undefined;
  const contribution = annotation.entry.entry.result.score;
  return contribution.state === "earned" ? contribution.earned : undefined;
}

function projectedBlockContent<BlobRef>(node: AttemptSourceDisplayNode<BlobRef>): SourceBlockContent {
  return {
    path: node.file,
    lines: node.lines.map((line): SourceLine => {
      const fallback = { file: node.file, line: line.line };
      const annotations = mergeAssertionSites(line.annotations);
      const details = annotations.flatMap((annotation, index) => annotationNodes(annotation, `${node.file}:${line.line}:${index}`, fallback));
      const calls = line.calls.map(projectedCallContent);
      const points = annotations.reduce((sum, annotation) => sum + (annotationEarnedPoints(annotation) ?? 0), 0);
      const hasPoints = annotations.some((annotation) => annotationEarnedPoints(annotation) !== undefined);
      const tone = projectedLineTone({ ...line, annotations: [...annotations] });
      return {
        number: line.line,
        text: line.text,
        ...(tone !== undefined ? { tone } : {}),
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

/**
 * Existing source-page adapter. Its input is a temporary pure display value;
 * a later assertion-source projector will supply it without changing this
 * renderer or turning Verdict/Score into line-local observations.
 */
export function projectedSourceContent<BlobRef>(
  data: AttemptSourceDisplayInput<BlobRef> | null,
  locator?: AttemptLocator,
): SourceContent | null {
  if (data === null) return null;
  // Unmapped items have no coordinate, so merging them would invent a shared site.
  const unmapped = data.unmapped.flatMap((annotation, index) =>
    annotationNodes(annotation, `unmapped:${annotation.kind}:${index}`),
  );
  return {
    spine: projectedBlockContent(data.spine),
    detached: data.detached.map(projectedBlockContent),
    ...(unmapped.length > 0 ? { unmapped } : {}),
    ...(locator !== undefined ? { locator } : {}),
  };
}

function assertionKey<BlobRef>(entry: AssertionEntryReadV1<BlobRef>): string {
  const { label, key } = entry.entry.display;
  if (label !== undefined && key !== undefined && label !== key) return `${label} · ${key}`;
  return label ?? key ?? entry.entry.entryId;
}

function assertionCriterion<BlobRef>(entry: AssertionEntryReadV1<BlobRef>): string {
  const criterion = entry.entry.criterion;
  if ("id" in criterion && typeof criterion.id === "string") return criterion.id;
  if ("name" in criterion && typeof criterion.name === "string") return criterion.name;
  return "unrecognized criterion";
}

function assertionOutcome<BlobRef>(entry: AssertionEntryReadV1<BlobRef>): string {
  return entry.state === "available"
    ? entry.entry.result.state
    : `${entry.state} · ${entry.reason}`;
}

function scoreContributionDetail<BlobRef>(entry: AssertionEntryReadV1<BlobRef>): string {
  const contribution = entry.entry.result.score;
  switch (contribution.state) {
    case "not-scored":
      return "not scored";
    case "earned":
      return `earned ${contribution.earned} / ${contribution.points}`;
    case "unavailable":
      return `score unavailable · ${contribution.reason}`;
  }
}

function assertionDetail<BlobRef>(entry: AssertionEntryReadV1<BlobRef>, source = "unmapped"): string {
  const coverage = entry.entry.coverage;
  const result = entry.entry.result;
  const parts = [
    `criterion: ${assertionCriterion(entry)}`,
    `source: ${source}`,
    ...(entry.entry.display.groupPath.length > 0 ? [`group: ${entry.entry.display.groupPath.join(" / ")}`] : []),
    `coverage: ${coverage.state}`,
    ...(coverage.state === "complete" ? [] : [coverage.reason]),
    ...(result.state === "matched" ? [] : [`reason: ${result.reason}`]),
    scoreContributionDetail(entry),
    ...(entry.entry.limitations.length > 0 ? [`limitations: ${entry.entry.limitations.length}`] : []),
  ];
  return parts.join(" · ");
}

function assertionSourceLocation<BlobRef>(
  data: AttemptAssertionsData<BlobRef>,
  entry: AssertionEntryReadV1<BlobRef>,
): string {
  const sites = data.sites?.filter((candidate) => candidate.entryId === entry.entry.entryId) ?? [];
  if (sites.length === 0) return "unmapped";
  return sites
    .map((site) => `${sourceLocation(site.location)} (${site.roles.join(", ")})`)
    .join(", ");
}

function scoreDetail(score: ScoreProjectionV1): string {
  switch (score.state) {
    case "complete":
      return `earned ${score.earned}`;
    case "partial":
      return `earned ${score.earned} · ${score.reasons.join(", ")}`;
    case "unavailable":
      return score.reasons.join(", ");
  }
}

function projectionDetail<Value>(entry: AttemptSlotProjectedEntry<Value>): string {
  if (entry.state !== "attachment-result") {
    switch (entry.state) {
      case "excluded":
        return "excluded by the selected sample";
      case "not-recorded":
        return "no persisted Attempt is available";
      case "core-invalid":
        return "the selected Attempt core is invalid";
    }
  }
  switch (entry.attachment.state) {
    case "available":
      return "available";
    case "unavailable":
      return "the Attachment is unavailable";
    case "migration-required":
      return `migration required · ${entry.attachment.command}`;
    case "migration-unavailable":
      return `migration unavailable · ${entry.attachment.reason}`;
    case "unsupported":
      return `unsupported schema · ${entry.attachment.schemaId}`;
    case "invalid":
      return "invalid Attachment payload";
  }
}

function projectionState<Value>(entry: AttemptSlotProjectedEntry<Value>): string {
  return entry.state === "attachment-result" ? entry.attachment.state : entry.state;
}

function projectionRow<Value>(kind: string, entry: AttemptSlotProjectedEntry<Value>): TableContentRow {
  return {
    key: `${kind.toLowerCase()}:projection`,
    cells: {
      kind: { kind: "text", text: kind },
      key: { kind: "text", text: "attempt" },
      location: { kind: "text", text: "attempt" },
      outcome: { kind: "text", text: projectionState(entry) },
      detail: { kind: "text", text: projectionDetail(entry) },
    },
  };
}

export function attemptAssertionsContent<BlobRef>(data: AttemptAssertionsData<BlobRef> | null): TableContent | null {
  if (data === null) return null;
  const rows: TableContentRow[] = [];
  if (data.verdict.state === "attachment-result" && data.verdict.attachment.state === "available") {
    rows.push({
      key: "verdict",
      cells: {
        kind: { kind: "text", text: "Verdict" },
        key: { kind: "text", text: "attempt" },
        location: { kind: "text", text: "attempt" },
        outcome: { kind: "text", text: data.verdict.attachment.value },
        detail: { kind: "text", text: "four-state Verdict" },
      },
    });
  } else {
    rows.push(projectionRow("Verdict", data.verdict));
  }

  if (data.entries.state === "attachment-result" && data.entries.attachment.state === "available") {
    if (data.entries.attachment.value.length === 0) {
      rows.push({
        key: "assertions:empty",
        cells: {
          kind: { kind: "text", text: "Assertions" },
          key: { kind: "text", text: "attempt" },
          location: { kind: "text", text: "attempt" },
          outcome: { kind: "text", text: "recorded" },
          detail: { kind: "text", text: "no Assertion entries" },
        },
      });
    }
    for (const [index, entry] of data.entries.attachment.value.entries()) {
      const source = assertionSourceLocation(data, entry);
      const groupPath = entry.entry.display.groupPath.join(" / ");
      rows.push({
        key: `assertion:${entry.entry.entryId}:${index}`,
        cells: {
          kind: { kind: "text", text: "Assertion" },
          key: { kind: "text", text: assertionKey(entry) },
          location: { kind: "text", text: source === "unmapped" ? (groupPath || "attempt") : `${source}${groupPath ? ` · ${groupPath}` : ""}` },
          outcome: { kind: "text", text: assertionOutcome(entry) },
          detail: { kind: "text", text: assertionDetail(entry, source) },
        },
      });
    }
  } else {
    rows.push(projectionRow("Assertions", data.entries));
  }

  if (data.score !== undefined && data.score.state === "attachment-result" && data.score.attachment.state === "available") {
    rows.push({
      key: "score",
      cells: {
        kind: { kind: "text", text: "Score" },
        key: { kind: "text", text: "attempt" },
        location: { kind: "text", text: "attempt" },
        outcome: { kind: "text", text: data.score.attachment.value.state },
        detail: { kind: "text", text: scoreDetail(data.score.attachment.value) },
      },
    });
  } else if (data.score !== undefined) {
    rows.push(projectionRow("Score", data.score));
  }
  return {
    columns: [
      { key: "kind", header: "Kind" },
      { key: "key", header: "Key" },
      { key: "location", header: "Scope" },
      { key: "outcome", header: "State" },
      { key: "detail", header: "Detail" },
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
