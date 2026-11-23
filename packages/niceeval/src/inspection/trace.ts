// @concord-file
// @concord-implements docs/feature/inspection/README.md
// @concord-implements docs/feature/insight/README.md
import { projectLifecyclePhase } from "./lifecycle.ts";
import { repriceRecordedUsage, type InspectionRepricingInput, type InspectionRepricingResult } from "./repricing.ts";
import {
  effectiveCostTotals,
  effectiveUsageCalls,
  adapterTokenMaterial,
  projectAdapterModelUsage,
} from "../o11y/adapter-usage-projection.ts";
import { projectJudgeUsage, projectTotalUsageCosts } from "../o11y/judge-usage-projection.ts";
import { recordedCostGaps, type RecordedTotalUsageCosts } from "../o11y/cost-gaps.ts";
import type { ModelRolesWire } from "../model-roles.ts";

import { Result, Schema } from "effect";

import { mintRecordContentHandle } from "../record/attachment/content.ts";
import {
  hydrateRecordAttachmentCurrentWithClosure,
  mintRecordAttachmentReference,
  RecordAttachmentReference,
  recordAttachmentReferenceWire,
  type RecordAttachmentDefinition,
} from "../record/attachment/protocol.ts";
import { type ReadableAdapterUsageAttachment } from "../record/family/adapter-usage/schema.ts";
import { NiceEvalCurrentRecordAttachments } from "../record/family/current.ts";
import {
  AgentTurnsAttachmentSchema,
  validateAgentTurnsEnvelope,
  type AgentTurnsAttachment,
} from "../record/family/agent-turns/schema.ts";
import type { DecodedInspectionAttachment } from "./facts.ts";
import { projectObservedSourceEvents } from "../o11y/derive.ts";
import { ExecutionTraceRecordLimits } from "../record/family/execution-traces/schema.ts";
import type { AgentTurnOutcome } from "../record/family/protocol-values.ts";
import type { RecordAttachmentOwner } from "../record/model/core.ts";
import type { SourceReceiptLimitation } from "../record/family/source-receipt/index.ts";
import type { PersistedContentMetadata, SealedAttachmentMetadata } from "../record/sqlite/index.ts";
import type { InspectionJson } from "./codec.ts";
import { InspectionSha256, utf8ByteLength } from "./bytes.ts";
import {
  INSPECTION_RESULT_PAGE_BYTES,
  INSPECTION_USAGE_CALL_PAGE_BYTES,
  INSPECTION_USAGE_CALL_PAGE_SIZE,
} from "./limits.ts";
import { callPage } from "./collection-page.ts";
import {
  decodeExecutionTraceContinuation,
  encodeExecutionTraceContinuation,
  EXECUTION_TRACE_CONTINUATION_FAMILIES,
  type ExecutionTraceFilters,
} from "./execution-traces.ts";
import type { InspectionFactSource } from "./source.ts";
import type {
  InspectionAttemptTimingResult,
  InspectionAttemptUsageResult,
  InspectionTraceDetailResult,
  InspectionTraceResult,
} from "./results.ts";

const CONTENT_PAGE_SIZE = 64;
const MAX_SOURCE_LIMITATIONS = 32;
const MAX_CONVERSATION_TURNS = 32;
const MAX_CONVERSATION_ITEMS = 64;
const MAX_COMMANDS = 8;
const MAX_USAGE_OBSERVATIONS = 64;
const MAX_ACTIVITIES = 64;
const MAX_DIAGNOSTICS = 16;
const MAX_DIAGNOSTIC_CAUSES = 4;
const MAX_CONVERSATION_TEXT_BYTES = 1_024;
const MAX_COVERAGE_REASON_BYTES = 256;
const MAX_DIAGNOSTIC_SUMMARY_BYTES = 256;
const MAX_DIAGNOSTIC_CAUSE_BYTES = 128;

export interface TraceAttachmentInput {
  readonly physical: SealedAttachmentMetadata;
  readonly value: InspectionJson;
}

export interface AttemptTraceAttachments {
  readonly attemptCost: TraceAttachmentInput | undefined;
  /** Only the sealed origin Run's configuration may validate or describe these calls. */
  readonly models: ModelRolesWire | undefined;
  readonly adapterUsage: TraceAttachmentInput | undefined;
  readonly judgeUsage: TraceAttachmentInput | undefined;
  readonly agentTurns: TraceAttachmentInput | undefined;
  readonly turnContexts: TraceAttachmentInput | undefined;
  readonly sandboxCommands: TraceAttachmentInput | undefined;
  readonly runnerActivities: TraceAttachmentInput | undefined;
  readonly runnerDiagnostics: TraceAttachmentInput | undefined;
}

/** One stable, sealed identity accepted by `attempt.trace.detail`. */
export type AttemptTraceDetailSelector =
  | { readonly kind: "item"; readonly itemId: string }
  | { readonly kind: "tool-occurrence"; readonly toolOccurrenceId: string }
  | { readonly kind: "command"; readonly commandId: string };

type AttachmentRead<Value> =
  | { readonly state: "not-recorded" }
  | { readonly state: "invalid"; readonly issues: readonly string[] }
  | {
      readonly state: "available";
      readonly value: Value;
      readonly contentMetadata: WeakMap<object, PersistedContentMetadata>;
    };

/** Validated current Agent Turns facts shared by browser-neutral projectors. */
export type InspectionAgentTurnsRead = AttachmentRead<AgentTurnsAttachment> & {
  readonly observed?: Extract<ReturnType<typeof projectObservedSourceEvents>, { readonly state: "available" }>;
};
type InspectionTraceDetailItem = Extract<InspectionTraceDetailResult, { readonly kind: "item" }>["item"];

interface CollectionValue {
  readonly collection: {
    readonly state: "complete" | "partial";
    readonly limitations: readonly SourceReceiptLimitation[];
  };
}

interface ProjectionState {
  readonly state: "complete" | "partial" | "not-recorded" | "invalid";
  readonly limitations: readonly (SourceReceiptLimitation | { readonly issue: string })[];
}

// @concord-code
// @concord-implements docs/feature/inspection/README.md
// @concord-implements docs/feature/insight/README.md
export function projectAttemptTrace(
  source: InspectionFactSource,
  attachments: AttemptTraceAttachments,
  execution: InspectionTraceResult["execution"],
  executionFilters: {
    readonly traceId: string | undefined;
    readonly sourceId: string | undefined;
    readonly actorId: string | undefined;
    readonly eventType: string | undefined;
    readonly continuation: string | undefined;
  } = {
    traceId: undefined,
    sourceId: undefined,
    actorId: undefined,
    eventType: undefined,
    continuation: undefined,
  },
): InspectionTraceResult {
  const agentTurns = readCurrentAttachment(NiceEvalCurrentRecordAttachments.agentTurns, attachments.agentTurns);
  const turnContexts = readCurrentAttachment(NiceEvalCurrentRecordAttachments.turnContexts, attachments.turnContexts);
  const sandboxCommands = readCurrentAttachment(
    NiceEvalCurrentRecordAttachments.sandboxCommands,
    attachments.sandboxCommands,
  );
  const runnerDiagnostics = readRunnerDiagnostics(attachments.runnerDiagnostics);
  const conversationProjection = availability(agentTurns, CONVERSATION_TARGETS);
  const contextProjection = availability(turnContexts, CONTEXT_TARGETS);
  const commandProjection = availability(sandboxCommands, COMMAND_TARGETS);
  const conversationEvidenceLimitations = typedConversationCoverageLimitations(agentTurns);
  const contextLimitations: InspectionTraceResult["conversation"]["limitations"] =
    contextProjection.state === "complete"
      ? []
      : [
          {
            source: "turn-contexts" as const,
            state: contextProjection.state,
            limitations: contextProjection.limitations,
          },
        ];
  const allConversationLimitations = [
    ...conversationProjection.limitations,
    ...conversationEvidenceLimitations,
    ...contextLimitations,
  ];
  const conversationLimitations = allConversationLimitations.slice(0, MAX_SOURCE_LIMITATIONS);
  const commandLimitations = commandProjection.limitations.slice(0, MAX_SOURCE_LIMITATIONS);
  const retainedTurns =
    agentTurns.state === "available" ? agentTurns.value.segments.slice(0, MAX_CONVERSATION_TURNS) : [];
  const contexts =
    turnContexts.state === "available"
      ? new Map(turnContexts.value.segments.map((segment) => [segment.turnId, segment] as const))
      : new Map();
  const turns =
    retainedTurns.length > 0
      ? retainedTurns.map((turn) => ({
          turnId: turn.turnId,
          sequence: turn.sequence,
          ...("sessionId" in turn ? { sessionId: turn.sessionId } : {}),
          outcome: turn.outcome,
          terminal: projectTypedTurnTerminal(turn.terminal),
          context: projectTypedTurnContext(contexts.get(turn.turnId)),
        }))
      : [];
  const items =
    retainedTurns.length > 0
      ? retainedTurns
          .flatMap((turn) => turn.items.map((item) => projectTypedConversationItem(item, turn.turnId)))
          .slice(0, MAX_CONVERSATION_ITEMS)
      : [];
  const commandItems =
    sandboxCommands.state === "available"
      ? sandboxCommands.value.segments.slice(0, MAX_COMMANDS).map((command) => ({
          commandId: command.commandId,
          phase: projectLifecyclePhase(command.phase),
          ...(command.checked === undefined ? {} : { checked: command.checked }),
          outcome: command.outcome,
        }))
      : [];
  const identityIndex = projectTypedTraceIdentityIndex(agentTurns, sandboxCommands);
  const totalTurnCount = agentTurns.state === "available" ? agentTurns.value.segments.length : 0;
  const totalItemCount =
    agentTurns.state === "available"
      ? agentTurns.value.segments.reduce((total, turn) => total + turn.items.length, 0)
      : 0;
  const totalCommandCount = sandboxCommands.state === "available" ? sandboxCommands.value.segments.length : 0;
  const executionProjection =
    execution.state === "not-recorded"
      ? projectAgentItemsAsExecution(
          source,
          attachments.agentTurns,
          agentTurns,
          conversationProjection.state,
          executionFilters,
        )
      : execution;
  const result: InspectionTraceResult = {
    execution: executionProjection,
    conversation: {
      state:
        conversationProjection.state === "complete" && allConversationLimitations.length > 0
          ? "partial"
          : conversationProjection.state,
      limitations: conversationLimitations,
      limitationsTruncated: conversationLimitations.length < allConversationLimitations.length,
      omittedLimitationCount: allConversationLimitations.length - conversationLimitations.length,
      turns: turns,
      turnsTruncated: turns.length < totalTurnCount,
      omittedTurnCount: totalTurnCount - turns.length,
      items: items,
      itemsTruncated: items.length < totalItemCount,
      omittedItemCount: totalItemCount - items.length,
    },
    identityIndex,
    commands: {
      state: commandProjection.state,
      limitations: commandLimitations,
      limitationsTruncated: commandLimitations.length < commandProjection.limitations.length,
      omittedLimitationCount: commandProjection.limitations.length - commandLimitations.length,
      items: commandItems,
      hasMore: commandItems.length < totalCommandCount,
      omittedCommandCount: totalCommandCount - commandItems.length,
    },
    diagnostics: projectDiagnostics(runnerDiagnostics),
  };
  if (jsonByteLength(result) > INSPECTION_RESULT_PAGE_BYTES) {
    throw new Error("Trace semantic projection exceeds its fixed result byte limit");
  }
  return result;
}

/**
 * Existing Agent Turns stay single-owned. This is a bounded read projection
 * into the generic execution outline, with an exact pointer back to the old
 * item selector; it never writes a second Record family or recomputes usage.
 */
function projectAgentItemsAsExecution(
  source: InspectionFactSource,
  attachment: TraceAttachmentInput | undefined,
  agentTurns: InspectionAgentTurnsRead,
  state: "complete" | "partial" | "not-recorded" | "invalid",
  request: ExecutionTraceFilters & { readonly continuation: string | undefined },
): InspectionTraceResult["execution"] {
  const filters: ExecutionTraceFilters = {
    traceId: request.traceId,
    sourceId: request.sourceId,
    actorId: request.actorId,
    eventType: request.eventType,
  };
  const continuationContext = {
    source,
    originAttempt:
      attachment === undefined
        ? "not-recorded"
        : `${attachment.physical.ownerRunId}:${attachment.physical.ownerAttemptId ?? "missing"}`,
    sourceFamily: EXECUTION_TRACE_CONTINUATION_FAMILIES.agentTurns,
    familyRevision: NiceEvalCurrentRecordAttachments.agentTurns.revision,
    filters,
  };
  const resumeAfter =
    request.continuation === undefined
      ? -1
      : decodeExecutionTraceContinuation(request.continuation, continuationContext);
  if (state === "not-recorded") {
    return {
      state: "not-recorded",
      limitations: [],
      traces: [],
      events: [],
      identityIndex: {
        traceIds: [],
        omittedTraceIdCount: 0,
        eventIds: [],
        omittedEventIdCount: 0,
        evidenceIds: [],
        omittedEvidenceIdCount: 0,
      },
      hasMore: false,
      omittedEventCount: 0,
    };
  }
  const traceId = "agent-turns";
  const sourceId = "niceeval.agent-turns";
  const limitations =
    state === "complete"
      ? []
      : [
          {
            code: "legacy-source-state" as const,
            state,
            message: state === "invalid" ? "The Agent Turns source is invalid." : "The Agent Turns source is partial.",
          },
        ];
  if (state === "invalid") {
    return {
      state,
      limitations,
      traces: [],
      events: [],
      identityIndex: {
        traceIds: [],
        omittedTraceIdCount: 0,
        eventIds: [],
        omittedEventIdCount: 0,
        evidenceIds: [],
        omittedEvidenceIdCount: 0,
      },
      hasMore: false,
      omittedEventCount: 0,
    };
  }
  const traceSelected = filters.traceId === undefined || filters.traceId === traceId;
  const sourceSelected = filters.sourceId === undefined || filters.sourceId === sourceId;
  const retained: Array<{
    readonly event: InspectionTraceResult["execution"]["events"][number];
    readonly sourceOrdinal: number;
  }> = [];
  const indexedEventIds: string[] = [];
  let sourceOrdinal = 0;
  let totalSourceEvents = 0;
  let totalMatching = 0;
  let priorMatches = 0;
  let pageFull = false;
  if (agentTurns.state === "available") {
    for (const turn of agentTurns.value.segments) {
      for (const rawItem of turn.items) {
        const ordinal = sourceOrdinal;
        sourceOrdinal += 1;
        totalSourceEvents += 1;
        if (indexedEventIds.length < 256) indexedEventIds.push(rawItem.itemId);
        if (!traceSelected || !sourceSelected) continue;
        const actorId = rawItem.kind === "message" ? rawItem.role : "assistant";
        if (filters.actorId !== undefined && actorId !== filters.actorId) continue;
        if (filters.eventType !== undefined && `agent.${rawItem.kind}` !== filters.eventType) continue;
        totalMatching += 1;
        if (ordinal <= resumeAfter) {
          priorMatches += 1;
          continue;
        }
        if (pageFull || retained.length >= ExecutionTraceRecordLimits.maximumOutlineEvents) {
          pageFull = true;
          continue;
        }
        const item = projectTypedConversationItem(rawItem, turn.turnId);
        const event = {
          traceId,
          eventId: item.itemId,
          origin: { kind: "agent-item" as const, itemId: item.itemId },
          ordinal,
          type: `agent.${item.kind}`,
          source: { id: sourceId, sequence: item.sequence },
          actor: { id: agentItemActorId(item) },
          summary: boundedText(agentItemSummary(item), 512).value,
          links: [],
          evidence: [],
          scopeMemberships: [],
          display: { state: "absent" as const },
        };
        if (
          utf8ByteLength(JSON.stringify([...retained.map(({ event: prior }) => prior), event])) >
          ExecutionTraceRecordLimits.maximumOutlineBytes
        ) {
          pageFull = true;
          continue;
        }
        retained.push({ event, sourceOrdinal: ordinal });
      }
    }
  }
  const events = retained.map(({ event }) => event);
  const omittedEventCount = Math.max(0, totalMatching - priorMatches - events.length);
  const lastOrdinal = retained.at(-1)?.sourceOrdinal;
  return {
    state,
    limitations,
    traces: traceSelected
      ? [
          {
            kind: "trace-header" as const,
            traceId,
            sourceTraceId: sourceId,
            schema: { id: sourceId },
            collection:
              state === "complete"
                ? { state: "complete" as const, limitations: [] as const }
                : {
                    state: "partial" as const,
                    limitations: [
                      { code: "legacy-source-state", message: "The Agent Turns source is partial." },
                    ] as const,
                  },
            scopes: [],
            eventCount: totalSourceEvents,
          },
        ]
      : [],
    events: events,
    identityIndex: {
      traceIds: [traceId],
      omittedTraceIdCount: 0,
      eventIds: indexedEventIds,
      omittedEventIdCount: totalSourceEvents - indexedEventIds.length,
      evidenceIds: [],
      omittedEvidenceIdCount: 0,
    },
    hasMore: omittedEventCount > 0,
    omittedEventCount,
    ...(omittedEventCount > 0 && lastOrdinal !== undefined
      ? { continuation: encodeExecutionTraceContinuation(continuationContext, lastOrdinal) }
      : {}),
  };
}

function agentItemActorId(item: InspectionTraceResult["conversation"]["items"][number]): string {
  return item.kind === "message" ? item.role : "assistant";
}

function agentItemSummary(item: InspectionTraceResult["conversation"]["items"][number]): string {
  switch (item.kind) {
    case "message":
      return item.text;
    case "tool-call":
      return `${item.tool}: ${item.input}`;
    case "tool-result":
      return `${item.outcome}: ${item.output}`;
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      return item.summary;
    case "subagent":
      return `${item.label}: ${item.summary}`;
    case "input-request":
      return item.response === null ? item.prompt : `${item.prompt}: ${item.response}`;
    case "skill-load":
    case "conversation-error":
      return `${item.code}: ${item.summary}`;
  }
}

type TraceEvidenceCoverageLimitation = Extract<
  InspectionTraceResult["conversation"]["limitations"][number],
  { readonly source: "agent-turns" }
>;

type InspectionTurnContextSegment =
  ReturnType<typeof readTurnContexts> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment
      : never
    : never;

function projectTypedTurnTerminal(
  terminal: ReturnType<typeof readAgentTurns> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment extends { readonly terminal: infer Terminal }
        ? Terminal
        : never
      : never
    : never,
): InspectionTraceResult["conversation"]["turns"][number]["terminal"] {
  const coverage = conversationCoverage(terminal);
  if (terminal.state === "unavailable") {
    return {
      state: terminal.state,
      reason: terminal.reason,
      coverage: { state: "unavailable" as const, reason: terminal.reason },
    };
  }
  return {
    state: terminal.state,
    status: terminal.status,
    coverage: coverage.coverage,
  } as InspectionTraceResult["conversation"]["turns"][number]["terminal"];
}

function projectTypedTurnContext(
  context: InspectionTurnContextSegment | undefined,
): InspectionTraceResult["conversation"]["turns"][number]["context"] {
  if (context === undefined) return { state: "not-recorded" as const };
  if ("state" in context.source) {
    return {
      state: context.source.state,
      reason: context.source.reason,
      sessionIndex: context.sessionIndex,
      turnIndex: context.turnIndex,
      sourceOrder: context.sourceOrder,
    };
  }
  if (context.sourceOrder === null) {
    throw new Error("Mapped turn context is missing its validated source order");
  }
  return {
    sessionIndex: context.sessionIndex,
    turnIndex: context.turnIndex,
    sourceOrder: context.sourceOrder,
    ...context.source.value,
  };
}

function typedConversationCoverageLimitations(
  agentTurns: ReturnType<typeof readAgentTurns>,
): readonly TraceEvidenceCoverageLimitation[] {
  if (agentTurns.state !== "available") return [];
  const limitations: TraceEvidenceCoverageLimitation[] = [];
  const channels = ["events", "actions", "messages", "status", "data"] as const;
  for (const turn of agentTurns.value.segments) {
    if (turn.terminal.state === "unavailable") {
      limitations.push({
        source: "agent-turns",
        turnId: turn.turnId,
        channel: "conversation",
        state: "unavailable",
        reason: turn.terminal.reason,
      });
      continue;
    }
    for (const channel of channels) {
      const coverage = turn.terminal.evidenceCoverage[channel];
      if (coverage.status === "complete") continue;
      limitations.push({
        source: "agent-turns",
        turnId: turn.turnId,
        channel,
        state: coverage.status,
        reason: boundedText(coverage.reason, MAX_COVERAGE_REASON_BYTES).value,
      });
    }
  }
  return limitations;
}

/**
 * Resolves exactly one sealed trace fact.  `undefined` is deliberately the
 * missing-selection result: the Host turns it into inspection-selection-missing
 * and must never substitute a neighbouring displayed item.
 */
export function projectAttemptTraceDetail(
  source: InspectionFactSource,
  attachments: AttemptTraceAttachments,
  selector: AttemptTraceDetailSelector,
): InspectionTraceDetailResult | undefined {
  const agentTurns = readAgentTurns(attachments.agentTurns);
  const commands = readSandboxCommands(attachments.sandboxCommands);
  let detail: InspectionTraceDetailResult | undefined;
  switch (selector.kind) {
    case "item":
      detail = projectTraceItemDetail(agentTurns, selector.itemId);
      break;
    case "tool-occurrence": {
      detail = projectToolOccurrenceDetail(agentTurns, selector.toolOccurrenceId);
      break;
    }
    case "command":
      detail = projectTraceCommandDetail(source, commands, selector.commandId);
      break;
  }
  if (detail === undefined) return undefined;
  if (jsonByteLength(detail) > INSPECTION_RESULT_PAGE_BYTES) {
    throw new Error("Trace detail exceeds its fixed result byte limit");
  }
  return detail;
}

function projectTypedTraceIdentityIndex(
  agentTurns: ReturnType<typeof readAgentTurns>,
  commands: ReturnType<typeof readSandboxCommands>,
): InspectionTraceResult["identityIndex"] {
  const maximumIdentityCount = 256;
  const itemIds: string[] = [];
  const toolOccurrenceIds = new Set<string>();
  if (agentTurns.state === "available") {
    for (const turn of agentTurns.value.segments) {
      for (const item of turn.items) {
        itemIds.push(item.itemId);
        if (item.kind === "tool-start") toolOccurrenceIds.add(item.toolOccurrenceId);
        if (item.kind === "tool-finish" && item.occurrence.state === "exact") {
          toolOccurrenceIds.add(item.occurrence.toolOccurrenceId);
        }
      }
    }
  }
  const allToolOccurrenceIds = [...toolOccurrenceIds];
  const allCommandIds = commands.state === "available" ? commands.value.segments.map(({ commandId }) => commandId) : [];
  return {
    itemIds: itemIds.slice(0, maximumIdentityCount),
    omittedItemIdCount: Math.max(0, itemIds.length - maximumIdentityCount),
    toolOccurrenceIds: {
      ids: allToolOccurrenceIds.slice(0, maximumIdentityCount),
      omittedIdCount: Math.max(0, allToolOccurrenceIds.length - maximumIdentityCount),
    },
    commandIds: allCommandIds.slice(0, maximumIdentityCount),
    omittedCommandIdCount: Math.max(0, allCommandIds.length - maximumIdentityCount),
  };
}

function projectTypedConversationItem(
  item: ReturnType<typeof readAgentTurns> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment extends { readonly items: readonly (infer Item)[] }
        ? Item
        : never
      : never
    : never,
  turnId: string,
): InspectionTraceResult["conversation"]["items"][number] {
  const sequence = item.sessionSequence;
  const base = { itemId: item.itemId, turnId, sequence };
  switch (item.kind) {
    case "message": {
      const text = boundedText(item.text, MAX_CONVERSATION_TEXT_BYTES);
      return {
        ...base,
        kind: item.kind,
        role: item.role,
        text: text.value,
        textTruncated: text.truncated,
      };
    }
    case "tool-start": {
      const input = boundedText(item.inputSummary, MAX_CONVERSATION_TEXT_BYTES);
      return {
        ...base,
        kind: "tool-call",
        tool: item.tool,
        input: input.value,
        inputTruncated: input.truncated,
        toolOccurrenceId: item.toolOccurrenceId,
      };
    }
    case "tool-finish": {
      const output = boundedText(item.outputSummary, MAX_CONVERSATION_TEXT_BYTES);
      return {
        ...base,
        kind: "tool-result",
        outcome: item.outcome,
        output: output.value,
        outputTruncated: output.truncated,
        ...(item.occurrence.state === "exact" ? { toolOccurrenceId: item.occurrence.toolOccurrenceId } : {}),
      };
    }
    case "thinking-summary":
    case "compaction":
    case "context-injection": {
      const summary = boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES);
      return { ...base, kind: item.kind, summary: summary.value, summaryTruncated: summary.truncated };
    }
    case "subagent": {
      const summary = boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES);
      return {
        ...base,
        kind: item.kind,
        state: item.state,
        label: item.label,
        summary: summary.value,
        summaryTruncated: summary.truncated,
      };
    }
    case "input-request": {
      const prompt = boundedText(item.promptSummary, MAX_CONVERSATION_TEXT_BYTES);
      const response =
        item.responseSummary === null ? null : boundedText(item.responseSummary, MAX_CONVERSATION_TEXT_BYTES);
      return {
        ...base,
        kind: item.kind,
        state: item.state,
        prompt: prompt.value,
        promptTruncated: prompt.truncated,
        response: response?.value ?? null,
        responseTruncated: response?.truncated ?? false,
      };
    }
    case "skill-load":
    case "conversation-error": {
      const summary = boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES);
      return {
        ...base,
        kind: item.kind,
        code: item.code,
        summary: summary.value,
        summaryTruncated: summary.truncated,
      };
    }
  }
}

export function projectTraceTurnDetail(
  attachment: TraceAttachmentInput | undefined,
  turnId: string,
): Extract<InspectionTraceDetailResult, { readonly kind: "turn" }> | undefined {
  const turns = readAgentTurns(attachment);
  if (turns.state !== "available") return undefined;
  const turn = turns.value.segments.find((value) => value.turnId === turnId);
  if (turn === undefined) return undefined;
  return {
    kind: "turn",
    turnId,
    turn: traceTurnIdentity(turn),
    items: turn.items.map((item) => projectFullConversationItem(item, turn)),
  };
}

function projectTraceItemDetail(
  agentTurns: ReturnType<typeof readAgentTurns>,
  itemId: string,
): Extract<InspectionTraceDetailResult, { readonly kind: "item" }> | undefined {
  if (agentTurns.state !== "available") return undefined;
  for (const turn of agentTurns.value.segments) {
    const item = turn.items.find((candidate) => candidate.itemId === itemId || candidate.eventId === itemId);
    if (item === undefined) continue;
    return {
      kind: "item",
      itemId: item.itemId,
      item: projectFullConversationItem(item, turn),
    };
  }
  return undefined;
}

function projectToolOccurrenceDetail(
  agentTurns: ReturnType<typeof readAgentTurns>,
  toolOccurrenceId: string,
): Extract<InspectionTraceDetailResult, { readonly kind: "tool-occurrence" }> | undefined {
  if (agentTurns.state !== "available") return undefined;
  let call: InspectionTraceDetailItem | undefined;
  let result: InspectionTraceDetailItem | undefined;
  let callTurn: { readonly turnId: string; readonly sequence: number; readonly outcome: AgentTurnOutcome } | undefined;
  let resultTurn: typeof callTurn;
  for (const turn of agentTurns.value.segments) {
    for (const item of turn.items) {
      if (item.kind === "tool-start" && item.toolOccurrenceId === toolOccurrenceId) {
        call = projectFullConversationItem(item, turn);
        callTurn = traceTurnIdentity(turn);
      }
      if (
        item.kind === "tool-finish" &&
        item.occurrence.state === "exact" &&
        item.occurrence.toolOccurrenceId === toolOccurrenceId
      ) {
        result = projectFullConversationItem(item, turn);
        resultTurn = traceTurnIdentity(turn);
      }
    }
  }
  if (call === undefined && result === undefined) return undefined;
  return {
    kind: "tool-occurrence",
    toolOccurrenceId,
    call: call ?? null,
    result: result ?? null,
    turn: { call: callTurn ?? null, result: resultTurn ?? null },
  };
}

function projectTraceCommandDetail(
  source: InspectionFactSource,
  commands: ReturnType<typeof readSandboxCommands>,
  commandId: string,
): Extract<InspectionTraceDetailResult, { readonly kind: "command" }> | undefined {
  if (commands.state !== "available") return undefined;
  const command = commands.value.segments.find((candidate) => candidate.commandId === commandId);
  if (command === undefined) return undefined;
  const stream = (value: typeof command.stdout) => {
    const metadata = commands.contentMetadata.get(value.content);
    if (metadata === undefined || metadata.byteLength !== value.retainedBytes || metadata.digest !== value.sha256) {
      throw new Error("Command stream metadata is invalid");
    }
    return {
      text: readVerifiedText(source, metadata),
      retainedBytes: value.retainedBytes,
      totalSafeUtf8Bytes: value.totalSafeUtf8Bytes,
      sha256: value.sha256,
      truncation: {
        state: value.retainedBytes === value.totalSafeUtf8Bytes ? ("not-truncated" as const) : ("truncated" as const),
        omittedSafeUtf8Bytes: value.totalSafeUtf8Bytes - value.retainedBytes,
      },
    };
  };
  return {
    kind: "command",
    commandId,
    invocation: projectFullInvocation(command.invocation),
    workingDirectory: command.workingDirectory,
    ...(command.checked === undefined ? {} : { checked: command.checked }),
    outcome: command.outcome,
    turnId: command.turnId,
    phase: projectLifecyclePhase(command.phase),
    sequence: command.sequence,
    stdout: stream(command.stdout),
    stderr: stream(command.stderr),
  };
}

function traceTurnIdentity(turn: {
  readonly turnId: string;
  readonly sequence: number;
  readonly outcome: AgentTurnOutcome;
}) {
  return { turnId: turn.turnId, sequence: turn.sequence, outcome: turn.outcome };
}

function projectFullInvocation(
  invocation:
    | { readonly kind: "shell"; readonly command: string }
    | { readonly kind: "argv"; readonly executable: string; readonly arguments: readonly string[] },
): Extract<InspectionTraceDetailResult, { readonly kind: "command" }>["invocation"] {
  return invocation.kind === "shell"
    ? { kind: invocation.kind, command: invocation.command }
    : {
        kind: invocation.kind,
        executable: invocation.executable,
        arguments: invocation.arguments,
      };
}

function projectFullConversationItem(
  item: ReturnType<typeof readAgentTurns> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment extends { readonly items: readonly (infer Item)[] }
        ? Item
        : never
      : never
    : never,
  turn: {
    readonly turnId: string;
    readonly sequence: number;
    readonly outcome: AgentTurnOutcome;
    readonly sessionId: string | undefined;
  },
): Extract<InspectionTraceDetailResult, { readonly kind: "item" }>["item"] {
  const truncation = (field: string) => item.textTruncations?.[field];
  const base = {
    itemId: item.itemId,
    turnId: turn.turnId,
    turnSequence: turn.sequence,
    turnOutcome: turn.outcome,
    ...(turn.sessionId === undefined ? {} : { sessionId: turn.sessionId }),
  };
  switch (item.kind) {
    case "tool-start":
      return {
        ...base,
        kind: "tool-call",
        eventId: item.eventId,
        sequence: item.sessionSequence,
        toolOccurrenceId: item.toolOccurrenceId,
        tool: item.tool,
        input: item.inputSummary,
        ...(truncation("inputSummary") === undefined ? {} : { inputTruncation: truncation("inputSummary") }),
      };
    case "tool-finish":
      return {
        ...base,
        kind: "tool-result",
        eventId: item.eventId,
        sequence: item.sessionSequence,
        ...(item.occurrence.state === "exact" ? { toolOccurrenceId: item.occurrence.toolOccurrenceId } : {}),
        outcome: item.outcome,
        output: item.outputSummary,
        ...(truncation("outputSummary") === undefined ? {} : { outputTruncation: truncation("outputSummary") }),
      };
    case "message":
      return {
        ...base,
        kind: item.kind,
        role: item.role,
        text: item.text,
        ...(truncation("text") === undefined ? {} : { textTruncation: truncation("text") }),
      };
    case "thinking-summary":
    case "compaction":
    case "context-injection":
      return {
        ...base,
        kind: item.kind,
        summary: item.summary,
        ...(truncation("summary") === undefined ? {} : { summaryTruncation: truncation("summary") }),
      };
    case "subagent":
      return {
        ...base,
        kind: item.kind,
        state: item.state,
        label: item.label,
        summary: item.summary,
        ...(truncation("summary") === undefined ? {} : { summaryTruncation: truncation("summary") }),
      };
    case "input-request":
      return {
        ...base,
        kind: item.kind,
        state: item.state,
        prompt: item.promptSummary,
        ...(truncation("promptSummary") === undefined ? {} : { promptTruncation: truncation("promptSummary") }),
        response: item.responseSummary,
        ...(truncation("responseSummary") === undefined ? {} : { responseTruncation: truncation("responseSummary") }),
      };
    case "skill-load":
    case "conversation-error":
      return {
        ...base,
        kind: item.kind,
        code: item.code,
        summary: item.summary,
        ...(truncation("summary") === undefined ? {} : { summaryTruncation: truncation("summary") }),
      };
  }
}

const decodedTraceAttachments = new WeakMap<
  TraceAttachmentInput,
  {
    readonly definition: object;
    readonly read: AttachmentRead<unknown>;
  }
>();

export function readCurrentAttachment<
  Owner extends RecordAttachmentOwner,
  Family extends string,
  ValueSchema extends Schema.Top,
  Revision extends number | undefined,
>(
  persistence: Readonly<{
    readonly attachment: RecordAttachmentDefinition<Owner, Family, ValueSchema>;
    readonly revision: Revision;
  }>,
  attachment: TraceAttachmentInput | undefined,
): AttachmentRead<ValueSchema["Type"]> {
  if (attachment === undefined) return { state: "not-recorded" as const };
  if (
    attachment.physical.ownerKind !== persistence.attachment.owner ||
    attachment.physical.family !== persistence.attachment.family
  )
    return invalidRead("source-attachment-identity-invalid");
  if (attachment.physical.familyRevision !== persistence.revision) return invalidRead("source-revision-unsupported");
  const cached = decodedTraceAttachments.get(attachment);
  if (cached?.definition === persistence.attachment) return cached.read as AttachmentRead<ValueSchema["Type"]>;

  const byLogicalHandle = new Map(
    attachment.physical.contents.map((content) => [content.logicalHandle, content] as const),
  );
  const contentMetadata = new WeakMap<object, PersistedContentMetadata>();
  const usedLogicalHandles = new Set<string>();
  const hydrated = hydrateRecordAttachmentCurrentWithClosure(persistence.attachment, attachment.value, {
    content: (token, declaration) => {
      const logicalHandle = exactMarker(token, "$niceeval.record.content");
      if (logicalHandle === undefined && !hasOwnMarker(token, "$niceeval.record.content")) {
        return Result.succeed(undefined);
      }
      const metadata = typeof logicalHandle === "string" ? byLogicalHandle.get(logicalHandle) : undefined;
      if (
        metadata === undefined ||
        usedLogicalHandles.has(logicalHandle as string) ||
        (declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes)
      )
        return Result.fail({ code: "current-content-bind-failed" as const });
      const handle = mintRecordContentHandle(declaration.kind);
      contentMetadata.set(handle, metadata);
      usedLogicalHandles.add(logicalHandle as string);
      return Result.succeed(handle);
    },
    reference: (token, declaration) => {
      const marker = exactMarker(token, "$niceeval.record.reference");
      if (marker === undefined && !hasOwnMarker(token, "$niceeval.record.reference")) {
        return Result.succeed(undefined);
      }
      if (typeof marker !== "object" || marker === null || Array.isArray(marker)) {
        return Result.fail({ code: "current-reference-bind-failed" as const });
      }
      const value = marker as Readonly<Record<string, unknown>>;
      if (
        Reflect.ownKeys(value).length !== 3 ||
        value.owner !== declaration.definition.owner ||
        value.family !== declaration.definition.family ||
        !("value" in value)
      ) {
        return Result.fail({ code: "current-reference-bind-failed" as const });
      }
      return Result.succeed(
        mintRecordAttachmentReference(
          RecordAttachmentReference.to(declaration.definition, declaration.valueSchema),
          value.value,
        ),
      );
    },
  });
  if (Result.isFailure(hydrated) || usedLogicalHandles.size !== attachment.physical.contents.length) {
    return invalidRead("source-attachment-invalid");
  }

  const logicalReferences = new Map<string, { readonly owner: string; readonly family: string }>();
  for (const reference of hydrated.success.closure.references) {
    const wire = recordAttachmentReferenceWire(reference);
    if (wire === undefined) return invalidRead("source-reference-invalid");
    logicalReferences.set(`${wire.owner}\u0000${wire.family}`, { owner: wire.owner, family: wire.family });
  }
  const orderedReferences = [...logicalReferences.values()].sort(function compareReferences(left, right) {
    if (left.owner !== right.owner) return left.owner < right.owner ? -1 : 1;
    if (left.family === right.family) return 0;
    return left.family < right.family ? -1 : 1;
  });
  if (orderedReferences.length !== attachment.physical.references.length) {
    return invalidRead("source-reference-invalid");
  }
  for (let ordinal = 0; ordinal < orderedReferences.length; ordinal += 1) {
    const logical = orderedReferences[ordinal]!;
    const physical = attachment.physical.references[ordinal]!;
    if (physical.ordinal !== ordinal || physical.owner !== logical.owner || physical.family !== logical.family)
      return invalidRead("source-reference-invalid");
  }
  const read = { state: "available" as const, value: hydrated.success.value, contentMetadata };
  // Inputs are minted from pinned Record facts and are shared by detail and aggregate readers.
  decodedTraceAttachments.set(attachment, { definition: persistence.attachment, read });
  return read;
}

function invalidRead<Value>(issue: string): AttachmentRead<Value> {
  return { state: "invalid" as const, issues: [issue] };
}

/** Decode only the current official usage payload. */
function readAdapterUsageAttachment(
  attachment: TraceAttachmentInput | undefined,
  models: ModelRolesWire | undefined,
): AttachmentRead<ReadableAdapterUsageAttachment> {
  const read = readCurrentAttachment(NiceEvalCurrentRecordAttachments.adapterUsage, attachment);
  if (
    read.state === "available" &&
    read.value.calls.some(
      (call) => call.modelSlot !== null && (models === undefined || !Object.hasOwn(models, call.modelSlot)),
    )
  ) {
    return invalidRead("source-model-slot-invalid");
  }
  return read;
}

function availability<Value extends CollectionValue>(
  read: AttachmentRead<Value>,
  targets: ReadonlySet<SourceReceiptLimitation["target"]>,
): ProjectionState {
  switch (read.state) {
    case "not-recorded":
      return { state: read.state, limitations: [] };
    case "invalid":
      return {
        state: read.state,
        limitations: read.issues.map((issue) => ({ issue })),
      };
    case "available": {
      const matching = read.value.collection.limitations.filter(({ target }) => targets.has(target));
      return {
        state: matching.length === 0 ? ("complete" as const) : ("partial" as const),
        limitations: matching,
      };
    }
  }
}

const CONVERSATION_TARGETS = new Set<SourceReceiptLimitation["target"]>(["turn", "turn-item", "value-byte"]);
const CONTEXT_TARGETS = new Set<SourceReceiptLimitation["target"]>(["turn-context", "value-byte"]);
const USAGE_TARGETS = new Set<SourceReceiptLimitation["target"]>(["usage-observation", "value-byte"]);
const COMMAND_TARGETS = new Set<SourceReceiptLimitation["target"]>([
  "command",
  "stdout",
  "stderr",
  "value-byte",
  "content-byte",
]);
const TIMING_TARGETS = new Set<SourceReceiptLimitation["target"]>(["activity", "value-byte"]);
const DIAGNOSTIC_TARGETS = new Set<SourceReceiptLimitation["target"]>(["diagnostic", "diagnostic-cause", "value-byte"]);

export function readInspectionAgentTurns(attachment?: TraceAttachmentInput): InspectionAgentTurnsRead {
  return readCurrentAttachment(NiceEvalCurrentRecordAttachments.agentTurns, attachment);
}

const decodeAgentTurns = Schema.decodeUnknownResult(AgentTurnsAttachmentSchema, { onExcessProperty: "error" });

let latestAssertionTurns:
  | { readonly cutoff: string; readonly origin: string; readonly read: InspectionAgentTurnsRead }
  | undefined;

/** Agent Turns has no Content or reference leaves besides its transparent payload. */
export function readAssertionAgentTurns(
  cutoff: string,
  origin: string,
  attachment?: DecodedInspectionAttachment,
): InspectionAgentTurnsRead {
  if (latestAssertionTurns?.cutoff === cutoff && latestAssertionTurns.origin === origin)
    return latestAssertionTurns.read;
  const read = decodeAssertionAgentTurns(attachment);
  latestAssertionTurns = { cutoff, origin, read };
  return read;
}

function decodeAssertionAgentTurns(attachment?: DecodedInspectionAttachment): InspectionAgentTurnsRead {
  if (attachment === undefined) return { state: "not-recorded" };
  const { physical } = attachment;
  const { agentTurns } = NiceEvalCurrentRecordAttachments;
  if (
    physical.ownerKind !== agentTurns.attachment.owner ||
    physical.family !== agentTurns.attachment.family ||
    physical.familyRevision !== agentTurns.revision ||
    physical.contents.length !== 0 ||
    physical.references.length !== 0
  )
    return invalidRead("source-attachment-invalid");
  const decoded = decodeAgentTurns(attachment.rawValue);
  if (Result.isFailure(decoded) || validateAgentTurnsEnvelope(decoded.success).length !== 0)
    return invalidRead("source-attachment-invalid");
  const observed = projectObservedSourceEvents(decoded.success.segments);
  if (observed.state !== "available") return invalidRead("source-attachment-invalid");
  return { state: "available", value: decoded.success, observed, contentMetadata: new WeakMap() };
}

function readAgentTurns(attachment?: TraceAttachmentInput): InspectionAgentTurnsRead {
  return readInspectionAgentTurns(attachment);
}

function readTurnContexts(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(NiceEvalCurrentRecordAttachments.turnContexts, attachment);
}

function conversationCoverage(
  terminal: ReturnType<typeof readAgentTurns> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment extends { readonly terminal: infer Terminal }
        ? Terminal
        : never
      : never
    : never,
) {
  if (terminal.state === "unavailable") {
    return {
      coverage: { state: "unavailable" as const, reason: terminal.reason },
      limitations: [
        {
          channel: "conversation",
          state: "unavailable" as const,
          reason: terminal.reason,
        },
      ],
    };
  }
  const names = ["events", "actions", "messages", "status", "data"] as const;
  const limitations: { readonly channel: string; readonly state: string; readonly reason: string | undefined }[] = [];
  const entries: Record<string, object> = {};
  for (const name of names) {
    const entry = terminal.evidenceCoverage[name];
    entries[name] =
      entry.status === "complete"
        ? { state: "complete" as const }
        : {
            state: entry.status,
            reason: boundedText(entry.reason, MAX_COVERAGE_REASON_BYTES).value,
          };
    if (entry.status !== "complete") {
      limitations.push({
        channel: name,
        state: entry.status,
        reason: boundedText(entry.reason, MAX_COVERAGE_REASON_BYTES).value,
      });
    }
  }
  return { coverage: entries, limitations: limitations };
}

export function projectAttemptRepricing(
  attachments: AttemptTraceAttachments,
  pricing: InspectionRepricingInput,
): InspectionRepricingResult {
  const application = readAdapterUsageAttachment(attachments.adapterUsage, attachments.models);
  const judge = readCurrentAttachment(NiceEvalCurrentRecordAttachments.judgeUsage, attachments.judgeUsage);
  function collectionState(read: typeof application | typeof judge) {
    if (read.state === "available") return read.value.collection.state;
    return read.state === "invalid" ? ("invalid" as const) : ("unavailable" as const);
  }
  return repriceRecordedUsage({
    application: application.state === "available" ? application.value : undefined,
    applicationCollection: collectionState(application),
    judge: judge.state === "available" ? judge.value : undefined,
    judgeCollection: collectionState(judge),
    pricing,
  });
}

export function projectAttemptUsage(
  attachments: Pick<AttemptTraceAttachments, "models" | "adapterUsage" | "judgeUsage" | "attemptCost" | "agentTurns">,
  models: ModelRolesWire | undefined = attachments.models,
  page = 0,
): Omit<InspectionAttemptUsageResult, "totalCosts"> & { readonly totalCosts: RecordedTotalUsageCosts } {
  const turns = readInspectionAgentTurns(attachments.agentTurns);
  const usage = projectApplicationUsage(attachments, models, turns, page);
  const application = readAdapterUsageAttachment(attachments.adapterUsage, models);
  const read = readCurrentAttachment(NiceEvalCurrentRecordAttachments.judgeUsage, attachments.judgeUsage);
  function judgeUsage() {
    if (read.state === "available") return projectJudgeUsage(read.value, page);
    if (read.state === "invalid") return { state: "invalid" as const, reason: "judge-usage-source-invalid" as const };
    return { state: "unavailable" as const, reason: "judge-usage-not-recorded" as const };
  }
  const applicationEmptyComplete =
    attachments.adapterUsage !== undefined &&
    usage.totals.requests.state === "available" &&
    usage.totals.requests.value === 0 &&
    usage.totals.costs?.totalCalls === 0;
  const cost = readCurrentAttachment(NiceEvalCurrentRecordAttachments.attemptCost, attachments.attemptCost);
  const simulatedUser = cost.state === "available" ? cost.value.simulatedUser : undefined;
  const judge = judgeUsage();
  return {
    ...usage,
    turnCacheRead: projectTurnCacheRead(turns),
    judgeUsage: judge,
    totalCosts: projectTotalUsageCosts(
      usage.totals,
      judge,
      applicationEmptyComplete,
      application.state === "available" && application.value.collection.state === "complete",
      simulatedUser,
      [
        ...recordedCostGaps("application", application.state === "available" ? application.value : undefined),
        ...recordedCostGaps("judge", read.state === "available" ? read.value : undefined),
      ],
    ),
  };
}

export function projectApplicationUsage(
  attachments: Pick<AttemptTraceAttachments, "adapterUsage" | "agentTurns">,
  models: ModelRolesWire | undefined,
  agentTurns?: InspectionAgentTurnsRead,
  page = 0,
): Omit<InspectionAttemptUsageResult, "judgeUsage" | "totalCosts" | "turnCacheRead"> {
  if (attachments.adapterUsage !== undefined) {
    const read = readAdapterUsageAttachment(attachments.adapterUsage, models);
    const modelUsage = projectAdapterModelUsage(
      read.state === "available" ? read.value : undefined,
      models,
      {
        basis: "recorded-calls",
        reason: read.state === "invalid" ? "source-invalid" : "usage-not-recorded",
      },
      true,
      page,
    );
    const empty = {
      source: "adapter" as const,
      coverage: "recorded-calls" as const,
      limitationsTruncated: false,
      omittedLimitationCount: 0,
      turns: [],
      turnsTruncated: false,
      omittedTurnCount: 0,
      observations: [],
      calls: [],
      callsTruncated: false,
      omittedCallCount: 0,
      totals: {
        inputTokens: { state: "unavailable" as const, value: null, observationCount: 0 },
        outputTokens: { state: "unavailable" as const, value: null, observationCount: 0 },
        requests: { state: "unavailable" as const, value: null, observationCount: 0 },
        costs: effectiveCostTotals([], "partial"),
      },
      hasMore: false,
      omittedObservationCount: 0,
    };
    if (read.state !== "available")
      return {
        ...empty,
        ...modelUsage,
        state: read.state,
        limitations: read.state === "invalid" ? read.issues.map((issue) => ({ issue })) : [],
      };
    const all = read.value.calls;
    const calls = effectiveUsageCalls(read.value);
    const numeric = (key: "inputTokens" | "inputTotalTokens" | "outputTokens") => {
      const known = all.flatMap((call) => (call[key] === null ? [] : [call[key]]));
      const sum = known.reduce((total, value) => total + value, 0);
      if (known.length === 0 || !Number.isSafeInteger(sum))
        return { state: "unavailable" as const, value: null, observationCount: known.length };
      return {
        state:
          known.length === all.length && read.value.collection.state === "complete"
            ? ("available" as const)
            : ("partial" as const),
        value: sum,
        observationCount: known.length,
      };
    };
    const inputTokens = numeric("inputTokens");
    const outputTokens = numeric("outputTokens");
    const complete =
      all.length > 0 &&
      read.value.collection.state === "complete" &&
      all.every(
        (call) =>
          call.status !== "unknown" &&
          call.outputTokens !== null &&
          (call.inputTotalTokens !== null ||
            [call.inputTokens, call.cacheReadTokens, call.cacheWriteTokens].every((value) => value !== null)),
      );
    const unknownCosts = calls.filter((call) => call.effectiveCost === undefined).length;
    const partialCosts = calls.filter((call) => call.effectiveCost?.state === "partial").length;
    const costs = effectiveCostTotals(calls, read.value.collection.state);
    const paged = callPage(
      calls.map((call) => ({ ...call, effectiveCost: call.effectiveCost ?? null })),
      [],
      page,
      INSPECTION_USAGE_CALL_PAGE_SIZE,
      INSPECTION_USAGE_CALL_PAGE_BYTES,
    );
    return {
      ...empty,
      ...modelUsage,
      state: complete ? "complete" : "partial",
      limitations: [
        ...(complete
          ? []
          : [
              {
                issue:
                  "Adapter usage describes only recorded calls; some quantities or terminal outcomes are unknown, or capture is incomplete.",
              },
            ]),
        ...(unknownCosts === 0
          ? []
          : [{ issue: `${unknownCosts} calls have no reported cost or sealed price estimate.` }]),
        ...(partialCosts === 0
          ? []
          : [
              {
                issue: `${partialCosts} calls have partial estimates; sealed pricing evidence identifies unknown token or rate buckets.`,
              },
            ]),
      ],
      ...paged,
      priceReceipts: read.value.priceReceipts,
      totals: {
        ...empty.totals,
        inputTokens,
        outputTokens,
        inputTotalTokens: numeric("inputTotalTokens"),
        requests: {
          state: read.value.collection.state === "complete" ? "available" : "partial",
          value: all.length,
          observationCount: all.length,
        },
        costs,
      },
      hasMore: paged.callsTruncated,
    };
  }
  const read = agentTurns ?? readInspectionAgentTurns(attachments.agentTurns);
  const usage = projectUsage(read);
  function modelUsageReason() {
    if (read.state === "invalid") return "source-invalid" as const;
    if (attachments.agentTurns === undefined) return "usage-not-recorded" as const;
    return "physical-call-identity-not-recorded" as const;
  }
  return {
    ...usage,
    ...projectAdapterModelUsage(undefined, models, {
      basis: attachments.agentTurns === undefined ? "unavailable" : "reported-sends",
      reason: modelUsageReason(),
    }),
  };
}

/** Fold the sealed observations before applying the CLI's Turn and observation preview limits. */
function projectTurnCacheRead(read: InspectionAgentTurnsRead): InspectionAttemptUsageResult["turnCacheRead"] {
  type Summary = InspectionAttemptUsageResult["turnCacheRead"];
  const missingTurns: Summary["missingTurns"][number][] = [];
  const result = (state: Summary["state"], reason: Summary["reason"], value: number | null = null): Summary => ({
    basis: "turn-observed",
    state,
    value,
    reason,
    coveredTurns,
    missingTurns,
  });
  let coveredTurns = 0;
  if (read.state !== "available") {
    return result("unavailable", read.state === "invalid" ? "source-invalid" : "no-token-buckets");
  }

  let cached = 0;
  let input = 0;
  let observed = false;
  let incomplete = read.value.collection.limitations.some(
    ({ target }) => target === "turn" || USAGE_TARGETS.has(target),
  );
  for (const turn of read.value.segments) {
    let turnInput: number | undefined;
    let turnCached: number | undefined;
    for (const observation of turn.usage) {
      if (observation.kind !== "token-bucket") continue;
      if (observation.bucket === "input") turnInput = (turnInput ?? 0) + observation.tokens;
      if (observation.bucket === "cache-read") turnCached = (turnCached ?? 0) + observation.tokens;
    }
    if (turnInput !== undefined || turnCached !== undefined) observed = true;
    if (turn.terminal.state === "unavailable" || turn.terminal.evidenceCoverage.usage.status !== "complete")
      incomplete = true;
    if (turnInput === undefined || turnCached === undefined) {
      const buckets: Summary["missingTurns"][number]["buckets"][number][] = [];
      if (turnInput === undefined) buckets.push("input");
      if (turnCached === undefined) buckets.push("cache-read");
      missingTurns.push({ turnId: turn.turnId, buckets });
      continue;
    }
    input += turnInput;
    cached += turnCached;
    coveredTurns++;
  }
  if (!observed) {
    missingTurns.length = 0;
    return result("unavailable", "no-token-buckets");
  }
  const denominator = input + cached;
  const partial = missingTurns.length > 0 || incomplete;
  if (!Number.isSafeInteger(denominator)) return result(partial ? "partial" : "unavailable", "unsafe-token-total");
  const value = denominator === 0 ? null : cached / denominator;
  if (missingTurns.length > 0) return result("partial", "missing-token-buckets", value);
  if (incomplete) return result("partial", "collection-incomplete", value);
  if (value === null) return result("unavailable", "zero-observed-input");
  return result("complete", null, value);
}

export function projectAdapterUsageTokens(
  attachment: TraceAttachmentInput,
  models?: ModelRolesWire,
): { readonly value: number | null; readonly state: "available" | "partial" | "unavailable" | "failed" } {
  const read = readAdapterUsageAttachment(attachment, models);
  if (read.state !== "available") {
    return {
      value: null,
      state: read.state === "invalid" ? ("failed" as const) : ("unavailable" as const),
    };
  }
  const material = adapterTokenMaterial(read.value, "totalTokens");
  function tokenState() {
    if (material.state === "exact") return "available" as const;
    if (material.state === "lower-bound") return "partial" as const;
    return material.reason === "usage-exceeds-safe-integer" ? ("failed" as const) : ("unavailable" as const);
  }
  return {
    value: material.state === "unavailable" ? null : material.value,
    state: tokenState(),
  };
}

function projectUsage(
  agentTurns: ReturnType<typeof readAgentTurns>,
): Omit<
  InspectionAttemptUsageResult,
  "configuredModels" | "modelGroups" | "judgeUsage" | "totalCosts" | "cacheRead" | "turnCacheRead"
> {
  const sourceState = availability(agentTurns, USAGE_TARGETS);
  if (agentTurns.state !== "available") {
    return {
      ...sourceState,
      limitationsTruncated: false,
      omittedLimitationCount: 0,
      turns: [],
      turnsTruncated: false,
      omittedTurnCount: 0,
      observations: [],
      totals: unavailableInspectionUsageTotals(),
      hasMore: false,
      omittedObservationCount: 0,
    };
  }

  const limitations: InspectionAttemptUsageResult["limitations"][number][] = [...sourceState.limitations];
  const turns = agentTurns.value.segments.slice(0, MAX_CONVERSATION_TURNS).map((turn) => {
    function usageCoverage() {
      if (turn.terminal.state === "unavailable") return { state: "unavailable" as const, reason: turn.terminal.reason };
      if (turn.terminal.evidenceCoverage.usage.status === "complete") return { state: "complete" as const };
      return {
        state: turn.terminal.evidenceCoverage.usage.status,
        reason: boundedText(turn.terminal.evidenceCoverage.usage.reason, MAX_COVERAGE_REASON_BYTES).value,
      };
    }
    const coverage = usageCoverage();
    if (coverage.state !== "complete") {
      limitations.push({
        source: "agent-turns",
        turnId: turn.turnId,
        channel: "usage",
        ...coverage,
      });
    }
    return { turnId: turn.turnId, coverage };
  });
  const allObservations: InspectionAttemptUsageResult["observations"][number][] = [];
  for (const turn of agentTurns.value.segments) {
    for (const observation of turn.usage) {
      allObservations.push({ turnId: turn.turnId, ...observation });
    }
  }
  const observations = allObservations.slice(0, MAX_USAGE_OBSERVATIONS);
  return {
    state: sourceState.state === "complete" && limitations.length === 0 ? "complete" : "partial",
    limitations: limitations.slice(0, MAX_SOURCE_LIMITATIONS),
    limitationsTruncated: limitations.length > MAX_SOURCE_LIMITATIONS,
    omittedLimitationCount: Math.max(0, limitations.length - MAX_SOURCE_LIMITATIONS),
    turns: turns,
    turnsTruncated: turns.length < agentTurns.value.segments.length,
    omittedTurnCount: agentTurns.value.segments.length - turns.length,
    observations: observations,
    totals: usageTotals(allObservations, sourceState.state),
    hasMore: observations.length < allObservations.length,
    omittedObservationCount: allObservations.length - observations.length,
  };
}

export function unavailableInspectionUsageTotals(): InspectionAttemptUsageResult["totals"] {
  const unavailable = {
    state: "unavailable" as const,
    value: null,
    observationCount: 0,
  };
  return {
    inputTokens: unavailable,
    outputTokens: unavailable,
    requests: unavailable,
    providerCosts: {
      state: "unavailable" as const,
      values: [],
      observationCount: 0,
    },
  };
}

export function combineInspectionUsageTotals(
  usages: readonly Pick<InspectionAttemptUsageResult, "totals">[],
  incomplete: boolean,
): InspectionAttemptUsageResult["totals"] {
  const numeric = (
    key: "inputTokens" | "outputTokens" | "requests",
  ): InspectionAttemptUsageResult["totals"][typeof key] => {
    const available = usages.flatMap(({ totals }) => {
      const value = totals[key];
      return value.value === null ? [] : [value];
    });
    if (available.length === 0) {
      return { state: "unavailable", value: null, observationCount: 0 };
    }
    return {
      state:
        incomplete || usages.some(({ totals }) => totals[key].state !== "available")
          ? ("partial" as const)
          : ("available" as const),
      value: available.reduce((total, entry) => total + entry.value!, 0),
      observationCount: available.reduce((total, entry) => total + entry.observationCount, 0),
    };
  };
  const costs = new Map<string, { readonly amount: string; readonly count: number }>();
  for (const usage of usages) {
    for (const entry of usage.totals.providerCosts?.values ?? []) {
      const current = costs.get(entry.currency);
      costs.set(entry.currency, {
        amount: current === undefined ? entry.value : addCanonicalDecimal(current.amount, entry.value),
        count: (current?.count ?? 0) + entry.observationCount,
      });
    }
  }
  const effectiveCosts = new Map<
    string,
    {
      readonly amount: string;
      readonly coveredCalls: number;
      readonly reportedCalls: number;
      readonly estimatedCalls: number;
    }
  >();
  const adapterCosts = usages.flatMap(({ totals }) => (totals.costs === undefined ? [] : [totals.costs]));
  for (const total of adapterCosts) {
    for (const entry of total.values) {
      const current = effectiveCosts.get(entry.currency);
      effectiveCosts.set(entry.currency, {
        amount: current === undefined ? entry.value : addCanonicalDecimal(current.amount, entry.value),
        coveredCalls: (current?.coveredCalls ?? 0) + entry.coveredCalls,
        reportedCalls: (current?.reportedCalls ?? 0) + entry.reportedCalls,
        estimatedCalls: (current?.estimatedCalls ?? 0) + entry.estimatedCalls,
      });
    }
  }
  function sourceFor(reported: number, estimated: number) {
    if (reported > 0 && estimated > 0) return "mixed" as const;
    if (reported > 0) return "reported" as const;
    if (estimated > 0) return "estimated" as const;
    return null;
  }
  function costState() {
    if (effectiveCosts.size === 0) return "unavailable" as const;
    if (incomplete || adapterCosts.some((value) => value.state !== "complete")) return "partial" as const;
    return "complete" as const;
  }
  const totalCalls = adapterCosts.reduce((sum, value) => sum + value.totalCalls, 0);
  const reportedCalls = [...effectiveCosts.values()].reduce((sum, value) => sum + value.reportedCalls, 0);
  const estimatedCalls = [...effectiveCosts.values()].reduce((sum, value) => sum + value.estimatedCalls, 0);
  return {
    inputTokens: numeric("inputTokens"),
    outputTokens: numeric("outputTokens"),
    requests: numeric("requests"),
    ...(costs.size === 0 && adapterCosts.length > 0
      ? {}
      : {
          providerCosts:
            costs.size === 0
              ? unavailableInspectionUsageTotals().providerCosts
              : {
                  state:
                    incomplete || usages.some(({ totals }) => totals.providerCosts?.state !== "available")
                      ? ("partial" as const)
                      : ("available" as const),
                  values: [...costs.entries()]
                    .sort(([left], [right]) => left.localeCompare(right))
                    .map(([currency, total]) => ({
                      currency,
                      value: total.amount,
                      observationCount: total.count,
                    })),
                  observationCount: [...costs.values()].reduce((total, value) => total + value.count, 0),
                },
        }),
    ...(adapterCosts.length === 0
      ? {}
      : {
          costs: {
            state: costState(),
            source: sourceFor(reportedCalls, estimatedCalls),
            values: [...effectiveCosts.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([currency, value]) => ({
                currency,
                value: value.amount,
                source: sourceFor(value.reportedCalls, value.estimatedCalls)!,
                coveredCalls: value.coveredCalls,
                reportedCalls: value.reportedCalls,
                estimatedCalls: value.estimatedCalls,
              })),
            totalCalls,
          },
        }),
  };
}

function usageTotals(
  observations: InspectionAttemptUsageResult["observations"],
  projectionState: InspectionAttemptUsageResult["state"],
): InspectionAttemptUsageResult["totals"] {
  const state = projectionState === "complete" ? ("available" as const) : ("partial" as const);
  const numeric = (values: readonly number[]): InspectionAttemptUsageResult["totals"]["inputTokens"] =>
    values.length === 0
      ? { state: "unavailable", value: null, observationCount: 0 }
      : {
          state,
          value: values.reduce((total, value) => total + value, 0),
          observationCount: values.length,
        };
  const inputTokens = observations.flatMap((observation) =>
    observation.kind === "token-bucket" && observation.bucket === "input" ? [observation.tokens] : [],
  );
  const outputTokens = observations.flatMap((observation) =>
    observation.kind === "token-bucket" && observation.bucket === "output" ? [observation.tokens] : [],
  );
  const requests = observations.filter((observation) => observation.kind === "request");
  const costs = new Map<string, { readonly amount: string; readonly count: number }>();
  for (const observation of observations) {
    if (observation.kind !== "provider-cost") continue;
    const current = costs.get(observation.currency);
    costs.set(observation.currency, {
      amount: current === undefined ? observation.amount : addCanonicalDecimal(current.amount, observation.amount),
      count: (current?.count ?? 0) + 1,
    });
  }
  return {
    inputTokens: numeric(inputTokens),
    outputTokens: numeric(outputTokens),
    requests: numeric(requests.map(() => 1)),
    providerCosts:
      costs.size === 0
        ? {
            state: "unavailable" as const,
            values: [],
            observationCount: 0,
          }
        : {
            state,
            values: [...costs.entries()]
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([currency, total]) => ({
                currency,
                value: total.amount,
                observationCount: total.count,
              })),
            observationCount: [...costs.values()].reduce((total, value) => total + value.count, 0),
          },
  };
}

function addCanonicalDecimal(left: string, right: string): string {
  const split = (value: string): readonly [digits: bigint, scale: number] => {
    const [integer, fraction = ""] = value.split(".");
    return [BigInt(`${integer}${fraction}`), fraction.length];
  };
  const [leftDigits, leftScale] = split(left);
  const [rightDigits, rightScale] = split(right);
  const scale = Math.max(leftScale, rightScale);
  const sum = leftDigits * 10n ** BigInt(scale - leftScale) + rightDigits * 10n ** BigInt(scale - rightScale);
  if (scale === 0) return sum.toString();
  const padded = sum.toString().padStart(scale + 1, "0");
  const integer = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/u, "");
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

function readSandboxCommands(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(NiceEvalCurrentRecordAttachments.sandboxCommands, attachment);
}

export function projectAttemptTiming(
  attachments: Pick<AttemptTraceAttachments, "runnerActivities">,
  offset = 0,
): InspectionAttemptTimingResult {
  return projectTiming(readRunnerActivities(attachments.runnerActivities), offset);
}

function projectTiming(
  activities: ReturnType<typeof readRunnerActivities>,
  offset: number,
): InspectionAttemptTimingResult {
  const sourceState = availability(activities, TIMING_TARGETS);
  if (activities.state !== "available") {
    const limitations = sourceState.limitations.slice(0, MAX_SOURCE_LIMITATIONS);
    return {
      state: sourceState.state,
      limitations: limitations,
      limitationsTruncated: limitations.length < sourceState.limitations.length,
      omittedLimitationCount: sourceState.limitations.length - limitations.length,
      activities: [],
      hasMore: false,
      omittedActivityCount: 0,
    };
  }
  const items = activities.value.segments.slice(offset, offset + MAX_ACTIVITIES).map((activity) => ({
    activityId: activity.activityId,
    sequence: activity.sequence,
    parentActivityId: activity.parentActivityId,
    turnId: activity.turnId,
    phase: projectLifecyclePhase(activity.phase),
    label: projectLifecyclePhase(activity.label),
    startOffsetMs: activity.startOffsetMs,
    durationMs: activity.durationMs,
    outcome: activity.outcome,
    ...("entryId" in activity && activity.entryId !== undefined ? { entryId: activity.entryId } : {}),
    ...("transmissionOrdinal" in activity && activity.transmissionOrdinal !== undefined
      ? { transmissionOrdinal: activity.transmissionOrdinal }
      : {}),
  }));
  const limitations = sourceState.limitations.slice(0, MAX_SOURCE_LIMITATIONS);
  return {
    state: sourceState.state,
    limitations: limitations,
    limitationsTruncated: limitations.length < sourceState.limitations.length,
    omittedLimitationCount: sourceState.limitations.length - limitations.length,
    activities: items,
    hasMore: offset + items.length < activities.value.segments.length,
    omittedActivityCount: Math.max(0, activities.value.segments.length - offset - items.length),
  };
}

function readRunnerActivities(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(NiceEvalCurrentRecordAttachments.runnerActivities.attempt, attachment);
}

function projectDiagnostics(
  diagnostics: ReturnType<typeof readRunnerDiagnostics>,
): InspectionTraceResult["diagnostics"] {
  const sourceState = availability(diagnostics, DIAGNOSTIC_TARGETS);
  const limitations = sourceState.limitations.slice(0, MAX_SOURCE_LIMITATIONS);
  if (diagnostics.state !== "available") {
    return {
      state: sourceState.state,
      limitations: limitations,
      limitationsTruncated: limitations.length < sourceState.limitations.length,
      omittedLimitationCount: sourceState.limitations.length - limitations.length,
      items: [],
      hasMore: false,
      omittedDiagnosticCount: 0,
    };
  }
  const items = diagnostics.value.segments.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => {
    const summary = boundedText(diagnostic.summary, MAX_DIAGNOSTIC_SUMMARY_BYTES);
    const causes = diagnostic.causes.slice(0, MAX_DIAGNOSTIC_CAUSES).map((cause) => {
      const causeSummary = boundedText(cause.summary, MAX_DIAGNOSTIC_CAUSE_BYTES);
      return {
        code: projectLifecyclePhase(cause.code),
        summary: causeSummary.value,
        summaryTruncated: causeSummary.truncated,
      };
    });
    return {
      diagnosticId: diagnostic.diagnosticId,
      evidenceId: diagnostic.diagnosticId,
      sequence: diagnostic.sequence,
      turnId: diagnostic.turnId,
      phase: projectLifecyclePhase(diagnostic.phase),
      kind: diagnostic.kind,
      code: projectLifecyclePhase(diagnostic.code),
      summary: summary.value,
      summaryTruncated: summary.truncated,
      causes: causes,
      causesTruncated: causes.length < diagnostic.causes.length,
      omittedCauseCount: diagnostic.causes.length - causes.length,
      redaction: diagnostic.redaction,
      sourceFrame: diagnostic.sourceFrame === null ? null : diagnostic.sourceFrame.value,
    };
  });
  return {
    state: sourceState.state,
    limitations: limitations,
    limitationsTruncated: limitations.length < sourceState.limitations.length,
    omittedLimitationCount: sourceState.limitations.length - limitations.length,
    items: items,
    hasMore: items.length < diagnostics.value.segments.length,
    omittedDiagnosticCount: diagnostics.value.segments.length - items.length,
  };
}

function readRunnerDiagnostics(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(NiceEvalCurrentRecordAttachments.runnerDiagnostics.attempt, attachment);
}

function readVerifiedText(source: InspectionFactSource, metadata: PersistedContentMetadata): string {
  const bytes = new Uint8Array(metadata.byteLength);
  const digest = new InspectionSha256();
  let offset = 0;
  let afterOrdinal = -1;
  let expectedOrdinal = 0;
  let observedChunks = 0;
  while (true) {
    const page = source.readContentPage(metadata.contentId, afterOrdinal, CONTENT_PAGE_SIZE);
    if (
      page.contentId !== metadata.contentId ||
      page.afterOrdinal !== afterOrdinal ||
      (page.chunks.length === 0 && page.nextOrdinal !== null)
    )
      throw new Error("Content page is invalid");
    for (const chunk of page.chunks) {
      if (chunk.ordinal !== expectedOrdinal || offset + chunk.bytes.byteLength > bytes.byteLength) {
        throw new Error("Content chunk sequence is invalid");
      }
      bytes.set(chunk.bytes, offset);
      digest.update(chunk.bytes);
      offset += chunk.bytes.byteLength;
      expectedOrdinal += 1;
      observedChunks += 1;
    }
    if (page.nextOrdinal === null) break;
    if (page.nextOrdinal !== expectedOrdinal - 1 || observedChunks > metadata.chunkCount) {
      throw new Error("Content continuation is invalid");
    }
    afterOrdinal = page.nextOrdinal;
  }
  if (
    offset !== metadata.byteLength ||
    observedChunks !== metadata.chunkCount ||
    digest.digestHex() !== metadata.digest
  )
    throw new Error("Content does not match its sealed metadata");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function boundedText(
  value: string,
  maximumBytes: number,
): {
  readonly value: string;
  readonly truncated: boolean;
} {
  if (utf8ByteLength(value) <= maximumBytes) {
    return { value, truncated: false };
  }
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > maximumBytes) break;
    output += character;
    bytes += characterBytes;
  }
  return { value: output, truncated: true };
}

function exactMarker(value: unknown, key: string): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
}

function hasOwnMarker(value: unknown, key: string): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key)
  );
}

function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}

/** Bounded diagnostic projection shared by the Attempt overview and execution outline. */
export function projectAttemptDiagnostics(attachment?: TraceAttachmentInput): InspectionTraceResult["diagnostics"] {
  return projectDiagnostics(readRunnerDiagnostics(attachment));
}

/** Resolve a saved diagnostic by the Evidence ID advertised in attempt.get. */
export function projectDiagnosticDetail(attachment: TraceAttachmentInput | undefined, evidenceId: string) {
  const diagnostics = readRunnerDiagnostics(attachment);
  if (diagnostics.state !== "available") return undefined;
  const diagnostic = diagnostics.value.segments.find((item) => item.diagnosticId === evidenceId);
  return diagnostic === undefined
    ? undefined
    : {
        kind: "diagnostic" as const,
        evidenceId,
        phase: projectLifecyclePhase(diagnostic.phase),
        code: diagnostic.code,
        summary: diagnostic.summary,
      };
}
