import { Either } from "effect";
import type {
  RecordAttachmentBlobs,
  RecordAttachmentPayloadSnapshot,
} from "../../record/attachment/index.ts";
import {
  attemptObservabilityRecordFamily,
  runObservabilityRecordFamily,
} from "../../record/family/catalog.ts";
import type {
  AttemptObservabilityAttachment,
  RunObservabilityAttachment,
} from "../../record/family/observability/definition.ts";

/** Neutral projections stay within one available fixed Observability value. */
type AttemptPayload = RecordAttachmentPayloadSnapshot<AttemptObservabilityAttachment>;
type RunPayload = RecordAttachmentPayloadSnapshot<RunObservabilityAttachment>;

export type ConversationView = AttemptPayload["conversation"];
export type ObservabilityLimitationView = ConversationView["collection"]["limitations"][number];
export type UsageView = AttemptPayload["usage"];
export type AttemptTimingView = AttemptPayload["timing"];
export type RunTimingView = RunPayload["timing"];
export type AttemptDiagnosticsView = AttemptPayload["diagnostics"];
export type RunDiagnosticsView = RunPayload["diagnostics"];

export interface CommandStreamView {
  readonly text: string;
  readonly retainedBytes: number;
  readonly totalSafeUtf8Bytes: number;
}
export interface CommandsView {
  readonly collection: AttemptPayload["commands"]["collection"];
  readonly commands: readonly {
    readonly commandId: string;
    readonly manifest: AttemptPayload["commands"]["commands"][number]["manifest"];
    readonly result: {
      readonly outcome: AttemptPayload["commands"]["commands"][number]["result"]["outcome"];
      readonly stdout: CommandStreamView;
      readonly stderr: CommandStreamView;
    };
  }[];
}

function projectCommandStream(
  stream: AttemptPayload["commands"]["commands"][number]["result"]["stdout"],
  blobs: RecordAttachmentBlobs,
): CommandStreamView {
  if (stream.storage.kind === "inline") {
    return Object.freeze({ text: stream.storage.text, retainedBytes: stream.retainedBytes, totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes });
  }
  const bytes = blobs.bytes(stream.storage.ref);
  if (Either.isLeft(bytes)) throw new Error("Observability command blob closure is invalid");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.right);
  } catch {
    throw new Error("Observability command blob is not UTF-8");
  }
  if (new TextEncoder().encode(text).byteLength !== stream.retainedBytes) {
    throw new Error("Observability command blob length does not match metadata");
  }
  return Object.freeze({ text, retainedBytes: stream.retainedBytes, totalSafeUtf8Bytes: stream.totalSafeUtf8Bytes });
}

export function projectAttemptObservabilityAttachment(
  value: AttemptPayload,
): AttemptPayload {
  return value;
}
export function projectRunObservabilityAttachment(
  value: RunPayload,
): RunPayload {
  return value;
}
export function projectAttemptCommands(
  value: AttemptPayload,
  blobs: RecordAttachmentBlobs,
): CommandsView {
  return Object.freeze({
    collection: value.commands.collection,
    commands: Object.freeze(value.commands.commands.map((command) => Object.freeze({
      commandId: command.commandId,
      manifest: command.manifest,
      result: Object.freeze({
        outcome: command.result.outcome,
        stdout: projectCommandStream(command.result.stdout, blobs),
        stderr: projectCommandStream(command.result.stderr, blobs),
      }),
    }))),
  });
}

/** Compatibility-shaped fixed descriptors; each reads the single family once. */
export const attemptConversationProjector = Object.freeze({ write: attemptObservabilityRecordFamily.write, project: (value: AttemptPayload) => value.conversation });
export const attemptCommandsProjector = Object.freeze({ write: attemptObservabilityRecordFamily.write, project: projectAttemptCommands });
export const attemptUsageProjector = Object.freeze({ write: attemptObservabilityRecordFamily.write, project: (value: AttemptPayload) => value.usage });
export const attemptTimingProjector = Object.freeze({ write: attemptObservabilityRecordFamily.write, project: (value: AttemptPayload) => value.timing });
export const attemptDiagnosticsProjector = Object.freeze({ write: attemptObservabilityRecordFamily.write, project: (value: AttemptPayload) => value.diagnostics });
export const runTimingProjector = Object.freeze({ write: runObservabilityRecordFamily.write, project: (value: RunPayload) => value.timing });
export const runDiagnosticsProjector = Object.freeze({ write: runObservabilityRecordFamily.write, project: (value: RunPayload) => value.diagnostics });
