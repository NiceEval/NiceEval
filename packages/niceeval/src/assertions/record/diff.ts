import { createHash, randomUUID } from "node:crypto";

import { Result, Schema } from "effect";
import { mintRecordContentHandle, type RecordTextContentHandle } from "../../record/attachment/content.ts";
import { RecordExactParseOptions } from "../../record/codec/core.ts";
import {
  FileChangesAttachmentSchema,
  fileChangesCollectionLimitationKey,
  validateFileChangesAttachment,
  type FileChangesAttachment,
  type FileChangesAttribution,
  type FileChangesCollectionLimitation,
  type FileChangesCollectionState,
} from "../../record/family/file-changes.ts";
import type { RecordAttachmentSessionBuilder } from "../../record/writer/current-attachment.ts";
import {
  agentSendWindowId,
  type AgentWorkspaceDiff,
  type AgentWorkspaceDiffEndpoint,
  type AgentWorkspaceDiffPolicy,
  type AgentWorkspaceDiffWindow,
  type AgentWorkspaceDiffWindowChange,
} from "../workspace-diff.ts";

type CaptureTextRevision = {
  readonly kind: "text";
  readonly sha256: string;
  readonly byteLength: number;
  readonly text: string;
};

type CaptureRevision =
  | CaptureTextRevision
  | {
      readonly kind: "elided";
      readonly reason: "binary";
      readonly byteLength: number;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "unsupported-input" | "capture-failed" | "capture-interrupted";
    };

type CaptureEndpoint = { readonly state: "absent" } | { readonly state: "present"; readonly revision: CaptureRevision };

interface PreparedChange {
  readonly path: string;
  readonly kind: "created" | "modified" | "deleted";
  readonly before: CaptureEndpoint;
  readonly after: CaptureEndpoint;
  readonly unsupportedEndpointCount: number;
}

interface CapturedChange extends Omit<PreparedChange, "unsupportedEndpointCount"> {
  readonly changeId: string;
}

interface CapturedWindow {
  readonly windowId: string;
  readonly sequence: number;
  readonly changes: readonly CapturedChange[];
}

/**
 * Attempt-owned frozen File Changes input. Change ids are minted exactly here,
 * before Record preflight or any attach callback can mint content handles.
 */
export interface FileChangesCapture {
  readonly attribution: FileChangesAttribution;
  readonly collection: FileChangesCollectionState;
  readonly windows: readonly CapturedWindow[];
}

export interface CreateFileChangesCaptureInput {
  readonly document: AgentWorkspaceDiff;
  /** Collector-stage facts observed by the caller before this capture freezes. */
  readonly limitations: readonly CaptureLimitation[] | undefined;
}

interface CaptureDocumentSource {
  readonly attribution: "agent-send-window-endpoints";
  readonly policy: AgentWorkspaceDiffPolicy;
  readonly windows: readonly AgentWorkspaceDiffWindow[];
}

type CaptureLimitation = Exclude<FileChangesCollectionLimitation, { readonly code: "collection-cap-reached" }>;

function compareAscii(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function nextChangeId(): string {
  return `fc_${randomUUID().replaceAll("-", "")}`;
}

function canonicalStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort(compareAscii);
}

function captureAttribution(policy: AgentWorkspaceDiffPolicy): FileChangesAttribution {
  return {
    kind: "agent-send-window-endpoints" as const,
    policy: {
      defaultPolicy: policy.defaultPolicy,
      include: canonicalStrings(policy.include),
      ignore: canonicalStrings(policy.ignore),
    },
  } as FileChangesAttribution;
}

function collectionState(limitations: readonly CaptureLimitation[]): FileChangesCollectionState {
  const exact = new Map<string, CaptureLimitation>();
  let unsupported = 0;
  for (const limitation of limitations) {
    if (limitation.code === "unsupported-input") {
      unsupported += limitation.omittedAtLeast;
    } else {
      exact.set(fileChangesCollectionLimitationKey(limitation), limitation);
    }
  }
  if (unsupported > 0) {
    const limitation = unsupportedInputLimitation(unsupported);
    exact.set(fileChangesCollectionLimitationKey(limitation), limitation);
  }
  const [first, ...rest] = [...exact.values()].sort((left, right) =>
    compareAscii(fileChangesCollectionLimitationKey(left), fileChangesCollectionLimitationKey(right)),
  );
  return first === undefined
    ? { state: "complete", limitations: [] }
    : { state: "partial", limitations: [first, ...rest] };
}

function unsupportedInputLimitation(omittedAtLeast: number): CaptureLimitation {
  return {
    code: "unsupported-input" as const,
    target: "endpoint-metadata" as const,
    omittedAtLeast,
  };
}

function endpointIsPresent(endpoint: AgentWorkspaceDiffEndpoint): boolean {
  return endpoint.state !== "absent";
}

function sourceChangeIsCoherent(change: AgentWorkspaceDiffWindowChange): boolean {
  const beforePresent = endpointIsPresent(change.before);
  const afterPresent = endpointIsPresent(change.after);
  switch (change.status) {
    case "added":
      return !beforePresent && afterPresent;
    case "modified":
      return beforePresent && afterPresent;
    case "deleted":
      return beforePresent && !afterPresent;
  }
}

function endpointForCapture(endpoint: AgentWorkspaceDiffEndpoint): {
  readonly endpoint: CaptureEndpoint;
  readonly unsupportedEndpointCount: number;
} {
  switch (endpoint.state) {
    case "absent":
      return { endpoint: { state: "absent" as const }, unsupportedEndpointCount: 0 };
    case "text": {
      if (typeof endpoint.text !== "string") {
        return {
          endpoint: {
            state: "present" as const,
            revision: { kind: "unavailable" as const, reason: "unsupported-input" as const },
          },
          unsupportedEndpointCount: 1,
        };
      }
      return {
        endpoint: {
          state: "present",
          revision: {
            kind: "text",
            sha256: createHash("sha256").update(endpoint.text, "utf8").digest("hex"),
            byteLength: Buffer.byteLength(endpoint.text, "utf8"),
            text: endpoint.text,
          },
        },
        unsupportedEndpointCount: 0,
      };
    }
    case "elided": {
      const byteLength = endpoint.bytes;
      if (
        endpoint.reason !== "binary" ||
        !Number.isSafeInteger(byteLength) ||
        byteLength === undefined ||
        byteLength < 0
      ) {
        return {
          endpoint: {
            state: "present" as const,
            revision: { kind: "unavailable" as const, reason: "unsupported-input" as const },
          },
          unsupportedEndpointCount: 1,
        };
      }
      return {
        endpoint: {
          state: "present" as const,
          revision: {
            kind: "elided" as const,
            reason: endpoint.reason,
            byteLength,
          },
        },
        unsupportedEndpointCount: 0,
      };
    }
  }
}

function prepareChange(change: AgentWorkspaceDiffWindowChange): PreparedChange {
  if (!sourceChangeIsCoherent(change)) {
    throw new Error("File Changes collector received an incoherent send-window endpoint transition");
  }
  const before = endpointForCapture(change.before);
  const after = endpointForCapture(change.after);
  function preparedChangeKind() {
    switch (change.status) {
      case "added":
        return "created" as const;
      case "deleted":
        return "deleted" as const;
      default:
        return "modified" as const;
    }
  }
  const kind = preparedChangeKind();
  return {
    path: change.path,
    kind,
    before: before.endpoint,
    after: after.endpoint,
    unsupportedEndpointCount: before.unsupportedEndpointCount + after.unsupportedEndpointCount,
  };
}

function captureWindowId(window: AgentWorkspaceDiffWindow): string {
  const identity = window.identity;
  if (
    !Number.isSafeInteger(identity.turn) ||
    identity.turn <= 0 ||
    (identity.session !== undefined && (!Number.isSafeInteger(identity.session) || identity.session <= 0))
  ) {
    throw new Error("File Changes collector received an invalid send-window identity");
  }
  return agentSendWindowId(identity);
}

function captureFrom(
  source: CaptureDocumentSource,
  callerLimitations: readonly CaptureLimitation[],
): FileChangesCapture {
  if (source.attribution !== "agent-send-window-endpoints") {
    throw new Error("File Changes capture received an unsupported workspace attribution");
  }
  const windowIds = new Set<string>();
  let unsupported = 0;
  const windows = source.windows.map((window, index) => {
    const windowId = captureWindowId(window);
    if (windowIds.has(windowId)) {
      throw new Error("File Changes collector received duplicate send-window ids");
    }
    windowIds.add(windowId);
    const changes = [...window.changes].sort((left, right) => compareAscii(left.path, right.path));
    return {
      windowId,
      sequence: index + 1,
      changes: changes.map((change, changeIndex) => {
        if (change.path === changes[changeIndex - 1]?.path) {
          throw new Error(
            `File Changes collector received duplicate path ${JSON.stringify(change.path)} in ${windowId}`,
          );
        }
        const { unsupportedEndpointCount, ...prepared } = prepareChange(change);
        unsupported += unsupportedEndpointCount;
        return { ...prepared, changeId: nextChangeId() };
      }),
    };
  });
  return {
    attribution: captureAttribution(source.policy),
    collection: collectionState([
      ...callerLimitations,
      ...(unsupported === 0 ? [] : [unsupportedInputLimitation(unsupported)]),
    ]),
    windows,
  };
}

/** Freeze a normal or partial collector result before any Record preflight/write. */
export function createFileChangesCapture(input: CreateFileChangesCaptureInput): FileChangesCapture {
  return captureFrom(input.document, input.limitations ?? []);
}

/** A started collector may have no safe export prefix but must still publish an honest partial capture. */
export function createEmptyFileChangesCapture(input: {
  readonly policy: AgentWorkspaceDiffPolicy;
  readonly limitations: readonly CaptureLimitation[];
}): FileChangesCapture {
  return captureFrom(
    {
      attribution: "agent-send-window-endpoints" as const,
      policy: input.policy,
      windows: [],
    },
    input.limitations,
  );
}

function durableEndpoint(endpoint: CaptureEndpoint, textContent: (text: string) => RecordTextContentHandle): unknown {
  if (endpoint.state === "absent" || endpoint.revision.kind !== "text") return endpoint;
  const { sha256, byteLength, text } = endpoint.revision;
  return {
    state: "present",
    revision: {
      kind: "text",
      sha256,
      byteLength,
      content: { state: "available", content: textContent(text) },
    },
  };
}

function validatedAttachment(
  capture: FileChangesCapture,
  textContent: (text: string) => RecordTextContentHandle,
): FileChangesAttachment {
  const payload = {
    attribution: capture.attribution,
    collection: capture.collection,
    windows: capture.windows.map((window) => ({
      windowId: window.windowId,
      sequence: window.sequence,
      changes: window.changes.map((change) => ({
        changeId: change.changeId,
        path: change.path,
        kind: change.kind,
        before: durableEndpoint(change.before, textContent),
        after: durableEndpoint(change.after, textContent),
      })),
    })),
  };
  const decoded = Schema.decodeUnknownResult(
    Schema.toType(FileChangesAttachmentSchema),
    RecordExactParseOptions,
  )(payload);
  if (Result.isFailure(decoded) || validateFileChangesAttachment(decoded.success).length > 0) {
    throw new Error("File Changes producer generated an invalid current value");
  }
  return decoded.success;
}

export type FileChangesAttachmentBuild = (build: RecordAttachmentSessionBuilder) => FileChangesAttachment;

/** Build the current logical value in the Attempt owner Session. */
export function createFileChangesCaptureAttachment(capture: FileChangesCapture): FileChangesAttachmentBuild {
  return (build) => validatedAttachment(capture, build.content.text);
}

/** Preflight validates the frozen ids and logical shape without opening Record content. */
export function assertFileChangesCaptureRecordable(capture: FileChangesCapture): void {
  validatedAttachment(capture, () => mintRecordContentHandle("text"));
}

/** Internal assertion-seal bridge; Runner itself retains the frozen capture, never this convenience path. */
export function createAgentWorkspaceDiffAttachment(document: AgentWorkspaceDiff): FileChangesAttachmentBuild {
  return createFileChangesCaptureAttachment(
    createFileChangesCapture({
      document,
      limitations: undefined,
    }),
  );
}

/** Pure projection for consumers already holding a decoded durable payload. */
export function projectFileChangesAttachment(payload: FileChangesAttachment): FileChangesAttachment {
  return {
    attribution: payload.attribution,
    collection: payload.collection,
    windows: payload.windows,
  };
}
