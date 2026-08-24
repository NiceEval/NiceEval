import { createHash } from "node:crypto";

import { Either, Schema } from "effect";

import { RecordExactParseOptions } from "../../record/codec/core.ts";
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
import { sourcesRecordAttachment } from "../../record/family/sources/definition.ts";
import {
  SandboxCommandReceiptSchema,
  SandboxCommandsAttachmentSchema,
  type SandboxCommandsAttachment,
} from "../../record/family/sandbox-commands/definition.ts";
import { SourceReceiptCollectionSchema } from "../../record/family/source-receipt/index.ts";
import type { RecordAttachmentSessionBuilder } from "../../record/writer/current-attachment.ts";
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

function commandStreamIsValid(stream: StagedCommandStream): boolean {
  const bytes = new TextEncoder().encode(stream.text);
  const retainedBytes = bytes.byteLength;
  return retainedBytes === stream.retainedBytes &&
    createHash("sha256").update(bytes).digest("hex") === stream.sha256 &&
    stream.totalSafeUtf8Bytes >= retainedBytes;
}

export type SandboxCommandsAttachmentBuild = (
  build: RecordAttachmentSessionBuilder,
) => SandboxCommandsAttachment;

export type AttemptRunnerDiagnosticsAttachmentBuild = (
  build: RecordAttachmentSessionBuilder,
) => AttemptRunnerDiagnosticsAttachment;

export type RunRunnerDiagnosticsAttachmentBuild = (
  build: RecordAttachmentSessionBuilder,
) => RunRunnerDiagnosticsAttachment;

const StagedSandboxCommandsSchema = Schema.Struct({
  collection: SourceReceiptCollectionSchema,
  segments: Schema.Array(
    SandboxCommandReceiptSchema.pipe(Schema.omit("stdout", "stderr")),
  ),
});

function sandboxCommandsAttachment(
  input: NonNullable<RunnerAttemptSourceReceiptsCapture["sandboxCommands"]>,
): Either.Either<SandboxCommandsAttachmentBuild, SourceReceiptAttachmentBuildError> {
  if (input.segments.some((segment) =>
    !commandStreamIsValid(segment.stdout) || !commandStreamIsValid(segment.stderr)
  )) {
    return Either.left(invalid("sandbox-commands"));
  }

  const metadata = Schema.validateEither(
    StagedSandboxCommandsSchema,
    RecordExactParseOptions,
  )({
    collection: input.collection,
    segments: input.segments.map((segment) => ({
      segmentId: segment.segmentId,
      commandId: segment.commandId,
      sequence: segment.sequence,
      turnId: segment.turnId,
      phase: segment.phase,
      invocation: segment.invocation,
      workingDirectory: segment.workingDirectory,
      outcome: segment.outcome,
    })),
  });
  if (Either.isLeft(metadata)) return Either.left(invalid("sandbox-commands"));

  return Either.right((build) => {
    const candidate = Object.freeze({
      collection: metadata.right.collection,
      segments: Object.freeze(metadata.right.segments.map((segment, index) => Object.freeze({
        ...segment,
        stdout: Object.freeze({
          content: build.content.text(input.segments[index]!.stdout.text),
          retainedBytes: input.segments[index]!.stdout.retainedBytes,
          totalSafeUtf8Bytes: input.segments[index]!.stdout.totalSafeUtf8Bytes,
          sha256: input.segments[index]!.stdout.sha256,
        }),
        stderr: Object.freeze({
          content: build.content.text(input.segments[index]!.stderr.text),
          retainedBytes: input.segments[index]!.stderr.retainedBytes,
          totalSafeUtf8Bytes: input.segments[index]!.stderr.totalSafeUtf8Bytes,
          sha256: input.segments[index]!.stderr.sha256,
        }),
      }))),
    });
    const decoded = Schema.validateEither(
      SandboxCommandsAttachmentSchema,
      RecordExactParseOptions,
    )(candidate);
    if (Either.isLeft(decoded)) {
      throw new Error("Sandbox Command capture violated its current schema");
    }
    return decoded.right;
  });
}

function attemptRunnerDiagnosticsAttachment(
  input: AttemptRunnerDiagnosticsAttachment,
): AttemptRunnerDiagnosticsAttachmentBuild {
  return (build) => {
    const candidate = Object.freeze({
      collection: input.collection,
      segments: Object.freeze(input.segments.map((segment) => Object.freeze({
        ...segment,
        sourceFrame: segment.sourceFrame === null
          ? null
          : build.reference.to(sourcesRecordAttachment, segment.sourceFrame.value),
      }))),
    });
    const decoded = Schema.validateEither(
      AttemptRunnerDiagnosticsAttachmentSchema,
      RecordExactParseOptions,
    )(candidate);
    if (Either.isLeft(decoded)) {
      throw new Error("Attempt Runner Diagnostics capture violated its current schema");
    }
    return decoded.right;
  };
}

function runRunnerDiagnosticsAttachment(
  input: RunRunnerDiagnosticsAttachment,
): RunRunnerDiagnosticsAttachmentBuild {
  return (build) => {
    const candidate = Object.freeze({
      collection: input.collection,
      segments: Object.freeze(input.segments.map((segment) => Object.freeze({
        ...segment,
        sourceFrame: segment.sourceFrame === null
          ? null
          : build.reference.to(sourcesRecordAttachment, segment.sourceFrame.value),
      }))),
    });
    const decoded = Schema.validateEither(
      RunRunnerDiagnosticsAttachmentSchema,
      RecordExactParseOptions,
    )(candidate);
    if (Either.isLeft(decoded)) {
      throw new Error("Run Runner Diagnostics capture violated its current schema");
    }
    return decoded.right;
  };
}

export interface AttemptSourceReceiptAttachments {
  readonly agentTurns?: AgentTurnsAttachment;
  readonly sandboxCommands?: SandboxCommandsAttachmentBuild;
  readonly runnerActivities: AttemptRunnerActivitiesAttachment;
  readonly runnerDiagnostics: AttemptRunnerDiagnosticsAttachmentBuild;
}

export interface RunSourceReceiptAttachments {
  readonly runnerActivities?: RunRunnerActivitiesAttachment;
  readonly runnerDiagnostics?: RunRunnerDiagnosticsAttachmentBuild;
}

export function createAttemptSourceReceiptAttachments(
  input: RunnerAttemptSourceReceiptsCapture,
): Either.Either<AttemptSourceReceiptAttachments, SourceReceiptAttachmentBuildError> {
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
    : sandboxCommandsAttachment(input.sandboxCommands);
  if (sandboxCommands !== undefined && Either.isLeft(sandboxCommands)) {
    return Either.left(sandboxCommands.left);
  }

  return Either.right(Object.freeze({
    ...(agentTurns === undefined ? {} : { agentTurns: agentTurns.right }),
    ...(sandboxCommands === undefined ? {} : { sandboxCommands: sandboxCommands.right }),
    runnerActivities: activities.right,
    runnerDiagnostics: attemptRunnerDiagnosticsAttachment(diagnostics.right),
  }));
}

export function createRunSourceReceiptAttachments(
  input: RunnerRunSourceReceiptsCapture,
): Either.Either<RunSourceReceiptAttachments, SourceReceiptAttachmentBuildError> {
  const activities = input.runnerActivities === undefined
    ? undefined
    : decode(RunRunnerActivitiesAttachmentSchema, input.runnerActivities, "runner-activities");
  if (activities !== undefined && Either.isLeft(activities)) return Either.left(activities.left);
  const diagnostics = input.runnerDiagnostics === undefined
    ? undefined
    : decode(RunRunnerDiagnosticsAttachmentSchema, input.runnerDiagnostics, "runner-diagnostics");
  if (diagnostics !== undefined && Either.isLeft(diagnostics)) return Either.left(diagnostics.left);

  return Either.right(Object.freeze({
    ...(activities === undefined ? {} : { runnerActivities: activities.right }),
    ...(diagnostics === undefined ? {} : {
      runnerDiagnostics: runRunnerDiagnosticsAttachment(diagnostics.right),
    }),
  }));
}
