// @concord-file
// @concord-implements docs/feature/inspection/architecture.md
// @concord-implements docs/feature/inspection/architecture.md#run-inspection-insight
import { createHash } from "node:crypto";

import { Effect, Stream } from "effect";
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
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const hash = createHash("sha256");
      const fragments: string[] = [];
      const decode = (bytes?: Uint8Array) =>
        Effect.try({
          try: () => {
            fragments.push(decoder.decode(bytes, { stream: bytes !== undefined }));
          },
          catch: (): SourcesProjectionError => ({
            code: "source-blob-utf8-invalid",
            sourceItemId: item.sourceItemId,
          }),
        });
      yield* Stream.runForEach(content.stream(item.content), (bytes) => {
        hash.update(bytes);
        return decode(bytes);
      });
      yield* decode();
      if (hash.digest("hex") !== item.sha256) {
        return yield* Effect.fail({
          code: "source-blob-digest-mismatch" as const,
          sourceItemId: item.sourceItemId,
        });
      }
      items.push({
        sourceItemId: item.sourceItemId,
        path: item.path,
        sha256: item.sha256,
        text: fragments.join(""),
      });
    }
    return { items };
  });
}

/** A fixed descriptor for internal callers; it is not a generic projector API. */
export const sourcesProjector = Object.freeze({
  project: projectSourcesAttachment,
});
