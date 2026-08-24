import { createHash } from "node:crypto";

import { Effect, Either, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationContent,
  type RecordMigrationDocument,
  type RecordMigrationImpact,
} from "../../../attachment/index.ts";
import { isRecordMigrationContent } from "../../../attachment/protocol.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  CanonicalProjectRelativePathSchema,
  FileChangeIdSchema,
  Sha256DigestSchema,
} from "../../../codec/identifiers.ts";
import { compareCanonicalIdentity } from "../../../model/identifiers.ts";
import {
  EmptyArraySchema,
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
} from "../../common.ts";
import {
  FileChangesAttributionSchema,
  FileChangesLimits,
  FileChangesWindowIdSchema,
  fileChangesCollectionLimitationKey,
  type FileChangesCollectionState,
} from "../schema.ts";

/**
 * Revision 1 alone knows the retired content-blob/json-byte vocabulary and
 * BlobRef-backed available text. Core supplies verified, storage-neutral
 * tokens instead of exposing those old physical pointers to the migration.
 */
const HistoricalContentSchema: Schema.Schema<RecordMigrationContent> = Schema.declare(
  isRecordMigrationContent,
);

const HistoricalCaptureStageSchema = Schema.Literal(
  "checkpoint",
  "export",
  "finalizer-export",
  "normalize",
);

const HistoricalCollectionLimitationSchema = Schema.Union(
  Schema.Struct({
    code: Schema.Literal("capture-failed", "capture-interrupted"),
    stage: HistoricalCaptureStageSchema,
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

type HistoricalCollectionLimitation = typeof HistoricalCollectionLimitationSchema.Type;

function historicalLimitationKey(limitation: HistoricalCollectionLimitation): string {
  switch (limitation.code) {
    case "capture-failed":
    case "capture-interrupted":
      return [limitation.code, limitation.stage, limitation.atWindowId ?? ""].join("\u0000");
    case "collection-cap-reached":
      return [
        limitation.code,
        limitation.target,
        limitation.atWindowId ?? "",
        String(limitation.omittedAtLeast),
      ].join("\u0000");
    case "unsupported-input":
      return [limitation.code, limitation.target, String(limitation.omittedAtLeast)].join("\u0000");
  }
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

const HistoricalCollectionStateSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("complete"), limitations: EmptyArraySchema }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(HistoricalCollectionLimitationSchema).pipe(
      Schema.filter(
        (values) => canonicalStrings(values.map(historicalLimitationKey)),
      ),
    ),
  }),
);

const HistoricalTextByteLengthSchema = NonNegativeSafeIntegerSchema.pipe(
  Schema.filter((value) => value <= FileChangesLimits.maximumTextRevisionBytes),
);

const HistoricalFileRevisionSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("text"),
    sha256: Sha256DigestSchema,
    byteLength: HistoricalTextByteLengthSchema,
    content: Schema.Union(
      Schema.Struct({
        state: Schema.Literal("available"),
        ref: HistoricalContentSchema,
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

const HistoricalEndpointSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("absent") }),
  Schema.Struct({ state: Schema.Literal("present"), revision: HistoricalFileRevisionSchema }),
);

const HistoricalFileChangeSchema = Schema.Struct({
  changeId: FileChangeIdSchema,
  path: CanonicalProjectRelativePathSchema,
  kind: Schema.Literal("created", "modified", "deleted"),
  before: HistoricalEndpointSchema,
  after: HistoricalEndpointSchema,
}).pipe(
  Schema.filter((change) => {
    switch (change.kind) {
      case "created":
        return change.before.state === "absent" && change.after.state === "present";
      case "modified":
        return change.before.state === "present" && change.after.state === "present";
      case "deleted":
        return change.before.state === "present" && change.after.state === "absent";
    }
  }),
);

const HistoricalWindowSchema = Schema.Struct({
  windowId: FileChangesWindowIdSchema,
  sequence: PositiveSafeIntegerSchema,
  changes: Schema.Array(HistoricalFileChangeSchema).pipe(
    Schema.filter((changes) =>
      changes.length <= FileChangesLimits.maximumChangesPerWindow &&
      canonicalStrings(changes.map((change) => change.path))
    ),
  ),
});

const FileChangesRevision1Schema = Schema.Struct({
  attribution: Schema.propertySignature(FileChangesAttributionSchema).pipe(
    Schema.fromKey("attribution-data"),
  ),
  collection: Schema.propertySignature(HistoricalCollectionStateSchema).pipe(
    Schema.fromKey("collection-data"),
  ),
  windows: Schema.propertySignature(Schema.Array(HistoricalWindowSchema)).pipe(
    Schema.fromKey("windows-data"),
  ),
});

type HistoricalFileChangesRevision1 = typeof FileChangesRevision1Schema.Type;
type HistoricalFileRevision = typeof HistoricalFileRevisionSchema.Type;
type ParsedFileRevision =
  | Exclude<HistoricalFileRevision, { readonly kind: "text" }>
  | {
      readonly kind: "text";
      readonly sha256: Extract<HistoricalFileRevision, { readonly kind: "text" }>["sha256"];
      readonly byteLength: number;
      readonly content:
        | { readonly state: "available"; readonly text: string }
        | { readonly state: "omitted"; readonly reason: "collection-cap" };
    };
type ParsedEndpoint =
  | { readonly state: "absent" }
  | { readonly state: "present"; readonly revision: ParsedFileRevision };
type FileChangesRevision1 = {
  readonly attribution: HistoricalFileChangesRevision1["attribution"];
  readonly collection: HistoricalFileChangesRevision1["collection"];
  readonly windows: readonly {
    readonly windowId: HistoricalFileChangesRevision1["windows"][number]["windowId"];
    readonly sequence: number;
    readonly changes: readonly {
      readonly changeId: HistoricalFileChangesRevision1["windows"][number]["changes"][number]["changeId"];
      readonly path: HistoricalFileChangesRevision1["windows"][number]["changes"][number]["path"];
      readonly kind: "created" | "modified" | "deleted";
      readonly before: ParsedEndpoint;
      readonly after: ParsedEndpoint;
    }[];
  }[];
};

interface ContentBudget {
  count: number;
  totalBytes: number;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function parseRevision(
  document: RecordMigrationDocument,
  revision: HistoricalFileRevision,
  path: readonly string[],
  budget: ContentBudget,
): Either.Either<ParsedFileRevision, RecordAttachmentIssue> {
  if (revision.kind !== "text") return Either.right(revision);
  if (revision.content.state === "omitted") {
    // Revision 1 deliberately retained no historical bytes for omitted
    // content. Its bounded byteLength/sha256 remain metadata facts only.
    return Either.right(Object.freeze({
      kind: "text" as const,
      sha256: revision.sha256,
      byteLength: revision.byteLength,
      content: revision.content,
    }));
  }

  budget.count += 1;
  budget.totalBytes += revision.byteLength;
  if (
    budget.count > FileChangesLimits.maximumContents ||
    budget.totalBytes > FileChangesLimits.maximumTotalContentBytes
  ) {
    return Either.left(invalid([...path, "content"]));
  }
  const bytes = document.content.bytes(revision.content.ref);
  if (Either.isLeft(bytes)) return Either.left(invalid([...path, "content"]));
  if (bytes.right.byteLength !== revision.byteLength) {
    return Either.left(invalid([...path, "byteLength"]));
  }
  if (createHash("sha256").update(bytes.right).digest("hex") !== revision.sha256) {
    return Either.left(invalid([...path, "sha256"]));
  }
  try {
    return Either.right(Object.freeze({
      kind: "text" as const,
      sha256: revision.sha256,
      byteLength: revision.byteLength,
      content: Object.freeze({
        state: "available" as const,
        text: decoder.decode(bytes.right),
      }),
    }));
  } catch {
    return Either.left(invalid([...path, "content"]));
  }
}

function parseEndpoint(
  document: RecordMigrationDocument,
  endpoint: typeof HistoricalEndpointSchema.Type,
  path: readonly string[],
  budget: ContentBudget,
): Either.Either<ParsedEndpoint, RecordAttachmentIssue> {
  if (endpoint.state === "absent") return Either.right(endpoint);
  const revision = parseRevision(document, endpoint.revision, [...path, "revision"], budget);
  return Either.isLeft(revision)
    ? Either.left(revision.left)
    : Either.right(Object.freeze({ state: "present" as const, revision: revision.right }));
}

function parseFileChangesRevision1(
  document: RecordMigrationDocument,
): Either.Either<FileChangesRevision1, RecordAttachmentIssue> {
  const decoded = Schema.decodeUnknownEither(
    FileChangesRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  if (Either.isLeft(decoded)) return Either.left(invalid([]));
  if (
    decoded.right.windows.length > FileChangesLimits.maximumWindows ||
    decoded.right.windows.reduce((total, window) => total + window.changes.length, 0) > FileChangesLimits.maximumRetainedChanges
  ) {
    return Either.left(invalid(["windows"]));
  }

  const windowIds = new Set<string>();
  const changeIds = new Set<string>();
  let previousSequence = 0;
  const budget: ContentBudget = { count: 0, totalBytes: 0 };
  const windows: FileChangesRevision1["windows"][number][] = [];
  for (const [windowIndex, window] of decoded.right.windows.entries()) {
    if (
      window.sequence <= previousSequence ||
      windowIds.has(window.windowId) ||
      (decoded.right.collection.state === "complete" && window.sequence !== windowIndex + 1)
    ) {
      return Either.left(invalid(["windows", String(windowIndex)]));
    }
    previousSequence = window.sequence;
    windowIds.add(window.windowId);

    const changes: FileChangesRevision1["windows"][number]["changes"][number][] = [];
    for (const [changeIndex, change] of window.changes.entries()) {
      const changePath = ["windows", String(windowIndex), "changes", String(changeIndex)];
      if (changeIds.has(change.changeId)) {
        return Either.left(invalid([...changePath, "changeId"]));
      }
      changeIds.add(change.changeId);
      const before = parseEndpoint(document, change.before, [...changePath, "before"], budget);
      if (Either.isLeft(before)) return Either.left(before.left);
      const after = parseEndpoint(document, change.after, [...changePath, "after"], budget);
      if (Either.isLeft(after)) return Either.left(after.left);
      changes.push(Object.freeze({
        changeId: change.changeId,
        path: change.path,
        kind: change.kind,
        before: before.right,
        after: after.right,
      }));
    }
    windows.push(Object.freeze({
      windowId: window.windowId,
      sequence: window.sequence,
      changes: Object.freeze(changes),
    }));
  }
  return Either.right(Object.freeze({
    attribution: decoded.right.attribution,
    collection: decoded.right.collection,
    windows: Object.freeze(windows),
  }));
}

function migrateCollection(
  collection: FileChangesRevision1["collection"],
): FileChangesCollectionState {
  if (collection.state === "complete") return collection;
  const limitations = collection.limitations.map((limitation) => {
    if (limitation.code !== "collection-cap-reached") return limitation;
    return Object.freeze({
      ...limitation,
      target: limitation.target === "content-blob"
        ? "content" as const
        : limitation.target === "json-byte"
          ? "value" as const
          : limitation.target,
    });
  });
  limitations.sort((left, right) => {
    const leftKey = fileChangesCollectionLimitationKey(left);
    const rightKey = fileChangesCollectionLimitationKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return Object.freeze({
    state: "partial" as const,
    limitations: Object.freeze(limitations) as unknown as Extract<
      FileChangesCollectionState,
      { readonly state: "partial" }
    >["limitations"],
  });
}

export const fileChangesV1ToV2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseFileChangesRevision1,
  migrate: ({ value: previous, build }) => {
    const impact: RecordMigrationImpact[] = [];
    const endpoint = (value: ParsedEndpoint, path: readonly string[]) => {
      if (value.state === "absent") return value;
      const revision = value.revision;
      if (revision.kind !== "text" || revision.content.state === "omitted") {
        return Object.freeze({ state: "present" as const, revision });
      }
      impact.push(Object.freeze({
        code: "migration-content-retained" as const,
        path: Object.freeze([...path, "revision", "content"]),
        count: 1,
        recommendation: "none" as const,
      }));
      return Object.freeze({
        state: "present" as const,
        revision: Object.freeze({
          kind: "text" as const,
          sha256: revision.sha256,
          byteLength: revision.byteLength,
          content: Object.freeze({
            state: "available" as const,
            content: build.content.text(revision.content.text),
          }),
        }),
      });
    };
    const windows = previous.windows.map((window, windowIndex) => Object.freeze({
      windowId: window.windowId,
      sequence: window.sequence,
      changes: Object.freeze(window.changes.map((change, changeIndex) => {
        const path = ["windows", String(windowIndex), "changes", String(changeIndex)];
        return Object.freeze({
          changeId: change.changeId,
          path: change.path,
          kind: change.kind,
          before: endpoint(change.before, [...path, "before"]),
          after: endpoint(change.after, [...path, "after"]),
        });
      })),
    }));
    return Effect.succeed(Object.freeze({
      value: Object.freeze({
        attribution: previous.attribution,
        collection: migrateCollection(previous.collection),
        windows: Object.freeze(windows),
      }),
      references: Object.freeze([]),
      impact: Object.freeze(impact),
    }));
  },
});
