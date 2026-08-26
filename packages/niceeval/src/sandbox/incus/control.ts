import { Either, Schema } from "effect";
import { Effect } from "effect";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { classifyProvisionErrorFallback, type SandboxProvisionErrorKind } from "../errors.ts";
import { DEVELOPMENT_HOST_PATH } from "./descriptor.ts";
import { incusError, type IncusProviderError } from "./errors.ts";
import type { IncusImageLocator } from "./image.ts";
import {
  INCUS_GUEST_INIT_BLOCK_DOCKER_DATA,
  INCUS_IMAGE_GUEST_INIT_PROPERTY,
  parseIncusImageLocator,
} from "./image.ts";

const QUERY_TIMEOUT_MS = 15_000;
const MUTATION_TIMEOUT_MS = 120_000;
const ParseOptions = Object.freeze({
  errors: "all" as const,
  exact: true,
  onExcessProperty: "error" as const,
});

export const INCUS_METADATA = Object.freeze({
  allocationId: "user.niceeval.allocationId",
  executionId: "user.niceeval.executionId",
  generation: "user.niceeval.generation",
  artifactDigest: "user.niceeval.artifactDigest",
  executionDomainId: "user.niceeval.executionDomainId",
  provisionToken: "user.niceeval.provisionToken",
  host: "user.niceeval.host",
  pid: "user.niceeval.pid",
  startedAt: "user.niceeval.startedAt",
  artifactState: "user.niceeval.artifactState",
  setupPrefixKey: "user.niceeval.setupPrefixKey",
  manifestDigest: "user.niceeval.manifestDigest",
  runtimeProject: "user.niceeval.runtimeProject",
  pool: "user.niceeval.pool",
  baseFingerprint: "user.niceeval.baseFingerprint",
  captureRevision: "user.niceeval.captureRevision",
});

export interface IncusImage {
  readonly fingerprint: string;
  readonly aliases: readonly string[];
  readonly type: string;
  readonly properties: Readonly<Record<string, string>>;
}

export interface IncusInstance {
  readonly name: string;
  readonly status: string;
  readonly type: string;
  readonly config: Readonly<Record<string, string>>;
  readonly expandedDevices?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

export interface IncusExecResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface IncusInstanceSpec {
  readonly name: string;
  readonly project: string;
  readonly fingerprint: string;
  readonly storagePool: string;
  readonly network: string;
  readonly config: Readonly<Record<string, string>>;
  readonly dockerDataVolume: string;
  readonly dockerDataContentType: "block" | "filesystem";
  readonly dockerDataPath?: string;
}

export interface IncusVolume {
  readonly name: string;
  readonly type: string;
  readonly contentType: string;
  readonly config: Readonly<Record<string, string>>;
}

export interface IncusVolumeSpec {
  readonly project: string;
  readonly pool: string;
  readonly name: string;
  readonly contentType: "block" | "filesystem";
  readonly sizeBytes: number;
  readonly config: Readonly<Record<string, string>>;
}

export interface IncusStorageAttestation {
  readonly name: string;
  readonly driver: string;
  readonly source: string;
  readonly backingDevice: string;
}

export interface SpawnedIncusExec {
  readonly stdin: NodeJS.WritableStream;
  readonly stdout: NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream;
  readonly pid: number | undefined;
  wait(): Promise<number>;
  killHost(): void;
}

type Transport =
  | { readonly _tag: "Cli"; readonly binary: string }
  | { readonly _tag: "UnixRead"; readonly socketPath: string };

const EnvelopeSchema = Schema.Struct({
  type: Schema.Literal("sync", "error", "async"),
  status: Schema.optional(Schema.String),
  status_code: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
  error_code: Schema.optional(Schema.Number),
  metadata: Schema.optional(Schema.Unknown),
  operation: Schema.optional(Schema.String),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string") out[key] = child;
  }
  return out;
}

function commandErrorCode(cause: unknown): string | undefined {
  if (cause === null || typeof cause !== "object" || !("code" in cause)) return undefined;
  const code = (cause as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function sanitizeSpawnError(cause: unknown): IncusProviderError {
  const code = commandErrorCode(cause);
  if (code === "ENOENT") return unreachable("The incus CLI is not installed or not on PATH.");
  const message = cause instanceof Error ? cause.message : String(cause);
  return unreachable(`Failed to spawn incus: ${message}`);
}

function unreachable(summary: string, cause?: unknown): IncusProviderError {
  return incusError(
    "incus-unreachable",
    summary,
    [
      "Install and start the Incus daemon, and make the incus CLI available on PATH.",
      "NiceEval talks only to the Incus control API or CLI; it will not sudo, pull images, or fall back to Docker.",
    ],
    cause,
  );
}

function shapeError(path: string, cause?: unknown): IncusProviderError {
  return incusError(
    "incus-unreachable",
    `Incus ${path} returned an unexpected JSON shape.`,
    ["Inspect `incus query` output; NiceEval fail-closes on unknown control-plane envelopes."],
    cause,
  );
}

function decodeEnvelope(parsed: unknown, path: string): Schema.Schema.Type<typeof EnvelopeSchema> {
  const decoded = Schema.decodeUnknownEither(EnvelopeSchema, ParseOptions)(parsed);
  if (Either.isLeft(decoded)) throw shapeError(path, decoded.left);
  return decoded.right;
}

function decodeCliOutput(stdout: string, stderr: string, exitCode: number, path: string): unknown {
  const text = stdout.trim() === "" ? stderr.trim() : stdout.trim();
  if (text === "") {
    if (exitCode === 0) return null;
    throw unreachable(`Incus ${path} produced empty output (exit ${exitCode}).`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw shapeError(path, cause);
  }
  const envelope = decodeEnvelope(parsed, path);
  if (envelope.type === "error") {
    if (envelope.error_code === 404) return { _tag: "Absent" as const };
    throw unreachable(
      `Incus ${path} failed${envelope.error === undefined ? "" : `: ${envelope.error}`}.`,
      parsed,
    );
  }
  if (envelope.type === "async") {
    throw unreachable(
      `Incus ${path} returned an unfinished async operation; mutations must wait for completion.`,
      parsed,
    );
  }
  return envelope.metadata ?? null;
}

async function runCli(
  binary: string,
  args: readonly string[],
  options: {
    readonly timeoutMs: number;
    readonly stdin?: Uint8Array;
    readonly encoding: "utf8" | "buffer";
    readonly env?: NodeJS.ProcessEnv;
  },
): Promise<{ readonly stdout: Buffer; readonly stderr: Buffer; readonly exitCode: number }> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(binary, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: options.env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const finish = (error: unknown | undefined, result?: { stdout: Buffer; stderr: Buffer; exitCode: number }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error !== undefined) reject(error);
      else if (result !== undefined) resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(unreachable("Incus CLI timed out."));
    }, options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (cause) => {
      finish(sanitizeSpawnError(cause));
    });
    child.on("close", (code) => {
      finish(undefined, {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode: code ?? 1,
      });
    });
    child.stdin.on("error", () => undefined);
    if (options.stdin !== undefined) child.stdin.end(Buffer.from(options.stdin));
    else child.stdin.end();
  });
}

async function unixGet(socketPath: string, path: string, timeoutMs = QUERY_TIMEOUT_MS): Promise<unknown> {
  return await new Promise((resolve, reject) => {
    const req = httpRequest({
      socketPath,
      path,
      method: "GET",
      headers: { Host: "incus", Accept: "application/json" },
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode === 404) {
          resolve({ _tag: "Absent" });
          return;
        }
        let parsed: unknown;
        try {
          parsed = text.trim() === "" ? null : JSON.parse(text);
        } catch (cause) {
          reject(shapeError(`GET ${path}`, cause));
          return;
        }
        try {
          const envelope = decodeEnvelope(parsed, `GET ${path}`);
          if (envelope.type === "error") {
            if (envelope.error_code === 404) {
              resolve({ _tag: "Absent" });
              return;
            }
            reject(unreachable(`Incus GET ${path} failed${envelope.error === undefined ? "" : `: ${envelope.error}`}.`));
            return;
          }
          if (envelope.type !== "sync") {
            reject(shapeError(`GET ${path}`));
            return;
          }
          resolve(envelope.metadata ?? null);
        } catch (cause) {
          reject(cause);
        }
      });
    });
    const timer = setTimeout(() => {
      req.destroy();
      reject(unreachable(`Incus control socket timed out for GET ${path}.`));
    }, timeoutMs);
    req.on("error", (cause) => {
      clearTimeout(timer);
      const code = commandErrorCode(cause);
      reject(code === "ENOENT" || code === "ECONNREFUSED" || code === "ENOTSOCK"
        ? unreachable(`Incus control socket ${JSON.stringify(socketPath)} is unreachable.`, cause)
        : unreachable(`Incus control socket failed: ${cause.message}`, cause));
    });
    req.on("close", () => clearTimeout(timer));
    req.end();
  });
}

function candidateSockets(env: NodeJS.ProcessEnv): readonly string[] {
  const sockets: string[] = [];
  const explicit = env.INCUS_SOCKET?.trim();
  if (explicit) sockets.push(explicit);
  const dir = env.INCUS_DIR?.trim();
  if (dir && !dir.startsWith("/var/lib/incus")) sockets.push(join(dir, "unix.socket"));
  sockets.push("/run/incus/unix.socket");
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (uid !== undefined) sockets.push(`/run/user/${uid}/incus/unix.socket`);
  sockets.push(join(homedir(), ".config/incus/unix.socket"));
  return Object.freeze([...new Set(sockets)]);
}

async function probeCli(): Promise<Transport | undefined> {
  try {
    const result = await runCli("incus", ["query", "--raw", "-X", "GET", "/1.0"], {
      timeoutMs: QUERY_TIMEOUT_MS,
      encoding: "utf8",
    });
    decodeCliOutput(result.stdout.toString("utf8"), result.stderr.toString("utf8"), result.exitCode, "GET /1.0");
    return { _tag: "Cli", binary: "incus" };
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && (cause as IncusProviderError).code === "incus-unreachable"
      && commandErrorCode((cause as IncusProviderError).cause) === "ENOENT") {
      return undefined;
    }
    throw cause;
  }
}

async function probeUnix(env: NodeJS.ProcessEnv): Promise<Transport | undefined> {
  for (const socketPath of candidateSockets(env)) {
    try {
      const metadata = await unixGet(socketPath, "/1.0");
      if (isRecord(metadata) && metadata._tag === "Absent") continue;
      return { _tag: "UnixRead", socketPath };
    } catch {
      continue;
    }
  }
  return undefined;
}

function isAbsent(value: unknown): boolean {
  return isRecord(value) && value._tag === "Absent";
}

const REFERENCE_DRIVERS = new Set(["zfs", "btrfs", "lvm", "lvmcluster"]);

export class IncusControl {
  private constructor(private readonly transport: Transport) {}

  static async connectReadOnly(env: NodeJS.ProcessEnv = process.env): Promise<IncusControl> {
    const cli = await probeCli();
    if (cli !== undefined) return new IncusControl(cli);
    const unix = await probeUnix(env);
    if (unix !== undefined) return new IncusControl(unix);
    throw unreachable("Incus control plane is unreachable: no incus CLI and no usable control socket.");
  }

  static async connectMutation(env: NodeJS.ProcessEnv = process.env): Promise<IncusControl> {
    const cli = await probeCli();
    if (cli !== undefined) return new IncusControl(cli);
    throw unreachable("Incus mutations require the incus CLI; Unix-socket mutation and exec are disabled.");
  }

  get mode(): "cli" | "unix-read" {
    return this.transport._tag === "Cli" ? "cli" : "unix-read";
  }

  requireCli(operation: string): asserts this is this {
    if (this.transport._tag !== "Cli") {
      throw unreachable(`${operation} requires the incus CLI; Unix-socket mutation and exec are disabled.`);
    }
  }

  private projectPath(path: string, project: string): string {
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}project=${encodeURIComponent(project)}`;
  }

  private async get(path: string): Promise<unknown> {
    if (this.transport._tag === "UnixRead") return unixGet(this.transport.socketPath, path);
    const result = await runCli(this.transport.binary, ["query", "--raw", "-X", "GET", path], {
      timeoutMs: QUERY_TIMEOUT_MS,
      encoding: "utf8",
    });
    return decodeCliOutput(result.stdout.toString("utf8"), result.stderr.toString("utf8"), result.exitCode, `GET ${path}`);
  }

  private async mutate(method: string, path: string, body?: unknown): Promise<unknown> {
    this.requireCli(`Incus ${method} ${path}`);
    if (this.transport._tag !== "Cli") throw unreachable("Incus mutations require the incus CLI.");
    const args = ["query", "--raw", "--wait", "-X", method, path];
    if (body !== undefined) args.push("-d", JSON.stringify(body));
    const result = await runCli(this.transport.binary, args, {
      timeoutMs: MUTATION_TIMEOUT_MS,
      encoding: "utf8",
    });
    return decodeCliOutput(
      result.stdout.toString("utf8"),
      result.stderr.toString("utf8"),
      result.exitCode,
      `${method} ${path}`,
    );
  }

  async projectExists(project: string): Promise<boolean> {
    const metadata = await this.get(`/1.0/projects/${encodeURIComponent(project)}`);
    return !isAbsent(metadata);
  }

  async getStoragePool(project: string, pool: string): Promise<IncusStorageAttestation | undefined> {
    const metadata = await this.get(
      this.projectPath(`/1.0/storage-pools/${encodeURIComponent(pool)}`, project),
    );
    if (isAbsent(metadata)) return undefined;
    if (!isRecord(metadata) || typeof metadata.name !== "string" || typeof metadata.driver !== "string") {
      throw shapeError(`GET storage pool ${pool}`);
    }
    const config = asStringRecord(metadata.config);
    const source = config.source ?? "";
    const backingDevice = config["zfs.pool_name"] ?? config["source"] ?? config["lvm.vg_name"] ?? "";
    return Object.freeze({
      name: metadata.name,
      driver: metadata.driver,
      source,
      backingDevice,
    });
  }

  async attestReferenceStorage(
    project: string,
    pool: string,
    network: string,
    expected: { readonly source: string; readonly backingDevice: string },
  ): Promise<IncusStorageAttestation> {
    const storage = await this.getStoragePool(project, pool);
    if (storage === undefined) {
      throw incusError(
        "incus-undeployed",
        `Incus storage pool ${JSON.stringify(pool)} is not present in project ${JSON.stringify(project)}.`,
        ["Create the reference dedicated-block pool before planning sandboxes."],
      );
    }
    if (!REFERENCE_DRIVERS.has(storage.driver) || storage.driver === "dir") {
      throw incusError(
        "sandbox-artifact-unverified",
        `Reference pool ${JSON.stringify(pool)} is not a dedicated block-backed Incus pool (driver=${storage.driver}).`,
        ["Use ZFS, Btrfs, or LVM for the reference domain; loop-backed or directory pools cannot attest."],
      );
    }
    if (storage.source !== expected.source || storage.backingDevice !== expected.backingDevice || storage.name !== pool) {
      throw incusError(
        "sandbox-artifact-unverified",
        "Live Incus pool source/backingDevice does not match the pinned reference descriptor.",
        ["Do not trust descriptor self-description; pin and attest the exact pool source and backing device."],
      );
    }
    if (/\.img$/u.test(storage.source) || /loop/i.test(storage.source)) {
      throw incusError(
        "sandbox-artifact-unverified",
        `Reference pool ${JSON.stringify(pool)} source is not dedicated-block.`,
        ["Do not present loop-backed files as reference capacity."],
      );
    }
    const net = await this.get(this.projectPath(`/1.0/networks/${encodeURIComponent(network)}`, project));
    if (isAbsent(net) || !isRecord(net) || typeof net.name !== "string") {
      throw incusError(
        "incus-undeployed",
        `Incus network ${JSON.stringify(network)} is not present in project ${JSON.stringify(project)}.`,
        ["Create the descriptor network in Incus before planning sandboxes."],
      );
    }
    return storage;
  }

  async attestDevelopmentStorage(project: string, pool: string): Promise<IncusStorageAttestation> {
    const storage = await this.getStoragePool(project, pool);
    if (storage === undefined) {
      throw incusError(
        "incus-undeployed",
        `Incus development pool ${JSON.stringify(pool)} is not present.`,
        ["Create the development-dir pool at /data/niceeval-sandbox-dev."],
      );
    }
    if (storage.driver !== "dir" || storage.source !== DEVELOPMENT_HOST_PATH) {
      throw incusError(
        "sandbox-artifact-unverified",
        `Development pool must be a dir pool sourced at ${DEVELOPMENT_HOST_PATH}.`,
        ["Point the development storage pool at /data/niceeval-sandbox-dev."],
      );
    }
    return storage;
  }

  async listImages(project: string): Promise<readonly IncusImage[]> {
    const metadata = await this.get(this.projectPath("/1.0/images?recursion=1", project));
    if (metadata === null) return Object.freeze([]);
    if (!Array.isArray(metadata)) throw shapeError("GET /1.0/images");
    return Object.freeze(metadata.flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.fingerprint !== "string") return [];
      if (!/^[a-f0-9]{64}$/u.test(entry.fingerprint)) return [];
      const aliases = Array.isArray(entry.aliases)
        ? entry.aliases.flatMap((alias) => isRecord(alias) && typeof alias.name === "string" ? [alias.name] : [])
        : [];
      return [Object.freeze({
        fingerprint: entry.fingerprint,
        aliases: Object.freeze(aliases),
        type: typeof entry.type === "string" ? entry.type : "container",
        properties: Object.freeze(asStringRecord(entry.properties)),
      })];
    }));
  }

  async resolveTrustedImage(
    project: string,
    image: IncusImageLocator,
    trusted: readonly string[],
  ): Promise<IncusImage> {
    const trustedLocators = trusted.map((entry) => parseIncusImageLocator(entry, "trustedBaseImages"));
    const exact = trustedLocators.find((entry) => entry.locator === image.locator);
    if (exact === undefined || exact.digest !== image.digest || exact.name !== image.name) {
      throw incusError(
        "sandbox-artifact-unverified",
        `Image ${image.locator} is not an exact trustedBaseImages locator.`,
        ["trustedBaseImages must list the same name@sha256:<digest>; a matching digest under another name is rejected."],
      );
    }
    const images = await this.listImages(project);
    const match = images.find((candidate) =>
      candidate.fingerprint === image.digest && candidate.aliases.includes(image.name)
    );
    if (match === undefined) {
      throw incusError(
        "sandbox-artifact-unverified",
        `Trusted image ${image.locator} is not present as that exact alias and digest in project ${JSON.stringify(project)}.`,
        ["Import the trusted image with the Incus deployment; NiceEval will not pull, build, or import images."],
      );
    }
    if (match.type !== "virtual-machine") {
      throw incusError(
        "sandbox-artifact-unverified",
        `Trusted image ${image.locator} is type ${JSON.stringify(match.type)}, not a virtual-machine.`,
        ["Use a digest-pinned Incus virtual-machine image for incusSandbox()."],
      );
    }
    return match;
  }

  async assertGuestInitMountsBlockDockerData(project: string, fingerprint: string): Promise<void> {
    const images = await this.listImages(project);
    const image = images.find((candidate) => candidate.fingerprint === fingerprint);
    if (image === undefined) {
      throw incusError(
        "sandbox-artifact-unverified",
        `Trusted image ${fingerprint} is not present for guest-init attestation.`,
        ["Import the digest-pinned VM image; NiceEval will not pull, build, or import images."],
      );
    }
    if (image.type !== "virtual-machine") {
      throw incusError(
        "sandbox-artifact-unverified",
        `Trusted image ${fingerprint} is type ${JSON.stringify(image.type)}, not a virtual-machine.`,
        ["Reference Docker data uses a block custom volume; only a VM image can receive that disk."],
      );
    }
    if (image.properties[INCUS_IMAGE_GUEST_INIT_PROPERTY] !== INCUS_GUEST_INIT_BLOCK_DOCKER_DATA) {
      throw incusError(
        "sandbox-artifact-unverified",
        `Trusted image ${fingerprint} does not prove guest-init can mount a block Docker data disk.`,
        [
          `Set image property ${INCUS_IMAGE_GUEST_INIT_PROPERTY}=${INCUS_GUEST_INIT_BLOCK_DOCKER_DATA} on the trusted VM image.`,
          "NiceEval will not attach a path/size extra disk (invalid Incus) or assume an unproven guest-init contract.",
        ],
      );
    }
  }

  async listInstances(project: string): Promise<readonly IncusInstance[]> {
    const metadata = await this.get(this.projectPath("/1.0/instances?recursion=1", project));
    if (metadata === null) return Object.freeze([]);
    if (!Array.isArray(metadata)) throw shapeError("GET /1.0/instances");
    return Object.freeze(metadata.flatMap((entry) => this.decodeInstance(entry, "GET /1.0/instances")));
  }

  private decodeInstance(entry: unknown, path: string): IncusInstance[] {
    if (!isRecord(entry) || typeof entry.name !== "string") throw shapeError(path);
    const devices = isRecord(entry.expanded_devices) ? entry.expanded_devices : undefined;
    const expanded = devices === undefined
      ? undefined
      : Object.freeze(Object.fromEntries(
        Object.entries(devices).flatMap(([key, value]) => isRecord(value)
          ? [[key, Object.freeze(asStringRecord(value))] as const]
          : []),
      ));
    return [Object.freeze({
      name: entry.name,
      status: typeof entry.status === "string" ? entry.status : "Unknown",
      type: typeof entry.type === "string" ? entry.type : "container",
      config: Object.freeze(asStringRecord(entry.config)),
      ...(expanded === undefined ? {} : { expandedDevices: expanded }),
    })];
  }

  async getInstance(project: string, name: string): Promise<IncusInstance | undefined> {
    const metadata = await this.get(
      this.projectPath(`/1.0/instances/${encodeURIComponent(name)}`, project),
    );
    if (isAbsent(metadata)) return undefined;
    const decoded = this.decodeInstance(metadata, `GET instance ${name}`);
    return decoded[0];
  }

  async listVolumes(project: string, pool: string): Promise<readonly IncusVolume[]> {
    const metadata = await this.get(
      this.projectPath(`/1.0/storage-pools/${encodeURIComponent(pool)}/volumes/custom?recursion=1`, project),
    );
    if (metadata === null) return Object.freeze([]);
    if (!Array.isArray(metadata)) throw shapeError("GET storage volumes");
    return Object.freeze(metadata.flatMap((entry) => this.decodeVolume(entry, "GET storage volumes"))
      .filter((volume) => volume.type === "custom"));
  }

  async getVolume(project: string, pool: string, name: string): Promise<IncusVolume | undefined> {
    const metadata = await this.get(
      this.projectPath(
        `/1.0/storage-pools/${encodeURIComponent(pool)}/volumes/custom/${encodeURIComponent(name)}`,
        project,
      ),
    );
    if (isAbsent(metadata)) return undefined;
    return this.decodeVolume(metadata, `GET volume ${name}`)[0];
  }

  private decodeVolume(entry: unknown, path: string): IncusVolume[] {
    if (!isRecord(entry) || typeof entry.name !== "string") throw shapeError(path);
    const contentType = typeof entry.content_type === "string"
      ? entry.content_type
      : typeof entry.contentType === "string" ? entry.contentType : "";
    return [Object.freeze({
      name: entry.name,
      type: typeof entry.type === "string" ? entry.type : "custom",
      contentType,
      config: Object.freeze(asStringRecord(entry.config)),
    })];
  }

  async createVolume(spec: IncusVolumeSpec): Promise<void> {
    await this.mutate(
      "POST",
      this.projectPath(`/1.0/storage-pools/${encodeURIComponent(spec.pool)}/volumes/custom`, spec.project),
      {
        name: spec.name,
        type: "custom",
        content_type: spec.contentType,
        config: {
          size: `${spec.sizeBytes}B`,
          ...spec.config,
        },
      },
    );
  }

  async deleteVolume(project: string, pool: string, name: string): Promise<void> {
    const existing = await this.getVolume(project, pool, name);
    if (existing === undefined) return;
    await this.mutate(
      "DELETE",
      this.projectPath(
        `/1.0/storage-pools/${encodeURIComponent(pool)}/volumes/custom/${encodeURIComponent(name)}`,
        project,
      ),
    );
  }

  async waitVolumeAbsent(project: string, pool: string, name: string, timeoutMs = MUTATION_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const volume = await this.getVolume(project, pool, name);
      if (volume === undefined) return;
      if (Date.now() >= deadline) {
        throw incusError(
          "sandbox-destroy-incomplete",
          `Incus volume ${JSON.stringify(name)} in pool ${JSON.stringify(pool)} is still present after delete.`,
          ["Inspect the custom volume with the Incus CLI; NiceEval will not mark the allocation destroyed without an absent receipt."],
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async createInstance(spec: IncusInstanceSpec): Promise<void> {
    if (spec.dockerDataContentType === "block" && spec.dockerDataPath !== undefined) {
      throw incusError(
        "sandbox-artifact-unverified",
        "Block Docker data volumes are attached without a host path; guest-init mounts the dedicated disk.",
        ["Do not set path on a block custom volume disk device."],
      );
    }
    if (spec.dockerDataContentType === "filesystem" && spec.dockerDataPath === undefined) {
      throw incusError(
        "sandbox-artifact-unverified",
        "Filesystem Docker data volumes require path=/var/lib/docker.",
        ["Attach filesystem custom volumes with an explicit guest path."],
      );
    }
    const dockerdata: Record<string, string> = {
      type: "disk",
      pool: spec.storagePool,
      source: spec.dockerDataVolume,
      dependent: "true",
      ...(spec.dockerDataPath === undefined ? {} : { path: spec.dockerDataPath }),
    };
    const devices: Record<string, Record<string, string>> = {
      root: { path: "/", pool: spec.storagePool, type: "disk" },
      eth0: { name: "eth0", nictype: "bridged", parent: spec.network, type: "nic" },
      dockerdata,
    };
    await this.mutate("POST", this.projectPath("/1.0/instances", spec.project), {
      name: spec.name,
      type: "virtual-machine",
      source: { type: "image", fingerprint: spec.fingerprint },
      config: spec.config,
      devices,
    });
  }

  /** Copy is intentionally explicit about both projects: artifacts never live in runtime. */
  async copyVolume(spec: {
    readonly sourceProject: string; readonly sourcePool: string; readonly sourceName: string;
    readonly targetProject: string; readonly targetPool: string; readonly targetName: string;
    readonly config: Readonly<Record<string, string>>;
  }): Promise<void> {
    await this.mutate("POST", this.projectPath(
      `/1.0/storage-pools/${encodeURIComponent(spec.targetPool)}/volumes/custom`, spec.targetProject,
    ), {
      name: spec.targetName, type: "custom",
      source: { type: "copy", project: spec.sourceProject, pool: spec.sourcePool, name: spec.sourceName },
      config: spec.config,
    });
  }

  async copyInstance(spec: {
    readonly sourceProject: string; readonly sourceName: string; readonly targetProject: string;
    readonly targetName: string; readonly config: Readonly<Record<string, string>>;
    readonly devices: Readonly<Record<string, Readonly<Record<string, string>>>>;
  }): Promise<void> {
    const source = await this.getInstance(spec.sourceProject, spec.sourceName);
    const baseImage = source?.config["volatile.base_image"] ??
      source?.config[INCUS_METADATA.baseFingerprint];
    if (source === undefined || baseImage === undefined || !/^[a-f0-9]{64}$/u.test(baseImage)) {
      throw incusError(
        "sandbox-artifact-unverified",
        `Incus copy source ${JSON.stringify(spec.sourceName)} has no exact base-image digest.`,
        ["Quarantine the source tuple; artifact copies must retain their trusted base-image lineage."],
      );
    }
    await this.mutate("POST", this.projectPath("/1.0/instances", spec.targetProject), {
      name: spec.targetName, type: "virtual-machine",
      // Incus needs base-image to copy a VM's root-disk delta. Omitting it can
      // produce a valid-looking target rooted at the base image and silently
      // discard the source VM's prepared root filesystem state.
      source: {
        type: "copy",
        project: spec.sourceProject,
        source: spec.sourceName,
        "base-image": baseImage,
      },
      config: spec.config, devices: spec.devices,
    });
  }

  async updateVolumeConfig(
    project: string,
    pool: string,
    name: string,
    config: Readonly<Record<string, string>>,
  ): Promise<void> {
    await this.mutate(
      "PATCH",
      this.projectPath(
        `/1.0/storage-pools/${encodeURIComponent(pool)}/volumes/custom/${encodeURIComponent(name)}`,
        project,
      ),
      { config },
    );
  }

  async stopInstance(project: string, name: string): Promise<void> {
    const instance = await this.getInstance(project, name);
    if (instance === undefined || instance.status.toLowerCase() === "stopped") return;
    await this.mutate("PUT", this.projectPath(`/1.0/instances/${encodeURIComponent(name)}/state`, project),
      // Artifact capture must let the guest flush its root filesystem. Forced
      // power-off is reserved for disposable allocation destruction below.
      { action: "stop", force: false, timeout: 120 });
    const stopped = await this.getInstance(project, name);
    if (stopped === undefined || stopped.status.toLowerCase() !== "stopped") {
      throw incusError("sandbox-artifact-unverified", `Incus instance ${JSON.stringify(name)} did not stop for artifact capture.`, ["Do not publish a running artifact."]);
    }
  }

  async startInstance(project: string, name: string): Promise<void> {
    await this.mutate(
      "PUT",
      this.projectPath(`/1.0/instances/${encodeURIComponent(name)}/state`, project),
      { action: "start", timeout: 120 },
    );
  }

  async deleteInstance(project: string, name: string): Promise<void> {
    const existing = await this.getInstance(project, name);
    if (existing === undefined) return;
    if (existing.status.toLowerCase() !== "stopped") {
      await this.mutate(
        "PUT",
        this.projectPath(`/1.0/instances/${encodeURIComponent(name)}/state`, project),
        { action: "stop", force: true, timeout: 30 },
      );
    }
    await this.mutate("DELETE", this.projectPath(`/1.0/instances/${encodeURIComponent(name)}`, project));
  }

  async waitAbsent(project: string, name: string, timeoutMs = MUTATION_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const instance = await this.getInstance(project, name);
      if (instance === undefined) return;
      if (Date.now() >= deadline) {
        throw incusError(
          "sandbox-destroy-incomplete",
          `Incus instance ${JSON.stringify(name)} in project ${JSON.stringify(project)} is still present after delete.`,
          ["Inspect the instance with the Incus CLI and destroy it from the Incus control plane."],
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  spawnExec(
    project: string,
    name: string,
    argv: readonly string[],
    options: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
      readonly user?: number | string;
      readonly group?: number | string;
      readonly keepStdin?: boolean;
    } = {},
  ): SpawnedIncusExec {
    this.requireCli("Incus exec");
    if (this.transport._tag !== "Cli") throw unreachable("Incus exec requires the incus CLI.");
    const args = ["exec", name, "--project", project];
    if (options.cwd !== undefined) args.push("--cwd", options.cwd);
    if (options.user !== undefined) args.push("--user", String(options.user));
    if (options.group !== undefined) args.push("--group", String(options.group));
    if (options.env !== undefined) {
      for (const [key, value] of Object.entries(options.env)) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key) || key.includes("\0") || value.includes("\0")) {
          throw unreachable("Refusing to pass an invalid environment entry to incus exec.");
        }
        args.push("--env", `${key}=${value}`);
      }
    }
    args.push("--", ...argv);
    const child = spawn(this.transport.binary, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    if (child.stdin === null || child.stdout === null || child.stderr === null) {
      throw unreachable("Incus exec did not expose stdio pipes.");
    }
    if (options.keepStdin !== true) child.stdin.end();
    return {
      stdin: child.stdin,
      stdout: child.stdout,
      stderr: child.stderr,
      pid: child.pid,
      wait: () => new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error: unknown | undefined, code?: number): void => {
          if (settled) return;
          settled = true;
          if (error !== undefined) reject(sanitizeSpawnError(error));
          else resolve(code ?? 1);
        };
        child.once("error", (cause) => finish(cause));
        child.once("close", (code) => finish(undefined, code ?? 1));
      }),
      killHost: () => {
        child.kill("SIGKILL");
      },
    };
  }

  async exec(
    project: string,
    name: string,
    argv: readonly string[],
    options: {
      readonly cwd?: string;
      readonly env?: Readonly<Record<string, string>>;
      readonly user?: number | string;
      readonly group?: number | string;
      readonly timeoutMs?: number;
      readonly signal?: AbortSignal;
    } = {},
  ): Promise<IncusExecResult> {
    const spawned = this.spawnExec(project, name, argv, options);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    spawned.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    spawned.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const onAbort = (): void => spawned.killHost();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(onAbort, options.timeoutMs);
    }
    try {
      const exitCode = await spawned.wait();
      return {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
      };
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }

  async pushFile(
    project: string,
    name: string,
    guestPath: string,
    content: Uint8Array,
    options: { readonly uid?: number; readonly gid?: number; readonly mode?: string } = {},
  ): Promise<void> {
    this.requireCli("Incus file push");
    if (this.transport._tag !== "Cli") throw unreachable("Incus file push requires the incus CLI.");
    const args = ["file", "push", "-", `${name}${guestPath}`, "--project", project];
    if (options.uid !== undefined) args.push("--uid", String(options.uid));
    if (options.gid !== undefined) args.push("--gid", String(options.gid));
    if (options.mode !== undefined) args.push("--mode", options.mode);
    const result = await runCli(this.transport.binary, args, {
      timeoutMs: MUTATION_TIMEOUT_MS,
      encoding: "buffer",
      stdin: content,
    });
    if (result.exitCode !== 0) {
      throw unreachable(`incus file push failed (exit ${result.exitCode}).`);
    }
  }

  async pullFile(project: string, name: string, guestPath: string): Promise<Uint8Array> {
    this.requireCli("Incus file pull");
    if (this.transport._tag !== "Cli") throw unreachable("Incus file pull requires the incus CLI.");
    const result = await runCli(
      this.transport.binary,
      ["file", "pull", `${name}${guestPath}`, "-", "--project", project],
      { timeoutMs: MUTATION_TIMEOUT_MS, encoding: "buffer" },
    );
    if (result.exitCode !== 0) {
      throw unreachable(`incus file pull failed (exit ${result.exitCode}).`);
    }
    return result.stdout;
  }
}

export function parseIncusSizeBytes(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (/^\d+$/u.test(trimmed)) {
    const bytes = Number(trimmed);
    return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
  }
  const match = /^(\d+)((?:[kKmMgGtTpP]i?)?B?| bytes)$/u.exec(trimmed);
  if (match === null || match[1] === undefined || match[2] === undefined) return undefined;
  const value = Number(match[1]);
  if (!Number.isSafeInteger(value) || value <= 0) return undefined;
  const unit = match[2].toLowerCase().replace(/ ?bytes$/u, "b");
  if (unit === "" || unit === "b") return value;
  const binary = unit.includes("i");
  const index = "kmgtp".indexOf(unit[0] ?? "");
  if (index < 0) return undefined;
  const base = binary ? 1024 : 1000;
  const bytes = value * (base ** (index + 1));
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : undefined;
}

export function isIncusCliTimeout(error: unknown): boolean {
  return error instanceof Error && /timed out/i.test(error.message);
}

export function isIncusUnreachable(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as IncusProviderError).code === "incus-unreachable";
}

export function classifyIncusProvisionError(error: unknown): SandboxProvisionErrorKind {
  if (error instanceof Error && "code" in error) {
    const code = (error as IncusProviderError).code;
    if (code === "incus-unreachable") return classifyProvisionErrorFallback(error);
    if (
      code === "incus-undeployed" ||
      code === "incus-descriptor-invalid" ||
      code === "incus-domain-mismatch" ||
      code === "sandbox-artifact-unverified" ||
      code === "sandbox-capability-unsatisfied"
    ) {
      return "unknown";
    }
    if (code === "sandbox-capacity-unavailable") return "rejected";
  }
  return classifyProvisionErrorFallback(error);
}

export const connectIncusControl = (
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<IncusControl, IncusProviderError> =>
  Effect.tryPromise({
    try: () => IncusControl.connectReadOnly(env),
    catch: (cause) => cause instanceof Error && "code" in cause
      ? cause as IncusProviderError
      : unreachable(
          `Incus control plane is unreachable: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        ),
  });

export const connectIncusMutation = (
  env: NodeJS.ProcessEnv = process.env,
): Effect.Effect<IncusControl, IncusProviderError> =>
  Effect.tryPromise({
    try: () => IncusControl.connectMutation(env),
    catch: (cause) => cause instanceof Error && "code" in cause
      ? cause as IncusProviderError
      : unreachable(
          `Incus mutations require the incus CLI: ${cause instanceof Error ? cause.message : String(cause)}`,
          cause,
        ),
  });
