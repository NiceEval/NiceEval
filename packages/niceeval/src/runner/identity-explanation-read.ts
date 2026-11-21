import { Effect } from "effect";
import { NiceEvalRecordAttachments } from "../record/family/current.ts";
import type { IdentityManifestEntry } from "../record/family/identity-manifests/schema.ts";
import type { ReadableRun, RecordReadSession } from "../record/host/types.ts";
import { explainIdentityMismatch, type IdentityExplanation } from "./manifest.ts";

const runIdentity = new WeakMap<
  ReadableRun,
  {
    readonly reader: RecordReadSession;
    readonly entries: ReadonlyMap<string, IdentityManifestEntry>;
    sourceHashes?: Readonly<Record<string, string>> | null;
  }
>();

/** The caller owns the frozen reader; no handle or lazy read escapes this operation. */
export const readIdentityExplanation = Effect.fn("readIdentityExplanation")(function* (input: {
  readonly reader: RecordReadSession;
  readonly historical: ReadableRun;
  readonly evalId: string;
  readonly current: IdentityManifestEntry | undefined;
}) {
  let identity = runIdentity.get(input.historical);
  if (identity?.reader !== input.reader) {
    const manifest = yield* input.reader.read(input.historical.owner, NiceEvalRecordAttachments.identityManifests);
    identity = {
      reader: input.reader,
      entries: new Map(
        manifest.state === "available" ? manifest.value.entries.map((entry) => [entry.evalId, entry]) : [],
      ),
    };
    runIdentity.set(input.historical, identity);
  }
  const entry = identity.entries.get(input.evalId);
  if (entry === undefined && identity.sourceHashes === undefined) {
    const sources = yield* input.reader.read(input.historical.owner, NiceEvalRecordAttachments.sources);
    identity.sourceHashes =
      sources.state === "available"
        ? Object.fromEntries(sources.value.items.map((item) => [item.path, item.sha256]))
        : null;
  }
  return {
    historical: entry,
    explanation: explainIdentityMismatch({
      historical: entry,
      current: input.current,
      context: input.historical.document.context,
      source: entry === undefined ? (identity.sourceHashes ?? undefined) : undefined,
    }),
  };
});
export interface HistoricalIdentityComparison {
  readonly historical: IdentityManifestEntry | undefined;
  readonly explanation: IdentityExplanation;
}
