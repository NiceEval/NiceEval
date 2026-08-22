import { createHash } from "node:crypto";

import { Schema } from "effect";
import {
  CanonicalProjectRelativePathSchema,
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../codec/identifiers.ts";
import {
  RecordBlobRefSchema,
  type RecordBlobRef,
} from "../../attachment/blob-ref.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../../attachment/errors.ts";
import { defineRecordAttachment } from "../../definition/index.ts";
import type { SourcesAttachment } from "../sources.ts";
import {
  MAX_COMMAND_INLINE_STREAM_BYTES,
  MAX_COMMAND_STREAM_BYTES,
} from "../../../o11y/record/limits.ts";
import { isCanonicalTurnLabel } from "../../../shared/turn-label.ts";
import {
  FixedAttachmentValueLimits,
  NonNegativeSafeIntegerSchema,
  EmptyArraySchema,
  PositiveSafeIntegerSchema,
  SafeIdentifierSchema,
  SafeTextSchema,
  isCanonicalIdentitySequence,
} from "../common.ts";

const ObservabilityTargetSchema = Schema.Literal(
  "conversation",
  "command",
  "usage",
  "timing",
  "diagnostic",
);

const ObservabilityLimitationSchema = Schema.Union(
  Schema.Struct({
    code: Schema.Literal("capture-failed", "capture-interrupted"),
    stage: Schema.Literal(
      "adapter",
      "command-capture",
      "usage-capture",
      "timing-capture",
      "diagnostic-capture",
      "attempt-finalizer",
      "run-teardown",
    ),
    target: ObservabilityTargetSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("collection-cap-reached", "unsupported-input"),
    target: ObservabilityTargetSchema,
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("text-truncated", "redacted"),
    target: ObservabilityTargetSchema,
    replacementOrOmittedCount: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("stream-truncated"),
    commandId: SafeIdentifierSchema,
    stream: Schema.Literal("stdout", "stderr"),
    retainedBytes: NonNegativeSafeIntegerSchema,
    omittedBytes: PositiveSafeIntegerSchema,
  }),
  Schema.Struct({
    code: Schema.Literal("invalid-utf8-replaced", "unsafe-control-stripped"),
    commandId: SafeIdentifierSchema,
    stream: Schema.Literal("stdout", "stderr"),
    count: PositiveSafeIntegerSchema,
  }),
);

const ObservabilityCollectionStateSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(ObservabilityLimitationSchema),
  }),
);

const ConversationTurnSchema = Schema.Struct({
  turnId: SafeIdentifierSchema,
  sequence: PositiveSafeIntegerSchema,
  outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted"),
});

const ConversationItemBase = {
  itemId: SafeIdentifierSchema,
  turnId: SafeIdentifierSchema,
  sequence: PositiveSafeIntegerSchema,
} as const;

const ConversationItemSchema = Schema.Union(
  Schema.Struct({
    ...ConversationItemBase,
    kind: Schema.Literal("message"),
    role: Schema.Literal("user", "assistant"),
    text: SafeTextSchema,
  }),
  Schema.Struct({
    ...ConversationItemBase,
    kind: Schema.Literal("tool-call"),
    callId: SafeIdentifierSchema,
    tool: SafeIdentifierSchema,
    inputSummary: SafeTextSchema,
  }),
  Schema.Struct({
    ...ConversationItemBase,
    kind: Schema.Literal("tool-result"),
    callId: SafeIdentifierSchema,
    outcome: Schema.Literal("completed", "rejected", "failed", "cancelled"),
    outputSummary: SafeTextSchema,
  }),
  Schema.Struct({
    ...ConversationItemBase,
    kind: Schema.Literal("thinking-summary", "compaction", "context-injection"),
    summary: SafeTextSchema,
  }),
  Schema.Struct({
    ...ConversationItemBase,
    kind: Schema.Literal("subagent"),
    state: Schema.Literal("started", "completed", "failed"),
    label: SafeIdentifierSchema,
    summary: SafeTextSchema,
  }),
  Schema.Struct({
    ...ConversationItemBase,
    kind: Schema.Literal("input-request"),
    state: Schema.Literal("requested", "answered", "cancelled"),
    promptSummary: SafeTextSchema,
    responseSummary: Schema.NullOr(SafeTextSchema),
  }),
  Schema.Struct({
    ...ConversationItemBase,
    kind: Schema.Literal("skill-load", "conversation-error"),
    code: SafeIdentifierSchema,
    summary: SafeTextSchema,
  }),
);

export const AttemptConversationCollectionSchema = Schema.Struct({
  collection: ObservabilityCollectionStateSchema,
  turns: Schema.Array(ConversationTurnSchema),
  items: Schema.Array(ConversationItemSchema),
}).pipe(
  Schema.filter(
    (value) => {
      // Conversation is temporal. Producers retain turns and items in their
      // observed sequence, so canonicality is unique identity plus a strictly
      // increasing sequence (not lexical ordering of ids such as turn-9 and
      // turn-10).
      if (new Set(value.turns.map((turn) => turn.turnId)).size !== value.turns.length) return false;
      if (new Set(value.items.map((item) => item.itemId)).size !== value.items.length) return false;
      const turnIds = new Set(value.turns.map((turn) => turn.turnId));
      if (new Set(value.turns.map((turn) => turn.sequence)).size !== value.turns.length) return false;
      if (new Set(value.items.map((item) => item.sequence)).size !== value.items.length) return false;
      if (value.turns.some((turn, index) => index > 0 && value.turns[index - 1]!.sequence >= turn.sequence)) return false;
      if (value.items.some((item, index) => index > 0 && value.items[index - 1]!.sequence >= item.sequence)) return false;
      const callIds = new Map<string, { readonly turnId: string; readonly sequence: number }>();
      for (const item of value.items) {
        if (!turnIds.has(item.turnId)) return false;
        if (item.kind === "tool-call") {
          if (callIds.has(item.callId)) return false;
          callIds.set(item.callId, { turnId: item.turnId, sequence: item.sequence });
        }
      }
      // Resolve every call first, then validate results by their explicit
      // sequence.
      const resultIds = new Set<string>();
      for (const item of value.items) {
        if (item.kind === "tool-result") {
          const call = callIds.get(item.callId);
          if (
            call === undefined || resultIds.has(item.callId) ||
            call.turnId !== item.turnId || item.sequence <= call.sequence
          ) return false;
          resultIds.add(item.callId);
        }
      }
      return value.collection.state !== "complete" || [...callIds.keys()].every((id) => resultIds.has(id));
    },
    {
      identifier: "AttemptConversationCollection",
      description: "canonical turns/items with matched tool calls in a complete collection",
    },
  ),
);

const CommandStreamSchema = Schema.Struct({
  storage: Schema.Union(
    Schema.Struct({ kind: Schema.Literal("inline"), text: SafeTextSchema }),
    Schema.Struct({ kind: Schema.Literal("blob"), ref: RecordBlobRefSchema }),
  ),
  retainedBytes: NonNegativeSafeIntegerSchema,
  totalSafeUtf8Bytes: NonNegativeSafeIntegerSchema,
  /** Digest of the exact retained safe bytes, whether inline or blob-backed. */
  sha256: Sha256DigestSchema,
}).pipe(
  Schema.filter(
    (value) => {
      if (
        value.totalSafeUtf8Bytes < value.retainedBytes ||
        value.retainedBytes > MAX_COMMAND_STREAM_BYTES
      ) return false;
      if (value.storage.kind !== "inline") return true;
      return value.retainedBytes <= MAX_COMMAND_INLINE_STREAM_BYTES &&
        new TextEncoder().encode(value.storage.text).byteLength === value.retainedBytes;
    },
    {
      identifier: "CommandStream",
      description: "a stream whose retained bytes cannot exceed the observed safe bytes",
    },
  ),
);

const CommandObservationSchema = Schema.Struct({
  commandId: SafeIdentifierSchema,
  manifest: Schema.Struct({
    phase: Schema.Literal(
      "attempt.setup",
      "sandbox.prepare",
      "agent.ensure",
      "eval.run",
      "sandbox.command",
      "attempt.teardown",
    ),
    invocation: Schema.Union(
      Schema.Struct({
        kind: Schema.Literal("argv"),
        executable: SafeTextSchema,
        arguments: Schema.Array(SafeTextSchema),
      }),
      Schema.Struct({ kind: Schema.Literal("shell"), command: SafeTextSchema }),
    ),
    workingDirectory: Schema.Union(
      Schema.Struct({ kind: Schema.Literal("sandbox-default") }),
      Schema.Struct({
        kind: Schema.Literal("project-relative"),
        path: CanonicalProjectRelativePathSchema,
      }),
      Schema.Struct({ kind: Schema.Literal("redacted") }),
    ),
  }),
  result: Schema.Struct({
    outcome: Schema.Union(
      Schema.Struct({
        kind: Schema.Literal("exited"),
        exitCode: Schema.JsonNumber.pipe(
          Schema.filter((value) => Number.isSafeInteger(value)),
        ),
      }),
      Schema.Struct({
        kind: Schema.Literal("terminated"),
        reason: Schema.Literal("timeout", "cancelled", "transport-lost"),
      }),
      Schema.Struct({
        kind: Schema.Literal("not-started"),
        reason: Schema.Literal("spawn-failed", "cancelled-before-start"),
      }),
    ),
    stdout: CommandStreamSchema,
    stderr: CommandStreamSchema,
  }),
});

function hasStreamTruncationLimitation(
  limitations: readonly unknown[],
  commandId: string,
  stream: "stdout" | "stderr",
  retainedBytes: number,
  totalSafeUtf8Bytes: number,
): boolean {
  if (totalSafeUtf8Bytes === retainedBytes) return true;
  const omittedBytes = totalSafeUtf8Bytes - retainedBytes;
  return limitations.some((limitation) => {
    if (typeof limitation !== "object" || limitation === null) return false;
    const candidate = limitation as Record<string, unknown>;
    return candidate.code === "stream-truncated" &&
      candidate.commandId === commandId &&
      candidate.stream === stream &&
      candidate.retainedBytes === retainedBytes &&
      candidate.omittedBytes === omittedBytes;
  });
}

function hasCanonicalCommandsCollection(value: {
  readonly collection: { readonly limitations: readonly unknown[] };
  readonly commands: readonly Schema.Schema.Type<typeof CommandObservationSchema>[];
}): boolean {
  if (
    value.commands.length > 256 ||
    !isCanonicalIdentitySequence(value.commands.map((command) => command.commandId))
  ) return false;
  for (const command of value.commands) {
    for (const [streamName, stream] of [
      ["stdout", command.result.stdout],
      ["stderr", command.result.stderr],
    ] as const) {
      if (
        (stream.storage.kind === "inline") !==
          (stream.retainedBytes <= MAX_COMMAND_INLINE_STREAM_BYTES) ||
        !hasStreamTruncationLimitation(
          value.collection.limitations,
          command.commandId,
          streamName,
          stream.retainedBytes,
          stream.totalSafeUtf8Bytes,
        )
      ) return false;
    }
  }
  return true;
}

export const AttemptCommandsCollectionSchema = Schema.Struct({
  collection: ObservabilityCollectionStateSchema,
  commands: Schema.Array(CommandObservationSchema),
}).pipe(
  Schema.filter(
    hasCanonicalCommandsCollection,
    {
      identifier: "AttemptCommandsCollection",
      description: "canonical command identities",
    },
  ),
);

const UsageObservationSchema = Schema.Union(
  Schema.Struct({
    usageObservationId: SafeIdentifierSchema,
    kind: Schema.Literal("token-bucket"),
    provider: SafeIdentifierSchema,
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
    usageObservationId: SafeIdentifierSchema,
    kind: Schema.Literal("request"),
    provider: SafeIdentifierSchema,
    requestKind: Schema.Literal("model", "tool"),
  }),
  Schema.Struct({
    usageObservationId: SafeIdentifierSchema,
    kind: Schema.Literal("provider-cost"),
    provider: SafeIdentifierSchema,
    amount: Schema.String.pipe(
      Schema.filter((value) => /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value)),
    ),
    currency: Schema.String.pipe(Schema.filter((value) => /^[A-Z]{3}$/.test(value))),
  }),
);

export const AttemptUsageCollectionSchema = Schema.Struct({
  collection: ObservabilityCollectionStateSchema,
  observations: Schema.Array(UsageObservationSchema),
}).pipe(
  Schema.filter(
    (value) =>
      isCanonicalIdentitySequence(
        value.observations.map((observation) => observation.usageObservationId),
      ),
    { identifier: "AttemptUsageCollection", description: "canonical usage identities" },
  ),
);

const AttemptTimingPhaseSchema = Schema.Literal(
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
const RunTimingPhaseSchema = Schema.Literal(
  "run.setup",
  "run.discovery",
  "run.plan",
  "run.dispatch",
  "run.teardown",
);

interface TimingEntryForValidation {
  readonly intervalId: string;
  readonly parentIntervalId: string | null;
  readonly outcome: string;
  readonly startOffsetMs: number;
  readonly durationMs: number;
}

interface TimingCollectionForValidation {
  readonly collection: { readonly state: string };
  readonly intervals: readonly TimingEntryForValidation[];
}

function isTimingEntryForValidation(value: unknown): value is TimingEntryForValidation {
  return (
    typeof value === "object" &&
    value !== null &&
    "intervalId" in value &&
    typeof value.intervalId === "string" &&
    "parentIntervalId" in value &&
    (typeof value.parentIntervalId === "string" || value.parentIntervalId === null) &&
    "outcome" in value &&
    typeof value.outcome === "string" &&
    "startOffsetMs" in value &&
    typeof value.startOffsetMs === "number" &&
    "durationMs" in value &&
    typeof value.durationMs === "number"
  );
}

function isTimingCollectionForValidation(
  value: unknown,
): value is TimingCollectionForValidation {
  return (
    typeof value === "object" &&
    value !== null &&
    "collection" in value &&
    typeof value.collection === "object" &&
    value.collection !== null &&
    "state" in value.collection &&
    typeof value.collection.state === "string" &&
    "intervals" in value &&
    Array.isArray(value.intervals) &&
    value.intervals.every(isTimingEntryForValidation)
  );
}

function hasCanonicalTimingCollection(value: unknown): boolean {
  if (!isTimingCollectionForValidation(value)) return false;
  if (!isCanonicalIdentitySequence(value.intervals.map((entry) => entry.intervalId))) {
    return false;
  }
  const byId = new Map(value.intervals.map((entry) => [entry.intervalId, entry] as const));
  for (const entry of value.intervals) {
    const end = entry.startOffsetMs + entry.durationMs;
    if (!Number.isSafeInteger(end)) return false;
    if (entry.parentIntervalId === null) continue;
    const parent = byId.get(entry.parentIntervalId);
    if (parent === undefined) return false;
    const parentEnd = parent.startOffsetMs + parent.durationMs;
    if (
      !Number.isSafeInteger(parentEnd) || entry.startOffsetMs < parent.startOffsetMs ||
      end > parentEnd
    ) return false;
    const visited = new Set<string>([entry.intervalId]);
    let cursor: TimingEntryForValidation | undefined = parent;
    while (cursor !== undefined && cursor.parentIntervalId !== null) {
      if (visited.has(cursor.intervalId)) return false;
      visited.add(cursor.intervalId);
      cursor = byId.get(cursor.parentIntervalId);
      if (cursor === undefined) return false;
    }
  }
  return (
    value.collection.state !== "complete" ||
    value.intervals.every((entry) => entry.outcome !== "unknown")
  );
}

function timingCollectionSchema<Phase extends Schema.Schema.AnyNoContext>(phase: Phase) {
  const interval = Schema.Struct({
    intervalId: SafeIdentifierSchema,
    phase,
    label: SafeIdentifierSchema,
    startOffsetMs: NonNegativeSafeIntegerSchema,
    durationMs: NonNegativeSafeIntegerSchema,
    parentIntervalId: Schema.NullOr(SafeIdentifierSchema),
    outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted", "unknown"),
  });
  return Schema.Struct({
    collection: ObservabilityCollectionStateSchema,
    intervals: Schema.Array(interval),
  }).pipe(
    Schema.filter(
      hasCanonicalTimingCollection,
      { identifier: "TimingCollection", description: "canonical timing intervals with valid parents" },
    ),
  );
}

const CanonicalTurnLabelSchema = Schema.String.pipe(
  Schema.filter(
    isCanonicalTurnLabel,
    {
      identifier: "CanonicalTurnLabel",
      description: "a canonical turnN or sessionK/turnN timing label",
    },
  ),
);

function attemptTimingCollectionSchema<Label extends Schema.Schema.AnyNoContext>(
  agentSendLabel: Label,
) {
  const intervalBase = {
    intervalId: SafeIdentifierSchema,
    startOffsetMs: NonNegativeSafeIntegerSchema,
    durationMs: NonNegativeSafeIntegerSchema,
    parentIntervalId: Schema.NullOr(SafeIdentifierSchema),
    outcome: Schema.Literal("completed", "failed", "cancelled", "interrupted", "unknown"),
  } as const;
  const interval = Schema.Union(
    Schema.Struct({
      ...intervalBase,
      phase: Schema.Literal("agent.send"),
      label: agentSendLabel,
    }),
    Schema.Struct({
      ...intervalBase,
      phase: Schema.Literal(
        "attempt.setup",
        "sandbox.prepare",
        "agent.ensure",
        "eval.run",
        "sandbox.command",
        "assertion.evaluate",
        "verdict.fold",
        "attempt.teardown",
      ),
      label: SafeIdentifierSchema,
    }),
  );
  return Schema.Struct({
    collection: ObservabilityCollectionStateSchema,
    intervals: Schema.Array(interval),
  }).pipe(
    Schema.filter(
      hasCanonicalTimingCollection,
      { identifier: "TimingCollection", description: "canonical timing intervals with valid parents" },
    ),
  );
}

export const AttemptTimingCollectionSchema = attemptTimingCollectionSchema(
  Schema.Union(SafeIdentifierSchema, CanonicalTurnLabelSchema),
);
/** Exact historical v1 timing shape: every label was a SafeIdentifier. */
export const AttemptTimingCollectionV1Schema = attemptTimingCollectionSchema(SafeIdentifierSchema);
export const RunTimingCollectionSchema = timingCollectionSchema(RunTimingPhaseSchema);

const SourceFrameSchema = Schema.Struct({
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: Schema.Struct({
    line: PositiveSafeIntegerSchema,
    column: PositiveSafeIntegerSchema,
  }),
  end: Schema.Struct({
    line: PositiveSafeIntegerSchema,
    column: PositiveSafeIntegerSchema,
  }),
});

interface DiagnosticForValidation {
  readonly diagnosticId: string;
}

interface DiagnosticsCollectionForValidation {
  readonly diagnostics: readonly DiagnosticForValidation[];
}

function isDiagnosticForValidation(value: unknown): value is DiagnosticForValidation {
  return (
    typeof value === "object" &&
    value !== null &&
    "diagnosticId" in value &&
    typeof value.diagnosticId === "string"
  );
}

function isDiagnosticsCollectionForValidation(
  value: unknown,
): value is DiagnosticsCollectionForValidation {
  return (
    typeof value === "object" &&
    value !== null &&
    "diagnostics" in value &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isDiagnosticForValidation)
  );
}

function hasCanonicalDiagnosticsCollection(value: unknown): boolean {
  return (
    isDiagnosticsCollectionForValidation(value) &&
    isCanonicalIdentitySequence(
      value.diagnostics.map((diagnostic) => diagnostic.diagnosticId),
    )
  );
}

function diagnosticsCollectionSchema<Phase extends Schema.Schema.AnyNoContext>(phase: Phase) {
  const diagnostic = Schema.Struct({
    diagnosticId: SafeIdentifierSchema,
    kind: Schema.Literal("advisory", "execution-error"),
    code: SafeIdentifierSchema,
    phase,
    summary: SafeTextSchema,
    causes: Schema.Array(
      Schema.Struct({ code: SafeIdentifierSchema, summary: SafeTextSchema }),
    ),
    redaction: Schema.Union(
      Schema.Struct({ state: Schema.Literal("none") }),
      Schema.Struct({ state: Schema.Literal("applied"), replacements: PositiveSafeIntegerSchema }),
    ),
    sourceFrame: Schema.NullOr(SourceFrameSchema),
  });
  return Schema.Struct({
    collection: ObservabilityCollectionStateSchema,
    diagnostics: Schema.Array(diagnostic),
  }).pipe(
    Schema.filter(
      hasCanonicalDiagnosticsCollection,
      { identifier: "DiagnosticsCollection", description: "canonical diagnostic identities" },
    ),
  );
}

export const AttemptDiagnosticsCollectionSchema = diagnosticsCollectionSchema(
  Schema.Literal(
    "attempt.setup",
    "sandbox.prepare",
    "agent.ensure",
    "eval.run",
    "agent.send",
    "sandbox.command",
    "assertion.evaluate",
    "verdict.fold",
    "attempt.teardown",
  ),
);
export const RunDiagnosticsCollectionSchema = diagnosticsCollectionSchema(
  Schema.Literal("run.setup", "run.discovery", "run.plan", "run.dispatch", "run.teardown"),
);

/** Exact Attempt owner payload for the one fixed Observability family. */
export const AttemptObservabilityAttachmentSchema = Schema.Struct({
  owner: Schema.propertySignature(Schema.Literal("attempt")).pipe(
    Schema.fromKey("owner-kind"),
  ),
  conversation: Schema.propertySignature(AttemptConversationCollectionSchema).pipe(
    Schema.fromKey("conversation-data"),
  ),
  commands: Schema.propertySignature(AttemptCommandsCollectionSchema).pipe(
    Schema.fromKey("commands-data"),
  ),
  usage: Schema.propertySignature(AttemptUsageCollectionSchema).pipe(
    Schema.fromKey("usage-data"),
  ),
  timing: Schema.propertySignature(AttemptTimingCollectionSchema).pipe(
    Schema.fromKey("timing-data"),
  ),
  diagnostics: Schema.propertySignature(AttemptDiagnosticsCollectionSchema).pipe(
    Schema.fromKey("diagnostics-data"),
  ),
});

/** Exact historical v1 payload; only the agent.send label domain differs from v2. */
export const AttemptObservabilityAttachmentV1Schema = Schema.Struct({
  owner: Schema.propertySignature(Schema.Literal("attempt")).pipe(
    Schema.fromKey("owner-kind"),
  ),
  conversation: Schema.propertySignature(AttemptConversationCollectionSchema).pipe(
    Schema.fromKey("conversation-data"),
  ),
  commands: Schema.propertySignature(AttemptCommandsCollectionSchema).pipe(
    Schema.fromKey("commands-data"),
  ),
  usage: Schema.propertySignature(AttemptUsageCollectionSchema).pipe(
    Schema.fromKey("usage-data"),
  ),
  timing: Schema.propertySignature(AttemptTimingCollectionV1Schema).pipe(
    Schema.fromKey("timing-data"),
  ),
  diagnostics: Schema.propertySignature(AttemptDiagnosticsCollectionSchema).pipe(
    Schema.fromKey("diagnostics-data"),
  ),
});

/** Exact Run owner payload for the same fixed Observability family. */
export const RunObservabilityAttachmentSchema = Schema.Struct({
  owner: Schema.propertySignature(Schema.Literal("run")).pipe(
    Schema.fromKey("owner-kind"),
  ),
  timing: Schema.propertySignature(RunTimingCollectionSchema).pipe(
    Schema.fromKey("timing-data"),
  ),
  diagnostics: Schema.propertySignature(RunDiagnosticsCollectionSchema).pipe(
    Schema.fromKey("diagnostics-data"),
  ),
});

export type AttemptObservabilityAttachment = Schema.Schema.Type<
  typeof AttemptObservabilityAttachmentSchema
>;
export type RunObservabilityAttachment = Schema.Schema.Type<
  typeof RunObservabilityAttachmentSchema
>;
export type ObservabilityAttachment =
  | AttemptObservabilityAttachment
  | RunObservabilityAttachment;

function commandStreamBlobRefs(stream: Schema.Schema.Type<typeof CommandStreamSchema>): readonly RecordBlobRef[] {
  return stream.storage.kind === "blob" ? [stream.storage.ref] : [];
}

/** Complete closure projection for `niceeval.observability`. */
export function observabilityBlobRefs(
  payload: ObservabilityAttachment,
): readonly RecordBlobRef[] {
  if (!("commands" in payload)) return Object.freeze([]);
  return Object.freeze(
    payload.commands.commands.flatMap((command) => [
      ...commandStreamBlobRefs(command.result.stdout),
      ...commandStreamBlobRefs(command.result.stderr),
    ]),
  );
}

function commandStreamIntegrityIssues(
  stream: Schema.Schema.Type<typeof CommandStreamSchema>,
  blobs: ReadonlyMap<RecordBlobRef, Uint8Array>,
  path: readonly string[],
): readonly RecordAttachmentIssue[] {
  const bytes = stream.storage.kind === "inline"
    ? new TextEncoder().encode(stream.storage.text)
    : blobs.get(stream.storage.ref);
  if (bytes === undefined) {
    return Object.freeze([
      recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "storage"]),
    ]);
  }
  if (stream.storage.kind === "blob") {
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
        return Object.freeze([
          recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "storage"]),
        ]);
      }
    } catch {
      return Object.freeze([
        recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "storage"]),
      ]);
    }
  }
  if (bytes.byteLength !== stream.retainedBytes || stream.totalSafeUtf8Bytes < bytes.byteLength) {
    return Object.freeze([
      recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "retainedBytes"]),
    ]);
  }
  if (createHash("sha256").update(bytes).digest("hex") !== stream.sha256) {
    return Object.freeze([
      recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "sha256"]),
    ]);
  }
  return Object.freeze([]);
}

/** Own-closure checks shared by the writer seal and the reader materializer. */
export function observabilityAttachmentIntegrityIssues(
  payload: ObservabilityAttachment,
  blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[],
): readonly RecordAttachmentIssue[] {
  if (!("commands" in payload)) return Object.freeze([]);
  const bytesByRef = new Map<RecordBlobRef, Uint8Array>(
    blobs.map((blob) => [blob.ref, blob.bytes] as const),
  );
  const issues: RecordAttachmentIssue[] = [];
  for (const [index, command] of payload.commands.commands.entries()) {
    issues.push(...commandStreamIntegrityIssues(
      command.result.stdout,
      bytesByRef,
      ["commands", "commands", String(index), "result", "stdout"],
    ));
    issues.push(...commandStreamIntegrityIssues(
      command.result.stderr,
      bytesByRef,
      ["commands", "commands", String(index), "result", "stderr"],
    ));
  }
  return Object.freeze(issues);
}

/**
 * The Sources closure belongs to the origin Run, so this cross-family join is
 * deliberately performed by Host's common seal/read boundary rather than by
 * a family-local reader special case.
 */
export function observabilitySourceFrameIntegrityIssues(
  payload: ObservabilityAttachment,
  sources: SourcesAttachment,
): readonly RecordAttachmentIssue[] {
  const sourceById = new Map(sources.items.map((item) => [item.sourceItemId, item] as const));
  const diagnostics = payload.diagnostics.diagnostics;
  const issues: RecordAttachmentIssue[] = [];
  for (const [index, diagnostic] of diagnostics.entries()) {
    const frame = diagnostic.sourceFrame;
    if (frame === null) continue;
    const source = sourceById.get(frame.sourceItemId);
    if (source === undefined || source.sha256 !== frame.sha256) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["diagnostics", "diagnostics", String(index), "sourceFrame"]));
      continue;
    }
    const startsAfterEnd = frame.start.line > frame.end.line ||
      (frame.start.line === frame.end.line && frame.start.column > frame.end.column);
    if (startsAfterEnd) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["diagnostics", "diagnostics", String(index), "sourceFrame"]));
    }
  }
  return Object.freeze(issues);
}

const AttemptObservabilityBlobBudget = Object.freeze({
  maximumBlobs: 4_000,
  maximumBlobBytes: 16 * 1024 * 1024,
  maximumTotalBytes: 64 * 1024 * 1024,
});

const RunObservabilityBlobBudget = Object.freeze({
  maximumBlobs: 256,
  maximumBlobBytes: 16 * 1024 * 1024,
  maximumTotalBytes: 16 * 1024 * 1024,
});

/** One family declaration owns both Observability owner payloads. */
export const observabilityRecordAttachment = defineRecordAttachment({
  family: "niceeval.observability",
  current: {
    schemaVersion: 2,
    owners: {
      attempt: {
        schema: AttemptObservabilityAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: observabilityBlobRefs,
          budget: AttemptObservabilityBlobBudget,
          verify: observabilityAttachmentIntegrityIssues,
        },
      },
      run: {
        schema: RunObservabilityAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: observabilityBlobRefs,
          budget: RunObservabilityBlobBudget,
          verify: observabilityAttachmentIntegrityIssues,
        },
      },
    },
  },
  maintenance: () => import("./migrate/1-to-2.ts").then(
    ({ observabilityV1Maintenance }) => observabilityV1Maintenance,
  ),
  adjacentMigrationLinks: Object.freeze([
    Object.freeze({ fromSchemaVersion: 1, toSchemaVersion: 2, rewritePayload: false }),
  ]),
});
