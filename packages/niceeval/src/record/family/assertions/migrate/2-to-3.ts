import { Effect, Either } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationBuilder,
  type RecordMigrationContent,
  type RecordMigrationDocument,
  type RecordMigrationImpact,
} from "../../../attachment/index.ts";
import { sourcesRecordAttachment } from "../../sources/definition.ts";
import {
  parseAssertionsRevision2,
  type AssertionsRevision2Material,
} from "./revision-2.ts";

type MigratedMaterial =
  | { readonly kind: "unavailable"; readonly reason: "not-recorded" }
  | {
      readonly kind: "content";
      readonly content: RecordMigrationContent;
      readonly encoding: "json" | "utf-8" | "binary";
      readonly byteLength: number;
      readonly preview: string | null;
    };

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function retained(path: readonly string[]): RecordMigrationImpact {
  return Object.freeze({
    code: "migration-content-retained",
    path: Object.freeze([...path]),
    count: 1,
    recommendation: "none",
  });
}

function migrateMaterial(
  material: AssertionsRevision2Material,
  path: readonly string[],
  document: RecordMigrationDocument,
  build: RecordMigrationBuilder,
  impact: RecordMigrationImpact[],
): Either.Either<MigratedMaterial, RecordAttachmentIssue> {
  switch (material.kind) {
    case "unavailable":
      return Either.right(material);
    case "snapshot": {
      let text: string;
      try {
        text = JSON.stringify(material.value);
      } catch {
        return Either.left(invalid(path));
      }
      const bytes = new TextEncoder().encode(text);
      impact.push(retained(path));
      return Either.right(Object.freeze({
        kind: "content",
        content: build.content.bytes(bytes),
        encoding: "json",
        byteLength: bytes.byteLength,
        preview: null,
      }));
    }
    case "blob": {
      const bytes = document.content.bytes(material.ref);
      if (Either.isLeft(bytes)) return Either.left(invalid(path));
      impact.push(retained(path));
      return Either.right(Object.freeze({
        kind: "content",
        content: build.content.bytes(bytes.right),
        encoding: material.encoding,
        byteLength: material.byteLength,
        preview: material.preview,
      }));
    }
  }
}

/** Lossless adjacent projection from the retired v2 shape into sealed v3 facts. */
export const assertionsV2ToV3 = defineRecordMigration({
  from: 2,
  to: 3,
  parse: parseAssertionsRevision2,
  migrate: ({ value: previous, document, build }) => Effect.gen(function* () {
    const impact: RecordMigrationImpact[] = [];
    const entries = [];
    for (const [entryIndex, entry] of previous.entries.entries()) {
      const sourceResult = migrateMaterial(
        entry.materials.source,
        ["entries", String(entryIndex), "materials", "source"],
        document,
        build,
        impact,
      );
      if (Either.isLeft(sourceResult)) return yield* Effect.fail(sourceResult.left);
      const source = sourceResult.right;
      const evidence: MigratedMaterial[] = [];
      for (const [evidenceIndex, material] of entry.materials.evidence.entries()) {
        const evidenceResult = migrateMaterial(
          material,
          ["entries", String(entryIndex), "materials", "evidence", String(evidenceIndex)],
          document,
          build,
          impact,
        );
        if (Either.isLeft(evidenceResult)) return yield* Effect.fail(evidenceResult.left);
        evidence.push(evidenceResult.right);
      }
      entries.push(Object.freeze({
        ...entry,
        materials: Object.freeze({
          ...entry.materials,
          source,
          evidence: Object.freeze(evidence),
        }),
      }));
    }

    const references: Array<ReturnType<typeof build.reference.to>> = [];
    const sourceSites = previous.sourceSites.map((site) => {
      const source = build.reference.to(sourcesRecordAttachment, Object.freeze({
        sourceItemId: site.sourceItemId,
        sha256: site.sha256,
      }));
      references.push(source);
      return Object.freeze({
        entryId: site.entryId,
        sourceOrder: site.sourceOrder,
        role: site.role,
        source,
        start: site.start,
        end: site.end,
      });
    });

    return Object.freeze({
      value: Object.freeze({
        entries: Object.freeze(entries),
        sourceSites: Object.freeze(sourceSites),
      }),
      references: Object.freeze(references),
      impact: Object.freeze(impact),
    });
  }),
});
