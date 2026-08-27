import { createHash } from "node:crypto";

import { Result, Schema } from "effect";

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

function decode<Value>(
  schema: Schema.Schema<Value>,
  value: unknown,
  family: SourceReceiptAttachmentBuildError["family"],
): Result.Result<Value, SourceReceiptAttachmentBuildError> {
  const decoded = Schema.decodeUnknownResult(Schema.toType(schema), RecordExactParseOptions)(value);
  return Result.isFailure(decoded) ? Result.fail(invalid(family)) : Result.succeed(decoded.success);
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
    SandboxCommandReceiptSchema.mapFields(({ stdout: _stdout, stderr: _stderr, ...fields }) => fields),
  ),
});

function sandboxCommandsAttachment(
  input: NonNullable<RunnerAttemptSourceReceiptsCapture["sandboxCommands"]>,
): Result.Result<SandboxCommandsAttachmentBuild, SourceReceiptAttachmentBuildError> {
  if (input.segments.some((segment) =>
    !commandStreamIsValid(segment.stdout) || !commandStreamIsValid(segment.stderr)
  )) {
    return Result.fail(invalid("sandbox-commands"));
  }

  const metadata = Schema.decodeUnknownResult(
    Schema.toType(StagedSandboxCommandsSchema),
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
  if (Result.isFailure(metadata)) return Result.fail(invalid("sandbox-commands"));

  return Result.succeed((build) => {
    const candidate = Object.freeze({
      collection: metadata.success.collection,
      segments: Object.freeze(metadata.success.segments.map((segment, index) => Object.freeze({
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
    const decoded = Schema.decodeUnknownResult(
      Schema.toType(SandboxCommandsAttachmentSchema),
      RecordExactParseOptions,
    )(candidate);
    if (Result.isFailure(decoded)) {
      throw new Error("Sandbox Command capture violated its current schema");
    }
    return decoded.success;
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
    const decoded = Schema.decodeResult(
      Schema.toType(AttemptRunnerDiagnosticsAttachmentSchema),
      RecordExactParseOptions,
    )(candidate);
    if (Result.isFailure(decoded)) {
      throw new Error("Attempt Runner Diagnostics capture violated its current schema");
    }
    return decoded.success;
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
    const decoded = Schema.decodeResult(
      Schema.toType(RunRunnerDiagnosticsAttachmentSchema),
      RecordExactParseOptions,
    )(candidate);
    if (Result.isFailure(decoded)) {
      throw new Error("Run Runner Diagnostics capture violated its current schema");
    }
    return decoded.success;
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
): Result.Result<AttemptSourceReceiptAttachments, SourceReceiptAttachmentBuildError> {
  const agentTurns = input.agentTurns === undefined
    ? undefined
    : decode(AgentTurnsAttachmentSchema, input.agentTurns, "agent-turns");
  if (agentTurns !== undefined && Result.isFailure(agentTurns)) return Result.fail(agentTurns.failure);

  const activities = decode(
    AttemptRunnerActivitiesAttachmentSchema,
    input.runnerActivities,
    "runner-activities",
  );
  if (Result.isFailure(activities)) return Result.fail(activities.failure);
  const diagnostics = decode(
    AttemptRunnerDiagnosticsAttachmentSchema,
    input.runnerDiagnostics,
    "runner-diagnostics",
  );
  if (Result.isFailure(diagnostics)) return Result.fail(diagnostics.failure);
  const sandboxCommands = input.sandboxCommands === undefined
    ? undefined
    : sandboxCommandsAttachment(input.sandboxCommands);
  if (sandboxCommands !== undefined && Result.isFailure(sandboxCommands)) {
    return Result.fail(sandboxCommands.failure);
  }

  return Result.succeed(Object.freeze({
    ...(agentTurns === undefined ? {} : { agentTurns: agentTurns.success }),
    ...(sandboxCommands === undefined ? {} : { sandboxCommands: sandboxCommands.success }),
    runnerActivities: activities.success,
    runnerDiagnostics: attemptRunnerDiagnosticsAttachment(diagnostics.success),
  }));
}

export function createRunSourceReceiptAttachments(
  input: RunnerRunSourceReceiptsCapture,
): Result.Result<RunSourceReceiptAttachments, SourceReceiptAttachmentBuildError> {
  const activities = input.runnerActivities === undefined
    ? undefined
    : decode(RunRunnerActivitiesAttachmentSchema, input.runnerActivities, "runner-activities");
  if (activities !== undefined && Result.isFailure(activities)) return Result.fail(activities.failure);
  const diagnostics = input.runnerDiagnostics === undefined
    ? undefined
    : decode(RunRunnerDiagnosticsAttachmentSchema, input.runnerDiagnostics, "runner-diagnostics");
  if (diagnostics !== undefined && Result.isFailure(diagnostics)) return Result.fail(diagnostics.failure);

  return Result.succeed(Object.freeze({
    ...(activities === undefined ? {} : { runnerActivities: activities.success }),
    ...(diagnostics === undefined ? {} : {
      runnerDiagnostics: runRunnerDiagnosticsAttachment(diagnostics.success),
    }),
  }));
}
