import { createHash } from "node:crypto";

import { Schema } from "effect";
import { assertionBlobRefs } from "../../assertions/record/attachment.ts";
import {
  AssertionEntryIdSchema,
  createAssertionsRecordSchemas,
} from "../../assertions/record/codec.ts";
import type { AssertionsDocumentOuter } from "../../assertions/record/model.ts";
import type { RecordBlobRef } from "../attachment/types.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../attachment/errors.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../codec/identifiers.ts";
import {
  PositiveSafeIntegerSchema,
  RecordBlobRefPositionSchema,
} from "./common.ts";

const AssertionSourceRoleSchema = Schema.Literal(
  "declaration",
  "threshold",
  "score",
  "gate",
  "optional",
  "stop",
);

const AssertionSourcePositionSchema = Schema.Struct({
  line: PositiveSafeIntegerSchema,
  column: PositiveSafeIntegerSchema,
});

/**
 * A source site is a semantic join only. It names an item in the exact origin
 * Run Sources payload and never gains that payload's blob capability.
 */
export const AssertionSourceSiteSchema = Schema.Struct({
  entryId: AssertionEntryIdSchema,
  sourceOrder: PositiveSafeIntegerSchema,
  role: AssertionSourceRoleSchema,
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: AssertionSourcePositionSchema,
  end: AssertionSourcePositionSchema,
});

export type AssertionSourceSite = Schema.Schema.Type<
  typeof AssertionSourceSiteSchema
>;

const assertionSchemas = createAssertionsRecordSchemas(
  RecordBlobRefPositionSchema,
);

/** Property-level owner value schema; the full attachment schema refines both fields together. */
export const AssertionsEntriesSchema = assertionSchemas.entries;
export const AssertionSourceSitesSchema = Schema.Array(AssertionSourceSiteSchema);

function hasNoLegacyAttachmentMaterial(
  document: AssertionsDocumentOuter<RecordBlobRef>,
): boolean {
  const materialIsAllowed = (material: { readonly kind: string }): boolean =>
    material.kind !== "record-attachment";
  return document.entries.every(
    (entry) =>
      materialIsAllowed(entry.subject) && entry.evidence.every(materialIsAllowed),
  );
}

function hasCanonicalSourceSites(payload: {
  readonly entries: readonly { readonly entryId: string }[];
  readonly sourceSites: readonly AssertionSourceSite[];
}): boolean {
  const entryIds = new Set(payload.entries.map((entry) => entry.entryId));
  const seenOrders = new Set<number>();
  let previous: string | undefined;
  for (const site of payload.sourceSites) {
    if (!entryIds.has(site.entryId) || seenOrders.has(site.sourceOrder)) return false;
    seenOrders.add(site.sourceOrder);
    const key = `${site.entryId}\u0000${site.sourceOrder.toString().padStart(16, "0")}`;
    if (previous !== undefined && previous >= key) return false;
    previous = key;
  }
  return true;
}

/**
 * `sourceSites` is embedded in the fixed Assertions payload. The former
 * `niceeval.assertion-source-sites/v1` family is not part of Record v1.
 */
export const AssertionsAttachmentSchema = assertionSchemas.outerDocument.pipe(
  Schema.extend(
    Schema.Struct({
      sourceSites: AssertionSourceSitesSchema,
    }),
  ),
  Schema.filter(hasNoLegacyAttachmentMaterial, {
    identifier: "AssertionsNoLegacyAttachmentMaterial",
    description: "Assertions do not reference retired attachment families",
  }),
  Schema.filter(hasCanonicalSourceSites, {
    identifier: "AssertionsSourceSites",
    description: "source sites join local entries with unique canonical source order",
  }),
);

export type AssertionsAttachment = Schema.Schema.Type<
  typeof AssertionsAttachmentSchema
>;

/** Complete closure projection for `niceeval.assertions`. */
export function assertionsBlobRefs(
  payload: AssertionsAttachment,
): readonly RecordBlobRef[] {
  return assertionBlobRefs(payload);
}

/** Binds every Assertions blob declaration to its exact materialized bytes. */
export function assertionsAttachmentIntegrityIssues(
  payload: AssertionsAttachment,
  blobs: readonly { readonly ref: RecordBlobRef; readonly bytes: Uint8Array }[],
): readonly RecordAttachmentIssue[] {
  const bytesByRef = new Map<RecordBlobRef, Uint8Array>(
    blobs.map((blob) => [blob.ref, blob.bytes] as const),
  );
  const issues: RecordAttachmentIssue[] = [];
  const validateMaterial = (material: AssertionsAttachment["entries"][number]["subject"], path: readonly string[]) => {
    if (material.kind !== "blob") return;
    const bytes = bytesByRef.get(material.ref);
    if (bytes === undefined || bytes.byteLength !== material.byteLength) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", [
        ...path,
        bytes === undefined ? "ref" : "byteLength",
      ]));
      return;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== material.sha256) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", [
        ...path,
        "sha256",
      ]));
    }
  };
  for (const [index, entry] of payload.entries.entries()) {
    validateMaterial(entry.subject, ["entries", String(index), "subject"]);
    for (const [evidenceIndex, material] of entry.evidence.entries()) {
      validateMaterial(material, ["entries", String(index), "evidence", String(evidenceIndex)]);
    }
  }
  return Object.freeze(issues);
}
