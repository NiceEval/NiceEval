// cases: docs/engineering/testing/architecture/unit/sandbox.md
import { expect, test } from "vitest";
import {
  ALLOCATION_STATES,
  ARTIFACT_STATES,
  artifactLocator,
  decodeAllocationPayload,
  decodeArtifactPayload,
  encodeAllocationPayload,
  encodeArtifactPayload,
  type AllocationPayload,
  type ArtifactPayload,
} from "./repository.ts";
import { artifactEvidenceDigest, artifactResourceIdentity, gcDigest } from "./gc-protocol.ts";

const allocation: AllocationPayload = {
  allocationId: "allocation",
  executionId: "execution",
  provider: "incus",
  generation: 1,
  requirementDigest: "requirement",
  artifactDigest: "artifact",
  requestedDockerDataBytes: 4096,
  executionDomainId: "domain",
  project: "project",
  storagePool: "pool",
  provisionToken: "provision",
  owner: { host: "host", pid: 1, startedAt: "2026-10-24T00:00:00.000Z" },
  expectedTerminal: "destroyed",
  state: "reserved",
};
const resources = { providerLocator: "instance", dockerDataVolume: "volume" };
const artifact: ArtifactPayload = {
  artifactId: "artifact",
  generation: 1,
  project: "project",
  instance: "instance",
  dockerDataVolume: "volume",
  beforeCacheKey: "key",
  manifestDigest: "manifest",
  state: "reserved",
  executionDomainId: "domain",
  runtimeProject: "runtime",
  pool: "pool",
  baseFingerprint: "base",
  providerRevision: "provider",
  guestInitRevision: "guest",
  cacheFormat: "format",
  coverage: "all",
  resourcesDigest: "resources",
  createdAt: "2026-10-24T00:00:00.000Z",
  updatedAt: "2026-10-24T01:00:00.000Z",
};
const started = { capturePoolUsedBefore: 100 };
const measured = { ...started, capturePoolUsedAfter: 120, estimatedArtifactBytes: 20 };
const successfulHold = { lastSuccessfulHoldAt: "2026-10-24T00:30:00.000Z", lastSuccessfulHoldId: "hold" };

// @feature docs/feature/sandbox-nested-docker/README.md
test("allocation payloads preserve resource and uncertain acceptance facts across the worker boundary", () => {
  const payloads: AllocationPayload[] = [allocation, { ...allocation, state: "destroyed" }];
  for (const state of ["creating", "ready", "handed-off", "lost"] as const)
    payloads.push({ ...allocation, ...resources, state });
  for (const names of [{}, resources]) {
    payloads.push({ ...allocation, ...names, state: "destroy-requested" });
    for (const acceptanceUnknown of ["volume-create", "instance-create"] as const)
      payloads.push({ ...allocation, ...names, state: "destroy-requested", quarantined: true, acceptanceUnknown });
  }
  for (const payload of payloads) {
    const encoded = encodeAllocationPayload(decodeAllocationPayload(structuredClone(payload)));
    expect(encoded).toStrictEqual(payload);
    expect(decodeAllocationPayload(structuredClone(encoded))).toStrictEqual(decodeAllocationPayload(payload));
  }
});

// @feature docs/feature/sandbox-nested-docker/README.md
test("artifact payloads preserve capture, historical hold, scope, retirement ownership and GC evidence", () => {
  // Terminal states inherit any preceding capture stage. Missing scope/samples
  // also represent the documented old committed artifacts; no default is invented.
  for (const state of ARTIFACT_STATES) {
    for (const capture of [
      {},
      started,
      measured,
      { capturePoolUsedBefore: 0 },
      { capturePoolUsedBefore: 0, capturePoolUsedAfter: 0, estimatedArtifactBytes: 0 },
    ]) {
      for (const hold of [{}, successfulHold]) {
        for (const scope of [{}, { replacementScopeDigest: "scope" }]) {
          for (const retirement of [{}, { retirementPlanId: "plan" }]) {
            const payload: ArtifactPayload = { ...artifact, ...capture, ...hold, ...scope, ...retirement, state };
            const domain = decodeArtifactPayload(structuredClone(payload));
            expect(encodeArtifactPayload(domain)).toStrictEqual(payload);
            const { updatedAt: _updatedAt, ...evidence } = payload;
            expect(artifactEvidenceDigest(domain)).toBe(gcDigest(evidence));
            expect(artifactResourceIdentity(domain)).toBe(
              gcDigest({
                artifactId: "artifact",
                generation: 1,
                project: "project",
                pool: "pool",
                instance: "instance",
                volume: "volume",
              }),
            );
            expect(artifactLocator(domain, undefined)).toStrictEqual({
              artifactId: "artifact",
              generation: 1,
              project: "project",
              instance: "instance",
              dockerDataVolume: "volume",
              beforeCacheKey: "key",
              manifestDigest: "manifest",
            });
            expect(artifactLocator(domain, "consumer").consumerHoldId).toBe("consumer");
          }
        }
      }
    }
  }
});

// @feature docs/feature/sandbox-nested-docker/README.md
test("historical false quarantine is accepted as settled and normalized to omission", () => {
  const payload = { ...allocation, ...resources, state: "destroy-requested", quarantined: false };
  const domain = decodeAllocationPayload(payload);
  expect(domain.phase).toStrictEqual({ state: "destroy-requested", resources, acceptance: { kind: "settled" } });
  expect(encodeAllocationPayload(domain)).toStrictEqual({ ...allocation, ...resources, state: "destroy-requested" });
});

// @feature docs/feature/sandbox-nested-docker/README.md
test("invalid persisted combinations and own undefined keys fail closed before becoming domain values", () => {
  const allocations: unknown[] = [];
  for (const state of ALLOCATION_STATES) {
    allocations.push(
      { ...allocation, state, providerLocator: "instance" },
      { ...allocation, state, dockerDataVolume: "volume" },
    );
    if (state !== "destroy-requested")
      allocations.push({ ...allocation, ...resources, state, quarantined: true, acceptanceUnknown: "volume-create" });
    if (state !== "reserved" && state !== "destroyed" && state !== "destroy-requested")
      allocations.push({ ...allocation, state });
  }
  allocations.push(
    { ...allocation, ...resources },
    { ...allocation, ...resources, state: "destroyed" },
    { ...allocation, state: "destroy-requested", acceptanceUnknown: "instance-create" },
    { ...allocation, state: "destroy-requested", quarantined: false, acceptanceUnknown: "instance-create" },
    { ...allocation, state: "destroy-requested", quarantined: true },
  );
  for (const key of ["providerLocator", "dockerDataVolume", "quarantined", "acceptanceUnknown"])
    allocations.push({ ...allocation, [key]: undefined }, { ...allocation, [key]: null });
  for (const payload of allocations)
    expect(() => decodeAllocationPayload(payload)).toThrow(expect.objectContaining({ code: "user-database-invalid" }));

  const artifacts: unknown[] = [
    { ...artifact, consumerHoldId: "consumer" },
    { ...artifact, lastSuccessfulHoldAt: successfulHold.lastSuccessfulHoldAt },
    { ...artifact, lastSuccessfulHoldId: "hold" },
    { ...artifact, capturePoolUsedAfter: 120 },
    { ...artifact, estimatedArtifactBytes: 20 },
    { ...artifact, ...started, capturePoolUsedAfter: 120 },
    { ...artifact, ...started, estimatedArtifactBytes: 20 },
    { ...artifact, capturePoolUsedAfter: 120, estimatedArtifactBytes: 20 },
  ];
  for (const key of [
    "replacementScopeDigest",
    "lastSuccessfulHoldAt",
    "lastSuccessfulHoldId",
    "retirementPlanId",
    "capturePoolUsedBefore",
    "capturePoolUsedAfter",
    "estimatedArtifactBytes",
  ])
    artifacts.push({ ...artifact, [key]: undefined }, { ...artifact, [key]: null });
  for (const payload of artifacts)
    expect(() => decodeArtifactPayload(payload)).toThrow(expect.objectContaining({ code: "user-database-invalid" }));
});
