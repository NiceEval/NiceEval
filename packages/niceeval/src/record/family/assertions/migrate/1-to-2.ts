import { createHash } from "node:crypto";

import { Effect, Result, Schema } from "effect";

import {
  defineRecordMigration,
  recordAttachmentIssue,
  type RecordAttachmentIssue,
  type RecordMigrationContent,
  type RecordMigrationDocument,
  type RecordMigrationImpact,
} from "../../../attachment/index.ts";
import { isRecordMigrationContent } from "../../../attachment/protocol.ts";
import {
  AssertionCoverageSchema,
  AssertionDisplaySchema,
  AssertionEntryIdSchema,
  AssertionLimitationSchema,
  BoundedJsonObjectSchema,
  BoundedJsonValueSchema,
  SealedAssertionResultSchema,
} from "../../../../assertions/record/codec.ts";
import { RecordExactParseOptions } from "../../../codec/core.ts";
import {
  Sha256DigestSchema,
  SourceItemIdSchema,
} from "../../../codec/identifiers.ts";
import {
  NonNegativeSafeIntegerSchema,
  PositiveSafeIntegerSchema,
} from "../../common.ts";
import {
  AssertionSourcePositionSchema,
  AssertionSourceRoleSchema,
} from "../reference.ts";

const HistoricalContentSchema: Schema.Codec<RecordMigrationContent> = Schema.declare(
  isRecordMigrationContent,
);

const HistoricalMaterialSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("unavailable"),
    reason: Schema.Literal("not-recorded"),
  }),
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    value: Schema.toType(BoundedJsonValueSchema),
  }),
  Schema.Struct({
    kind: Schema.Literal("blob"),
    ref: HistoricalContentSchema,
    encoding: Schema.Literals(["utf-8", "binary"]),
    byteLength: NonNegativeSafeIntegerSchema,
    sha256: Sha256DigestSchema,
    preview: Schema.String,
  }),
]);

const HistoricalEntrySchema = Schema.Struct({
  entryId: AssertionEntryIdSchema,
  display: Schema.toType(AssertionDisplaySchema),
  criterion: Schema.toType(BoundedJsonObjectSchema),
  subject: HistoricalMaterialSchema,
  evidence: Schema.Array(HistoricalMaterialSchema),
  coverage: Schema.toType(AssertionCoverageSchema),
  limitations: Schema.Array(Schema.toType(AssertionLimitationSchema)),
  result: Schema.toType(SealedAssertionResultSchema),
});

const HistoricalSourceSiteSchema = Schema.Struct({
  entryId: AssertionEntryIdSchema,
  sourceOrder: PositiveSafeIntegerSchema,
  role: AssertionSourceRoleSchema,
  sourceItemId: SourceItemIdSchema,
  sha256: Sha256DigestSchema,
  start: AssertionSourcePositionSchema,
  end: AssertionSourcePositionSchema,
});

const AssertionsRevision1Schema = Schema.Struct({
  entries: Schema.Array(HistoricalEntrySchema).pipe(
    Schema.check(Schema.makeFilter((entries) => entries.length <= 4_096)),
  ),
  sourceSites: Schema.Array(HistoricalSourceSiteSchema),
}).pipe(Schema.encodeKeys({ entries: "entries-data", sourceSites: "source-sites-data" }));

type AssertionsRevision1 = typeof AssertionsRevision1Schema.Type;
type HistoricalMaterial = AssertionsRevision1["entries"][number]["subject"];

function invalid(path: readonly string[]): RecordAttachmentIssue {
  return recordAttachmentIssue("record-attachment-schema-invalid", path);
}

function validateHistoricalContent(
  document: RecordMigrationDocument,
  material: HistoricalMaterial,
  path: readonly string[],
): RecordAttachmentIssue | undefined {
  if (material.kind !== "blob") return undefined;
  const bytes = document.content.bytes(material.ref);
  if (
    Result.isFailure(bytes) ||
    bytes.success.byteLength !== material.byteLength ||
    createHash("sha256").update(bytes.success).digest("hex") !== material.sha256
  ) {
    return invalid(path);
  }
  return undefined;
}

function parseAssertionsRevision1(
  document: RecordMigrationDocument,
): Result.Result<AssertionsRevision1, RecordAttachmentIssue> {
  const wire = Schema.decodeUnknownResult(
    AssertionsRevision1Schema,
    RecordExactParseOptions,
  )(document.value);
  const decoded = Result.isSuccess(wire)
    ? wire
    : Schema.decodeUnknownResult(
      Schema.toType(AssertionsRevision1Schema),
      RecordExactParseOptions,
    )(document.value);
  if (Result.isFailure(decoded)) return Result.fail(invalid([]));

  const entryIds = new Set<string>();
  for (const [entryIndex, entry] of decoded.success.entries.entries()) {
    if (entryIds.has(entry.entryId)) {
      return Result.fail(invalid(["entries", String(entryIndex), "entryId"]));
    }
    entryIds.add(entry.entryId);
    const sourceIssue = validateHistoricalContent(
      document,
      entry.subject,
      ["entries", String(entryIndex), "subject"],
    );
    if (sourceIssue !== undefined) return Result.fail(sourceIssue);
    for (const [evidenceIndex, material] of entry.evidence.entries()) {
      const issue = validateHistoricalContent(
        document,
        material,
        ["entries", String(entryIndex), "evidence", String(evidenceIndex)],
      );
      if (issue !== undefined) return Result.fail(issue);
    }
  }
  return Result.succeed(decoded.success);
}

export const assertionsV1ToV2 = defineRecordMigration({
  from: 1,
  to: 2,
  parse: parseAssertionsRevision1,
  migrate: ({ value: previous }) => Effect.sync(() => {
    const impact: RecordMigrationImpact[] = [];
    const entries = previous.entries.map((entry, entryIndex) => {
      if (entry.subject.kind === "blob") {
        impact.push(Object.freeze({
          code: "migration-content-dropped" as const,
          path: Object.freeze(["entries", String(entryIndex), "subject"]),
          count: 1,
          recommendation: "none" as const,
        }));
      }
      entry.evidence.forEach((material, evidenceIndex) => {
        if (material.kind !== "blob") return;
        impact.push(Object.freeze({
          code: "migration-content-dropped" as const,
          path: Object.freeze([
            "entries",
            String(entryIndex),
            "evidence",
            String(evidenceIndex),
          ]),
          count: 1,
          recommendation: "none" as const,
        }));
      });
      return Object.freeze({
        entryId: entry.entryId,
        display: entry.display,
        criterion: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
        materials: Object.freeze({
          source: Object.freeze({ kind: "unavailable" as const, reason: "not-recorded" as const }),
          evidence: Object.freeze([]),
          coverage: Object.freeze({ state: "unavailable" as const, reason: "not-collected" as const }),
          limitations: Object.freeze([]),
        }),
        evaluation: Object.freeze({
          observed: Object.freeze({
            kind: "unavailable" as const,
            reason: "not-recorded" as const,
          }),
        }),
        decision: Object.freeze({
          result: entry.result.state,
          reason: "reason" in entry.result ? entry.result.reason : null,
          gate: entry.result.gate,
        }),
        policy: Object.freeze({
          requirement: entry.result.gate === "not-gate"
            ? Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const })
            : Object.freeze({ state: "available" as const, value: "required" as const }),
          condition: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
        }),
        contribution: entry.result.score,
        explanationRetention: Object.freeze({ state: "unavailable" as const, reason: "not-recorded" as const }),
      });
    });

    return Object.freeze({
      value: Object.freeze({
        entries: Object.freeze(entries),
        sourceSites: Object.freeze([...previous.sourceSites]),
      }),
      references: Object.freeze([]),
      impact: Object.freeze(impact),
    });
  }),
});
