// cases: docs/engineering/testing/architecture/unit/sandbox.md
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Clock, Deferred, Effect, Fiber, Option } from "effect";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { noSandboxBackendCapabilities, type BeforeCacheStep, type SandboxProviderBackend } from "../backend.ts";
import type { MaterializedSandboxCase } from "../case-types.ts";
import { computeCaseKey, digestOf } from "../identity.ts";
import { defineSandboxTemplate, sandboxProviderPlan, sandboxProviderBindingOf, type BeforeCachePreparationContext } from "../layer.ts";
import { command, shell } from "../commands.ts";
import { registerSandboxContent } from "../content.ts";
import { linkSandboxLayers } from "../link.ts";
import { planLinkedRuns } from "../plan.ts";
import { prepareBeforeCaches } from "../../runner/before-cache-preparation.ts";
import type { Attempt } from "../../runner/types.ts";
import { ArtifactPrepareCoordinator, runAgentInstall } from "../../agents/provisioner.ts";
import type { AgentInstall, AgentInstaller } from "../../agents/types.ts";
import { AGENT_DOCKERFILE_CACHE_SAFE } from "../../agents/cache-marker.ts";
import { defineSandboxAgent } from "../../define.ts";
import { completeEvidenceCoverage } from "../../assertions/coverage.ts";
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
  await writeFile(join(home, "payload"), "deterministic staged Agent payload");
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
    if (command === "/bin/sh") return this.runShell(args.at(-1)!);
    if (command === "test") return { exitCode: this.files.has(args[1]!) ? 0 : 1, stdout: "", stderr: "" };
    throw new Error(`Unsupported recording Provider command: ${command}`);
  }
  async runShell(script: string) {
    if (script.includes("uname -s")) return { exitCode: 0, stdout: "Linux\nx86_64\nglibc\n", stderr: "" };
    this.files.set("last-action", script);
    return { exitCode: 0, stdout: "", stderr: "" };
  }
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
      keyScope: { cacheFormat: "test", semanticIdentity: {} },
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
    operationId: randomUUID(), positions: ["prepare"], declaringOwner: "eval:prepare", declaration: {
      baseIdentity: "immutable-base", beforeCacheKey: `prefix:${domain}`, declarationDigest: `sha256:${digestOf(declarationMetadata)}`,
      requiredState: "all", cacheFormat: "test", changeFrequency: 100, declarationMetadata,
    },
  };
  const context: BeforeCachePreparationContext = { providerId: "test/recording-snapshot", runId: randomUUID(), materializeBase: () => own() };
  return { domain, driver, step, context, instances, snapshots, deletions, lookups,
    snapshotCalls: () => snapshotCalls, makeUnavailable: () => { unavailable = true; } };
}

const targetPlatform = { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" } as const;
function agentFixture(mode: "success" | "install-failed" | "recheck-missed" = "success") {
  const identity = { agent: "recording-agent", version: "1.2.3", revision: "1" };
  let prepares = 0, installs = 0;
  const install: AgentInstall = { identity, probe: command("test", ["-f", "/opt/agent/ready"]) };
  const installer: AgentInstaller = {
    identity, installMode: "staged", [AGENT_DOCKERFILE_CACHE_SAFE]: true,
    prepareArtifact: () => {
      prepares++;
      return { platform: targetPlatform, content: registerSandboxContent(pathToFileURL(join(home, "payload"))),
        targetPath: "/opt/agent/payload", install: { kind: "self-contained", binPath: "bin/agent" } };
    },
    install: async (sandbox) => {
      installs++;
      if (mode === "install-failed") throw new Error("Provider rejected upload");
      if (mode !== "recheck-missed") await sandbox.writeText("/opt/agent/ready", "1.2.3");
    },
  };
  return { install, installer, prepares: () => prepares, installs: () => installs };
}

async function agentAttempts(
  f: ReturnType<typeof fixture>, agent: ReturnType<typeof agentFixture>,
  options: { continues?: boolean; actions?: number; second?: string; opaque?: string; safe?: boolean } = {},
): Promise<Attempt[]> {
  const preparer = remoteSnapshotPreparer({ ...f.driver, sourceUsableAfterSnapshot: options.continues ?? true });
  const providerPlan = sandboxProviderPlan({ provider: "recording", plannerRevision: "1", caseKind: "prebuilt",
    target: { platform: targetPlatform, source: "provider-defined" },
    scheduling: { recommendedConcurrency: 2, lane: { key: f.domain, limit: 2 }, admission: { _tag: "Shared" } },
    module: { id: f.context.providerId, capabilities: { retention: { _tag: "DestroyOnly" }, reuse: { _tag: "Unsupported", reason: "test" },
      sessionLimit: { _tag: "Unlimited" } }, beforeCache: { _tag: "RunPrepared", coverage: "all", preparer },
      materialize: (_plan, context) => f.context.materializeBase(context), collectBuildPreparation: () => Effect.succeed(Option.none()) },
    runtimePlan: undefined,
    build: { _tag: "None", caseKey: computeCaseKey({ caseKind: "prebuilt", materializerRevision: "recording", buildKeys: [], caseParams: {} }), buildKeys: [] },
    publishableIdentity: {}, privateFingerprintIdentity: {},
  });
  let layer = defineSandboxTemplate({ provider: "recording", kind: "test", publishableIdentity: {}, privateFingerprintIdentity: {},
    commandPlanLocator: { _tag: "Opaque", reason: { code: "test", summary: "Recording snapshot driver" } },
    leakGate: { _tag: "None" }, plan: () => Effect.succeed(providerPlan) });
  if ((options.actions ?? 2) > 0) layer = layer.before(shell({ id: "one", command: "one" }));
  if ((options.actions ?? 2) > 1) layer = layer.before(shell({ id: "two", command: options.second ?? "two" }));
  layer = layer.before(async (sandbox) => { await sandbox.writeText("opaque", options.opaque ?? "opaque"); })
    .before(shell({ id: "after-opaque", command: "must-not-be-cached" }));
  const pairs = await Effect.runPromise(linkSandboxLayers([{ eval: { id: "one" }, experiment: { id: "cloud", layer }, agent: { kind: "sandbox", name: "probe" } }]));
  const planned = await Effect.runPromise(planLinkedRuns(pairs.map((pair) => ({ pair, authorBaseDirs: { eval: "/tmp", experiment: "/tmp" }, requirements: [] }))));
  const installer = options.safe === false ? { ...agent.installer, [AGENT_DOCKERFILE_CACHE_SAFE]: undefined } : agent.installer;
  const adapter = defineSandboxAgent({ name: "recording-agent", evidenceCoverage: completeEvidenceCoverage,
    install: [agent.install], installers: [installer], send: async () => { throw new Error("Unused Agent send"); } });
  return planned.map(({ plan }) => ({ plan, evalDef: { id: "one" }, run: { experimentId: "cloud", sandboxBeforeCache: "use",
    agent: adapter } }) as Attempt);
}

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent.each([true, false])("Agent snapshots warm all consumers before an opaque barrier and invalidate only changed descendants (continuous staging: %s)", { timeout: 30_000 }, async (continues) => {
  const f = fixture("success"), agent = agentFixture();
  const input = await agentAttempts(f, agent, { continues });
  const coordinator = new ArtifactPrepareCoordinator();
  const prepare = (attempts: Attempt[]) => prepareBeforeCaches(attempts, {
    runIds: new Map([["cloud", randomUUID()]]), artifactPrepare: coordinator,
  });
  let initialKey: string | undefined;
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const result = yield* prepare([...input, ...input]);
    expect([...result.failuresByPair.values()].map(String)).toEqual([]);
    expect(result.summary).toMatchObject({ prepared: 3, failed: 0, degraded: 0 });
    const use = [...result.preparedByPair.values()][0]!;
    expect(use).toMatchObject({ satisfiedActionCount: 2, agentDerived: true });
    initialKey = use.artifact!.beforeCacheKey;
    expect(f.instances).toHaveLength(continues ? 1 : 3);
    for (let index = 0; index < 2; index++) {
      yield* Effect.scoped(Effect.gen(function* () {
        // Consumers use the publishing preparer and its Run hold.
        const row = [...f.snapshots.values()].find((snapshot) => snapshot.files.has("/opt/agent/ready"))!;
        expect(row.files.get("last-action")).toContain("two");
        expect(row.files.has("opaque")).toBe(false);
        if (input[0]!.plan._tag !== "Sandbox") throw new Error("Expected Sandbox plan");
        const binding = Option.getOrThrow(sandboxProviderBindingOf(input[0]!.plan.providerPlan));
        if (binding.beforeCache._tag !== "RunPrepared") throw new Error("Expected prepared binding");
        const consumer = yield* binding.beforeCache.preparer.materializeFrom(undefined, use.context, "consumer", { _tag: "Artifact", artifact: use.artifact! }, materialize);
        if (consumer._tag !== "Materialized") throw new Error("Expected consumer");
        expect(consumer.start._tag).toBe("Restored");
        const installed = yield* runAgentInstall([agent.install], [agent.installer], consumer.sandbox.sandbox, {
          coordinator: Option.some(coordinator), targetPlatform, signal: yield* Effect.abortSignal, progress: () => undefined,
        });
        expect(installed).toMatchObject([{ outcome: "hit" }]);
      }));
    }
  })));
  expect(agent.prepares()).toBe(1);
  expect(agent.installs()).toBe(1);
  expect(f.instances.every((instance) => instance.stopped)).toBe(true);
  const opaqueChanged = await agentAttempts(f, agent, { continues, opaque: "changed" });
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const warm = yield* prepare(opaqueChanged);
    expect(warm.summary).toMatchObject({ hit: 3, prepared: 0 });
    expect([...warm.preparedByPair.values()][0]!.artifact!.beforeCacheKey).toBe(initialKey);
  })));
  const changed = await agentAttempts(f, agent, { continues, second: "two-updated" });
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const rebuilt = yield* prepare(changed);
    expect(rebuilt.summary).toMatchObject({ hit: 1, prepared: 2, failed: 0 });
    expect([...rebuilt.preparedByPair.values()][0]!.artifact!.beforeCacheKey).not.toBe(initialKey);
  })));
  expect(agent.prepares()).toBe(1); // Same Run-level payload cache also serves the rebuilt branch.
  expect(agent.installs()).toBe(2);
  expect(f.instances.every((instance) => instance.stopped)).toBe(true);
});

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent.each(["install-failed", "recheck-missed"] as const)("Agent preparation %s degrades to its published parent without failing the pair", { timeout: 30_000 }, async (mode) => {
  const f = fixture("success"), agent = agentFixture(mode);
  const input = await agentAttempts(f, agent);
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const result = yield* prepareBeforeCaches(input, { runIds: new Map([["cloud", randomUUID()]]) });
    expect(result.failuresByPair.size).toBe(0);
    expect(result.summary).toMatchObject({ prepared: 2, degraded: 1, failed: 0 });
    const use = [...result.preparedByPair.values()][0]!;
    expect(use).toMatchObject({ satisfiedActionCount: 2, degraded: { reason: "agent-install-failed" } });
    expect(use.agentDerived).toBeUndefined();
    expect(use.artifact!.beforeCacheKey).toMatch(/^prefix:/);
    expect(f.snapshotCalls()).toBe(2);
  })));
  expect(f.instances.every((instance) => instance.stopped)).toBe(true);
});

// @feature docs/feature/sandbox/architecture/remote-snapshot-cache.md
test.concurrent.each([true, false])("an empty eligible chain derives directly from Base only for cache-safe installers (safe: %s)", { timeout: 30_000 }, async (safe) => {
  const f = fixture("success"), agent = agentFixture();
  const input = await agentAttempts(f, agent, { actions: 0, safe });
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const result = yield* prepareBeforeCaches(input, { runIds: new Map([["cloud", randomUUID()]]) });
    expect(result.summary).toMatchObject({ total: safe ? 1 : 0, prepared: safe ? 1 : 0, failed: 0 });
    if (safe) expect([...result.preparedByPair.values()][0]).toMatchObject({ satisfiedActionCount: 0, agentDerived: true });
    else expect(result.preparedByPair.size).toBe(0);
  })));
  expect(agent.installs()).toBe(safe ? 1 : 0);
  expect(f.instances.every((instance) => instance.stopped)).toBe(true);
});

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
