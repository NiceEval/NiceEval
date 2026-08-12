import { Schema } from "effect";
import type { RecordBlobRef } from "../../record/attachment/index.ts";
import {
  Sha256DigestSchema,
  SourceFileItemIdSchema,
} from "../../sources/codec.ts";
import {
  AttemptDiagnosticsReferencesV1Schema,
  AttemptReferenceTargetV1Schema,
  AttemptTimingReferencesV1Schema,
  CollectionV1Schema,
  CommandsReferencesV1Schema,
  ConversationReferencesV1Schema,
  CurrencyCodeV1Schema,
  NonNegativeSafeIntegerV1Schema,
  PositiveSafeIntegerV1Schema,
  RunDiagnosticsReferencesV1Schema,
  RunReferenceTargetV1Schema,
  RunTimingReferencesV1Schema,
  SafeIdentifierV1Schema,
  SafeTextV1Schema,
  StableLabelV1Schema,
  UsageObservationIdV1Schema,
  UsageReferencesV1Schema,
  boundedSafeTextV1Schema,
  CallIdV1Schema,
  CommandIdV1Schema,
  DiagnosticIdV1Schema,
  IntervalIdV1Schema,
  ItemIdV1Schema,
  TurnIdV1Schema,
} from "./codec.ts";
import {
  MAX_COMMAND_ARGUMENT_BYTES_V1,
  MAX_COMMAND_ARGUMENTS_V1,
  MAX_COMMAND_EXECUTABLE_BYTES_V1,
  MAX_COMMAND_INLINE_STREAM_BYTES_V1,
  MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES_V1,
  MAX_COMMAND_SHELL_BYTES_V1,
  MAX_COMMAND_STREAM_BYTES_V1,
  MAX_COMMANDS_ATTACHMENT_BYTES_V1,
  MAX_COMMANDS_CLOSURE_BYTES_V1,
  MAX_COMMANDS_V1,
  MAX_CONVERSATION_ATTACHMENT_BYTES_V1,
  MAX_CONVERSATION_ITEMS_V1,
  MAX_CONVERSATION_TEXT_BYTES_V1,
  MAX_CONVERSATION_TURNS_V1,
  MAX_DIAGNOSTIC_CAUSES_V1,
  MAX_DIAGNOSTIC_CAUSE_SUMMARY_BYTES_V1,
  MAX_DIAGNOSTIC_CONTEXT_ITEMS_V1,
  MAX_DIAGNOSTIC_SUMMARY_BYTES_V1,
  MAX_DIAGNOSTICS_ATTACHMENT_BYTES_V1,
  MAX_DIAGNOSTICS_V1,
  MAX_TIMING_ATTACHMENT_BYTES_V1,
  MAX_TIMING_INTERVALS_V1,
  MAX_USAGE_ATTACHMENT_BYTES_V1,
  MAX_USAGE_OBSERVATIONS_V1,
} from "./limits.ts";
import {
  ATTEMPT_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1,
  RUN_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1,
  compareObservabilityTextV1,
  isSafeTextV1,
  jsonUtf8ByteLengthV1,
  limitationTargetV1,
  type AttemptDiagnosticsReferencesV1,
  type AttemptReferenceTargetV1,
  type CollectionV1,
  type CommandIdV1,
  type CommandsReferencesV1,
  type RunDiagnosticsReferencesV1,
} from "./model.ts";
import {
  makeAttemptObservabilityFamilyValidationV1,
  makeRunObservabilityFamilyValidationV1,
  type ObservabilityFamilyValidationV1,
} from "./validation.ts";

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function payloadFits(value: object, maximumBytes: number): boolean {
  const length = jsonUtf8ByteLengthV1(value);
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
    if (seen.has(id) || (previous !== undefined && compareObservabilityTextV1(previous, id) >= 0)) {
      return false;
    }
    seen.add(id);
    previous = id;
  }
  return true;
}

function isAllowedCollection(
  collection: CollectionV1,
  targets: readonly string[],
): boolean {
  return collection.limitations.every((limitation) =>
    targets.some((target) => limitationTargetV1(limitation) === target),
  );
}

function hasExactStreamTruncation(
  collection: CollectionV1,
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
    isSafeTextV1(value) &&
    value.length > 0 &&
    !value.startsWith("/") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..") &&
    new TextEncoder().encode(value).byteLength <= MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES_V1
  );
}

const ProjectRelativePathV1Schema = Schema.String.pipe(
  Schema.filter(isProjectRelativePath, {
    identifier: "ObservabilityProjectRelativePathV1",
    description: "a portable project-relative path without dot segments",
  }),
);

const ExitCodeV1Schema = Schema.JsonNumber.pipe(
  Schema.filter(
    (value) =>
      Number.isSafeInteger(value) &&
      value >= -2_147_483_648 &&
      value <= 2_147_483_647,
    {
      identifier: "ObservabilityCommandExitCodeV1",
      description: "a signed 32-bit command exit code",
    },
  ),
);

/** Record's opaque ref position is the only non-JSON value in a durable command payload. */
const RecordBlobRefPositionV1Schema: Schema.Schema<RecordBlobRef, RecordBlobRef, never> =
  Schema.declare<RecordBlobRef>(
    (value): value is RecordBlobRef => typeof value === "object" && value !== null,
  );

const ConversationItemBaseV1Fields = {
  itemId: ItemIdV1Schema,
  turnId: TurnIdV1Schema,
  sequence: PositiveSafeIntegerV1Schema,
  refs: ConversationReferencesV1Schema,
} as const;

export const ConversationTurnV1Schema = Schema.Struct({
  turnId: TurnIdV1Schema,
  sequence: PositiveSafeIntegerV1Schema,
  outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted"),
  refs: ConversationReferencesV1Schema,
});

export const ConversationItemV1Schema = Schema.Union(
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("message"),
    role: Schema.Literal("user", "assistant"),
    text: boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
  }),
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("tool-call"),
    callId: CallIdV1Schema,
    tool: SafeIdentifierV1Schema,
    inputSummary: boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
  }),
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("tool-result"),
    callId: CallIdV1Schema,
    outcome: Schema.Literal("completed", "rejected", "failed", "cancelled"),
    outputSummary: boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
  }),
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("thinking-summary"),
    summary: boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
  }),
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("subagent"),
    state: Schema.Literal("started", "completed", "failed"),
    label: SafeIdentifierV1Schema,
    summary: boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
  }),
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("input-request"),
    state: Schema.Literal("requested", "answered", "cancelled"),
    promptSummary: boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
    responseSummary: Schema.NullOr(
      boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
    ),
  }),
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("skill-load"),
    skill: SafeIdentifierV1Schema,
    outcome: Schema.Literal("loaded", "failed"),
  }),
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("context-injection"),
    source: Schema.Literal("system", "memory", "skill", "user"),
    summary: boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
  }),
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("compaction"),
    summary: boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
    compactedItemCount: NonNegativeSafeIntegerV1Schema,
  }),
  Schema.Struct({
    ...ConversationItemBaseV1Fields,
    kind: Schema.Literal("conversation-error"),
    code: SafeIdentifierV1Schema,
    summary: boundedSafeTextV1Schema(MAX_CONVERSATION_TEXT_BYTES_V1),
  }),
);

export type ConversationTurnV1 = Schema.Schema.Type<typeof ConversationTurnV1Schema>;
export type ConversationItemV1 = Schema.Schema.Type<typeof ConversationItemV1Schema>;

function conversationTextLengths(item: ConversationItemV1): readonly number[] {
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

function isCanonicalConversationAttachmentV1(
  value: Schema.Schema.Type<typeof ConversationAttachmentV1StructuralSchema>,
): boolean {
  if (
    value.turns.length > MAX_CONVERSATION_TURNS_V1 ||
    value.items.length > MAX_CONVERSATION_ITEMS_V1 ||
    !payloadFits(value, MAX_CONVERSATION_ATTACHMENT_BYTES_V1) ||
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
  let previous: ConversationItemV1 | undefined;
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
          compareObservabilityTextV1(previous.itemId, item.itemId) >= 0))
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

const ConversationAttachmentV1StructuralSchema = Schema.Struct({
  collection: CollectionV1Schema,
  turns: Schema.Array(ConversationTurnV1Schema),
  items: Schema.Array(ConversationItemV1Schema),
});

export const ConversationAttachmentV1Schema = ConversationAttachmentV1StructuralSchema.pipe(
  Schema.filter(isCanonicalConversationAttachmentV1, {
    identifier: "ObservabilityConversationAttachmentV1",
    description: "a canonical, bounded conversation attachment",
  }),
);

export type ConversationAttachmentV1 = Schema.Schema.Type<
  typeof ConversationAttachmentV1Schema
>;

const CommandInvocationV1Schema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("argv"),
    executable: boundedSafeTextV1Schema(MAX_COMMAND_EXECUTABLE_BYTES_V1),
    arguments: Schema.Array(
      boundedSafeTextV1Schema(MAX_COMMAND_ARGUMENT_BYTES_V1),
    ).pipe(
      Schema.filter((arguments_) => arguments_.length <= MAX_COMMAND_ARGUMENTS_V1, {
        identifier: "ObservabilityCommandArgumentsV1",
        description: "at most 64 safe command arguments",
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("shell"),
    command: boundedSafeTextV1Schema(MAX_COMMAND_SHELL_BYTES_V1),
  }),
);

const CommandWorkingDirectoryV1Schema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("sandbox-default") }),
  Schema.Struct({
    kind: Schema.Literal("project-relative"),
    path: ProjectRelativePathV1Schema,
  }),
  Schema.Struct({ kind: Schema.Literal("redacted") }),
);

export const CommandManifestV1Schema = Schema.Struct({
  phase: Schema.Literal(
    "attempt.setup",
    "sandbox.prepare",
    "agent.ensure",
    "eval.run",
    "sandbox.command",
    "attempt.teardown",
  ),
  invocation: CommandInvocationV1Schema,
  workingDirectory: CommandWorkingDirectoryV1Schema,
});

export const CommandStreamV1Schema = Schema.Struct({
  storage: Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("inline"),
      text: SafeTextV1Schema,
    }),
    Schema.Struct({
      kind: Schema.Literal("blob"),
      ref: RecordBlobRefPositionV1Schema,
    }),
  ),
  retainedBytes: NonNegativeSafeIntegerV1Schema,
  totalSafeUtf8Bytes: NonNegativeSafeIntegerV1Schema,
});

export const CommandOutcomeV1Schema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("exited"),
    exitCode: ExitCodeV1Schema,
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

export const CommandResultV1Schema = Schema.Struct({
  outcome: CommandOutcomeV1Schema,
  stdout: CommandStreamV1Schema,
  stderr: CommandStreamV1Schema,
});

export const CommandObservationV1Schema = Schema.Struct({
  commandId: CommandIdV1Schema,
  manifest: CommandManifestV1Schema,
  result: CommandResultV1Schema,
  refs: CommandsReferencesV1Schema,
});

const CommandsAttachmentV1StructuralSchema = Schema.Struct({
  collection: CollectionV1Schema,
  commands: Schema.Array(CommandObservationV1Schema),
});

export type CommandManifestV1 = Schema.Schema.Type<typeof CommandManifestV1Schema>;
export type CommandStreamV1 = Schema.Schema.Type<typeof CommandStreamV1Schema>;
export type CommandResultV1 = Schema.Schema.Type<typeof CommandResultV1Schema>;
export type CommandObservationV1 = Schema.Schema.Type<typeof CommandObservationV1Schema>;

function isCanonicalCommandStreamV1(
  stream: CommandStreamV1,
  collection: CollectionV1,
  commandId: string,
  streamName: "stdout" | "stderr",
): boolean {
  if (
    stream.retainedBytes > MAX_COMMAND_STREAM_BYTES_V1 ||
    stream.totalSafeUtf8Bytes < stream.retainedBytes
  ) {
    return false;
  }
  if (stream.storage.kind === "inline") {
    const bytes = new TextEncoder().encode(stream.storage.text).byteLength;
    if (
      bytes !== stream.retainedBytes ||
      stream.retainedBytes > MAX_COMMAND_INLINE_STREAM_BYTES_V1
    ) {
      return false;
    }
  }
  if (stream.totalSafeUtf8Bytes === stream.retainedBytes) {
    return stream.storage.kind === "inline"
      ? stream.retainedBytes <= MAX_COMMAND_INLINE_STREAM_BYTES_V1
      : stream.retainedBytes > MAX_COMMAND_INLINE_STREAM_BYTES_V1;
  }
  return hasExactStreamTruncation(
    collection,
    commandId,
    streamName,
    stream.retainedBytes,
    stream.totalSafeUtf8Bytes,
  );
}

function commandManifestTextLengths(manifest: CommandManifestV1): readonly number[] {
  const encoder = new TextEncoder();
  const invocation = manifest.invocation.kind === "argv"
    ? [manifest.invocation.executable, ...manifest.invocation.arguments]
    : [manifest.invocation.command];
  const directory = manifest.workingDirectory.kind === "project-relative"
    ? [manifest.workingDirectory.path]
    : [];
  return freezeArray([...invocation, ...directory].map((value) => encoder.encode(value).byteLength));
}

function isCanonicalCommandsAttachmentV1(
  value: Schema.Schema.Type<typeof CommandsAttachmentV1StructuralSchema>,
): boolean {
  if (
    value.commands.length > MAX_COMMANDS_V1 ||
    !payloadFits(value, MAX_COMMANDS_ATTACHMENT_BYTES_V1) ||
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
      if (!isCanonicalCommandStreamV1(stream, value.collection, command.commandId, name)) {
        return false;
      }
      if (stream.storage.kind === "blob") {
        closureBytes += stream.retainedBytes;
      }
    }
  }
  if (closureBytes > MAX_COMMANDS_CLOSURE_BYTES_V1) return false;
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

export const CommandsAttachmentV1Schema = CommandsAttachmentV1StructuralSchema.pipe(
  Schema.filter(isCanonicalCommandsAttachmentV1, {
    identifier: "ObservabilityCommandsAttachmentV1",
    description: "a canonical, bounded commands attachment",
  }),
);

export type CommandsAttachmentV1 = Schema.Schema.Type<typeof CommandsAttachmentV1Schema>;

export const UsageObservationV1Schema = Schema.Union(
  Schema.Struct({
    usageObservationId: UsageObservationIdV1Schema,
    provider: SafeIdentifierV1Schema,
    refs: UsageReferencesV1Schema,
    kind: Schema.Literal("token-bucket"),
    bucket: Schema.Literal(
      "input",
      "output",
      "cache-read",
      "cache-write",
      "reasoning",
      "other",
    ),
    tokens: NonNegativeSafeIntegerV1Schema,
  }),
  Schema.Struct({
    usageObservationId: UsageObservationIdV1Schema,
    provider: SafeIdentifierV1Schema,
    refs: UsageReferencesV1Schema,
    kind: Schema.Literal("request"),
    requestKind: Schema.Literal("model", "tool"),
  }),
  Schema.Struct({
    usageObservationId: UsageObservationIdV1Schema,
    provider: SafeIdentifierV1Schema,
    refs: UsageReferencesV1Schema,
    kind: Schema.Literal("provider-cost"),
    amount: Schema.String.pipe(
      Schema.filter(
        (value) =>
          /^(?:0|[1-9][0-9]*)(?:\.[0-9]*[1-9])?$/u.test(value) &&
          new TextEncoder().encode(value).byteLength <= 64,
        {
          identifier: "ObservabilityCanonicalDecimalV1",
          description: "a non-negative canonical decimal string",
        },
      ),
    ),
    currency: CurrencyCodeV1Schema,
  }),
);

const UsageAttachmentV1StructuralSchema = Schema.Struct({
  collection: CollectionV1Schema,
  observations: Schema.Array(UsageObservationV1Schema),
});

export type UsageObservationV1 = Schema.Schema.Type<typeof UsageObservationV1Schema>;

function isCanonicalUsageAttachmentV1(
  value: Schema.Schema.Type<typeof UsageAttachmentV1StructuralSchema>,
): boolean {
  return (
    value.observations.length <= MAX_USAGE_OBSERVATIONS_V1 &&
    payloadFits(value, MAX_USAGE_ATTACHMENT_BYTES_V1) &&
    isAllowedCollection(value.collection, ["usage-observation"]) &&
    isStrictlyOrderedById(value.observations, (observation) => observation.usageObservationId)
  );
}

export const UsageAttachmentV1Schema = UsageAttachmentV1StructuralSchema.pipe(
  Schema.filter(isCanonicalUsageAttachmentV1, {
    identifier: "ObservabilityUsageAttachmentV1",
    description: "a canonical, bounded usage attachment",
  }),
);

export type UsageAttachmentV1 = Schema.Schema.Type<typeof UsageAttachmentV1Schema>;

export const AttemptTimingPhaseV1Schema = Schema.Literal(
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

export const RunTimingPhaseV1Schema = Schema.Literal(
  "run.setup",
  "run.discovery",
  "run.plan",
  "run.dispatch",
  "run.teardown",
);

const TimingOutcomeV1Schema = Schema.Literal(
  "completed",
  "failed",
  "cancelled",
  "interrupted",
  "unknown",
);

export const AttemptTimingIntervalV1Schema = Schema.Struct({
  intervalId: IntervalIdV1Schema,
  phase: AttemptTimingPhaseV1Schema,
  label: StableLabelV1Schema,
  startOffsetMs: NonNegativeSafeIntegerV1Schema,
  durationMs: NonNegativeSafeIntegerV1Schema,
  parentIntervalId: Schema.NullOr(IntervalIdV1Schema),
  outcome: TimingOutcomeV1Schema,
  refs: AttemptTimingReferencesV1Schema,
});

export const RunTimingIntervalV1Schema = Schema.Struct({
  intervalId: IntervalIdV1Schema,
  phase: RunTimingPhaseV1Schema,
  label: StableLabelV1Schema,
  startOffsetMs: NonNegativeSafeIntegerV1Schema,
  durationMs: NonNegativeSafeIntegerV1Schema,
  parentIntervalId: Schema.NullOr(IntervalIdV1Schema),
  outcome: TimingOutcomeV1Schema,
  refs: RunTimingReferencesV1Schema,
});

export type AttemptTimingIntervalV1 = Schema.Schema.Type<
  typeof AttemptTimingIntervalV1Schema
>;
export type RunTimingIntervalV1 = Schema.Schema.Type<
  typeof RunTimingIntervalV1Schema
>;

function timingEnd(start: number, duration: number): number | undefined {
  const end = start + duration;
  return Number.isSafeInteger(end) ? end : undefined;
}

function isCanonicalTimingTreeV1<
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

const AttemptTimingAttachmentV1StructuralSchema = Schema.Struct({
  collection: CollectionV1Schema,
  intervals: Schema.Array(AttemptTimingIntervalV1Schema),
});

function isCanonicalAttemptTimingAttachmentV1(
  value: Schema.Schema.Type<typeof AttemptTimingAttachmentV1StructuralSchema>,
): boolean {
  return (
    value.intervals.length <= MAX_TIMING_INTERVALS_V1 &&
    payloadFits(value, MAX_TIMING_ATTACHMENT_BYTES_V1) &&
    isAllowedCollection(value.collection, ["timing-interval"]) &&
    isCanonicalTimingTreeV1(value.intervals) &&
    (!value.intervals.some((interval) => interval.outcome === "unknown") ||
      value.collection.state === "partial")
  );
}

export const AttemptTimingAttachmentV1Schema = AttemptTimingAttachmentV1StructuralSchema.pipe(
  Schema.filter(isCanonicalAttemptTimingAttachmentV1, {
    identifier: "ObservabilityAttemptTimingAttachmentV1",
    description: "a canonical, bounded attempt timing tree",
  }),
);

export type AttemptTimingAttachmentV1 = Schema.Schema.Type<
  typeof AttemptTimingAttachmentV1Schema
>;

const RunTimingAttachmentV1StructuralSchema = Schema.Struct({
  collection: CollectionV1Schema,
  intervals: Schema.Array(RunTimingIntervalV1Schema),
});

function isCanonicalRunTimingAttachmentV1(
  value: Schema.Schema.Type<typeof RunTimingAttachmentV1StructuralSchema>,
): boolean {
  return (
    value.intervals.length <= MAX_TIMING_INTERVALS_V1 &&
    payloadFits(value, MAX_TIMING_ATTACHMENT_BYTES_V1) &&
    isAllowedCollection(value.collection, ["timing-interval"]) &&
    isCanonicalTimingTreeV1(value.intervals) &&
    (!value.intervals.some((interval) => interval.outcome === "unknown") ||
      value.collection.state === "partial")
  );
}

export const RunTimingAttachmentV1Schema = RunTimingAttachmentV1StructuralSchema.pipe(
  Schema.filter(isCanonicalRunTimingAttachmentV1, {
    identifier: "ObservabilityRunTimingAttachmentV1",
    description: "a canonical, bounded run timing tree",
  }),
);

export type RunTimingAttachmentV1 = Schema.Schema.Type<typeof RunTimingAttachmentV1Schema>;

export const AttemptDiagnosticPhaseV1Schema = Schema.Literal(
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

export const RunDiagnosticPhaseV1Schema = Schema.Literal(
  "run.setup",
  "run.discovery",
  "run.plan",
  "run.dispatch",
  "run.teardown",
  "collection",
);

export const SourcePositionV1Schema = Schema.Struct({
  line: PositiveSafeIntegerV1Schema,
  column: PositiveSafeIntegerV1Schema,
});

export const SourceFrameV1Schema = Schema.Struct({
  sourceItemId: SourceFileItemIdSchema,
  sha256: Sha256DigestSchema,
  start: SourcePositionV1Schema,
  end: SourcePositionV1Schema,
});

const SafeDiagnosticCauseV1Schema = Schema.Struct({
  code: SafeIdentifierV1Schema,
  summary: boundedSafeTextV1Schema(MAX_DIAGNOSTIC_CAUSE_SUMMARY_BYTES_V1),
});

const DiagnosticRedactionV1Schema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("none") }),
  Schema.Struct({
    state: Schema.Literal("applied"),
    summaryReplacements: NonNegativeSafeIntegerV1Schema,
    causeReplacements: NonNegativeSafeIntegerV1Schema,
    contextReplacements: NonNegativeSafeIntegerV1Schema,
  }),
);

const DiagnosticLimitContextV1Schema = Schema.Struct({
  kind: Schema.Literal("limit"),
  limit: Schema.Literal(
    "conversation-items",
    "commands",
    "usage-observations",
    "timing-intervals",
    "diagnostics",
    "command-stream-bytes",
  ),
  maximum: NonNegativeSafeIntegerV1Schema,
  observedAtLeast: NonNegativeSafeIntegerV1Schema,
});

const DiagnosticProviderContextV1Schema = Schema.Struct({
  kind: Schema.Literal("provider"),
  provider: SafeIdentifierV1Schema,
});

/**
 * The entity context is a single target rather than an array. Schema's generic
 * ref-array constructors cannot express the exclusion while preserving the
 * direct triple, so these declarations keep the exact input check local.
 */
const AttemptDiagnosticEntityContextV1Schema = Schema.Struct({
  kind: Schema.Literal("entity"),
  target: AttemptReferenceTargetV1Schema.pipe(
    Schema.filter((target): target is AttemptDiagnosticsReferencesV1 =>
      target.family !== "niceeval.diagnostics/v1",
    ),
  ),
});

const RunDiagnosticEntityContextV1Schema = Schema.Struct({
  kind: Schema.Literal("entity"),
  target: RunReferenceTargetV1Schema.pipe(
    Schema.filter((target): target is RunDiagnosticsReferencesV1 =>
      target.family !== "niceeval.diagnostics/v1",
    ),
  ),
});

const AttemptDiagnosticContextExactV1Schema = Schema.Union(
  AttemptDiagnosticEntityContextV1Schema,
  DiagnosticLimitContextV1Schema,
  DiagnosticProviderContextV1Schema,
);

const RunDiagnosticContextExactV1Schema = Schema.Union(
  RunDiagnosticEntityContextV1Schema,
  DiagnosticLimitContextV1Schema,
  DiagnosticProviderContextV1Schema,
);

export const AttemptDiagnosticV1Schema = Schema.Struct({
  diagnosticId: DiagnosticIdV1Schema,
  kind: Schema.Literal("advisory", "execution-error"),
  code: SafeIdentifierV1Schema,
  phase: AttemptDiagnosticPhaseV1Schema,
  summary: boundedSafeTextV1Schema(MAX_DIAGNOSTIC_SUMMARY_BYTES_V1),
  causes: Schema.Array(SafeDiagnosticCauseV1Schema),
  context: Schema.Array(AttemptDiagnosticContextExactV1Schema),
  redaction: DiagnosticRedactionV1Schema,
  sourceFrame: Schema.NullOr(SourceFrameV1Schema),
  refs: AttemptDiagnosticsReferencesV1Schema,
});

export const RunDiagnosticV1Schema = Schema.Struct({
  diagnosticId: DiagnosticIdV1Schema,
  kind: Schema.Literal("advisory", "execution-error"),
  code: SafeIdentifierV1Schema,
  phase: RunDiagnosticPhaseV1Schema,
  summary: boundedSafeTextV1Schema(MAX_DIAGNOSTIC_SUMMARY_BYTES_V1),
  causes: Schema.Array(SafeDiagnosticCauseV1Schema),
  context: Schema.Array(RunDiagnosticContextExactV1Schema),
  redaction: DiagnosticRedactionV1Schema,
  sourceFrame: Schema.NullOr(SourceFrameV1Schema),
  refs: RunDiagnosticsReferencesV1Schema,
});

export type SourcePositionV1 = Schema.Schema.Type<typeof SourcePositionV1Schema>;
export type SourceFrameV1 = Schema.Schema.Type<typeof SourceFrameV1Schema>;
export type SafeDiagnosticCauseV1 = Schema.Schema.Type<typeof SafeDiagnosticCauseV1Schema>;
export type DiagnosticRedactionV1 = Schema.Schema.Type<typeof DiagnosticRedactionV1Schema>;
export type AttemptDiagnosticV1 = Schema.Schema.Type<typeof AttemptDiagnosticV1Schema>;
export type RunDiagnosticV1 = Schema.Schema.Type<typeof RunDiagnosticV1Schema>;

function sourcePositionBeforeOrEqual(
  left: SourcePositionV1,
  right: SourcePositionV1,
): boolean {
  return left.line < right.line || (left.line === right.line && left.column <= right.column);
}

function hasValidDiagnosticShape(
  diagnostic: {
    readonly causes: readonly SafeDiagnosticCauseV1[];
    readonly context: readonly unknown[];
    readonly redaction: DiagnosticRedactionV1;
    readonly sourceFrame: SourceFrameV1 | null;
  },
): boolean {
  if (
    diagnostic.causes.length > MAX_DIAGNOSTIC_CAUSES_V1 ||
    diagnostic.context.length > MAX_DIAGNOSTIC_CONTEXT_ITEMS_V1
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

const AttemptDiagnosticsAttachmentV1StructuralSchema = Schema.Struct({
  collection: CollectionV1Schema,
  diagnostics: Schema.Array(AttemptDiagnosticV1Schema),
});

function isCanonicalAttemptDiagnosticsAttachmentV1(
  value: Schema.Schema.Type<typeof AttemptDiagnosticsAttachmentV1StructuralSchema>,
): boolean {
  return (
    value.diagnostics.length <= MAX_DIAGNOSTICS_V1 &&
    payloadFits(value, MAX_DIAGNOSTICS_ATTACHMENT_BYTES_V1) &&
    isAllowedCollection(value.collection, ["diagnostic"]) &&
    isStrictlyOrderedById(value.diagnostics, (diagnostic) => diagnostic.diagnosticId) &&
    value.diagnostics.every(hasValidDiagnosticShape)
  );
}

export const AttemptDiagnosticsAttachmentV1Schema =
  AttemptDiagnosticsAttachmentV1StructuralSchema.pipe(
    Schema.filter(isCanonicalAttemptDiagnosticsAttachmentV1, {
      identifier: "ObservabilityAttemptDiagnosticsAttachmentV1",
      description: "a canonical, bounded attempt diagnostics attachment",
    }),
  );

export type AttemptDiagnosticsAttachmentV1 = Schema.Schema.Type<
  typeof AttemptDiagnosticsAttachmentV1Schema
>;

const RunDiagnosticsAttachmentV1StructuralSchema = Schema.Struct({
  collection: CollectionV1Schema,
  diagnostics: Schema.Array(RunDiagnosticV1Schema),
});

function isCanonicalRunDiagnosticsAttachmentV1(
  value: Schema.Schema.Type<typeof RunDiagnosticsAttachmentV1StructuralSchema>,
): boolean {
  return (
    value.diagnostics.length <= MAX_DIAGNOSTICS_V1 &&
    payloadFits(value, MAX_DIAGNOSTICS_ATTACHMENT_BYTES_V1) &&
    isAllowedCollection(value.collection, ["diagnostic"]) &&
    isStrictlyOrderedById(value.diagnostics, (diagnostic) => diagnostic.diagnosticId) &&
    value.diagnostics.every(hasValidDiagnosticShape)
  );
}

export const RunDiagnosticsAttachmentV1Schema = RunDiagnosticsAttachmentV1StructuralSchema.pipe(
  Schema.filter(isCanonicalRunDiagnosticsAttachmentV1, {
    identifier: "ObservabilityRunDiagnosticsAttachmentV1",
    description: "a canonical, bounded run diagnostics attachment",
  }),
);

export type RunDiagnosticsAttachmentV1 = Schema.Schema.Type<
  typeof RunDiagnosticsAttachmentV1Schema
>;

const [
  attemptConversationFamilySchemaIdV1,
  attemptCommandsFamilySchemaIdV1,
  attemptUsageFamilySchemaIdV1,
  attemptTimingFamilySchemaIdV1,
  attemptDiagnosticsFamilySchemaIdV1,
] = ATTEMPT_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1;
const [runTimingFamilySchemaIdV1, runDiagnosticsFamilySchemaIdV1] =
  RUN_OBSERVABILITY_FAMILY_SCHEMA_IDS_V1;

/** Semantic cross-family facts intentionally remain independent of writes. */
export function makeAttemptConversationAttachmentFamilyValidationV1(
  payload: ConversationAttachmentV1,
): ObservabilityFamilyValidationV1<"attempt"> {
  const entities: AttemptReferenceTargetV1[] = [
    ...payload.turns.map((turn) =>
      Object.freeze({
        family: attemptConversationFamilySchemaIdV1,
        kind: "turn" as const,
        id: turn.turnId,
      }),
    ),
    ...payload.items.map((item) =>
      Object.freeze({
        family: attemptConversationFamilySchemaIdV1,
        kind: "item" as const,
        id: item.itemId,
      }),
    ),
    ...payload.items.flatMap((item) =>
      item.kind === "tool-call"
        ? [
            Object.freeze({
              family: attemptConversationFamilySchemaIdV1,
              kind: "call" as const,
              id: item.callId,
            }),
          ]
        : [],
    ),
  ];
  return makeAttemptObservabilityFamilyValidationV1({
    schemaId: attemptConversationFamilySchemaIdV1,
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

export function makeAttemptCommandsAttachmentFamilyValidationV1(input: {
  readonly commands: readonly {
    readonly commandId: CommandIdV1;
    readonly refs: readonly CommandsReferencesV1[];
  }[];
}): ObservabilityFamilyValidationV1<"attempt"> {
  return makeAttemptObservabilityFamilyValidationV1({
    schemaId: attemptCommandsFamilySchemaIdV1,
    entities: input.commands.map((command) =>
      Object.freeze({
        family: attemptCommandsFamilySchemaIdV1,
        kind: "command" as const,
        id: command.commandId,
      }),
    ),
    references: input.commands.map((command) =>
      Object.freeze({ sourceId: command.commandId, refs: command.refs }),
    ),
  });
}

export function makeAttemptUsageAttachmentFamilyValidationV1(
  payload: UsageAttachmentV1,
): ObservabilityFamilyValidationV1<"attempt"> {
  return makeAttemptObservabilityFamilyValidationV1({
    schemaId: attemptUsageFamilySchemaIdV1,
    entities: payload.observations.map((observation) =>
      Object.freeze({
        family: attemptUsageFamilySchemaIdV1,
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

export function makeAttemptTimingAttachmentFamilyValidationV1(
  payload: AttemptTimingAttachmentV1,
): ObservabilityFamilyValidationV1<"attempt"> {
  return makeAttemptObservabilityFamilyValidationV1({
    schemaId: attemptTimingFamilySchemaIdV1,
    entities: payload.intervals.map((interval) =>
      Object.freeze({
        family: attemptTimingFamilySchemaIdV1,
        kind: "interval" as const,
        id: interval.intervalId,
      }),
    ),
    references: payload.intervals.map((interval) =>
      Object.freeze({ sourceId: interval.intervalId, refs: interval.refs }),
    ),
  });
}

export function makeAttemptDiagnosticsAttachmentFamilyValidationV1(
  payload: AttemptDiagnosticsAttachmentV1,
): ObservabilityFamilyValidationV1<"attempt"> {
  return makeAttemptObservabilityFamilyValidationV1({
    schemaId: attemptDiagnosticsFamilySchemaIdV1,
    entities: payload.diagnostics.map((diagnostic) =>
      Object.freeze({
        family: attemptDiagnosticsFamilySchemaIdV1,
        kind: "diagnostic" as const,
        id: diagnostic.diagnosticId,
      }),
    ),
    references: payload.diagnostics.map((diagnostic) =>
      Object.freeze({ sourceId: diagnostic.diagnosticId, refs: diagnostic.refs }),
    ),
  });
}

export function makeRunTimingAttachmentFamilyValidationV1(
  payload: RunTimingAttachmentV1,
): ObservabilityFamilyValidationV1<"run"> {
  return makeRunObservabilityFamilyValidationV1({
    schemaId: runTimingFamilySchemaIdV1,
    entities: payload.intervals.map((interval) =>
      Object.freeze({
        family: runTimingFamilySchemaIdV1,
        kind: "interval" as const,
        id: interval.intervalId,
      }),
    ),
    references: payload.intervals.map((interval) =>
      Object.freeze({ sourceId: interval.intervalId, refs: interval.refs }),
    ),
  });
}

export function makeRunDiagnosticsAttachmentFamilyValidationV1(
  payload: RunDiagnosticsAttachmentV1,
): ObservabilityFamilyValidationV1<"run"> {
  return makeRunObservabilityFamilyValidationV1({
    schemaId: runDiagnosticsFamilySchemaIdV1,
    entities: payload.diagnostics.map((diagnostic) =>
      Object.freeze({
        family: runDiagnosticsFamilySchemaIdV1,
        kind: "diagnostic" as const,
        id: diagnostic.diagnosticId,
      }),
    ),
    references: payload.diagnostics.map((diagnostic) =>
      Object.freeze({ sourceId: diagnostic.diagnosticId, refs: diagnostic.refs }),
    ),
  });
}
