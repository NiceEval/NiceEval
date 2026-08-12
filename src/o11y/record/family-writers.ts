import { Effect, Either, Schema, Stream } from "effect";
import {
  defineRecordAttachmentFamily,
  makeRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
  type RecordAttachmentBlobBuilder,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentFamily,
  type RecordAttachmentWrite,
  type RecordBlobRef,
} from "../../record/attachment/index.ts";
import { defineBuiltinJsonRecordAttachment } from "../../record/attachment/internal.ts";
import {
  CollectionV1Schema,
  CommandIdV1Schema,
  CommandsReferencesV1Schema,
  NonNegativeSafeIntegerV1Schema,
  ObservabilityExactParseOptions,
  SafeTextV1Schema,
} from "./codec.ts";
import {
  MAX_COMMAND_INLINE_STREAM_BYTES_V1,
  MAX_COMMAND_STREAM_BYTES_V1,
  MAX_COMMANDS_CLOSURE_BYTES_V1,
  MAX_COMMANDS_V1,
} from "./limits.ts";
import {
  compareObservabilityTextV1,
  limitationTargetV1,
  makeNonNegativeSafeIntegerV1,
  type CollectionV1,
} from "./model.ts";
import {
  AttemptDiagnosticsAttachmentV1Schema,
  AttemptTimingAttachmentV1Schema,
  CommandManifestV1Schema,
  CommandOutcomeV1Schema,
  CommandsAttachmentV1Schema,
  ConversationAttachmentV1Schema,
  RunDiagnosticsAttachmentV1Schema,
  RunTimingAttachmentV1Schema,
  UsageAttachmentV1Schema,
  makeAttemptCommandsAttachmentFamilyValidationV1,
  makeAttemptConversationAttachmentFamilyValidationV1,
  makeAttemptDiagnosticsAttachmentFamilyValidationV1,
  makeAttemptTimingAttachmentFamilyValidationV1,
  makeAttemptUsageAttachmentFamilyValidationV1,
  makeRunDiagnosticsAttachmentFamilyValidationV1,
  makeRunTimingAttachmentFamilyValidationV1,
  type AttemptDiagnosticsAttachmentV1,
  type AttemptTimingAttachmentV1,
  type CommandManifestV1,
  type CommandsAttachmentV1,
  type CommandStreamV1,
  type ConversationAttachmentV1,
  type RunDiagnosticsAttachmentV1,
  type RunTimingAttachmentV1,
  type UsageAttachmentV1,
} from "./families.ts";
import {
  validateObservabilityRecordContractV1,
  type ObservabilityFamilyValidationV1,
  type ObservabilityRecordContractValidationInputV1,
} from "./validation.ts";

export type ObservabilityAttachmentFamilyNameV1 =
  | "conversation"
  | "commands"
  | "usage"
  | "attempt-timing"
  | "attempt-diagnostics"
  | "run-timing"
  | "run-diagnostics";

export type ObservabilityAttachmentBuildErrorV1 = {
  readonly code: "observability-attachment-input-invalid";
  readonly family: ObservabilityAttachmentFamilyNameV1;
};

function attachmentInputInvalid(
  family: ObservabilityAttachmentFamilyNameV1,
): ObservabilityAttachmentBuildErrorV1 {
  return Object.freeze({
    code: "observability-attachment-input-invalid" as const,
    family,
  });
}

function requireAttachmentCapability<Result, Failure>(
  result: Either.Either<Result, Failure>,
  message: string,
): Result {
  if (Either.isLeft(result)) throw new Error(message);
  return result.right;
}

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

export function commandAttachmentBlobRefsV1(
  payload: CommandsAttachmentV1,
): readonly RecordBlobRef[] {
  const refs: RecordBlobRef[] = [];
  for (const command of payload.commands) {
    for (const stream of [command.result.stdout, command.result.stderr]) {
      if (stream.storage.kind === "blob") refs.push(stream.storage.ref);
    }
  }
  return freezeArray(refs);
}

function noObservabilityBlobRefs(): readonly RecordBlobRef[] {
  return Object.freeze([]);
}

export const attemptConversationAttachmentDefinitionV1 = requireAttachmentCapability(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: "niceeval.conversation",
    schemaId: "niceeval.conversation/v1",
    schema: ConversationAttachmentV1Schema,
    blobRefs: noObservabilityBlobRefs,
  }),
  "Attempt conversation v1 RecordAttachment definition must be valid",
);

export const attemptCommandsAttachmentDefinitionV1 = requireAttachmentCapability(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: "niceeval.commands",
    schemaId: "niceeval.commands/v1",
    schema: CommandsAttachmentV1Schema,
    blobRefs: commandAttachmentBlobRefsV1,
  }),
  "Attempt commands v1 RecordAttachment definition must be valid",
);

export const attemptUsageAttachmentDefinitionV1 = requireAttachmentCapability(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: "niceeval.usage",
    schemaId: "niceeval.usage/v1",
    schema: UsageAttachmentV1Schema,
    blobRefs: noObservabilityBlobRefs,
  }),
  "Attempt usage v1 RecordAttachment definition must be valid",
);

export const attemptTimingAttachmentDefinitionV1 = requireAttachmentCapability(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: "niceeval.timing",
    schemaId: "niceeval.timing/v1",
    schema: AttemptTimingAttachmentV1Schema,
    blobRefs: noObservabilityBlobRefs,
  }),
  "Attempt timing v1 RecordAttachment definition must be valid",
);

export const attemptDiagnosticsAttachmentDefinitionV1 = requireAttachmentCapability(
  defineBuiltinJsonRecordAttachment({
    owner: "attempt",
    name: "niceeval.diagnostics",
    schemaId: "niceeval.diagnostics/v1",
    schema: AttemptDiagnosticsAttachmentV1Schema,
    blobRefs: noObservabilityBlobRefs,
  }),
  "Attempt diagnostics v1 RecordAttachment definition must be valid",
);

export const runTimingAttachmentDefinitionV1 = requireAttachmentCapability(
  defineBuiltinJsonRecordAttachment({
    owner: "run",
    name: "niceeval.timing",
    schemaId: "niceeval.timing/v1",
    schema: RunTimingAttachmentV1Schema,
    blobRefs: noObservabilityBlobRefs,
  }),
  "Run timing v1 RecordAttachment definition must be valid",
);

export const runDiagnosticsAttachmentDefinitionV1 = requireAttachmentCapability(
  defineBuiltinJsonRecordAttachment({
    owner: "run",
    name: "niceeval.diagnostics",
    schemaId: "niceeval.diagnostics/v1",
    schema: RunDiagnosticsAttachmentV1Schema,
    blobRefs: noObservabilityBlobRefs,
  }),
  "Run diagnostics v1 RecordAttachment definition must be valid",
);

export const attemptConversationAttachmentV1 = requireAttachmentCapability(
  defineRecordAttachmentFamily({
    current: attemptConversationAttachmentDefinitionV1,
    migrations: [],
  }),
  "Attempt conversation v1 RecordAttachment family must be valid",
);

export const attemptCommandsAttachmentV1 = requireAttachmentCapability(
  defineRecordAttachmentFamily({
    current: attemptCommandsAttachmentDefinitionV1,
    migrations: [],
  }),
  "Attempt commands v1 RecordAttachment family must be valid",
);

export const attemptUsageAttachmentV1 = requireAttachmentCapability(
  defineRecordAttachmentFamily({
    current: attemptUsageAttachmentDefinitionV1,
    migrations: [],
  }),
  "Attempt usage v1 RecordAttachment family must be valid",
);

export const attemptTimingAttachmentV1 = requireAttachmentCapability(
  defineRecordAttachmentFamily({
    current: attemptTimingAttachmentDefinitionV1,
    migrations: [],
  }),
  "Attempt timing v1 RecordAttachment family must be valid",
);

export const attemptDiagnosticsAttachmentV1 = requireAttachmentCapability(
  defineRecordAttachmentFamily({
    current: attemptDiagnosticsAttachmentDefinitionV1,
    migrations: [],
  }),
  "Attempt diagnostics v1 RecordAttachment family must be valid",
);

export const runTimingAttachmentV1 = requireAttachmentCapability(
  defineRecordAttachmentFamily({
    current: runTimingAttachmentDefinitionV1,
    migrations: [],
  }),
  "Run timing v1 RecordAttachment family must be valid",
);

export const runDiagnosticsAttachmentV1 = requireAttachmentCapability(
  defineRecordAttachmentFamily({
    current: runDiagnosticsAttachmentDefinitionV1,
    migrations: [],
  }),
  "Run diagnostics v1 RecordAttachment family must be valid",
);

export const builtInObservabilityAttachmentFamiliesV1 = Object.freeze([
  attemptConversationAttachmentV1,
  attemptCommandsAttachmentV1,
  attemptUsageAttachmentV1,
  attemptTimingAttachmentV1,
  attemptDiagnosticsAttachmentV1,
  runTimingAttachmentV1,
  runDiagnosticsAttachmentV1,
] as const);

/**
 * All inputs are post-normalization capture facts. They have no provider
 * frames, filesystem handles, record paths, blob refs, EvalResult, or Runner
 * object. The commands form keeps text separate because this builder owns the
 * inline-vs-blob decision and closure stream.
 */
export type NormalizedConversationCaptureV1 = ConversationAttachmentV1;
export type NormalizedUsageCaptureV1 = UsageAttachmentV1;
export type NormalizedAttemptTimingCaptureV1 = AttemptTimingAttachmentV1;
export type NormalizedRunTimingCaptureV1 = RunTimingAttachmentV1;
export type NormalizedAttemptDiagnosticsCaptureV1 = AttemptDiagnosticsAttachmentV1;
export type NormalizedRunDiagnosticsCaptureV1 = RunDiagnosticsAttachmentV1;

export const NormalizedCommandStreamCaptureV1Schema = Schema.Struct({
  text: SafeTextV1Schema,
  totalSafeUtf8Bytes: NonNegativeSafeIntegerV1Schema,
});

const NormalizedCommandResultCaptureV1Schema = Schema.Struct({
  outcome: CommandOutcomeV1Schema,
  stdout: NormalizedCommandStreamCaptureV1Schema,
  stderr: NormalizedCommandStreamCaptureV1Schema,
});

const NormalizedCommandObservationCaptureV1Schema = Schema.Struct({
  commandId: CommandIdV1Schema,
  manifest: CommandManifestV1Schema,
  result: NormalizedCommandResultCaptureV1Schema,
  refs: CommandsReferencesV1Schema,
});

const NormalizedCommandsCaptureV1StructuralSchema = Schema.Struct({
  collection: CollectionV1Schema,
  commands: Schema.Array(NormalizedCommandObservationCaptureV1Schema),
});

export type NormalizedCommandStreamCaptureV1 = Schema.Schema.Type<
  typeof NormalizedCommandStreamCaptureV1Schema
>;
export type NormalizedCommandResultCaptureV1 = Schema.Schema.Type<
  typeof NormalizedCommandResultCaptureV1Schema
>;
export type NormalizedCommandObservationCaptureV1 = Schema.Schema.Type<
  typeof NormalizedCommandObservationCaptureV1Schema
>;

function retainedTextBytes(stream: NormalizedCommandStreamCaptureV1): number {
  return new TextEncoder().encode(stream.text).byteLength;
}

function isAllowedCommandsCollection(collection: CollectionV1): boolean {
  return collection.limitations.every((limitation) =>
    ["command-manifest", "command-stdout", "command-stderr"].some(
      (target) => limitationTargetV1(limitation) === target,
    ),
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

function isCanonicalNormalizedCommandStreamV1(
  stream: NormalizedCommandStreamCaptureV1,
  collection: CollectionV1,
  commandId: string,
  streamName: "stdout" | "stderr",
): boolean {
  const retainedBytes = retainedTextBytes(stream);
  return (
    retainedBytes <= MAX_COMMAND_STREAM_BYTES_V1 &&
    stream.totalSafeUtf8Bytes >= retainedBytes &&
    (stream.totalSafeUtf8Bytes === retainedBytes ||
      hasExactStreamTruncation(
        collection,
        commandId,
        streamName,
        retainedBytes,
        stream.totalSafeUtf8Bytes,
      ))
  );
}

function isCanonicalNormalizedCommandsCaptureV1(
  value: Schema.Schema.Type<typeof NormalizedCommandsCaptureV1StructuralSchema>,
): boolean {
  if (
    value.commands.length > MAX_COMMANDS_V1 ||
    !isAllowedCommandsCollection(value.collection)
  ) {
    return false;
  }
  let previousCommandId: string | undefined;
  let closureBytes = 0;
  for (const command of value.commands) {
    if (
      previousCommandId !== undefined &&
      compareObservabilityTextV1(previousCommandId, command.commandId) >= 0
    ) {
      return false;
    }
    previousCommandId = command.commandId;
    for (const [name, stream] of [
      ["stdout", command.result.stdout],
      ["stderr", command.result.stderr],
    ] as const) {
      if (
        !isCanonicalNormalizedCommandStreamV1(
          stream,
          value.collection,
          command.commandId,
          name,
        )
      ) {
        return false;
      }
      if (retainedTextBytes(stream) > MAX_COMMAND_INLINE_STREAM_BYTES_V1) {
        closureBytes += retainedTextBytes(stream);
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

export const NormalizedCommandsCaptureV1Schema =
  NormalizedCommandsCaptureV1StructuralSchema.pipe(
    Schema.filter(isCanonicalNormalizedCommandsCaptureV1, {
      identifier: "NormalizedObservabilityCommandsCaptureV1",
      description: "bounded normalized command capture facts",
    }),
  );

export type NormalizedCommandsCaptureV1 = Schema.Schema.Type<
  typeof NormalizedCommandsCaptureV1Schema
>;

const noObservabilityBlobDraftsV1: readonly RecordAttachmentBlobDraft<never, never>[] =
  Object.freeze([]);

function decodeNormalized<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded, never>,
  input: Value,
): Value | undefined {
  const decoded = Schema.decodeUnknownEither(schema, ObservabilityExactParseOptions)(input);
  return Either.isLeft(decoded) ? undefined : decoded.right;
}

function makeNoBlobObservabilityWriteV1<
  Owner extends "attempt" | "run",
  Payload,
  Encoded,
>(
  family: RecordAttachmentFamily<Owner, Payload>,
  schema: Schema.Schema<Payload, Encoded, never>,
  input: Payload,
  familyName: ObservabilityAttachmentFamilyNameV1,
): Either.Either<
  RecordAttachmentWrite<Owner, never, never>,
  ObservabilityAttachmentBuildErrorV1
> {
  const payload = decodeNormalized(schema, input);
  if (payload === undefined) return Either.left(attachmentInputInvalid(familyName));
  const write = makeRecordAttachmentWrite(family, () =>
    Object.freeze({ payload, blobs: noObservabilityBlobDraftsV1 }),
  );
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("A generated no-blob Observability RecordAttachment write was invalid");
  }
  return Either.right(write);
}

export function createAttemptConversationAttachmentWriteV1(
  input: NormalizedConversationCaptureV1,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  ObservabilityAttachmentBuildErrorV1
> {
  return makeNoBlobObservabilityWriteV1(
    attemptConversationAttachmentV1,
    ConversationAttachmentV1Schema,
    input,
    "conversation",
  );
}

export function createAttemptUsageAttachmentWriteV1(
  input: NormalizedUsageCaptureV1,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  ObservabilityAttachmentBuildErrorV1
> {
  return makeNoBlobObservabilityWriteV1(
    attemptUsageAttachmentV1,
    UsageAttachmentV1Schema,
    input,
    "usage",
  );
}

export function createAttemptTimingAttachmentWriteV1(
  input: NormalizedAttemptTimingCaptureV1,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  ObservabilityAttachmentBuildErrorV1
> {
  return makeNoBlobObservabilityWriteV1(
    attemptTimingAttachmentV1,
    AttemptTimingAttachmentV1Schema,
    input,
    "attempt-timing",
  );
}

export function createAttemptDiagnosticsAttachmentWriteV1(
  input: NormalizedAttemptDiagnosticsCaptureV1,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  ObservabilityAttachmentBuildErrorV1
> {
  return makeNoBlobObservabilityWriteV1(
    attemptDiagnosticsAttachmentV1,
    AttemptDiagnosticsAttachmentV1Schema,
    input,
    "attempt-diagnostics",
  );
}

export function createRunTimingAttachmentWriteV1(
  input: NormalizedRunTimingCaptureV1,
): Either.Either<
  RecordAttachmentWrite<"run", never, never>,
  ObservabilityAttachmentBuildErrorV1
> {
  return makeNoBlobObservabilityWriteV1(
    runTimingAttachmentV1,
    RunTimingAttachmentV1Schema,
    input,
    "run-timing",
  );
}

export function createRunDiagnosticsAttachmentWriteV1(
  input: NormalizedRunDiagnosticsCaptureV1,
): Either.Either<
  RecordAttachmentWrite<"run", never, never>,
  ObservabilityAttachmentBuildErrorV1
> {
  return makeNoBlobObservabilityWriteV1(
    runDiagnosticsAttachmentV1,
    RunDiagnosticsAttachmentV1Schema,
    input,
    "run-diagnostics",
  );
}

function commandStreamPayloadV1(
  stream: NormalizedCommandStreamCaptureV1,
  blobs: RecordAttachmentBlobBuilder,
  drafts: RecordAttachmentBlobDraft<never, never>[],
): CommandStreamV1 {
  const retainedBytes = makeNonNegativeSafeIntegerV1(retainedTextBytes(stream));
  if (retainedBytes === undefined) {
    throw new Error("A bounded command stream must have a safe retained byte length");
  }
  if (retainedBytes <= MAX_COMMAND_INLINE_STREAM_BYTES_V1) {
    return Object.freeze({
      storage: Object.freeze({ kind: "inline" as const, text: stream.text }),
      retainedBytes,
      totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
    });
  }
  const source = makeRecordBlobSource(
    Stream.fromEffect(Effect.sync(() => new TextEncoder().encode(stream.text))),
  );
  const draft = blobs.add(source);
  drafts.push(draft);
  return Object.freeze({
    storage: Object.freeze({ kind: "blob" as const, ref: draft.ref }),
    retainedBytes,
    totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
  });
}

export function createAttemptCommandsAttachmentWriteV1(
  input: NormalizedCommandsCaptureV1,
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  ObservabilityAttachmentBuildErrorV1
> {
  const normalized = decodeNormalized(NormalizedCommandsCaptureV1Schema, input);
  if (normalized === undefined) return Either.left(attachmentInputInvalid("commands"));
  const write = makeRecordAttachmentWrite(attemptCommandsAttachmentV1, (blobs) => {
    const drafts: RecordAttachmentBlobDraft<never, never>[] = [];
    const commands = normalized.commands.map((command) =>
      Object.freeze({
        commandId: command.commandId,
        manifest: command.manifest,
        result: Object.freeze({
          outcome: command.result.outcome,
          stdout: commandStreamPayloadV1(command.result.stdout, blobs, drafts),
          stderr: commandStreamPayloadV1(command.result.stderr, blobs, drafts),
        }),
        refs: command.refs,
      }),
    );
    const decoded = Schema.decodeUnknownEither(
      CommandsAttachmentV1Schema,
      ObservabilityExactParseOptions,
    )(
      Object.freeze({
        collection: normalized.collection,
        commands: Object.freeze(commands),
      }),
    );
    if (Either.isLeft(decoded)) {
      throw new Error("Normalized commands capture produced an invalid durable payload");
    }
    return Object.freeze({ payload: decoded.right, blobs: Object.freeze(drafts) });
  });
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("A generated commands Observability RecordAttachment closure was invalid");
  }
  return Either.right(write);
}

export interface NormalizedAttemptObservabilityCaptureV1 {
  readonly conversation: NormalizedConversationCaptureV1;
  readonly commands: NormalizedCommandsCaptureV1;
  readonly usage: NormalizedUsageCaptureV1;
  readonly timing: NormalizedAttemptTimingCaptureV1;
  readonly diagnostics: NormalizedAttemptDiagnosticsCaptureV1;
}

export interface NormalizedRunObservabilityCaptureV1 {
  readonly timing: NormalizedRunTimingCaptureV1;
  readonly diagnostics: NormalizedRunDiagnosticsCaptureV1;
}

export interface AttemptObservabilityAttachmentWritesV1 {
  readonly conversation: RecordAttachmentWrite<"attempt", never, never>;
  readonly commands: RecordAttachmentWrite<"attempt", never, never>;
  readonly usage: RecordAttachmentWrite<"attempt", never, never>;
  readonly timing: RecordAttachmentWrite<"attempt", never, never>;
  readonly diagnostics: RecordAttachmentWrite<"attempt", never, never>;
  readonly validations: readonly ObservabilityFamilyValidationV1<"attempt">[];
}

export interface RunObservabilityAttachmentWritesV1 {
  readonly timing: RecordAttachmentWrite<"run", never, never>;
  readonly diagnostics: RecordAttachmentWrite<"run", never, never>;
  readonly validations: readonly ObservabilityFamilyValidationV1<"run">[];
}

export function createAttemptObservabilityAttachmentWritesV1(
  input: NormalizedAttemptObservabilityCaptureV1,
): Either.Either<
  AttemptObservabilityAttachmentWritesV1,
  ObservabilityAttachmentBuildErrorV1
> {
  const conversation = createAttemptConversationAttachmentWriteV1(input.conversation);
  if (Either.isLeft(conversation)) return Either.left(conversation.left);
  const commands = createAttemptCommandsAttachmentWriteV1(input.commands);
  if (Either.isLeft(commands)) return Either.left(commands.left);
  const usage = createAttemptUsageAttachmentWriteV1(input.usage);
  if (Either.isLeft(usage)) return Either.left(usage.left);
  const timing = createAttemptTimingAttachmentWriteV1(input.timing);
  if (Either.isLeft(timing)) return Either.left(timing.left);
  const diagnostics = createAttemptDiagnosticsAttachmentWriteV1(input.diagnostics);
  if (Either.isLeft(diagnostics)) return Either.left(diagnostics.left);
  return Either.right(
    Object.freeze({
      conversation: conversation.right,
      commands: commands.right,
      usage: usage.right,
      timing: timing.right,
      diagnostics: diagnostics.right,
      validations: Object.freeze([
        makeAttemptConversationAttachmentFamilyValidationV1(input.conversation),
        makeAttemptCommandsAttachmentFamilyValidationV1(input.commands),
        makeAttemptUsageAttachmentFamilyValidationV1(input.usage),
        makeAttemptTimingAttachmentFamilyValidationV1(input.timing),
        makeAttemptDiagnosticsAttachmentFamilyValidationV1(input.diagnostics),
      ]),
    }),
  );
}

export function createRunObservabilityAttachmentWritesV1(
  input: NormalizedRunObservabilityCaptureV1,
): Either.Either<
  RunObservabilityAttachmentWritesV1,
  ObservabilityAttachmentBuildErrorV1
> {
  const timing = createRunTimingAttachmentWriteV1(input.timing);
  if (Either.isLeft(timing)) return Either.left(timing.left);
  const diagnostics = createRunDiagnosticsAttachmentWriteV1(input.diagnostics);
  if (Either.isLeft(diagnostics)) return Either.left(diagnostics.left);
  return Either.right(
    Object.freeze({
      timing: timing.right,
      diagnostics: diagnostics.right,
      validations: Object.freeze([
        makeRunTimingAttachmentFamilyValidationV1(input.timing),
        makeRunDiagnosticsAttachmentFamilyValidationV1(input.diagnostics),
      ]),
    }),
  );
}

/**
 * Joint validation is intentionally separate from individual writes: an
 * otherwise valid owner-local Attachment is never invalidated just because a
 * sibling family is absent or corrupt. The coordinator calls this after all
 * owner-local builders have frozen their values and before generic writing.
 */
export function validateObservabilityAttachmentWriteBundlesV1(input: {
  readonly run: RunObservabilityAttachmentWritesV1;
  readonly attempts: readonly AttemptObservabilityAttachmentWritesV1[];
}): ReturnType<typeof validateObservabilityRecordContractV1> {
  const contractInput: ObservabilityRecordContractValidationInputV1 = {
    run: { families: input.run.validations },
    attempts: input.attempts.map((attempt) => ({ families: attempt.validations })),
  };
  return validateObservabilityRecordContractV1(contractInput);
}
