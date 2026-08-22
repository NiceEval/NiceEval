import { createHash } from "node:crypto";

import { Schema } from "effect";
import { assertionBlobRefs } from "../../../assertions/record/attachment.ts";
import {
  AssertionEntryIdSchema,
  MAX_ASSERTION_DOCUMENT_BYTES,
  createAssertionsRecordSchemas,
} from "../../../assertions/record/codec.ts";
import {
  RecordBlobRefSchema,
  type RecordBlobRef,
} from "../../attachment/blob-ref.ts";
import { recordAttachmentIssue, type RecordAttachmentIssue } from "../../attachment/errors.ts";
import { defineRecordAttachment } from "../../definition/index.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../codec/identifiers.ts";
import {
  FixedAttachmentValueLimits,
  PositiveSafeIntegerSchema,
} from "../common.ts";
import type { SourcesAttachment } from "../sources.ts";

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
  RecordBlobRefSchema,
);

/** Reuse the existing v1 entry schema inside the one direct attachment schema. */
export const AssertionsEntriesSchema = assertionSchemas.entries;
export const AssertionsEntriesV1Schema = assertionSchemas.historicalEntries;
export const AssertionSourceSitesSchema = Schema.Array(AssertionSourceSiteSchema);

function hasNoLegacyAttachmentMaterial(
  document: {
      readonly entries: readonly {
      readonly materials: {
        readonly source: { readonly kind: string };
        readonly evidence: readonly { readonly kind: string }[];
      };
    }[];
  },
): boolean {
  const materialIsAllowed = (material: { readonly kind: string }): boolean =>
    material.kind !== "record-attachment";
  return document.entries.every(
    (entry) =>
      materialIsAllowed(entry.materials.source) && entry.materials.evidence.every(materialIsAllowed),
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

function hasUniqueAssertionEntryIds(document: {
  readonly entries: readonly { readonly entryId: string }[];
}): boolean {
  const entryIds = new Set<string>();
  for (const entry of document.entries) {
    if (entryIds.has(entry.entryId)) return false;
    entryIds.add(entry.entryId);
  }
  return true;
}

function isAssertionsDocumentWithinSizeLimit(value: unknown): boolean {
  try {
    const serialized = JSON.stringify(value);
    return typeof serialized === "string" &&
      new TextEncoder().encode(serialized).byteLength <= MAX_ASSERTION_DOCUMENT_BYTES;
  } catch {
    return false;
  }
}

/**
 * `sourceSites` is embedded in the fixed Assertions payload. The former
 * `niceeval.assertion-source-sites/v1` family is not part of Record v1.
 */
/** One direct current schema: Type fields and durable keys share all v1 filters. */
export const AssertionsAttachmentSchema = Schema.Struct({
  entries: Schema.propertySignature(AssertionsEntriesSchema).pipe(
    Schema.fromKey("entries-data"),
  ),
  sourceSites: Schema.propertySignature(AssertionSourceSitesSchema).pipe(
    Schema.fromKey("source-sites-data"),
  ),
}).pipe(
  Schema.filter(hasUniqueAssertionEntryIds, {
    identifier: "AssertionsUniqueEntryIds",
    description: "unique attachment-local assertion entry IDs",
  }),
  Schema.filter(isAssertionsDocumentWithinSizeLimit, {
    identifier: "AssertionsDocumentSize",
    description: "a JSON document no larger than 4 MiB",
  }),
  Schema.filter(hasNoLegacyAttachmentMaterial, {
    identifier: "AssertionsNoLegacyAttachmentMaterial",
    description: "Assertions do not reference retired attachment families",
  }),
  Schema.filter(hasCanonicalSourceSites, {
    identifier: "AssertionsSourceSites",
    description: "source sites join local entries with unique canonical source order",
  }),
);

/** @internal Package-private historical wire codec, loaded only by maintenance. */
export const AssertionsAttachmentV1Schema = Schema.Struct({
  entries: Schema.propertySignature(AssertionsEntriesV1Schema).pipe(
    Schema.fromKey("entries-data"),
  ),
  sourceSites: Schema.propertySignature(AssertionSourceSitesSchema).pipe(
    Schema.fromKey("source-sites-data"),
  ),
});

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
  const validateMaterial = (material: AssertionsAttachment["entries"][number]["materials"]["source"], path: readonly string[]) => {
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
    validateMaterial(entry.materials.source, ["entries", String(index), "materials", "source"]);
    for (const [evidenceIndex, material] of entry.materials.evidence.entries()) {
      validateMaterial(material, ["entries", String(index), "evidence", String(evidenceIndex)]);
    }
  }
  return Object.freeze(issues);
}

/**
 * Host-only semantic join to the exact origin Sources manifest.  The row owns
 * neither source bytes nor a blob capability, so this check deliberately
 * compares only the explicit item identity, digest, and stored coordinates.
 */
export function assertionsSourceSiteIntegrityIssues(
  payload: AssertionsAttachment,
  sources: SourcesAttachment,
): readonly RecordAttachmentIssue[] {
  const sourceById = new Map(sources.items.map((item) => [item.sourceItemId, item] as const));
  const issues: RecordAttachmentIssue[] = [];
  for (const [index, site] of payload.sourceSites.entries()) {
    const source = sourceById.get(site.sourceItemId);
    const startsAfterEnd = site.start.line > site.end.line ||
      (site.start.line === site.end.line && site.start.column > site.end.column);
    if (source === undefined || source.sha256 !== site.sha256 || startsAfterEnd) {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["sourceSites", String(index)]));
    }
  }
  return Object.freeze(issues);
}

const AssertionsBlobBudget = Object.freeze({
  maximumBlobs: 20_000,
  maximumBlobBytes: 16 * 1024 * 1024,
  maximumTotalBytes: 64 * 1024 * 1024,
});

/** The sole current declaration for the Attempt-owned Assertions family. */
export const assertionsRecordAttachment = defineRecordAttachment({
  family: "niceeval.assertions",
  current: {
    schemaVersion: 2,
    owners: {
      attempt: {
        schema: AssertionsAttachmentSchema,
        limits: FixedAttachmentValueLimits,
        blobs: {
          refs: assertionsBlobRefs,
          budget: AssertionsBlobBudget,
          verify: assertionsAttachmentIntegrityIssues,
        },
      },
    },
  },
  maintenance: () => import("./migrate/1-to-2.ts").then(
    ({ assertionsV1Maintenance }) => assertionsV1Maintenance,
  ),
  adjacentMigrationLinks: Object.freeze([
    Object.freeze({ fromSchemaVersion: 1, toSchemaVersion: 2, rewritePayload: true }),
  ]),
});
