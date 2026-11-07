// @concord-file
// @concord-implements docs/feature/sandbox/architecture/remote-snapshot-cache.md#e2b
import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { E2BProviderPlan } from "./layer.ts";
import { materializeE2BProviderPlan } from "./runtime.ts";
import { BeforeCacheSnapshotError, type BeforeCacheSnapshotDriver } from "./remote-snapshot/driver.ts";

const failure = (operation: string) => new BeforeCacheSnapshotError({ operation, reason: "E2B snapshot operation failed" });
const boundary = <A>(operation: string, run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: () => failure(operation) });

export const e2bSnapshotDriver: BeforeCacheSnapshotDriver<E2BProviderPlan> = {
  preserves: { disks: ["/"], memory: true }, sourceUsableAfterSnapshot: true,
  snapshotSettleMs: 60_000,
  resolveBase: Effect.fn("e2bSnapshotDriver.resolveBase")(function*(plan) {
    const key = process.env.E2B_API_KEY;
    if (!key) return yield* failure("resolve-base");
    const reference = plan.template || "base";
    const separator = reference.lastIndexOf(":");
    const name = separator === -1 ? reference : reference.slice(0, separator);
    const tag = separator === -1 ? "default" : reference.slice(separator + 1);
    const tags = yield* boundary("resolve-base", async () => {
      const { Template, NotFoundError } = await import("e2b");
      try { return await Template.getTags(name); }
      catch (cause) { if (cause instanceof NotFoundError) return []; throw cause; }
    });
    const selected = tags.find((item) => item.tag === tag);
    if (selected === undefined) return { _tag: "Ineligible" as const, code: "base-image-unverified" as const, reason: "E2B template tag does not resolve to a build" };
    const domain = yield* boundary("resolve-domain", async () => {
      const { ConnectionConfig } = await import("e2b");
      const url = new URL(new ConnectionConfig().apiUrl);
      if (url.username || url.password || url.search || url.hash) throw failure("resolve-domain");
      return url.href.replace(/\/+$/u, "");
    });
    const executionDomainId = createHash("sha256").update(JSON.stringify([domain, createHash("sha256").update(key).digest("hex")])).digest("hex");
    return {
      _tag: "Resolved" as const, executionDomainId, baseIdentity: `e2b-build:${selected.buildId}`, baseReference: reference,
      keyScope: { protocol: "niceeval.before-cache-key/v1", storageSchemaRevision: "remote-snapshot/1", artifactFormatRevision: "e2b-full/1", semanticIdentity: { executionDomainId, mode: "full" } },
    };
  }),
  createFromSnapshot: (plan, snapshotId, context) => Effect.acquireRelease(
    materializeE2BProviderPlan({ ...plan, template: snapshotId }, context).pipe(Effect.mapError(() => failure("restore"))),
    (owned) => boundary("delete-instance", () => owned.group.stop()).pipe(Effect.orDie),
  ),
  createSnapshot: (_plan, source, name) => boundary("create", async () => {
    const { Sandbox } = await import("e2b");
    const snapshot = await Sandbox.createSnapshot(source.group.primary.sandboxId, { name, mode: "full", requestTimeoutMs: 60_000 });
    return { _tag: "Ready" as const, snapshotId: snapshot.snapshotId };
  }),
  findSnapshot: (_plan, name) => boundary("find", async () => {
    const { Sandbox } = await import("e2b");
    const pages = Sandbox.listSnapshots({ name });
    const matches = new Map<string, string>();
    while (pages.hasNext) {
      for (const snapshot of await pages.nextItems()) {
        if (snapshot.names.some((fullName) => fullName.split("/").at(-1)?.replace(/:default$/u, "") === name)) matches.set(snapshot.snapshotId, snapshot.snapshotId);
      }
    }
    if (matches.size > 1) throw failure("find-ambiguous");
    const snapshotId = [...matches.values()][0];
    return snapshotId === undefined ? { _tag: "Absent" as const } : { _tag: "Ready" as const, snapshotId };
  }),
  deleteSnapshot: (_plan, snapshotId) => boundary("delete", async () => {
    const { Sandbox } = await import("e2b");
    return await Sandbox.deleteSnapshot(snapshotId) ? "deleted" as const : "absent" as const;
  }),
};
