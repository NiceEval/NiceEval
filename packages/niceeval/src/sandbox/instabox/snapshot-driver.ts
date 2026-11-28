// @concord-file
// @concord-implements docs/feature/sandbox/architecture/providers/instabox.md#远端-snapshot-driver
import { createHash } from "node:crypto";
import { Clock, Effect, Result, Schedule, Schema } from "effect";
import type { MaterializedSandboxCase } from "../case-types.ts";
import type { InstaboxProviderPlan } from "../instabox.ts";
import { BeforeCacheSnapshotError, type BeforeCacheSnapshotDriver } from "../remote-snapshot/driver.ts";
import { InstaboxApi, InstaboxApiError } from "./api.ts";
import {
  INSTABOX_MACHINE_DELETE_TIMEOUT_MS,
  instaboxReadRequest,
  isRetryableInstaboxReadError,
} from "./provisioning.ts";

const Snapshot = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["pending", "ready", "failed"]),
});
const SnapshotList = Schema.Struct({ snapshots: Schema.Array(Snapshot) });
const fail = (operation: string) =>
  new BeforeCacheSnapshotError({ operation, reason: "Instabox snapshot operation failed" });
const snapshotSettleMs = 300_000;
const snapshotReadyLimitMs = 20 * 60_000;
const publicationReadRetry = { schedule: Schedule.spaced("5 seconds"), while: isRetryableInstaboxReadError };
export const instaboxSnapshotSourceExpirations = new WeakMap<MaterializedSandboxCase["group"], number>();
const api = () => {
  const key = process.env.INSTABOX_API_KEY;
  if (!key) throw new Error("INSTABOX_API_KEY is required for Instabox");
  return new InstaboxApi(key);
};
const boundary = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => fail(operation) });

const findByName = Effect.fnUntraced(function* (client: InstaboxApi, name: string) {
  // The official SnapshotList is complete and has no pagination fields.
  const result = yield* instaboxReadRequest((signal) => client.json(SnapshotList, "/snapshots", { signal }));
  const matches = result.snapshots.filter((snapshot) => snapshot.name === name);
  if (matches.length > 1) return yield* fail("find-ambiguous");
  return matches[0];
});

export const instaboxSnapshotDriver: BeforeCacheSnapshotDriver<InstaboxProviderPlan> = {
  preserves: { disks: ["/", "/data"], memory: false },
  sourceUsableAfterSnapshot: true,
  snapshotSettleMs,
  resolveBase: Effect.fn("instaboxSnapshotDriver.resolveBase")(function* (plan) {
    const key = process.env.INSTABOX_API_KEY;
    if (!key) return yield* fail("resolve-base");
    const snapshotId = plan.source._tag === "Snapshot" ? plan.source.id : undefined;
    if (snapshotId !== undefined) {
      const snapshot = yield* boundary("resolve-base", (signal) =>
        api().json(Snapshot, `/snapshots/${encodeURIComponent(snapshotId)}`, { signal }),
      );
      if (snapshot.id !== snapshotId || snapshot.status !== "ready")
        return {
          _tag: "Ineligible" as const,
          code: "base-image-unverified" as const,
          reason: "Instabox Base snapshot is not ready",
        };
    }
    const baseIdentity = plan.source._tag === "Snapshot" ? plan.source.id : `template:${plan.source.id}`;
    const credentialHash = createHash("sha256").update(key).digest("hex");
    const executionDomainId = createHash("sha256")
      .update(JSON.stringify(["https://api.instabox.sh", credentialHash]))
      .digest("hex");
    return {
      _tag: "Resolved" as const,
      executionDomainId,
      baseIdentity,
      baseReference: plan.source.id,
      keyScope: {
        cacheFormat: "niceeval-instabox-cache/current",
        semanticIdentity: { executionDomainId, platform: "linux-x64-gnu" },
      },
    };
  }),
  createFromSnapshot: (plan, snapshotId, context) =>
    boundary("restore", () => import("./materialize.ts")).pipe(
      Effect.flatMap((module) =>
        module.materializeInstabox({ ...plan, source: { _tag: "Snapshot", id: snapshotId } }, context),
      ),
      Effect.mapError(() => fail("restore")),
    ),
  createSnapshot: Effect.fn("instaboxSnapshotDriver.createSnapshot")(function* (_plan, source, name) {
    const client = yield* Effect.try({ try: api, catch: () => fail("create") });
    const now = yield* Clock.currentTimeMillis;
    const expiresAt = instaboxSnapshotSourceExpirations.get(source.group) ?? now;
    const budgetMs = Math.min(snapshotReadyLimitMs, expiresAt - now - INSTABOX_MACHINE_DELETE_TIMEOUT_MS);
    let operation = "create";
    let lastStatus: typeof Snapshot.Type.status | "absent" | "unknown" = "unknown";
    const publicationFailure = (detail: string) =>
      new BeforeCacheSnapshotError({
        operation,
        reason: `Instabox ${detail} (last observed snapshot status: ${lastStatus})`,
      });
    if (budgetMs <= 0) return yield* publicationFailure("source lifetime left no snapshot budget");
    return yield* Effect.gen(function* () {
      const created = yield* Effect.result(
        Effect.tryPromise({
          try: async (signal) => {
            try {
              return {
                _tag: "Accepted" as const,
                snapshot: await client.json(
                  Snapshot,
                  `/machines/${encodeURIComponent(source.group.primary.sandboxId)}/snapshots`,
                  {
                    method: "POST",
                    signal,
                    headers: { "Idempotency-Key": name },
                    body: JSON.stringify({ name, rootOnly: false }),
                  },
                ),
              };
            } catch (cause) {
              if (cause instanceof InstaboxApiError && [400, 401, 403, 404, 429].includes(cause.status))
                return {
                  _tag: "Rejected" as const,
                  reason: `Instabox rejected the snapshot request (HTTP ${cause.status})`,
                };
              throw cause;
            }
          },
          catch: () => fail("create"),
        }),
      );
      if (Result.isSuccess(created) && created.success._tag === "Rejected") return created.success;
      let snapshot = Result.isSuccess(created) ? created.success.snapshot : undefined;
      if (snapshot === undefined) {
        operation = "find-after-post";
        while (snapshot === undefined) {
          snapshot = yield* findByName(client, name).pipe(
            Effect.retry(publicationReadRetry),
            Effect.mapError(() => publicationFailure("could not reconcile snapshot request by name")),
          );
          if (snapshot === undefined) {
            lastStatus = "absent";
            yield* Effect.sleep("5 seconds");
          }
        }
      }
      lastStatus = snapshot.status;
      if (snapshot.name !== name) return yield* publicationFailure("snapshot name did not match the request");
      const snapshotId = snapshot.id;
      operation = "wait-ready";
      while (snapshot.status === "pending") {
        yield* Effect.sleep("1 second");
        const path = `/snapshots/${encodeURIComponent(snapshotId)}`;
        snapshot = yield* instaboxReadRequest((signal) => client.json(Snapshot, path, { signal })).pipe(
          Effect.retry(publicationReadRetry),
          Effect.mapError(() => publicationFailure("could not read snapshot status")),
        );
        if (snapshot.id !== snapshotId || snapshot.name !== name)
          return yield* publicationFailure("snapshot status response did not match the request");
        lastStatus = snapshot.status;
      }
      if (snapshot.status === "failed") return yield* publicationFailure("reported a failed snapshot");
      return { _tag: "Ready" as const, snapshotId };
    }).pipe(
      Effect.timeoutOrElse({
        duration: budgetMs,
        orElse: () => Effect.fail(publicationFailure("snapshot wait budget expired")),
      }),
    );
  }),
  findSnapshot: Effect.fn("instaboxSnapshotDriver.findSnapshot")(function* (_plan, name) {
    const client = yield* Effect.try({ try: api, catch: () => fail("find") });
    const snapshot = yield* findByName(client, name).pipe(
      Effect.mapError((error) => (error instanceof BeforeCacheSnapshotError ? error : fail("find"))),
    );
    if (snapshot === undefined) return { _tag: "Absent" as const };
    if (snapshot.status === "pending") return { _tag: "Pending" as const };
    if (snapshot.status === "failed") return { _tag: "Failed" as const, snapshotId: snapshot.id };
    return { _tag: "Ready" as const, snapshotId: snapshot.id };
  }),
  deleteSnapshot: (_plan, snapshotId) =>
    boundary("delete", async (signal) => {
      try {
        await api().request(`/snapshots/${encodeURIComponent(snapshotId)}`, {
          method: "DELETE",
          signal,
          headers: { "Idempotency-Key": `delete-${snapshotId}`, "X-Confirm-Delete": snapshotId },
        });
        return "deleted" as const;
      } catch (cause) {
        if (cause instanceof InstaboxApiError && cause.status === 404) return "absent" as const;
        throw cause;
      }
    }),
};
