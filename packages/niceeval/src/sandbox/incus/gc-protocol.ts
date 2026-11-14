import { createHash } from "node:crypto";
import { Schema } from "effect";
import type { ArtifactIntent } from "./repository.ts";

const integer = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const timestamp = Schema.String.check(
  Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), { description: "an ISO timestamp" }),
);
export const GcCandidateSchema = Schema.Struct({
  entryId: Schema.String,
  keyDigest: Schema.String,
  immutableResourceIdentity: Schema.String,
  manifestDigest: Schema.String,
  evidenceDigest: Schema.String,
  evidence: Schema.Struct({
    createdAt: timestamp,
    lastSuccessfulUseAt: Schema.NullOr(timestamp),
    protectedUntil: timestamp,
    capacity: Schema.NullOr(
      Schema.Struct({ domainUsedBytes: integer, domainCapacityBytes: integer, exactMarginalReclaimBytes: integer }),
    ),
  }),
  ruleId: Schema.Literals(["dangling-intent", "superseded-domain-revision", "superseded-generation", "unused"]),
  orderKey: Schema.String,
});
export const GcPlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  planId: Schema.String,
  domainId: Schema.String,
  ownerId: Schema.String,
  backendIdentity: Schema.String,
  issuerEpoch: Schema.String,
  registrySafetyRevision: integer,
  policyVersion: integer,
  observedAt: timestamp,
  expiresAt: timestamp,
  candidates: Schema.Array(GcCandidateSchema),
});
export const GcItemOutcomeSchema = Schema.Struct({
  entryId: Schema.String,
  resourceIdentity: Schema.String,
  status: Schema.Literals(["deleted", "already-absent", "skipped", "failed", "not-attempted"]),
  reasonCode: Schema.Literals([
    "deleted",
    "already-absent",
    "hold-acquired",
    "hold-present",
    "provider-reference",
    "entry-state-changed",
    "manifest-changed",
    "resource-changed",
    "unverified",
    "delete-conflict",
    "delete-failed",
    "domain-stopped",
  ]),
  message: Schema.String,
});
export const GcOutcomeSchema = Schema.Struct({
  planId: Schema.String,
  domainId: Schema.String,
  startedAt: timestamp,
  finishedAt: timestamp,
  outcomes: Schema.Array(GcItemOutcomeSchema),
  summary: Schema.Struct({
    deleted: integer,
    alreadyAbsent: integer,
    skipped: integer,
    failed: integer,
    notAttempted: integer,
    exactReclaimedBytes: Schema.NullOr(integer),
  }),
});
export type GcCandidate = typeof GcCandidateSchema.Type;
export type GcPlan = typeof GcPlanSchema.Type;
export type GcItemOutcome = typeof GcItemOutcomeSchema.Type;
export type GcOutcome = typeof GcOutcomeSchema.Type;
export const gcParseOptions = { exact: true, onExcessProperty: "error" as const };

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number")
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null)
    return `{${Object.keys(value)
      .sort()
      .filter((key) => Reflect.get(value, key) !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`)
      .join(",")}}`;
  throw new TypeError("GC canonical evidence must contain JSON values");
}
export const gcDigest = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");
export const artifactResourceIdentity = (intent: ArtifactIntent): string =>
  gcDigest({
    artifactId: intent.artifactId,
    generation: intent.generation,
    project: intent.project,
    pool: intent.pool,
    instance: intent.instance,
    volume: intent.dockerDataVolume,
  });
export function artifactEvidenceDigest(intent: ArtifactIntent): string {
  // Ownership is evidence: a stale preview must not reclaim an intent after
  // another plan took over the same interrupted retirement state.
  const { updatedAt: _updatedAt, ...evidence } = intent;
  return gcDigest(evidence);
}
