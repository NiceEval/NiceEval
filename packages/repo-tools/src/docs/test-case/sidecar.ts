import { Result, Schema, SchemaIssue } from "effect";

import { CaseRelationsFormatError } from "./errors.js";

export const CaseIdSchema = Schema.String.check(Schema.isPattern(/^necase_[0-9A-HJKMNP-TV-Z]{16}$/u));
const CanonicalPath = Schema.String.check(
  Schema.isTrimmed(), Schema.isMinLength(1),
  Schema.makeFilter((value) => !value.startsWith("/") && !value.includes("\\") && !value.split("/").some((part) => part === "" || part === "." || part === "..")),
);
const Digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/u));
const Commit = Schema.String.check(Schema.isPattern(/^[0-9a-f]{40}$/u));
const TransactionId = Schema.String.check(Schema.isPattern(/^netxn_[0-9A-Za-z_-]+$/u));

export const CaseIssueSchema = Schema.Struct({
  repository: CanonicalPath,
  number: Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0)),
  url: Schema.String.check(Schema.isPattern(/^https:\/\/[^/?#]+\/[^/?#]+\/[^/?#]+\/issues\/[1-9][0-9]*$/u)),
  nodeId: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1)),
  titleDigest: Digest,
  checkedAt: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u)),
  provenance: Schema.Literal("direct"),
});
export type CaseIssue = typeof CaseIssueSchema.Type;

export const CaseRelationSchema = Schema.Struct({
  owner: CanonicalPath,
  regressions: Schema.Array(CanonicalPath),
  issues: Schema.Array(CaseIssueSchema),
});
export type CaseRelation = typeof CaseRelationSchema.Type;

const HistoryAction = Schema.Literals([
  "owner-set", "case-attached", "case-moved", "case-retired",
  "regression-added", "regression-retired", "issue-added", "issue-retired",
]);
export const CaseHistorySchema = Schema.Struct({
  caseId: CaseIdSchema,
  atCommit: Commit,
  transactionId: TransactionId,
  action: HistoryAction,
  from: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  to: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  reason: Schema.optional(Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1))),
});
export type CaseHistory = typeof CaseHistorySchema.Type;

export const CaseTombstoneSchema = Schema.Struct({
  caseId: CaseIdSchema,
  lastSelector: Schema.String,
  lastRelation: CaseRelationSchema,
  retiredAtCommit: Commit,
  transactionId: TransactionId,
  reason: Schema.String.check(Schema.isTrimmed(), Schema.isMinLength(1)),
});
export type CaseTombstone = typeof CaseTombstoneSchema.Type;

export const CaseRelationsSidecarSchema = Schema.Struct({
  format: Schema.Literal("niceeval.e2e-case-relations/v1"),
  testFile: CanonicalPath,
  current: Schema.Record(CaseIdSchema, CaseRelationSchema),
  history: Schema.Array(CaseHistorySchema),
  tombstones: Schema.Array(CaseTombstoneSchema),
});
export type CaseRelationsSidecar = typeof CaseRelationsSidecarSchema.Type;

function canonical(sidecar: CaseRelationsSidecar): CaseRelationsSidecar {
  return {
    ...sidecar,
    current: Object.fromEntries(Object.entries(sidecar.current).sort(([a], [b]) => a.localeCompare(b)).map(([id, relation]) => [id, {
      ...relation,
      regressions: [...new Set(relation.regressions)].sort(),
      issues: [...relation.issues].sort((a, b) => a.url.localeCompare(b.url)),
    }])),
    history: [...sidecar.history],
    tombstones: [...sidecar.tombstones].sort((a, b) => a.caseId.localeCompare(b.caseId)),
  };
}

export function decodeCaseRelationsSidecar(path: string, source: string): Result.Result<CaseRelationsSidecar, CaseRelationsFormatError> {
  let input: unknown;
  try { input = JSON.parse(source) as unknown; }
  catch (cause) { return Result.fail(new CaseRelationsFormatError({ path, message: cause instanceof Error ? cause.message : String(cause) })); }
  const decoded = Schema.decodeUnknownResult(CaseRelationsSidecarSchema, { errors: "all", onExcessProperty: "error" })(input);
  if (Result.isFailure(decoded)) return Result.fail(new CaseRelationsFormatError({ path, message: SchemaIssue.makeFormatterDefault()(decoded.failure.issue) }));
  for (const relation of Object.values(decoded.success.current)) {
    if (new Set(relation.regressions).size !== relation.regressions.length || new Set(relation.issues.map((issue) => issue.url)).size !== relation.issues.length) {
      return Result.fail(new CaseRelationsFormatError({ path, message: "current relations must not contain duplicates" }));
    }
  }
  const value = canonical(decoded.success);
  if (new Set(value.tombstones.map((entry) => entry.caseId)).size !== value.tombstones.length) return Result.fail(new CaseRelationsFormatError({ path, message: "tombstone case IDs must be unique" }));
  if (value.tombstones.some((entry) => Object.hasOwn(value.current, entry.caseId))) return Result.fail(new CaseRelationsFormatError({ path, message: "a case cannot be current and tombstoned" }));
  return Result.succeed(value);
}

export function encodeCaseRelationsSidecar(sidecar: CaseRelationsSidecar): string {
  return `${JSON.stringify(canonical(sidecar), null, 2)}\n`;
}
