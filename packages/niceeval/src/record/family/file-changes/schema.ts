import { Schema } from "effect";
import {
  RecordTextContentSchema,
  recordAttachmentIssue,
  recordContent,
  type RecordAttachmentIssue,
} from "../../attachment/index.ts";
import {
  CanonicalProjectRelativePathSchema,
  FileChangeIdSchema,
  Sha256DigestSchema,
} from "../../codec/identifiers.ts";
import { compareCanonicalIdentity } from "../../model/identifiers.ts";
import {
  EmptyArraySchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
} from "../common.ts";

/** Immutable per-Attempt budgets for the fixed File Changes family. */
export const FileChangesLimits = Object.freeze({
  maximumWindows: 256,
  maximumChangesPerWindow: 10_000,
  maximumRetainedChanges: 10_000,
  maximumTextRevisionBytes: 1024 * 1024,
  maximumContents: 20_000,
  maximumContentBytes: 1024 * 1024,
  maximumTotalContentBytes: 128 * 1024 * 1024,
  maximumPayloadJsonBytes: 16 * 1024 * 1024,
  maximumPolicyEntries: 256,
  maximumPolicyEntryUtf8Bytes: 4096,
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
  Schema.check(Schema.makeFilter(
    (value) => /^(?:turn[1-9][0-9]*|session[1-9][0-9]*\/turn[1-9][0-9]*)$/.test(value),
    {
      identifier: "FileChangesWindowId",
      description: "a canonical agent send-window id",
    },
  )),
);

const FileChangesPolicyEntrySchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter(
    (value) => utf8ByteLength(value) <= FileChangesLimits.maximumPolicyEntryUtf8Bytes,
    {
      identifier: "FileChangesPolicyEntry",
      description: "a File Changes include or ignore entry within its UTF-8 budget",
    },
  )),
);

const FileChangesPolicyEntriesSchema = Schema.Array(FileChangesPolicyEntrySchema).pipe(
  Schema.check(Schema.makeFilter(
    (values) => values.length <= FileChangesLimits.maximumPolicyEntries && canonicalStrings(values),
    {
      identifier: "FileChangesPolicyEntries",
      description: "an ASCII-canonical, deduplicated bounded policy entry sequence",
    },
  )),
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

const CaptureLimitationStageSchema = Schema.Literals([
  "checkpoint",
  "export",
  "finalizer-export",
  "normalize",
]);

export const FileChangesCollectionLimitationSchema = Schema.Union([
  Schema.Struct({
    code: Schema.Literals(["capture-failed", "capture-interrupted"]),
    stage: CaptureLimitationStageSchema,
    atWindowId: Schema.NullOr(FileChangesWindowIdSchema),
  }),
  Schema.Struct({
    code: Schema.Literal("collection-cap-reached"),
    target: Schema.Literals(["window", "change", "content", "value", "content-byte"]),
    omittedAtLeast: PositiveSafeIntegerSchema,
    atWindowId: Schema.NullOr(FileChangesWindowIdSchema),
  }),
  Schema.Struct({
    code: Schema.Literal("unsupported-input"),
    target: Schema.Literal("endpoint-metadata"),
    omittedAtLeast: PositiveSafeIntegerSchema,
  }),
]);

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

export const FileChangesCollectionStateSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: EmptyArraySchema,
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(FileChangesCollectionLimitationSchema).pipe(
      Schema.check(Schema.makeFilter(canonicalLimitations, {
        identifier: "FileChangesPartialLimitations",
        description: "a deterministic deduplicated File Changes limitation sequence",
      })),
    ),
  }),
]);

export type FileChangesCollectionState = Schema.Schema.Type<
  typeof FileChangesCollectionStateSchema
>;

/** Text revision sha256 is a fact identity, never a physical content key. */
export const FileRevisionSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("text"),
    sha256: Sha256DigestSchema,
    byteLength: NonNegativeSafeIntegerSchema.pipe(
      Schema.check(Schema.makeFilter(
        (value) => value <= FileChangesLimits.maximumTextRevisionBytes,
        {
          identifier: "FileChangesTextRevisionByteLength",
          description: "a retained text revision within the File Changes text budget",
        },
      )),
    ),
    content: Schema.Union([
      Schema.Struct({
        state: Schema.Literal("available"),
        content: RecordTextContentSchema.pipe(
          recordContent.maximumBytes(FileChangesLimits.maximumContentBytes),
        ),
      }),
      Schema.Struct({
        state: Schema.Literal("omitted"),
        reason: Schema.Literal("collection-cap"),
      }),
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal("elided"),
    reason: Schema.Literals(["binary", "oversized-text"]),
    byteLength: NonNegativeSafeIntegerSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    reason: Schema.Literals(["unsupported-input", "capture-failed", "capture-interrupted"]),
  }),
]);

export type FileRevision = Schema.Schema.Type<typeof FileRevisionSchema>;

export const FileEndpointSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literal("absent") }),
  Schema.Struct({
    state: Schema.Literal("present"),
    revision: FileRevisionSchema,
  }),
]);

export type FileEndpoint = Schema.Schema.Type<typeof FileEndpointSchema>;

export const FileChangeSchema = Schema.Struct({
  changeId: FileChangeIdSchema,
  path: CanonicalProjectRelativePathSchema,
  kind: Schema.Literals(["created", "modified", "deleted"]),
  before: FileEndpointSchema,
  after: FileEndpointSchema,
}).pipe(
  Schema.check(Schema.makeFilter(
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
  )),
);

export type FileChange = Schema.Schema.Type<typeof FileChangeSchema>;

const FileChangesWindowChangesSchema = Schema.Array(FileChangeSchema).pipe(
  Schema.check(Schema.makeFilter(
    (changes) =>
      changes.length <= FileChangesLimits.maximumChangesPerWindow &&
      canonicalStrings(changes.map((change) => change.path)),
    {
      identifier: "FileChangesWindowChanges",
      description: "a bounded ASCII-path-canonical unique window change sequence",
    },
  )),
);

export const FileChangesWindowSchema = Schema.Struct({
  windowId: FileChangesWindowIdSchema,
  sequence: PositiveSafeIntegerSchema,
  changes: FileChangesWindowChangesSchema,
});

export type FileChangesWindow = Schema.Schema.Type<typeof FileChangesWindowSchema>;

/** Attempt-owned sandbox facts, preserving each send window rather than a net path summary. */
export const FileChangesAttachmentSchema = Schema.Struct({
  attribution: FileChangesAttributionSchema,
  collection: FileChangesCollectionStateSchema,
  windows: Schema.Array(FileChangesWindowSchema),
}).pipe(Schema.encodeKeys({
  attribution: "attribution-data",
  collection: "collection-data",
  windows: "windows-data",
}));

export type FileChangesAttachment = Schema.Schema.Type<
  typeof FileChangesAttachmentSchema
>;

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

/**
 * Core enforces each available content declaration limit and owns physical
 * read integrity. This logical validator cannot open sealed content handles;
 * producers must derive byteLength and sha256 from the same revision source.
 */
export function validateFileChangesAttachment(
  value: FileChangesAttachment,
): readonly RecordAttachmentIssue[] {
  const issues: RecordAttachmentIssue[] = [];
  if (value.windows.length > FileChangesLimits.maximumWindows) {
    issues.push(invalid(["windows"]));
  }
  if (value.windows.reduce((total, window) => total + window.changes.length, 0) > FileChangesLimits.maximumRetainedChanges) {
    issues.push(invalid(["windows", "changes"]));
  }

  const windowIds = new Set<string>();
  const changeIds = new Set<string>();
  let previousSequence = 0;
  for (const [index, window] of value.windows.entries()) {
    if (
      window.sequence <= previousSequence ||
      windowIds.has(window.windowId) ||
      (value.collection.state === "complete" && window.sequence !== index + 1)
    ) {
      issues.push(invalid(["windows", String(index)]));
    }
    previousSequence = window.sequence;
    windowIds.add(window.windowId);
    for (const [changeIndex, change] of window.changes.entries()) {
      if (changeIds.has(change.changeId)) {
        issues.push(invalid(["windows", String(index), "changes", String(changeIndex), "changeId"]));
      }
      changeIds.add(change.changeId);
    }
  }
  return Object.freeze(issues);
}
