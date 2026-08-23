import { Schema } from "effect";

import type { RecordBlobRef } from "../../../record/attachment/index.ts";
import {
  CollectionSchema,
  CommandIdSchema,
  CommandsReferencesSchema,
  NonNegativeSafeIntegerSchema,
  SafeTextSchema,
  boundedSafeTextSchema,
} from "../../../record/family/source-receipt/codec.ts";
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
} from "../../../record/family/source-receipt/limits.ts";
import {
  isSafeText,
  type Collection,
} from "../../../record/family/source-receipt/model.ts";
import {
  freezeArray,
  isAllowedCollection,
  isStrictlyOrderedById,
  payloadFits,
} from "./common.ts";

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
