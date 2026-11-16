import { Schema } from "effect";
import type { EvalManifest } from "../record/manifest.ts";
import { IdentityManifestEntrySchema, type IdentityManifestEntry } from "../record/family/identity-manifests/schema.ts";

/** Schema decoding detaches the manifest from the mutable planning maps. */
export function identityManifestEntry(evalId: string, manifest: EvalManifest): IdentityManifestEntry {
  return Schema.decodeUnknownSync(IdentityManifestEntrySchema, { onExcessProperty: "error" })({
    evalId,
    niceeval: manifest.niceeval,
    config: manifest.config,
    ...(manifest.plan === undefined ? {} : { plan: manifest.plan }),
    ...(manifest.plugins === undefined ? {} : { plugins: manifest.plugins }),
    source: manifest.source,
    data: manifest.data,
  });
}
