import { createHash } from "node:crypto";

import { Effect, Either, Schema, Stream } from "effect";
import {
  makeFixedRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
  type RecordAttachmentBlobBuilder,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { recordAttachmentWriteContents } from "../../record/attachment/internal.ts";
import { RecordExactParseOptions } from "../../record/codec/core.ts";
import {
  attemptObservabilityRecordFamily,
  runObservabilityRecordFamily,
} from "../../record/family/catalog.ts";
import {
  AttemptObservabilityAttachmentSchema,
  RunObservabilityAttachmentSchema,
} from "../../record/family/observability/definition.ts";
import {
  MAX_COMMAND_INLINE_STREAM_BYTES,
} from "./limits.ts";
import {
  limitationTarget,
  type CollectionTarget,
  type Collection,
  type ObservabilityLimitation,
} from "./model.ts";
import type {
  AttemptDiagnostic,
  AttemptDiagnosticsAttachment,
  AttemptTimingAttachment,
  CommandManifest,
  CommandOutcomeSchema,
  ConversationAttachment,
  ConversationItem,
  RunDiagnostic,
  RunDiagnosticsAttachment,
  RunTimingAttachment,
  UsageAttachment,
} from "./families.ts";
import {
  observabilityOwnerOrSchemaInvalidError,
  type ObservabilityRecordContractError,
} from "./errors.ts";

type CommandOutcome = Schema.Schema.Type<typeof CommandOutcomeSchema>;

/**
 * The old component shapes are capture-only intermediate data. Sealing always
 * produces one owner-local `niceeval.observability` closure.
 */
export type NormalizedConversationCapture = ConversationAttachment;
export type NormalizedUsageCapture = UsageAttachment;
export type NormalizedAttemptTimingCapture = AttemptTimingAttachment;
export type NormalizedRunTimingCapture = RunTimingAttachment;
export type NormalizedAttemptDiagnosticsCapture = AttemptDiagnosticsAttachment;
export type NormalizedRunDiagnosticsCapture = RunDiagnosticsAttachment;

export interface NormalizedCommandStreamCapture {
  readonly text: string;
  readonly totalSafeUtf8Bytes: number;
}
export interface NormalizedCommandObservationCapture {
  readonly commandId: string;
  readonly manifest: CommandManifest;
  readonly result: {
    readonly outcome: CommandOutcome;
    readonly stdout: NormalizedCommandStreamCapture;
    readonly stderr: NormalizedCommandStreamCapture;
  };
  readonly refs: readonly unknown[];
}
export interface NormalizedCommandsCapture {
  readonly collection: Collection;
  readonly commands: readonly NormalizedCommandObservationCapture[];
}

export interface NormalizedAttemptObservabilityCapture {
  readonly conversation: NormalizedConversationCapture;
  readonly commands: NormalizedCommandsCapture;
  readonly usage: NormalizedUsageCapture;
  readonly timing: NormalizedAttemptTimingCapture;
  readonly diagnostics: NormalizedAttemptDiagnosticsCapture;
}
export interface NormalizedRunObservabilityCapture {
  readonly timing: NormalizedRunTimingCapture;
  readonly diagnostics: NormalizedRunDiagnosticsCapture;
}

export type ObservabilityAttachmentBuildError = {
  readonly code: "observability-attachment-input-invalid";
  readonly family: "observability";
};
function invalid(): ObservabilityAttachmentBuildError {
  return Object.freeze({ code: "observability-attachment-input-invalid" as const, family: "observability" as const });
}

type FixedTarget = "conversation" | "command" | "usage" | "timing" | "diagnostic";
function fixedTarget(target: CollectionTarget): FixedTarget {
  switch (target) {
    case "conversation-item":
    case "conversation-text": return "conversation";
    case "command-manifest":
    case "command-stdout":
    case "command-stderr": return "command";
    case "usage-observation": return "usage";
    case "timing-interval": return "timing";
    case "diagnostic": return "diagnostic";
  }
}

function fixedLimitation(limitation: ObservabilityLimitation): unknown {
  const target = fixedTarget(limitationTarget(limitation));
  switch (limitation.code) {
    case "capture-failed":
    case "capture-interrupted":
      return Object.freeze({ code: limitation.code, stage: limitation.stage, target });
    case "collection-cap-reached":
    case "unsupported-input":
      return Object.freeze({ code: limitation.code, target, omittedAtLeast: limitation.omittedAtLeast });
    case "text-truncated":
      return Object.freeze({ code: "text-truncated" as const, target, replacementOrOmittedCount: limitation.omittedBytes });
    case "redacted":
      return Object.freeze({ code: "redacted" as const, target, replacementOrOmittedCount: limitation.replacementCount });
    case "stream-truncated":
      return Object.freeze({
        code: "stream-truncated" as const,
        commandId: limitation.commandId,
        stream: limitation.stream,
        retainedBytes: limitation.retainedBytes,
        omittedBytes: limitation.omittedBytes,
      });
    case "invalid-utf8-replaced":
      return Object.freeze({ code: "invalid-utf8-replaced" as const, commandId: limitation.commandId, stream: limitation.stream, count: limitation.replacementCount });
    case "unsafe-control-stripped":
      return Object.freeze({ code: "unsafe-control-stripped" as const, commandId: limitation.commandId, stream: limitation.stream, count: limitation.strippedCount });
  }
}

function fixedCollection(collection: Collection): unknown {
  return Object.freeze({
    state: collection.state,
    limitations: Object.freeze(collection.limitations.map(fixedLimitation)),
  });
}

function fixedConversationItem(item: ConversationItem): unknown {
  const base = { itemId: item.itemId, turnId: item.turnId, sequence: item.sequence };
  switch (item.kind) {
    case "message": return Object.freeze({ ...base, kind: item.kind, role: item.role, text: item.text });
    case "tool-call": return Object.freeze({ ...base, kind: item.kind, callId: item.callId, tool: item.tool, inputSummary: item.inputSummary });
    case "tool-result": return Object.freeze({ ...base, kind: item.kind, callId: item.callId, outcome: item.outcome, outputSummary: item.outputSummary });
    case "thinking-summary": return Object.freeze({ ...base, kind: item.kind, summary: item.summary });
    case "subagent": return Object.freeze({ ...base, kind: item.kind, state: item.state, label: item.label, summary: item.summary });
    case "input-request": return Object.freeze({ ...base, kind: item.kind, state: item.state, promptSummary: item.promptSummary, responseSummary: item.responseSummary });
    case "skill-load": return Object.freeze({ ...base, kind: item.kind, code: item.skill, summary: item.outcome });
    case "context-injection": return Object.freeze({ ...base, kind: item.kind, summary: item.summary });
    case "compaction": return Object.freeze({ ...base, kind: item.kind, summary: item.summary });
    case "conversation-error": return Object.freeze({ ...base, kind: item.kind, code: item.code, summary: item.summary });
  }
}

function commandStream(
  stream: NormalizedCommandStreamCapture,
  blobs: RecordAttachmentBlobBuilder,
  drafts: RecordAttachmentBlobDraft<never, never>[],
): unknown {
  const bytes = new TextEncoder().encode(stream.text);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength <= MAX_COMMAND_INLINE_STREAM_BYTES) {
    return Object.freeze({
      storage: Object.freeze({ kind: "inline" as const, text: stream.text }),
      retainedBytes: bytes.byteLength,
      totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
      sha256,
    });
  }
  const draft = blobs.add(makeRecordBlobSource(Stream.fromEffect(Effect.sync(() => bytes))));
  drafts.push(draft);
  return Object.freeze({
    storage: Object.freeze({ kind: "blob" as const, ref: draft.ref }),
    retainedBytes: bytes.byteLength,
    totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
    sha256,
  });
}

function fixedRedaction(redaction: AttemptDiagnostic["redaction"]): unknown {
  if (redaction.state === "none") return Object.freeze({ state: "none" as const });
  return Object.freeze({
    state: "applied" as const,
    replacements: redaction.summaryReplacements + redaction.causeReplacements + redaction.contextReplacements,
  });
}
function fixedAttemptDiagnostic(diagnostic: AttemptDiagnostic): unknown {
  return Object.freeze({
    diagnosticId: diagnostic.diagnosticId,
    kind: diagnostic.kind,
    code: diagnostic.code,
    phase: diagnostic.phase === "collection" ? "attempt.teardown" : diagnostic.phase,
    summary: diagnostic.summary,
    causes: Object.freeze(diagnostic.causes.map((cause) => Object.freeze({ code: cause.code, summary: cause.summary }))),
    redaction: fixedRedaction(diagnostic.redaction),
    sourceFrame: diagnostic.sourceFrame,
  });
}
function fixedRunDiagnostic(diagnostic: RunDiagnostic): unknown {
  return Object.freeze({
    diagnosticId: diagnostic.diagnosticId,
    kind: diagnostic.kind,
    code: diagnostic.code,
    phase: diagnostic.phase === "collection" ? "run.teardown" : diagnostic.phase,
    summary: diagnostic.summary,
    causes: Object.freeze(diagnostic.causes.map((cause) => Object.freeze({ code: cause.code, summary: cause.summary }))),
    redaction: fixedRedaction(diagnostic.redaction),
    sourceFrame: diagnostic.sourceFrame,
  });
}

function decodeAttempt(value: unknown): Either.Either<Schema.Schema.Type<typeof AttemptObservabilityAttachmentSchema>, ObservabilityAttachmentBuildError> {
  const decoded = Schema.validateEither(AttemptObservabilityAttachmentSchema, RecordExactParseOptions)(value);
  return Either.isLeft(decoded) ? Either.left(invalid()) : Either.right(decoded.right);
}
function decodeRun(value: unknown): Either.Either<Schema.Schema.Type<typeof RunObservabilityAttachmentSchema>, ObservabilityAttachmentBuildError> {
  const decoded = Schema.validateEither(RunObservabilityAttachmentSchema, RecordExactParseOptions)(value);
  return Either.isLeft(decoded) ? Either.left(invalid()) : Either.right(decoded.right);
}

/** Builds exactly one fixed Attempt Observability write, including command blobs. */
export function createAttemptObservabilityAttachmentWrite(
  input: NormalizedAttemptObservabilityCapture,
): Either.Either<RecordAttachmentWrite<"attempt", never, never>, ObservabilityAttachmentBuildError> {
  const preflight = decodeAttempt(Object.freeze({
    owner: "attempt" as const,
    conversation: Object.freeze({
      collection: fixedCollection(input.conversation.collection),
      turns: Object.freeze(input.conversation.turns.map((turn) => Object.freeze({ turnId: turn.turnId, sequence: turn.sequence, outcome: turn.outcome }))),
      items: Object.freeze(input.conversation.items.map(fixedConversationItem)),
    }),
    commands: Object.freeze({ collection: fixedCollection(input.commands.collection), commands: Object.freeze([]) }),
    usage: Object.freeze({ collection: fixedCollection(input.usage.collection), observations: Object.freeze(input.usage.observations.map(({ refs: _refs, ...value }) => Object.freeze(value))) }),
    timing: Object.freeze({ collection: fixedCollection(input.timing.collection), intervals: Object.freeze(input.timing.intervals.map(({ refs: _refs, ...value }) => Object.freeze(value))) }),
    diagnostics: Object.freeze({ collection: fixedCollection(input.diagnostics.collection), diagnostics: Object.freeze(input.diagnostics.diagnostics.map(fixedAttemptDiagnostic)) }),
  }));
  // Empty commands can be decoded eagerly. Non-empty commands are checked in
  // the write builder after its owner-local blob refs have been minted.
  if (input.commands.commands.length === 0 && Either.isLeft(preflight)) return Either.left(preflight.left);

  const write = makeFixedRecordAttachmentWrite(attemptObservabilityRecordFamily.write, (blobs) => {
    const drafts: RecordAttachmentBlobDraft<never, never>[] = [];
    const candidate = Object.freeze({
      owner: "attempt" as const,
      conversation: Object.freeze({
        collection: fixedCollection(input.conversation.collection),
        turns: Object.freeze(input.conversation.turns.map((turn) => Object.freeze({ turnId: turn.turnId, sequence: turn.sequence, outcome: turn.outcome }))),
        items: Object.freeze(input.conversation.items.map(fixedConversationItem)),
      }),
      commands: Object.freeze({
        collection: fixedCollection(input.commands.collection),
        commands: Object.freeze(input.commands.commands.map((command) => Object.freeze({
          commandId: command.commandId,
          manifest: command.manifest,
          result: Object.freeze({
            outcome: command.result.outcome,
            stdout: commandStream(command.result.stdout, blobs, drafts),
            stderr: commandStream(command.result.stderr, blobs, drafts),
          }),
        }))),
      }),
      usage: Object.freeze({ collection: fixedCollection(input.usage.collection), observations: Object.freeze(input.usage.observations.map(({ refs: _refs, ...value }) => Object.freeze(value))) }),
      timing: Object.freeze({ collection: fixedCollection(input.timing.collection), intervals: Object.freeze(input.timing.intervals.map(({ refs: _refs, ...value }) => Object.freeze(value))) }),
      diagnostics: Object.freeze({ collection: fixedCollection(input.diagnostics.collection), diagnostics: Object.freeze(input.diagnostics.diagnostics.map(fixedAttemptDiagnostic)) }),
    });
    const decoded = decodeAttempt(candidate);
    if (Either.isLeft(decoded)) throw new Error("Observability capture does not satisfy the fixed v1 payload");
    return Object.freeze({ payload: decoded.right, blobs: Object.freeze(drafts) });
  });
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) throw new Error("Fixed Observability write closure was invalid");
  return Either.right(write);
}

/** Builds the fixed Run Observability payload (timing and diagnostics only). */
export function createRunObservabilityAttachmentWrite(
  input: NormalizedRunObservabilityCapture,
): Either.Either<RecordAttachmentWrite<"run", never, never>, ObservabilityAttachmentBuildError> {
  const candidate = Object.freeze({
    owner: "run" as const,
    timing: Object.freeze({ collection: fixedCollection(input.timing.collection), intervals: Object.freeze(input.timing.intervals.map(({ refs: _refs, ...value }) => Object.freeze(value))) }),
    diagnostics: Object.freeze({ collection: fixedCollection(input.diagnostics.collection), diagnostics: Object.freeze(input.diagnostics.diagnostics.map(fixedRunDiagnostic)) }),
  });
  const decoded = decodeRun(candidate);
  if (Either.isLeft(decoded)) return Either.left(decoded.left);
  const write = makeFixedRecordAttachmentWrite(runObservabilityRecordFamily.write, () => Object.freeze({ payload: decoded.right, blobs: Object.freeze([]) }));
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) throw new Error("Fixed Run Observability write closure was invalid");
  return Either.right(write);
}

export interface AttemptObservabilityAttachmentWrites {
  readonly write: RecordAttachmentWrite<"attempt", never, never>;
}
export interface RunObservabilityAttachmentWrites {
  readonly write: RecordAttachmentWrite<"run", never, never>;
}

/** Legacy plural names now deliberately return a one-write fixed bundle. */
export function createAttemptObservabilityAttachmentWrites(input: NormalizedAttemptObservabilityCapture): Either.Either<AttemptObservabilityAttachmentWrites, ObservabilityAttachmentBuildError> {
  const write = createAttemptObservabilityAttachmentWrite(input);
  return Either.isLeft(write)
    ? Either.left(write.left)
    : Either.right(Object.freeze({ write: write.right }));
}
export function createRunObservabilityAttachmentWrites(input: NormalizedRunObservabilityCapture): Either.Either<RunObservabilityAttachmentWrites, ObservabilityAttachmentBuildError> {
  const write = createRunObservabilityAttachmentWrite(input);
  return Either.isLeft(write)
    ? Either.left(write.left)
    : Either.right(Object.freeze({ write: write.right }));
}

/** Boundary check used by Runner before passing bundles to the fixed collector. */
export function validateObservabilityAttachmentWriteBundles(input: {
  readonly run: RunObservabilityAttachmentWrites;
  readonly attempts: readonly AttemptObservabilityAttachmentWrites[];
}): readonly ObservabilityRecordContractError[] {
  const errors: ObservabilityRecordContractError[] = [];
  const run = recordAttachmentWriteContents(input.run.write);
  if (Either.isLeft(run) || run.right.fixed !== runObservabilityRecordFamily.write) {
    errors.push(observabilityOwnerOrSchemaInvalidError("run", "niceeval.observability"));
  }
  for (const attempt of input.attempts) {
    const captured = recordAttachmentWriteContents(attempt.write);
    if (Either.isLeft(captured) || captured.right.fixed !== attemptObservabilityRecordFamily.write) {
      errors.push(observabilityOwnerOrSchemaInvalidError("attempt", "niceeval.observability"));
    }
  }
  return Object.freeze(errors);
}

/** Fixed owner primitives; no caller can define or register a new family. */
export const attemptObservabilityAttachmentWrite = attemptObservabilityRecordFamily.write;
export const runObservabilityAttachmentWrite = runObservabilityRecordFamily.write;
