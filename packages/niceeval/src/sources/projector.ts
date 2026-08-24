import { createHash } from "node:crypto";

import { Effect } from "effect";
import type { SourcesAttachment } from "../record/family/sources.ts";
import type { RecordAttachmentContentReader } from "../record/host/types.ts";
import type { RecordReaderReadError } from "../record/reader/errors.ts";

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
  value: SourcesAttachment,
  content: RecordAttachmentContentReader,
): Effect.Effect<SourcesProjection, SourcesProjectionError | RecordReaderReadError> {
  return Effect.gen(function* () {
    const items: SourceItemProjection[] = [];
    for (const item of value.items) {
      const bytes = yield* content.bytes(item.content);
      let text: string;
      try {
        text = strictUtf8.decode(bytes);
      } catch {
        return yield* Effect.fail(Object.freeze({
          code: "source-blob-utf8-invalid" as const,
          sourceItemId: item.sourceItemId,
        }));
      }
      if (createHash("sha256").update(text, "utf8").digest("hex") !== item.sha256) {
        return yield* Effect.fail(Object.freeze({
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
    return Object.freeze({ items: Object.freeze(items) });
  });
}

/** A fixed descriptor for internal callers; it is not a generic projector API. */
export const sourcesProjector = Object.freeze({
  project: projectSourcesAttachment,
});
