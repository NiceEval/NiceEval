/** Control-protocol reply-loss smoke, run by watchdog-smoke. */
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import type { JsonValue } from "../../packages/niceeval/src/shared/types.ts";
import type { SandboxSetupPrefixCacheOperation } from "../../packages/niceeval/src/sandbox/backend.ts";
import { DockerSandbox } from "../../packages/niceeval/src/sandbox/docker.ts";
import { digestOf } from "../../packages/niceeval/src/sandbox/identity.ts";
import {
  decodeDockerExecutionProfileV1,
  makeDockerExecutionProfileV1,
} from "../../packages/niceeval/src/sandbox/docker-profile/schema.ts";
import { makeDockerProfileSetupPrefixCacheCapability } from "../../packages/niceeval/src/sandbox/docker-profile/setup-prefix.ts";
import {
  captureDockerProfileSetupPrefix,
  createDockerProfileLease,
  DockerProfileControlError,
  releaseDockerProfileReservation,
  type DockerProfileLease,
  type DockerProfileReservation,
} from "../../packages/niceeval/src/sandbox/docker-profile/runtime.ts";

const binding = { profile: { profileId: "profile" }, daemonGeneration: "generation", controlSocketPath: "", dockerSocketPath: "", alias: "a", descriptorDigest: "d", daemonId: "d", platform: "linux/amd64" } as never;
const lease = { binding, invocationId: "lease", leaseToken: "token", stopHeartbeat: async () => {} } as DockerProfileLease;

const filesystemSizeBytes = 4096;
const setupPrefixDescriptor = {
  protocol: "niceeval-docker-profile-state/docker-data-snapshot/v1",
  coverage: "dockerData",
  requiredState: "dockerData",
  helperRevision: "helper/v1",
  copyProtocol: "raw-image/v1",
  copyRevision: "copy/v1",
  quiesceRevision: "quiesce/v1",
  slotAttestation: "independent-fixed-filesystem/v1",
  seedPolicy: "immutable-unmounted/v1",
  publicationRevision: "prepared-copy-client-commit-publish/v4",
  recoveryRevision: "epoch-capsule-no-guess-recovery/v3",
  manifestSchema: "niceeval-docker-profile-activation/v3",
  providerIdentity: "provider:test",
  executionDomain: "domain:test",
  filesystemSizeBytes,
  filesystemFeatures: ["ext4", "fixed-size", "fully-allocated", "independent-image"],
  seedLimitBytes: filesystemSizeBytes,
  filesystemIdentity: "filesystem:test",
} as const;
const declarationMetadata = Object.freeze({ action: "host-smoke" });
const manifestDigest = digestOf(declarationMetadata as JsonValue);
const setupPrefixInput: SandboxSetupPrefixCacheOperation = Object.freeze({
  operationId: "attempt:host-smoke",
  manifest: Object.freeze({
    baseImageId: `sha256:${"1".repeat(64)}`,
    setupPrefixKey: `prefix:${manifestDigest}`,
    setupManifestDigest: `sha256:${manifestDigest}`,
    requiredState: "dockerData",
    storageSchemaRevision: "storage/v1",
    artifactFormatRevision: "copy/v1",
    changeFrequency: 1,
    declarationMetadata,
  }),
});
const setupPrefixReservation: DockerProfileReservation = Object.freeze({
  reservationId: "reservation",
  provisionToken: "provision",
  state: "committed",
  slotGeneration: 7,
});
const setupPrefixWireFields = Object.freeze([
  "protocol", "requiredState", "descriptorDigest", "setupPrefixKey", "setupManifestDigest",
  "providerIdentity", "baseIdentity", "executionDomain", "helperRevision", "copyProtocol",
  "copyRevision", "quiesceRevision", "publicationRevision", "recoveryRevision", "manifestSchema",
  "filesystemSizeBytes", "filesystemFeatures",
  "daemonGeneration", "slotGeneration",
] as const);
const legacyProtocolRevisions = Object.freeze({
  publicationRevision: "prepared-copy-client-commit-publish/v3",
  recoveryRevision: "no-guess-scrub-or-quarantine/v2",
  manifestSchema: "niceeval-docker-profile-activation/v2",
} as const);

function setupPrefixLease(path: string): DockerProfileLease {
  return {
    binding: {
      alias: "profile",
      profile: {
        profileId: "profile",
        backend: {
          filesystem: {
            dockerDataPool: {
              attestation: "independent-fixed-filesystem/v1",
              bytesPerAllocation: filesystemSizeBytes,
            },
            setupPrefix: setupPrefixDescriptor,
          },
        },
      },
      descriptorDigest: "descriptor:test",
      daemonGeneration: "generation",
      daemonId: "daemon",
      dockerSocketPath: "",
      controlSocketPath: path,
      platform: "linux/amd64",
    } as unknown as DockerProfileLease["binding"],
    invocationId: "invocation",
    leaseToken: "lease-token",
    stopHeartbeat: async () => {},
  };
}

type ControlFrame = Readonly<Record<string, unknown>>;

async function withControlReply(
  reply: (request: ControlFrame) => ControlFrame | undefined | Promise<ControlFrame | undefined>,
  run: (path: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-setup-prefix-control-"));
  const path = join(root, "control.sock");
  const pending = new Set<Promise<void>>();
  const server = createServer((socket) => {
    socket.on("error", () => {});
    let input = "";
    let handled = false;
    socket.on("data", (chunk) => {
      input += chunk.toString();
      if (handled || !input.includes("\n")) return;
      handled = true;
      const operation = Promise.resolve(reply(JSON.parse(input) as ControlFrame)).then((response) => {
        if (response === undefined) socket.destroy();
        else if (!socket.destroyed) socket.end(`${JSON.stringify(response)}\n`);
      });
      pending.add(operation);
      void operation.finally(() => pending.delete(operation));
    });
  });
  await new Promise<void>((resolve) => server.listen(path, resolve));
  try {
    await run(path);
    await Promise.allSettled([...pending]);
  } finally {
    await Promise.allSettled([...pending]);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

function successReceipt(request: ControlFrame): Record<string, unknown> {
  const response = Object.fromEntries(setupPrefixWireFields.map((field) => [field, request[field]]));
  return {
    ...response,
    artifact: {
      requiredState: "dockerData",
      copyProtocol: "raw-image/v1",
      copyRevision: "copy/v1",
      artifactId: `sha256:${"2".repeat(64)}`,
      sizeBytes: filesystemSizeBytes,
    },
    status: { state: "captured", capacity: {} },
  };
}

function failureReceipt(request: ControlFrame): Record<string, unknown> {
  const response = successReceipt(request);
  return {
    code: "setup-prefix-capture-failed",
    message: "injected terminal host failure",
    ...Object.fromEntries(setupPrefixWireFields.map((field) => [field, response[field]])),
    artifact: { artifactId: null },
    status: { state: "failed", diagnostic: "setup-prefix-capture-failed" },
  };
}

type CaptureOutcome =
  | { readonly _tag: "Success" }
  | { readonly _tag: "Failure"; readonly error: unknown };

async function captureOutcome(
  response: (request: ControlFrame) => ControlFrame,
): Promise<CaptureOutcome> {
  let outcome: CaptureOutcome | undefined;
  await withControlReply(
    (request) => response(request),
    async (path) => {
      outcome = await captureDockerProfileSetupPrefix(
        setupPrefixLease(path),
        setupPrefixReservation,
        setupPrefixInput,
        undefined,
        1_000,
      ).then(
        () => ({ _tag: "Success" as const }),
        (error: unknown) => ({ _tag: "Failure" as const, error }),
      );
    },
  );
  assert(outcome !== undefined);
  return outcome;
}

async function matrix(status: object, success: boolean): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "niceeval-public-release-"));
  const path = join(root, "control.sock");
  let calls = 0;
  const server = createServer((socket) => socket.once("data", (raw) => {
    calls += 1;
    if (calls === 1) { socket.destroy(); return; } // durable host success, lost reply
    const request = JSON.parse(raw.toString()) as { kind: string };
    socket.end(JSON.stringify(request.kind === "status"
      ? { ok: true, result: status }
      : { ok: false, error: { code: "reservation-not-found", message: "already released" } }) + "\n");
  }));
  await new Promise<void>((resolve) => server.listen(path, resolve));
  const current = { ...lease, binding: { ...binding, controlSocketPath: path } };
  const realNow = Date.now;
  const base = realNow();
  let reads = 0;
  Date.now = () => (++reads <= 2 ? base : base + 120_000);
  try {
    const result = await Promise.race([
      releaseDockerProfileReservation(current, "reservation", { slotId: "slot" }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("reply-loss proof timeout")), 1_000)),
    ]);
    if (!success || result.cleanupProven !== true) throw new Error("reply-loss proof accepted an invalid status");
  } catch (error) {
    if (success) throw error;
  } finally {
    Date.now = realNow;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
}

async function setupPrefixTimeoutFailsClosed(): Promise<void> {
  let resumed = 0;
  let created = 0;
  await withControlReply(
    async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { ok: true, result: successReceipt(request) };
    },
    async (path) => {
      const currentLease = setupPrefixLease(path);
      const capability = makeDockerProfileSetupPrefixCacheCapability({
        session: {
          lease: currentLease,
          currentReservation: () => setupPrefixReservation,
          controlTimeoutMs: 5,
          replaceReservation: Effect.fail(new Error("timeout recovery must stay Scope-owned")),
        },
        eligibility: () => ({
          _tag: "Eligible",
          persistence: "persistent",
          dependency: "parent-backed",
          coverage: "dockerData",
          baseImageId: setupPrefixInput.manifest.baseImageId,
        }),
        quiesceAndStop: async () => {},
        retireStopped: () => {},
        createFromCurrent: async () => {
          created += 1;
          return "created";
        },
        resumeStopped: async () => {
          resumed += 1;
          return "resumed";
        },
      });
      const failed = await Effect.runPromise(capability.captureAndRebase(setupPrefixInput)).then(
        () => false,
        () => true,
      );
      assert.equal(failed, true, "a timed-out capture must fail the Attempt");
    },
  );
  assert.equal(resumed, 0, "a timed-out capture must never resume the old outer container");
  assert.equal(created, 0, "a timed-out capture must never create a continuation before Host recovery");
}

async function alreadyStoppedQuiesceFailsClosed(): Promise<void> {
  const currentLease = setupPrefixLease("");
  const sandbox = new DockerSandbox({
    dockerAccess: { mode: "dind", isolation: "raw-privileged" },
    profileSetupPrefix: {
      lease: currentLease,
      currentReservation: () => setupPrefixReservation,
      replaceReservation: Effect.fail(new Error("not used")),
    },
  });
  Object.assign(sandbox, {
    container: {
      inspect: async () => ({ State: { Running: false, Pid: 0 } }),
      stop: async () => { throw new Error("an already-stopped container must not be accepted as this call's proof"); },
    },
  });
  const quiesce = sandbox as unknown as {
    quiesceProfileSetupPrefix(signal: AbortSignal): Promise<void>;
  };
  const outcome = await quiesce.quiesceProfileSetupPrefix(new AbortController().signal).then(
    () => undefined,
    (error: unknown) => error,
  );
  assert(outcome instanceof Error, "an already-stopped outer container must fail closed");
  assert.match(outcome.message, /already stopped|graceful quiesce proof/u);
}

async function leaseDrainReconcilesToAbsent(): Promise<void> {
  let drainCalls = 0;
  let statusCalls = 0;
  let leasedInvocation = "";
  await withControlReply(
    (request) => {
      if (request.kind === "lease.create") {
        leasedInvocation = String(request.invocationId);
        return { ok: true, result: { leaseToken: "lease-token" } };
      }
      if (request.kind === "lease.drain") {
        drainCalls += 1;
        if (drainCalls === 1) return undefined;
        return { ok: true, result: { state: drainCalls === 2 ? "draining" : "recovered" } };
      }
      assert.equal(request.kind, "status");
      statusCalls += 1;
      return {
        ok: true,
        result: {
          profileId: "profile",
          generation: "generation",
          leases: drainCalls < 4
            ? [{ invocationId: leasedInvocation, daemonGeneration: "generation" }]
            : [],
          reservations: drainCalls < 4
            ? [{ reservationId: "still-owned", invocationId: leasedInvocation }]
            : [],
          queue: drainCalls < 4
            ? [{ reservationId: "still-owned", invocationId: leasedInvocation }]
            : [],
          slots: drainCalls < 4
            ? [{ slotId: "slot", reservationId: "still-owned", invocationId: leasedInvocation, state: "active" }]
            : [{ slotId: "slot", state: "free" }],
          degraded: [],
        },
      };
    },
    async (path) => {
      const currentBinding = { ...binding, controlSocketPath: path } as DockerProfileLease["binding"];
      const currentLease = await createDockerProfileLease(currentBinding);
      await Promise.race([
        currentLease.stopHeartbeat(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("lease drain did not converge")), 2_000)),
      ]);
    },
  );
  assert.equal(
    drainCalls,
    4,
    "disconnect, draining, and a recovered tombstone must be reconciled through Host retirement",
  );
  assert.equal(statusCalls, 4, "each drain outcome must be verified against the ledger");
}

async function exactSetupPrefixReceipts(): Promise<void> {
  const accepted = await captureOutcome((request) => ({ ok: true, result: successReceipt(request) }));
  assert.equal(accepted._tag, "Success");

  const successFailures: string[] = [];
  const successMutations: readonly [string, (receipt: Record<string, unknown>) => void][] = [
    ["unknown top-level field", (receipt) => { receipt.unknown = true; }],
    ["missing top-level field", (receipt) => { delete receipt.setupManifestDigest; }],
    ["top-level identity drift", (receipt) => { receipt.daemonGeneration = "other"; }],
    ...Object.entries(legacyProtocolRevisions).map(([field, legacy]) => [
      `legacy ${field}`,
      (receipt: Record<string, unknown>) => { receipt[field] = legacy; },
    ] as const),
    ["unknown artifact field", (receipt) => {
      (receipt.artifact as Record<string, unknown>).unknown = true;
    }],
    ["missing artifact field", (receipt) => {
      delete (receipt.artifact as Record<string, unknown>).copyRevision;
    }],
    ["artifact identity drift", (receipt) => {
      (receipt.artifact as Record<string, unknown>).copyRevision = "copy/other";
    }],
    ["unknown status field", (receipt) => {
      (receipt.status as Record<string, unknown>).unknown = true;
    }],
    ["missing status field", (receipt) => {
      delete (receipt.status as Record<string, unknown>).state;
    }],
    ["status identity drift", (receipt) => {
      (receipt.status as Record<string, unknown>).state = "restored";
    }],
  ];
  for (const [label, mutate] of successMutations) {
    const outcome = await captureOutcome((request) => {
      const receipt = successReceipt(request);
      mutate(receipt);
      return { ok: true, result: receipt };
    });
    if (outcome._tag === "Success") successFailures.push(label);
  }

  const validFailure = await captureOutcome((request) => ({ ok: false, error: failureReceipt(request) }));
  assert(validFailure._tag === "Failure" && validFailure.error instanceof DockerProfileControlError);
  const failureMutations: readonly [string, (receipt: Record<string, unknown>) => void][] = [
    ["unknown failure top-level field", (receipt) => { receipt.unknown = true; }],
    ["missing failure top-level field", (receipt) => { delete receipt.setupManifestDigest; }],
    ["failure top-level identity drift", (receipt) => { receipt.daemonGeneration = "other"; }],
    ["unknown failure artifact field", (receipt) => {
      (receipt.artifact as Record<string, unknown>).unknown = true;
    }],
    ["missing failure artifact field", (receipt) => {
      delete (receipt.artifact as Record<string, unknown>).artifactId;
    }],
    ["failure artifact identity drift", (receipt) => {
      (receipt.artifact as Record<string, unknown>).artifactId = `sha256:${"3".repeat(64)}`;
    }],
    ["unknown failure status field", (receipt) => {
      (receipt.status as Record<string, unknown>).unknown = true;
    }],
    ["missing failure status field", (receipt) => {
      delete (receipt.status as Record<string, unknown>).diagnostic;
    }],
    ["failure status identity drift", (receipt) => {
      (receipt.status as Record<string, unknown>).diagnostic = "other";
    }],
  ];
  for (const [label, mutate] of failureMutations) {
    const outcome = await captureOutcome((request) => {
      const receipt = failureReceipt(request);
      mutate(receipt);
      return { ok: false, error: receipt };
    });
    if (outcome._tag !== "Failure" || outcome.error instanceof DockerProfileControlError) {
      successFailures.push(label);
    }
  }
  assert.deepEqual(successFailures, [], `non-exact receipts were accepted: ${successFailures.join(", ")}`);
}

function descriptorRevisionMatrix(): void {
  const current = makeDockerExecutionProfileV1({
    schemaVersion: 1,
    profileId: "profile",
    securityLevel: "raw-dind-storage/v1",
    transport: {
      kind: "unix",
      hostMachineIdentity: "host",
      dockerSocket: { path: "/run/docker.sock", peerUid: 0 },
      controlSocket: {
        path: "/run/niceeval-control.sock",
        peerUid: 0,
        protocol: "niceeval-docker-profile-control/v1",
      },
    },
    backend: {
      kind: "local-systemd",
      machineIdentity: "host",
      owner: { uid: 0, gid: 0 },
      filesystem: {
        identity: "filesystem",
        mountPath: "/var/lib/niceeval",
        dockerRootDir: "/var/lib/niceeval/docker",
        limitBytes: 8192,
        dockerDataPool: {
          count: 1,
          bytesPerAllocation: filesystemSizeBytes,
          attestation: "independent-fixed-filesystem/v1",
        },
        setupPrefix: {
          ...setupPrefixDescriptor,
          providerIdentity: `sha256:${"4".repeat(64)}`,
          executionDomain: `sha256:${"5".repeat(64)}`,
        },
      },
      cgroup: {
        aggregatePath: "/niceeval.slice",
        policyRevision: "policy/v1",
        controllers: ["cpu", "memory", "pids"],
      },
    },
    capacity: {
      cpus: 1,
      memoryBytes: 1024,
      memorySwapBytes: 0,
      pids: 16,
      maxContainers: 1,
      maxBuilds: 1,
      ephemeralDiskBytes: filesystemSizeBytes,
      aggregate: { cpus: 1, memoryBytes: 1024, memorySwapBytes: 0, pids: 16 },
    },
    policy: {
      level: "raw-dind-storage/v1",
      privilegedTranslation: "host-daemon",
      dockerData: "private-project-quota-allocation/v1",
    },
  });
  decodeDockerExecutionProfileV1(current);
  for (const [field, legacy] of Object.entries(legacyProtocolRevisions)) {
    const candidate = structuredClone(current) as unknown as Record<string, unknown>;
    const backend = candidate.backend as Record<string, unknown>;
    const filesystem = backend.filesystem as Record<string, unknown>;
    const capability = filesystem.setupPrefix as Record<string, unknown>;
    capability[field] = legacy;
    assert.throws(
      () => decodeDockerExecutionProfileV1(candidate),
      undefined,
      `descriptor accepted legacy ${field}`,
    );
  }
}

type ExternalFixture = Readonly<{
  lease: DockerProfileLease;
  reservation: DockerProfileReservation;
  input: SandboxSetupPrefixCacheOperation;
}>;

async function runExternalNewClient(): Promise<void> {
  const path = process.env.NICEEVAL_PROTOCOL_MATRIX_FIXTURE;
  assert(path !== undefined && path.length > 0);
  const fixture = JSON.parse(await readFile(path, "utf8")) as ExternalFixture;
  const result = await captureDockerProfileSetupPrefix(
    fixture.lease,
    fixture.reservation,
    fixture.input,
    undefined,
    10_000,
  );
  assert.equal(result.state, "captured");
  console.log("docker-profile-public-smoke external new-client/new-host ok");
}

async function regressionMatrix(): Promise<void> {
  const failures: Error[] = [];
  for (const [name, check] of [
    ["control timeout safety", setupPrefixTimeoutFailsClosed],
    ["already-stopped quiesce", alreadyStoppedQuiesceFailsClosed],
    ["lease drain convergence", leaseDrainReconcilesToAbsent],
    ["exact receipt decoding", exactSetupPrefixReceipts],
    ["descriptor protocol revisions", async () => descriptorRevisionMatrix()],
  ] as const) {
    try {
      await check();
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      failures.push(new Error(`${name}: ${error.message}`, { cause: error }));
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, "setup-prefix failure-safety regression");
}

async function main(): Promise<void> {
  if (process.env.NICEEVAL_PROTOCOL_MATRIX_FIXTURE !== undefined) {
    await runExternalNewClient();
    return;
  }
  const good = { profileId: "profile", generation: "generation", leases: [{ invocationId: "lease", daemonGeneration: "generation" }], reservations: [], queue: [], slots: [{ slotId: "slot", state: "free" }], degraded: [] };
  await matrix(good, true);
  await matrix({ ...good, profileId: "other" }, false);
  await matrix({ ...good, generation: "other" }, false);
  await matrix({ ...good, leases: [] }, false);
  await matrix({ ...good, reservations: [{ reservationId: "reservation", invocationId: "lease" }] }, false);
  await matrix({ ...good, queue: [{ reservationId: "reservation", invocationId: "lease" }] }, false);
  await matrix(Object.fromEntries(Object.entries(good).filter(([field]) => field !== "queue")), false);
  await matrix({ ...good, slots: [{ slotId: "slot", reservationId: "reservation", state: "active" }] }, false);
  await matrix({ ...good, degraded: ["recovery blocked for reservation"] }, false);
  await regressionMatrix();
  console.log("docker-profile-public-smoke ok");
}
void main();
