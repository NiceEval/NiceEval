import { createHash, randomUUID } from "node:crypto";

import { Either, Schema, Stream } from "effect";
import {
  makeFixedRecordAttachmentWrite,
  makeRecordBlobSource,
  validateRecordAttachmentWrite,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import { fileChangesRecordFamily } from "../../record/family/catalog.ts";
import {
  FileChangesAttachmentSchema,
  type FileChangesAttachment,
} from "../../record/family/file-changes.ts";
import { RecordExactParseOptions } from "../../record/codec/core.ts";
import { type AgentWorkspaceDiff } from "../workspace-diff.ts";

/**
 * Adapts the post-run sandbox ledger to the sole Attempt-owned File Changes
 * family. Send-window grouping and hunks remain runtime evidence; they are
 * not a second durable attachment schema.
 */
export type FileChangesProducerError = {
  readonly code: "file-changes-attachment-input-invalid";
};

const inputInvalid: FileChangesProducerError = Object.freeze({
  code: "file-changes-attachment-input-invalid" as const,
});

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function nextChangeId(): string {
  return `fc_${randomUUID().replaceAll("-", "")}`;
}

function lastChangesByPath(value: AgentWorkspaceDiff): readonly {
  readonly path: string;
  readonly status: "added" | "modified" | "deleted";
  readonly before: (typeof value.windows)[number]["changes"][number]["before"];
  readonly after: (typeof value.windows)[number]["changes"][number]["after"];
}[] {
  const byPath = new Map<string, {
    readonly path: string;
    readonly status: "added" | "modified" | "deleted";
    readonly before: (typeof value.windows)[number]["changes"][number]["before"];
    readonly after: (typeof value.windows)[number]["changes"][number]["after"];
  }>();
  for (const window of value.windows) {
    for (const change of window.changes) {
      byPath.set(change.path, change);
    }
  }
  return Object.freeze([...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  ));
}

function collectionFor(
  changes: readonly {
    readonly before: { readonly state: string; readonly bytes?: number };
    readonly after: { readonly state: string; readonly bytes?: number };
  }[],
): { readonly state: "complete"; readonly limitations: readonly [] } | {
  readonly state: "partial";
  readonly limitations: readonly [{ readonly code: "unsupported-input"; readonly omittedAtLeast: number }];
} {
  const unknownLengths = changes.reduce(
    (count, change) =>
      count
      + (change.before.state === "elided" && change.before.bytes === undefined ? 1 : 0)
      + (change.after.state === "elided" && change.after.bytes === undefined ? 1 : 0),
    0,
  );
  if (unknownLengths === 0) {
    return Object.freeze({ state: "complete" as const, limitations: [] as const });
  }
  return Object.freeze({
    state: "partial" as const,
    limitations: [
      Object.freeze({
        code: "unsupported-input" as const,
        omittedAtLeast: unknownLengths,
      }),
    ] as const,
  });
}

/**
 * A fixed-family writer. Text revisions receive their own closure blobs;
 * binary/elided bytes are represented without inventing an external ref.
 */
export function createAgentWorkspaceDiffAttachmentWrite(
  value: AgentWorkspaceDiff,
): RecordAttachmentWrite<"attempt", never, never> {
  const changes = lastChangesByPath(value);
  const write = makeFixedRecordAttachmentWrite(
    fileChangesRecordFamily.write,
    (blobs) => {
      const drafts: RecordAttachmentBlobDraft<never, never>[] = [];
      const candidateChanges = changes.map((change) => {
        const revision = (
          endpoint: typeof change.before | typeof change.after,
        ): unknown => {
          switch (endpoint.state) {
            case "absent":
              return null;
            case "text": {
              const content = bytes(endpoint.text);
              const draft = blobs.add(makeRecordBlobSource(Stream.succeed(content)));
              drafts.push(draft);
              return Object.freeze({
                kind: "text" as const,
                sha256: sha256(endpoint.text),
                byteLength: content.byteLength,
                content: draft.ref,
              });
            }
            case "elided":
              return endpoint.bytes === undefined
                ? null
                : Object.freeze({
                    kind: endpoint.reason === "binary" ? "binary" as const : "elided" as const,
                    byteLength: endpoint.bytes,
                  });
          }
        };

        const before = revision(change.before);
        const after = revision(change.after);
        const missingElidedLength =
          (change.before.state === "elided" && change.before.bytes === undefined)
          || (change.after.state === "elided" && change.after.bytes === undefined);
        return Object.freeze(
          missingElidedLength
            ? {
                changeId: nextChangeId(),
                path: change.path,
                kind: "unavailable" as const,
                before: null,
                after: null,
              }
            : {
                changeId: nextChangeId(),
                path: change.path,
                kind:
                  change.status === "added"
                    ? "created" as const
                    : change.status === "deleted"
                      ? "deleted" as const
                      : "modified" as const,
                before,
                after,
              },
        );
      });
      candidateChanges.sort((left, right) => left.changeId.localeCompare(right.changeId));
      const decoded = Schema.decodeUnknownEither(
        FileChangesAttachmentSchema,
        RecordExactParseOptions,
      )(
        Object.freeze({
          collection: collectionFor(changes),
          changes: Object.freeze(candidateChanges),
        }),
      );
      if (Either.isLeft(decoded)) {
        throw new Error("File Changes collector produced an invalid fixed-family payload");
      }
      return Object.freeze({ payload: decoded.right, blobs: Object.freeze(drafts) });
    },
  );
  const closure = validateRecordAttachmentWrite(write);
  if (Either.isLeft(closure)) {
    throw new Error("File Changes collector produced an invalid owner-local closure");
  }
  return write;
}

/** Preflight preserves the existing Runner call site without defining a schema. */
export function assertAgentWorkspaceDiffRecordable(value: AgentWorkspaceDiff): void {
  createAgentWorkspaceDiffAttachmentWrite(value);
}

/** Pure helper for consumers that already hold an available fixed-family value. */
export function projectFileChangesAttachment(
  payload: FileChangesAttachment,
): FileChangesAttachment {
  return Object.freeze({
    collection: payload.collection,
    changes: Object.freeze([...payload.changes]),
  });
}
