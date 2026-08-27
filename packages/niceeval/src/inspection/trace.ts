import { createHash } from "node:crypto";

import { Result, Schema } from "effect";

import {
  mintRecordContentHandle,
  type RecordContentHandle,
} from "../record/attachment/content.ts";
import {
  enumerateRecordAttachmentClosure,
  hydrateRecordAttachmentCurrent,
  mintRecordAttachmentReference,
  RecordAttachmentReference,
  recordAttachmentReferenceWire,
  type RecordAttachmentDefinition,
} from "../record/attachment/protocol.ts";
import { NiceEvalCurrentRecordAttachments } from "../record/family/current.ts";
import type { AgentTurnsAttachment } from "../record/family/agent-turns/schema.ts";
import type { SourceReceiptLimitation } from "../record/family/source-receipt/index.ts";
import type {
  PersistedContentMetadata,
  SealedAttachmentMetadata,
} from "../record/sqlite/index.ts";
import { closeInspectionJson, type InspectionJson } from "./codec.ts";
import { InspectionSha256, utf8ByteLength } from "./bytes.ts";
import { INSPECTION_RESULT_BYTE_LIMIT } from "./limits.ts";
import type { InspectionFactSource } from "./source.ts";
import type {
  InspectionAttemptTimingResult,
  InspectionAttemptUsageResult,
  InspectionTraceDetailResult,
  InspectionTraceResult,
} from "./results.ts";

const TRACE_PROJECTION_FORMAT = "niceeval.inspection.trace/v1";
const CONTENT_PAGE_SIZE = 64;
const MAX_SOURCE_LIMITATIONS = 32;
const MAX_CONVERSATION_TURNS = 32;
const MAX_CONVERSATION_ITEMS = 64;
const MAX_COMMANDS = 8;
const MAX_USAGE_OBSERVATIONS = 64;
const MAX_ACTIVITIES = 64;
const MAX_DIAGNOSTICS = 16;
const MAX_DIAGNOSTIC_CAUSES = 4;
const MAX_COMMAND_ARGUMENTS = 8;
const MAX_CONVERSATION_TEXT_BYTES = 1_024;
const MAX_COVERAGE_REASON_BYTES = 256;
const MAX_COMMAND_TEXT_BYTES = 1_024;
const MAX_COMMAND_ARGUMENT_BYTES = 128;
const MAX_COMMAND_STREAM_TEXT_BYTES = 1_024;
const MAX_DIAGNOSTIC_SUMMARY_BYTES = 256;
const MAX_DIAGNOSTIC_CAUSE_BYTES = 128;

export interface TraceAttachmentInput {
  readonly physical: SealedAttachmentMetadata;
  readonly value: InspectionJson;
}

export interface AttemptTraceAttachments {
  readonly agentTurns?: TraceAttachmentInput;
  readonly turnContexts?: TraceAttachmentInput;
  readonly sandboxCommands?: TraceAttachmentInput;
  readonly runnerActivities?: TraceAttachmentInput;
  readonly runnerDiagnostics?: TraceAttachmentInput;
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
export type InspectionAgentTurnsRead = AttachmentRead<AgentTurnsAttachment>;
type InspectionTraceDetailItem = Extract<
  InspectionTraceDetailResult,
  { readonly kind: "item" }
>["item"];

interface CollectionValue {
  readonly collection: {
    readonly state: "complete" | "partial";
    readonly limitations: readonly SourceReceiptLimitation[];
  };
}

interface ProjectionState {
  readonly state: "complete" | "partial" | "not-recorded" | "invalid";
  readonly limitations: readonly (
    | SourceReceiptLimitation
    | { readonly issue: string }
  )[];
}

export function projectAttemptTrace(
  source: InspectionFactSource,
  attachments: AttemptTraceAttachments,
): InspectionTraceResult {
  const agentTurns = readCurrentAttachment(
    NiceEvalCurrentRecordAttachments.agentTurns,
    attachments.agentTurns,
  );
  const turnContexts = readCurrentAttachment(
    NiceEvalCurrentRecordAttachments.turnContexts,
    attachments.turnContexts,
  );
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
      ? Object.freeze([])
      : Object.freeze([Object.freeze({
          source: "turn-contexts" as const,
          state: contextProjection.state,
          limitations: contextProjection.limitations,
        })]);
  const allConversationLimitations = [
    ...conversationProjection.limitations,
    ...conversationEvidenceLimitations,
    ...contextLimitations,
  ];
  const conversationLimitations = allConversationLimitations.slice(0, MAX_SOURCE_LIMITATIONS);
  const commandLimitations = commandProjection.limitations.slice(0, MAX_SOURCE_LIMITATIONS);
  const retainedTurns = agentTurns.state === "available"
    ? agentTurns.value.segments.slice(0, MAX_CONVERSATION_TURNS)
    : [];
  const contexts = turnContexts.state === "available"
    ? new Map(turnContexts.value.segments.map((segment) => [segment.turnId, segment] as const))
    : new Map();
  const turns = retainedTurns.length > 0
    ? retainedTurns.map((turn) => Object.freeze({
        turnId: turn.turnId,
        sequence: turn.sequence,
        ...("sessionId" in turn ? { sessionId: turn.sessionId } : {}),
        outcome: turn.outcome,
        terminal: projectTypedTurnTerminal(turn.terminal),
        context: projectTypedTurnContext(contexts.get(turn.turnId)),
      }))
    : [];
  const items = retainedTurns.length > 0
    ? retainedTurns.flatMap((turn) => turn.items.map((item) =>
        projectTypedConversationItem(item, turn.turnId)))
      .slice(0, MAX_CONVERSATION_ITEMS)
    : [];
  const commandItems = sandboxCommands.state === "available"
    ? sandboxCommands.value.segments.slice(0, MAX_COMMANDS).map((command) => Object.freeze({
        commandId: command.commandId,
        phase: command.phase,
        outcome: command.outcome,
      }))
    : [];
  const identityIndex = projectTypedTraceIdentityIndex(agentTurns, sandboxCommands);
  const totalTurnCount = agentTurns.state === "available" ? agentTurns.value.segments.length : 0;
  const totalItemCount = agentTurns.state === "available"
    ? agentTurns.value.segments.reduce((total, turn) => total + turn.items.length, 0)
    : 0;
  const totalCommandCount = sandboxCommands.state === "available"
    ? sandboxCommands.value.segments.length
    : 0;
  const result: InspectionTraceResult = Object.freeze({
    format: TRACE_PROJECTION_FORMAT,
    conversation: Object.freeze({
      state: conversationProjection.state === "complete" && allConversationLimitations.length > 0
        ? "partial"
        : conversationProjection.state,
      limitations: Object.freeze(conversationLimitations),
      limitationsTruncated: conversationLimitations.length < allConversationLimitations.length,
      omittedLimitationCount: allConversationLimitations.length - conversationLimitations.length,
      turns: Object.freeze(turns),
      turnsTruncated: turns.length < totalTurnCount,
      omittedTurnCount: totalTurnCount - turns.length,
      items: Object.freeze(items),
      itemsTruncated: items.length < totalItemCount,
      omittedItemCount: totalItemCount - items.length,
    }),
    identityIndex,
    commands: Object.freeze({
      state: commandProjection.state,
      limitations: Object.freeze(commandLimitations),
      limitationsTruncated: commandLimitations.length < commandProjection.limitations.length,
      omittedLimitationCount: commandProjection.limitations.length - commandLimitations.length,
      items: Object.freeze(commandItems),
      hasMore: commandItems.length < totalCommandCount,
      omittedCommandCount: totalCommandCount - commandItems.length,
    }),
    diagnostics: projectDiagnostics(runnerDiagnostics),
  });
  if (jsonByteLength(result) > INSPECTION_RESULT_BYTE_LIMIT) {
    throw new Error("Trace semantic projection exceeds its fixed result byte limit");
  }
  return result;
}

type TraceEvidenceCoverageLimitation = Extract<
  InspectionTraceResult["conversation"]["limitations"][number],
  { readonly source: "agent-turns" }
>;

type InspectionTurnContextSegment = ReturnType<typeof readTurnContexts> extends AttachmentRead<infer Value>
  ? Value extends { readonly segments: readonly (infer Segment)[] } ? Segment : never
  : never;

function projectTypedTurnTerminal(
  terminal: ReturnType<typeof readAgentTurns> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment extends { readonly terminal: infer Terminal } ? Terminal : never
      : never
    : never,
): InspectionTraceResult["conversation"]["turns"][number]["terminal"] {
  const coverage = conversationCoverage(terminal);
  if (terminal.state === "unavailable") {
    return Object.freeze({
      state: terminal.state,
      reason: terminal.reason,
      coverage: Object.freeze({ state: "unavailable" as const, reason: terminal.reason }),
    });
  }
  return Object.freeze({
    state: terminal.state,
    status: terminal.status,
    coverage: coverage.coverage,
  }) as InspectionTraceResult["conversation"]["turns"][number]["terminal"];
}

function projectTypedTurnContext(
  context: InspectionTurnContextSegment | undefined,
): InspectionTraceResult["conversation"]["turns"][number]["context"] {
  if (context === undefined) return Object.freeze({ state: "not-recorded" as const });
  if ("state" in context.source) {
    return Object.freeze({
      state: context.source.state,
      reason: context.source.reason,
      sessionIndex: context.sessionIndex,
      turnIndex: context.turnIndex,
      sourceOrder: context.sourceOrder,
    });
  }
  if (context.sourceOrder === null) {
    throw new Error("Mapped turn context is missing its validated source order");
  }
  return Object.freeze({
    sessionIndex: context.sessionIndex,
    turnIndex: context.turnIndex,
    sourceOrder: context.sourceOrder,
    ...context.source.value,
  });
}

function typedConversationCoverageLimitations(
  agentTurns: ReturnType<typeof readAgentTurns>,
): readonly TraceEvidenceCoverageLimitation[] {
  if (agentTurns.state !== "available") return Object.freeze([]);
  const limitations: TraceEvidenceCoverageLimitation[] = [];
  const channels = ["events", "actions", "messages", "status", "data"] as const;
  for (const turn of agentTurns.value.segments) {
    if (turn.terminal.state === "unavailable") {
      limitations.push(Object.freeze({
        source: "agent-turns",
        turnId: turn.turnId,
        channel: "conversation",
        state: "unavailable",
        reason: turn.terminal.reason,
      }));
      continue;
    }
    for (const channel of channels) {
      const coverage = turn.terminal.evidenceCoverage[channel];
      if (coverage.status === "complete") continue;
      limitations.push(Object.freeze({
        source: "agent-turns",
        turnId: turn.turnId,
        channel,
        state: coverage.status,
        reason: boundedText(coverage.reason, MAX_COVERAGE_REASON_BYTES).value,
      }));
    }
  }
  return Object.freeze(limitations);
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
    case "item": detail = projectTraceItemDetail(agentTurns, selector.itemId); break;
    case "tool-occurrence": {
      detail = projectToolOccurrenceDetail(agentTurns, selector.toolOccurrenceId);
      break;
    }
    case "command": detail = projectTraceCommandDetail(source, commands, selector.commandId); break;
  }
  if (detail === undefined) return undefined;
  if (jsonByteLength(detail) > INSPECTION_RESULT_BYTE_LIMIT) {
    throw new Error("Trace detail exceeds its fixed result byte limit");
  }
  return detail;
}

function projectTraceIdentityIndex(
  agentTurns: ReturnType<typeof readAgentTurns>,
  commands: ReturnType<typeof readSandboxCommands>,
): InspectionJson {
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
  const commandIds = commands.state === "available"
    ? commands.value.segments.map((command) => command.commandId)
    : [];
  return closeJson(Object.freeze({
    itemIds: Object.freeze(itemIds),
    toolOccurrenceIds: agentTurns.state === "available" && agentTurns.value.state === "legacy"
      ? Object.freeze({
          state: "unavailable" as const,
          reason: "exact-tool-occurrence-identity-not-recorded" as const,
          ids: Object.freeze([]),
        })
      : Object.freeze({
          state: agentTurns.state === "available" ? "available" as const : agentTurns.state,
          ids: Object.freeze([...toolOccurrenceIds]),
        }),
    commandIds: Object.freeze(commandIds),
  }));
}

function projectTypedTraceIdentityIndex(
  agentTurns: ReturnType<typeof readAgentTurns>,
  commands: ReturnType<typeof readSandboxCommands>,
): InspectionTraceResult["identityIndex"] {
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
  return Object.freeze({
    itemIds: Object.freeze(itemIds),
    toolOccurrenceIds: Object.freeze({ ids: Object.freeze([...toolOccurrenceIds]) }),
    commandIds: Object.freeze(commands.state === "available"
      ? commands.value.segments.map(({ commandId }) => commandId)
      : []),
  });
}

function projectTypedConversationItem(
  item: ReturnType<typeof readAgentTurns> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment extends { readonly items: readonly (infer Item)[] } ? Item : never
      : never
    : never,
  turnId: string,
): InspectionTraceResult["conversation"]["items"][number] {
  const sequence = "sessionSequence" in item ? item.sessionSequence : item.sequence;
  const base = { itemId: item.itemId, turnId, sequence };
  switch (item.kind) {
    case "message": return Object.freeze({ ...base, kind: item.kind, role: item.role, text: boundedText(item.text, MAX_CONVERSATION_TEXT_BYTES).value });
    case "tool-start": return Object.freeze({ ...base, kind: "tool-call", tool: item.tool, input: boundedText(item.inputSummary, MAX_CONVERSATION_TEXT_BYTES).value, toolOccurrenceId: item.toolOccurrenceId });
    case "tool-finish": return Object.freeze({ ...base, kind: "tool-result", outcome: item.outcome, output: boundedText(item.outputSummary, MAX_CONVERSATION_TEXT_BYTES).value, ...(item.occurrence.state === "exact" ? { toolOccurrenceId: item.occurrence.toolOccurrenceId } : {}) });
    case "tool-call": return Object.freeze({ ...base, kind: item.kind, tool: item.tool, input: boundedText(item.inputSummary, MAX_CONVERSATION_TEXT_BYTES).value });
    case "tool-result": return Object.freeze({ ...base, kind: item.kind, outcome: item.outcome, output: boundedText(item.outputSummary, MAX_CONVERSATION_TEXT_BYTES).value });
    case "thinking-summary":
    case "compaction":
    case "context-injection": return Object.freeze({ ...base, kind: item.kind, summary: boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES).value });
    case "subagent": return Object.freeze({ ...base, kind: item.kind, state: item.state, label: item.label, summary: boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES).value });
    case "input-request": return Object.freeze({ ...base, kind: item.kind, state: item.state, prompt: boundedText(item.promptSummary, MAX_CONVERSATION_TEXT_BYTES).value, response: item.responseSummary === null ? null : boundedText(item.responseSummary, MAX_CONVERSATION_TEXT_BYTES).value });
    case "skill-load":
    case "conversation-error": return Object.freeze({ ...base, kind: item.kind, code: item.code, summary: boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES).value });
  }
}

function projectTraceItemDetail(
  agentTurns: ReturnType<typeof readAgentTurns>,
  itemId: string,
): Extract<InspectionTraceDetailResult, { readonly kind: "item" }> | undefined {
  if (agentTurns.state !== "available") return undefined;
  for (const turn of agentTurns.value.segments) {
    const item = turn.items.find((candidate) => candidate.itemId === itemId);
    if (item === undefined) continue;
    return Object.freeze({
      format: "niceeval.inspection.trace-detail/v1",
      kind: "item",
      itemId,
      item: projectFullConversationItem(item, turn),
    });
  }
  return undefined;
}

function projectToolOccurrenceDetail(
  agentTurns: ReturnType<typeof readAgentTurns>,
  toolOccurrenceId: string,
): Extract<InspectionTraceDetailResult, { readonly kind: "tool-occurrence" }> | undefined {
  if (agentTurns.state !== "available" || agentTurns.value.state === "legacy") return undefined;
  let call: InspectionTraceDetailItem | undefined;
  let result: InspectionTraceDetailItem | undefined;
  let callTurn: { readonly turnId: string; readonly sequence: number; readonly outcome: "completed" | "failed" | "cancelled" | "interrupted" } | undefined;
  let resultTurn: typeof callTurn;
  for (const turn of agentTurns.value.segments) {
    for (const item of turn.items) {
      if (item.kind === "tool-start" && item.toolOccurrenceId === toolOccurrenceId) {
        call = projectFullConversationItem(item, turn);
        callTurn = traceTurnIdentity(turn);
      }
      if (item.kind === "tool-finish" && item.occurrence.state === "exact" &&
        item.occurrence.toolOccurrenceId === toolOccurrenceId) {
        result = projectFullConversationItem(item, turn);
        resultTurn = traceTurnIdentity(turn);
      }
    }
  }
  if (call === undefined && result === undefined) return undefined;
  return Object.freeze({
    format: "niceeval.inspection.trace-detail/v1",
    kind: "tool-occurrence",
    toolOccurrenceId,
    call: call ?? null,
    result: result ?? null,
    turn: Object.freeze({ call: callTurn ?? null, result: resultTurn ?? null }),
  });
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
    return Object.freeze({
      text: readVerifiedText(source, metadata),
      retainedBytes: value.retainedBytes,
      totalSafeUtf8Bytes: value.totalSafeUtf8Bytes,
      sha256: value.sha256,
      truncation: Object.freeze({
        state: value.retainedBytes === value.totalSafeUtf8Bytes ? "not-truncated" as const : "truncated" as const,
        omittedSafeUtf8Bytes: value.totalSafeUtf8Bytes - value.retainedBytes,
      }),
    });
  };
  return Object.freeze({
    format: "niceeval.inspection.trace-detail/v1",
    kind: "command",
    commandId,
    invocation: projectFullInvocation(command.invocation),
    workingDirectory: command.workingDirectory,
    outcome: command.outcome,
    turnId: command.turnId,
    phase: command.phase,
    sequence: command.sequence,
    stdout: stream(command.stdout),
    stderr: stream(command.stderr),
  });
}

function traceTurnIdentity(turn: { readonly turnId: string; readonly sequence: number; readonly outcome: "completed" | "failed" | "cancelled" | "interrupted" }) {
  return Object.freeze({ turnId: turn.turnId, sequence: turn.sequence, outcome: turn.outcome });
}

function projectFullInvocation(invocation: {
  readonly kind: "shell" | "argv";
  readonly command?: string;
  readonly executable?: string;
  readonly arguments?: readonly string[];
}): Extract<InspectionTraceDetailResult, { readonly kind: "command" }>["invocation"] {
  return invocation.kind === "shell"
    ? Object.freeze({ kind: invocation.kind, command: invocation.command! })
    : Object.freeze({
        kind: invocation.kind,
        executable: invocation.executable!,
        arguments: Object.freeze([...(invocation.arguments ?? [])]),
      });
}

function projectFullConversationItem(
  item: ReturnType<typeof readAgentTurns> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment extends { readonly items: readonly (infer Item)[] } ? Item : never
      : never
    : never,
  turn: {
    readonly turnId: string;
    readonly sequence: number;
    readonly outcome: "completed" | "failed" | "cancelled" | "interrupted";
    readonly sessionId?: string;
  },
): Extract<InspectionTraceDetailResult, { readonly kind: "item" }>["item"] {
  const base = {
    itemId: item.itemId,
    turnId: turn.turnId,
    turnSequence: turn.sequence,
    turnOutcome: turn.outcome,
    ...(turn.sessionId === undefined ? {} : { sessionId: turn.sessionId }),
  };
  switch (item.kind) {
    case "tool-start": return Object.freeze({
      ...base, kind: "tool-call", eventId: item.eventId, sequence: item.sessionSequence,
      toolOccurrenceId: item.toolOccurrenceId, tool: item.tool, input: item.inputSummary,
    });
    case "tool-finish": return Object.freeze({
      ...base, kind: "tool-result", eventId: item.eventId, sequence: item.sessionSequence,
      ...(item.occurrence.state === "exact" ? { toolOccurrenceId: item.occurrence.toolOccurrenceId } : {}),
      outcome: item.outcome, output: item.outputSummary,
    });
    case "tool-call": return Object.freeze({
      ...base, kind: item.kind, sequence: item.sequence, tool: item.tool, input: item.inputSummary,
    });
    case "tool-result": return Object.freeze({
      ...base, kind: item.kind, sequence: item.sequence, outcome: item.outcome, output: item.outputSummary,
    });
    case "message": return Object.freeze({ ...base, kind: item.kind, role: item.role, text: item.text });
    case "thinking-summary":
    case "compaction":
    case "context-injection": return Object.freeze({ ...base, kind: item.kind, summary: item.summary });
    case "subagent": return Object.freeze({ ...base, kind: item.kind, state: item.state, label: item.label, summary: item.summary });
    case "input-request": return Object.freeze({ ...base, kind: item.kind, state: item.state, prompt: item.promptSummary, response: item.responseSummary });
    case "skill-load":
    case "conversation-error": return Object.freeze({ ...base, kind: item.kind, code: item.code, summary: item.summary });
  }
}

function readCurrentAttachment<
  Owner extends "run" | "attempt",
  Family extends string,
  ValueSchema extends Schema.Top,
  Revision extends number,
>(
  persistence: Readonly<{
    readonly attachment: RecordAttachmentDefinition<Owner, Family, ValueSchema>;
    readonly revision: Revision;
  }>,
  attachment: TraceAttachmentInput | undefined,
): AttachmentRead<ValueSchema["Type"]> {
  if (attachment === undefined) return Object.freeze({ state: "not-recorded" as const });
  if (
    attachment.physical.ownerKind !== persistence.attachment.owner ||
    attachment.physical.family !== persistence.attachment.family
  ) return invalidRead("source-attachment-identity-invalid");
  if (attachment.physical.familyRevision < persistence.revision) return invalidRead("source-migration-required");
  if (attachment.physical.familyRevision !== persistence.revision) return invalidRead("source-revision-unsupported");

  const byLogicalHandle = new Map(
    attachment.physical.contents.map((content) => [content.logicalHandle, content] as const),
  );
  const contentMetadata = new WeakMap<object, PersistedContentMetadata>();
  const usedLogicalHandles = new Set<string>();
  const hydrated = hydrateRecordAttachmentCurrent(
    persistence.attachment,
    attachment.value,
    {
      content: (token, declaration) => {
        const logicalHandle = exactMarker(token, "$niceeval.record.content");
        if (logicalHandle === undefined && !hasOwnMarker(token, "$niceeval.record.content")) {
          return Result.succeed(undefined);
        }
        const metadata = typeof logicalHandle === "string" ? byLogicalHandle.get(logicalHandle) : undefined;
        if (
          metadata === undefined ||
          usedLogicalHandles.has(logicalHandle as string) ||
          declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes
        ) return Result.fail({ code: "current-content-bind-failed" as const });
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
        return Result.succeed(mintRecordAttachmentReference(
          RecordAttachmentReference.to(declaration.definition, declaration.valueSchema),
          value.value,
        ));
      },
    },
  );
  if (Result.isFailure(hydrated) || usedLogicalHandles.size !== attachment.physical.contents.length) {
    return invalidRead("source-attachment-invalid");
  }

  const closure = enumerateRecordAttachmentClosure(persistence.attachment, hydrated.success);
  if (Result.isFailure(closure)) return invalidRead("source-closure-invalid");
  const logicalReferences = new Map<string, { readonly owner: string; readonly family: string }>();
  for (const reference of closure.success.references) {
    const wire = recordAttachmentReferenceWire(reference);
    if (wire === undefined) return invalidRead("source-reference-invalid");
    logicalReferences.set(
      `${wire.owner}\u0000${wire.family}`,
      Object.freeze({ owner: wire.owner, family: wire.family }),
    );
  }
  const orderedReferences = [...logicalReferences.values()].sort((left, right) =>
    left.owner === right.owner
      ? left.family === right.family ? 0 : left.family < right.family ? -1 : 1
      : left.owner < right.owner ? -1 : 1
  );
  if (orderedReferences.length !== attachment.physical.references.length) {
    return invalidRead("source-reference-invalid");
  }
  for (let ordinal = 0; ordinal < orderedReferences.length; ordinal += 1) {
    const logical = orderedReferences[ordinal]!;
    const physical = attachment.physical.references[ordinal]!;
    if (
      physical.ordinal !== ordinal ||
      physical.owner !== logical.owner ||
      physical.family !== logical.family
    ) return invalidRead("source-reference-invalid");
  }
  return Object.freeze({ state: "available" as const, value: hydrated.success, contentMetadata });
}

function invalidRead<Value>(issue: string): AttachmentRead<Value> {
  return Object.freeze({ state: "invalid" as const, issues: Object.freeze([issue]) });
}

function sourceDescriptor(read: AttachmentRead<CollectionValue>): InspectionJson {
  switch (read.state) {
    case "not-recorded": return closeJson(Object.freeze({ state: read.state }));
    case "invalid": return closeJson(Object.freeze({ state: read.state, issues: read.issues }));
    case "available": {
      const limitations = boundedLimitations(read.value.collection.limitations);
      return closeJson(Object.freeze({
        state: read.value.collection.state,
        limitations: limitations.items,
        limitationsTruncated: limitations.hasMore,
        omittedLimitationCount: limitations.omittedCount,
      }));
    }
  }
}

function boundedLimitations(limitations: readonly SourceReceiptLimitation[]) {
  const items = limitations.slice(0, MAX_SOURCE_LIMITATIONS).map((limitation) =>
    closeJson(limitation));
  return Object.freeze({
    items: Object.freeze(items),
    hasMore: items.length < limitations.length,
    omittedCount: limitations.length - items.length,
  });
}

function availability<Value extends CollectionValue>(
  read: AttachmentRead<Value>,
  targets: ReadonlySet<SourceReceiptLimitation["target"]>,
): ProjectionState {
  switch (read.state) {
    case "not-recorded": return Object.freeze({ state: read.state, limitations: Object.freeze([]) });
    case "invalid": return Object.freeze({
      state: read.state,
      limitations: Object.freeze(read.issues.map((issue) => Object.freeze({ issue }))),
    });
    case "available": {
      const matching = read.value.collection.limitations.filter(({ target }) => targets.has(target));
      return Object.freeze({
        state: matching.length === 0 ? "complete" as const : "partial" as const,
        limitations: Object.freeze(matching),
      });
    }
  }
}

const CONVERSATION_TARGETS = new Set<SourceReceiptLimitation["target"]>([
  "turn",
  "turn-item",
  "value-byte",
]);
const CONTEXT_TARGETS = new Set<SourceReceiptLimitation["target"]>([
  "turn-context",
  "value-byte",
]);
const USAGE_TARGETS = new Set<SourceReceiptLimitation["target"]>([
  "usage-observation",
  "value-byte",
]);
const COMMAND_TARGETS = new Set<SourceReceiptLimitation["target"]>([
  "command",
  "stdout",
  "stderr",
  "value-byte",
  "content-byte",
]);
const TIMING_TARGETS = new Set<SourceReceiptLimitation["target"]>([
  "activity",
  "value-byte",
]);
const DIAGNOSTIC_TARGETS = new Set<SourceReceiptLimitation["target"]>([
  "diagnostic",
  "diagnostic-cause",
  "value-byte",
]);

function projectConversation(
  agentTurns: ReturnType<typeof readAgentTurns>,
  turnContexts: ReturnType<typeof readTurnContexts>,
): { readonly view: InspectionJson } {
  const primary = availability(agentTurns, CONVERSATION_TARGETS);
  if (agentTurns.state !== "available") {
    return Object.freeze({ view: closeJson(Object.freeze({
      ...primary,
      turns: Object.freeze([]),
      turnsTruncated: false,
      omittedTurnCount: 0,
      items: Object.freeze([]),
      itemsTruncated: false,
      omittedItemCount: 0,
    })) });
  }

  const contextState = availability(turnContexts, CONTEXT_TARGETS);
  const contexts = turnContexts.state === "available"
    ? new Map(turnContexts.value.segments.map((segment) => [segment.turnId, segment] as const))
    : new Map();
  const limitations: InspectionJson[] = [...primary.limitations];
  if (contextState.state !== "complete") {
    limitations.push(closeJson(Object.freeze({
      source: "turn-contexts",
      state: contextState.state,
      limitations: contextState.limitations,
    })));
  }
  if (agentTurns.value.state === "legacy") {
    limitations.push(closeJson(Object.freeze({
      source: "agent-turns",
      state: "partial",
      reason: "exact-tool-occurrence-identity-not-recorded",
    })));
  }

  const turns = agentTurns.value.segments.slice(0, MAX_CONVERSATION_TURNS).map((turn) => {
    const coverage = conversationCoverage(turn.terminal);
    limitations.push(...coverage.limitations.map((limitation) => closeJson(Object.freeze({
      source: "agent-turns",
      turnId: turn.turnId,
      ...limitation,
    }))));
    const context = contexts.get(turn.turnId);
    return closeJson(Object.freeze({
      turnId: turn.turnId,
      sequence: turn.sequence,
      ...("sessionId" in turn ? { sessionId: turn.sessionId } : {}),
      outcome: turn.outcome,
      terminal: Object.freeze({
        state: turn.terminal.state,
        ...(turn.terminal.state === "recorded" ? { status: turn.terminal.status } : { reason: turn.terminal.reason }),
        coverage: coverage.coverage,
      }),
      context: context === undefined
        ? Object.freeze({ state: "not-recorded" as const })
        : projectTurnContext(context),
    }));
  });

  const items: InspectionJson[] = [];
  let totalItemCount = 0;
  for (const turn of agentTurns.value.segments) {
    for (const item of turn.items) {
      totalItemCount += 1;
      if (items.length >= MAX_CONVERSATION_ITEMS) continue;
      items.push(projectConversationItem(
        item,
        turn.turnId,
        "sessionId" in turn ? turn.sessionId : undefined,
      ));
    }
  }
  return Object.freeze({
    view: closeJson(Object.freeze({
      state: primary.state === "complete" && limitations.length === 0 ? "complete" : "partial",
      limitations: Object.freeze(limitations.slice(0, MAX_SOURCE_LIMITATIONS)),
      limitationsTruncated: limitations.length > MAX_SOURCE_LIMITATIONS,
      omittedLimitationCount: Math.max(0, limitations.length - MAX_SOURCE_LIMITATIONS),
      turns: Object.freeze(turns),
      turnsTruncated: turns.length < agentTurns.value.segments.length,
      omittedTurnCount: agentTurns.value.segments.length - turns.length,
      items: Object.freeze(items),
      itemsTruncated: items.length < totalItemCount,
      omittedItemCount: totalItemCount - items.length,
    })),
  });
}

export function readInspectionAgentTurns(
  attachment?: TraceAttachmentInput,
): InspectionAgentTurnsRead {
  return readCurrentAttachment(NiceEvalCurrentRecordAttachments.agentTurns, attachment);
}

function readAgentTurns(attachment?: TraceAttachmentInput): InspectionAgentTurnsRead {
  return readInspectionAgentTurns(attachment);
}

function readTurnContexts(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(NiceEvalCurrentRecordAttachments.turnContexts, attachment);
}

function conversationCoverage(terminal: ReturnType<typeof readAgentTurns> extends AttachmentRead<infer Value>
  ? Value extends { readonly segments: readonly (infer Segment)[] }
    ? Segment extends { readonly terminal: infer Terminal } ? Terminal : never
    : never
  : never) {
  if (terminal.state === "unavailable") {
    return Object.freeze({
      coverage: Object.freeze({ state: "unavailable" as const, reason: terminal.reason }),
      limitations: Object.freeze([Object.freeze({
        channel: "conversation",
        state: "unavailable" as const,
        reason: terminal.reason,
      })]),
    });
  }
  const names = ["events", "actions", "messages", "status", "data"] as const;
  const limitations: { readonly channel: string; readonly state: string; readonly reason?: string }[] = [];
  const entries: Record<string, object> = {};
  for (const name of names) {
    const entry = terminal.evidenceCoverage[name];
    entries[name] = entry.status === "complete"
      ? Object.freeze({ state: "complete" as const })
      : Object.freeze({
          state: entry.status,
          reason: boundedText(entry.reason, MAX_COVERAGE_REASON_BYTES).value,
        });
    if (entry.status !== "complete") {
      limitations.push(Object.freeze({
        channel: name,
        state: entry.status,
        reason: boundedText(entry.reason, MAX_COVERAGE_REASON_BYTES).value,
      }));
    }
  }
  return Object.freeze({ coverage: Object.freeze(entries), limitations: Object.freeze(limitations) });
}

function projectTurnContext(
  context: ReturnType<typeof readTurnContexts> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] } ? Segment : never
    : never,
): InspectionJson {
  if ("state" in context.source) {
    return closeJson(Object.freeze({
      state: context.source.state,
      reason: context.source.reason,
      sessionIndex: context.sessionIndex,
      turnIndex: context.turnIndex,
      sourceOrder: context.sourceOrder,
    }));
  }
  return closeJson(Object.freeze({
    sessionIndex: context.sessionIndex,
    turnIndex: context.turnIndex,
    sourceOrder: context.sourceOrder,
    ...context.source.value,
  }));
}

function projectConversationItem(
  item: ReturnType<typeof readAgentTurns> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment extends { readonly items: readonly (infer Item)[] } ? Item : never
      : never
    : never,
  turnId: string,
  sessionId: string | undefined,
): InspectionJson {
  const base = Object.freeze({
    itemId: item.itemId,
    turnId,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(item.kind === "tool-call" || item.kind === "tool-result"
      ? { sequence: item.sequence }
      : "eventId" in item
        ? { eventId: item.eventId, sequence: item.sessionSequence }
        : { sequence: item.sequence }),
  });
  switch (item.kind) {
    case "message": return closeJson(Object.freeze({
      ...base,
      kind: item.kind,
      role: item.role,
      text: boundedText(item.text, MAX_CONVERSATION_TEXT_BYTES).value,
      textTruncated: boundedText(item.text, MAX_CONVERSATION_TEXT_BYTES).truncated,
    }));
    case "tool-start": return closeJson(Object.freeze({
      ...base,
      kind: "tool-call" as const,
      occurrence: Object.freeze({
        state: "exact" as const,
        toolOccurrenceId: item.toolOccurrenceId,
      }),
      tool: item.tool,
      input: boundedText(item.inputSummary, MAX_CONVERSATION_TEXT_BYTES).value,
      inputTruncated: boundedText(item.inputSummary, MAX_CONVERSATION_TEXT_BYTES).truncated,
    }));
    case "tool-finish": return closeJson(Object.freeze({
      ...base,
      kind: "tool-result" as const,
      occurrence: item.occurrence.state === "exact"
        ? Object.freeze({
            state: "exact" as const,
            toolOccurrenceId: item.occurrence.toolOccurrenceId,
          })
        : item.occurrence,
      outcome: item.outcome,
      output: boundedText(item.outputSummary, MAX_CONVERSATION_TEXT_BYTES).value,
      outputTruncated: boundedText(item.outputSummary, MAX_CONVERSATION_TEXT_BYTES).truncated,
    }));
    case "tool-call": return closeJson(Object.freeze({
      ...base,
      kind: item.kind,
      occurrence: Object.freeze({
        state: "unavailable" as const,
        reason: "exact-tool-occurrence-identity-not-recorded" as const,
      }),
      tool: item.tool,
      input: boundedText(item.inputSummary, MAX_CONVERSATION_TEXT_BYTES).value,
      inputTruncated: boundedText(item.inputSummary, MAX_CONVERSATION_TEXT_BYTES).truncated,
    }));
    case "tool-result": return closeJson(Object.freeze({
      ...base,
      kind: item.kind,
      occurrence: Object.freeze({
        state: "unavailable" as const,
        reason: "exact-tool-occurrence-identity-not-recorded" as const,
      }),
      outcome: item.outcome,
      output: boundedText(item.outputSummary, MAX_CONVERSATION_TEXT_BYTES).value,
      outputTruncated: boundedText(item.outputSummary, MAX_CONVERSATION_TEXT_BYTES).truncated,
    }));
    case "thinking-summary":
    case "compaction":
    case "context-injection": return closeJson(Object.freeze({
      ...base,
      kind: item.kind,
      summary: boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES).value,
      summaryTruncated: boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES).truncated,
    }));
    case "subagent": return closeJson(Object.freeze({
      ...base,
      kind: item.kind,
      state: item.state,
      label: item.label,
      summary: boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES).value,
      summaryTruncated: boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES).truncated,
    }));
    case "input-request": {
      const prompt = boundedText(item.promptSummary, MAX_CONVERSATION_TEXT_BYTES);
      const response = item.responseSummary === null
        ? null
        : boundedText(item.responseSummary, MAX_CONVERSATION_TEXT_BYTES);
      return closeJson(Object.freeze({
        ...base,
        kind: item.kind,
        state: item.state,
        prompt: prompt.value,
        promptTruncated: prompt.truncated,
        response: response?.value ?? null,
        responseTruncated: response?.truncated ?? false,
      }));
    }
    case "skill-load":
    case "conversation-error": return closeJson(Object.freeze({
      ...base,
      kind: item.kind,
      code: item.code,
      summary: boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES).value,
      summaryTruncated: boundedText(item.summary, MAX_CONVERSATION_TEXT_BYTES).truncated,
    }));
  }
}

export function projectAttemptUsage(
  attachments: AttemptTraceAttachments,
): InspectionAttemptUsageResult {
  return projectUsage(readAgentTurns(attachments.agentTurns));
}

function projectUsage(
  agentTurns: ReturnType<typeof readAgentTurns>,
): InspectionAttemptUsageResult {
  const sourceState = availability(agentTurns, USAGE_TARGETS);
  if (agentTurns.state !== "available") {
    return Object.freeze({
      ...sourceState,
      limitationsTruncated: false,
      omittedLimitationCount: 0,
      turns: Object.freeze([]),
      turnsTruncated: false,
      omittedTurnCount: 0,
      observations: Object.freeze([]),
      totals: unavailableInspectionUsageTotals(),
      hasMore: false,
      omittedObservationCount: 0,
    });
  }

  const limitations: InspectionAttemptUsageResult["limitations"][number][] = [
    ...sourceState.limitations,
  ];
  const turns = agentTurns.value.segments.slice(0, MAX_CONVERSATION_TURNS).map((turn) => {
    const coverage = turn.terminal.state === "unavailable"
      ? Object.freeze({ state: "unavailable" as const, reason: turn.terminal.reason })
      : turn.terminal.evidenceCoverage.usage.status === "complete"
        ? Object.freeze({ state: "complete" as const })
        : Object.freeze({
            state: turn.terminal.evidenceCoverage.usage.status,
            reason: boundedText(
              turn.terminal.evidenceCoverage.usage.reason,
              MAX_COVERAGE_REASON_BYTES,
            ).value,
          });
    if (coverage.state !== "complete") {
      limitations.push(Object.freeze({
        source: "agent-turns",
        turnId: turn.turnId,
        channel: "usage",
        ...coverage,
      }));
    }
    return Object.freeze({ turnId: turn.turnId, coverage });
  });
  const allObservations: InspectionAttemptUsageResult["observations"][number][] = [];
  for (const turn of agentTurns.value.segments) {
    for (const observation of turn.usage) {
      allObservations.push(Object.freeze({ turnId: turn.turnId, ...observation }));
    }
  }
  const observations = allObservations.slice(0, MAX_USAGE_OBSERVATIONS);
  return Object.freeze({
    state: sourceState.state === "complete" && limitations.length === 0 ? "complete" : "partial",
    limitations: Object.freeze(limitations.slice(0, MAX_SOURCE_LIMITATIONS)),
    limitationsTruncated: limitations.length > MAX_SOURCE_LIMITATIONS,
    omittedLimitationCount: Math.max(0, limitations.length - MAX_SOURCE_LIMITATIONS),
    turns: Object.freeze(turns),
    turnsTruncated: turns.length < agentTurns.value.segments.length,
    omittedTurnCount: agentTurns.value.segments.length - turns.length,
    observations: Object.freeze(observations),
    totals: usageTotals(allObservations, sourceState.state),
    hasMore: observations.length < allObservations.length,
    omittedObservationCount: allObservations.length - observations.length,
  });
}

export function unavailableInspectionUsageTotals(): InspectionAttemptUsageResult["totals"] {
  const unavailable = Object.freeze({
    state: "unavailable" as const,
    value: null,
    observationCount: 0,
  });
  return Object.freeze({
    inputTokens: unavailable,
    outputTokens: unavailable,
    requests: unavailable,
    providerCosts: Object.freeze({
      state: "unavailable" as const,
      values: Object.freeze([]),
      observationCount: 0,
    }),
  });
}

export function combineInspectionUsageTotals(
  usages: readonly InspectionAttemptUsageResult[],
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
      return Object.freeze({ state: "unavailable", value: null, observationCount: 0 });
    }
    return Object.freeze({
      state: incomplete || usages.some(({ totals }) => totals[key].state !== "available")
        ? "partial" as const
        : "available" as const,
      value: available.reduce((total, entry) => total + entry.value!, 0),
      observationCount: available.reduce((total, entry) => total + entry.observationCount, 0),
    });
  };
  const costs = new Map<string, { readonly amount: string; readonly count: number }>();
  for (const usage of usages) {
    for (const entry of usage.totals.providerCosts.values) {
      const current = costs.get(entry.currency);
      costs.set(entry.currency, Object.freeze({
        amount: current === undefined
          ? entry.value
          : addCanonicalDecimal(current.amount, entry.value),
        count: (current?.count ?? 0) + entry.observationCount,
      }));
    }
  }
  return Object.freeze({
    inputTokens: numeric("inputTokens"),
    outputTokens: numeric("outputTokens"),
    requests: numeric("requests"),
    providerCosts: costs.size === 0
      ? unavailableInspectionUsageTotals().providerCosts
      : Object.freeze({
          state: incomplete || usages.some(({ totals }) =>
            totals.providerCosts.state !== "available")
            ? "partial" as const
            : "available" as const,
          values: Object.freeze([...costs.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([currency, total]) => Object.freeze({
              currency,
              value: total.amount,
              observationCount: total.count,
            }))),
          observationCount: [...costs.values()].reduce((total, value) =>
            total + value.count, 0),
        }),
  });
}

function usageTotals(
  observations: InspectionAttemptUsageResult["observations"],
  projectionState: InspectionAttemptUsageResult["state"],
): InspectionAttemptUsageResult["totals"] {
  const state = projectionState === "complete" ? "available" as const : "partial" as const;
  const numeric = (
    values: readonly number[],
  ): InspectionAttemptUsageResult["totals"]["inputTokens"] => values.length === 0
    ? Object.freeze({ state: "unavailable", value: null, observationCount: 0 })
    : Object.freeze({
        state,
        value: values.reduce((total, value) => total + value, 0),
        observationCount: values.length,
      });
  const inputTokens = observations.flatMap((observation) =>
    observation.kind === "token-bucket" && observation.bucket === "input"
      ? [observation.tokens]
      : []);
  const outputTokens = observations.flatMap((observation) =>
    observation.kind === "token-bucket" && observation.bucket === "output"
      ? [observation.tokens]
      : []);
  const requests = observations.filter((observation) => observation.kind === "request");
  const costs = new Map<string, { readonly amount: string; readonly count: number }>();
  for (const observation of observations) {
    if (observation.kind !== "provider-cost") continue;
    const current = costs.get(observation.currency);
    costs.set(observation.currency, Object.freeze({
      amount: current === undefined
        ? observation.amount
        : addCanonicalDecimal(current.amount, observation.amount),
      count: (current?.count ?? 0) + 1,
    }));
  }
  return Object.freeze({
    inputTokens: numeric(inputTokens),
    outputTokens: numeric(outputTokens),
    requests: numeric(requests.map(() => 1)),
    providerCosts: costs.size === 0
      ? Object.freeze({
          state: "unavailable" as const,
          values: Object.freeze([]),
          observationCount: 0,
        })
      : Object.freeze({
          state,
          values: Object.freeze([...costs.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([currency, total]) => Object.freeze({
              currency,
              value: total.amount,
              observationCount: total.count,
            }))),
          observationCount: [...costs.values()].reduce((total, value) =>
            total + value.count, 0),
        }),
  });
}

function addCanonicalDecimal(left: string, right: string): string {
  const split = (value: string): readonly [digits: bigint, scale: number] => {
    const [integer, fraction = ""] = value.split(".");
    return [BigInt(`${integer}${fraction}`), fraction.length];
  };
  const [leftDigits, leftScale] = split(left);
  const [rightDigits, rightScale] = split(right);
  const scale = Math.max(leftScale, rightScale);
  const sum = leftDigits * 10n ** BigInt(scale - leftScale) +
    rightDigits * 10n ** BigInt(scale - rightScale);
  if (scale === 0) return sum.toString();
  const padded = sum.toString().padStart(scale + 1, "0");
  const integer = padded.slice(0, -scale);
  const fraction = padded.slice(-scale).replace(/0+$/u, "");
  return fraction.length === 0 ? integer : `${integer}.${fraction}`;
}

function projectCommands(
  source: InspectionFactSource,
  commands: ReturnType<typeof readSandboxCommands>,
): { readonly source: InspectionJson; readonly view: InspectionJson } {
  const sourceState = availability(commands, COMMAND_TARGETS);
  if (commands.state !== "available") {
    return Object.freeze({ source: sourceDescriptor(commands), view: emptyView(sourceState) });
  }
  try {
    const items = commands.value.segments.slice(0, MAX_COMMANDS).map((command) =>
      closeJson(Object.freeze({
        commandId: command.commandId,
        sequence: command.sequence,
        turnId: command.turnId,
        phase: command.phase,
        invocation: projectInvocation(command.invocation),
        workingDirectory: command.workingDirectory,
        outcome: command.outcome,
        stdout: projectCommandStream(source, commands.contentMetadata, command.stdout),
        stderr: projectCommandStream(source, commands.contentMetadata, command.stderr),
      })));
    return Object.freeze({
      source: sourceDescriptor(commands),
      view: closeJson(Object.freeze({
        ...sourceState,
        items: Object.freeze(items),
        hasMore: items.length < commands.value.segments.length,
        omittedCommandCount: commands.value.segments.length - items.length,
      })),
    });
  } catch {
    const invalid = closeJson(Object.freeze({
      state: "invalid" as const,
      issues: Object.freeze(["source-content-invalid"]),
    }));
    return Object.freeze({
      source: invalid,
      view: closeJson(Object.freeze({
        state: "invalid" as const,
        issues: Object.freeze(["source-content-invalid"]),
        items: Object.freeze([]),
        hasMore: false,
      })),
    });
  }
}

function readSandboxCommands(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(NiceEvalCurrentRecordAttachments.sandboxCommands, attachment);
}

function projectInvocation(
  invocation: ReturnType<typeof readSandboxCommands> extends AttachmentRead<infer Value>
    ? Value extends { readonly segments: readonly (infer Segment)[] }
      ? Segment extends { readonly invocation: infer Invocation } ? Invocation : never
      : never
    : never,
): InspectionJson {
  if (invocation.kind === "shell") {
    const command = boundedText(invocation.command, MAX_COMMAND_TEXT_BYTES);
    return closeJson(Object.freeze({
      kind: invocation.kind,
      command: command.value,
      commandTruncated: command.truncated,
    }));
  }
  const executable = boundedText(invocation.executable, MAX_COMMAND_TEXT_BYTES);
  const args = invocation.arguments.slice(0, MAX_COMMAND_ARGUMENTS).map((argument) =>
    boundedText(argument, MAX_COMMAND_ARGUMENT_BYTES).value);
  return closeJson(Object.freeze({
    kind: invocation.kind,
    executable: executable.value,
    executableTruncated: executable.truncated,
    arguments: Object.freeze(args),
    argumentsTruncated: args.length < invocation.arguments.length ||
      invocation.arguments.slice(0, MAX_COMMAND_ARGUMENTS).some((argument) =>
        boundedText(argument, MAX_COMMAND_ARGUMENT_BYTES).truncated),
    omittedArgumentCount: invocation.arguments.length - args.length,
  }));
}

function projectCommandStream(
  source: InspectionFactSource,
  contentMetadata: WeakMap<object, PersistedContentMetadata>,
  stream: {
    readonly content: RecordContentHandle;
    readonly retainedBytes: number;
    readonly totalSafeUtf8Bytes: number;
    readonly sha256: string;
  },
): InspectionJson {
  const metadata = contentMetadata.get(stream.content);
  if (
    metadata === undefined ||
    metadata.byteLength !== stream.retainedBytes ||
    metadata.digest !== stream.sha256
  ) throw new Error("Command stream metadata is invalid");
  const text = readVerifiedText(source, metadata);
  const bounded = boundedText(text, MAX_COMMAND_STREAM_TEXT_BYTES);
  return closeJson(Object.freeze({
    state: "available" as const,
    text: bounded.value,
    textTruncated: bounded.truncated,
    retainedBytes: stream.retainedBytes,
    totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
    sha256: stream.sha256,
  }));
}

export function projectAttemptTiming(
  attachments: AttemptTraceAttachments,
): InspectionAttemptTimingResult {
  return projectTiming(readRunnerActivities(attachments.runnerActivities));
}

function projectTiming(
  activities: ReturnType<typeof readRunnerActivities>,
): InspectionAttemptTimingResult {
  const sourceState = availability(activities, TIMING_TARGETS);
  if (activities.state !== "available") {
    const limitations = sourceState.limitations.slice(0, MAX_SOURCE_LIMITATIONS);
    return Object.freeze({
      state: sourceState.state,
      limitations: Object.freeze(limitations),
      limitationsTruncated: limitations.length < sourceState.limitations.length,
      omittedLimitationCount: sourceState.limitations.length - limitations.length,
      activities: Object.freeze([]),
      hasMore: false,
      omittedActivityCount: 0,
    });
  }
  const items = activities.value.segments.slice(0, MAX_ACTIVITIES).map((activity) =>
    Object.freeze({
      activityId: activity.activityId,
      sequence: activity.sequence,
      parentActivityId: activity.parentActivityId,
      turnId: activity.turnId,
      phase: activity.phase,
      label: activity.label,
      startOffsetMs: activity.startOffsetMs,
      durationMs: activity.durationMs,
      outcome: activity.outcome,
    }));
  const limitations = sourceState.limitations.slice(0, MAX_SOURCE_LIMITATIONS);
  return Object.freeze({
    state: sourceState.state,
    limitations: Object.freeze(limitations),
    limitationsTruncated: limitations.length < sourceState.limitations.length,
    omittedLimitationCount: sourceState.limitations.length - limitations.length,
    activities: Object.freeze(items),
    hasMore: items.length < activities.value.segments.length,
    omittedActivityCount: activities.value.segments.length - items.length,
  });
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
    return Object.freeze({
      state: sourceState.state,
      limitations: Object.freeze(limitations),
      limitationsTruncated: limitations.length < sourceState.limitations.length,
      omittedLimitationCount: sourceState.limitations.length - limitations.length,
      items: Object.freeze([]),
      hasMore: false,
      omittedDiagnosticCount: 0,
    });
  }
  const items = diagnostics.value.segments.slice(0, MAX_DIAGNOSTICS).map((diagnostic) => {
    const summary = boundedText(diagnostic.summary, MAX_DIAGNOSTIC_SUMMARY_BYTES);
    const causes = diagnostic.causes.slice(0, MAX_DIAGNOSTIC_CAUSES).map((cause) => {
      const causeSummary = boundedText(cause.summary, MAX_DIAGNOSTIC_CAUSE_BYTES);
      return Object.freeze({
        code: cause.code,
        summary: causeSummary.value,
        summaryTruncated: causeSummary.truncated,
      });
    });
    return Object.freeze({
      diagnosticId: diagnostic.diagnosticId,
      sequence: diagnostic.sequence,
      turnId: diagnostic.turnId,
      phase: diagnostic.phase,
      kind: diagnostic.kind,
      code: diagnostic.code,
      summary: summary.value,
      summaryTruncated: summary.truncated,
      causes: Object.freeze(causes),
      causesTruncated: causes.length < diagnostic.causes.length,
      omittedCauseCount: diagnostic.causes.length - causes.length,
      redaction: diagnostic.redaction,
      sourceFrame: diagnostic.sourceFrame === null
        ? null
        : diagnostic.sourceFrame.value,
    });
  });
  return Object.freeze({
    state: sourceState.state,
    limitations: Object.freeze(limitations),
    limitationsTruncated: limitations.length < sourceState.limitations.length,
    omittedLimitationCount: sourceState.limitations.length - limitations.length,
    items: Object.freeze(items),
    hasMore: items.length < diagnostics.value.segments.length,
    omittedDiagnosticCount: diagnostics.value.segments.length - items.length,
  });
}

function readRunnerDiagnostics(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(NiceEvalCurrentRecordAttachments.runnerDiagnostics.attempt, attachment);
}

function emptyView(state: ProjectionState): InspectionJson {
  return closeJson(Object.freeze({ ...state, items: Object.freeze([]), hasMore: false }));
}

function readVerifiedText(
  source: InspectionFactSource,
  metadata: PersistedContentMetadata,
): string {
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
      page.chunks.length === 0 && page.nextOrdinal !== null
    ) throw new Error("Content page is invalid");
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
  ) throw new Error("Content does not match its sealed metadata");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function boundedText(value: string, maximumBytes: number): {
  readonly value: string;
  readonly truncated: boolean;
} {
  if (utf8ByteLength(value) <= maximumBytes) {
    return Object.freeze({ value, truncated: false });
  }
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > maximumBytes) break;
    output += character;
    bytes += characterBytes;
  }
  return Object.freeze({ value: output, truncated: true });
}

function exactMarker(value: unknown, key: string): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== key) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && descriptor.enumerable && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function hasOwnMarker(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, key);
}

function closeJson(value: unknown): InspectionJson {
  const closed = closeInspectionJson(value);
  if (
    typeof closed === "object" &&
    closed !== null &&
    !Array.isArray(closed) &&
    Reflect.get(closed, "code") === "inspection-result-invalid"
  ) throw closed;
  return closed as InspectionJson;
}

function jsonByteLength(value: unknown): number {
  return utf8ByteLength(JSON.stringify(value));
}
