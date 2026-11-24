// Exercise the Profile control client and its mutable target without a Docker daemon.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { Effect } from "effect";
import { makeDockerProfileBeforeCacheCapability } from "../../packages/niceeval/src/sandbox/docker-profile/before-cache.ts";
import { digestOf } from "../../packages/niceeval/src/sandbox/identity.ts";
import { DOCKER_PROFILE_BEFORE_CACHE_CONTROL_PROTOCOL } from "../../packages/niceeval/src/sandbox/docker-profile/schema.ts";

const baseIdentity = "sha256:" + "a".repeat(64);
function step(positions, parentKey) {
  const declarationMetadata = { positions, parentKey };
  const digest = digestOf(declarationMetadata);
  return {
    operationId: positions.join("-"),
    positions,
    declaringOwner: "eval:fixture",
    knownSensitiveValues: [],
    declaration: {
      baseIdentity,
      requiredState: "dockerData",
      declarationMetadata,
      declarationDigest: "sha256:" + digest,
      beforeCacheKey: "prefix:" + digest,
      changeFrequency: 1,
      cacheFormat: "test",
    },
  };
}
const parent = step(["parent"], "base");
const child = step(["parent", "child"], parent.declaration.beforeCacheKey);
const folder = await mkdtemp(join(tmpdir(), "before-cache-prefix-"));
const controlSocketPath = join(folder, "control.sock");
const fixed = {
  protocol: DOCKER_PROFILE_BEFORE_CACHE_CONTROL_PROTOCOL,
  coverage: "dockerData",
  requiredState: "dockerData",
  copyProtocol: "raw-image/v1",
  copyRevision: "copy/v1",
  slotAttestation: "independent-fixed-filesystem/v1",
  filesystemSizeBytes: 4096,
  seedLimitBytes: 8192,
  providerIdentity: "test",
  executionDomain: "test",
  helperRevision: "helper",
  quiesceRevision: "quiesce",
  publicationRevision: "publish",
  recoveryRevision: "recover",
  manifestSchema: "manifest",
  filesystemFeatures: ["ext4"],
};
const lease = {
  invocationId: "fixture",
  leaseToken: "fixture",
  binding: {
    controlSocketPath,
    daemonGeneration: "local",
    descriptorDigest: "descriptor",
    profile: {
      profileId: "test",
      backend: {
        filesystem: {
          beforeCache: fixed,
          dockerDataPool: { bytesPerAllocation: 4096, attestation: fixed.slotAttestation },
        },
      },
    },
  },
};
let generation = 0;
let contents = [];
const reservation = () => ({ reservationId: String(generation), slotGeneration: generation });
const server = createServer((socket) => {
  let frame = "";
  socket.on("data", (chunk) => {
    frame += chunk;
  });
  socket.on("end", () => {
    const { kind, invocationId, leaseToken, reservationId, operationId, ...wire } = JSON.parse(frame);
    assert.equal(kind, "before-cache.restore");
    if (wire.beforeCacheKey === parent.declaration.beforeCacheKey) {
      contents = ["parent"];
      socket.end(
        JSON.stringify({
          ok: true,
          result: {
            ...wire,
            artifact: {
              requiredState: "dockerData",
              artifactId: "parent-image",
              copyProtocol: fixed.copyProtocol,
              copyRevision: fixed.copyRevision,
              sizeBytes: 4096,
            },
            status: { state: "restored", capacity: {} },
          },
        }),
      );
    } else {
      const code = "before-cache-miss";
      socket.end(
        JSON.stringify({
          ok: false,
          error: {
            ...wire,
            code,
            message: code,
            artifact: { artifactId: null },
            status: { state: "failed", diagnostic: code },
          },
        }),
      );
    }
  });
});
try {
  server.listen(controlSocketPath);
  await once(server, "listening");
  const cache = makeDockerProfileBeforeCacheCapability({
    session: {
      lease,
      currentReservation: reservation,
      replaceReservation: Effect.sync(() => {
        contents = [];
        generation++;
        return reservation();
      }),
    },
    quiesceAndStop: async () => {},
    retireStopped() {},
    createFromCurrent: async () => String(generation),
  });
  // The Runner first searches deepest-to-shallowest, then re-probes the unsatisfied child.
  assert.equal((await Effect.runPromise(cache.lookupAndRestore(child)))._tag, "Miss");
  assert.equal((await Effect.runPromise(cache.lookupAndRestore(parent)))._tag, "Restored");
  assert.equal((await Effect.runPromise(cache.lookupAndRestore(child)))._tag, "Miss");
  assert.deepEqual(contents, ["parent"], "the next real action must start from the satisfied parent");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(folder, { recursive: true, force: true });
}
