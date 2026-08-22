import { randomUUID } from "node:crypto";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import { connect } from "node:net";
import { dirname, join, parse } from "node:path";
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
  readonly state: "queued" | "granted" | "committed" | "releasing";
  readonly containerId?: string;
  readonly networkId?: string;
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

export interface DockerProfileContainerCreateResult {
  readonly containerId: string;
  readonly networkId: string;
  readonly state: "active";
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
    name.endsWith(".json") && !name.endsWith(".host.json") && !name.endsWith(".daemon.json")
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

function controlRequest<T>(path: string, request: Readonly<Record<string, unknown>>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const socket = connect(path);
    let response = "";
    socket.setTimeout(10_000);
    socket.on("connect", () => socket.end(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: Buffer) => { response += chunk.toString(); });
    socket.on("timeout", () => socket.destroy(new Error(`Docker profile control timeout: ${path}`)));
    socket.on("error", reject);
    socket.on("close", () => {
      try {
        const parsed = JSON.parse(response) as { ok?: boolean; result?: T; error?: { code?: string; message?: string } };
        if (parsed.ok !== true || parsed.result === undefined) {
          reject(new Error(`${parsed.error?.code ?? "control-error"}: ${parsed.error?.message ?? "invalid control reply"}`));
        } else resolve(parsed.result);
      } catch (error) {
        reject(error);
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
  const challenge = await controlRequest<{
    readonly protocol: string;
    readonly profileId: string;
    readonly descriptorDigest: string;
    readonly hostMachineIdentity: string;
    readonly backendMachineIdentity: string;
    readonly daemonGeneration: string;
    readonly clientNonce: string;
    readonly admissionOpen: boolean;
  }>(profile.transport.controlSocket.path, { kind: "challenge", clientNonce: nonce });
  if (challenge.protocol !== profile.transport.controlSocket.protocol || challenge.profileId !== profile.profileId ||
      challenge.descriptorDigest !== entry.descriptorDigest || challenge.clientNonce !== nonce || challenge.admissionOpen !== true ||
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
  const created = await controlRequest<{ readonly leaseToken: string }>(binding.controlSocketPath, {
    kind: "lease.create",
    profileId: binding.profile.profileId,
    daemonGeneration: binding.daemonGeneration,
    invocationId,
  });
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const heartbeat = async () => {
    if (stopped) return;
    await controlRequest(binding.controlSocketPath, {
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
      stopped = true;
      if (timer !== undefined) clearInterval(timer);
      await controlRequest(binding.controlSocketPath, {
        kind: "lease.drain", invocationId, leaseToken: created.leaseToken,
      });
    },
  };
}

export async function acquireDockerProfileReservation(
  lease: DockerProfileLease,
  reservationKind: "container" | "build",
  resources: Readonly<Record<string, number>>,
  signal?: AbortSignal,
): Promise<DockerProfileReservation> {
  const reservationId = randomUUID();
  let reservation = await controlRequest<DockerProfileReservation>(lease.binding.controlSocketPath, {
    kind: "reservation.acquire", invocationId: lease.invocationId, leaseToken: lease.leaseToken,
    reservationId, reservationKind, resources,
  });
  try {
    while (reservation.state === "queued") {
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
      reservation = await controlRequest<DockerProfileReservation>(lease.binding.controlSocketPath, {
        kind: "reservation.get", invocationId: lease.invocationId, leaseToken: lease.leaseToken, reservationId,
      });
      if (signal?.aborted) throw signal.reason ?? new DOMException("Docker profile reservation aborted", "AbortError");
    }
  } catch (error) {
    if (signal?.aborted) {
      await controlRequest(lease.binding.controlSocketPath, {
        kind: reservation.state === "queued" ? "reservation.cancel" : "reservation.release",
        invocationId: lease.invocationId,
        leaseToken: lease.leaseToken,
        reservationId,
      }).catch(() => undefined);
    }
    throw error;
  }
  return reservation;
}

export async function commitDockerProfileReservation(
  lease: DockerProfileLease,
  reservationId: string,
  input: { readonly containerId?: string; readonly networkId?: string; readonly attemptId?: string },
): Promise<void> {
  await controlRequest(lease.binding.controlSocketPath, {
    kind: "reservation.commit", invocationId: lease.invocationId, leaseToken: lease.leaseToken,
    reservationId, ...input,
  });
}

export async function createDockerProfileContainer(
  lease: DockerProfileLease,
  reservationId: string,
  create: DockerProfileContainerCreateInput,
): Promise<DockerProfileContainerCreateResult> {
  try {
    return await controlRequest<DockerProfileContainerCreateResult>(lease.binding.controlSocketPath, {
      kind: "container.create",
      invocationId: lease.invocationId,
      leaseToken: lease.leaseToken,
      reservationId,
      create,
    });
  } catch (error) {
    // A lost reply can leave the journal committed. Recover the control-owned IDs instead of
    // issuing a second create or asking DockerSandbox's legacy reconciler to remove them.
    const reservation = await controlRequest<DockerProfileReservation>(lease.binding.controlSocketPath, {
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

export async function releaseDockerProfileReservation(
  lease: DockerProfileLease,
  reservationId: string,
  terminationEvidence?: Readonly<Record<string, boolean>>,
): Promise<void> {
  await controlRequest(lease.binding.controlSocketPath, {
    kind: "reservation.release", invocationId: lease.invocationId, leaseToken: lease.leaseToken,
    reservationId, ...(terminationEvidence === undefined ? {} : { terminationEvidence }),
  });
}
