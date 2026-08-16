import { createHash, randomUUID } from "node:crypto";

import { Either, Schema, Stream } from "effect";
import {
  makeFixedRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { makeRecordBlobRef } from "../../record/attachment/internal.ts";
import { RecordExactParseOptions } from "../../record/codec/core.ts";
import { fileChangesRecordFamily } from "../../record/family/catalog.ts";
import {
  FileChangesAttachmentSchema,
  FileChangesLimits,
  fileChangesCollectionLimitationKey,
  type FileChangesAttachment,
  type FileChangesAttribution,
  type FileChangesCollectionLimitation,
  type FileChangesCollectionState,
} from "../../record/family/file-changes.ts";
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
  readonly content:
    | { readonly state: "available"; readonly text: string }
    | { readonly state: "omitted"; readonly reason: "collection-cap" };
};

type CaptureRevision =
  | CaptureTextRevision
  | {
      readonly kind: "elided";
      readonly reason: "binary" | "oversized-text";
      readonly byteLength: number;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: "unsupported-input" | "capture-failed" | "capture-interrupted";
    };

type CaptureEndpoint =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly revision: CaptureRevision };

interface PreparedChange {
  readonly path: string;
  readonly kind: "created" | "modified" | "deleted";
  readonly before: CaptureEndpoint;
  readonly after: CaptureEndpoint;
  /** Not durable: it lets JSON truncation account only for retained bad endpoints. */
  readonly unsupportedEndpointCount: number;
}

interface CapturedChange extends PreparedChange {
  readonly changeId: string;
}

interface CapturedWindow {
  readonly windowId: string;
  readonly sequence: number;
  readonly changes: readonly CapturedChange[];
}

/**
 * Attempt-owned frozen File Changes input. Change ids are minted exactly here,
 * before Record preflight or any write/retry can allocate blob refs.
 */
export interface FileChangesCapture {
  readonly attribution: FileChangesAttribution;
  readonly collection: FileChangesCollectionState;
  readonly windows: readonly CapturedWindow[];
}

export interface CreateFileChangesCaptureInput {
  readonly document: AgentWorkspaceDiff;
  /** Collector-stage facts observed by the caller before this capture freezes. */
  readonly limitations?: readonly FileChangesCollectionLimitation[];
}

interface CaptureDocumentSource {
  readonly attribution: "agent-send-window-endpoints";
  readonly policy: AgentWorkspaceDiffPolicy;
  readonly windows: readonly AgentWorkspaceDiffWindow[];
}

const encoder = new TextEncoder();
const blobBudgetProjection = Object.freeze({
  "$niceeval.record.blob-ref": true,
});
const captureSchemaBlobRef = makeRecordBlobRef();

function compareAscii(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function nextChangeId(): string {
  return `fc_${randomUUID().replaceAll("-", "")}`;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalStrings(values: readonly string[]): readonly string[] {
  return freezeArray([...new Set(values)].sort(compareAscii));
}

function captureAttribution(policy: AgentWorkspaceDiffPolicy): FileChangesAttribution {
  return Object.freeze({
    kind: "agent-send-window-endpoints" as const,
    policy: Object.freeze({
      defaultPolicy: policy.defaultPolicy,
      include: canonicalStrings(policy.include),
      ignore: canonicalStrings(policy.ignore),
    }),
  }) as FileChangesAttribution;
}

function limitationKeyWithoutCount(
  limitation: Extract<FileChangesCollectionLimitation, { readonly code: "collection-cap-reached" }>,
): string {
  return [limitation.code, limitation.target, limitation.atWindowId ?? ""].join("\u0000");
}

/** Merge count-bearing limitations while keeping exact failures deterministically unique. */
function canonicalLimitations(
  values: readonly FileChangesCollectionLimitation[],
): readonly FileChangesCollectionLimitation[] {
  const exact = new Map<string, FileChangesCollectionLimitation>();
  const caps = new Map<
    string,
    Extract<FileChangesCollectionLimitation, { readonly code: "collection-cap-reached" }>
  >();
  let unsupported = 0;

  for (const limitation of values) {
    switch (limitation.code) {
      case "capture-failed":
      case "capture-interrupted": {
        exact.set(fileChangesCollectionLimitationKey(limitation), limitation);
        break;
      }
      case "collection-cap-reached": {
        const key = limitationKeyWithoutCount(limitation);
        const prior = caps.get(key);
        caps.set(key, Object.freeze({
          ...limitation,
          omittedAtLeast: (prior?.omittedAtLeast ?? 0) + limitation.omittedAtLeast,
        }));
        break;
      }
      case "unsupported-input":
        unsupported += limitation.omittedAtLeast;
        break;
    }
  }

  if (unsupported > 0) {
    exact.set(
      "unsupported-input\u0000endpoint-metadata",
      Object.freeze({
        code: "unsupported-input" as const,
        target: "endpoint-metadata" as const,
        omittedAtLeast: unsupported,
      }),
    );
  }

  const merged = [...exact.values(), ...caps.values()];
  return freezeArray(merged.sort((left, right) =>
    compareAscii(fileChangesCollectionLimitationKey(left), fileChangesCollectionLimitationKey(right))
  ));
}

function collectionState(
  limitations: readonly FileChangesCollectionLimitation[],
): FileChangesCollectionState {
  const canonical = canonicalLimitations(limitations);
  return canonical.length === 0
    ? Object.freeze({ state: "complete" as const, limitations: Object.freeze([]) }) as FileChangesCollectionState
    : Object.freeze({ state: "partial" as const, limitations: canonical }) as FileChangesCollectionState;
}

function capLimitation(
  target: "window" | "change" | "content-blob" | "content-byte" | "json-byte",
  omittedAtLeast: number,
  atWindowId: string | null,
): FileChangesCollectionLimitation {
  return Object.freeze({
    code: "collection-cap-reached" as const,
    target,
    omittedAtLeast,
    atWindowId,
  });
}

function unsupportedInputLimitation(omittedAtLeast: number): FileChangesCollectionLimitation {
  return Object.freeze({
    code: "unsupported-input" as const,
    target: "endpoint-metadata" as const,
    omittedAtLeast,
  });
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

function endpointForCapture(
  endpoint: AgentWorkspaceDiffEndpoint,
): { readonly endpoint: CaptureEndpoint; readonly unsupportedEndpointCount: number } {
  switch (endpoint.state) {
    case "absent":
      return Object.freeze({ endpoint: Object.freeze({ state: "absent" as const }), unsupportedEndpointCount: 0 });
    case "text": {
      if (typeof endpoint.text !== "string") {
        return Object.freeze({
          endpoint: Object.freeze({
            state: "present" as const,
            revision: Object.freeze({ kind: "unavailable" as const, reason: "unsupported-input" as const }),
          }),
          unsupportedEndpointCount: 1,
        });
      }
      const content = encoder.encode(endpoint.text);
      if (content.byteLength > FileChangesLimits.maximumTextRevisionBytes) {
        return Object.freeze({
          endpoint: Object.freeze({
            state: "present" as const,
            revision: Object.freeze({
              kind: "elided" as const,
              reason: "oversized-text" as const,
              byteLength: content.byteLength,
            }),
          }),
          unsupportedEndpointCount: 0,
        });
      }
      return Object.freeze({
        endpoint: Object.freeze({
          state: "present" as const,
          revision: Object.freeze({
            kind: "text" as const,
            sha256: sha256(content),
            byteLength: content.byteLength,
            content: Object.freeze({ state: "available" as const, text: endpoint.text }),
          }),
        }),
        unsupportedEndpointCount: 0,
      });
    }
    case "elided": {
      const byteLength = endpoint.bytes;
      if (
        (endpoint.reason !== "binary" && endpoint.reason !== "oversized-text")
        || !Number.isSafeInteger(byteLength)
        || byteLength === undefined
        || byteLength < 0
      ) {
        return Object.freeze({
          endpoint: Object.freeze({
            state: "present" as const,
            revision: Object.freeze({ kind: "unavailable" as const, reason: "unsupported-input" as const }),
          }),
          unsupportedEndpointCount: 1,
        });
      }
      return Object.freeze({
        endpoint: Object.freeze({
          state: "present" as const,
          revision: Object.freeze({
            kind: "elided" as const,
            reason: endpoint.reason,
            byteLength,
          }),
        }),
        unsupportedEndpointCount: 0,
      });
    }
  }
}

function prepareChange(change: AgentWorkspaceDiffWindowChange): PreparedChange {
  if (!sourceChangeIsCoherent(change)) {
    throw new Error("File Changes collector received an incoherent send-window endpoint transition");
  }
  const before = endpointForCapture(change.before);
  const after = endpointForCapture(change.after);
  const kind = change.status === "added"
    ? "created" as const
    : change.status === "deleted"
      ? "deleted" as const
      : "modified" as const;
  return Object.freeze({
    path: change.path,
    kind,
    before: before.endpoint,
    after: after.endpoint,
    unsupportedEndpointCount: before.unsupportedEndpointCount + after.unsupportedEndpointCount,
  });
}

function captureWindowId(window: AgentWorkspaceDiffWindow): string {
  const identity = window.identity;
  if (
    !Number.isSafeInteger(identity.turn)
    || identity.turn <= 0
    || (identity.session !== undefined && (!Number.isSafeInteger(identity.session) || identity.session <= 0))
  ) {
    throw new Error("File Changes collector received an invalid send-window identity");
  }
  return agentSendWindowId(identity);
}

function structuralCapture(
  source: CaptureDocumentSource,
): {
  readonly windows: readonly CapturedWindow[];
  readonly limitations: readonly FileChangesCollectionLimitation[];
} {
  const limitations: FileChangesCollectionLimitation[] = [];
  const retainedWindowCount = Math.min(source.windows.length, FileChangesLimits.maximumWindows);
  if (source.windows.length > retainedWindowCount) {
    const firstOmitted = source.windows[retainedWindowCount];
    limitations.push(capLimitation(
      "window",
      source.windows.length - retainedWindowCount,
      firstOmitted === undefined ? null : captureWindowId(firstOmitted),
    ));
  }

  const windowIds = new Set<string>();
  const preparedWindows: Array<{
    readonly windowId: string;
    readonly sequence: number;
    readonly changes: readonly PreparedChange[];
  }> = [];
  for (let index = 0; index < retainedWindowCount; index += 1) {
    const sourceWindow = source.windows[index]!;
    const windowId = captureWindowId(sourceWindow);
    if (windowIds.has(windowId)) {
      throw new Error("File Changes collector received duplicate send-window ids");
    }
    windowIds.add(windowId);
    const changes = [...sourceWindow.changes]
      .sort((left, right) => compareAscii(left.path, right.path));
    for (let changeIndex = 1; changeIndex < changes.length; changeIndex += 1) {
      if (changes[changeIndex - 1]!.path === changes[changeIndex]!.path) {
        throw new Error(`File Changes collector received duplicate path ${JSON.stringify(changes[changeIndex]!.path)} in ${windowId}`);
      }
    }
    const prepared = changes.map(prepareChange);
    if (prepared.length > FileChangesLimits.maximumChangesPerWindow) {
      limitations.push(capLimitation(
        "change",
        prepared.length - FileChangesLimits.maximumChangesPerWindow,
        windowId,
      ));
    }
    preparedWindows.push(Object.freeze({
      windowId,
      sequence: index + 1,
      changes: freezeArray(prepared.slice(0, FileChangesLimits.maximumChangesPerWindow)),
    }));
  }

  let remainingChanges = FileChangesLimits.maximumRetainedChanges;
  const capturedWindows = preparedWindows.map((window) => {
    const retained = Math.min(window.changes.length, remainingChanges);
    if (retained < window.changes.length) {
      limitations.push(capLimitation("change", window.changes.length - retained, window.windowId));
    }
    remainingChanges -= retained;
    return Object.freeze({
      windowId: window.windowId,
      sequence: window.sequence,
      changes: freezeArray(window.changes.slice(0, retained).map((change) => Object.freeze({
        ...change,
        changeId: nextChangeId(),
      }))),
    });
  });

  return Object.freeze({ windows: freezeArray(capturedWindows), limitations: freezeArray(limitations) });
}

function unsupportedLimitationsFor(
  windows: readonly CapturedWindow[],
): readonly FileChangesCollectionLimitation[] {
  const unsupported = windows.reduce(
    (total, window) => total + window.changes.reduce(
      (windowTotal, change) => windowTotal + change.unsupportedEndpointCount,
      0,
    ),
    0,
  );
  return unsupported === 0 ? Object.freeze([]) : Object.freeze([unsupportedInputLimitation(unsupported)]);
}

function omitTextContent(endpoint: CaptureEndpoint): CaptureEndpoint {
  if (
    endpoint.state !== "present"
    || endpoint.revision.kind !== "text"
    || endpoint.revision.content.state !== "available"
  ) {
    return endpoint;
  }
  return Object.freeze({
    state: "present" as const,
    revision: Object.freeze({
      ...endpoint.revision,
      content: Object.freeze({ state: "omitted" as const, reason: "collection-cap" as const }),
    }),
  });
}

function withBlobCaps(
  windows: readonly CapturedWindow[],
): {
  readonly windows: readonly CapturedWindow[];
  readonly limitations: readonly FileChangesCollectionLimitation[];
} {
  let blobCount = 0;
  let totalBytes = 0;
  const limitations: FileChangesCollectionLimitation[] = [];
  const consume = (
    endpoint: CaptureEndpoint,
    windowId: string,
  ): CaptureEndpoint => {
    if (
      endpoint.state !== "present"
      || endpoint.revision.kind !== "text"
      || endpoint.revision.content.state !== "available"
    ) {
      return endpoint;
    }
    if (endpoint.revision.byteLength > FileChangesLimits.maximumBlobBytes) {
      throw new Error("File Changes producer retained a text revision beyond its blob limit");
    }
    if (blobCount >= FileChangesLimits.maximumBlobs) {
      limitations.push(capLimitation("content-blob", 1, windowId));
      return omitTextContent(endpoint);
    }
    if (totalBytes + endpoint.revision.byteLength > FileChangesLimits.maximumTotalBlobBytes) {
      limitations.push(capLimitation("content-byte", 1, windowId));
      return omitTextContent(endpoint);
    }
    blobCount += 1;
    totalBytes += endpoint.revision.byteLength;
    return endpoint;
  };

  const capped = windows.map((window) => Object.freeze({
    ...window,
    changes: freezeArray(window.changes.map((change) => Object.freeze({
      ...change,
      before: consume(change.before, window.windowId),
      after: consume(change.after, window.windowId),
    }))),
  }));
  return Object.freeze({ windows: freezeArray(capped), limitations: freezeArray(limitations) });
}

function previewEndpoint(endpoint: CaptureEndpoint): unknown {
  if (endpoint.state === "absent") return Object.freeze({ state: "absent" as const });
  const revision = endpoint.revision;
  switch (revision.kind) {
    case "text":
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({
          kind: "text" as const,
          sha256: revision.sha256,
          byteLength: revision.byteLength,
          content: revision.content.state === "available"
            ? Object.freeze({ state: "available" as const, ref: blobBudgetProjection })
            : Object.freeze({ state: "omitted" as const, reason: "collection-cap" as const }),
        }),
      });
    case "elided":
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({
          kind: "elided" as const,
          reason: revision.reason,
          byteLength: revision.byteLength,
        }),
      });
    case "unavailable":
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({ kind: "unavailable" as const, reason: revision.reason }),
      });
  }
}

function previewPayload(capture: FileChangesCapture): unknown {
  return Object.freeze({
    "attribution-data": capture.attribution,
    "collection-data": capture.collection,
    "windows-data": freezeArray(capture.windows.map((window) => Object.freeze({
      windowId: window.windowId,
      sequence: window.sequence,
      changes: freezeArray(window.changes.map((change) => Object.freeze({
        changeId: change.changeId,
        path: change.path,
        kind: change.kind,
        before: previewEndpoint(change.before),
        after: previewEndpoint(change.after),
      }))),
    }))),
  });
}

function jsonByteLength(capture: FileChangesCapture): number {
  const text = JSON.stringify(previewPayload(capture));
  if (text === undefined) throw new Error("File Changes producer could not serialize its JSON budget projection");
  return encoder.encode(text).byteLength;
}

function trimLastChange(
  windows: readonly CapturedWindow[],
): { readonly windows: readonly CapturedWindow[]; readonly atWindowId: string } | undefined {
  for (let windowIndex = windows.length - 1; windowIndex >= 0; windowIndex -= 1) {
    const window = windows[windowIndex]!;
    if (window.changes.length === 0) continue;
    const next = [...windows];
    next[windowIndex] = Object.freeze({
      ...window,
      changes: freezeArray(window.changes.slice(0, -1)),
    });
    return Object.freeze({ windows: freezeArray(next), atWindowId: window.windowId });
  }
  return undefined;
}

function captureFrom(
  source: CaptureDocumentSource,
  callerLimitations: readonly FileChangesCollectionLimitation[],
): FileChangesCapture {
  if (source.attribution !== "agent-send-window-endpoints") {
    throw new Error("File Changes capture received an unsupported workspace attribution");
  }
  const attribution = captureAttribution(source.policy);
  const structural = structuralCapture(source);
  let windows = structural.windows;
  let jsonOmitted = 0;
  let jsonAtWindowId: string | null = null;

  for (;;) {
    const blobCapped = withBlobCaps(windows);
    const limitations = [
      ...callerLimitations,
      ...structural.limitations,
      ...unsupportedLimitationsFor(windows),
      ...blobCapped.limitations,
      ...(jsonOmitted === 0 ? [] : [capLimitation("json-byte", jsonOmitted, jsonAtWindowId)]),
    ];
    const capture = Object.freeze({
      attribution,
      collection: collectionState(limitations),
      windows: blobCapped.windows,
    }) as FileChangesCapture;
    if (jsonByteLength(capture) <= FileChangesLimits.maximumPayloadJsonBytes) {
      assertFileChangesCaptureSchema(capture);
      return capture;
    }
    const trimmed = trimLastChange(windows);
    if (trimmed === undefined) {
      throw new Error("File Changes producer cannot fit its structural payload within the JSON budget");
    }
    windows = trimmed.windows;
    jsonOmitted += 1;
    // Trimming walks backward, so the final removed entry is the first omitted prefix entry.
    jsonAtWindowId = trimmed.atWindowId;
  }
}

/** Freeze a normal or partial collector result before any Record preflight/write. */
export function createFileChangesCapture(input: CreateFileChangesCaptureInput): FileChangesCapture {
  return captureFrom(input.document, input.limitations ?? Object.freeze([]));
}

/** A started collector may have no safe export prefix but must still publish an honest partial capture. */
export function createEmptyFileChangesCapture(input: {
  readonly policy: AgentWorkspaceDiffPolicy;
  readonly limitations: readonly FileChangesCollectionLimitation[];
}): FileChangesCapture {
  return captureFrom(Object.freeze({
    attribution: "agent-send-window-endpoints" as const,
    policy: input.policy,
    windows: Object.freeze([]),
  }), input.limitations);
}

function durableEndpoint(
  endpoint: CaptureEndpoint,
  availableContent: (revision: Extract<CaptureRevision, { readonly kind: "text" }>) => unknown,
): unknown {
  if (endpoint.state === "absent") return Object.freeze({ state: "absent" as const });
  const revision = endpoint.revision;
  switch (revision.kind) {
    case "text":
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({
          kind: "text" as const,
          sha256: revision.sha256,
          byteLength: revision.byteLength,
          content: revision.content.state === "available"
            ? availableContent(revision)
            : Object.freeze({ state: "omitted" as const, reason: "collection-cap" as const }),
        }),
      });
    case "elided":
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({
          kind: "elided" as const,
          reason: revision.reason,
          byteLength: revision.byteLength,
        }),
      });
    case "unavailable":
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({ kind: "unavailable" as const, reason: revision.reason }),
      });
  }
}

function assertFileChangesCaptureSchema(capture: FileChangesCapture): void {
  const preview = Object.freeze({
    attribution: capture.attribution,
    collection: capture.collection,
    windows: freezeArray(capture.windows.map((window) => Object.freeze({
      windowId: window.windowId,
      sequence: window.sequence,
      changes: freezeArray(window.changes.map((change) => Object.freeze({
        changeId: change.changeId,
        path: change.path,
        kind: change.kind,
        before: durableEndpoint(change.before, () => Object.freeze({
          state: "available" as const,
          ref: captureSchemaBlobRef,
        })),
        after: durableEndpoint(change.after, () => Object.freeze({
          state: "available" as const,
          ref: captureSchemaBlobRef,
        })),
      }))),
    }))),
  });
  const decoded = Schema.validateEither(
    FileChangesAttachmentSchema,
    RecordExactParseOptions,
  )(preview);
  if (Either.isLeft(decoded)) {
    throw new Error("File Changes producer generated an invalid fixed-family capture");
  }
}

/** Convert a frozen capture to a fresh Record write without minting another change id. */
export function createFileChangesCaptureAttachmentWrite(
  capture: FileChangesCapture,
): RecordAttachmentWrite<"attempt", never, never> {
  const write = makeFixedRecordAttachmentWrite(
    fileChangesRecordFamily.write,
    (blobs) => {
      const drafts: RecordAttachmentBlobDraft<never, never>[] = [];
      const availableContent = (
        revision: Extract<CaptureRevision, { readonly kind: "text" }>,
      ): unknown => {
        const content = encoder.encode(revision.content.state === "available" ? revision.content.text : "");
        if (
          revision.content.state !== "available"
          || content.byteLength !== revision.byteLength
          || sha256(content) !== revision.sha256
        ) {
          throw new Error("File Changes producer lost frozen text revision integrity");
        }
        const draft = blobs.add(makeRecordBlobSource(Stream.succeed(content)));
        drafts.push(draft);
        return Object.freeze({ state: "available" as const, ref: draft.ref });
      };
      const payload = Object.freeze({
        attribution: capture.attribution,
        collection: capture.collection,
        windows: freezeArray(capture.windows.map((window) => Object.freeze({
          windowId: window.windowId,
          sequence: window.sequence,
          changes: freezeArray(window.changes.map((change) => Object.freeze({
            changeId: change.changeId,
            path: change.path,
            kind: change.kind,
            before: durableEndpoint(change.before, availableContent),
            after: durableEndpoint(change.after, availableContent),
          }))),
        }))),
      });
      const decoded = Schema.validateEither(
        FileChangesAttachmentSchema,
        RecordExactParseOptions,
      )(payload);
      if (Either.isLeft(decoded)) {
        throw new Error("File Changes producer generated an invalid fixed-family payload");
      }
      return Object.freeze({ payload: decoded.right, blobs: freezeArray(drafts) });
    },
  );
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("File Changes producer generated an invalid owner-local closure");
  }
  return write;
}

/** Preflight validates the same frozen ids and closure shape that the Attempt writer will publish. */
export function assertFileChangesCaptureRecordable(capture: FileChangesCapture): void {
  createFileChangesCaptureAttachmentWrite(capture);
}

/** Internal assertion-seal bridge; Runner itself retains the frozen capture, never this convenience path. */
export function createAgentWorkspaceDiffAttachmentWrite(
  document: AgentWorkspaceDiff,
): RecordAttachmentWrite<"attempt", never, never> {
  return createFileChangesCaptureAttachmentWrite(createFileChangesCapture({ document }));
}

/** Pure projection for consumers already holding a decoded durable payload. */
export function projectFileChangesAttachment(
  payload: FileChangesAttachment,
): FileChangesAttachment {
  return Object.freeze({
    attribution: payload.attribution,
    collection: payload.collection,
    windows: freezeArray(payload.windows),
  });
}
