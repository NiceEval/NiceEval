import type Docker from "dockerode";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  acquireDockerProfileReservation,
  attestDockerProfile,
  DockerProfileCapacityBlockedError,
  createDockerProfileContainer,
  createDockerProfileBuild,
  createDockerProfileLease,
  dockerProfileControlRequest,
  loadDockerProfileRegistry,
  releaseDockerProfileReservation,
} from "./runtime.ts";

export interface DockerProfileCliOptions {
  readonly json: boolean;
  readonly out: (text: string) => void;
  readonly err: (text: string) => void;
}

function doctorBuildContext(): Readable {
  const content = Buffer.from(`FROM scratch\nLABEL niceeval.doctor.nonce=${randomUUID()}\n`);
  const header = Buffer.alloc(512);
  header.write("Dockerfile", 0, "utf8");
  header.write("0000644\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(content.length.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return Readable.from([header, content, Buffer.alloc((512 - content.length % 512) % 512), Buffer.alloc(1024)]);
}

type DoctorStatus = "PASS" | "BLOCKED" | "FAIL";

interface Check {
  readonly id: DoctorCheckId;
  readonly status: DoctorStatus;
  readonly code?: string;
  readonly detail: string;
}

interface ControlStatus {
  readonly journal?: { readonly state?: string; readonly durableTransitions?: boolean };
  readonly assets?: { readonly state?: string; readonly images?: readonly { readonly reference?: string; readonly present?: boolean }[] };
}

const DOCTOR_CHECK_IDS = [
  "descriptor", "control", "daemon", "cgroup", "storage", "journal", "assets",
  "cold-build", "cold-build-cleanup", "container-limits", "nested-docker", "container-cleanup",
] as const;
type DoctorCheckId = typeof DOCTOR_CHECK_IDS[number];

const DOCKER_PROFILE_DOCTOR_DOCKER_DATA_BYTES = 1024 ** 3;
/** Installed by the profile deployment; doctor must never fetch it. */
const DOCKER_PROFILE_DOCTOR_DIND_IMAGE =
  "docker:29-dind@sha256:e8faad5a8dc5279dff929afc5449f2791736912fff9f99351d742db2fad01b4c";

function dockerStatusCode(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "statusCode" in error
    ? (error as { readonly statusCode?: number }).statusCode
    : undefined;
}

async function startDoctorContainerIdempotently(container: Docker.Container): Promise<void> {
  if ((await container.inspect()).State?.Running === true) return;
  try {
    await container.start();
  } catch (error) {
    if (dockerStatusCode(error) === 304 && (await container.inspect()).State?.Running === true) return;
    throw error;
  }
}

function decodeDockerMultiplexedLogs(raw: Buffer): string {
  const lines: Buffer[] = [];
  let offset = 0;
  while (offset < raw.length) {
    if (raw.length - offset < 8) throw new Error("diagnostic logs have a truncated Docker multiplex header");
    const size = raw.readUInt32BE(offset + 4);
    offset += 8;
    if (size > 64 * 1024 || offset + size > raw.length) throw new Error("diagnostic logs exceed the bounded multiplex framing");
    lines.push(raw.subarray(offset, offset + size));
    offset += size;
  }
  return Buffer.concat(lines).toString("utf8");
}

function failedPrerequisites(after: readonly DoctorCheckId[], code: "PREREQUISITE_FAILED" | "UNSAFE_TO_CONTINUE"): Check[] {
  return after.map((id) => ({ id, status: "FAIL", code, detail: "the preceding diagnostic stage did not establish a safe precondition" }));
}

async function runDynamicChecks(alias: string): Promise<Check[]> {
  const binding = await attestDockerProfile(alias);
  const lease = await createDockerProfileLease(binding);
  let buildReservation: Awaited<ReturnType<typeof acquireDockerProfileReservation>> | undefined;
  let containerReservation: Awaited<ReturnType<typeof acquireDockerProfileReservation>> | undefined;
  let buildReleased = false;
  let containerReleased = false;
  let primary: unknown;
  let limits = "";
  try {
    buildReservation = await acquireDockerProfileReservation(lease, "build", {
      cpus: 0, memoryBytes: 0, pids: 0, containers: 0, ephemeralDiskBytes: 0,
    });
    const build = await createDockerProfileBuild(lease, buildReservation.reservationId, {
      buildKey: createHash("sha256").update("niceeval-doctor-cold-build-v1").digest("hex"),
      platform: "linux/amd64", dockerfile: "Dockerfile", retention: "ephemeral",
    }, doctorBuildContext());
    const buildRelease = await releaseDockerProfileReservation(lease, buildReservation.reservationId);
    if (buildRelease.cleanupProven !== true) throw new Error("control could not prove ephemeral cold-build cleanup after release");
    buildReleased = true;
    containerReservation = await acquireDockerProfileReservation(lease, "container", {
      cpus: 2,
      memoryBytes: 512 * 1024 * 1024,
      pids: 256,
      containers: 1,
      ephemeralDiskBytes: DOCKER_PROFILE_DOCTOR_DOCKER_DATA_BYTES,
    });
    // doctor 的完整路径也不应要求安装 optional dockerode peer until dynamic checks begin.
    const { default: DockerClient } = await import("dockerode");
    const docker = new DockerClient({ socketPath: binding.dockerSocketPath });
    const created = await createDockerProfileContainer(lease, containerReservation.reservationId, {
      intent: "diagnostic",
    });
    const container = docker.getContainer(created.containerId);
    await startDoctorContainerIdempotently(container);
    let waitTimer: ReturnType<typeof setTimeout> | undefined;
    let waited: Awaited<ReturnType<typeof container.wait>>;
    try {
      waited = await Promise.race([
        container.wait(),
        new Promise<never>((_, reject) => { waitTimer = setTimeout(() => reject(new Error("control-owned diagnostic exceeded 60 seconds")), 60_000); }),
      ]);
    } finally {
      if (waitTimer !== undefined) clearTimeout(waitTimer);
    }
    const logs = decodeDockerMultiplexedLogs(Buffer.from(await container.logs({ stdout: true, stderr: true })));
    if (Buffer.byteLength(logs) > 64 * 1024) throw new Error("control-owned diagnostic logs exceed 64 KiB");
    const results = logs.split(/\r?\n/).flatMap((line) => {
      try {
        return [JSON.parse(line) as {
          ok?: boolean;
          unixOnly?: boolean;
          nestedDocker?: boolean;
          limits?: { cpuMax?: string; memoryMax?: string; swapMax?: string; pidsMax?: string };
        }];
      } catch { return []; }
    });
    if (results.length !== 1) throw new Error("control-owned diagnostic must emit exactly one JSON result");
    const result = results[0];
    const expectedLimits = {
      cpuMax: "200000 100000",
      memoryMax: String(512 * 1024 * 1024),
      swapMax: "0",
      pidsMax: "256",
    };
    if (
      waited.StatusCode !== 0 || result?.ok !== true || result.unixOnly !== true || result.nestedDocker !== true
      || JSON.stringify(result.limits) !== JSON.stringify(expectedLimits)
    ) {
      throw new Error(`control-owned diagnostic failed: ${logs.slice(-4096)}`);
    }
    await releaseDockerProfileReservation(lease, containerReservation.reservationId, containerReservation);
    containerReleased = true;
    limits = `cpu.max=${expectedLimits.cpuMax} memory.max=${expectedLimits.memoryMax} memory.swap.max=${expectedLimits.swapMax} pids.max=${expectedLimits.pidsMax}`;
  } catch (error) {
    primary = error;
  } finally {
    const cleanupErrors: unknown[] = [];
    if (containerReservation !== undefined && !containerReleased) {
      await releaseDockerProfileReservation(lease, containerReservation.reservationId, containerReservation).catch((error) => cleanupErrors.push(error));
    }
    if (buildReservation !== undefined && !buildReleased) {
      await releaseDockerProfileReservation(lease, buildReservation.reservationId).catch((error) => cleanupErrors.push(error));
    }
    await lease.stopHeartbeat().catch((error) => cleanupErrors.push(error));
    if (primary !== undefined && cleanupErrors.length > 0) throw new AggregateError([primary, ...cleanupErrors], "doctor primary operation and cleanup both failed");
    if (primary !== undefined) throw primary;
    if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, "doctor cleanup failed");
  }
  return [
      { id: "cold-build", status: "PASS", detail: "control-owned offline FROM scratch build completed" },
      { id: "cold-build-cleanup", status: "PASS", detail: "ephemeral build locator and builder resources are absent" },
      { id: "container-limits", status: "PASS", detail: limits },
      { id: "nested-docker", status: "PASS", detail: "offline nested Docker completed with --pull=never" },
      { id: "container-cleanup", status: "PASS", detail: "control-owned diagnostic reservation released" },
    ];
}

export async function runDockerProfileCommand(
  positionals: readonly string[],
  options: DockerProfileCliOptions,
): Promise<number> {
  if (positionals[0] !== "profile") {
    options.err("Usage: niceeval docker profile list [--json]\n" +
      "       niceeval docker profile doctor <alias> [--json]\n");
    return 1;
  }
  const subcommand = positionals[1];
  if (subcommand === "list" && positionals.length === 2) {
    try {
      const registry = await loadDockerProfileRegistry();
      const rows = registry.entries.map((entry) => ({
        alias: entry.alias,
        profileId: entry.profileId,
        securityLevel: entry.profile.securityLevel,
        semanticPolicyRevision: entry.profile.semanticPolicyRevision,
        endpointKind: entry.profile.transport.kind,
        health: "descriptor-valid",
      }));
      if (options.json) options.out(`${JSON.stringify({ format: "niceeval.docker-profiles", schemaVersion: 1, profiles: rows })}\n`);
      else for (const row of rows) options.out(
        `${row.alias}\t${row.profileId.slice(0, 12)}\t${row.securityLevel}\tpolicy ${row.semanticPolicyRevision.slice(0, 12)}\t${row.health}\n`,
      );
      return 0;
    } catch (error) {
      options.err(`${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
  if (subcommand === "doctor" && positionals.length === 3) {
    const alias = positionals[2]!;
    const checks: Check[] = [];
    try {
      const binding = await attestDockerProfile(alias);
      checks.push(
        { id: "descriptor", status: "PASS", detail: binding.descriptorDigest },
        { id: "control", status: "PASS", detail: `generation ${binding.daemonGeneration}` },
        { id: "daemon", status: "PASS", detail: binding.platform },
        { id: "cgroup", status: "PASS", detail: binding.profile.backend.cgroup.aggregatePath },
        { id: "storage", status: "PASS", detail: binding.profile.backend.filesystem.identity },
      );
      const control = await dockerProfileControlRequest<ControlStatus>(binding.controlSocketPath, { kind: "status" });
      if (control.journal?.state !== "healthy" || control.journal.durableTransitions !== true) {
        throw new Error("watchdog did not attest a healthy durable journal");
      }
      checks.push({ id: "journal", status: "PASS", detail: "watchdog attested a complete fsync-backed journal" });
      const assets = control.assets?.images ?? [];
      const doctorAsset = assets.find((asset) => asset.reference === DOCKER_PROFILE_DOCTOR_DIND_IMAGE);
      if (control.assets?.state !== "verified" || doctorAsset?.present !== true) {
        throw new Error("watchdog did not attest the required preloaded diagnostic asset");
      }
      checks.push({ id: "assets", status: "PASS", detail: doctorAsset.reference! });
      checks.push(...await runDynamicChecks(alias));
    } catch (error) {
      const errorDetail = error instanceof AggregateError
        ? error.errors.map((item, index) => {
          const role = error.message.includes("primary operation") && index === 0 ? "primary" : "cleanup";
          return `${role}: ${item instanceof Error ? item.message : String(item)}`;
        }).join(" | ")
        : error instanceof Error ? error.message : String(error);
      const completed = new Set(checks.map((check) => check.id));
      const next = DOCTOR_CHECK_IDS.find((id) => !completed.has(id)) ?? "container-cleanup";
      if (error instanceof DockerProfileCapacityBlockedError) {
        checks.push({ id: next, status: "BLOCKED", code: error.code, detail: error.message });
        checks.push(...DOCTOR_CHECK_IDS
          .filter((id) => !new Set(checks.map((check) => check.id)).has(id))
          .map((id) => ({ id, status: "BLOCKED" as const, code: error.code, detail: "capacity queue is blocked; dynamic stage was not started" })));
      } else {
        checks.push({ id: next, status: "FAIL", code: "UNSAFE_TO_CONTINUE", detail: errorDetail });
        checks.push(...failedPrerequisites(DOCTOR_CHECK_IDS.filter((id) => !new Set(checks.map((check) => check.id)).has(id)), "PREREQUISITE_FAILED"));
      }
    }
    const ordered = DOCTOR_CHECK_IDS.map((id) => checks.find((check) => check.id === id) ?? {
      id, status: "FAIL" as const, code: "PREREQUISITE_FAILED", detail: "diagnostic produced no result",
    });
    const status: DoctorStatus = ordered.some((check) => check.status === "FAIL") ? "FAIL"
      : ordered.some((check) => check.status === "BLOCKED") ? "BLOCKED" : "PASS";
    if (options.json) options.out(`${JSON.stringify({ format: "niceeval.docker-profile-doctor", schemaVersion: 1, alias, status, checks: ordered })}\n`);
    else for (const check of ordered) options.out(`${check.status}  ${check.id}${check.code === undefined ? "" : ` · ${check.code}`}  ${check.detail}\n`);
    return status === "PASS" ? 0 : 1;
  }
  options.err("Usage: niceeval docker profile list [--json]\n" +
    "       niceeval docker profile doctor <alias> [--json]\n");
  return 1;
}
