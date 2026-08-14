import { createHash } from "node:crypto";

import { Schema } from "effect";
import {
  CanonicalProjectRelativePathSchema,
  FileChangeIdSchema,
  Sha256DigestSchema,
} from "../codec/identifiers.ts";
import type { RecordBlobRef } from "../attachment/types.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../attachment/errors.ts";
import {
  CollectionStateSchema,
  NonNegativeSafeIntegerSchema,
  RecordBlobRefPositionSchema,
  isCanonicalIdentitySequence,
} from "./common.ts";

export const FileRevisionSchema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("text"),
    sha256: Sha256DigestSchema,
    byteLength: NonNegativeSafeIntegerSchema,
    content: Schema.NullOr(RecordBlobRefPositionSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("binary", "elided"),
    byteLength: NonNegativeSafeIntegerSchema,
  }),
);

export type FileRevision = Schema.Schema.Type<typeof FileRevisionSchema>;

export const FileChangeSchema = Schema.Struct({
  changeId: FileChangeIdSchema,
  path: CanonicalProjectRelativePathSchema,
  kind: Schema.Literal("created", "modified", "deleted", "unavailable"),
  before: Schema.NullOr(FileRevisionSchema),
  after: Schema.NullOr(FileRevisionSchema),
}).pipe(
  Schema.filter(
    (change) => {
      switch (change.kind) {
        case "created":
          return change.before === null && change.after !== null;
        case "modified":
          return change.before !== null && change.after !== null;
        case "deleted":
          return change.before !== null && change.after === null;
        case "unavailable":
          return change.before === null && change.after === null;
      }
    },
    {
      identifier: "FileChange",
      description: "a change kind with truthful before/after revision presence",
    },
  ),
);

export type FileChange = Schema.Schema.Type<typeof FileChangeSchema>;

/** Attempt-owned sandbox/collector file facts; file content stays in this closure. */
export const FileChangesAttachmentSchema = Schema.Struct({
  collection: CollectionStateSchema,
  changes: Schema.Array(FileChangeSchema),
}).pipe(
  Schema.filter(
    (payload) => {
      if (!isCanonicalIdentitySequence(payload.changes.map((change) => change.changeId))) {
        return false;
      }
      return new Set(payload.changes.map((change) => change.path)).size === payload.changes.length;
    },
    {
      identifier: "FileChangesAttachment",
      description: "canonical unique file-change identities and paths",
    },
  ),
);

export type FileChangesAttachment = Schema.Schema.Type<
  typeof FileChangesAttachmentSchema
>;

function revisionBlobRefs(revision: FileRevision | null): readonly RecordBlobRef[] {
  return revision?.kind === "text" && revision.content !== null
    ? [revision.content]
    : [];
}

export function fileChangesBlobRefs(
  payload: FileChangesAttachment,
): readonly RecordBlobRef[] {
  return Object.freeze(
    payload.changes.flatMap((change) => [
      ...revisionBlobRefs(change.before),
      ...revisionBlobRefs(change.after),
    ]),
  );
}

/** Text revision metadata is meaningful only when its retained blob matches. */
export function fileChangesAttachmentIntegrityIssues(
  payload: FileChangesAttachment,
  blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[],
): readonly RecordAttachmentIssue[] {
  const bytesByRef = new Map<RecordBlobRef, Uint8Array>(
    blobs.map((blob) => [blob.ref, blob.bytes] as const),
  );
  const issues: RecordAttachmentIssue[] = [];
  const validateRevision = (
    revision: FileRevision | null,
    path: readonly string[],
  ): void => {
    if (revision?.kind !== "text" || revision.content === null) return;
    const bytes = bytesByRef.get(revision.content);
    if (bytes === undefined) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "content"]));
      return;
    }
    if (bytes.byteLength !== revision.byteLength) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "byteLength"]));
    }
    if (createHash("sha256").update(bytes).digest("hex") !== revision.sha256) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", [...path, "sha256"]));
    }
  };
  for (const [index, change] of payload.changes.entries()) {
    validateRevision(change.before, ["changes", String(index), "before"]);
    validateRevision(change.after, ["changes", String(index), "after"]);
  }
  return Object.freeze(issues);
}
