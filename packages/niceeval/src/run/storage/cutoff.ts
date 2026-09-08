import { createHash } from "node:crypto";

import type { PublicationCutoff } from "./types.ts";

/** Stable public identity for one exact Run publication clock position. */
export function publicationCutoffIdentity(cutoff: PublicationCutoff): string {
  return createHash("sha256")
    .update("niceeval.run-publication-cutoff/v1\0")
    .update(cutoff.storeGeneration)
    .update("\0")
    .update(String(cutoff.revision))
    .digest("hex");
}
