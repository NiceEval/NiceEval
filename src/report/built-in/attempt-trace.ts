import {
  attemptObservabilityView,
  query,
  type AnalysisIssue,
  type AttemptObservabilityDomainView,
  type AttemptObservabilityDomainDetail,
  type ClosedCommandEntry,
  type ClosedCommandInvocation,
  type ClosedCommandOutcome,
  type ClosedCommandStream,
  type ClosedCommandWorkingDirectory,
  type ClosedCommandsDetail,
  type ClosedConversationDetail,
  type ClosedConversationItem,
  type ClosedConversationTurn,
  type ClosedDiagnosticRedaction,
  type ClosedDiagnosticsDetail,
  type ClosedSourceFrame,
  type ClosedTimingDetail,
  type ClosedTimingInterval,
  type ClosedTraceCollection,
  type ClosedUsageDetail,
  type ClosedUsageObservation,
  type EvidenceRef,
  type SampleSnapshot,
} from "../../analysis/index.ts";
import type { AttemptLocator } from "../../attempt-locator.ts";
import {
  Callout,
  defineComponent,
  Stack,
  Table,
  Text,
} from "../author/index.ts";
import type { ReportNode } from "../semantic/closed.ts";

const SLOT_ROWS_MAX = 200;

export interface AttemptTraceProps {
  readonly grep?: string;
  readonly locator?: AttemptLocator;
  readonly mode: "execution" | "timing";
  readonly timingMode?: "summary" | "full";
}

/**
 * A turn-aware Attempt trace composed from the public, closed Observability
 * DomainView. Renderer faces receive semantic nodes only; this component has
 * no Record reader, path, blob handle, Scope, or renderer callback.
 */
export const AttemptTrace = defineComponent<AttemptTraceProps>(async (props, context) => {
  const observability = await query(context.sample, {
    kind: "domain-view",
    view: attemptObservabilityView,
    ...(props.locator === undefined ? {} : { locator: props.locator }),
  });
  return attemptTraceNode(context.sample.snapshot, observability, props);
});

function attemptTraceNode(
  snapshot: SampleSnapshot,
  observability: AttemptObservabilityDomainView,
  props: AttemptTraceProps,
): ReportNode {
  const entries = sortedEntries(observability);
  return Stack({
    children: [
      observabilityViewBlock(observability),
      attemptSlotTable(
        snapshot,
        observability,
        props.mode === "timing" ? "Timing" : "Observability",
      ),
      ...(entries.length === 0
        ? [Callout({
          tone: "warning",
          title: props.mode === "timing" ? "Timing" : "Trajectory",
          children: [Text({ value: "No included Attempt has closed observability detail." })],
        })]
        : entries.flatMap((entry) => props.mode === "timing"
          ? timingEntryNodes(entry, props.timingMode ?? "summary")
          : executionEntryNodes(entry, props.grep))),
    ],
  });
}

function executionEntryNodes(
  entry: AttemptObservabilityDomainView["entries"][number],
  grepSource: string | undefined,
): readonly ReportNode[] {
  if (entry.state !== "available") return [entryStateBlock("Trajectory", entry)];
  const detail = entry.detail;
  const grep = grepSource === undefined ? undefined : new RegExp(grepSource);
  const { conversation, commands, usage, timing, diagnostics } = detail;
  const complete = [conversation, commands, usage, timing, diagnostics].every(
    (section) => section.collection.state === "complete",
  );
  return [Callout({
    tone: complete ? "neutral" : "warning",
    title: `Trajectory · ${entry.attempt.locator}`,
    children: [
      ...(grep === undefined ? [] : [grepStatusBlock(detail, grep)]),
      traceOverview(conversation, timing, grep !== undefined),
      conversationNode(conversation, grep),
      timingNode(timing, "full"),
      commandsNode(commands, grep),
      usageNode(usage),
      diagnosticsNode(diagnostics),
    ],
  })];
}

function timingEntryNodes(
  entry: AttemptObservabilityDomainView["entries"][number],
  mode: "summary" | "full",
): readonly ReportNode[] {
  if (entry.state !== "available") return [entryStateBlock("Timing", entry)];
  const detail = entry.detail;
  return [Callout({
    tone: detail.timing.collection.state === "complete" ? "neutral" : "warning",
    title: `Timing · ${entry.attempt.locator}`,
    children: [timingNode(detail.timing, mode)],
  })];
}

function traceOverview(
  conversation: ClosedConversationDetail,
  timing: ClosedTimingDetail,
  filtered: boolean,
): ReportNode {
  return Table({
    caption: filtered ? "Trace overview · recorded totals" : "Trace overview",
    columns: [
      { key: "duration", label: "Duration" },
      { key: "turns", label: "Turns", align: "end" },
      { key: "calls", label: "Calls", align: "end" },
    ],
    rows: [{
      duration: recordedSpanText(timing),
      turns: collectionCountText(conversation.turns.length, conversation.collection),
      calls: collectionCountText(
        conversation.items.filter((item) => item.kind === "tool-call").length,
        conversation.collection,
      ),
    }],
  });
}

function recordedSpanText(timing: ClosedTimingDetail): string {
  if (timing.intervals.length === 0) return `not recorded · ${timing.collection.state}`;
  const start = Math.min(...timing.intervals.map((interval) => interval.startOffsetMs));
  const end = Math.max(...timing.intervals.map((interval) =>
    interval.startOffsetMs + interval.durationMs
  ));
  return `${formatDuration(end - start)} recorded span · ${timing.collection.state}`;
}

function collectionCountText(count: number, collection: ClosedTraceCollection): string {
  return `${count} · ${collection.state}`;
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const seconds = Math.round(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function grepStatusBlock(detail: AttemptObservabilityDomainDetail, grep: RegExp): ReportNode {
  const itemsByTurn = conversationItemsByTurn(detail.conversation);
  const ledgerMatches = detail.conversation.turns.reduce((count, turn) => {
    const rows = trajectoryRows(
      [...(itemsByTurn.get(turn.turnId) ?? [])].sort(compareConversationItems),
    );
    return count + rows.filter((row) => grepMatches(grep, trajectoryRowSearchText(row))).length;
  }, 0);
  const commandMatches = detail.commands.entries.filter((command) =>
    grepMatches(grep, commandSearchText(command))
  ).length;
  return Callout({
    tone: ledgerMatches + commandMatches === 0 ? "warning" : "neutral",
    title: `Filter · /${grep.source}/`,
    children: [Text({
      value: `Matched ${ledgerMatches} conversation ledger row(s) and ${commandMatches} command(s). Tool calls retain their paired result in one row; timing, usage, and diagnostics remain unfiltered.`,
    })],
  });
}

function conversationNode(
  conversation: ClosedConversationDetail,
  grep: RegExp | undefined,
): ReportNode {
  const itemsByTurn = conversationItemsByTurn(conversation);
  const turnNodes = [...conversation.turns].sort(compareConversationTurns).flatMap((turn) => {
    const items = [...(itemsByTurn.get(turn.turnId) ?? [])].sort(compareConversationItems);
    const rows = trajectoryRows(items).filter((row) =>
      grep === undefined || grepMatches(grep, trajectoryRowSearchText(row))
    );
    if (grep !== undefined && rows.length === 0) return [];
    return [Callout({
      tone: turn.outcome === "completed" ? "neutral" : "warning",
      title: `Turn ${turn.sequence} · ${turn.outcome}`,
      children: rows.length === 0
        ? [Text({ value: "No closed conversation items." })]
        : [Table({
          caption: `Turn ${turn.sequence} ledger`,
          columns: [
            { key: "index", label: "#", align: "end" },
            { key: "event", label: "Event" },
            { key: "content", label: "Content" },
            { key: "result", label: "Result" },
          ],
          rows,
        })],
    })];
  });
  const emptyNode = conversation.turns.length === 0
    ? Text({ value: "No closed conversation turns." })
    : Text({ value: `No closed conversation ledger rows match /${grep?.source ?? ""}/.` });
  return Callout({
    tone: collectionTone(conversation.collection),
    title: "Conversation trajectory",
    children: [
      ...collectionStateNodes("Conversation", conversation.collection),
      ...(turnNodes.length === 0 ? [emptyNode] : turnNodes),
    ],
  });
}

function conversationItemsByTurn(
  conversation: ClosedConversationDetail,
): ReadonlyMap<string, readonly ClosedConversationItem[]> {
  const itemsByTurn = new Map<string, ClosedConversationItem[]>();
  for (const item of conversation.items) {
    const items = itemsByTurn.get(item.turnId) ?? [];
    items.push(item);
    itemsByTurn.set(item.turnId, items);
  }
  return itemsByTurn;
}

interface TrajectoryRow {
  readonly index: number;
  readonly event: string;
  readonly content: string;
  readonly result: string;
}

function trajectoryRowSearchText(row: TrajectoryRow): string {
  return `${row.event}\n${row.content}\n${row.result}`;
}

function trajectoryRows(items: readonly ClosedConversationItem[]): readonly TrajectoryRow[] {
  const resultsByCall = new Map<
    string,
    Extract<ClosedConversationItem, { readonly kind: "tool-result" }>
  >();
  for (const item of items) {
    if (item.kind === "tool-result") resultsByCall.set(item.callId, item);
  }
  const consumedResults = new Set<string>();
  const rows: TrajectoryRow[] = [];
  for (const item of items) {
    if (item.kind === "tool-result" && consumedResults.has(item.callId)) continue;
    if (item.kind === "tool-call") {
      const result = resultsByCall.get(item.callId);
      if (result !== undefined) consumedResults.add(item.callId);
      rows.push(Object.freeze({
        index: item.sequence,
        event: "TOOL",
        content: `${item.tool}(${item.inputSummary})`,
        result: result === undefined
          ? "result not recorded"
          : `${result.outcome} · ${result.outputSummary}`,
      }));
      continue;
    }
    rows.push(conversationItemRow(item));
  }
  return Object.freeze(rows);
}

function conversationItemRow(item: ClosedConversationItem): TrajectoryRow {
  switch (item.kind) {
    case "message":
      return Object.freeze({
        index: item.sequence,
        event: item.role === "assistant" ? "ASSISTANT" : "USER",
        content: item.text.length === 0 && item.role === "assistant" ? "(tool call only)" : item.text,
        result: "",
      });
    case "tool-result":
      return Object.freeze({
        index: item.sequence,
        event: "TOOL RESULT",
        content: item.callId,
        result: `${item.outcome} · ${item.outputSummary}`,
      });
    case "thinking-summary":
      return simpleTrajectoryRow(item, "THINKING", item.summary);
    case "compaction":
      return simpleTrajectoryRow(item, "COMPACTION", item.summary);
    case "context-injection":
      return simpleTrajectoryRow(item, "CONTEXT", item.summary);
    case "subagent":
      return simpleTrajectoryRow(item, "SUBAGENT", `${item.label} · ${item.state} · ${item.summary}`);
    case "input-request":
      return Object.freeze({
        index: item.sequence,
        event: "INPUT",
        content: `${item.state} · ${item.promptSummary}`,
        result: item.responseSummary ?? "response not recorded",
      });
    case "skill-load":
      return simpleTrajectoryRow(item, "SKILL", `${item.code} · ${item.summary}`);
    case "conversation-error":
      return simpleTrajectoryRow(item, "ERROR", `${item.code} · ${item.summary}`);
    case "tool-call":
      return simpleTrajectoryRow(item, "TOOL", `${item.tool}(${item.inputSummary})`);
  }
}

function simpleTrajectoryRow(
  item: Pick<ClosedConversationItem, "itemId" | "turnId" | "sequence">,
  event: string,
  content: string,
): TrajectoryRow {
  return Object.freeze({ index: item.sequence, event, content, result: "" });
}

function compareConversationTurns(left: ClosedConversationTurn, right: ClosedConversationTurn): number {
  return left.sequence - right.sequence || compareText(left.turnId, right.turnId);
}

function compareConversationItems(left: ClosedConversationItem, right: ClosedConversationItem): number {
  return left.sequence - right.sequence || compareText(left.itemId, right.itemId);
}

function timingNode(
  timing: ClosedTimingDetail,
  mode: "summary" | "full",
): ReportNode {
  const rows = timingTreeRows(timing.intervals);
  return Callout({
    tone: collectionTone(timing.collection),
    title: "Timing overview",
    children: [
      ...collectionStateNodes("Timing", timing.collection),
      ...(rows.length === 0
        ? [Text({ value: "No closed timing intervals." })]
        : [timingTable(rows, mode)]),
    ],
  });
}

function timingTable(
  rows: readonly TimingTreeRow[],
  mode: "summary" | "full",
): ReportNode {
  if (mode === "summary") {
    return Table({
      caption: "Timing tree summary",
      columns: [
        { key: "depth", label: "Depth", align: "end" },
        { key: "phase", label: "Phase" },
        { key: "label", label: "Label" },
        { key: "duration", label: "Duration (ms)", align: "end" },
        { key: "outcome", label: "Outcome" },
      ],
      rows: rows.map((row) => ({
        depth: row.depth,
        phase: row.phase,
        label: row.label,
        duration: row.duration,
        outcome: row.outcome,
      })),
    });
  }
  return Table({
    caption: "Timing tree",
    columns: [
      { key: "interval", label: "Interval" },
      { key: "parent", label: "Parent" },
      { key: "depth", label: "Depth", align: "end" },
      { key: "phase", label: "Phase" },
      { key: "label", label: "Label" },
      { key: "start", label: "Start (ms)", align: "end" },
      { key: "duration", label: "Duration (ms)", align: "end" },
      { key: "outcome", label: "Outcome" },
    ],
    rows,
  });
}

interface TimingTreeRow {
  readonly interval: string;
  readonly parent: string;
  readonly depth: number;
  readonly phase: string;
  readonly label: string;
  readonly start: number;
  readonly duration: number;
  readonly outcome: string;
}

function timingTreeRows(intervals: readonly ClosedTimingInterval[]): readonly TimingTreeRow[] {
  const children = new Map<string | null, ClosedTimingInterval[]>();
  for (const interval of intervals) {
    const siblings = children.get(interval.parentIntervalId) ?? [];
    siblings.push(interval);
    children.set(interval.parentIntervalId, siblings);
  }
  const rows: TimingTreeRow[] = [];
  const visit = (interval: ClosedTimingInterval, depth: number): void => {
    rows.push(Object.freeze({
      interval: interval.intervalId,
      parent: interval.parentIntervalId ?? "root",
      depth,
      phase: interval.phase,
      label: interval.phase === "agent.send" ? `turn ${interval.label}` : interval.label,
      start: interval.startOffsetMs,
      duration: interval.durationMs,
      outcome: interval.outcome,
    }));
    for (const child of [...(children.get(interval.intervalId) ?? [])].sort(compareTimingIntervals)) {
      visit(child, depth + 1);
    }
  };
  for (const root of [...(children.get(null) ?? [])].sort(compareTimingIntervals)) visit(root, 0);
  return Object.freeze(rows);
}

function compareTimingIntervals(left: ClosedTimingInterval, right: ClosedTimingInterval): number {
  return left.startOffsetMs - right.startOffsetMs || compareText(left.intervalId, right.intervalId);
}

function commandsNode(
  commands: ClosedCommandsDetail,
  grep: RegExp | undefined,
): ReportNode {
  const entries = grep === undefined
    ? commands.entries
    : commands.entries.filter((command) => grepMatches(grep, commandSearchText(command)));
  return Callout({
    tone: collectionTone(commands.collection),
    title: "Commands",
    children: [
      ...collectionStateNodes("Commands", commands.collection),
      ...(entries.length === 0
        ? [Text({
          value: grep === undefined
            ? "No closed commands."
            : `No closed commands match /${grep.source}/.`,
        })]
        : entries.map((command) => Callout({
          tone: commandOutcomeTone(command.result.outcome),
          title: `Command · ${command.commandId}`,
          children: [
            Table({
              caption: "Command invocation",
              columns: [
                { key: "phase", label: "Phase" },
                { key: "invocation", label: "Invocation" },
                { key: "workingDirectory", label: "Working directory" },
                { key: "outcome", label: "Outcome" },
              ],
              rows: [{
                phase: command.manifest.phase,
                invocation: commandInvocationText(command.manifest.invocation),
                workingDirectory: workingDirectoryText(command.manifest.workingDirectory),
                outcome: commandOutcomeText(command.result.outcome),
              }],
            }),
            Text({ value: `stdout · ${commandStreamText(command.result.stdout)}` }),
            Text({ value: `stderr · ${commandStreamText(command.result.stderr)}` }),
          ],
        }))),
    ],
  });
}

function commandSearchText(command: ClosedCommandEntry): string {
  return [
    command.commandId,
    command.manifest.phase,
    commandInvocationText(command.manifest.invocation),
    workingDirectoryText(command.manifest.workingDirectory),
    commandOutcomeText(command.result.outcome),
    commandStreamText(command.result.stdout),
    commandStreamText(command.result.stderr),
  ].join("\n");
}

function grepMatches(grep: RegExp, value: string): boolean {
  grep.lastIndex = 0;
  return grep.test(value);
}

function commandInvocationText(invocation: ClosedCommandInvocation): string {
  return invocation.kind === "shell"
    ? invocation.command
    : [invocation.executable, ...invocation.arguments].join(" ");
}

function workingDirectoryText(directory: ClosedCommandWorkingDirectory): string {
  return directory.kind === "project-relative" ? directory.path : directory.kind;
}

function commandOutcomeText(outcome: ClosedCommandOutcome): string {
  switch (outcome.kind) {
    case "exited":
      return `exited (code ${outcome.exitCode})`;
    case "terminated":
      return `terminated (${outcome.reason})`;
    case "not-started":
      return `not started (${outcome.reason})`;
  }
}

function commandOutcomeTone(outcome: ClosedCommandOutcome): "neutral" | "warning" | "negative" {
  if (outcome.kind === "exited") return outcome.exitCode === 0 ? "neutral" : "negative";
  return "warning";
}

function commandStreamText(stream: ClosedCommandStream): string {
  const count = `${stream.retainedBytes}/${stream.totalSafeUtf8Bytes} byte(s)`;
  if (stream.kind === "inline") return `${count}\n${stream.text}`;
  if (stream.content.state === "available") return `${count}\n${stream.content.text}`;
  return `${count} · ${stream.content.state}`;
}

function usageNode(usage: ClosedUsageDetail): ReportNode {
  return Callout({
    tone: collectionTone(usage.collection),
    title: "Usage",
    children: [
      ...collectionStateNodes("Usage", usage.collection),
      ...(usage.observations.length === 0
        ? [Text({ value: "No closed usage observations." })]
        : [Table({
          caption: "Usage observations",
          columns: [
            { key: "provider", label: "Provider" },
            { key: "kind", label: "Kind" },
            { key: "value", label: "Value" },
          ],
          rows: usage.observations.map((observation) => ({
            provider: observation.provider,
            kind: observation.kind,
            value: usageObservationText(observation),
          })),
        })]),
    ],
  });
}

function usageObservationText(observation: ClosedUsageObservation): string {
  switch (observation.kind) {
    case "token-bucket":
      return `${observation.bucket}: ${observation.tokens} token(s)`;
    case "request":
      return `${observation.requestKind} request`;
    case "provider-cost":
      return `${observation.amount} ${observation.currency}`;
  }
}

function diagnosticsNode(diagnostics: ClosedDiagnosticsDetail): ReportNode {
  return Callout({
    tone: collectionTone(diagnostics.collection),
    title: "Diagnostics",
    children: [
      ...collectionStateNodes("Diagnostics", diagnostics.collection),
      ...(diagnostics.diagnostics.length === 0
        ? [Text({ value: "No closed diagnostics." })]
        : diagnostics.diagnostics.map((diagnostic) => Callout({
          tone: diagnostic.kind === "execution-error" ? "negative" : "warning",
          title: `Diagnostic · ${diagnostic.kind} · ${diagnostic.code}`,
          children: [
            Text({ value: `Phase: ${diagnostic.phase}` }),
            Text({ value: diagnostic.summary }),
            ...(diagnostic.causes.length === 0
              ? [Text({ value: "Causes: none recorded" })]
              : diagnostic.causes.map((cause) =>
                Text({ value: `Cause: ${cause.code} · ${cause.summary}` })
              )),
            Text({ value: `Redaction: ${redactionText(diagnostic.redaction)}` }),
            Text({ value: `Source frame: ${sourceFrameText(diagnostic.sourceFrame)}` }),
          ],
        }))),
    ],
  });
}

function redactionText(redaction: ClosedDiagnosticRedaction): string {
  return redaction.state === "none" ? "none" : `applied · ${redaction.replacements} replacement(s)`;
}

function sourceFrameText(sourceFrame: ClosedSourceFrame | null): string {
  if (sourceFrame === null) return "none";
  return `${sourceFrame.sourceItemId} · ${sourceFrame.start.line}:${sourceFrame.start.column}–${sourceFrame.end.line}:${sourceFrame.end.column}`;
}

function observabilityViewBlock(observability: AttemptObservabilityDomainView): ReportNode {
  const issues = [...observability.issues].sort((left, right) =>
    compareText(issueText(left), issueText(right))
  );
  const refs = [...observability.refs].sort((left, right) =>
    compareText(evidenceRefText(left), evidenceRefText(right))
  );
  return Callout({
    tone: issues.length === 0 ? "neutral" : "warning",
    title: "Observability view",
    children: [
      Text({ value: `View: ${observability.view}` }),
      Text({ value: `Closed entries: ${observability.entries.length}` }),
      ...issues.map((issue) => Text({ value: `Issue: ${issueText(issue)}` })),
      ...refs.map((reference) => Text({ value: `Evidence: ${evidenceRefText(reference)}` })),
    ],
  });
}

function entryStateBlock(
  name: string,
  entry: AttemptObservabilityDomainView["entries"][number],
): ReportNode {
  return Callout({
    tone: entry.state === "not-recorded" || entry.state === "unsupported" ? "warning" : "negative",
    title: `${name} · ${entry.attempt.locator}`,
    children: [
      Text({ value: `Entry state: ${entry.state}` }),
      ...(entry.state === "failed"
        ? [Text({ value: `Detail: ${stableJson(entry.detail)}` })]
        : []),
    ],
  });
}

function collectionTone(collection: ClosedTraceCollection): "neutral" | "warning" {
  return collection.state === "complete" ? "neutral" : "warning";
}

function collectionStateNodes(
  name: string,
  collection: ClosedTraceCollection,
): readonly ReportNode[] {
  return Object.freeze([
    Text({ value: `${name} state: ${collection.state}` }),
    ...collection.limitations.map((limitation) =>
      Text({ value: `${name} limitation: ${stableJson(limitation)}` })
    ),
  ]);
}

function issueText(issue: AnalysisIssue): string {
  const refs = issue.refs.length === 0
    ? ""
    : ` (${[...issue.refs]
      .sort((left, right) => compareText(evidenceRefText(left), evidenceRefText(right)))
      .map(evidenceRefText)
      .join(", ")})`;
  return `${issue.code}: ${issue.message}${refs}`;
}

function evidenceRefText(reference: EvidenceRef): string {
  return reference.identity.locator;
}

function sortedEntries(
  observability: AttemptObservabilityDomainView,
): readonly AttemptObservabilityDomainView["entries"][number][] {
  return Object.freeze([...observability.entries].sort((left, right) =>
    compareText(left.attempt.locator, right.attempt.locator)
  ));
}

function attemptSlotTable(
  snapshot: SampleSnapshot,
  observability: AttemptObservabilityDomainView,
  label: string,
): ReportNode {
  const byLocator = indexEntriesByLocator(observability.entries);
  const slots = snapshot.slots.slice(0, SLOT_ROWS_MAX);
  const omitted = snapshot.slots.length - slots.length;
  return Stack({
    children: [
      Table({
        caption: "Selected slots",
        columns: [
          { key: "runId", label: "Run" },
          { key: "slotId", label: "Slot" },
          { key: "state", label: "State" },
          { key: "observability", label },
        ],
        rows: slots.map((slot) => ({
          runId: slot.runId,
          slotId: slot.slotId,
          state: slot.state,
          observability: slot.state === "included"
            ? entryStateAtLocator(byLocator, slot.attempt.locator)
            : `not queried · slot ${slot.state}`,
        })),
      }),
      ...(omitted === 0
        ? []
        : [Callout({
          tone: "warning",
          title: "Bounded summary",
          children: [Text({ value: `Omitted slots: ${omitted}` })],
        })]),
    ],
  });
}

interface LocatorEntryIndex<Entry extends { readonly attempt: { readonly locator: string } }> {
  readonly entries: ReadonlyMap<string, Entry>;
  readonly duplicates: ReadonlySet<string>;
}

function indexEntriesByLocator<
  Entry extends { readonly attempt: { readonly locator: string } },
>(entries: readonly Entry[]): LocatorEntryIndex<Entry> {
  const unique = new Map<string, Entry>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    const locator = entry.attempt.locator;
    if (unique.has(locator)) {
      duplicates.add(locator);
      unique.delete(locator);
      continue;
    }
    if (!duplicates.has(locator)) unique.set(locator, entry);
  }
  return Object.freeze({ entries: unique, duplicates });
}

function entryStateAtLocator(
  index: LocatorEntryIndex<AttemptObservabilityDomainView["entries"][number]>,
  locator: string,
): string {
  if (index.duplicates.has(locator)) return "duplicate entry";
  return index.entries.get(locator)?.state ?? "missing entry";
}

function stableJson(value: ClosedTraceCollection["limitations"][number]): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isClosedLimitationArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort(compareText)
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key]!)}`)
    .join(",")}}`;
}

function isClosedLimitationArray(
  value: ClosedTraceCollection["limitations"][number],
): value is readonly ClosedTraceCollection["limitations"][number][] {
  return Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
