import type { DatabaseSync } from "node:sqlite";
import { Result, Schema } from "effect";
import { UserDatabaseInvalid } from "../../user-database/errors.ts";
import { GcPlanSchema, GcOutcomeSchema, GcItemOutcomeSchema, gcDigest, gcParseOptions } from "./gc-protocol.ts";

export const INCUS_GC_TABLE = "incus_artifact_gc_plans";
export const INCUS_GC_SCHEMA_SQL = `CREATE TABLE ${INCUS_GC_TABLE} (plan_id TEXT PRIMARY KEY, payload TEXT NOT NULL, digest TEXT NOT NULL, progress TEXT NOT NULL, outcome TEXT) STRICT`;
const Save = Schema.Struct({
  repository: Schema.Literal("incus"),
  operation: Schema.Literal("gc.save"),
  payload: Schema.String,
  digest: Schema.String,
});
const Get = Schema.Struct({
  repository: Schema.Literal("incus"),
  operation: Schema.Literal("gc.get"),
  planId: Schema.String,
});
const Append = Schema.Struct({
  repository: Schema.Literal("incus"),
  operation: Schema.Literal("gc.append"),
  planId: Schema.String,
  payload: Schema.String,
});
const Finish = Schema.Struct({
  repository: Schema.Literal("incus"),
  operation: Schema.Literal("gc.finish"),
  planId: Schema.String,
  payload: Schema.String,
});
const Request = Schema.Union([Save, Get, Append, Finish]);
const Stored = Schema.Struct({
  payload: Schema.String,
  digest: Schema.String,
  progress: Schema.String,
  outcome: Schema.NullOr(Schema.String),
});
const ResultSchema = Schema.Union([
  Schema.Struct({
    repository: Schema.Literal("incus"),
    operation: Schema.Literal("gc.save"),
    saved: Schema.Literal(true),
  }),
  Schema.Struct({
    repository: Schema.Literal("incus"),
    operation: Schema.Literal("gc.get"),
    stored: Schema.NullOr(Stored),
  }),
  Schema.Struct({
    repository: Schema.Literal("incus"),
    operation: Schema.Literal("gc.append"),
    saved: Schema.Literal(true),
  }),
  Schema.Struct({
    repository: Schema.Literal("incus"),
    operation: Schema.Literal("gc.finish"),
    saved: Schema.Literal(true),
  }),
]);
export type GcStoreRequest = typeof Request.Type;
export type GcStoreResult = typeof ResultSchema.Type;
export type StoredGcPlan = typeof Stored.Type;
export const isGcStoreRequest = (value: unknown): value is GcStoreRequest =>
  Result.isSuccess(Schema.decodeUnknownResult(Request, gcParseOptions)(value));
export const isGcStoreResult = (value: unknown): value is GcStoreResult =>
  Result.isSuccess(Schema.decodeUnknownResult(ResultSchema, gcParseOptions)(value));
const invalid = (message: string) =>
  new UserDatabaseInvalid({ code: "user-database-invalid", repository: "incus", message });

export function readStoredGcPlan(database: DatabaseSync, planId: string): StoredGcPlan | null {
  const row = database
    .prepare(`SELECT payload, digest, progress, outcome FROM ${INCUS_GC_TABLE} WHERE plan_id = ?`)
    .get(planId);
  return row === undefined ? null : Schema.decodeUnknownSync(Stored, gcParseOptions)(row);
}

/** The immutable plan and append-only item audit share the Incus transaction owner. */
export function dispatchGcStore(database: DatabaseSync, request: GcStoreRequest): GcStoreResult {
  if (request.operation === "gc.get")
    return { repository: "incus", operation: request.operation, stored: readStoredGcPlan(database, request.planId) };
  if (request.operation === "gc.save") {
    const plan = Schema.decodeUnknownSync(GcPlanSchema, gcParseOptions)(JSON.parse(request.payload));
    if (
      gcDigest(plan) !== request.digest ||
      new Set(plan.candidates.map((item) => item.entryId)).size !== plan.candidates.length
    )
      throw invalid("Invalid Incus GC plan digest or duplicate candidate");
    database
      .prepare(
        `INSERT INTO ${INCUS_GC_TABLE}(plan_id, payload, digest, progress, outcome) VALUES (?, ?, ?, '[]', NULL)`,
      )
      .run(plan.planId, request.payload, request.digest);
    return { repository: "incus", operation: request.operation, saved: true };
  }
  const stored = readStoredGcPlan(database, request.planId);
  if (stored === null) throw invalid("Incus GC plan is absent");
  const plan = Schema.decodeUnknownSync(GcPlanSchema, gcParseOptions)(JSON.parse(stored.payload));
  if (gcDigest(plan) !== stored.digest) throw invalid("Incus GC plan digest changed");
  if (request.operation === "gc.append") {
    const item = Schema.decodeUnknownSync(GcItemOutcomeSchema, gcParseOptions)(JSON.parse(request.payload));
    const progress = Schema.decodeUnknownSync(
      Schema.Array(GcItemOutcomeSchema),
      gcParseOptions,
    )(JSON.parse(stored.progress));
    if (
      !plan.candidates.some(
        (candidate) =>
          candidate.entryId === item.entryId && candidate.immutableResourceIdentity === item.resourceIdentity,
      )
    )
      throw invalid("Incus GC outcome is not in the immutable plan");
    const existing = progress.find((candidate) => candidate.entryId === item.entryId);
    if (existing !== undefined && gcDigest(existing) !== gcDigest(item))
      throw invalid("Incus GC item outcome cannot be rewritten");
    if (existing === undefined) {
      if (stored.outcome !== null) throw invalid("Incus GC plan is already complete");
      database
        .prepare(`UPDATE ${INCUS_GC_TABLE} SET progress = ? WHERE plan_id = ?`)
        .run(JSON.stringify([...progress, item]), request.planId);
    }
    return { repository: "incus", operation: request.operation, saved: true };
  }
  // Persist a rendering envelope so retries also preserve the pool observations.
  const envelope = Schema.decodeUnknownSync(
    Schema.Struct({
      document: GcOutcomeSchema,
      before: Schema.NullOr(Schema.Number),
      after: Schema.NullOr(Schema.Number),
    }),
    gcParseOptions,
  )(JSON.parse(request.payload));
  if (
    envelope.document.planId !== plan.planId ||
    envelope.document.domainId !== plan.domainId ||
    gcDigest(envelope.document.outcomes) !== gcDigest(JSON.parse(stored.progress))
  )
    throw invalid("Incus GC final outcome does not match its durable item audit");
  if (stored.outcome !== null && stored.outcome !== request.payload)
    throw invalid("Incus GC final outcome cannot be rewritten");
  database
    .prepare(`UPDATE ${INCUS_GC_TABLE} SET outcome = ? WHERE plan_id = ? AND outcome IS NULL`)
    .run(request.payload, request.planId);
  return { repository: "incus", operation: request.operation, saved: true };
}
