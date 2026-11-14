// @concord-file
// @concord-implements docs/feature/sandbox/data-model.md
import { Effect, Schema } from "effect";
import type { UserDatabase } from "../../user-database/client.ts";
import { UserDatabaseInvalid, type UserDatabaseFailure } from "../../user-database/errors.ts";

export const BEFORE_CACHE_SNAPSHOTS_REPOSITORY = "before-cache-snapshots" as const;
export const SNAPSHOT_LEASE_MS = 120_000;
export const SNAPSHOT_HEARTBEAT_MS = 30_000;

const Integer = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const SnapshotLedgerEntry = Schema.Struct({
  artifact_id: Schema.String,
  provider: Schema.String,
  execution_domain_id: Schema.String,
  before_cache_key: Schema.String,
  base_identity: Schema.String,
  declaration_json: Schema.String,
  replacement_scope: Schema.String,
  generation: Integer,
  snapshot_name: Schema.String,
  snapshot_id: Schema.NullOr(Schema.String),
  requested_at: Schema.NullOr(Integer),
  state: Schema.Literals(["preparing", "ready", "deleting", "deleted"]),
  lease_token: Schema.NullOr(Schema.String),
  lease_until: Schema.NullOr(Integer),
  created_at: Integer,
  published_at: Schema.NullOr(Integer),
});
export type SnapshotLedgerEntry = typeof SnapshotLedgerEntry.Type;

const Domain = { provider: Schema.String, executionDomainId: Schema.String };
const Request = { repository: Schema.Literal(BEFORE_CACHE_SNAPSHOTS_REPOSITORY), ...Domain, now: Integer };
const Ownership = { artifactId: Schema.String, token: Schema.String };
const Reserve = Schema.Struct({
  ...Request,
  operation: Schema.Literal("lookup-reserve"),
  beforeCacheKey: Schema.String,
  baseIdentity: Schema.String,
  declarationJson: Schema.String,
  replacementScope: Schema.String,
  artifactId: Schema.String,
  token: Schema.String,
  holdId: Schema.String,
});
const Renew = Schema.Struct({ ...Request, operation: Schema.Literal("renew"), ...Ownership });
const Requested = Schema.Struct({ ...Request, operation: Schema.Literal("request-snapshot"), ...Ownership });
const Publish = Schema.Struct({
  ...Request,
  operation: Schema.Literal("publish"),
  ...Ownership,
  snapshotId: Schema.String,
  holdId: Schema.String,
});
const Uncertain = Schema.Struct({ ...Request, operation: Schema.Literal("uncertain"), ...Ownership });
const Handoff = Schema.Struct({
  ...Request,
  operation: Schema.Literal("handoff"),
  artifactId: Schema.String,
  holdId: Schema.String,
  runHoldId: Schema.String,
  releaseRunHold: Schema.Boolean,
});
const BindSandbox = Schema.Struct({
  ...Request,
  operation: Schema.Literal("bind-sandbox"),
  holdId: Schema.String,
  sandboxId: Schema.String,
});
const ReleaseSandbox = Schema.Struct({
  ...Request,
  operation: Schema.Literal("release-sandbox"),
  holdId: Schema.String,
});
const RunHolds = Schema.Struct({
  ...Request,
  operation: Schema.Literals(["renew-run-holds", "release-run-holds"]),
  holdIds: Schema.Array(Schema.String),
});
const Invalidate = Schema.Struct({ ...Request, operation: Schema.Literal("invalidate"), artifactId: Schema.String });
const Claim = Schema.Struct({
  ...Request,
  operation: Schema.Literal("claim-delete"),
  token: Schema.String,
  excludeArtifactIds: Schema.optionalKey(Schema.Array(Schema.String)),
});
const Settle = Schema.Struct({
  ...Request,
  operation: Schema.Literal("settle-delete"),
  ...Ownership,
  deleted: Schema.Boolean,
});
export const SnapshotRepositoryRequest = Schema.Union([
  Reserve,
  Renew,
  Requested,
  Publish,
  Uncertain,
  Handoff,
  BindSandbox,
  ReleaseSandbox,
  RunHolds,
  Invalidate,
  Claim,
  Settle,
]);
export type BeforeCacheSnapshotRepositoryRequest = typeof SnapshotRepositoryRequest.Type;
export const isBeforeCacheSnapshotRepositoryRequest = Schema.is(SnapshotRepositoryRequest);

const ResultValue = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal("Hit"), entry: SnapshotLedgerEntry, holdId: Schema.String }),
  Schema.Struct({ _tag: Schema.Literals(["Reserved", "TakenOver", "Busy", "Claimed"]), entry: SnapshotLedgerEntry }),
  Schema.Struct({ _tag: Schema.Literal("Published"), entry: SnapshotLedgerEntry, holdId: Schema.String }),
  Schema.Struct({ _tag: Schema.Literals(["Updated", "LeaseLost", "Superseded", "Unavailable", "Empty"]) }),
]);
export const SnapshotRepositoryResult = Schema.Struct({
  repository: Schema.Literal(BEFORE_CACHE_SNAPSHOTS_REPOSITORY),
  value: ResultValue,
});
export type BeforeCacheSnapshotRepositoryResult = typeof SnapshotRepositoryResult.Type;
export const isBeforeCacheSnapshotRepositoryResult = Schema.is(SnapshotRepositoryResult);
export type SnapshotLedgerResult = BeforeCacheSnapshotRepositoryResult["value"];
export type SnapshotLedgerDomain = { readonly provider: string; readonly executionDomainId: string };
export type SnapshotLedgerRequest = BeforeCacheSnapshotRepositoryRequest extends infer R
  ? R extends BeforeCacheSnapshotRepositoryRequest
    ? Omit<R, "repository">
    : never
  : never;

/** All persistence crosses the existing UserDatabase worker transport. */
export const snapshotLedgerRequest = Effect.fn("snapshotLedgerRequest")(function* (
  database: UserDatabase,
  input: SnapshotLedgerRequest,
): Effect.fn.Return<SnapshotLedgerResult, UserDatabaseFailure> {
  const result = yield* database.dispatch({ repository: BEFORE_CACHE_SNAPSHOTS_REPOSITORY, ...input });
  if (!isBeforeCacheSnapshotRepositoryResult(result))
    return yield* new UserDatabaseInvalid({
      code: "user-database-invalid",
      repository: BEFORE_CACHE_SNAPSHOTS_REPOSITORY,
      message: "Before cache snapshot worker returned an invalid result",
    });
  return result.value;
});
