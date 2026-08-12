import { Either } from "effect";
import type {
  RecordAttachmentPayloadSnapshot,
  RecordAttachmentValue,
} from "../../record/attachment/index.ts";
import {
  defineRecordAttachmentProjector,
  type RecordAttachmentProjector,
} from "../../projection/projector.ts";
import { isSafeTextV1, type CommandsReferencesV1, type NonNegativeSafeInteger } from "./model.ts";
import {
  type AttemptDiagnosticsAttachmentV1,
  type AttemptTimingAttachmentV1,
  type CommandManifestV1,
  type CommandObservationV1,
  type CommandResultV1,
  type CommandsAttachmentV1,
  type CommandStreamV1,
  type ConversationAttachmentV1,
  type RunDiagnosticsAttachmentV1,
  type RunTimingAttachmentV1,
  type UsageAttachmentV1,
} from "./families.ts";
import {
  attemptCommandsAttachmentV1,
  attemptConversationAttachmentV1,
  attemptDiagnosticsAttachmentV1,
  attemptTimingAttachmentV1,
  attemptUsageAttachmentV1,
  runDiagnosticsAttachmentV1,
  runTimingAttachmentV1,
} from "./family-writers.ts";

/**
 * Semantic view names deliberately omit a disk-version suffix. A projector
 * owns one current family definition; a later schema migration may keep this
 * semantic view or publish a separately named view without forcing callers to
 * reason about envelope versions.
 *
 * The public neutral view keeps each durable source-native tool name verbatim.
 * Canonical grouping, when a consumer needs it, is a derived view concern and
 * never replaces the projected name.
 */
export type ConversationView = RecordAttachmentPayloadSnapshot<ConversationAttachmentV1>;
export type ObservabilityLimitationView = ConversationView["collection"]["limitations"][number];
export type UsageView = RecordAttachmentPayloadSnapshot<UsageAttachmentV1>;
export type AttemptTimingView = RecordAttachmentPayloadSnapshot<AttemptTimingAttachmentV1>;
export type RunTimingView = RecordAttachmentPayloadSnapshot<RunTimingAttachmentV1>;
export type AttemptDiagnosticsView = RecordAttachmentPayloadSnapshot<
  AttemptDiagnosticsAttachmentV1
>;
export type RunDiagnosticsView = RecordAttachmentPayloadSnapshot<RunDiagnosticsAttachmentV1>;

export interface CommandStreamView {
  readonly text: string;
  readonly retainedBytes: NonNegativeSafeInteger;
  readonly totalSafeUtf8Bytes: NonNegativeSafeInteger;
}

export interface CommandsView {
  readonly collection: RecordAttachmentPayloadSnapshot<CommandsAttachmentV1["collection"]>;
  readonly commands: readonly {
    readonly commandId: RecordAttachmentPayloadSnapshot<CommandObservationV1["commandId"]>;
    readonly manifest: RecordAttachmentPayloadSnapshot<CommandManifestV1>;
    readonly result: {
      readonly outcome: RecordAttachmentPayloadSnapshot<CommandResultV1["outcome"]>;
      readonly stdout: CommandStreamView;
      readonly stderr: CommandStreamView;
    };
    readonly refs: RecordAttachmentPayloadSnapshot<readonly CommandsReferencesV1[]>;
  }[];
}

function detachedPayload<Payload>(
  value: RecordAttachmentValue<Payload>,
): RecordAttachmentPayloadSnapshot<Payload> {
  return value.payload;
}

function projectCommandStreamV1(
  stream: RecordAttachmentPayloadSnapshot<CommandStreamV1>,
  blobs: RecordAttachmentValue<CommandsAttachmentV1>["blobs"],
): CommandStreamView {
  if (stream.storage.kind === "inline") {
    return Object.freeze({
      text: stream.storage.text,
      retainedBytes: stream.retainedBytes,
      totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
    });
  }
  const bytes = blobs.bytes(stream.storage.ref);
  if (Either.isLeft(bytes)) {
    throw new Error("Commands Attachment blob closure lost a projected stream");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.right);
  } catch {
    throw new Error("Commands Attachment blob is not valid UTF-8");
  }
  if (
    !isSafeTextV1(text) ||
    new TextEncoder().encode(text).byteLength !== stream.retainedBytes
  ) {
    throw new Error("Commands Attachment blob does not match its retained stream metadata");
  }
  return Object.freeze({
    text,
    retainedBytes: stream.retainedBytes,
    totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes,
  });
}

function projectCommandsV1(
  value: RecordAttachmentValue<CommandsAttachmentV1>,
): CommandsView {
  return Object.freeze({
    collection: value.payload.collection,
    commands: Object.freeze(
      value.payload.commands.map((command) =>
        Object.freeze({
          commandId: command.commandId,
          manifest: command.manifest,
          result: Object.freeze({
            outcome: command.result.outcome,
            stdout: projectCommandStreamV1(command.result.stdout, value.blobs),
            stderr: projectCommandStreamV1(command.result.stderr, value.blobs),
          }),
          refs: command.refs,
        }),
      ),
    ),
  });
}

export const attemptConversationProjector: RecordAttachmentProjector<
  "attempt",
  ConversationView
> = defineRecordAttachmentProjector({
  attachment: attemptConversationAttachmentV1,
  project: detachedPayload,
});

export const attemptCommandsProjector: RecordAttachmentProjector<
  "attempt",
  CommandsView
> = defineRecordAttachmentProjector({
  attachment: attemptCommandsAttachmentV1,
  project: projectCommandsV1,
});

export const attemptUsageProjector: RecordAttachmentProjector<
  "attempt",
  UsageView
> = defineRecordAttachmentProjector({
  attachment: attemptUsageAttachmentV1,
  project: detachedPayload,
});

export const attemptTimingProjector: RecordAttachmentProjector<
  "attempt",
  AttemptTimingView
> = defineRecordAttachmentProjector({
  attachment: attemptTimingAttachmentV1,
  project: detachedPayload,
});

export const attemptDiagnosticsProjector: RecordAttachmentProjector<
  "attempt",
  AttemptDiagnosticsView
> = defineRecordAttachmentProjector({
  attachment: attemptDiagnosticsAttachmentV1,
  project: detachedPayload,
});

export const runTimingProjector: RecordAttachmentProjector<
  "run",
  RunTimingView
> = defineRecordAttachmentProjector({
  attachment: runTimingAttachmentV1,
  project: detachedPayload,
});

export const runDiagnosticsProjector: RecordAttachmentProjector<
  "run",
  RunDiagnosticsView
> = defineRecordAttachmentProjector({
  attachment: runDiagnosticsAttachmentV1,
  project: detachedPayload,
});
