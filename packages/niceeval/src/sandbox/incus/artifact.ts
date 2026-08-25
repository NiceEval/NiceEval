import { randomUUID } from "node:crypto";
import { INCUS_METADATA, type IncusControl } from "./control.ts";
import { incusError } from "./errors.ts";
import { listArtifactIntents, requireCommittedArtifact, writeArtifactIntent, type ArtifactIntent } from "./artifact-ledger.ts";
import { acquireDomainAdmissionLock } from "./ledger.ts";
import type { IncusRuntimePlan } from "./plan.ts";

export interface IncusArtifactLocator {
  readonly artifactId: string; readonly generation: number; readonly project: string;
  readonly instance: string; readonly dockerDataVolume: string; readonly setupPrefixKey: string; readonly manifestDigest: string;
}

export interface ArtifactIdentity {
  readonly executionDomainId: string; readonly artifactProject: string; readonly runtimeProject: string; readonly pool: string;
  readonly artifactMaxInstances: number;
  readonly network: string; readonly baseFingerprint: string; readonly setupPrefixKey: string; readonly manifestDigest: string;
  readonly providerRevision: string; readonly guestInitRevision: string; readonly captureRevision: string;
  readonly coverage: string; readonly resourcesDigest: string;
}

export interface ArtifactPreparationIdentityInput {
  readonly setupPrefixKey: string; readonly manifestDigest: string; readonly providerRevision: string;
  readonly guestInitRevision: string; readonly captureRevision: string; readonly coverage: string; readonly resourcesDigest: string;
}

/** The Run coordinator constructs this once, before reserve. Host quota is deliberately absent. */
export function incusArtifactPreparationIdentity(
  plan: IncusRuntimePlan,
  input: ArtifactPreparationIdentityInput,
): ArtifactIdentity {
  return Object.freeze({ executionDomainId: plan.executionDomainId, artifactProject: plan.artifactProject, artifactMaxInstances: plan.artifactMaxInstances,
    runtimeProject: plan.project, pool: plan.storagePool, network: plan.network, baseFingerprint: plan.imageFingerprint,
    setupPrefixKey: input.setupPrefixKey, manifestDigest: input.manifestDigest, providerRevision: input.providerRevision,
    guestInitRevision: input.guestInitRevision, captureRevision: input.captureRevision, coverage: input.coverage,
    resourcesDigest: input.resourcesDigest });
}
const artifactConfig = (a: ArtifactIntent): Record<string, string> => ({
  [INCUS_METADATA.allocationId]: a.artifactId, [INCUS_METADATA.generation]: String(a.generation),
  [INCUS_METADATA.executionDomainId]: a.executionDomainId, [INCUS_METADATA.artifactState]: "committed",
  [INCUS_METADATA.setupPrefixKey]: a.setupPrefixKey, [INCUS_METADATA.manifestDigest]: a.manifestDigest,
  [INCUS_METADATA.runtimeProject]: a.runtimeProject, [INCUS_METADATA.pool]: a.pool,
  [INCUS_METADATA.baseFingerprint]: a.baseFingerprint, [INCUS_METADATA.captureRevision]: a.captureRevision,
});
function matches(config: Readonly<Record<string, string>>, a: ArtifactIntent): boolean {
  const expected = artifactConfig(a); return Object.entries(expected).every(([key, value]) => config[key] === value);
}
function devices(pool: string, volume: string, network: string): Record<string, Record<string, string>> {
  return { root: { type: "disk", path: "/", pool }, eth0: { type: "nic", name: "eth0", nictype: "bridged", parent: network }, dockerdata: { type: "disk", pool, source: volume, dependent: "true" } };
}

/** Intent-first reservation. The caller retains the returned generation as its fencing token. */
export async function reserveIncusArtifact(identity: ArtifactIdentity, env: NodeJS.ProcessEnv = process.env): Promise<ArtifactIntent> {
  const lock = await acquireDomainAdmissionLock(`${identity.executionDomainId}:artifact`, env);
  try {
    const existing = (await listArtifactIntents(env)).find((candidate) => candidate.executionDomainId === identity.executionDomainId && candidate.setupPrefixKey === identity.setupPrefixKey && candidate.manifestDigest === identity.manifestDigest && (candidate.state === "reserved" || candidate.state === "preparing" || candidate.state === "publishing"));
    if (existing !== undefined) return existing;
    const active = (await listArtifactIntents(env)).filter((candidate) => candidate.executionDomainId === identity.executionDomainId && candidate.project === identity.artifactProject && !["released", "quarantined", "invalid"].includes(candidate.state)).length;
    if (active >= identity.artifactMaxInstances) throw incusError("sandbox-capacity-unavailable", `Incus artifact project ${JSON.stringify(identity.artifactProject)} is at its artifactMaxInstances limit.`, ["Release stale non-committed artifacts or raise artifactMaxInstances after capacity review."]);
    const artifactId = randomUUID(); const now = new Date().toISOString();
    return await writeArtifactIntent({ artifactId, generation: 1, project: identity.artifactProject, instance: `nea-${artifactId.replaceAll("-", "").slice(0, 20)}`,
    dockerDataVolume: `nea-${artifactId.replaceAll("-", "").slice(0, 18)}-dd`, setupPrefixKey: identity.setupPrefixKey, manifestDigest: identity.manifestDigest,
    state: "reserved", executionDomainId: identity.executionDomainId, runtimeProject: identity.runtimeProject, pool: identity.pool, baseFingerprint: identity.baseFingerprint,
    providerRevision: identity.providerRevision, guestInitRevision: identity.guestInitRevision, captureRevision: identity.captureRevision, coverage: identity.coverage, resourcesDigest: identity.resourcesDigest, createdAt: now, updatedAt: now }, env);
  } finally { lock.release(); }
}

/** Prefix order is supplied by the coordinator from deepest to shallowest, so selection remains pure and explicit. */
export async function lookupCommittedIncusArtifactForPrefixes(
  executionDomainId: string,
  manifestDigest: string,
  setupPrefixKeysDeepestFirst: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<IncusArtifactLocator | undefined> {
  const committed = (await listArtifactIntents(env)).filter((entry) => entry.state === "committed" && entry.executionDomainId === executionDomainId && entry.manifestDigest === manifestDigest);
  for (const key of setupPrefixKeysDeepestFirst) {
    const found = committed.find((entry) => entry.setupPrefixKey === key);
    if (found !== undefined) return Object.freeze({ artifactId: found.artifactId, generation: found.generation, project: found.project, instance: found.instance, dockerDataVolume: found.dockerDataVolume, setupPrefixKey: found.setupPrefixKey, manifestDigest: found.manifestDigest });
  }
  return undefined;
}

/** Promote a stopped prepare VM plus its dependent volume. No image publish is used: Incus images lose the volume. */
export async function publishIncusArtifact(control: IncusControl, artifact: ArtifactIntent, prepare: { readonly project: string; readonly instance: string; readonly volume: string }, identity: ArtifactIdentity, env: NodeJS.ProcessEnv = process.env): Promise<ArtifactIntent> {
  if (artifact.state !== "reserved" || artifact.project !== identity.artifactProject) throw incusError("sandbox-artifact-unverified", "Artifact publication is fenced by its reserved generation and project.", ["Re-reserve after reconcile."]);
  await quiesceIncusArtifact(control, prepare.project, prepare.instance);
  await control.stopInstance(prepare.project, prepare.instance);
  const sourceVm = await control.getInstance(prepare.project, prepare.instance); const sourceVolume = await control.getVolume(prepare.project, identity.pool, prepare.volume);
  if (sourceVm === undefined || sourceVolume === undefined || sourceVm.status.toLowerCase() !== "stopped") throw incusError("sandbox-artifact-unverified", "Prepare tuple is not a stopped VM and dependent custom volume.", ["Quarantine the prepare allocation."]);
  const publishing = await writeArtifactIntent({ ...artifact, state: "publishing" }, env);
  await control.copyVolume({ sourceProject: prepare.project, sourcePool: identity.pool, sourceName: prepare.volume, targetProject: artifact.project, targetPool: identity.pool, targetName: artifact.dockerDataVolume, config: artifactConfig(publishing) });
  await control.copyInstance({ sourceProject: prepare.project, sourceName: prepare.instance, targetProject: artifact.project, targetName: artifact.instance, config: artifactConfig(publishing), devices: devices(identity.pool, artifact.dockerDataVolume, identity.network) });
  const vm = await control.getInstance(artifact.project, artifact.instance); const volume = await control.getVolume(artifact.project, identity.pool, artifact.dockerDataVolume);
  if (vm === undefined || volume === undefined || vm.status.toLowerCase() !== "stopped" || !matches(vm.config, publishing) || !matches(volume.config, publishing)) {
    await writeArtifactIntent({ ...publishing, state: "quarantined" }, env); throw incusError("sandbox-artifact-unverified", "Published artifact tuple failed bidirectional metadata or stopped-state verification.", ["Reconcile and quarantine this artifact."]);
  }
  return writeArtifactIntent({ ...publishing, state: "committed" }, env);
}

/** Guest-side barrier before the provider stop: no Docker workload may be captured live. */
export async function quiesceIncusArtifact(control: IncusControl, project: string, instance: string): Promise<void> {
  const result = await control.exec(project, instance, ["/bin/sh", "-lc", "systemctl stop docker.service docker.socket containerd.service || exit 1; ! systemctl is-active --quiet docker.service; ! systemctl is-active --quiet containerd.service"]);
  if (result.exitCode !== 0) throw incusError("sandbox-artifact-unverified", `Artifact prepare VM ${JSON.stringify(instance)} did not pass the Docker/containerd quiesce barrier.`, ["Do not publish a live Docker daemon or its containers."]);
}

export async function lookupCommittedIncusArtifact(artifactId: string, generation: number, env: NodeJS.ProcessEnv = process.env): Promise<IncusArtifactLocator> {
  const artifact = await requireCommittedArtifact(artifactId, generation, env); return Object.freeze({ artifactId: artifact.artifactId, generation: artifact.generation, project: artifact.project, instance: artifact.instance, dockerDataVolume: artifact.dockerDataVolume, setupPrefixKey: artifact.setupPrefixKey, manifestDigest: artifact.manifestDigest });
}

/** Decode only the committed locator projection supplied by the Run coordinator. */
export async function decodeCommittedIncusArtifact(value: unknown, expectedProject: string, env: NodeJS.ProcessEnv = process.env): Promise<IncusArtifactLocator | undefined> {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) throw incusError("sandbox-artifact-unverified", "setupPrefixArtifact must be a committed Incus artifact locator object.", ["Pass the coordinator lookup result unchanged."]);
  const record = value as Record<string, unknown>;
  const keys = ["artifactId", "generation", "project", "instance", "dockerDataVolume", "setupPrefixKey", "manifestDigest"] as const;
  if (Object.keys(record).length !== keys.length || !keys.every((key) => key in record) || typeof record.artifactId !== "string" || typeof record.generation !== "number" || !Number.isSafeInteger(record.generation) || record.generation < 1 || !["project", "instance", "dockerDataVolume", "setupPrefixKey", "manifestDigest"].every((key) => typeof record[key] === "string")) throw incusError("sandbox-artifact-unverified", "setupPrefixArtifact has an invalid Incus locator shape.", ["Pass only the exact locator returned by lookupCommittedIncusArtifactForPrefixes."]);
  const artifact = await lookupCommittedIncusArtifact(record.artifactId, record.generation, env);
  if (artifact.project !== expectedProject || !keys.every((key) => artifact[key] === record[key])) throw incusError("sandbox-artifact-unverified", "setupPrefixArtifact does not match the committed artifact ledger record or planned artifact project.", ["Re-run committed artifact lookup; do not synthesize a locator."]);
  return artifact;
}

export interface IncusPrepareAllocation {
  readonly project: string; readonly pool: string; readonly network: string; readonly instance: string; readonly volume: string;
  readonly dockerDataBytes: number; readonly config: Readonly<Record<string, string>>;
}

/** The trusted prepare worker calls this from a base only; it creates a normal runtime-project VM plus dependent volume. */
export async function createIncusPrepareFromBase(control: IncusControl, plan: IncusRuntimePlan, prepare: IncusPrepareAllocation): Promise<void> {
  await control.createVolume({ project: prepare.project, pool: prepare.pool, name: prepare.volume, contentType: "block", sizeBytes: prepare.dockerDataBytes, config: prepare.config });
  await control.createInstance({ name: prepare.instance, project: prepare.project, fingerprint: plan.imageFingerprint, storagePool: prepare.pool, network: prepare.network, config: prepare.config, dockerDataVolume: prepare.volume, dockerDataContentType: "block" });
}

/** A parent artifact uses the same explicit cross-project clone path as a consumer. */
export async function createIncusPrepareFromArtifact(control: IncusControl, parent: IncusArtifactLocator, prepare: IncusPrepareAllocation): Promise<void> {
  await cloneIncusArtifactConsumer(control, parent, { project: prepare.project, pool: prepare.pool, network: prepare.network, instance: prepare.instance, volume: prepare.volume, config: prepare.config });
}

/** Cross-project consumer clone. New volume source/name is explicit and never reuses the artifact source name. */
export async function cloneIncusArtifactConsumer(control: IncusControl, artifact: IncusArtifactLocator, target: { readonly project: string; readonly pool: string; readonly network: string; readonly instance: string; readonly volume: string; readonly config: Readonly<Record<string, string>> }): Promise<void> {
  const vm = await control.getInstance(artifact.project, artifact.instance); const volume = await control.getVolume(artifact.project, target.pool, artifact.dockerDataVolume);
  if (vm === undefined || volume === undefined || vm.status.toLowerCase() !== "stopped" || vm.config[INCUS_METADATA.artifactState] !== "committed" || vm.config[INCUS_METADATA.manifestDigest] !== artifact.manifestDigest || volume.config[INCUS_METADATA.manifestDigest] !== artifact.manifestDigest) throw incusError("sandbox-artifact-unverified", "Committed artifact drifted or is missing; it is not consumable.", ["Invalidate and quarantine the artifact before retrying."]);
  await control.copyVolume({ sourceProject: artifact.project, sourcePool: target.pool, sourceName: artifact.dockerDataVolume, targetProject: target.project, targetPool: target.pool, targetName: target.volume, config: target.config });
  await control.copyInstance({ sourceProject: artifact.project, sourceName: artifact.instance, targetProject: target.project, targetName: target.instance, config: target.config, devices: devices(target.pool, target.volume, target.network) });
}

/** Reconcile is exact-object only. It never adopts similarly named objects or makes a drifted artifact warm. */
export async function reconcileIncusArtifact(control: IncusControl, artifact: ArtifactIntent, env: NodeJS.ProcessEnv = process.env): Promise<ArtifactIntent> {
  const vm = await control.getInstance(artifact.project, artifact.instance);
  const volume = await control.getVolume(artifact.project, artifact.pool, artifact.dockerDataVolume);
  const exactVm = vm !== undefined && matches(vm.config, artifact);
  const exactVolume = volume !== undefined && matches(volume.config, artifact);
  if (artifact.state === "committed") {
    if (exactVm && exactVolume && vm.status.toLowerCase() === "stopped") return artifact;
    return writeArtifactIntent({ ...artifact, state: "quarantined" }, env);
  }
  if ((vm !== undefined && !exactVm) || (volume !== undefined && !exactVolume)) {
    return writeArtifactIntent({ ...artifact, state: "quarantined" }, env);
  }
  if (exactVm) await control.deleteInstance(artifact.project, artifact.instance);
  if (exactVolume) await control.deleteVolume(artifact.project, artifact.pool, artifact.dockerDataVolume);
  if (exactVm) await control.waitAbsent(artifact.project, artifact.instance);
  if (exactVolume) await control.waitVolumeAbsent(artifact.project, artifact.pool, artifact.dockerDataVolume);
  return writeArtifactIntent({ ...artifact, state: "released" }, env);
}

export async function releaseIncusArtifact(control: IncusControl, artifact: ArtifactIntent, env: NodeJS.ProcessEnv = process.env): Promise<ArtifactIntent> {
  if (artifact.state === "committed") throw incusError("sandbox-artifact-unverified", "Committed artifacts must be invalidated/quarantined by reconcile before release.", ["Do not delete a committed artifact without detecting drift or an explicit invalidation decision."]);
  return reconcileIncusArtifact(control, artifact, env);
}
