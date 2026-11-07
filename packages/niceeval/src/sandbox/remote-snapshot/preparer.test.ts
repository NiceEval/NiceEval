// cases: docs/engineering/testing/architecture/unit/sandbox.md
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Clock, Deferred, Effect, Fiber } from "effect";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { noSandboxBackendCapabilities, type BeforeCacheStep, type SandboxProviderBackend } from "../backend.ts";
import type { MaterializedSandboxCase } from "../case-types.ts";
import { computeCaseKey, digestOf } from "../identity.ts";
import type { BeforeCachePreparationContext } from "../layer.ts";
import { normalizeSandboxPaths } from "../paths.ts";
import type { SandboxRuntimeMaterializeContext } from "../runtime.ts";
import { userDatabaseHost } from "../../user-database/index.ts";
import { BeforeCacheSnapshotError, type BeforeCacheSnapshotDriver } from "./driver.ts";
import { SNAPSHOT_LEASE_MS, snapshotLedgerRequest } from "./ledger.ts";
import { remoteSnapshotPreparer } from "./preparer.ts";
import { runWithTestClock, TestClock } from "../../test-support/effect-v4.ts";

let home: string;
const initialExecArgv = [...process.execArgv];
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "niceeval-snapshot-protocol-"));
  vi.stubEnv("NICEEVAL_HOME", home);
  process.execArgv.push("--import", "tsx");
});
afterAll(async () => {
  process.execArgv.splice(0, process.execArgv.length, ...initialExecArgv);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** Only the Provider boundary is simulated. The preparer and ledger are real. */
class RecordingBackend implements SandboxProviderBackend {
  readonly sandboxId = randomUUID();
  readonly workdir = "/workspace";
  readonly otlpHost = null;
  readonly capabilities = noSandboxBackendCapabilities;
  stopped = false;
  constructor(readonly files = new Map<string, string>()) {}
  async runCommand(command: string, args: readonly string[] = []) {
    if (this.stopped) throw new Error("Instance is stopped");
    if (command === "cat" && args[0] === "/proc/self/mountinfo") return { exitCode: 0, stdout: "1 0 8:1 / / rw,relatime - ext4 /dev/root rw\n", stderr: "" };
    if (command === "cat") return { exitCode: this.files.has(args[0]!) ? 0 : 1, stdout: this.files.get(args[0]!) ?? "", stderr: "" };
    if (command === "sh" && args[1]?.startsWith("install -d")) { this.files.set(args[4]!, args[3]!); return { exitCode: 0, stdout: "", stderr: "" }; }
    if (command === "sync") return { exitCode: 0, stdout: "", stderr: "" };
    throw new Error(`Unsupported recording Provider command: ${command}`);
  }
  async runShell(): Promise<never> { throw new Error("Unused Provider operation"); }
  async readText(path: string) { return this.files.get(path) ?? ""; }
  async writeText(path: string, content: string) { this.files.set(path, content); }
  async readBytes(path: string) { return Buffer.from(await this.readText(path)); }
  async writeBytes(path: string, content: Uint8Array) { await this.writeText(path, Buffer.from(content).toString()); }
  async pathExists(path: string) { return this.files.has(path); }
  async stop() { this.stopped = true; }
  async uploadFile(): Promise<never> { throw new Error("Unused Provider operation"); }
  async uploadDirectory(): Promise<never> { throw new Error("Unused Provider operation"); }
  async downloadFile(): Promise<never> { throw new Error("Unused Provider operation"); }
  async downloadDirectory(): Promise<never> { throw new Error("Unused Provider operation"); }
}

const materialize = {} as SandboxRuntimeMaterializeContext; // Recording driver ignores Provider options.
function fixture(outcome: "ready" | "pending" | "absent" | "success") {
  const domain = randomUUID();
  const instances: RecordingBackend[] = [];
  const snapshots = new Map<string, { id: string; name: string; files: Map<string, string> }>();
  const deletions: string[] = [];
  const lookups: string[] = [];
  const own = (files?: Map<string, string>) => Effect.acquireRelease(
    Effect.sync((): MaterializedSandboxCase => {
      const backend = new RecordingBackend(files);
      instances.push(backend);
      return {
        sandbox: normalizeSandboxPaths(backend, "recording"), authorBackend: backend,
        group: { primary: { sandboxId: backend.sandboxId }, resources: {}, stop: () => backend.stop() },
        caseKind: "prebuilt", caseKey: computeCaseKey({ caseKind: "prebuilt", materializerRevision: "recording", buildKeys: [], caseParams: {} }),
        buildKeys: [], identity: {}, facts: {},
      };
    }),
    (owned) => Effect.promise(() => owned.group.stop()),
  );
  let snapshotCalls = 0;
  let unavailable = false;
  const driver: BeforeCacheSnapshotDriver<void> = {
    preserves: { disks: ["/"], memory: false }, sourceUsableAfterSnapshot: true,
    snapshotSettleMs: 60_000,
    resolveBase: () => Effect.succeed({
      _tag: "Resolved", executionDomainId: domain, baseIdentity: "immutable-base", baseReference: "declared-base",
      keyScope: { protocol: "test", storageSchemaRevision: "1", artifactFormatRevision: "1", semanticIdentity: {} },
    }),
    createFromSnapshot: (_plan, id) => Effect.suspend(() => {
      const snapshot = snapshots.get(id);
      return unavailable || snapshot === undefined
        ? Effect.fail(new BeforeCacheSnapshotError({ operation: "restore", reason: "Snapshot is absent" }))
        : own(new Map(snapshot.files));
    }),
    createSnapshot: (_plan, source, name) => Effect.suspend(() => {
      snapshotCalls++;
      const id = `remote-${randomUUID()}`;
      const backend = source.authorBackend;
      if (!(backend instanceof RecordingBackend)) throw new Error("Expected recording Provider");
      if (outcome !== "absent") snapshots.set(id, { id, name, files: new Map(backend.files) });
      return outcome === "success" ? Effect.succeed({ _tag: "Ready" as const, snapshotId: id })
        : Effect.fail(new BeforeCacheSnapshotError({ operation: "create", reason: "Lost response after acceptance" }));
    }),
    findSnapshot: (_plan, name) => Effect.sync(() => {
      lookups.push(name);
      const snapshot = [...snapshots.values()].find((value) => value.name === name);
      return snapshot === undefined ? { _tag: "Absent" as const } : outcome === "pending" ? { _tag: "Pending" as const }
        : { _tag: "Ready" as const, snapshotId: snapshot.id };
    }),
    deleteSnapshot: (_plan, id) => Effect.sync(() => { deletions.push(id); return snapshots.delete(id) ? "deleted" as const : "absent" as const; }),
  };
  const declarationMetadata = { action: "prepare" };
  const step: BeforeCacheStep = {
    operationId: randomUUID(), positions: ["prepare"], declaration: {
      baseIdentity: "immutable-base", beforeCacheKey: `prefix:${domain}`, declarationDigest: `sha256:${digestOf(declarationMetadata)}`,
      requiredState: "all", storageSchemaRevision: "1", artifactFormatRevision: "1", changeFrequency: 100, declarationMetadata,
    },
  };
  const context: BeforeCachePreparationContext = { providerId: "test/recording-snapshot", runId: randomUUID(), materializeBase: () => own() };
  return { domain, driver, step, context, instances, snapshots, deletions, lookups,
    snapshotCalls: () => snapshotCalls, makeUnavailable: () => { unavailable = true; } };
}

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent.each(["ready", "pending", "absent-before-settle", "absent-after-settle"] as const)("uncertain snapshot requests remain accounted for and settle by exact name when remote status is %s", { timeout: 30_000 }, async (status) => {
  const outcome = status.startsWith("absent") ? "absent" : status as "ready" | "pending";
  const f = fixture(outcome);
  const preparer = remoteSnapshotPreparer(f.driver);
  await runWithTestClock(Effect.scoped(Effect.gen(function*() {
    expect((yield* preparer.lookup(undefined, f.context, [f.step]))._tag).toBe("Miss");
    const result = yield* Effect.scoped(Effect.gen(function*() {
      const staging = yield* preparer.materializeFrom(undefined, f.context, "staging", { _tag: "Base" }, materialize);
      if (staging._tag !== "Materialized") throw new Error("Expected staging");
      return yield* preparer.capture(undefined, f.context, staging.sandbox, f.step);
    }));
    expect(result).toMatchObject({ _tag: "Degraded", reason: "snapshot-uncertain" });
    if (status === "absent-after-settle") yield* TestClock.adjust(f.driver.snapshotSettleMs);
  })));
  expect(f.snapshotCalls()).toBe(1);
  expect(f.instances.every((instance) => instance.stopped)).toBe(true);
  expect(f.lookups.length).toBeGreaterThan(0);
  expect(f.lookups.every((name) => name.startsWith("niceeval-"))).toBe(true);
  expect(f.snapshots.size).toBe(outcome === "pending" ? 1 : 0);
  expect(f.deletions.length).toBe(outcome === "ready" ? 1 : 0);
  {
    // Pending and not-yet-settled requests remain claimable by a later Run.
    await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
      const database = yield* userDatabaseHost.open({ home });
      const now = yield* Clock.currentTimeMillis;
      const token = randomUUID();
      const claimed = yield* snapshotLedgerRequest(database, { operation: "claim-delete", provider: f.context.providerId,
        executionDomainId: f.domain, now, token });
      const retained = status === "pending" || status === "absent-before-settle";
      expect(claimed._tag).toBe(retained ? "Claimed" : "Empty");
      if (claimed._tag === "Claimed") expect(claimed.entry.requested_at).toBe(0);
      if (claimed._tag === "Claimed") yield* snapshotLedgerRequest(database, {
        operation: "settle-delete", provider: f.context.providerId, executionDomainId: f.domain, now,
        artifactId: claimed.entry.artifact_id, token, deleted: false,
      });
    })));
  }
});

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent("two cold invocations wait for one snapshot publication and the follower consumes a hit", { timeout: 30_000 }, async () => {
  const f = fixture("success");
  const first = remoteSnapshotPreparer(f.driver), second = remoteSnapshotPreparer(f.driver);
  const follower = { ...f.context, runId: randomUUID() };
  await runWithTestClock(Effect.scoped(Effect.gen(function*() {
    expect((yield* first.lookup(undefined, f.context, [f.step]))._tag).toBe("Miss");
    const waiting = yield* Effect.forkScoped(second.lookup(undefined, follower, [f.step]));
    while (!Array.from(yield* TestClock.sleeps()).includes(500)) yield* Effect.yieldNow;
    const prepared = yield* Effect.scoped(Effect.gen(function*() {
      const staging = yield* first.materializeFrom(undefined, f.context, "staging", { _tag: "Base" }, materialize);
      if (staging._tag !== "Materialized") throw new Error("Expected staging");
      return yield* first.capture(undefined, f.context, staging.sandbox, f.step);
    }));
    expect(prepared._tag).toBe("Published");
    yield* TestClock.adjust(500);
    expect((yield* Fiber.join(waiting))._tag).toBe("Hit");
    expect(f.snapshotCalls()).toBe(1);
  })));
  expect(f.instances.every((instance) => instance.stopped)).toBe(true);
  expect(f.deletions).toHaveLength(0);
});

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent("a writer resumed after takeover reports lease loss without publishing or deleting the recovered snapshot", { timeout: 30_000 }, async () => {
  const f = fixture("success");
  await runWithTestClock(Effect.scoped(Effect.gen(function*() {
    const accepted = yield* Deferred.make<void>();
    const resume = yield* Deferred.make<void>();
    const driver: BeforeCacheSnapshotDriver<void> = { ...f.driver, createSnapshot: (plan, source, name) => Effect.gen(function*() {
      const result = yield* f.driver.createSnapshot(plan, source, name);
      yield* Deferred.succeed(accepted, undefined);
      yield* Deferred.await(resume);
      return result;
    }) };
    const preparer = remoteSnapshotPreparer(driver);
    yield* preparer.lookup(undefined, f.context, [f.step]);
    const staging = yield* preparer.materializeFrom(undefined, f.context, "staging", { _tag: "Base" }, materialize);
    if (staging._tag !== "Materialized") throw new Error("Expected staging");
    const original = yield* Effect.forkScoped(preparer.capture(undefined, f.context, staging.sandbox, f.step));
    yield* Deferred.await(accepted);
    const database = yield* userDatabaseHost.open({ home });
    const domain = { provider: f.context.providerId, executionDomainId: f.domain, now: SNAPSHOT_LEASE_MS + 1 };
    const token = randomUUID();
    const taken = yield* snapshotLedgerRequest(database, { ...domain, operation: "lookup-reserve", token, artifactId: randomUUID(), holdId: randomUUID(),
      beforeCacheKey: f.step.declaration.beforeCacheKey, baseIdentity: "immutable-base", declarationJson: "unused-on-takeover", replacementScope: "unused-on-takeover" });
    expect(taken._tag).toBe("TakenOver");
    if (taken._tag !== "TakenOver") throw new Error("Expected takeover");
    const snapshotId = [...f.snapshots.keys()][0]!;
    expect((yield* snapshotLedgerRequest(database, { ...domain, operation: "publish", artifactId: taken.entry.artifact_id, token, snapshotId, holdId: randomUUID() }))._tag).toBe("Published");
    yield* Deferred.succeed(resume, undefined);
    expect(yield* Fiber.join(original)).toMatchObject({ _tag: "Degraded", reason: "lease-lost" });
    expect(f.deletions).toHaveLength(0);
  })));
  expect(f.instances.every((instance) => instance.stopped)).toBe(true);
  expect(f.snapshots.size).toBe(1);
});

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent("an unavailable parent snapshot yields one clean Base instance without publishing its child", { timeout: 30_000 }, async () => {
  const f = fixture("success");
  const preparer = remoteSnapshotPreparer(f.driver);
  await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
    yield* preparer.lookup(undefined, f.context, [f.step]);
    const published = yield* Effect.scoped(Effect.gen(function*() {
      const staging = yield* preparer.materializeFrom(undefined, f.context, "staging", { _tag: "Base" }, materialize);
      if (staging._tag !== "Materialized") throw new Error("Expected staging");
      return yield* preparer.capture(undefined, f.context, staging.sandbox, f.step);
    }));
    expect(published._tag).toBe("Published");
    if (published._tag !== "Published") throw new Error("Expected parent publication");
    f.makeUnavailable();
    const child = yield* Effect.scoped(preparer.materializeFrom(undefined, f.context, "staging", { _tag: "Artifact", artifact: published.artifact }, materialize));
    if (child._tag !== "Materialized") throw new Error("Expected fallback staging");
    expect(child.start._tag).toBe("FellBackToBase");
    expect(f.snapshotCalls()).toBe(1);
  })));
  expect(f.instances).toHaveLength(2);
  expect(f.instances.every((instance) => instance.stopped)).toBe(true);
  expect(f.snapshots.size).toBe(1); // Published ancestor survives the failed restoration.
});
