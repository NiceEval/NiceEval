// @concord-file
// @concord-implements docs/feature/sandbox/architecture/remote-snapshot-cache.md#opensandbox
import { createHash } from "node:crypto";
import { Effect } from "effect";
import type { SandboxManager } from "@alibaba-group/opensandbox";
import type { OpenSandboxOptions } from "../opensandbox.ts";
import { BeforeCacheSnapshotError, type BeforeCacheSnapshotDriver } from "../remote-snapshot/driver.ts";

const fail = (operation: string) => new BeforeCacheSnapshotError({ operation, reason: "OpenSandbox snapshot operation failed" });
const snapshotSettleMs = 300_000;
function connection() {
  const value = process.env.OPEN_SANDBOX_DOMAIN;
  if (!value) throw fail("resolve-domain");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw fail("resolve-domain");
  return { domain: url.toString().replace(/\/+$/u, ""), apiKey: process.env.OPEN_SANDBOX_API_KEY, useServerProxy: true, disableMetrics: true };
}
const withManager = <A>(operation: string, run: (manager: SandboxManager) => Promise<A>) => Effect.tryPromise({
  try: async () => {
    const { SandboxManager } = await import("@alibaba-group/opensandbox");
    const manager = SandboxManager.create({ connectionConfig: connection() });
    try { return await run(manager); } finally { await manager.close(); }
  }, catch: () => fail(operation),
});

export const openSandboxSnapshotDriver: BeforeCacheSnapshotDriver<OpenSandboxOptions> = {
  preserves: { disks: ["/"], memory: false }, sourceUsableAfterSnapshot: false,
  snapshotSettleMs,
  resolveBase: Effect.fn("openSandboxSnapshotDriver.resolveBase")(function*(plan) {
    if (!/@sha256:[a-fA-F0-9]{64}$/u.test(plan.image)) return {
      _tag: "Ineligible" as const, code: "base-image-unverified" as const, reason: "OpenSandbox Before cache requires a digest-pinned image",
    };
    const config = yield* Effect.try({ try: connection, catch: () => fail("resolve-base") });
    const executionDomainId = createHash("sha256").update(JSON.stringify([config.domain,
      createHash("sha256").update(config.apiKey ?? "").digest("hex")])).digest("hex");
    return {
      _tag: "Resolved" as const, executionDomainId, baseIdentity: plan.image,
      baseReference: plan.image.slice(0, plan.image.lastIndexOf("@")),
      keyScope: {
        cacheFormat: "niceeval-opensandbox-cache/current",
        semanticIdentity: { executionDomainId, urlPath: new URL(config.domain).pathname, targetPlatform: { ...plan.targetPlatform } },
      },
    };
  }),
  createFromSnapshot: (plan, snapshotId, context) => Effect.tryPromise({ try: () => import("./materialize.ts"), catch: () => fail("restore") }).pipe(
    Effect.flatMap((module) => module.materializeOpenSandbox(plan, context, snapshotId)),
    Effect.mapError(() => fail("restore")),
  ),
  createSnapshot: Effect.fn("openSandboxSnapshotDriver.createSnapshot")(function*(plan, source, name) {
    let snapshot = yield* withManager("create", (manager) => manager.createSnapshot(source.group.primary.sandboxId, { name }));
    const started = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
    while (snapshot.status.state !== "Ready") {
      if (snapshot.status.state === "Failed") return yield* fail("wait-ready");
      const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis);
      if (now - started >= snapshotSettleMs) return yield* fail("wait-ready");
      yield* Effect.sleep("1 second");
      snapshot = yield* withManager("wait-ready", (manager) => manager.getSnapshot(snapshot.id));
    }
    return { _tag: "Ready" as const, snapshotId: snapshot.id };
  }, Effect.timeout(snapshotSettleMs), Effect.mapError(() => fail("create"))),
  findSnapshot: Effect.fn("openSandboxSnapshotDriver.findSnapshot")(function*(_plan, name) {
    const matches = yield* withManager("find", async (manager) => {
      const found = [];
      let page = 1;
      while (true) {
        const result = await manager.listSnapshots({ name, page, pageSize: 100 });
        found.push(...result.items.filter((item) => item.name === name));
        if (result.pagination?.hasNextPage !== true) break;
        page++;
      }
      return found;
    });
    if (matches.length > 1) return yield* fail("find-ambiguous");
    const snapshot = matches[0];
    if (snapshot === undefined) return { _tag: "Absent" as const };
    if (snapshot.status.state === "Failed") return yield* fail("find-failed");
    return snapshot.status.state === "Ready" ? { _tag: "Ready" as const, snapshotId: snapshot.id } : { _tag: "Pending" as const };
  }),
  deleteSnapshot: (_plan, snapshotId) => withManager("delete", async (manager) => {
    const { SandboxApiException } = await import("@alibaba-group/opensandbox");
    try { await manager.deleteSnapshot(snapshotId); return "deleted" as const; }
    catch (cause) { if (cause instanceof SandboxApiException && cause.statusCode === 404) return "absent" as const; throw cause; }
  }),
};
