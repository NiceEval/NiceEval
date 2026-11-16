import * as Schema from "effect/Schema";

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const timestamp = Schema.String.check(Schema.makeFilter((value) => Number.isFinite(Date.parse(value))));
const entryFacts = {
  leaseCount: count,
  holdCount: count,
  liveLeaseCount: count,
  unverifiedLeaseCount: count,
  liveHoldCount: count,
  unverifiedHoldCount: count,
  createdAt: timestamp,
  lastSuccessfulUseAt: Schema.NullOr(timestamp),
  protectedUntil: timestamp,
};
const entry = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("task-build"),
    state: Schema.Literals(["active-leased", "cold-reusable", "unverified"]),
    identity: Schema.Struct({ buildKey: Schema.String, tag: Schema.String, imageId: Schema.String }),
    ...entryFacts,
  }),
  Schema.Struct({
    kind: Schema.Literal("sandbox-before-cache"),
    state: Schema.Literals([
      "reserved",
      "building",
      "published",
      "indexed",
      "invalidated",
      "deleting",
      "tombstoned",
      "unverified",
    ]),
    identity: Schema.Struct({
      entryId: Schema.String,
      beforeCacheKey: Schema.String,
      imageId: Schema.NullOr(Schema.String),
      baseIdentity: Schema.String,
    }),
    ...entryFacts,
  }),
]);
const inventory = Schema.Struct({
  scope: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("domains") }),
    Schema.Struct({ kind: Schema.Literal("domain"), domainId: Schema.String }),
  ]),
  domains: Schema.Array(
    Schema.Union([
      Schema.Struct({
        domainId: Schema.String,
        providerFamily: Schema.Literal("docker"),
        backendKind: Schema.Literal("docker-images"),
        state: Schema.Literal("verified-managed"),
        entryCount: count,
        entryKinds: Schema.Struct({ taskBuild: count, sandboxBeforeCache: count }),
      }),
      Schema.Struct({
        domainId: Schema.String,
        providerFamily: Schema.Literal("docker"),
        backendKind: Schema.String,
        state: Schema.Literals(["unverified", "unavailable"]),
        entryCount: Schema.Null,
      }),
    ]),
  ),
  providerObservations: Schema.Array(
    Schema.Struct({
      scope: Schema.Literal("provider"),
      providerFamily: Schema.Literal("docker"),
      backendKind: Schema.String,
      state: Schema.Literal("unverified"),
      observedAt: timestamp,
      totalBytes: Schema.NullOr(count),
      reclaimableEstimateBytes: Schema.NullOr(count),
      reason: Schema.String,
    }),
  ),
  entries: Schema.optional(Schema.Array(entry)),
});

// This inner plan is persisted and applied in a later process. Its single
// format marker is independent of the transient CLI document around it.
const gcPlan = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  planId: Schema.String,
  domainId: Schema.String,
  ownerId: Schema.String,
  backendIdentity: Schema.String,
  authorityEpoch: Schema.String,
  policyVersion: Schema.Literal(1),
  registrySafetyRevision: count,
  observedAt: timestamp,
  expiresAt: timestamp,
  planDigest: Schema.String,
  candidates: Schema.Array(
    Schema.Struct({
      buildKey: Schema.String,
      tag: Schema.String,
      imageId: Schema.String,
      manifestDigest: Schema.String,
      generation: count,
      evidenceDigest: Schema.String,
      ruleId: Schema.Literal("max-age/task-build"),
    }),
  ),
});
const preview = Schema.Struct({
  plan: gcPlan,
  summary: Schema.Struct({ candidateCount: count, exactReclaimBytes: Schema.NullOr(count) }),
});
const outcome = Schema.Struct({
  planId: Schema.String,
  domainId: Schema.String,
  startedAt: timestamp,
  finishedAt: timestamp,
  outcomes: Schema.Array(
    Schema.Struct({
      buildKey: Schema.String,
      status: Schema.Literals(["deleted", "already-absent", "skipped", "failed"]),
      reason: Schema.String,
    }),
  ),
});
const options = { errors: "all", onExcessProperty: "error" } as const;

/** Read the exact Docker cache inventory document, including unverified capacity observations. */
export type DockerCacheInventoryDocument = Schema.Schema.Type<typeof inventory>;
/** Read a Docker GC preview; only its inner executable plan carries a persisted format marker. */
export type DockerCacheGcPreviewDocument = Schema.Schema.Type<typeof preview>;
/** Read the independent outcomes of applying a Docker cache GC plan. */
export type DockerCacheGcOutcomeDocument = Schema.Schema.Type<typeof outcome>;

/** Strictly decode `niceeval docker cache inventory --json` without granting GC authority. */
export function decodeDockerCacheInventoryDocument(input: unknown): DockerCacheInventoryDocument {
  return Schema.decodeUnknownSync(inventory, options)(input);
}

/** Strictly decode `niceeval docker cache gc --json`; apply still verifies persisted ownership and snapshots. */
export function decodeDockerCacheGcPreviewDocument(input: unknown): DockerCacheGcPreviewDocument {
  return Schema.decodeUnknownSync(preview, options)(input);
}

/** Strictly decode `niceeval docker cache gc --apply <plan-id> --json`. */
export function decodeDockerCacheGcOutcomeDocument(input: unknown): DockerCacheGcOutcomeDocument {
  return Schema.decodeUnknownSync(outcome, options)(input);
}
