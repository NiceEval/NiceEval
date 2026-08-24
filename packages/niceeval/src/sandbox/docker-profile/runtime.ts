import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join, parse } from "node:path";
import type { Readable } from "node:stream";
import { Effect, type Scope } from "effect";
import { indexDockerProfiles, resolveDockerProfile, type ResolvedDockerProfileEntry } from "./registry.ts";
import type { DockerExecutionProfileV1 } from "./schema.ts";

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
 * releasing or leaving a grant-to-install ownership gap.
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
    socket.setTimeout(10_000);
    socket.on("connect", () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: Buffer) => { response += chunk.toString(); });
    socket.on("timeout", () => socket.destroy(new Error(`Docker profile control timeout: ${path}`)));
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
      const draining = dockerProfileControlRequest(binding.controlSocketPath, {
        kind: "lease.drain", invocationId, leaseToken: created.leaseToken,
      }).then(() => {
        stopped = true;
      });
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
    if (reservation.state !== "granted") throw nonGrantedReservationError(reservation);
  } catch (error) {
    if (reservation !== undefined) {
      try {
        await releaseDockerProfileReservation(lease, reservationId, reservation);
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          `Docker profile reservation ${reservationId} acquisition and release both failed`,
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
      const releasing = releaseDockerProfileReservation(lease, reservationId, current).then(() => {
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
        // Release queue-held permits explicitly; reacquisition is interruptible
        // and never hidden in a finalizer that could over-release.
        yield* Effect.uninterruptible(slot.release);
        const granted = yield* awaitGrant;
        if (granted.reservation.state !== "granted") {
          return yield* Effect.fail(nonGrantedReservationError(granted.reservation));
        }
        yield* slot.reacquire;
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
): Promise<DockerProfileContainerCreateResult> {
  const create = "intent" in request ? request : { intent: "workload" as const, create: request };
  try {
    return await dockerProfileControlRequest<DockerProfileContainerCreateResult>(lease.binding.controlSocketPath, {
      kind: "container.create",
      invocationId: lease.invocationId,
      leaseToken: lease.leaseToken,
      reservationId,
      create,
    });
  } catch (error) {
    // A lost reply can leave the journal committed. Recover the control-owned IDs instead of
    // issuing a second create or asking DockerSandbox's legacy reconciler to remove them.
    const reservation = await dockerProfileControlRequest<DockerProfileReservation>(lease.binding.controlSocketPath, {
      kind: "reservation.get",
      invocationId: lease.invocationId,
      leaseToken: lease.leaseToken,
      reservationId,
    }).catch(() => undefined);
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
): Promise<{ readonly cleanupProven?: boolean }> {
  try {
    return await dockerProfileControlRequest(lease.binding.controlSocketPath, {
      kind: "reservation.release", invocationId: lease.invocationId, leaseToken: lease.leaseToken,
      reservationId,
    });
  } catch (primary) {
    // A reply can be lost after the durable release.  Treat that as success
    // only after the same profile generation confirms every owned handle is
    // absent and no reservation-specific recovery uncertainty remains.
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const status = await dockerProfileControlRequest<{
        readonly profileId?: string;
        readonly generation?: string;
        readonly leases?: readonly { readonly invocationId?: string; readonly daemonGeneration?: string }[];
        readonly reservations?: readonly { readonly reservationId?: string; readonly invocationId?: string }[];
        readonly slots?: readonly { readonly slotId?: string; readonly reservationId?: string; readonly state?: string }[];
        readonly degraded?: readonly string[];
      }>(lease.binding.controlSocketPath, { kind: "status" }).catch(() => undefined);
      if (status?.profileId === lease.binding.profile.profileId && status.generation === lease.binding.daemonGeneration) {
        const reservationAbsent = !(status.reservations ?? []).some((item) => item.reservationId === reservationId);
        const sameLease = (status.leases ?? []).some((item) => item.invocationId === lease.invocationId && item.daemonGeneration === lease.binding.daemonGeneration);
        const slot = proof?.slotId === undefined ? undefined : (status.slots ?? []).find((item) => item.slotId === proof.slotId);
        const slotFree = proof?.slotId === undefined || (slot?.state === "free" && slot.reservationId === undefined);
        const uncertain = (status.degraded ?? []).some((item) => item.includes(reservationId));
        if (reservationAbsent && sameLease && slotFree && !uncertain) return { cleanupProven: true };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw primary;
  }
}
