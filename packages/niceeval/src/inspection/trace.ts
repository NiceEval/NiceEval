import { createHash } from "node:crypto";

import { Either, Schema } from "effect";

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
  type RecordAttachmentPersistence,
} from "../record/attachment/protocol.ts";
import { agentTurnsRecordAttachmentPersistence } from "../record/family/agent-turns/persistence.ts";
import { turnContextsRecordAttachmentPersistence } from "../record/family/turn-contexts/persistence.ts";
import { sandboxCommandsRecordAttachmentPersistence } from "../record/family/sandbox-commands/persistence.ts";
import { attemptRunnerActivitiesRecordAttachmentPersistence } from "../record/family/runner-activities/persistence.ts";
import { attemptRunnerDiagnosticsRecordAttachmentPersistence } from "../record/family/runner-diagnostics/persistence.ts";
import type { SourceReceiptLimitation } from "../record/family/source-receipt/index.ts";
import type {
  PersistedContentMetadata,
  SealedAttachmentMetadata,
} from "../record/sqlite/index.ts";
import { closeInspectionJson, type InspectionJson } from "./codec.ts";
import { INSPECTION_RESULT_BYTE_LIMIT } from "./limits.ts";
import type { InspectionFactSource } from "./source.ts";

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

type AttachmentRead<Value> =
  | { readonly state: "not-recorded" }
  | { readonly state: "invalid"; readonly issues: readonly string[] }
  | {
      readonly state: "available";
      readonly value: Value;
      readonly contentMetadata: WeakMap<object, PersistedContentMetadata>;
    };

interface CollectionValue {
  readonly collection: {
    readonly state: "complete" | "partial";
    readonly limitations: readonly SourceReceiptLimitation[];
  };
}

interface ProjectionState {
  readonly state: "complete" | "partial" | "not-recorded" | "invalid";
  readonly limitations: readonly InspectionJson[];
}

export function projectAttemptTrace(
  source: InspectionFactSource,
  attachments: AttemptTraceAttachments,
): InspectionJson {
  const agentTurns = readCurrentAttachment(
    agentTurnsRecordAttachmentPersistence,
    attachments.agentTurns,
  );
  const turnContexts = readCurrentAttachment(
    turnContextsRecordAttachmentPersistence,
    attachments.turnContexts,
  );
  const sandboxCommands = readCurrentAttachment(
    sandboxCommandsRecordAttachmentPersistence,
    attachments.sandboxCommands,
  );
  const runnerActivities = readCurrentAttachment(
    attemptRunnerActivitiesRecordAttachmentPersistence,
    attachments.runnerActivities,
  );
  const runnerDiagnostics = readCurrentAttachment(
    attemptRunnerDiagnosticsRecordAttachmentPersistence,
    attachments.runnerDiagnostics,
  );

  const conversation = projectConversation(agentTurns, turnContexts);
  const commands = projectCommands(source, sandboxCommands);
  const usage = projectUsage(agentTurns);
  const timing = projectTiming(runnerActivities);
  const diagnostics = projectDiagnostics(runnerDiagnostics);

  const result = closeJson(Object.freeze({
    format: TRACE_PROJECTION_FORMAT,
    sources: Object.freeze({
      "agent-turns": sourceDescriptor(agentTurns),
      "turn-contexts": sourceDescriptor(turnContexts),
      "sandbox-commands": commands.source,
      "runner-activities": sourceDescriptor(runnerActivities),
      "runner-diagnostics": sourceDescriptor(runnerDiagnostics),
    }),
    conversation: conversation.view,
    commands: commands.view,
    usage,
    timing,
    diagnostics,
  }));
  if (jsonByteLength(result) > INSPECTION_RESULT_BYTE_LIMIT) {
    throw new Error("Trace semantic projection exceeds its fixed result byte limit");
  }
  return result;
}

function readCurrentAttachment<
  Owner extends "run" | "attempt",
  Family extends string,
  ValueSchema extends Schema.Schema.AnyNoContext,
  Revision extends number,
>(
  persistence: RecordAttachmentPersistence<
    RecordAttachmentDefinition<Owner, Family, ValueSchema>,
    Revision
  >,
  attachment: TraceAttachmentInput | undefined,
): AttachmentRead<Schema.Schema.Type<ValueSchema>> {
  if (attachment === undefined) return Object.freeze({ state: "not-recorded" as const });
  if (
    attachment.physical.ownerKind !== persistence.attachment.owner ||
    attachment.physical.family !== persistence.attachment.family
  ) return invalidRead("source-attachment-identity-invalid");
  if (attachment.physical.familyRevision < persistence.revision) {
    return invalidRead("source-migration-required");
  }
  if (attachment.physical.familyRevision !== persistence.revision) {
    return invalidRead("source-revision-unsupported");
  }

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
          return Either.right(undefined);
        }
        const metadata = typeof logicalHandle === "string"
          ? byLogicalHandle.get(logicalHandle)
          : undefined;
        if (
          metadata === undefined ||
          usedLogicalHandles.has(logicalHandle as string) ||
          declaration.maximumBytes !== undefined && metadata.byteLength > declaration.maximumBytes
        ) {
          return Either.left({ code: "current-content-bind-failed" as const });
        }
        const handle = mintRecordContentHandle(declaration.kind);
        contentMetadata.set(handle, metadata);
        usedLogicalHandles.add(logicalHandle as string);
        return Either.right(handle);
      },
      reference: (token, declaration) => {
        const marker = exactMarker(token, "$niceeval.record.reference");
        if (marker === undefined && !hasOwnMarker(token, "$niceeval.record.reference")) {
          return Either.right(undefined);
        }
        if (typeof marker !== "object" || marker === null || Array.isArray(marker)) {
          return Either.left({ code: "current-reference-bind-failed" as const });
        }
        const value = marker as Readonly<Record<string, unknown>>;
        if (
          Reflect.ownKeys(value).length !== 3 ||
          value.owner !== declaration.definition.owner ||
          value.family !== declaration.definition.family ||
          !("value" in value)
        ) {
          return Either.left({ code: "current-reference-bind-failed" as const });
        }
        return Either.right(mintRecordAttachmentReference(
          RecordAttachmentReference.to(declaration.definition, declaration.valueSchema),
          value.value,
        ));
      },
    },
  );
  if (Either.isLeft(hydrated) || usedLogicalHandles.size !== attachment.physical.contents.length) {
    return invalidRead("source-attachment-invalid");
  }

  const closure = enumerateRecordAttachmentClosure(persistence.attachment, hydrated.right);
  if (Either.isLeft(closure)) return invalidRead("source-closure-invalid");
  const logicalReferences = new Map<string, { readonly owner: string; readonly family: string }>();
  for (const reference of closure.right.references) {
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
  return Object.freeze({ state: "available" as const, value: hydrated.right, contentMetadata });
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
      limitations: Object.freeze(read.issues.map((issue) => closeJson(Object.freeze({ issue })))),
    });
    case "available": {
      const matching = read.value.collection.limitations.filter(({ target }) => targets.has(target));
      return Object.freeze({
        state: matching.length === 0 ? "complete" as const : "partial" as const,
        limitations: Object.freeze(matching.slice(0, MAX_SOURCE_LIMITATIONS).map((limitation) =>
          closeJson(limitation))),
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

function readAgentTurns(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(agentTurnsRecordAttachmentPersistence, attachment);
}

function readTurnContexts(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(turnContextsRecordAttachmentPersistence, attachment);
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

function projectUsage(agentTurns: ReturnType<typeof readAgentTurns>): InspectionJson {
  const sourceState = availability(agentTurns, USAGE_TARGETS);
  if (agentTurns.state !== "available") {
    return closeJson(Object.freeze({
      ...sourceState,
      turns: Object.freeze([]),
      turnsTruncated: false,
      omittedTurnCount: 0,
      observations: Object.freeze([]),
      hasMore: false,
      omittedObservationCount: 0,
    }));
  }

  const limitations: InspectionJson[] = [...sourceState.limitations];
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
      limitations.push(closeJson(Object.freeze({
        source: "agent-turns",
        turnId: turn.turnId,
        channel: "usage",
        ...coverage,
      })));
    }
    return closeJson(Object.freeze({ turnId: turn.turnId, coverage }));
  });
  const observations: InspectionJson[] = [];
  let total = 0;
  for (const turn of agentTurns.value.segments) {
    for (const observation of turn.usage) {
      total += 1;
      if (observations.length >= MAX_USAGE_OBSERVATIONS) continue;
      observations.push(closeJson(Object.freeze({ turnId: turn.turnId, ...observation })));
    }
  }
  return closeJson(Object.freeze({
    state: sourceState.state === "complete" && limitations.length === 0 ? "complete" : "partial",
    limitations: Object.freeze(limitations.slice(0, MAX_SOURCE_LIMITATIONS)),
    limitationsTruncated: limitations.length > MAX_SOURCE_LIMITATIONS,
    omittedLimitationCount: Math.max(0, limitations.length - MAX_SOURCE_LIMITATIONS),
    turns: Object.freeze(turns),
    turnsTruncated: turns.length < agentTurns.value.segments.length,
    omittedTurnCount: agentTurns.value.segments.length - turns.length,
    observations: Object.freeze(observations),
    hasMore: observations.length < total,
    omittedObservationCount: total - observations.length,
  }));
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
  return readCurrentAttachment(sandboxCommandsRecordAttachmentPersistence, attachment);
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

function projectTiming(activities: ReturnType<typeof readRunnerActivities>): InspectionJson {
  const sourceState = availability(activities, TIMING_TARGETS);
  if (activities.state !== "available") {
    return closeJson(Object.freeze({
      ...sourceState,
      activities: Object.freeze([]),
      hasMore: false,
      omittedActivityCount: 0,
    }));
  }
  const items = activities.value.segments.slice(0, MAX_ACTIVITIES).map((activity) =>
    closeJson(Object.freeze({
      activityId: activity.activityId,
      sequence: activity.sequence,
      parentActivityId: activity.parentActivityId,
      turnId: activity.turnId,
      phase: activity.phase,
      label: activity.label,
      startOffsetMs: activity.startOffsetMs,
      durationMs: activity.durationMs,
      outcome: activity.outcome,
    })));
  return closeJson(Object.freeze({
    ...sourceState,
    activities: Object.freeze(items),
    hasMore: items.length < activities.value.segments.length,
    omittedActivityCount: activities.value.segments.length - items.length,
  }));
}

function readRunnerActivities(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(attemptRunnerActivitiesRecordAttachmentPersistence, attachment);
}

function projectDiagnostics(
  diagnostics: ReturnType<typeof readRunnerDiagnostics>,
): InspectionJson {
  const sourceState = availability(diagnostics, DIAGNOSTIC_TARGETS);
  if (diagnostics.state !== "available") return emptyView(sourceState);
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
    return closeJson(Object.freeze({
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
    }));
  });
  return closeJson(Object.freeze({
    ...sourceState,
    items: Object.freeze(items),
    hasMore: items.length < diagnostics.value.segments.length,
    omittedDiagnosticCount: diagnostics.value.segments.length - items.length,
  }));
}

function readRunnerDiagnostics(attachment?: TraceAttachmentInput) {
  return readCurrentAttachment(attemptRunnerDiagnosticsRecordAttachmentPersistence, attachment);
}

function emptyView(state: ProjectionState): InspectionJson {
  return closeJson(Object.freeze({ ...state, items: Object.freeze([]), hasMore: false }));
}

function readVerifiedText(
  source: InspectionFactSource,
  metadata: PersistedContentMetadata,
): string {
  const bytes = new Uint8Array(metadata.byteLength);
  const digest = createHash("sha256");
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
    digest.digest("hex") !== metadata.digest
  ) throw new Error("Content does not match its sealed metadata");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function boundedText(value: string, maximumBytes: number): {
  readonly value: string;
  readonly truncated: boolean;
} {
  if (Buffer.byteLength(value, "utf8") <= maximumBytes) {
    return Object.freeze({ value, truncated: false });
  }
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, "utf8");
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
  ) throw new Error(String(Reflect.get(closed, "reason")));
  return closed as InspectionJson;
}

function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
