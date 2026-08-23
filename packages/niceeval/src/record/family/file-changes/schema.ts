import { createHash } from "node:crypto";

import { Schema } from "effect";
import {
  CanonicalProjectRelativePathSchema,
  FileChangeIdSchema,
  Sha256DigestSchema,
} from "../../codec/identifiers.ts";
import { compareCanonicalIdentity } from "../../model/identifiers.ts";
import {
  RecordBlobRefSchema,
  type RecordBlobRef,
} from "../../attachment/blob-ref.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../../attachment/errors.ts";
import {
  EmptyArraySchema,
  FixedAttachmentValueLimits,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
} from "../common.ts";

/** Immutable per-Attempt budgets for the fixed File Changes family. */
export const FileChangesLimits = Object.freeze({
  maximumWindows: 256,
  maximumChangesPerWindow: 10_000,
  maximumRetainedChanges: 10_000,
  maximumTextRevisionBytes: 1024 * 1024,
  maximumBlobs: 20_000,
  maximumBlobBytes: 1024 * 1024,
  maximumTotalBlobBytes: 128 * 1024 * 1024,
  maximumPayloadJsonBytes: 16 * 1024 * 1024,
  maximumPolicyEntries: 256,
  maximumPolicyEntryUtf8Bytes: 4096,
});

/** File Changes preserves more endpoint nodes than the shared owner envelope. */
export const FileChangesAttachmentValueLimits = Object.freeze({
  ...FixedAttachmentValueLimits,
  maximumNodes: 500_000,
});

const encoder = new TextEncoder();

function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function canonicalStrings(values: readonly string[]): boolean {
  let previous: string | undefined;
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value) || (previous !== undefined && compareCanonicalIdentity(previous, value) >= 0)) {
      return false;
    }
    seen.add(value);
    previous = value;
  }
  return true;
}

function canonicalLimitations(values: readonly FileChangesCollectionLimitation[]): boolean {
  return canonicalStrings(values.map(fileChangesCollectionLimitationKey));
}

/** A recorded send label is stable independently of its one-based attachment sequence. */
export const FileChangesWindowIdSchema = Schema.String.pipe(
  Schema.filter(
    (value) => /^(?:turn[1-9][0-9]*|session[1-9][0-9]*\/turn[1-9][0-9]*)$/.test(value),
    {
      identifier: "FileChangesWindowId",
      description: "a canonical agent send-window id",
    },
  ),
);

const FileChangesPolicyEntrySchema = Schema.String.pipe(
  Schema.filter(
    (value) => utf8ByteLength(value) <= FileChangesLimits.maximumPolicyEntryUtf8Bytes,
    {
      identifier: "FileChangesPolicyEntry",
      description: "a File Changes include or ignore entry within its UTF-8 budget",
    },
  ),
);

const FileChangesPolicyEntriesSchema = Schema.Array(FileChangesPolicyEntrySchema).pipe(
  Schema.filter(
    (values) => values.length <= FileChangesLimits.maximumPolicyEntries && canonicalStrings(values),
    {
      identifier: "FileChangesPolicyEntries",
      description: "an ASCII-canonical, deduplicated bounded policy entry sequence",
    },
  ),
);

export const FileChangesAttributionSchema = Schema.Struct({
  kind: Schema.Literal("agent-send-window-endpoints"),
  policy: Schema.Struct({
    defaultPolicy: Schema.Literal("niceeval.sandbox-ledger/default-excludes/v1"),
    include: FileChangesPolicyEntriesSchema,
    ignore: FileChangesPolicyEntriesSchema,
  }),
});

export type FileChangesAttribution = Schema.Schema.Type<typeof FileChangesAttributionSchema>;

const CaptureLimitationStageSchema = Schema.Literal(
  "checkpoint",
  "export",
  "finalizer-export",
  "normalize",
);

export const FileChangesCollectionLimitationSchema = Schema.Union(
  Schema.Struct({
    code: Schema.Literal("capture-failed", "capture-interrupted"),
    stage: CaptureLimitationStageSchema,
    atWindowId: Schema.NullOr(FileChangesWindowIdSchema),
  }),
  Schema.Struct({
    code: Schema.Literal("collection-cap-reached"),
    target: Schema.Literal("window", "change", "content-blob", "content-byte", "json-byte"),
    omittedAtLeast: PositiveSafeIntegerSchema,
    atWindowId: Schema.NullOr(FileChangesWindowIdSchema),
  }),
  Schema.Struct({
    code: Schema.Literal("unsupported-input"),
    target: Schema.Literal("endpoint-metadata"),
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
);

export type FileChangesCollectionLimitation = Schema.Schema.Type<
  typeof FileChangesCollectionLimitationSchema
>;

/** Stable sort / dedupe key used by both the capture producer and durable decoder. */
export function fileChangesCollectionLimitationKey(
  limitation: FileChangesCollectionLimitation,
): string {
  switch (limitation.code) {
    case "capture-failed":
    case "capture-interrupted":
      return [
        limitation.code,
        limitation.stage,
        limitation.atWindowId ?? "",
      ].join("\u0000");
    case "collection-cap-reached":
      return [
        limitation.code,
        limitation.target,
        limitation.atWindowId ?? "",
        String(limitation.omittedAtLeast),
      ].join("\u0000");
    case "unsupported-input":
      return [
        limitation.code,
        limitation.target,
        String(limitation.omittedAtLeast),
      ].join("\u0000");
  }
}

export const FileChangesCollectionStateSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(FileChangesCollectionLimitationSchema).pipe(
      Schema.filter(canonicalLimitations, {
        identifier: "FileChangesPartialLimitations",
        description: "a deterministic deduplicated File Changes limitation sequence",
      }),
    ),
  }),
);

export type FileChangesCollectionState = Schema.Schema.Type<
  typeof FileChangesCollectionStateSchema
>;

export const FileRevisionSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("text"),
    sha256: Sha256DigestSchema,
    byteLength: NonNegativeSafeIntegerSchema.pipe(
      Schema.filter(
        (value) => value <= FileChangesLimits.maximumTextRevisionBytes,
        {
          identifier: "FileChangesTextRevisionByteLength",
          description: "a retained text revision within the File Changes text budget",
        },
      ),
    ),
    content: Schema.Union(
      Schema.Struct({
        state: Schema.Literal("available"),
        ref: RecordBlobRefSchema,
      }),
      Schema.Struct({
        state: Schema.Literal("omitted"),
        reason: Schema.Literal("collection-cap"),
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("elided"),
    reason: Schema.Literal("binary", "oversized-text"),
    byteLength: NonNegativeSafeIntegerSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    reason: Schema.Literal("unsupported-input", "capture-failed", "capture-interrupted"),
  }),
);

export type FileRevision = Schema.Schema.Type<typeof FileRevisionSchema>;

export const FileEndpointSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("absent") }),
  Schema.Struct({
    state: Schema.Literal("present"),
    revision: FileRevisionSchema,
  }),
);

export type FileEndpoint = Schema.Schema.Type<typeof FileEndpointSchema>;

export const FileChangeSchema = Schema.Struct({
  changeId: FileChangeIdSchema,
  path: CanonicalProjectRelativePathSchema,
  kind: Schema.Literal("created", "modified", "deleted"),
  before: FileEndpointSchema,
  after: FileEndpointSchema,
}).pipe(
  Schema.filter(
    (change) => {
      switch (change.kind) {
        case "created":
          return change.before.state === "absent" && change.after.state === "present";
        case "modified":
          return change.before.state === "present" && change.after.state === "present";
        case "deleted":
          return change.before.state === "present" && change.after.state === "absent";
      }
    },
    {
      identifier: "FileChange",
      description: "a coherent created, modified, or deleted endpoint transition",
    },
  ),
);

export type FileChange = Schema.Schema.Type<typeof FileChangeSchema>;

const FileChangesWindowChangesSchema = Schema.Array(FileChangeSchema).pipe(
  Schema.filter(
    (changes) =>
      changes.length <= FileChangesLimits.maximumChangesPerWindow &&
      canonicalStrings(changes.map((change) => change.path)),
    {
      identifier: "FileChangesWindowChanges",
      description: "a bounded ASCII-path-canonical unique window change sequence",
    },
  ),
);

export const FileChangesWindowSchema = Schema.Struct({
  windowId: FileChangesWindowIdSchema,
  sequence: PositiveSafeIntegerSchema,
  changes: FileChangesWindowChangesSchema,
});

export type FileChangesWindow = Schema.Schema.Type<typeof FileChangesWindowSchema>;

/** Attempt-owned sandbox facts, preserving each send window rather than a net path summary. */
export const FileChangesAttachmentSchema = Schema.Struct({
  attribution: Schema.propertySignature(FileChangesAttributionSchema).pipe(
    Schema.fromKey("attribution-data"),
  ),
  collection: Schema.propertySignature(FileChangesCollectionStateSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  windows: Schema.propertySignature(Schema.Array(FileChangesWindowSchema)).pipe(
    Schema.fromKey("windows-data"),
  ),
}).pipe(
  Schema.filter(
    (payload) => {
      if (payload.windows.length > FileChangesLimits.maximumWindows) return false;
      if (payload.windows.reduce((total, window) => total + window.changes.length, 0) > FileChangesLimits.maximumRetainedChanges) {
        return false;
      }

      const windowIds = new Set<string>();
      const changeIds = new Set<string>();
      let previousSequence = 0;
      for (const [index, window] of payload.windows.entries()) {
        if (
          window.sequence <= previousSequence ||
          windowIds.has(window.windowId) ||
          (payload.collection.state === "complete" && window.sequence !== index + 1)
        ) {
          return false;
        }
        previousSequence = window.sequence;
        windowIds.add(window.windowId);
        for (const change of window.changes) {
          if (changeIds.has(change.changeId)) return false;
          changeIds.add(change.changeId);
        }
      }
      return true;
    },
    {
      identifier: "FileChangesAttachment",
      description: "a bounded coherent send-window trajectory with globally unique change ids",
    },
  ),
);

export type FileChangesAttachment = Schema.Schema.Type<
  typeof FileChangesAttachmentSchema
>;

function endpointBlobRefs(endpoint: FileEndpoint): readonly RecordBlobRef[] {
  return endpoint.state === "present" &&
      endpoint.revision.kind === "text" &&
      endpoint.revision.content.state === "available"
    ? [endpoint.revision.content.ref]
    : [];
}

export function fileChangesBlobRefs(
  payload: FileChangesAttachment,
): readonly RecordBlobRef[] {
  return Object.freeze(
    payload.windows.flatMap((window) =>
      window.changes.flatMap((change) => [
        ...endpointBlobRefs(change.before),
        ...endpointBlobRefs(change.after),
      ])
    ),
  );
}

/** Text revision metadata is meaningful only when its retained own blob matches. */
export function fileChangesAttachmentIntegrityIssues(
  payload: FileChangesAttachment,
  blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[],
): readonly RecordAttachmentIssue[] {
  const bytesByRef = new Map<RecordBlobRef, Uint8Array>(
    blobs.map((blob) => [blob.ref, blob.bytes] as const),
  );
  const issues: RecordAttachmentIssue[] = [];
  const validateEndpoint = (
    endpoint: FileEndpoint,
    path: readonly string[],
  ): void => {
    if (
      endpoint.state !== "present" ||
      endpoint.revision.kind !== "text" ||
      endpoint.revision.content.state !== "available"
    ) {
      return;
    }
    const bytes = bytesByRef.get(endpoint.revision.content.ref);
    if (bytes === undefined) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "revision", "content"]));
      return;
    }
    if (bytes.byteLength !== endpoint.revision.byteLength) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "revision", "byteLength"]));
    }
    if (createHash("sha256").update(bytes).digest("hex") !== endpoint.revision.sha256) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "revision", "sha256"]));
    }
  };

  for (const [windowIndex, window] of payload.windows.entries()) {
    for (const [changeIndex, change] of window.changes.entries()) {
      const path = ["windows", String(windowIndex), "changes", String(changeIndex)];
      validateEndpoint(change.before, [...path, "before"]);
      validateEndpoint(change.after, [...path, "after"]);
    }
  }
  return Object.freeze(issues);
}

export const FileChangesBlobBudget = Object.freeze({
  maximumBlobs: FileChangesLimits.maximumBlobs,
  maximumBlobBytes: FileChangesLimits.maximumBlobBytes,
  maximumTotalBytes: FileChangesLimits.maximumTotalBlobBytes,
});
