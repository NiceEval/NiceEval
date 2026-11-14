import { Effect } from "effect";
import { NiceEvalRecordAttachments } from "../record/family/current.ts";
import type { IdentityManifestEntry } from "../record/family/identity-manifests/schema.ts";
import type { ReadableRun, RecordReadSession } from "../record/host/types.ts";
import { explainIdentityMismatch, type IdentityExplanation } from "./manifest.ts";

/** The caller owns the frozen reader; no handle or lazy read escapes this operation. */
export const readIdentityExplanation = Effect.fn("readIdentityExplanation")(function* (input: {
  readonly reader: RecordReadSession;
  readonly historical: ReadableRun;
  readonly evalId: string;
  readonly current?: IdentityManifestEntry;
}) {
  const manifest = yield* input.reader.read(input.historical.owner, NiceEvalRecordAttachments.identityManifests);
  const entry =
    manifest.state === "available" ? manifest.value.entries.find((entry) => entry.evalId === input.evalId) : undefined;
  let source: Readonly<Record<string, string>> | undefined;
  if (entry === undefined) {
    const sources = yield* input.reader.read(input.historical.owner, NiceEvalRecordAttachments.sources);
    if (sources.state === "available")
      source = Object.fromEntries(sources.value.items.map((item) => [item.path, item.sha256]));
  }
  return Object.freeze({
    historical: entry,
    explanation: explainIdentityMismatch({
      ...(entry === undefined ? {} : { historical: entry }),
      ...(input.current === undefined ? {} : { current: input.current }),
      context: input.historical.document.context,
      ...(source === undefined ? {} : { source }),
    }),
  });
});
export interface HistoricalIdentityComparison {
  readonly historical: IdentityManifestEntry | undefined;
  readonly explanation: IdentityExplanation;
}
