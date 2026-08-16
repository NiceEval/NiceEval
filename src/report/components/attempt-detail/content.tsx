// Attempt 详情 Content 投影：compute 领域结果 → 原语 Content 形状。
// 输入全部是当前闭合 DomainView 派生的普通值。

import { Conversation, Text } from "../../definition/primitives.tsx";
import type { ReportNode } from "../../definition/tree.ts";
import type { CalloutGroup, CalloutItem } from "../../definition/primitives/callouts-logic.ts";
import type { CopyBlockContent } from "../../definition/primitives/copy-block.tsx";
import type { CommandEvidenceContent, ConversationContent, ConversationEntry, ConversationTurn } from "../../definition/primitives/conversation.tsx";
import type { DiffContent } from "../../definition/primitives/diff-lines.ts";
import type {
  SourceBlockContent,
  SourceContent,
  SourceLine,
  SourceLineTone,
} from "../../definition/primitives/source-view.tsx";
import type { WaterfallContent, WaterfallNode } from "../../definition/primitives/waterfall.tsx";
import type { TableContent, TableContentRow } from "../../definition/cell.ts";
import type { ClosedTimingInterval } from "../../../analysis/index.ts";
import { formatDurationMs, formatPointsSuffix } from "../../model/format.ts";
import { localizedMessage } from "../../model/locale.ts";
import { normalizeTurnLabel } from "../../../shared/turn-label.ts";
import type {
  AttemptAssertionsData,
  AttemptAssertionView,
  AttemptCommandEvidenceData,
  AttemptConversationData,
  AttemptConversationReply,
  AttemptDiagnosticsData,
  AttemptDiffData,
  AttemptErrorData,
  AttemptFixPromptData,
  AttemptSourceData,
  AttemptSourceItemView,
  AttemptTimelineData,
  AttemptTraceData,
} from "./compute.ts";

// ───────────────────────── AttemptSource ─────────────────────────

/** 该行 assertion 的判定摘要行 tone:与源码行状态同一套色。 */
function assertionToneClass(assertion: AttemptAssertionView): string {
  if (assertion.outcome === "unavailable") return "niceeval-tone-na";
  if (assertion.outcome === "passed") return "niceeval-tone-good";
  return assertion.severity === "gate" ? "niceeval-tone-bad" : "niceeval-tone-warn";
}

/**
 * 一条 assertion 在展开区里的呈现:一行判定摘要,再接一段详情正文
 * (docs/feature/reports/library.md「源码行展开区里有什么」)。
 */
function assertionNodes(assertion: AttemptAssertionView, key: string): ReportNode[] {
  const points =
    assertion.outcome !== "unavailable" && assertion.score !== undefined
      ? ` ${formatPointsSuffix(assertion.score.state === "earned" ? assertion.score.earned ?? 0 : 0)}`
      : "";
  const head = `${assertion.name} · ${assertion.severity} ${assertion.outcome}${points}`;
  const nodes: ReportNode[] = [
    <Text key={`${key}:head`} className={`niceeval-source-assertion ${assertionToneClass(assertion)}`}>
      {head}
    </Text>,
  ];
  if (assertion.detail.length > 0) {
    nodes.push(
      <Text key={`${key}:body`} className="niceeval-source-assertion-body">
        {assertion.detail}
      </Text>,
    );
  }
  return nodes;
}

function lineToneOf(assertions: readonly AttemptAssertionView[]): SourceLineTone | undefined {
  if (assertions.some((assertion) => assertion.outcome === "failed" && assertion.severity === "gate")) return "gate-fail";
  if (assertions.some((assertion) => assertion.outcome === "failed")) return "soft-fail";
  if (assertions.some((assertion) => assertion.outcome === "unavailable")) return "unavailable";
  if (assertions.some((assertion) => assertion.outcome === "passed")) return "passed";
  return undefined;
}

interface SiteLineBinding {
  readonly entry: AttemptAssertionView;
  readonly role: string;
  readonly line: number;
}

/** sourceSites → 每行注解绑定:detail 落在起始行,tone 覆盖整个行区间。 */
function siteBindingsOf(data: AttemptSourceData): ReadonlyMap<string, readonly SiteLineBinding[]> {
  const entriesById = new Map(data.entries.map((entry) => [entry.entryId, entry] as const));
  const bindings = new Map<string, SiteLineBinding[]>();
  for (const site of data.sites) {
    const entry = entriesById.get(site.entryId);
    if (entry === undefined) continue;
    for (let line = site.startLine; line <= site.endLine; line += 1) {
      const bucket = bindings.get(`${site.sourceItemId}:${line}`) ?? [];
      bucket.push({ entry, role: site.role, line: site.startLine });
      bindings.set(`${site.sourceItemId}:${line}`, bucket);
    }
  }
  return bindings;
}

function sourceItemBlock(
  item: AttemptSourceItemView,
  data: AttemptSourceData,
  bindings: ReadonlyMap<string, readonly SiteLineBinding[]>,
): SourceBlockContent {
  const lines: SourceLine[] = item.lines.map((text, index): SourceLine => {
    const line = index + 1;
    const bound = bindings.get(`${item.sourceItemId}:${line}`) ?? [];
    const assertions = bound.filter((binding) => binding.role !== "score").map((binding) => binding.entry);
    const details = bound
      .filter((binding) => binding.line === line && binding.role !== "score")
      .map((binding, detailIndex) => assertionNodes(binding.entry, `${item.path}:${line}:${detailIndex}`))
      .flat();
    const points = bound
      .filter((binding) => binding.role === "score")
      .reduce((sum, binding) =>
        sum + (binding.entry.score?.state === "earned" ? binding.entry.score.earned ?? 0 : 0), 0);
    const hasPoints = bound.some((binding) => binding.role === "score" && binding.entry.score !== undefined);
    const tone = lineToneOf(assertions);
    const turnIds = (data.navigation?.rows ?? [])
      .filter((row) =>
        row.source.state === "mapped" &&
        row.source.sourceItemId === item.sourceItemId &&
        row.source.sha256 === item.sha256 &&
        row.source.start.line === line
      )
      .sort((left, right) =>
        (left.sourceOrder ?? Number.MAX_SAFE_INTEGER) - (right.sourceOrder ?? Number.MAX_SAFE_INTEGER) ||
        (left.turnId < right.turnId ? -1 : left.turnId > right.turnId ? 1 : 0)
      )
      .map((row) => row.turnId);
    return {
      number: line,
      text,
      ...(turnIds.length > 0 ? { interaction: "send" as const, turnIds } : {}),
      ...(tone !== undefined ? { tone } : {}),
      ...(hasPoints ? { pill: formatPointsSuffix(points) } : {}),
      ...(details.length > 0 ? { details } : {}),
    };
  });
  return { path: item.path, lines };
}

/**
 * 闭合 Sources + sourceSites → SourceView Content。spine 是第一个 source item,
 * 其余是 detached;没有 sourceSite 的 attention 断言进 unmapped 区,不丢弃。
 */
export function projectedSourceContent(
  data: AttemptSourceData | null,
  locator?: AttemptSourceData["locator"],
): SourceContent | null {
  if (data === null) return null;
  const bindings = siteBindingsOf(data);
  const referenced = new Set(data.sites.map((site) => site.entryId));
  const unmapped: ReportNode[] = data.entries
    .filter((entry) => !referenced.has(entry.entryId))
    .flatMap((entry, index) => assertionNodes(entry, `unmapped:${index}`));
  const spine = sourceItemBlock(data.items[0]!, data, bindings);
  const detached = data.items.slice(1).map((item) => sourceItemBlock(item, data, bindings));
  return {
    spine,
    detached,
    ...(unmapped.length > 0 ? { unmapped } : {}),
    ...(locator !== undefined ? { locator } : {}),
  };
}

// ───────────────────────── AttemptAssertions ─────────────────────────

export function attemptAssertionsContent(data: AttemptAssertionsData | null): TableContent | null {
  if (data === null || (data.attention.length === 0 && data.passedGroups.length === 0)) return null;
  const rows: TableContentRow[] = [];
  for (const assertion of data.attention) {
    rows.push({
      key: assertion.entryId,
      cells: {
        name: { kind: "text", text: assertion.name },
        severity: { kind: "text", text: assertion.severity },
        outcome: { kind: "verdict", verdict: assertion.outcome === "unavailable" ? "skipped" : assertion.outcome },
        detail: assertion.detail.length > 0
          ? { kind: "text", text: assertion.detail }
          : { kind: "notApplicable" },
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

// ───────────────────────── AttemptTimeline / AttemptTrace ─────────────────────────

function timingTree(intervals: readonly ClosedTimingInterval[]): readonly WaterfallNode[] {
  const children = new Map<string | null, ClosedTimingInterval[]>();
  for (const interval of intervals) {
    const siblings = children.get(interval.parentIntervalId) ?? [];
    siblings.push(interval);
    children.set(interval.parentIntervalId, siblings);
  }
  const build = (parent: string | null): WaterfallNode[] =>
    (children.get(parent) ?? [])
      .sort(compareIntervals)
      .map((interval) => {
        const phase = interval.phase;
        return {
          key: interval.intervalId,
          label: phase === "agent.send" ? normalizeTurnLabel(interval.label) : interval.label,
          kind: phase,
          startOffsetMs: interval.startOffsetMs,
          durationMs: interval.durationMs,
          ...(interval.outcome === "failed" || interval.outcome === "interrupted" ? { failed: true as const } : {}),
          // 主干默认展开:直接看到 eval.run 与 agent.send 内部活动。
          ...(phase === "eval.run" || phase === "agent.send" ? { open: true as const } : {}),
          ...(build(interval.intervalId).length > 0 ? { children: build(interval.intervalId) } : {}),
        };
      });
  return build(null);
}

function compareIntervals(left: ClosedTimingInterval, right: ClosedTimingInterval): number {
  return left.startOffsetMs - right.startOffsetMs || compareText(left.intervalId, right.intervalId);
}

function timingSpan(intervals: readonly ClosedTimingInterval[]): number | null {
  if (intervals.length === 0) return null;
  const start = Math.min(...intervals.map((interval) => interval.startOffsetMs));
  const end = Math.max(...intervals.map((interval) => interval.startOffsetMs + interval.durationMs));
  return Math.max(0, end - start);
}

/** 执行时间树:root 区间是 phase 主链,children 是采集侧层级。 */
export function attemptTimelineContent(data: AttemptTimelineData | null): WaterfallContent | null {
  if (data === null) return null;
  return [
    {
      key: data.locator,
      label: data.locator,
      durationMs: timingSpan(data.intervals),
      locator: data.locator,
      nodes: timingTree(data.intervals),
    },
  ];
}

export function attemptTraceContent(data: AttemptTraceData | null): WaterfallContent | null {
  if (data === null) return null;
  return [
    {
      key: data.locator,
      label: data.locator,
      durationMs: timingSpan(data.intervals),
      locator: data.locator,
      nodes: timingTree(data.intervals),
    },
  ];
}

// ───────────────────────── AttemptConversation ─────────────────────────

/** 工具出入参等结构化值:JSON 化后交原语收口成单行预览(Conversation 的 preview 契约)。 */
function jsonPreview(value: string | undefined): string {
  return value === undefined ? "" : value;
}

function conversationEntryOf(reply: AttemptConversationReply): ConversationEntry {
  switch (reply.kind) {
    case "assistant":
    case "user":
    case "thinking":
    case "error":
      return { kind: reply.kind, preview: reply.text, failed: reply.kind === "error" };
    case "context":
      return { kind: "context", preview: reply.text };
    case "tool": {
      const output = jsonPreview(reply.outputSummary);
      return {
        kind: "tool",
        preview: `${reply.name}(${jsonPreview(reply.inputSummary)})`,
        ...(reply.failed === true ? { failed: true } : {}),
        ...(output ? { detail: <Text>{`${reply.outcome ?? "completed"}\n${output}`}</Text> } : {}),
      };
    }
    case "subagent":
      return {
        kind: "subagent",
        preview: reply.name,
        ...(reply.failed === true ? { failed: true } : {}),
        ...(reply.summary ? { detail: <Text>{reply.summary}</Text> } : {}),
      };
    case "skill":
      return { kind: "skill", preview: reply.text ? `${reply.skill}: ${reply.text}` : reply.skill };
    case "input":
      return {
        kind: "input",
        preview: `${reply.request.state} · ${reply.request.promptSummary}`,
        ...(reply.request.responseSummary !== null
          ? { detail: <Text>{reply.request.responseSummary}</Text> }
          : {}),
      };
    case "compaction":
      return { kind: "compaction", preview: reply.text || "context compacted" };
  }
}

function turnVerdictOf(outcome: AttemptConversationData["rounds"][number]["outcome"]): ConversationTurn["verdict"] {
  switch (outcome) {
    case "completed":
      return undefined;
    case "failed":
      return "failed";
    case "cancelled":
      return "skipped";
    case "interrupted":
      return "errored";
  }
}

export function attemptConversationContent(data: AttemptConversationData | null): ConversationContent | null {
  if (data === null || data.rounds.length === 0) return null;
  const turns: ConversationTurn[] = data.rounds.map((round) => ({
    key: round.turnId,
    label: `Turn ${round.sequence}${round.durationMs === undefined ? "" : ` · ${formatDurationMs(round.durationMs)}`}`,
    verdict: turnVerdictOf(round.outcome),
    entries: round.replies.map(conversationEntryOf),
  }));
  return { turns, locator: data.locator };
}

// ───────────────────────── AttemptCommandEvidence ─────────────────────────

export function attemptCommandEvidenceContent(data: AttemptCommandEvidenceData | null): CommandEvidenceContent | null {
  if (data === null || data.commands.length === 0) return null;
  return { locator: data.locator, commands: data.commands };
}

// ───────────────────────── AttemptDiagnostics / AttemptError ─────────────────────────

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
      (diagnostic): CalloutItem => ({
        level: diagnostic.level,
        message: `${diagnostic.code}: ${diagnostic.summary}`,
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

// ───────────────────────── Conversation 嵌入源码 ─────────────────────────

/**
 * 只按已验证的 navigation turnId 将 Conversation 轮嵌入源码 send 行；没有
 * mapped row 的轮留在页尾。这里禁止按标签、源码顺序或数组位置补配。
 */
export function embedConversationInSource(
  source: SourceContent | null,
  conversation: ConversationContent | null,
): { source: SourceContent | null; conversation: ConversationContent | null } {
  const turns = conversation?.turns ?? [];
  const turnById = new Map(turns.map((turn) => [turn.key, turn] as const));
  const mappedTurnIds = new Set<string>();

  const cloneLine = (line: SourceLine): SourceLine => {
    const lineTurns = (line.turnIds ?? []).flatMap((turnId) => {
      const turn = turnById.get(turnId);
      if (turn === undefined) return [];
      mappedTurnIds.add(turnId);
      return [turn];
    });
    const details =
      line.details === undefined && lineTurns.length === 0
        ? undefined
        : [
            ...(line.details ?? []),
            ...(lineTurns.length === 0 ? [] : [<Conversation data={{ turns: lineTurns }} />]),
          ];
    return {
      ...line,
      ...(details === undefined ? {} : { details }),
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
  const remainingTurns = turns.filter((turn) => !mappedTurnIds.has(turn.key));
  const remainingConversation = conversation === null || remainingTurns.length === 0
    ? null
    : { ...conversation, turns: remainingTurns };
  return { source: embeddedSource, conversation: remainingConversation };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
