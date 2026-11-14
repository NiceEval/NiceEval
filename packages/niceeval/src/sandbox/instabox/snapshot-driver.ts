// @concord-file
// @concord-implements docs/feature/sandbox/architecture/remote-snapshot-cache.md#instabox
import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import type { InstaboxSandboxOptions } from "../instabox.ts";
import { BeforeCacheSnapshotError, type BeforeCacheSnapshotDriver } from "../remote-snapshot/driver.ts";
import { InstaboxApi, InstaboxApiError } from "./api.ts";

const Snapshot = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.Literals(["pending", "ready", "failed"]),
});
const SnapshotList = Schema.Struct({ snapshots: Schema.Array(Snapshot) });
const fail = (operation: string) =>
  new BeforeCacheSnapshotError({ operation, reason: "Instabox snapshot operation failed" });
const snapshotSettleMs = 300_000;
const api = () => {
  const key = process.env.INSTABOX_API_KEY;
  if (!key) throw new Error("INSTABOX_API_KEY is required for Instabox");
  return new InstaboxApi(key);
};
const boundary = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({ try: run, catch: () => fail(operation) });

export const instaboxSnapshotDriver: BeforeCacheSnapshotDriver<InstaboxSandboxOptions> = {
  preserves: { disks: ["/", "/data"], memory: false },
  sourceUsableAfterSnapshot: false,
  snapshotSettleMs,
  resolveBase: Effect.fn("instaboxSnapshotDriver.resolveBase")(function* (plan) {
    const key = process.env.INSTABOX_API_KEY;
    if (!key) return yield* fail("resolve-base");
    const snapshotId = plan.snapshotId;
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
    const templateId = plan.templateId ?? plan.template ?? "universal";
    const baseIdentity = snapshotId ?? `template:${templateId}`;
    const credentialHash = createHash("sha256").update(key).digest("hex");
    const executionDomainId = createHash("sha256")
      .update(JSON.stringify(["https://api.instabox.sh", credentialHash]))
      .digest("hex");
    return {
      _tag: "Resolved" as const,
      executionDomainId,
      baseIdentity,
      baseReference: snapshotId ?? templateId,
      keyScope: {
        cacheFormat: "niceeval-instabox-cache/current",
        semanticIdentity: { executionDomainId, platform: "linux-x64-gnu" },
      },
    };
  }),
  createFromSnapshot: (plan, snapshotId, context) =>
    boundary("restore", () => import("./materialize.ts")).pipe(
      Effect.flatMap((module) => module.materializeInstabox({ ...plan, snapshotId }, context)),
      Effect.mapError(() => fail("restore")),
    ),
  createSnapshot: Effect.fn("instaboxSnapshotDriver.createSnapshot")(
    function* (_plan, source, name) {
      const client = yield* Effect.try({ try: api, catch: () => fail("create") });
      const created = yield* Effect.tryPromise({
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
                reason: `Instabox rejected the snapshot request (${cause.code})`,
              };
            throw cause;
          }
        },
        catch: () => fail("create"),
      });
      if (created._tag === "Rejected") return created;
      let snapshot = created.snapshot;
      const deadline = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      while (snapshot.status === "pending") {
        const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
        if (now - deadline >= snapshotSettleMs) return yield* fail("wait-ready");
        yield* Effect.sleep("1 second");
        snapshot = yield* boundary("wait-ready", (signal) =>
          client.json(Snapshot, `/snapshots/${encodeURIComponent(snapshot.id)}`, { signal }),
        );
      }
      if (snapshot.status !== "ready" || snapshot.name !== name) return yield* fail("wait-ready");
      return { _tag: "Ready" as const, snapshotId: snapshot.id };
    },
    Effect.timeout(snapshotSettleMs),
    Effect.mapError(() => fail("create")),
  ),
  findSnapshot: Effect.fn("instaboxSnapshotDriver.findSnapshot")(function* (_plan, name) {
    // The official SnapshotList is complete and has no pagination fields.
    const result = yield* boundary("find", (signal) => api().json(SnapshotList, "/snapshots", { signal }));
    const matches = result.snapshots.filter((snapshot) => snapshot.name === name);
    if (matches.length > 1) return yield* fail("find-ambiguous");
    const snapshot = matches[0];
    if (snapshot === undefined) return { _tag: "Absent" as const };
    if (snapshot.status === "pending") return { _tag: "Pending" as const };
    if (snapshot.status !== "ready") return yield* fail("find-failed");
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
