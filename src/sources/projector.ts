import { createHash } from "node:crypto";

import { Either } from "effect";
import type {
  RecordAttachmentBlobs,
  RecordAttachmentPayloadSnapshot,
} from "../record/attachment/index.ts";
import { sourcesAttachmentWrite } from "./attachment.ts";
import type { SourcesAttachment } from "../record/family/sources.ts";

export interface SourceItemProjection {
  readonly sourceItemId: string;
  readonly path: string;
  readonly sha256: string;
  readonly text: string;
}

export interface SourcesProjection {
  readonly items: readonly SourceItemProjection[];
}

export type SourcesProjectionError =
  | { readonly code: "source-blob-unavailable"; readonly sourceItemId: string }
  | { readonly code: "source-blob-utf8-invalid"; readonly sourceItemId: string }
  | { readonly code: "source-blob-digest-mismatch"; readonly sourceItemId: string };

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Produces a self-contained projection from the available fixed Sources
 * closure. It never reopens the Record or consults the consumer worktree.
 */
export function projectSourcesAttachment(
  value: RecordAttachmentPayloadSnapshot<SourcesAttachment>,
  blobs: RecordAttachmentBlobs,
): Either.Either<SourcesProjection, SourcesProjectionError> {
  const items: SourceItemProjection[] = [];
  for (const item of value.items) {
    const bytes = blobs.bytes(item.content);
    if (Either.isLeft(bytes)) {
      return Either.left(Object.freeze({
        code: "source-blob-unavailable" as const,
        sourceItemId: item.sourceItemId,
      }));
    }
    let text: string;
    try {
      text = strictUtf8.decode(bytes.right);
    } catch {
      return Either.left(Object.freeze({
        code: "source-blob-utf8-invalid" as const,
        sourceItemId: item.sourceItemId,
      }));
    }
    if (createHash("sha256").update(text, "utf8").digest("hex") !== item.sha256) {
      return Either.left(Object.freeze({
        code: "source-blob-digest-mismatch" as const,
        sourceItemId: item.sourceItemId,
      }));
    }
    items.push(Object.freeze({
      sourceItemId: item.sourceItemId,
      path: item.path,
      sha256: item.sha256,
      text,
    }));
  }
  return Either.right(Object.freeze({ items: Object.freeze(items) }));
}

/** A fixed descriptor for internal callers; it is not a generic projector API. */
export const sourcesProjector = Object.freeze({
  write: sourcesAttachmentWrite,
  project: projectSourcesAttachment,
});
