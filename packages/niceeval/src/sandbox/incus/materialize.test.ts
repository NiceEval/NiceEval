// cases: docs/engineering/testing/architecture/unit/sandbox.md
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Effect } from "effect";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { prepareBeforeCaches } from "../../runner/before-cache-preparation.ts";
import type { Attempt } from "../../runner/types.ts";
import { shell } from "../commands.ts";
import { defineSandboxTemplate, sandboxProviderPlan } from "../layer.ts";
import { linkSandboxLayers } from "../link.ts";
import { planLinkedRuns } from "../plan.ts";
import { computeCaseKey } from "../identity.ts";
import { IncusControl, type IncusInstance, type IncusInstanceSpec, type IncusVolume, type IncusVolumeSpec } from "./control.ts";
import { incusProviderModule } from "./materialize.ts";
import { incusRepositoryHost } from "./repository.ts";
import type { IncusRuntimePlan } from "./plan.ts";
import { parseIncusImageLocator } from "./image.ts";
import { INCUS_USER, INCUS_WORKDIR } from "./descriptor.ts";

let home: string;
const initialExecArgv = [...process.execArgv];
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "niceeval-incus-settlement-"));
  vi.stubEnv("NICEEVAL_HOME", home);
  process.execArgv.push("--import", "tsx");
});
afterAll(async () => {
  process.execArgv.splice(0, process.execArgv.length, ...initialExecArgv);
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** Only Incus resource operations are simulated; allocation and artifact ledgers are real. */
class IncusApi {
  readonly instances = new Map<string, IncusInstance>();
  readonly volumes = new Map<string, IncusVolume>();
  copies = 0;
  constructor(readonly mode: "staging" | "capture" | "action" | "ledger") {}
  async assertGuestInitMountsBlockDockerData() {
    if (this.mode === "staging") throw new Error("Provider cannot create staging");
  }
  async listInstances(project: string) { return [...this.instances.entries()].filter(([key]) => key.startsWith(project + "/")).map(([, value]) => value); }
  async listVolumes(project: string) { return [...this.volumes.entries()].filter(([key]) => key.startsWith(project + "/")).map(([, value]) => value); }
  async createVolume(input: IncusVolumeSpec) {
    this.volumes.set(input.project + "/" + input.name, { name: input.name, type: "custom", contentType: input.contentType, config: { ...input.config, size: String(input.sizeBytes) } });
  }
  async createInstance(input: IncusInstanceSpec) {
    this.instances.set(input.project + "/" + input.name, { name: input.name, type: "virtual-machine", status: "Stopped", config: input.config });
  }
  async getInstance(project: string, name: string) { return this.instances.get(project + "/" + name); }
  async getVolume(project: string, _pool: string, name: string) { return this.volumes.get(project + "/" + name); }
  async startInstance(project: string, name: string) { const key = project + "/" + name; this.instances.set(key, { ...this.instances.get(key)!, status: "Running" }); }
  async stopInstance(project: string, name: string) { const key = project + "/" + name; this.instances.set(key, { ...this.instances.get(key)!, status: "Stopped" }); }
  async deleteInstance(project: string, name: string) { this.instances.delete(project + "/" + name); }
  async deleteVolume(project: string, _pool: string, name: string) { this.volumes.delete(project + "/" + name); }
  async waitAbsent() {}
  async waitVolumeAbsent() {}
  async getStoragePoolResources() { return { free: 1_000_000, used: 100, total: 1_000_100 }; }
  async exec(_project: string, _instance: string, args: readonly string[]) {
    const command = args.join(" ");
    if (command.includes("exit 27")) return { exitCode: 27, stdout: "", stderr: "author action failed" };
    if (command === "id -u") return { exitCode: 0, stdout: "1000\n", stderr: "" };
    if (command.includes("docker info")) return { exitCode: 0, stdout: "HOST=\nServer Version: 27\nDocker Compose version v2.30\n", stderr: "" };
    return { exitCode: 0, stdout: "", stderr: "" };
  }
  spawnExec(project: string, instance: string, args: readonly string[]) {
    const stdout = new PassThrough(), stderr = new PassThrough();
    const completed = Promise.resolve().then(async () => {
      const result = await this.exec(project, instance, args);
      stdout.end(result.stdout); stderr.end(result.stderr);
      return result.exitCode;
    });
    return { stdin: new PassThrough(), stdout, stderr, pid: undefined, wait: () => completed, killHost: () => undefined };
  }
  async copyInstance(input: { targetProject: string; targetName: string; config: Record<string, string> }) {
    this.copies++;
    // The service accepted the copy; its response is lost. It must remain accounted for.
    this.instances.set(input.targetProject + "/" + input.targetName, { name: input.targetName, type: "virtual-machine", status: "Stopped", config: input.config });
    throw new Error("Provider copy accepted but response lost");
  }
}

function runtimePlan(): IncusRuntimePlan {
  return { image: parseIncusImageLocator("base@sha256:" + "a".repeat(64), "test image"), imageFingerprint: "a".repeat(64),
    project: "runtime", storagePool: "pool-" + randomUUID(), network: "network", workdir: INCUS_WORKDIR, user: INCUS_USER,
    hostGateway: "10.0.0.1", resources: {}, allocatedDockerDataBytes: 1024, acceptDevelopmentDomain: true,
    executionDomain: "development", executionDomainId: randomUUID(), storage: "dedicated-block", storageDriver: "zfs",
    quota: "unattested", maxInstances: 3, artifactProject: "artifacts", artifactMaxInstances: 3,
    artifactStorageReserveBytes: 100, artifactEstimatedBytes: 100 };
}

async function attempts(plan: IncusRuntimePlan, actionFails: boolean): Promise<Attempt[]> {
  const providerPlan = sandboxProviderPlan({ provider: "incus", plannerRevision: "test", caseKind: "prebuilt",
    target: { platform: { _tag: "Linux", os: "linux", arch: "x64", libc: "gnu" }, source: "provider-defined" },
    scheduling: { recommendedConcurrency: 2, lane: { key: plan.executionDomainId, limit: 2 }, admission: { _tag: "Shared" } },
    module: incusProviderModule(undefined), runtimePlan: plan,
    build: { _tag: "None", caseKey: computeCaseKey({ caseKind: "prebuilt", materializerRevision: "test", buildKeys: [], caseParams: {} }), buildKeys: [] },
    publishableIdentity: {}, privateFingerprintIdentity: {} });
  const layer = defineSandboxTemplate({ provider: "incus", kind: "test", publishableIdentity: {}, privateFingerprintIdentity: {},
    commandPlanLocator: { _tag: "Opaque", reason: { code: "test", summary: "Test Incus API" } },
    leakGate: { _tag: "None" }, plan: () => Effect.succeed(providerPlan),
  }).before(shell({ id: "prepare", command: actionFails ? "exit 27" : "true" }));
  const pairs = await Effect.runPromise(linkSandboxLayers([{ eval: { id: "one" }, experiment: { id: "cloud", layer }, agent: { kind: "sandbox", name: "probe" } }]));
  const planned = await Effect.runPromise(planLinkedRuns(pairs.map((pair) => ({ pair, authorBaseDirs: { eval: "/tmp", experiment: "/tmp" }, requirements: [] }))));
  return planned.map(({ plan: linked }) => ({ plan: linked, evalDef: { id: "one" }, run: { experimentId: "cloud", sandboxBeforeCache: "use" } }) as Attempt);
}

// @feature docs/feature/sandbox-nested-docker/architecture/README.md
test("Incus preparation degrades cache failures, preserves uncertain objects, and fails author actions", { timeout: 30_000 }, async () => {
  // These cases deliberately share the process environment and static API connection seam.
  for (const mode of ["staging", "ledger", "capture", "action"] as const) {
    const api = new IncusApi(mode);
    const connect = vi.spyOn(IncusControl, "connectMutation").mockResolvedValue(api as unknown as IncusControl);
    const localHome = join(home, mode);
    if (mode === "ledger") await writeFile(localHome, "unavailable database directory");
    vi.stubEnv("NICEEVAL_HOME", localHome);
    try {
      const plan = runtimePlan();
      const input = await attempts(plan, mode === "action");
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const result = yield* prepareBeforeCaches(input, { runIds: new Map([["cloud", randomUUID()]]) });
        expect(result.summary, `${mode}: ${[...result.failuresByPair.values()].map(String).join("; ")}`).toMatchObject(mode === "action" ? { failed: 1, degraded: 0 } : { failed: 0, degraded: 1 });
        expect(result.failuresByPair.size).toBe(mode === "action" ? 1 : 0);
        if (mode !== "action") expect([...result.preparedByPair.values()][0]?.degraded?.reason).toBe(
          mode === "staging" ? "staging-failed" : mode === "ledger" ? "ledger-unavailable" : "snapshot-uncertain",
        );
        if (mode === "capture") {
          const repository = yield* incusRepositoryHost.open();
          const artifacts = yield* Effect.promise(() => repository.listArtifacts());
          expect(artifacts).toHaveLength(1);
          expect(artifacts[0]?.state).toBe("publishing");
          expect(api.instances.has("artifacts/" + artifacts[0]?.instance)).toBe(true);
          expect(api.copies).toBe(1);
        }
      })));
      if (mode === "ledger") expect(connect).not.toHaveBeenCalled();
      if (mode === "action") expect(api.instances.size).toBe(0);
    } finally { connect.mockRestore(); }
  }
});
