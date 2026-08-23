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
import { RecordExactParseOptions } from "../../record/codec/core.ts";
import { Sha256DigestSchema } from "../../record/codec/identifiers.ts";
import {
  agentTurnsRecordFamily,
  attemptRunnerActivitiesRecordFamily,
  attemptRunnerDiagnosticsRecordFamily,
  runRunnerActivitiesRecordFamily,
  runRunnerDiagnosticsRecordFamily,
  sandboxCommandsRecordFamily,
} from "../../record/family/catalog.ts";
import {
  AgentTurnsAttachmentSchema,
  type AgentTurnsAttachment,
} from "../../record/family/agent-turns/definition.ts";
import {
  AttemptRunnerActivitiesAttachmentSchema,
  RunRunnerActivitiesAttachmentSchema,
  type AttemptRunnerActivitiesAttachment,
  type RunRunnerActivitiesAttachment,
} from "../../record/family/runner-activities/definition.ts";
import {
  AttemptRunnerDiagnosticsAttachmentSchema,
  RunRunnerDiagnosticsAttachmentSchema,
  type AttemptRunnerDiagnosticsAttachment,
  type RunRunnerDiagnosticsAttachment,
} from "../../record/family/runner-diagnostics/definition.ts";
import {
  SandboxCommandsAttachmentSchema,
  type SandboxCommandsAttachment,
} from "../../record/family/sandbox-commands/definition.ts";
import { MAX_COMMAND_INLINE_STREAM_BYTES } from "./limits.ts";
import type {
  RunnerAttemptSourceReceiptsCapture,
  RunnerRunSourceReceiptsCapture,
  StagedCommandStream,
} from "./source-capture.ts";

export * from "./source-capture.ts";

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

function checkedWrite<Owner extends "attempt" | "run">(
  write: RecordAttachmentWrite<Owner, never, never>,
): RecordAttachmentWrite<Owner, never, never> {
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) throw new Error("Fixed source receipt write closure was invalid");
  return write;
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
  const draft = blobs.add(makeRecordBlobSource(Stream.fromEffect(Effect.sync(() => bytes))));
  drafts.push(draft);
  return Object.freeze({
    storage: Object.freeze({ kind: "blob" as const, ref: draft.ref }),
    retainedBytes: stream.retainedBytes,
    totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
    sha256: decodedDigest.right,
  });
}

export interface AttemptSourceReceiptAttachmentWrites {
  readonly agentTurns?: RecordAttachmentWrite<"attempt", never, never>;
  readonly sandboxCommands?: RecordAttachmentWrite<"attempt", never, never>;
  readonly runnerActivities: RecordAttachmentWrite<"attempt", never, never>;
  readonly runnerDiagnostics: RecordAttachmentWrite<"attempt", never, never>;
}

export interface RunSourceReceiptAttachmentWrites {
  readonly runnerActivities?: RecordAttachmentWrite<"run", never, never>;
  readonly runnerDiagnostics?: RecordAttachmentWrite<"run", never, never>;
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

  const sandboxCommands = input.sandboxCommands === undefined
    ? undefined
    : checkedWrite(makeFixedRecordAttachmentWrite(
        sandboxCommandsRecordFamily.write,
        (blobs) => {
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
          if (Either.isLeft(decoded)) throw new Error("Sandbox Command capture violated its source schema");
          return Object.freeze({ payload: decoded.right, blobs: Object.freeze(drafts) });
        },
      ));

  return Either.right(Object.freeze({
    ...(agentTurns === undefined ? {} : {
      agentTurns: checkedWrite(makeFixedRecordAttachmentWrite(
        agentTurnsRecordFamily.write,
        () => Object.freeze({ payload: agentTurns.right, blobs: Object.freeze([]) }),
      )),
    }),
    ...(sandboxCommands === undefined ? {} : { sandboxCommands }),
    runnerActivities: checkedWrite(makeFixedRecordAttachmentWrite(
      attemptRunnerActivitiesRecordFamily.write,
      () => Object.freeze({ payload: activities.right, blobs: Object.freeze([]) }),
    )),
    runnerDiagnostics: checkedWrite(makeFixedRecordAttachmentWrite(
      attemptRunnerDiagnosticsRecordFamily.write,
      () => Object.freeze({ payload: diagnostics.right, blobs: Object.freeze([]) }),
    )),
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

  return Either.right(Object.freeze({
    ...(activities === undefined ? {} : {
      runnerActivities: checkedWrite(makeFixedRecordAttachmentWrite(
        runRunnerActivitiesRecordFamily.write,
        () => Object.freeze({ payload: activities.right, blobs: Object.freeze([]) }),
      )),
    }),
    ...(diagnostics === undefined ? {} : {
      runnerDiagnostics: checkedWrite(makeFixedRecordAttachmentWrite(
        runRunnerDiagnosticsRecordFamily.write,
        () => Object.freeze({ payload: diagnostics.right, blobs: Object.freeze([]) }),
      )),
    }),
  }));
}

export type AttemptSourceReceiptAttachments =
  | AgentTurnsAttachment
  | SandboxCommandsAttachment
  | AttemptRunnerActivitiesAttachment
  | AttemptRunnerDiagnosticsAttachment;

export type RunSourceReceiptAttachments =
  | RunRunnerActivitiesAttachment
  | RunRunnerDiagnosticsAttachment;
