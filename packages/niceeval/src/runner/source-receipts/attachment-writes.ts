import { createHash } from "node:crypto";

import { Effect, Either, Schema, Stream } from "effect";

import {
  makeRecordAttachmentBlobDrafts,
  RecordContent,
  type RecordAttachmentBlobBuilder,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { RecordExactParseOptions } from "../../record/codec/core.ts";
import { Sha256DigestSchema } from "../../record/codec/identifiers.ts";
import {
  agentTurnsRecordAttachment,
  AgentTurnsAttachmentSchema,
} from "../../record/family/agent-turns/definition.ts";
import {
  attemptRunnerActivitiesRecordAttachment,
  runRunnerActivitiesRecordAttachment,
  AttemptRunnerActivitiesAttachmentSchema,
  RunRunnerActivitiesAttachmentSchema,
} from "../../record/family/runner-activities/definition.ts";
import {
  attemptRunnerDiagnosticsRecordAttachment,
  runRunnerDiagnosticsRecordAttachment,
  AttemptRunnerDiagnosticsAttachmentSchema,
  RunRunnerDiagnosticsAttachmentSchema,
} from "../../record/family/runner-diagnostics/definition.ts";
import {
  sandboxCommandsRecordAttachment,
  SandboxCommandsAttachmentSchema,
  type SandboxCommandsAttachment,
} from "../../record/family/sandbox-commands/definition.ts";
import { MAX_COMMAND_INLINE_STREAM_BYTES } from "../../record/family/source-receipt/limits.ts";
import type {
  RunnerAttemptSourceReceiptsCapture,
  RunnerRunSourceReceiptsCapture,
  StagedCommandStream,
} from "./types.ts";

export type SourceReceiptAttachmentBuildError = {
  readonly code: "source-receipt-attachment-input-invalid";
  readonly family:
    | "agent-turns"
    | "sandbox-commands"
    | "runner-activities"
    | "runner-diagnostics";
};

function invalid(
  family: SourceReceiptAttachmentBuildError["family"],
): SourceReceiptAttachmentBuildError {
  return Object.freeze({
    code: "source-receipt-attachment-input-invalid" as const,
    family,
  });
}

function decode<Value, Encoded>(
  schema: Schema.Schema<Value, Encoded, never>,
  value: unknown,
  family: SourceReceiptAttachmentBuildError["family"],
): Either.Either<Value, SourceReceiptAttachmentBuildError> {
  const decoded = Schema.validateEither(schema, RecordExactParseOptions)(value);
  return Either.isLeft(decoded) ? Either.left(invalid(family)) : Either.right(decoded.right);
}

function commandStream(
  stream: StagedCommandStream,
  blobs: RecordAttachmentBlobBuilder,
  drafts: RecordAttachmentBlobDraft<never, never>[],
): SandboxCommandsAttachment["segments"][number]["stdout"] {
  const bytes = new TextEncoder().encode(stream.text);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== stream.retainedBytes || digest !== stream.sha256) {
    throw new Error("Staged Sandbox Command stream closure was invalid");
  }
  const decodedDigest = Schema.decodeUnknownEither(Sha256DigestSchema)(stream.sha256);
  if (Either.isLeft(decodedDigest)) {
    throw new Error("Staged Sandbox Command stream digest was invalid");
  }
  if (bytes.byteLength <= MAX_COMMAND_INLINE_STREAM_BYTES) {
    return Object.freeze({
      storage: Object.freeze({ kind: "inline" as const, text: stream.text }),
      retainedBytes: stream.retainedBytes,
      totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
      sha256: decodedDigest.right,
    });
  }
  const draft = blobs.add(RecordContent.stream(Stream.fromEffect(Effect.sync(() => bytes))));
  drafts.push(draft);
  return Object.freeze({
    storage: Object.freeze({ kind: "blob" as const, ref: draft.content }),
    retainedBytes: stream.retainedBytes,
    totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
    sha256: decodedDigest.right,
  });
}

export interface AttemptSourceReceiptAttachmentWrites {
  readonly agentTurns?: RecordAttachmentWrite<
    "attempt",
    never,
    never,
    "niceeval.agent-turns",
    1
  >;
  readonly sandboxCommands?: RecordAttachmentWrite<
    "attempt",
    never,
    never,
    "niceeval.sandbox-commands",
    1
  >;
  readonly runnerActivities: RecordAttachmentWrite<
    "attempt",
    never,
    never,
    "niceeval.runner-activities",
    1
  >;
  readonly runnerDiagnostics: RecordAttachmentWrite<
    "attempt",
    never,
    never,
    "niceeval.runner-diagnostics",
    1
  >;
}

export interface RunSourceReceiptAttachmentWrites {
  readonly runnerActivities?: RecordAttachmentWrite<
    "run",
    never,
    never,
    "niceeval.runner-activities",
    1
  >;
  readonly runnerDiagnostics?: RecordAttachmentWrite<
    "run",
    never,
    never,
    "niceeval.runner-diagnostics",
    1
  >;
}

export function createAttemptSourceReceiptAttachmentWrites(
  input: RunnerAttemptSourceReceiptsCapture,
): Either.Either<AttemptSourceReceiptAttachmentWrites, SourceReceiptAttachmentBuildError> {
  const agentTurns = input.agentTurns === undefined
    ? undefined
    : decode(AgentTurnsAttachmentSchema, input.agentTurns, "agent-turns");
  if (agentTurns !== undefined && Either.isLeft(agentTurns)) return Either.left(agentTurns.left);

  const activities = decode(
    AttemptRunnerActivitiesAttachmentSchema,
    input.runnerActivities,
    "runner-activities",
  );
  if (Either.isLeft(activities)) return Either.left(activities.left);
  const diagnostics = decode(
    AttemptRunnerDiagnosticsAttachmentSchema,
    input.runnerDiagnostics,
    "runner-diagnostics",
  );
  if (Either.isLeft(diagnostics)) return Either.left(diagnostics.left);

  let sandboxPayload: SandboxCommandsAttachment | undefined;
  const sandboxDrafts = input.sandboxCommands === undefined
    ? undefined
    : makeRecordAttachmentBlobDrafts((blobs) => {
        const drafts: RecordAttachmentBlobDraft<never, never>[] = [];
        const candidate = Object.freeze({
          collection: input.sandboxCommands!.collection,
          segments: Object.freeze(input.sandboxCommands!.segments.map((segment) => Object.freeze({
            ...segment,
            stdout: commandStream(segment.stdout, blobs, drafts),
            stderr: commandStream(segment.stderr, blobs, drafts),
          }))),
        });
        const decoded = decode(SandboxCommandsAttachmentSchema, candidate, "sandbox-commands");
        if (Either.isLeft(decoded)) {
          throw new Error("Sandbox Command capture violated its source schema");
        }
        sandboxPayload = decoded.right;
        return Object.freeze(drafts);
      });
  const sandboxCommands = sandboxDrafts === undefined || sandboxPayload === undefined
    ? undefined
    : sandboxCommandsRecordAttachment.prepare(sandboxPayload, sandboxDrafts);
  if (sandboxCommands !== undefined && Either.isLeft(sandboxCommands)) {
    return Either.left(invalid("sandbox-commands"));
  }

  const preparedAgentTurns = agentTurns === undefined
    ? undefined
    : agentTurnsRecordAttachment.prepare(agentTurns.right, Object.freeze([]));
  if (preparedAgentTurns !== undefined && Either.isLeft(preparedAgentTurns)) {
    return Either.left(invalid("agent-turns"));
  }
  const preparedActivities = attemptRunnerActivitiesRecordAttachment.prepare(
    activities.right,
    Object.freeze([]),
  );
  if (Either.isLeft(preparedActivities)) return Either.left(invalid("runner-activities"));
  const preparedDiagnostics = attemptRunnerDiagnosticsRecordAttachment.prepare(
    diagnostics.right,
    Object.freeze([]),
  );
  if (Either.isLeft(preparedDiagnostics)) return Either.left(invalid("runner-diagnostics"));

  return Either.right(Object.freeze({
    ...(preparedAgentTurns === undefined ? {} : {
      agentTurns: preparedAgentTurns.right,
    }),
    ...(sandboxCommands === undefined ? {} : { sandboxCommands: sandboxCommands.right }),
    runnerActivities: preparedActivities.right,
    runnerDiagnostics: preparedDiagnostics.right,
  }));
}

export function createRunSourceReceiptAttachmentWrites(
  input: RunnerRunSourceReceiptsCapture,
): Either.Either<RunSourceReceiptAttachmentWrites, SourceReceiptAttachmentBuildError> {
  const activities = input.runnerActivities === undefined
    ? undefined
    : decode(RunRunnerActivitiesAttachmentSchema, input.runnerActivities, "runner-activities");
  if (activities !== undefined && Either.isLeft(activities)) return Either.left(activities.left);
  const diagnostics = input.runnerDiagnostics === undefined
    ? undefined
    : decode(RunRunnerDiagnosticsAttachmentSchema, input.runnerDiagnostics, "runner-diagnostics");
  if (diagnostics !== undefined && Either.isLeft(diagnostics)) return Either.left(diagnostics.left);

  const preparedActivities = activities === undefined
    ? undefined
    : runRunnerActivitiesRecordAttachment.prepare(activities.right, Object.freeze([]));
  if (preparedActivities !== undefined && Either.isLeft(preparedActivities)) {
    return Either.left(invalid("runner-activities"));
  }
  const preparedDiagnostics = diagnostics === undefined
    ? undefined
    : runRunnerDiagnosticsRecordAttachment.prepare(diagnostics.right, Object.freeze([]));
  if (preparedDiagnostics !== undefined && Either.isLeft(preparedDiagnostics)) {
    return Either.left(invalid("runner-diagnostics"));
  }

  return Either.right(Object.freeze({
    ...(preparedActivities === undefined ? {} : {
      runnerActivities: preparedActivities.right,
    }),
    ...(preparedDiagnostics === undefined ? {} : {
      runnerDiagnostics: preparedDiagnostics.right,
    }),
  }));
}
