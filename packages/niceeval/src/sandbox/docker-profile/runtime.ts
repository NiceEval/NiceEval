import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join, parse } from "node:path";
import type { Readable } from "node:stream";
import { Effect, type Scope } from "effect";
import type { SandboxSetupPrefixCacheOperation } from "../backend.ts";
import type { JsonValue } from "../../shared/types.ts";
import { digestOf } from "../identity.ts";
import { sandboxState } from "../action.ts";
import { indexDockerProfiles, resolveDockerProfile, type ResolvedDockerProfileEntry } from "./registry.ts";
import {
  DOCKER_PROFILE_SETUP_PREFIX_CONTROL_PROTOCOL,
  type DockerExecutionProfileV1,
  type DockerProfileSetupPrefixFullCopyCapabilityV1,
} from "./schema.ts";

export const DOCKER_PROFILE_REGISTRY_DIR = "/etc/niceeval/docker-profiles";

export interface DockerProfileRuntimeBinding {
  readonly alias: string;
  readonly profile: DockerExecutionProfileV1;
  readonly descriptorDigest: string;
  readonly daemonGeneration: string;
  readonly daemonId: string;
  readonly dockerSocketPath: string;
  readonly controlSocketPath: string;
  readonly platform: string;
}

export interface DockerProfileLease {
  readonly binding: DockerProfileRuntimeBinding;
  readonly invocationId: string;
  readonly leaseToken: string;
  readonly stopHeartbeat: () => Promise<void>;
}

export interface DockerProfileReservation {
  readonly reservationId: string;
  readonly provisionToken: string;
  readonly state: "queued" | "blocked" | "granted" | "provisioning" | "committed" | "releasing" | "quarantined";
  readonly containerId?: string;
  readonly networkId?: string;
  readonly locator?: string;
  readonly buildTerminated?: boolean;
  readonly buildError?: string;
  readonly slotId?: string;
  readonly slotGeneration?: number;
}

export class DockerProfileCapacityBlockedError extends Error {
  readonly code: "CAPACITY_BLOCKED" | "CAPACITY_QUEUE_TIMEOUT";
  constructor(policy: "blocked" | "doctor-timeout" = "blocked") {
    super(policy === "doctor-timeout"
      ? "Docker profile capacity queue timed out after 30 seconds"
      : "Docker profile capacity is blocked");
    this.code = policy === "doctor-timeout" ? "CAPACITY_QUEUE_TIMEOUT" : "CAPACITY_BLOCKED";
  }
}

export class DockerProfileReservationStateError extends Error {
  readonly code = "RESERVATION_NOT_GRANTED";
  constructor(readonly state: DockerProfileReservation["state"]) {
    super(`Docker profile reservation cannot run from non-granted state ${JSON.stringify(state)}`);
  }
}

/**
 * Runner-owned permits that must not be retained while a profile reservation is
 * waiting in the control service's fair queue. The Effect values are stateful
 * and idempotent at their owner; this boundary only brackets the wait.
 */
export interface DockerProfileReservationWaitSlot {
  readonly release: Effect.Effect<void>;
  readonly reacquire: Effect.Effect<void>;
}

/** Provider-neutral admission notifications supplied by the Sandbox runtime. */
export interface DockerProfileReservationAdmission {
  readonly queued: Effect.Effect<void>;
  readonly granted: Effect.Effect<void>;
  readonly slot?: DockerProfileReservationWaitSlot;
}

/**
 * Scope-owned reservation. `release` is shared by the Scope finalizer and the
 * provider's normal after-stop path, so either path may win without double
 * disposal or leaving a grant-to-install ownership gap. Queued/blocked owners
 * cancel; capacity-owning states release.
 */
export interface DockerProfileReservationOwner {
  readonly reservation: DockerProfileReservation;
  readonly release: () => Promise<void>;
}

interface MutableDockerProfileReservationOwner extends DockerProfileReservationOwner {
  readonly update: (reservation: DockerProfileReservation) => void;
}

export interface DockerProfileContainerCreateInput {
  readonly image: string;
  readonly attemptId: string;
  readonly command?: readonly string[];
  readonly entrypoint?: string;
  readonly environment?: readonly string[];
  readonly workingDir?: string;
  readonly user?: string;
  readonly tmpfs?: Readonly<Record<string, string>>;
}

export type DockerProfileContainerIntent =
  | { readonly intent: "workload"; readonly create: DockerProfileContainerCreateInput }
  | { readonly intent: "diagnostic" };

export interface DockerProfileContainerCreateResult {
  readonly containerId: string;
  readonly networkId: string;
  readonly state: "active";
}

export interface DockerProfileBuildCreateInput {
  readonly buildKey: string;
  readonly platform: string;
  readonly dockerfile: string;
  readonly buildArgs?: Readonly<Record<string, string>>;
  readonly target?: string;
  readonly retention?: "cache" | "ephemeral";
}

export interface DockerProfileBuildCreateResult {
  readonly locator: string;
  readonly state: "terminated";
  readonly cleanupProven?: boolean;
}

export interface DockerProfileSetupPrefixArtifactIdentityV1 {
  readonly requiredState: "dockerData";
  readonly copyProtocol: DockerProfileSetupPrefixFullCopyCapabilityV1["copyProtocol"];
  readonly copyRevision: string;
  /** Provider-neutral identifier; it is not a Docker image id or a raw-filesystem digest slot. */
  readonly artifactId: string;
  readonly sizeBytes: number;
}

interface DockerProfileSetupPrefixReceiptV1 {
  readonly daemonGeneration: string;
  readonly slotGeneration: number;
  readonly requiredState: "dockerData";
  readonly setupPrefixKey: string;
  readonly setupManifestDigest: string;
  readonly artifact: DockerProfileSetupPrefixArtifactIdentityV1;
}

export interface DockerProfileSetupPrefixCaptureResultV1 extends DockerProfileSetupPrefixReceiptV1 {
  readonly state: "captured" | "already-published";
}

export interface DockerProfileSetupPrefixRestoreResultV1 extends DockerProfileSetupPrefixReceiptV1 {
  readonly state: "restored" | "already-restored";
}

export class DockerProfileControlError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(`${code}: ${message}`);
    this.name = "DockerProfileControlError";
  }
}

/** The publish outcome is unknown after transport loss; callers must inspect
 * terminal rather than treating this as a cache miss or ordinary domain error. */
export class DockerProfileControlAmbiguityError extends Error {
  constructor(
    readonly operationId: string,
    readonly terminal: "cancel-fenced" | "unresolved",
    message: string,
  ) {
    super(message);
    this.name = "DockerProfileControlAmbiguityError";
  }
}

export class DockerProfileControlCancellationError extends Error {
  constructor(readonly operationId: string, message: string) {
    super(message);
    this.name = "DockerProfileControlCancellationError";
  }
}

interface DockerProfileReleaseReceipt {
  readonly released: true;
  readonly cleanupProven?: true;
}

interface DockerProfileCancelReceipt {
  readonly cancelled: true;
}

interface DockerProfileCleanupStatusReceipt {
  readonly profileId: string;
  readonly generation: string;
  readonly leases: readonly {
    readonly invocationId: string;
    readonly daemonGeneration: string;
  }[];
  readonly reservations: readonly {
    readonly reservationId: string;
    readonly invocationId: string;
  }[];
  readonly queue: readonly {
    readonly reservationId: string;
    readonly invocationId: string;
  }[];
  readonly slots: readonly {
    readonly slotId: string;
    readonly invocationId?: string;
    readonly reservationId?: string;
    readonly state: string;
  }[];
  readonly degraded: readonly string[];
}

type DockerProfileLeaseDrainState = "draining" | "recovered";

const DOCKER_PROFILE_DRAIN_RECONCILE_TIMEOUT_MS = 60_000;
const DOCKER_PROFILE_DRAIN_RECONCILE_INTERVAL_MS = 200;

function validateLeaseDrainReceipt(value: unknown): DockerProfileLeaseDrainState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Docker profile lease drain receipt is not an object");
  }
  const receipt = value as Readonly<Record<string, unknown>>;
  if (Object.keys(receipt).length !== 1 || !("state" in receipt)) {
    throw new Error("Docker profile lease drain receipt fields changed");
  }
  if (receipt.state !== "draining" && receipt.state !== "recovered") {
    throw new Error("Docker profile lease drain did not reach a cleanup-owned state");
  }
  return receipt.state;
}

function validateReleaseReceipt(value: unknown): DockerProfileReleaseReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Docker profile reservation release receipt is not an object");
  }
  const receipt = value as Readonly<Record<string, unknown>>;
  const fields = Object.keys(receipt).sort();
  if (
    receipt.released !== true ||
    (receipt.cleanupProven !== undefined && receipt.cleanupProven !== true) ||
    (
      fields.length !== 1 &&
      !(fields.length === 2 && fields[0] === "cleanupProven" && fields[1] === "released")
    ) ||
    (fields.length === 1 && fields[0] !== "released")
  ) {
    throw new Error("Docker profile reservation release receipt is not exact or does not prove release");
  }
  return Object.freeze({
    released: true,
    ...(receipt.cleanupProven === true ? { cleanupProven: true as const } : {}),
  });
}

function validateCancelReceipt(value: unknown): DockerProfileCancelReceipt {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).length !== 1 || (value as Readonly<Record<string, unknown>>).cancelled !== true
  ) {
    throw new Error("Docker profile reservation cancel receipt is not exact or does not prove cancellation");
  }
  return Object.freeze({ cancelled: true });
}

function validateCleanupStatusReceipt(value: unknown): DockerProfileCleanupStatusReceipt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Docker profile cleanup status receipt is not an object");
  }
  const receipt = value as Readonly<Record<string, unknown>>;
  if (
    typeof receipt.profileId !== "string" ||
    typeof receipt.generation !== "string" ||
    !Array.isArray(receipt.leases) ||
    !Array.isArray(receipt.reservations) ||
    !Array.isArray(receipt.queue) ||
    !Array.isArray(receipt.slots) ||
    !Array.isArray(receipt.degraded)
  ) {
    throw new Error("Docker profile cleanup status receipt is missing ownership fields");
  }
  const leases = receipt.leases.map((item) => {
    if (
      typeof item !== "object" || item === null || Array.isArray(item) ||
      typeof item.invocationId !== "string" || typeof item.daemonGeneration !== "string"
    ) throw new Error("Docker profile cleanup status lease identity is invalid");
    return { invocationId: item.invocationId, daemonGeneration: item.daemonGeneration };
  });
  const reservations = receipt.reservations.map((item) => {
    if (
      typeof item !== "object" || item === null || Array.isArray(item) ||
      typeof item.reservationId !== "string" || typeof item.invocationId !== "string"
    ) throw new Error("Docker profile cleanup status reservation identity is invalid");
    return { reservationId: item.reservationId, invocationId: item.invocationId };
  });
  const queue = receipt.queue.map((item) => {
    if (
      typeof item !== "object" || item === null || Array.isArray(item) ||
      typeof item.reservationId !== "string" || typeof item.invocationId !== "string"
    ) throw new Error("Docker profile cleanup status queue ownership is invalid");
    return { reservationId: item.reservationId, invocationId: item.invocationId };
  });
  const slots = receipt.slots.map((item) => {
    if (
      typeof item !== "object" || item === null || Array.isArray(item) ||
      typeof item.slotId !== "string" || typeof item.state !== "string" ||
      (item.invocationId !== undefined && typeof item.invocationId !== "string") ||
      (item.reservationId !== undefined && typeof item.reservationId !== "string")
    ) throw new Error("Docker profile cleanup status slot ownership is invalid");
    return {
      slotId: item.slotId,
      state: item.state,
      ...(item.invocationId === undefined ? {} : { invocationId: item.invocationId }),
      ...(item.reservationId === undefined ? {} : { reservationId: item.reservationId }),
    };
  });
  if (!receipt.degraded.every((item) => typeof item === "string")) {
    throw new Error("Docker profile cleanup status diagnostics are invalid");
  }
  return Object.freeze({
    profileId: receipt.profileId,
    generation: receipt.generation,
    leases: Object.freeze(leases),
    reservations: Object.freeze(reservations),
    queue: Object.freeze(queue),
    slots: Object.freeze(slots),
    degraded: Object.freeze([...receipt.degraded]),
  });
}

function leaseCleanupProven(
  receipt: DockerProfileCleanupStatusReceipt,
  binding: DockerProfileRuntimeBinding,
  invocationId: string,
): boolean {
  return receipt.profileId === binding.profile.profileId &&
    receipt.generation === binding.daemonGeneration &&
    !receipt.leases.some((item) => item.invocationId === invocationId) &&
    !receipt.reservations.some((item) => item.invocationId === invocationId) &&
    !receipt.queue.some((item) => item.invocationId === invocationId) &&
    !receipt.slots.some((item) => item.invocationId === invocationId);
}

export async function lookupDockerProfileBuild(
  binding: DockerProfileRuntimeBinding,
  buildKey: string,
): Promise<{ readonly hit: boolean; readonly locator: string }> {
  return await dockerProfileControlRequest(binding.controlSocketPath, {
    kind: "build.lookup",
    profileId: binding.profile.profileId,
    daemonGeneration: binding.daemonGeneration,
    buildKey,
  });
}

function modeOf(value: number): number {
  return value & 0o7777;
}

async function parentModes(path: string): Promise<number[]> {
  const result: number[] = [];
  const root = parse(path).root;
  let current = dirname(path);
  while (true) {
    result.push(modeOf((await stat(current)).mode));
    if (current === root) break;
    current = dirname(current);
  }
  return result;
}

/** Production registry location is fixed; tests may exercise descriptor I/O at an explicit directory. */
export async function loadDockerProfileRegistryAt(
  registryDir: string,
): Promise<ReturnType<typeof indexDockerProfiles>> {
  const names = (await readdir(registryDir)).filter((name) =>
    name.endsWith(".json")
    && !name.endsWith(".host.json")
    && !name.endsWith(".daemon.json")
    && !/^assets-v[1-9]\d*\.json$/.test(name)
  ).sort();
  const entries = await Promise.all(names.map(async (name) => {
    const source = join(registryDir, name);
    const facts = await lstat(source);
    return {
      alias: name.slice(0, -".json".length),
      profile: JSON.parse(await readFile(source, "utf8")) as unknown,
      source,
      fileFacts: {
        isSymlink: facts.isSymbolicLink(),
        ownerUid: facts.uid,
        mode: modeOf(facts.mode),
        parentModes: await parentModes(source),
      },
    };
  }));
  return indexDockerProfiles(entries, { expectedOwnerUid: 0 });
}

export async function loadDockerProfileRegistry(): Promise<ReturnType<typeof indexDockerProfiles>> {
  return loadDockerProfileRegistryAt(DOCKER_PROFILE_REGISTRY_DIR);
}

export function dockerProfileControlRequest<T>(
  path: string,
  request: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = connect(path);
    let response = "";
    let settled = false;
    const settle = (outcome: { value: T } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if ("value" in outcome) resolve(outcome.value);
      else reject(outcome.error);
    };
    const abort = () => socket.destroy(
      signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("Docker profile control request aborted", "AbortError"),
    );
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: Buffer) => { response += chunk.toString(); });
    socket.on("timeout", () => socket.destroy(new Error(`Docker profile control timeout: ${path}`)));
    socket.on("error", (error) => settle({ error }));
    socket.on("close", () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(response) as {
          ok?: boolean;
          result?: T;
          error?: Readonly<Record<string, unknown>> & { readonly code?: string; readonly message?: string };
        };
        if (parsed.ok !== true || parsed.result === undefined) {
          settle({
            error: new DockerProfileControlError(
              parsed.error?.code ?? "control-error",
              parsed.error?.message ?? "invalid control reply",
              parsed.error,
            ),
          });
        } else settle({ value: parsed.result });
      } catch (error) {
        settle({ error });
      }
    });
  });
}

function setupPrefixCapability(
  lease: DockerProfileLease,
): DockerProfileSetupPrefixFullCopyCapabilityV1 {
  const capability = lease.binding.profile.backend.filesystem.setupPrefix;
  if (capability === undefined) {
    throw new Error("Docker profile descriptor does not declare setup-prefix full-copy capability");
  }
  if (
    capability.protocol !== DOCKER_PROFILE_SETUP_PREFIX_CONTROL_PROTOCOL ||
    capability.coverage !== sandboxState.dockerData ||
    capability.requiredState !== sandboxState.dockerData ||
    lease.binding.profile.backend.filesystem.dockerDataPool.attestation !==
      capability.slotAttestation ||
    lease.binding.profile.backend.filesystem.dockerDataPool.bytesPerAllocation !==
      capability.filesystemSizeBytes
  ) {
    throw new Error(
      "Docker profile setup-prefix capability is not backed by independent fixed-filesystem slots",
    );
  }
  return capability;
}

function setupPrefixExpectedWire(
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: SandboxSetupPrefixCacheOperation,
): Readonly<Record<string, unknown>> {
  const capability = setupPrefixCapability(lease);
  return Object.freeze({
    protocol: capability.protocol,
    requiredState: capability.requiredState,
    descriptorDigest: lease.binding.descriptorDigest,
    setupPrefixKey: input.manifest.setupPrefixKey,
    setupManifestDigest: input.manifest.setupManifestDigest,
    providerIdentity: capability.providerIdentity,
    baseIdentity: input.manifest.baseImageId,
    executionDomain: capability.executionDomain,
    helperRevision: capability.helperRevision,
    copyProtocol: capability.copyProtocol,
    copyRevision: capability.copyRevision,
    quiesceRevision: capability.quiesceRevision,
    publicationRevision: capability.publicationRevision,
    recoveryRevision: capability.recoveryRevision,
    manifestSchema: capability.manifestSchema,
    filesystemSizeBytes: capability.filesystemSizeBytes,
    filesystemFeatures: Object.freeze([...capability.filesystemFeatures]),
    daemonGeneration: lease.binding.daemonGeneration,
    slotGeneration: reservation.slotGeneration,
  });
}

function setupPrefixControlFrame(
  kind: "setup-prefix.capture" | "setup-prefix.capture.publish" | "setup-prefix.restore",
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: SandboxSetupPrefixCacheOperation,
): Readonly<Record<string, unknown>> {
  if (!Number.isSafeInteger(reservation.slotGeneration) || reservation.slotGeneration! < 0) {
    throw new Error("Docker profile reservation has no attested private slot generation");
  }
  const manifestDigest = digestOf(input.manifest.declarationMetadata as JsonValue);
  if (
    input.manifest.requiredState !== sandboxState.dockerData ||
    input.manifest.setupPrefixKey !== `prefix:${manifestDigest}` ||
    input.manifest.setupManifestDigest !== `sha256:${manifestDigest}`
  ) {
    throw new Error("Docker profile setup-prefix key is not bound to its complete canonical manifest identity");
  }
  if (input.operationId.length === 0 || input.operationId.length > 512 || /[\u0000-\u001f\u007f]/u.test(input.operationId)) {
    throw new Error("Docker profile setup-prefix operationId is invalid");
  }
  return Object.freeze({
    kind,
    invocationId: lease.invocationId,
    leaseToken: lease.leaseToken,
    reservationId: reservation.reservationId,
    operationId: input.operationId,
    ...setupPrefixExpectedWire(lease, reservation, input),
  });
}

function setupPrefixWireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Docker profile setup-prefix control response is not an object");
  }
  return value as Readonly<Record<string, unknown>>;
}

function validateExactSetupPrefixFields(
  value: Readonly<Record<string, unknown>>,
  expectedFields: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedFields].sort();
  if (
    actual.length !== expected.length ||
    actual.some((field, index) => field !== expected[index])
  ) {
    throw new Error(
      `Docker profile setup-prefix ${label} fields changed: ` +
      `expected ${expected.join(", ")}; received ${actual.join(", ")}`,
    );
  }
}

function validateSetupPrefixArtifactIdentity(
  value: unknown,
  lease: DockerProfileLease,
  expected?: DockerProfileSetupPrefixArtifactIdentityV1,
): DockerProfileSetupPrefixArtifactIdentityV1 {
  const artifact = setupPrefixWireRecord(value);
  validateExactSetupPrefixFields(
    artifact,
    ["requiredState", "copyProtocol", "copyRevision", "artifactId", "sizeBytes"],
    "artifact receipt",
  );
  const capability = setupPrefixCapability(lease);
  if (artifact.requiredState !== capability.requiredState) {
    throw new Error("Docker profile setup-prefix artifact requiredState does not match the descriptor");
  }
  if (artifact.copyProtocol !== capability.copyProtocol) {
    throw new Error("Docker profile setup-prefix artifact copyProtocol does not match the descriptor");
  }
  if (artifact.copyRevision !== capability.copyRevision) {
    throw new Error("Docker profile setup-prefix artifact copyRevision does not match the descriptor");
  }
  if (
    typeof artifact.artifactId !== "string" ||
    artifact.artifactId.length === 0 ||
    artifact.artifactId.length > 512 ||
    /[\u0000-\u001f\u007f]/u.test(artifact.artifactId)
  ) {
    throw new Error("Docker profile setup-prefix artifactId is not a bounded provider identity");
  }
  if (!Number.isSafeInteger(artifact.sizeBytes) || (artifact.sizeBytes as number) < 0) {
    throw new Error("Docker profile setup-prefix artifact sizeBytes is invalid");
  }
  if ((artifact.sizeBytes as number) > capability.seedLimitBytes) {
    throw new Error("Docker profile setup-prefix artifact exceeds descriptor seedLimitBytes");
  }
  if (
    capability.copyProtocol === "raw-image/v1" &&
    artifact.sizeBytes !== capability.filesystemSizeBytes
  ) {
    throw new Error("Docker profile raw-image artifact does not cover the complete fixed Docker data filesystem");
  }
  const identity = Object.freeze({
    requiredState: capability.requiredState,
    copyProtocol: capability.copyProtocol,
    copyRevision: capability.copyRevision,
    artifactId: artifact.artifactId,
    sizeBytes: artifact.sizeBytes as number,
  });
  if (
    expected !== undefined &&
    (
      identity.copyProtocol !== expected.copyProtocol ||
      identity.copyRevision !== expected.copyRevision ||
      identity.requiredState !== expected.requiredState ||
      identity.artifactId !== expected.artifactId ||
      identity.sizeBytes !== expected.sizeBytes
    )
  ) {
    throw new Error("Docker profile setup-prefix restored artifact identity changed after capture");
  }
  return identity;
}

function wireValueMatches(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual) && actual.length === expected.length &&
      expected.every((value, index) => actual[index] === value);
  }
  return actual === expected;
}

function validateSetupPrefixWireBinding(
  receipt: Readonly<Record<string, unknown>>,
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: SandboxSetupPrefixCacheOperation,
  label: string,
): void {
  const expected = setupPrefixExpectedWire(lease, reservation, input);
  for (const [field, value] of Object.entries(expected)) {
    if (!wireValueMatches(receipt[field], value)) {
      throw new Error(`Docker profile setup-prefix ${label} ${field} changed`);
    }
  }
}

function validateSetupPrefixReceipt(
  value: unknown,
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: SandboxSetupPrefixCacheOperation,
  expectedArtifact?: DockerProfileSetupPrefixArtifactIdentityV1,
): DockerProfileSetupPrefixReceiptV1 & { readonly status: Readonly<Record<string, unknown>> } {
  const response = setupPrefixWireRecord(value);
  validateExactSetupPrefixFields(
    response,
    [...Object.keys(setupPrefixExpectedWire(lease, reservation, input)), "artifact", "status"],
    "success receipt",
  );
  validateSetupPrefixWireBinding(response, lease, reservation, input, "response");
  const status = setupPrefixWireRecord(response.status);
  validateExactSetupPrefixFields(status, ["state", "capacity"], "success status");
  setupPrefixWireRecord(status.capacity);
  return Object.freeze({
    daemonGeneration: response.daemonGeneration as string,
    slotGeneration: response.slotGeneration as number,
    requiredState: response.requiredState as "dockerData",
    setupPrefixKey: response.setupPrefixKey as string,
    setupManifestDigest: response.setupManifestDigest as string,
    artifact: validateSetupPrefixArtifactIdentity(response.artifact, lease, expectedArtifact),
    status,
  });
}

function validateSetupPrefixControlError(
  cause: unknown,
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: SandboxSetupPrefixCacheOperation,
): void {
  if (!(cause instanceof DockerProfileControlError)) return;
  try {
    const details = setupPrefixWireRecord(cause.details);
    validateExactSetupPrefixFields(
      details,
      [
        "code",
        "message",
        ...Object.keys(setupPrefixExpectedWire(lease, reservation, input)),
        "artifact",
        "status",
      ],
      "failure receipt",
    );
    validateSetupPrefixWireBinding(details, lease, reservation, input, "failure receipt");
    if (
      typeof details.code !== "string" || details.code.length === 0 || details.code !== cause.code ||
      typeof details.message !== "string" || details.message.length === 0 || details.message.length > 65_536
    ) {
      throw new Error("Docker profile setup-prefix failure code or message identity is invalid");
    }
    const artifact = setupPrefixWireRecord(details.artifact);
    validateExactSetupPrefixFields(artifact, ["artifactId"], "failure artifact receipt");
    if (artifact.artifactId !== null) {
      throw new Error("Docker profile setup-prefix terminal failure must not claim an artifact identity");
    }
    const status = setupPrefixWireRecord(details.status);
    validateExactSetupPrefixFields(status, ["state", "diagnostic"], "failure status");
    if (status.state !== "failed" || status.diagnostic !== cause.code) {
      throw new Error("Docker profile setup-prefix failure status does not match its diagnostic");
    }
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : String(error), { cause });
  }
}

export async function captureDockerProfileSetupPrefix(
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: SandboxSetupPrefixCacheOperation,
  signal?: AbortSignal,
  controlTimeoutMs = 120_000,
): Promise<DockerProfileSetupPrefixCaptureResultV1> {
  setupPrefixCapability(lease);
  let rawResponse: unknown;
  try {
    rawResponse = await dockerProfileControlRequest<unknown>(
      lease.binding.controlSocketPath,
      setupPrefixControlFrame("setup-prefix.capture", lease, reservation, input),
      signal,
      controlTimeoutMs,
    );
  } catch (cause) {
    validateSetupPrefixControlError(cause, lease, reservation, input);
    throw cause;
  }
  let response = validateSetupPrefixReceipt(rawResponse, lease, reservation, input);
  let state = response.status.state;
  if (state === "prepared") {
    // Copy/prepare may legitimately use the caller's long control budget. Publish is
    // only a journal transition, so response-loss reconciliation owns a separate,
    // short budget. It must also outlive caller abort: once prepare succeeded, only
    // the Host can prove published or cancel-fenced for this operation identity.
    const publishReconciliationDeadline = Date.now() + 30_000;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const reconcileController = new AbortController();
      const reconcileTimeoutMs = Math.max(
        1,
        Math.min(10_000, publishReconciliationDeadline - Date.now()),
      );
      const reconcileTimer = setTimeout(() => reconcileController.abort(), reconcileTimeoutMs);
      try {
        rawResponse = await dockerProfileControlRequest<unknown>(
          lease.binding.controlSocketPath,
          setupPrefixControlFrame("setup-prefix.capture.publish", lease, reservation, input),
          reconcileController.signal,
          reconcileTimeoutMs,
        );
        response = validateSetupPrefixReceipt(rawResponse, lease, reservation, input);
        lastError = undefined;
        clearTimeout(reconcileTimer);
        break;
      } catch (cause) {
        clearTimeout(reconcileTimer);
        validateSetupPrefixControlError(cause, lease, reservation, input);
        lastError = cause;
        if (cause instanceof DockerProfileControlError &&
            (cause.code === "setup-prefix-operation-cancelled" || cause.code === "setup-prefix-operation-cancel-fenced")) {
          throw new DockerProfileControlCancellationError(input.operationId, "setup-prefix capture was fenced and scrubbed");
        }
        if (attempt === 2) break;
        await new Promise<void>((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
      }
    }
    if (lastError !== undefined) {
      throw new DockerProfileControlAmbiguityError(input.operationId, "unresolved",
        "setup-prefix publish outcome is ambiguous; retry/reconcile is exhausted");
    }
    state = response.status.state;
  }
  if (state !== "captured" && state !== "already-published") {
    throw new Error(`Docker profile setup-prefix capture returned invalid state ${JSON.stringify(state)}`);
  }
  return Object.freeze({
    daemonGeneration: response.daemonGeneration,
    slotGeneration: response.slotGeneration,
    requiredState: response.requiredState,
    setupPrefixKey: response.setupPrefixKey,
    setupManifestDigest: response.setupManifestDigest,
    state,
    artifact: response.artifact,
  });
}

export async function restoreDockerProfileSetupPrefix(
  lease: DockerProfileLease,
  reservation: DockerProfileReservation,
  input: SandboxSetupPrefixCacheOperation,
  expected?: DockerProfileSetupPrefixArtifactIdentityV1,
  signal?: AbortSignal,
  controlTimeoutMs = 120_000,
): Promise<DockerProfileSetupPrefixRestoreResultV1> {
  setupPrefixCapability(lease);
  let rawResponse: unknown;
  try {
    rawResponse = await dockerProfileControlRequest<unknown>(
      lease.binding.controlSocketPath,
      setupPrefixControlFrame("setup-prefix.restore", lease, reservation, input),
      signal,
      controlTimeoutMs,
    );
  } catch (cause) {
    validateSetupPrefixControlError(cause, lease, reservation, input);
    throw cause;
  }
  const response = validateSetupPrefixReceipt(rawResponse, lease, reservation, input, expected);
  const state = response.status.state;
  if (state !== "restored" && state !== "already-restored") {
    throw new Error(`Docker profile setup-prefix restore returned invalid state ${JSON.stringify(state)}`);
  }
  return Object.freeze({
    daemonGeneration: response.daemonGeneration,
    slotGeneration: response.slotGeneration,
    requiredState: response.requiredState,
    setupPrefixKey: response.setupPrefixKey,
    setupManifestDigest: response.setupManifestDigest,
    state,
    artifact: response.artifact,
  });
}

async function socketFact(path: string, expectedUid: number): Promise<void> {
  const value = await lstat(path);
  if (!value.isSocket()) throw new Error(`Docker profile endpoint is not a Unix socket: ${path}`);
  if (value.uid !== expectedUid) throw new Error(`Docker profile endpoint ${path} owner is ${value.uid}, expected ${expectedUid}`);
  if ((modeOf(value.mode) & 0o002) !== 0) throw new Error(`Docker profile endpoint is world-writable: ${path}`);
}

function rootlessSecurityOptions(info: { readonly SecurityOptions?: readonly string[] }): boolean {
  return (info.SecurityOptions ?? []).some((option: string) => option.toLowerCase().includes("rootless"));
}

async function attestEntry(entry: ResolvedDockerProfileEntry): Promise<DockerProfileRuntimeBinding> {
  const profile = entry.profile;
  await Promise.all([
    socketFact(profile.transport.dockerSocket.path, profile.transport.dockerSocket.peerUid),
    socketFact(profile.transport.controlSocket.path, profile.transport.controlSocket.peerUid),
  ]);
  const nonce = randomUUID();
  const challenge = await dockerProfileControlRequest<{
    readonly protocol: string;
    readonly profileId: string;
    readonly descriptorDigest: string;
    readonly hostMachineIdentity: string;
    readonly backendMachineIdentity: string;
    readonly daemonGeneration: string;
    readonly clientNonce: string;
  }>(profile.transport.controlSocket.path, { kind: "challenge", clientNonce: nonce });
  if (challenge.protocol !== profile.transport.controlSocket.protocol || challenge.profileId !== profile.profileId ||
      challenge.descriptorDigest !== entry.descriptorDigest || challenge.clientNonce !== nonce ||
      challenge.hostMachineIdentity !== profile.transport.hostMachineIdentity ||
      challenge.backendMachineIdentity !== profile.backend.machineIdentity) {
    throw new Error(`Docker profile ${entry.alias} control attestation does not match its descriptor`);
  }
  // dockerode 是 optional peer；只有用户实际使用 Docker profile 时才加载。
  // 保持这里为热路径动态 import，避免不使用 Docker 的最小安装仅因 CLI 启动就崩溃。
  const { default: Docker } = await import("dockerode");
  const docker = new Docker({ socketPath: profile.transport.dockerSocket.path });
  const info = await docker.info();
  if (profile.securityLevel !== "raw-dind-storage/v1" && !rootlessSecurityOptions(info)) {
    throw new Error(`Docker profile ${entry.alias} daemon is not rootless`);
  }
  if (info.DockerRootDir !== profile.backend.filesystem.dockerRootDir) {
    throw new Error(`Docker profile ${entry.alias} DockerRootDir does not match descriptor`);
  }
  if (String(info.CgroupVersion) !== "2" || info.CgroupDriver !== "systemd") {
    throw new Error(`Docker profile ${entry.alias} requires cgroup v2 with the systemd driver`);
  }
  const os = info.OSType || "linux";
  const arch = info.Architecture || "amd64";
  if (typeof info.ID !== "string" || info.ID === "") throw new Error(`Docker profile ${entry.alias} daemon ID is missing`);
  return Object.freeze({
    alias: entry.alias,
    profile,
    descriptorDigest: entry.descriptorDigest,
    daemonGeneration: challenge.daemonGeneration,
    daemonId: info.ID,
    dockerSocketPath: profile.transport.dockerSocket.path,
    controlSocketPath: profile.transport.controlSocket.path,
    platform: `${os}/${arch}`,
  });
}

export async function attestDockerProfile(alias: string): Promise<DockerProfileRuntimeBinding> {
  return attestEntry(resolveDockerProfile(await loadDockerProfileRegistry(), alias));
}

export async function createDockerProfileLease(binding: DockerProfileRuntimeBinding): Promise<DockerProfileLease> {
  const invocationId = randomUUID();
  const created = await dockerProfileControlRequest<{ readonly leaseToken: string }>(binding.controlSocketPath, {
    kind: "lease.create",
    profileId: binding.profile.profileId,
    daemonGeneration: binding.daemonGeneration,
    invocationId,
  });
  let stopped = false;
  let heartbeatEnabled = true;
  let drainInFlight: Promise<void> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  const heartbeat = async () => {
    if (!heartbeatEnabled) return;
    await dockerProfileControlRequest(binding.controlSocketPath, {
      kind: "lease.heartbeat", invocationId, leaseToken: created.leaseToken,
    });
  };
  timer = setInterval(() => { void heartbeat().catch(() => {}); }, 5_000);
  timer.unref();
  return {
    binding,
    invocationId,
    leaseToken: created.leaseToken,
    stopHeartbeat: async () => {
      if (stopped) return;
      heartbeatEnabled = false;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      if (drainInFlight !== undefined) return await drainInFlight;
      const draining = (async () => {
        const deadline = Date.now() + DOCKER_PROFILE_DRAIN_RECONCILE_TIMEOUT_MS;
        let lastError: unknown;
        while (true) {
          try {
            validateLeaseDrainReceipt(
              await dockerProfileControlRequest<unknown>(binding.controlSocketPath, {
                kind: "lease.drain", invocationId, leaseToken: created.leaseToken,
              }),
            );
          } catch (error) {
            // The Host operation and recovery owner outlive a client socket.
            // A disconnect here is not cleanup proof; retry the idempotent
            // drain and verify the ledger independently.
            lastError = error;
          }
          try {
            const status = validateCleanupStatusReceipt(
              await dockerProfileControlRequest<unknown>(binding.controlSocketPath, { kind: "status" }),
            );
            if (leaseCleanupProven(status, binding, invocationId)) {
              stopped = true;
              return;
            }
            lastError = new Error(
              `Docker profile lease ${invocationId} remains visible after drain reconciliation`,
            );
          } catch (error) {
            lastError = error;
          }
          if (Date.now() >= deadline) {
            throw new Error(
              `Docker profile lease ${invocationId} did not reach recovered state within ` +
              `${DOCKER_PROFILE_DRAIN_RECONCILE_TIMEOUT_MS}ms`,
              lastError === undefined ? undefined : { cause: lastError },
            );
          }
          await new Promise((resolve) => setTimeout(resolve, DOCKER_PROFILE_DRAIN_RECONCILE_INTERVAL_MS));
        }
      })();
      drainInFlight = draining;
      try {
        await draining;
      } finally {
        if (!stopped && drainInFlight === draining) drainInFlight = undefined;
      }
    },
  };
}

function nonGrantedReservationError(reservation: DockerProfileReservation): Error {
  return reservation.state === "blocked"
    ? new DockerProfileCapacityBlockedError()
    : new DockerProfileReservationStateError(reservation.state);
}

export async function acquireDockerProfileReservation(
  lease: DockerProfileLease,
  reservationKind: "container" | "build",
  resources: Readonly<Record<string, number>>,
  signal?: AbortSignal,
): Promise<DockerProfileReservation> {
  const reservationId = randomUUID();
  // This Promise entry is shared by the ordinary build path (which always
  // supplies its Attempt signal) and `docker profile doctor`. Only doctor owns
  // the explicit 30-second diagnostic policy; normal builds have no queue TTL.
  const doctorDeadline = signal === undefined ? Date.now() + 30_000 : undefined;
  let reservation: DockerProfileReservation | undefined;
  try {
    reservation = await dockerProfileControlRequest<DockerProfileReservation>(lease.binding.controlSocketPath, {
      kind: "reservation.acquire", invocationId: lease.invocationId, leaseToken: lease.leaseToken,
      reservationId, reservationKind, resources,
    }, signal);
    while (reservation.state === "queued") {
      if (doctorDeadline !== undefined && Date.now() >= doctorDeadline) {
        throw new DockerProfileCapacityBlockedError("doctor-timeout");
      }
      if (signal?.aborted) throw signal.reason ?? new DOMException("Docker profile reservation aborted", "AbortError");
      await new Promise<void>((resolve, reject) => {
        let abort: (() => void) | undefined;
        const timer = setTimeout(() => {
          if (abort !== undefined) signal?.removeEventListener("abort", abort);
          resolve();
        }, 100);
        if (signal === undefined) return;
        abort = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", abort!);
          reject(signal.reason ?? new DOMException("Docker profile reservation aborted", "AbortError"));
        };
        signal.addEventListener("abort", abort, { once: true });
      });
      reservation = await dockerProfileControlRequest<DockerProfileReservation>(lease.binding.controlSocketPath, {
        kind: "reservation.get", invocationId: lease.invocationId, leaseToken: lease.leaseToken, reservationId,
      }, signal);
      if (signal?.aborted) throw signal.reason ?? new DOMException("Docker profile reservation aborted", "AbortError");
    }
    if (reservation.state !== "granted") {
      if (reservation.state === "blocked" && doctorDeadline !== undefined) {
        throw new DockerProfileCapacityBlockedError("doctor-timeout");
      }
      throw nonGrantedReservationError(reservation);
    }
  } catch (error) {
    if (reservation !== undefined) {
      try {
        await relinquishDockerProfileReservation(lease, reservationId, reservation);
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          `Docker profile reservation ${reservationId} acquisition and disposal both failed`,
        );
      }
    }
    throw error;
  }
  return reservation;
}

function profileControlEffect<T>(
  lease: DockerProfileLease,
  request: Readonly<Record<string, unknown>>,
  signal?: AbortSignal,
): Effect.Effect<T, Error> {
  return Effect.tryPromise({
    try: (runtimeSignal) => dockerProfileControlRequest<T>(
      lease.binding.controlSocketPath,
      request,
      signal === undefined ? runtimeSignal : AbortSignal.any([signal, runtimeSignal]),
    ),
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });
}

function profileQueueDelay(milliseconds: number, signal?: AbortSignal): Effect.Effect<void, Error> {
  return Effect.tryPromise({
    try: (runtimeSignal) => {
      const combined = signal === undefined ? runtimeSignal : AbortSignal.any([signal, runtimeSignal]);
      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          combined.removeEventListener("abort", abort);
          resolve();
        }, milliseconds);
        const abort = () => {
          clearTimeout(timer);
          combined.removeEventListener("abort", abort);
          reject(combined.reason instanceof Error
            ? combined.reason
            : new DOMException("Docker profile reservation aborted", "AbortError"));
        };
        if (combined.aborted) abort();
        else combined.addEventListener("abort", abort, { once: true });
      });
    },
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });
}

function makeDockerProfileReservationOwner(
  lease: DockerProfileLease,
  reservationId: string,
  initial: DockerProfileReservation,
): MutableDockerProfileReservationOwner {
  let current = initial;
  let released = false;
  let releaseInFlight: Promise<void> | undefined;
  return {
    get reservation() { return current; },
    update(next) { current = next; },
    async release() {
      if (released) return;
      if (releaseInFlight !== undefined) return await releaseInFlight;
      const releasing = relinquishDockerProfileReservation(lease, reservationId, current).then(() => {
        released = true;
      });
      releaseInFlight = releasing;
      try {
        await releasing;
      } finally {
        if (!released && releaseInFlight === releasing) releaseInFlight = undefined;
      }
    },
  };
}

function releaseReservationOwner(
  owner: DockerProfileReservationOwner,
): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => owner.release(),
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  }).pipe(Effect.orDie);
}

/**
 * Effect-native reservation acquisition used by the Sandbox runtime. A queued
 * reservation is still owned by the control service, while runner permits are
 * explicitly released before polling. A successful grant may interruptibly
 * reacquire them; cancellation during polling or reacquisition falls through
 * to the semaphore owners' own finalizers and the reservation Scope finalizer.
 */
export function acquireDockerProfileReservationEffect(
  lease: DockerProfileLease,
  reservationKind: "container" | "build",
  resources: Readonly<Record<string, number>>,
  admission: DockerProfileReservationAdmission,
  signal?: AbortSignal,
): Effect.Effect<DockerProfileReservationOwner, Error, Scope.Scope> {
  const reservationId = randomUUID();
  const request = <T>(frame: Readonly<Record<string, unknown>>, requestSignal = signal) =>
    profileControlEffect<T>(lease, frame, requestSignal);

  return Effect.gen(function* () {
    // Effect 3.22.1 acquireRelease runs acquire and finalizer registration in
    // one uninterruptible region. Once acquire returns the first reservation
    // object, every later poll/grant/reacquire interruption is Scope-owned.
    const owner = yield* Effect.acquireRelease(
      request<DockerProfileReservation>({
        kind: "reservation.acquire",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
        reservationKind,
        resources,
      }).pipe(Effect.map((initial) => makeDockerProfileReservationOwner(lease, reservationId, initial))),
      (owned) => releaseReservationOwner(owned),
    );

    if (owner.reservation.state !== "granted") yield* admission.queued;
    if (owner.reservation.state === "queued") {
      const awaitGrant = Effect.gen(function* () {
        while (owner.reservation.state === "queued") {
          yield* profileQueueDelay(100, signal);
          owner.update(yield* request<DockerProfileReservation>({
            kind: "reservation.get",
            invocationId: lease.invocationId,
            leaseToken: lease.leaseToken,
            reservationId,
          }));
        }
        return owner;
      });
      if (admission.slot === undefined) {
        yield* awaitGrant;
      } else {
        const slot = admission.slot;
        // Release queue-held permits explicitly. Effect.acquireRelease masks
        // its acquisition in v4, so reopen interruption only for this wait:
        // the reservation owner is already Scope-owned and can be released
        // before provider materialization ever reaches container.create.
        yield* Effect.uninterruptible(slot.release);
        const granted = yield* awaitGrant;
        if (granted.reservation.state !== "granted") {
          return yield* Effect.fail(nonGrantedReservationError(granted.reservation));
        }
        yield* Effect.interruptible(slot.reacquire);
      }
    }
    if (owner.reservation.state !== "granted") {
      return yield* Effect.fail(nonGrantedReservationError(owner.reservation));
    }
    yield* admission.granted;
    return owner;
  });
}

async function writeControlFrame(socket: import("node:net").Socket, bytes: Buffer): Promise<void> {
  if (socket.write(bytes)) return;
  await once(socket, "drain");
}

function controlBuildRequest<T>(
  path: string,
  request: Readonly<Record<string, unknown>>,
  context: Readable,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = connect(path);
    let response = "";
    let settled = false;
    const settle = (outcome: { value: T } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", abort);
      if ("value" in outcome) resolve(outcome.value);
      else {
        context.destroy(outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error)));
        reject(outcome.error);
      }
    };
    const abort = () => socket.destroy(
      signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("Docker profile build aborted", "AbortError"),
    );
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
    socket.setTimeout(15 * 60_000);
    socket.on("connect", () => {
      void (async () => {
        await writeControlFrame(socket, Buffer.from(`${JSON.stringify(request)}\n`));
        for await (const value of context) {
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          if (chunk.length === 0) continue;
          const length = Buffer.allocUnsafe(4);
          length.writeUInt32BE(chunk.length);
          await writeControlFrame(socket, length);
          await writeControlFrame(socket, chunk);
        }
        const end = Buffer.alloc(4);
        socket.end(end);
      })().catch((error: unknown) => socket.destroy(error instanceof Error ? error : new Error(String(error))));
    });
    socket.on("data", (chunk: Buffer) => { response += chunk.toString(); });
    socket.on("timeout", () => socket.destroy(new Error(`Docker profile build control timeout: ${path}`)));
    socket.on("error", (error) => settle({ error }));
    socket.on("close", () => {
      if (settled) return;
      try {
        const parsed = JSON.parse(response) as { ok?: boolean; result?: T; error?: { code?: string; message?: string } };
        if (parsed.ok !== true || parsed.result === undefined) {
          settle({ error: new Error(`${parsed.error?.code ?? "control-error"}: ${parsed.error?.message ?? "invalid control reply"}`) });
        } else settle({ value: parsed.result });
      } catch (error) {
        settle({ error });
      }
    });
  });
}

export async function createDockerProfileContainer(
  lease: DockerProfileLease,
  reservationId: string,
  request: DockerProfileContainerCreateInput | DockerProfileContainerIntent,
  signal?: AbortSignal,
): Promise<DockerProfileContainerCreateResult> {
  const create = "intent" in request ? request : { intent: "workload" as const, create: request };
  try {
    return await dockerProfileControlRequest<DockerProfileContainerCreateResult>(lease.binding.controlSocketPath, {
      kind: "container.create",
      invocationId: lease.invocationId,
      leaseToken: lease.leaseToken,
      reservationId,
      create,
    }, signal);
  } catch (error) {
    // A lost reply can leave the journal committed. Recover the control-owned IDs instead of
    // issuing a second create or asking DockerSandbox's legacy reconciler to remove them.
    const reservation = await dockerProfileControlRequest<DockerProfileReservation>(lease.binding.controlSocketPath, {
      kind: "reservation.get",
      invocationId: lease.invocationId,
      leaseToken: lease.leaseToken,
      reservationId,
    }, signal).catch(() => undefined);
    if (
      reservation?.state === "committed" &&
      reservation.containerId !== undefined &&
      reservation.networkId !== undefined
    ) {
      return { containerId: reservation.containerId, networkId: reservation.networkId, state: "active" };
    }
    throw error;
  }
}

export async function createDockerProfileBuild(
  lease: DockerProfileLease,
  reservationId: string,
  build: DockerProfileBuildCreateInput,
  context: Readable,
  signal?: AbortSignal,
): Promise<DockerProfileBuildCreateResult> {
  const cancelBuild = async () => {
    await dockerProfileControlRequest(lease.binding.controlSocketPath, {
      kind: "build.cancel",
      invocationId: lease.invocationId,
      leaseToken: lease.leaseToken,
      reservationId,
    }).catch(() => undefined);
  };
  try {
    return await controlBuildRequest<DockerProfileBuildCreateResult>(lease.binding.controlSocketPath, {
      kind: "build.create",
      invocationId: lease.invocationId,
      leaseToken: lease.leaseToken,
      reservationId,
      build,
      contextEncoding: "tar-chunked/v1",
    }, context, signal);
  } catch (error) {
    // The operation survives a client-side reply loss. Its durable reservation is
    // the recovery handle; never retry a build under a second provision token.
    if (signal?.aborted) {
      await cancelBuild();
      throw error;
    }
    for (let attempt = 0; attempt < 300; attempt += 1) {
      if (signal?.aborted) {
        await cancelBuild();
        throw error;
      }
      const reservation = await dockerProfileControlRequest<DockerProfileReservation>(lease.binding.controlSocketPath, {
        kind: "reservation.get",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
      }, signal).catch(() => undefined);
      if (signal?.aborted) {
        await cancelBuild();
        throw error;
      }
      if (reservation?.state === "committed" && reservation.buildTerminated === true) {
        if (reservation.buildError === undefined && !signal?.aborted && reservation.locator !== undefined) {
          return { locator: reservation.locator, state: "terminated" };
        }
        break;
      }
      if (reservation?.state === "quarantined") break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw error;
  }
}

export async function releaseDockerProfileReservation(
  lease: DockerProfileLease,
  reservationId: string,
  proof?: Pick<DockerProfileReservation, "slotId">,
): Promise<DockerProfileReleaseReceipt> {
  const release = async (): Promise<DockerProfileReleaseReceipt> => validateReleaseReceipt(
    await dockerProfileControlRequest<unknown>(lease.binding.controlSocketPath, {
      kind: "reservation.release", invocationId: lease.invocationId, leaseToken: lease.leaseToken,
      reservationId,
    }),
  );
  try {
    return await release();
  } catch (primary) {
    // A reply can be lost after the durable release.  Treat that as success
    // only after the same profile generation confirms every owned handle is
    // absent and no reservation-specific recovery uncertainty remains.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      // Setup-prefix copy work can outlive a cancelled client socket. The host
      // rejects release while that journaled operation is active; retry until
      // it publishes/rolls back, then perform the same verified scrub release.
      const retried = await release().catch(() => undefined);
      if (retried !== undefined) return retried;
      const status = await dockerProfileControlRequest<unknown>(
        lease.binding.controlSocketPath,
        { kind: "status" },
      ).then(validateCleanupStatusReceipt).catch(() => undefined);
      if (status?.profileId === lease.binding.profile.profileId && status.generation === lease.binding.daemonGeneration) {
        const reservationAbsent = !status.reservations.some((item) => item.reservationId === reservationId);
        const queueAbsent = !status.queue.some((item) => item.reservationId === reservationId);
        const leaseIdentitySafe = !status.leases.some((item) => item.invocationId === lease.invocationId) ||
          status.leases.some((item) =>
            item.invocationId === lease.invocationId && item.daemonGeneration === lease.binding.daemonGeneration
          );
        const slot = proof?.slotId === undefined ? undefined : status.slots.find((item) => item.slotId === proof.slotId);
        const slotFree = proof?.slotId === undefined || (slot?.state === "free" && slot.reservationId === undefined);
        const uncertain = status.degraded.some((item) => item.includes(reservationId));
        if (reservationAbsent && queueAbsent && leaseIdentitySafe && slotFree && !uncertain) {
          return { released: true, cleanupProven: true };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw primary;
  }
}

async function cancelDockerProfileReservation(
  lease: DockerProfileLease,
  reservationId: string,
): Promise<void> {
  try {
    validateCancelReceipt(await dockerProfileControlRequest<unknown>(lease.binding.controlSocketPath, {
      kind: "reservation.cancel",
      invocationId: lease.invocationId,
      leaseToken: lease.leaseToken,
      reservationId,
    }));
  } catch (primary) {
    // A successful cancellation can outlive a lost client reply. Accept that
    // only when the attested generation proves every reservation handle gone.
    const status = await dockerProfileControlRequest<unknown>(
      lease.binding.controlSocketPath,
      { kind: "status" },
    ).then(validateCleanupStatusReceipt).catch(() => undefined);
    const absent = status?.profileId === lease.binding.profile.profileId &&
      status.generation === lease.binding.daemonGeneration &&
      !status.reservations.some((item) => item.reservationId === reservationId) &&
      !status.queue.some((item) => item.reservationId === reservationId) &&
      !status.slots.some((item) => item.reservationId === reservationId) &&
      !status.degraded.some((item) => item.includes(reservationId));
    if (absent) return;
    throw primary;
  }
}

async function relinquishDockerProfileReservation(
  lease: DockerProfileLease,
  reservationId: string,
  reservation: DockerProfileReservation,
): Promise<void> {
  if (reservation.state !== "queued" && reservation.state !== "blocked") {
    await releaseDockerProfileReservation(lease, reservationId, reservation);
    return;
  }
  try {
    await cancelDockerProfileReservation(lease, reservationId);
    return;
  } catch (cancelError) {
    // Capacity may become available between the last poll and cancellation.
    // Once granted, the reservation owns provider capacity and must use the
    // release path instead of pretending the failed cancel disposed it.
    let current: DockerProfileReservation;
    try {
      current = await dockerProfileControlRequest<DockerProfileReservation>(lease.binding.controlSocketPath, {
        kind: "reservation.get",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
      });
    } catch (refreshError) {
      throw new AggregateError(
        [cancelError, refreshError],
        `Docker profile reservation ${reservationId} cancellation state could not be reconciled`,
      );
    }
    if (current.state === "queued" || current.state === "blocked") throw cancelError;
    try {
      await releaseDockerProfileReservation(lease, reservationId, current);
    } catch (releaseError) {
      throw new AggregateError(
        [cancelError, releaseError],
        `Docker profile reservation ${reservationId} raced from cancellation to release and both failed`,
      );
    }
  }
}
