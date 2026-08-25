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
  parseAssertionsRevision3,
  type AssertionsRevision3,
  type AssertionsRevision3Material,
} from "./revision-3.ts";

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function jsonRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : undefined;
}

function sourceNamesHistoricalOrder(
  entry: AssertionsRevision3["entries"][number],
  document: RecordMigrationDocument,
): boolean {
  if (entry.materials.source.kind !== "content" || entry.materials.source.encoding !== "json") {
    return false;
  }
  const bytes = document.content.bytes(entry.materials.source.content);
  if (Either.isLeft(bytes)) return false;
  try {
    const source = jsonRecord(JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.right),
    ) as unknown);
    return source?.assertion === "tool-order" || source?.assertion === "event-order";
  } catch {
    return false;
  }
}

function isHistoricalMatcher(
  entry: AssertionsRevision3["entries"][number],
  document: RecordMigrationDocument,
): boolean {
  if (entry.criterion.state === "available") {
    const criterion = jsonRecord(entry.criterion.value);
    const data = jsonRecord(criterion?.data);
    if (
      criterion?.kind === "builtin" &&
      (criterion.id === "occurrence/v1" || criterion.id === "occurrence/v2") &&
      (data?.occurrence === "tool" || data?.occurrence === "event")
    ) {
      return true;
    }
  }
  return sourceNamesHistoricalOrder(entry, document);
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
  material: AssertionsRevision3Material,
  path: readonly string[],
  document: RecordMigrationDocument,
  build: RecordMigrationBuilder,
  impact: RecordMigrationImpact[],
): Either.Either<AssertionsRevision3Material, RecordAttachmentIssue> {
  if (material.kind === "unavailable") return Either.right(material);
  const bytes = document.content.bytes(material.content);
  if (Either.isLeft(bytes) || bytes.right.byteLength !== material.byteLength) {
    return Either.left(invalid(path));
  }
  impact.push(retained(path));
  return Either.right(Object.freeze({
    ...material,
    content: build.content.bytes(bytes.right),
  }));
}

export const assertionsV3ToV4 = defineRecordMigration({
  from: 3,
  to: 4,
  parse: parseAssertionsRevision3,
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
      const evidence = [];
      for (const [evidenceIndex, material] of entry.materials.evidence.entries()) {
        const result = migrateMaterial(
          material,
          ["entries", String(entryIndex), "materials", "evidence", String(evidenceIndex)],
          document,
          build,
          impact,
        );
        if (Either.isLeft(result)) return yield* Effect.fail(result.left);
        evidence.push(result.right);
      }
      const matcher = isHistoricalMatcher(entry, document);
      if (matcher) {
        impact.push(Object.freeze({
          code: "migration-rerun-required" as const,
          path: Object.freeze(["entries", String(entryIndex), "evaluation"]),
          count: 1,
          recommendation: "rerun" as const,
        }));
      }
      entries.push(Object.freeze({
        ...entry,
        materials: Object.freeze({
          ...entry.materials,
          source: sourceResult.right,
          evidence: Object.freeze(evidence),
        }),
        evaluation: matcher
          ? Object.freeze({
              kind: "matcher-legacy" as const,
              observed: entry.evaluation.observed,
              reason: "historical-not-recorded" as const,
              ...(entry.explanationRetention.state === "retained"
                ? { legacyDiagnostic: entry.explanationRetention.value }
                : {}),
            })
          : Object.freeze({
              kind: "ordinary" as const,
              observed: entry.evaluation.observed,
              ...(entry.evaluation.receipt === undefined
                ? {}
                : { receipt: entry.evaluation.receipt }),
            }),
        explanationRetention: matcher
          ? Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const })
          : entry.explanationRetention,
      }));
    }

    const references: Array<ReturnType<typeof build.reference.to>> = [];
    const sourceSites = previous.sourceSites.map((site) => {
      const source = build.reference.to(sourcesRecordAttachment, site.source.value);
      references.push(source);
      return Object.freeze({ ...site, source });
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
