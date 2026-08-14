import { Schema } from "effect";
import type { RecordBlobRef } from "../../record/attachment/index.ts";
import {
  Sha256DigestSchema,
  SourceFileItemIdSchema,
} from "../../sources/codec.ts";
import {
  AttemptDiagnosticsReferencesSchema,
  AttemptReferenceTargetSchema,
  AttemptTimingReferencesSchema,
  CollectionSchema,
  CommandsReferencesSchema,
  ConversationReferencesSchema,
  CurrencyCodeSchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
  RunDiagnosticsReferencesSchema,
  RunReferenceTargetSchema,
  RunTimingReferencesSchema,
  SafeIdentifierSchema,
  SafeTextSchema,
  SourceNativeToolNameSchema,
  StableLabelSchema,
  UsageObservationIdSchema,
  UsageReferencesSchema,
  boundedSafeTextSchema,
  CallIdSchema,
  CommandIdSchema,
  DiagnosticIdSchema,
  IntervalIdSchema,
  ItemIdSchema,
  TurnIdSchema,
} from "./codec.ts";
import {
  MAX_COMMAND_ARGUMENT_BYTES,
  MAX_COMMAND_ARGUMENTS,
  MAX_COMMAND_EXECUTABLE_BYTES,
  MAX_COMMAND_INLINE_STREAM_BYTES,
  MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES,
  MAX_COMMAND_SHELL_BYTES,
  MAX_COMMAND_STREAM_BYTES,
  MAX_COMMANDS_ATTACHMENT_BYTES,
  MAX_COMMANDS_CLOSURE_BYTES,
  MAX_COMMANDS,
  MAX_CONVERSATION_ATTACHMENT_BYTES,
  MAX_CONVERSATION_ITEMS,
  MAX_CONVERSATION_TEXT_BYTES,
  MAX_CONVERSATION_TURNS,
  MAX_DIAGNOSTIC_CAUSES,
  MAX_DIAGNOSTIC_CAUSE_SUMMARY_BYTES,
  MAX_DIAGNOSTIC_CONTEXT_ITEMS,
  MAX_DIAGNOSTIC_SUMMARY_BYTES,
  MAX_DIAGNOSTICS_ATTACHMENT_BYTES,
  MAX_DIAGNOSTICS,
  MAX_TIMING_ATTACHMENT_BYTES,
  MAX_TIMING_INTERVALS,
  MAX_USAGE_ATTACHMENT_BYTES,
  MAX_USAGE_OBSERVATIONS,
} from "./limits.ts";
import {
  ATTEMPT_OBSERVABILITY_FAMILY_SCHEMA_IDS,
  RUN_OBSERVABILITY_FAMILY_SCHEMA_IDS,
  compareObservabilityText,
  isSafeText,
  jsonUtf8ByteLength,
  limitationTarget,
  type AttemptDiagnosticsReferences,
  type AttemptReferenceTarget,
  type Collection,
  type CommandId,
  type CommandsReferences,
  type RunDiagnosticsReferences,
} from "./model.ts";
import {
  makeAttemptObservabilityFamilyValidation,
  makeRunObservabilityFamilyValidation,
  type ObservabilityFamilyValidation,
} from "./validation.ts";

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function payloadFits(value: object, maximumBytes: number): boolean {
  const length = jsonUtf8ByteLength(value);
  return length !== undefined && length <= maximumBytes;
}

function isStrictlyOrderedById<Item>(
  values: readonly Item[],
  idOf: (value: Item) => string,
): boolean {
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    const id = idOf(value);
    if (seen.has(id) || (previous !== undefined && compareObservabilityText(previous, id) >= 0)) {
      return false;
    }
    seen.add(id);
    previous = id;
  }
  return true;
}

function isAllowedCollection(
  collection: Collection,
  targets: readonly string[],
): boolean {
  return collection.limitations.every((limitation) =>
    targets.some((target) => limitationTarget(limitation) === target),
  );
}

function hasExactStreamTruncation(
  collection: Collection,
  commandId: string,
  stream: "stdout" | "stderr",
  retainedBytes: number,
  totalSafeUtf8Bytes: number,
): boolean {
  const omittedBytes = totalSafeUtf8Bytes - retainedBytes;
  return collection.limitations.some(
    (limitation) =>
      limitation.code === "stream-truncated" &&
      limitation.commandId === commandId &&
      limitation.stream === stream &&
      limitation.retainedBytes === retainedBytes &&
      limitation.omittedBytes === omittedBytes,
  );
}

function isProjectRelativePath(value: string): boolean {
  return (
    isSafeText(value) &&
    value.length > 0 &&
    !value.startsWith("/") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
    new TextEncoder().encode(value).byteLength <= MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES
  );
}

const ProjectRelativePathSchema = Schema.String.pipe(
  Schema.filter(isProjectRelativePath, {
    identifier: "ObservabilityProjectRelativePath",
    description: "a portable project-relative path without dot segments",
  }),
);

const ExitCodeSchema = Schema.JsonNumber.pipe(
  Schema.filter(
    (value) =>
      Number.isSafeInteger(value) &&
      value >= -2_147_483_648 &&
      value <= 2_147_483_647,
    {
      identifier: "ObservabilityCommandExitCode",
      description: "a signed 32-bit command exit code",
    },
  ),
);

/** Record's opaque ref position is the only non-JSON value in a durable command payload. */
const RecordBlobRefPositionSchema: Schema.Schema<RecordBlobRef, RecordBlobRef, never> =
  Schema.declare<RecordBlobRef>(
    (value): value is RecordBlobRef => typeof value === "object" && value !== null,
  );

const ConversationItemBaseFields = {
  itemId: ItemIdSchema,
  turnId: TurnIdSchema,
  sequence: PositiveSafeIntegerSchema,
  refs: ConversationReferencesSchema,
} as const;

export const ConversationTurnSchema = Schema.Struct({
  turnId: TurnIdSchema,
  sequence: PositiveSafeIntegerSchema,
  outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted"),
  refs: ConversationReferencesSchema,
});

export const ConversationItemSchema = Schema.Union(
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("message"),
    role: Schema.Literal("user", "assistant"),
    text: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("tool-call"),
    callId: CallIdSchema,
    tool: SourceNativeToolNameSchema,
    inputSummary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("tool-result"),
    callId: CallIdSchema,
    outcome: Schema.Literal("completed", "rejected", "failed", "cancelled"),
    outputSummary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("thinking-summary"),
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("subagent"),
    state: Schema.Literal("started", "completed", "failed"),
    label: SafeIdentifierSchema,
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("input-request"),
    state: Schema.Literal("requested", "answered", "cancelled"),
    promptSummary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
    responseSummary: Schema.NullOr(
      boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
    ),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("skill-load"),
    skill: SafeIdentifierSchema,
    outcome: Schema.Literal("loaded", "failed"),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("context-injection"),
    source: Schema.Literal("system", "memory", "skill", "user"),
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("compaction"),
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
    compactedItemCount: NonNegativeSafeIntegerSchema,
  }),
  Schema.Struct({
    ...ConversationItemBaseFields,
    kind: Schema.Literal("conversation-error"),
    code: SafeIdentifierSchema,
    summary: boundedSafeTextSchema(MAX_CONVERSATION_TEXT_BYTES),
  }),
);

export type ConversationTurn = Schema.Schema.Type<typeof ConversationTurnSchema>;
export type ConversationItem = Schema.Schema.Type<typeof ConversationItemSchema>;

function conversationTextLengths(item: ConversationItem): readonly number[] {
  switch (item.kind) {
    case "message":
      return freezeArray([new TextEncoder().encode(item.text).byteLength]);
    case "tool-call":
      return freezeArray([new TextEncoder().encode(item.inputSummary).byteLength]);
    case "tool-result":
      return freezeArray([new TextEncoder().encode(item.outputSummary).byteLength]);
    case "thinking-summary":
    case "subagent":
    case "context-injection":
    case "compaction":
    case "conversation-error":
      return freezeArray([new TextEncoder().encode(item.summary).byteLength]);
    case "input-request":
      return freezeArray([
        new TextEncoder().encode(item.promptSummary).byteLength,
        ...(item.responseSummary === null
          ? []
          : [new TextEncoder().encode(item.responseSummary).byteLength]),
      ]);
    case "skill-load":
      return freezeArray([]);
  }
}

function isCanonicalConversationAttachment(
  value: Schema.Schema.Type<typeof ConversationAttachmentStructuralSchema>,
): boolean {
  if (
    value.turns.length > MAX_CONVERSATION_TURNS ||
    value.items.length > MAX_CONVERSATION_ITEMS ||
    !payloadFits(value, MAX_CONVERSATION_ATTACHMENT_BYTES) ||
    !isAllowedCollection(value.collection, ["conversation-item", "conversation-text"])
  ) {
    return false;
  }
  if (!isStrictlyOrderedById(value.turns, (turn) => turn.turnId)) return false;
  const turnIds = new Set<string>();
  const turnSequences = new Set<number>();
  for (const turn of value.turns) {
    turnIds.add(turn.turnId);
    if (turnSequences.has(turn.sequence)) return false;
    turnSequences.add(turn.sequence);
  }

  const itemIds = new Set<string>();
  const itemSequences = new Set<number>();
  const callIds = new Set<string>();
  const resultCallIds = new Set<string>();
  let previous: ConversationItem | undefined;
  for (const item of value.items) {
    if (
      itemIds.has(item.itemId) ||
      itemSequences.has(item.sequence) ||
      !turnIds.has(item.turnId)
    ) {
      return false;
    }
    if (
      previous !== undefined &&
      (previous.sequence > item.sequence ||
        (previous.sequence === item.sequence &&
          compareObservabilityText(previous.itemId, item.itemId) >= 0))
    ) {
      return false;
    }
    itemIds.add(item.itemId);
    itemSequences.add(item.sequence);
    if (item.kind === "tool-call") {
      if (callIds.has(item.callId)) return false;
      callIds.add(item.callId);
    }
    if (item.kind === "tool-result") {
      if (!callIds.has(item.callId) || resultCallIds.has(item.callId)) return false;
      resultCallIds.add(item.callId);
    }
    previous = item;
  }
  if (
    value.collection.state === "complete" &&
    [...callIds].some((callId) => !resultCallIds.has(callId))
  ) {
    return false;
  }
  return value.collection.limitations.every((limitation) => {
    if (limitation.code !== "text-truncated" || limitation.target !== "conversation-text") {
      return true;
    }
    const item = value.items.find((candidate) => candidate.itemId === limitation.itemId);
    return item !== undefined && conversationTextLengths(item).some(
      (length) => length === limitation.retainedBytes,
    );
  });
}

const ConversationAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  turns: Schema.Array(ConversationTurnSchema),
  items: Schema.Array(ConversationItemSchema),
});

export const ConversationAttachmentSchema = ConversationAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalConversationAttachment, {
    identifier: "ObservabilityConversationAttachment",
    description: "a canonical, bounded conversation attachment",
  }),
);

export type ConversationAttachment = Schema.Schema.Type<
  typeof ConversationAttachmentSchema
>;

const CommandInvocationSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("argv"),
    executable: boundedSafeTextSchema(MAX_COMMAND_EXECUTABLE_BYTES),
    arguments: Schema.Array(
      boundedSafeTextSchema(MAX_COMMAND_ARGUMENT_BYTES),
    ).pipe(
      Schema.filter((arguments_) => arguments_.length <= MAX_COMMAND_ARGUMENTS, {
        identifier: "ObservabilityCommandArguments",
        description: "at most 64 safe command arguments",
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("shell"),
    command: boundedSafeTextSchema(MAX_COMMAND_SHELL_BYTES),
  }),
);

const CommandWorkingDirectorySchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("sandbox-default") }),
  Schema.Struct({
    kind: Schema.Literal("project-relative"),
    path: ProjectRelativePathSchema,
  }),
  Schema.Struct({ kind: Schema.Literal("redacted") }),
);

export const CommandManifestSchema = Schema.Struct({
  phase: Schema.Literal(
    "attempt.setup",
    "sandbox.prepare",
    "agent.ensure",
    "eval.run",
    "sandbox.command",
    "attempt.teardown",
  ),
  invocation: CommandInvocationSchema,
  workingDirectory: CommandWorkingDirectorySchema,
});

export const CommandStreamSchema = Schema.Struct({
  storage: Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("inline"),
      text: SafeTextSchema,
    }),
    Schema.Struct({
      kind: Schema.Literal("blob"),
      ref: RecordBlobRefPositionSchema,
    }),
  ),
  retainedBytes: NonNegativeSafeIntegerSchema,
  totalSafeUtf8Bytes: NonNegativeSafeIntegerSchema,
});

export const CommandOutcomeSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("exited"),
    exitCode: ExitCodeSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("terminated"),
    reason: Schema.Literal("timeout", "cancelled", "transport-lost"),
  }),
  Schema.Struct({
    kind: Schema.Literal("not-started"),
    reason: Schema.Literal("spawn-failed", "cancelled-before-start"),
  }),
);

export const CommandResultSchema = Schema.Struct({
  outcome: CommandOutcomeSchema,
  stdout: CommandStreamSchema,
  stderr: CommandStreamSchema,
});

export const CommandObservationSchema = Schema.Struct({
  commandId: CommandIdSchema,
  manifest: CommandManifestSchema,
  result: CommandResultSchema,
  refs: CommandsReferencesSchema,
});

const CommandsAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  commands: Schema.Array(CommandObservationSchema),
});

export type CommandManifest = Schema.Schema.Type<typeof CommandManifestSchema>;
export type CommandStream = Schema.Schema.Type<typeof CommandStreamSchema>;
export type CommandResult = Schema.Schema.Type<typeof CommandResultSchema>;
export type CommandObservation = Schema.Schema.Type<typeof CommandObservationSchema>;

function isCanonicalCommandStream(
  stream: CommandStream,
  collection: Collection,
  commandId: string,
  streamName: "stdout" | "stderr",
): boolean {
  if (
    stream.retainedBytes > MAX_COMMAND_STREAM_BYTES ||
    stream.totalSafeUtf8Bytes < stream.retainedBytes
  ) {
    return false;
  }
  if (stream.storage.kind === "inline") {
    const bytes = new TextEncoder().encode(stream.storage.text).byteLength;
    if (
      bytes !== stream.retainedBytes ||
      stream.retainedBytes > MAX_COMMAND_INLINE_STREAM_BYTES
    ) {
      return false;
    }
  }
  if (stream.totalSafeUtf8Bytes === stream.retainedBytes) {
    return stream.storage.kind === "inline"
      ? stream.retainedBytes <= MAX_COMMAND_INLINE_STREAM_BYTES
      : stream.retainedBytes > MAX_COMMAND_INLINE_STREAM_BYTES;
  }
  return hasExactStreamTruncation(
    collection,
    commandId,
    streamName,
    stream.retainedBytes,
    stream.totalSafeUtf8Bytes,
  );
}

function commandManifestTextLengths(manifest: CommandManifest): readonly number[] {
  const encoder = new TextEncoder();
  const invocation = manifest.invocation.kind === "argv"
    ? [manifest.invocation.executable, ...manifest.invocation.arguments]
    : [manifest.invocation.command];
  const directory = manifest.workingDirectory.kind === "project-relative"
    ? [manifest.workingDirectory.path]
    : [];
  return freezeArray([...invocation, ...directory].map((value) => encoder.encode(value).byteLength));
}

function isCanonicalCommandsAttachment(
  value: Schema.Schema.Type<typeof CommandsAttachmentStructuralSchema>,
): boolean {
  if (
    value.commands.length > MAX_COMMANDS ||
    !payloadFits(value, MAX_COMMANDS_ATTACHMENT_BYTES) ||
    !isAllowedCollection(value.collection, [
      "command-manifest",
      "command-stdout",
      "command-stderr",
    ]) ||
    !isStrictlyOrderedById(value.commands, (command) => command.commandId)
  ) {
    return false;
  }
  let closureBytes = 0;
  for (const command of value.commands) {
    for (const [name, stream] of [
      ["stdout", command.result.stdout],
      ["stderr", command.result.stderr],
    ] as const) {
      if (!isCanonicalCommandStream(stream, value.collection, command.commandId, name)) {
        return false;
      }
      if (stream.storage.kind === "blob") {
        closureBytes += stream.retainedBytes;
      }
    }
  }
  if (closureBytes > MAX_COMMANDS_CLOSURE_BYTES) return false;
  return value.collection.limitations.every((limitation) => {
    if (limitation.code !== "text-truncated" || limitation.target !== "command-manifest") {
      return true;
    }
    const command = value.commands.find(
      (candidate) => candidate.commandId === limitation.commandId,
    );
    return command !== undefined && commandManifestTextLengths(command.manifest).some(
      (length) => length === limitation.retainedBytes,
    );
  });
}

export const CommandsAttachmentSchema = CommandsAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalCommandsAttachment, {
    identifier: "ObservabilityCommandsAttachment",
    description: "a canonical, bounded commands attachment",
  }),
);

export type CommandsAttachment = Schema.Schema.Type<typeof CommandsAttachmentSchema>;

export const UsageObservationSchema = Schema.Union(
  Schema.Struct({
    usageObservationId: UsageObservationIdSchema,
    provider: SafeIdentifierSchema,
    refs: UsageReferencesSchema,
    kind: Schema.Literal("token-bucket"),
    bucket: Schema.Literal(
      "input",
      "output",
      "cache-read",
      "cache-write",
      "reasoning",
      "other",
    ),
    tokens: NonNegativeSafeIntegerSchema,
  }),
  Schema.Struct({
    usageObservationId: UsageObservationIdSchema,
    provider: SafeIdentifierSchema,
    refs: UsageReferencesSchema,
    kind: Schema.Literal("request"),
    requestKind: Schema.Literal("model", "tool"),
  }),
  Schema.Struct({
    usageObservationId: UsageObservationIdSchema,
    provider: SafeIdentifierSchema,
    refs: UsageReferencesSchema,
    kind: Schema.Literal("provider-cost"),
    amount: Schema.String.pipe(
      Schema.filter(
        (value) =>
          /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value) &&
          new TextEncoder().encode(value).byteLength <= 64,
        {
          identifier: "ObservabilityCanonicalDecimal",
          description: "a non-negative canonical decimal string",
        },
      ),
    ),
    currency: CurrencyCodeSchema,
  }),
);

const UsageAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  observations: Schema.Array(UsageObservationSchema),
});

export type UsageObservation = Schema.Schema.Type<typeof UsageObservationSchema>;

function isCanonicalUsageAttachment(
  value: Schema.Schema.Type<typeof UsageAttachmentStructuralSchema>,
): boolean {
  return (
    value.observations.length <= MAX_USAGE_OBSERVATIONS &&
    payloadFits(value, MAX_USAGE_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["usage-observation"]) &&
    isStrictlyOrderedById(value.observations, (observation) => observation.usageObservationId)
  );
}

export const UsageAttachmentSchema = UsageAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalUsageAttachment, {
    identifier: "ObservabilityUsageAttachment",
    description: "a canonical, bounded usage attachment",
  }),
);

export type UsageAttachment = Schema.Schema.Type<typeof UsageAttachmentSchema>;

export const AttemptTimingPhaseSchema = Schema.Literal(
  "attempt.setup",
  "sandbox.prepare",
  "agent.ensure",
  "eval.run",
  "agent.send",
  "sandbox.command",
  "assertion.evaluate",
  "verdict.fold",
  "attempt.teardown",
);

export const RunTimingPhaseSchema = Schema.Literal(
  "run.setup",
  "run.discovery",
  "run.plan",
  "run.dispatch",
  "run.teardown",
);

const TimingOutcomeSchema = Schema.Literal(
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "unknown",
);

export const AttemptTimingIntervalSchema = Schema.Struct({
  intervalId: IntervalIdSchema,
  phase: AttemptTimingPhaseSchema,
  label: StableLabelSchema,
  startOffsetMs: NonNegativeSafeIntegerSchema,
  durationMs: NonNegativeSafeIntegerSchema,
  parentIntervalId: Schema.NullOr(IntervalIdSchema),
  outcome: TimingOutcomeSchema,
  refs: AttemptTimingReferencesSchema,
});

export const RunTimingIntervalSchema = Schema.Struct({
  intervalId: IntervalIdSchema,
  phase: RunTimingPhaseSchema,
  label: StableLabelSchema,
  startOffsetMs: NonNegativeSafeIntegerSchema,
  durationMs: NonNegativeSafeIntegerSchema,
  parentIntervalId: Schema.NullOr(IntervalIdSchema),
  outcome: TimingOutcomeSchema,
  refs: RunTimingReferencesSchema,
});

export type AttemptTimingInterval = Schema.Schema.Type<
  typeof AttemptTimingIntervalSchema
>;
export type RunTimingInterval = Schema.Schema.Type<
  typeof RunTimingIntervalSchema
>;

function timingEnd(start: number, duration: number): number | undefined {
  const end = start + duration;
  return Number.isSafeInteger(end) ? end : undefined;
}

function isCanonicalTimingTree<
  Interval extends {
    readonly intervalId: string;
    readonly startOffsetMs: number;
    readonly durationMs: number;
    readonly parentIntervalId: string | null;
  },
>(intervals: readonly Interval[]): boolean {
  if (!isStrictlyOrderedById(intervals, (interval) => interval.intervalId)) return false;
  const byId = new Map(intervals.map((interval) => [interval.intervalId, interval] as const));
  for (const interval of intervals) {
    const end = timingEnd(interval.startOffsetMs, interval.durationMs);
    if (end === undefined) return false;
    const ancestors = new Set<string>([interval.intervalId]);
    let child: Interval = interval;
    while (child.parentIntervalId !== null) {
      const parent = byId.get(child.parentIntervalId);
      if (parent === undefined || ancestors.has(parent.intervalId)) {
        return false;
      }
      const parentEnd = timingEnd(parent.startOffsetMs, parent.durationMs);
      const childEnd = timingEnd(child.startOffsetMs, child.durationMs);
      if (
        parentEnd === undefined ||
        childEnd === undefined ||
        parent.startOffsetMs > child.startOffsetMs ||
        childEnd > parentEnd
      ) {
        return false;
      }
      ancestors.add(parent.intervalId);
      child = parent;
    }
  }
  return true;
}

const AttemptTimingAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  intervals: Schema.Array(AttemptTimingIntervalSchema),
});

function isCanonicalAttemptTimingAttachment(
  value: Schema.Schema.Type<typeof AttemptTimingAttachmentStructuralSchema>,
): boolean {
  return (
    value.intervals.length <= MAX_TIMING_INTERVALS &&
    payloadFits(value, MAX_TIMING_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["timing-interval"]) &&
    isCanonicalTimingTree(value.intervals) &&
    (!value.intervals.some((interval) => interval.outcome === "unknown") ||
      value.collection.state === "partial")
  );
}

export const AttemptTimingAttachmentSchema = AttemptTimingAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalAttemptTimingAttachment, {
    identifier: "ObservabilityAttemptTimingAttachment",
    description: "a canonical, bounded attempt timing tree",
  }),
);

export type AttemptTimingAttachment = Schema.Schema.Type<
  typeof AttemptTimingAttachmentSchema
>;

const RunTimingAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  intervals: Schema.Array(RunTimingIntervalSchema),
});

function isCanonicalRunTimingAttachment(
  value: Schema.Schema.Type<typeof RunTimingAttachmentStructuralSchema>,
): boolean {
  return (
    value.intervals.length <= MAX_TIMING_INTERVALS &&
    payloadFits(value, MAX_TIMING_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["timing-interval"]) &&
    isCanonicalTimingTree(value.intervals) &&
    (!value.intervals.some((interval) => interval.outcome === "unknown") ||
      value.collection.state === "partial")
  );
}

export const RunTimingAttachmentSchema = RunTimingAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalRunTimingAttachment, {
    identifier: "ObservabilityRunTimingAttachment",
    description: "a canonical, bounded run timing tree",
  }),
);

export type RunTimingAttachment = Schema.Schema.Type<typeof RunTimingAttachmentSchema>;

export const AttemptDiagnosticPhaseSchema = Schema.Literal(
  "attempt.setup",
  "sandbox.prepare",
  "agent.ensure",
  "eval.run",
  "agent.send",
  "sandbox.command",
  "assertion.evaluate",
  "verdict.fold",
  "attempt.teardown",
  "collection",
);

export const RunDiagnosticPhaseSchema = Schema.Literal(
  "run.setup",
  "run.discovery",
  "run.plan",
  "run.dispatch",
  "run.teardown",
  "collection",
);

export const SourcePositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

export const SourceFrameSchema = Schema.Struct({
  sourceItemId: SourceFileItemIdSchema,
  sha256: Sha256DigestSchema,
  start: SourcePositionSchema,
  end: SourcePositionSchema,
});

const SafeDiagnosticCauseSchema = Schema.Struct({
  code: SafeIdentifierSchema,
  summary: boundedSafeTextSchema(MAX_DIAGNOSTIC_CAUSE_SUMMARY_BYTES),
});

const DiagnosticRedactionSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("none") }),
  Schema.Struct({
    state: Schema.Literal("applied"),
    summaryReplacements: NonNegativeSafeIntegerSchema,
    causeReplacements: NonNegativeSafeIntegerSchema,
    contextReplacements: NonNegativeSafeIntegerSchema,
  }),
);

const DiagnosticLimitContextSchema = Schema.Struct({
  kind: Schema.Literal("limit"),
  limit: Schema.Literal(
    "conversation-items",
    "commands",
    "usage-observations",
    "timing-intervals",
    "diagnostics",
    "command-stream-bytes",
  ),
  maximum: NonNegativeSafeIntegerSchema,
  observedAtLeast: NonNegativeSafeIntegerSchema,
});

const DiagnosticProviderContextSchema = Schema.Struct({
  kind: Schema.Literal("provider"),
  provider: SafeIdentifierSchema,
});

/**
 * The entity context is a single target rather than an array. Schema's generic
 * ref-array constructors cannot express the exclusion while preserving the
 * direct triple, so these declarations keep the exact input check local.
 */
const AttemptDiagnosticEntityContextSchema = Schema.Struct({
  kind: Schema.Literal("entity"),
  target: AttemptReferenceTargetSchema.pipe(
    Schema.filter((target): target is AttemptDiagnosticsReferences =>
      target.kind !== "diagnostic",
    ),
  ),
});

const RunDiagnosticEntityContextSchema = Schema.Struct({
  kind: Schema.Literal("entity"),
  target: RunReferenceTargetSchema.pipe(
    Schema.filter((target): target is RunDiagnosticsReferences =>
      target.kind !== "diagnostic",
    ),
  ),
});

const AttemptDiagnosticContextExactSchema = Schema.Union(
  AttemptDiagnosticEntityContextSchema,
  DiagnosticLimitContextSchema,
  DiagnosticProviderContextSchema,
);

const RunDiagnosticContextExactSchema = Schema.Union(
  RunDiagnosticEntityContextSchema,
  DiagnosticLimitContextSchema,
  DiagnosticProviderContextSchema,
);

export const AttemptDiagnosticSchema = Schema.Struct({
  diagnosticId: DiagnosticIdSchema,
  kind: Schema.Literal("advisory", "execution-error"),
  code: SafeIdentifierSchema,
  phase: AttemptDiagnosticPhaseSchema,
  summary: boundedSafeTextSchema(MAX_DIAGNOSTIC_SUMMARY_BYTES),
  causes: Schema.Array(SafeDiagnosticCauseSchema),
  context: Schema.Array(AttemptDiagnosticContextExactSchema),
  redaction: DiagnosticRedactionSchema,
  sourceFrame: Schema.NullOr(SourceFrameSchema),
  refs: AttemptDiagnosticsReferencesSchema,
});

export const RunDiagnosticSchema = Schema.Struct({
  diagnosticId: DiagnosticIdSchema,
  kind: Schema.Literal("advisory", "execution-error"),
  code: SafeIdentifierSchema,
  phase: RunDiagnosticPhaseSchema,
  summary: boundedSafeTextSchema(MAX_DIAGNOSTIC_SUMMARY_BYTES),
  causes: Schema.Array(SafeDiagnosticCauseSchema),
  context: Schema.Array(RunDiagnosticContextExactSchema),
  redaction: DiagnosticRedactionSchema,
  sourceFrame: Schema.NullOr(SourceFrameSchema),
  refs: RunDiagnosticsReferencesSchema,
});

export type SourcePosition = Schema.Schema.Type<typeof SourcePositionSchema>;
export type SourceFrame = Schema.Schema.Type<typeof SourceFrameSchema>;
export type SafeDiagnosticCause = Schema.Schema.Type<typeof SafeDiagnosticCauseSchema>;
export type DiagnosticRedaction = Schema.Schema.Type<typeof DiagnosticRedactionSchema>;
export type AttemptDiagnostic = Schema.Schema.Type<typeof AttemptDiagnosticSchema>;
export type RunDiagnostic = Schema.Schema.Type<typeof RunDiagnosticSchema>;

function sourcePositionBeforeOrEqual(
  left: SourcePosition,
  right: SourcePosition,
): boolean {
  return left.line < right.line || (left.line === right.line && left.column <= right.column);
}

function hasValidDiagnosticShape(
  diagnostic: {
    readonly causes: readonly SafeDiagnosticCause[];
    readonly context: readonly unknown[];
    readonly redaction: DiagnosticRedaction;
    readonly sourceFrame: SourceFrame | null;
  },
): boolean {
  if (
    diagnostic.causes.length > MAX_DIAGNOSTIC_CAUSES ||
    diagnostic.context.length > MAX_DIAGNOSTIC_CONTEXT_ITEMS
  ) {
    return false;
  }
  if (
    diagnostic.redaction.state === "applied" &&
    diagnostic.redaction.summaryReplacements === 0 &&
    diagnostic.redaction.causeReplacements === 0 &&
    diagnostic.redaction.contextReplacements === 0
  ) {
    return false;
  }
  return (
    diagnostic.sourceFrame === null ||
    sourcePositionBeforeOrEqual(diagnostic.sourceFrame.start, diagnostic.sourceFrame.end)
  );
}

const AttemptDiagnosticsAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  diagnostics: Schema.Array(AttemptDiagnosticSchema),
});

function isCanonicalAttemptDiagnosticsAttachment(
  value: Schema.Schema.Type<typeof AttemptDiagnosticsAttachmentStructuralSchema>,
): boolean {
  return (
    value.diagnostics.length <= MAX_DIAGNOSTICS &&
    payloadFits(value, MAX_DIAGNOSTICS_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["diagnostic"]) &&
    isStrictlyOrderedById(value.diagnostics, (diagnostic) => diagnostic.diagnosticId) &&
    value.diagnostics.every(hasValidDiagnosticShape)
  );
}

export const AttemptDiagnosticsAttachmentSchema =
  AttemptDiagnosticsAttachmentStructuralSchema.pipe(
    Schema.filter(isCanonicalAttemptDiagnosticsAttachment, {
      identifier: "ObservabilityAttemptDiagnosticsAttachment",
      description: "a canonical, bounded attempt diagnostics attachment",
    }),
  );

export type AttemptDiagnosticsAttachment = Schema.Schema.Type<
  typeof AttemptDiagnosticsAttachmentSchema
>;

const RunDiagnosticsAttachmentStructuralSchema = Schema.Struct({
  collection: CollectionSchema,
  diagnostics: Schema.Array(RunDiagnosticSchema),
});

function isCanonicalRunDiagnosticsAttachment(
  value: Schema.Schema.Type<typeof RunDiagnosticsAttachmentStructuralSchema>,
): boolean {
  return (
    value.diagnostics.length <= MAX_DIAGNOSTICS &&
    payloadFits(value, MAX_DIAGNOSTICS_ATTACHMENT_BYTES) &&
    isAllowedCollection(value.collection, ["diagnostic"]) &&
    isStrictlyOrderedById(value.diagnostics, (diagnostic) => diagnostic.diagnosticId) &&
    value.diagnostics.every(hasValidDiagnosticShape)
  );
}

export const RunDiagnosticsAttachmentSchema = RunDiagnosticsAttachmentStructuralSchema.pipe(
  Schema.filter(isCanonicalRunDiagnosticsAttachment, {
    identifier: "ObservabilityRunDiagnosticsAttachment",
    description: "a canonical, bounded run diagnostics attachment",
  }),
);

export type RunDiagnosticsAttachment = Schema.Schema.Type<
  typeof RunDiagnosticsAttachmentSchema
>;

const attemptConversationFamilySchemaId = "niceeval.observability" as const;
const attemptCommandsFamilySchemaId = "niceeval.observability" as const;
const attemptUsageFamilySchemaId = "niceeval.observability" as const;
const attemptTimingFamilySchemaId = "niceeval.observability" as const;
const attemptDiagnosticsFamilySchemaId = "niceeval.observability" as const;
const runTimingFamilySchemaId = "niceeval.observability" as const;
const runDiagnosticsFamilySchemaId = "niceeval.observability" as const;

/** Semantic cross-family facts intentionally remain independent of writes. */
export function makeAttemptConversationAttachmentFamilyValidation(
  payload: ConversationAttachment,
): ObservabilityFamilyValidation<"attempt"> {
  const entities: AttemptReferenceTarget[] = [
    ...payload.turns.map((turn) =>
      Object.freeze({
        family: attemptConversationFamilySchemaId,
        kind: "turn" as const,
        id: turn.turnId,
      }),
    ),
    ...payload.items.map((item) =>
      Object.freeze({
        family: attemptConversationFamilySchemaId,
        kind: "item" as const,
        id: item.itemId,
      }),
    ),
    ...payload.items.flatMap((item) =>
      item.kind === "tool-call"
        ? [
            Object.freeze({
              family: attemptConversationFamilySchemaId,
              kind: "call" as const,
              id: item.callId,
            }),
          ]
        : [],
    ),
  ];
  return makeAttemptObservabilityFamilyValidation({
    schemaId: attemptConversationFamilySchemaId,
    entities,
    references: [
      ...payload.turns.map((turn) =>
        Object.freeze({ sourceId: turn.turnId, refs: turn.refs }),
      ),
      ...payload.items.map((item) =>
        Object.freeze({ sourceId: item.itemId, refs: item.refs }),
      ),
    ],
  });
}

export function makeAttemptCommandsAttachmentFamilyValidation(input: {
  readonly commands: readonly {
    readonly commandId: CommandId;
    readonly refs: readonly CommandsReferences[];
  }[];
}): ObservabilityFamilyValidation<"attempt"> {
  return makeAttemptObservabilityFamilyValidation({
    schemaId: attemptCommandsFamilySchemaId,
    entities: input.commands.map((command) =>
      Object.freeze({
        family: attemptCommandsFamilySchemaId,
        kind: "command" as const,
        id: command.commandId,
      }),
    ),
    references: input.commands.map((command) =>
      Object.freeze({ sourceId: command.commandId, refs: command.refs }),
    ),
  });
}

export function makeAttemptUsageAttachmentFamilyValidation(
  payload: UsageAttachment,
): ObservabilityFamilyValidation<"attempt"> {
  return makeAttemptObservabilityFamilyValidation({
    schemaId: attemptUsageFamilySchemaId,
    entities: payload.observations.map((observation) =>
      Object.freeze({
        family: attemptUsageFamilySchemaId,
        kind: "usage-observation" as const,
        id: observation.usageObservationId,
      }),
    ),
    references: payload.observations.map((observation) =>
      Object.freeze({
        sourceId: observation.usageObservationId,
        refs: observation.refs,
      }),
    ),
  });
}

export function makeAttemptTimingAttachmentFamilyValidation(
  payload: AttemptTimingAttachment,
): ObservabilityFamilyValidation<"attempt"> {
  return makeAttemptObservabilityFamilyValidation({
    schemaId: attemptTimingFamilySchemaId,
    entities: payload.intervals.map((interval) =>
      Object.freeze({
        family: attemptTimingFamilySchemaId,
        kind: "interval" as const,
        id: interval.intervalId,
      }),
    ),
    references: payload.intervals.map((interval) =>
      Object.freeze({ sourceId: interval.intervalId, refs: interval.refs }),
    ),
  });
}

export function makeAttemptDiagnosticsAttachmentFamilyValidation(
  payload: AttemptDiagnosticsAttachment,
): ObservabilityFamilyValidation<"attempt"> {
  return makeAttemptObservabilityFamilyValidation({
    schemaId: attemptDiagnosticsFamilySchemaId,
    entities: payload.diagnostics.map((diagnostic) =>
      Object.freeze({
        family: attemptDiagnosticsFamilySchemaId,
        kind: "diagnostic" as const,
        id: diagnostic.diagnosticId,
      }),
    ),
    references: payload.diagnostics.map((diagnostic) =>
      Object.freeze({ sourceId: diagnostic.diagnosticId, refs: diagnostic.refs }),
    ),
  });
}

export function makeRunTimingAttachmentFamilyValidation(
  payload: RunTimingAttachment,
): ObservabilityFamilyValidation<"run"> {
  return makeRunObservabilityFamilyValidation({
    schemaId: runTimingFamilySchemaId,
    entities: payload.intervals.map((interval) =>
      Object.freeze({
        family: runTimingFamilySchemaId,
        kind: "interval" as const,
        id: interval.intervalId,
      }),
    ),
    references: payload.intervals.map((interval) =>
      Object.freeze({ sourceId: interval.intervalId, refs: interval.refs }),
    ),
  });
}

export function makeRunDiagnosticsAttachmentFamilyValidation(
  payload: RunDiagnosticsAttachment,
): ObservabilityFamilyValidation<"run"> {
  return makeRunObservabilityFamilyValidation({
    schemaId: runDiagnosticsFamilySchemaId,
    entities: payload.diagnostics.map((diagnostic) =>
      Object.freeze({
        family: runDiagnosticsFamilySchemaId,
        kind: "diagnostic" as const,
        id: diagnostic.diagnosticId,
      }),
    ),
    references: payload.diagnostics.map((diagnostic) =>
      Object.freeze({ sourceId: diagnostic.diagnosticId, refs: diagnostic.refs }),
    ),
  });
}
