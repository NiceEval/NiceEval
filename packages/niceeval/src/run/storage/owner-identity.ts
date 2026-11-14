import { readFileSync, readlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { Schema } from "effect";

const VERIFIED_WRITER_PREFIX = "local-linux-process-v1:";
const DARWIN_WRITER_PREFIX = "local-darwin-process-v1:";
const OPAQUE_WRITER_PREFIX = "opaque-writer-v1:";
const DARWIN_PROCESS_DOMAIN = "darwin-host";

const VerifiedWriterIdentitySchema = Schema.Struct({
  machineId: Schema.String,
  bootId: Schema.String,
  pidNamespace: Schema.String,
  pid: Schema.Int,
  processStart: Schema.String,
  generation: Schema.String,
});

export interface VerifiedWriterIdentity extends Schema.Schema.Type<typeof VerifiedWriterIdentitySchema> {}

export type WriterTerminationObservation =
  | { readonly state: "terminated"; readonly evidenceIdentity: string; readonly evidenceKind: string }
  | { readonly state: "active" }
  | { readonly state: "unproven"; readonly reason: "other-host" | "identity-not-recorded" | "probe-failed" };

function nonEmptyFile(path: string): string {
  const value = readFileSync(path, "utf8").trim();
  if (value.length === 0) throw new Error(`${path} did not contain an identity`);
  return value;
}

function linuxProcessStart(pid: number): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw cause;
  }
  const closing = raw.lastIndexOf(")");
  if (closing < 0 || raw[closing + 1] !== " ") throw new Error("Linux process identity is malformed");
  const fields = raw
    .slice(closing + 2)
    .trim()
    .split(/\s+/u);
  const state = fields[0];
  if (state === "Z" || state === "X" || state === "x") return undefined;
  if (state === undefined || !/^[A-Za-z]$/u.test(state)) throw new Error("Linux process state is malformed");
  const processStart = fields[19];
  if (processStart === undefined || !/^\d+$/u.test(processStart)) {
    throw new Error("Linux process start identity is malformed");
  }
  return processStart;
}

function darwinCommand(command: string, args: readonly string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    timeout: 5_000,
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function darwinUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value)) {
    throw new Error("Darwin system identity is malformed");
  }
  return value.toLowerCase();
}

function darwinMachineId(): string {
  const platform = darwinCommand("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
  const matches = [...platform.matchAll(/"IOPlatformUUID"\s*=\s*"([^"]+)"/gu)];
  if (matches.length !== 1) throw new Error("Darwin platform identity is unavailable");
  return darwinUuid(matches[0]![1]!);
}

function darwinBootId(): string {
  return darwinUuid(darwinCommand("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"]));
}

/** ps lstart reads the kernel process start time, rendered to seconds in a fixed locale/zone. */
function darwinProcessStart(pid: number): string | undefined {
  let value: string;
  try {
    value = darwinCommand("/bin/ps", ["-p", String(pid), "-o", "lstart="]);
  } catch (cause) {
    const failure = cause as { status?: number; signal?: string | null; stdout?: string; stderr?: string };
    // ps exits 1 without diagnostics when the requested pid does not exist.
    // Permission, launch, timeout, signal and parse failures cannot prove termination.
    if (failure.status === 1 && failure.signal == null && failure.stdout === "" && failure.stderr === "") {
      return undefined;
    }
    throw cause;
  }
  if (
    !/^[A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/u.test(value) ||
    !Number.isFinite(Date.parse(`${value} UTC`))
  ) {
    throw new Error("Darwin process start identity is malformed");
  }
  return value;
}

function verifiedPrefix(): string | undefined {
  return process.platform === "linux"
    ? VERIFIED_WRITER_PREFIX
    : process.platform === "darwin"
      ? DARWIN_WRITER_PREFIX
      : undefined;
}

function encodeVerified(identity: VerifiedWriterIdentity): string {
  return `${verifiedPrefix()}${Buffer.from(JSON.stringify(identity), "utf8").toString("base64url")}`;
}

function decodeVerified(value: string): VerifiedWriterIdentity | undefined {
  const prefix = [VERIFIED_WRITER_PREFIX, DARWIN_WRITER_PREFIX].find((candidate) => value.startsWith(candidate));
  if (prefix === undefined) return undefined;
  try {
    const encoded = value.slice(prefix.length);
    const decoded: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const identity = Schema.decodeUnknownSync(VerifiedWriterIdentitySchema)(decoded);
    if (
      identity.machineId.length === 0 ||
      identity.bootId.length === 0 ||
      identity.pidNamespace.length === 0 ||
      identity.pid < 1 ||
      identity.processStart.length === 0 ||
      identity.generation.length === 0
    )
      return undefined;
    return identity;
  } catch {
    return undefined;
  }
}

/** Seals recoverable evidence only when every platform identity can be observed. */
export function createRunWriterGeneration(generation: string): string {
  if (verifiedPrefix() === undefined) return `${OPAQUE_WRITER_PREFIX}${generation}`;
  try {
    const darwin = process.platform === "darwin";
    const processStart = darwin ? darwinProcessStart(process.pid) : linuxProcessStart(process.pid);
    if (processStart === undefined) return `${OPAQUE_WRITER_PREFIX}${generation}`;
    return encodeVerified({
      machineId: darwin ? darwinMachineId() : nonEmptyFile("/etc/machine-id"),
      bootId: darwin ? darwinBootId() : nonEmptyFile("/proc/sys/kernel/random/boot_id"),
      pidNamespace: darwin ? DARWIN_PROCESS_DOMAIN : readlinkSync("/proc/self/ns/pid"),
      pid: process.pid,
      processStart,
      generation,
    });
  } catch {
    return `${OPAQUE_WRITER_PREFIX}${generation}`;
  }
}

/** Verifies termination without treating age, permission failures, or a foreign host as evidence. */
export function observeRunWriterTermination(writerGeneration: string): WriterTerminationObservation {
  const identity = decodeVerified(writerGeneration);
  if (identity === undefined) return { state: "unproven", reason: "identity-not-recorded" };
  const localPrefix = verifiedPrefix();
  if (localPrefix === undefined || !writerGeneration.startsWith(localPrefix))
    return { state: "unproven", reason: "other-host" };
  try {
    const darwin = process.platform === "darwin";
    const machineId = darwin ? darwinMachineId() : nonEmptyFile("/etc/machine-id");
    if (machineId !== identity.machineId) return { state: "unproven", reason: "other-host" };
    const pidNamespace = darwin ? DARWIN_PROCESS_DOMAIN : readlinkSync("/proc/self/ns/pid");
    if (pidNamespace !== identity.pidNamespace) return { state: "unproven", reason: "other-host" };
    const currentBootId = darwin ? darwinBootId() : nonEmptyFile("/proc/sys/kernel/random/boot_id");
    const terminated = (): WriterTerminationObservation => ({
      state: "terminated",
      evidenceIdentity: writerGeneration,
      evidenceKind: darwin ? "local-darwin-process-terminated-v1" : "local-linux-process-terminated-v1",
    });
    if (currentBootId !== identity.bootId) {
      return terminated();
    }
    const currentProcessStart = darwin ? darwinProcessStart(identity.pid) : linuxProcessStart(identity.pid);
    if (currentProcessStart === identity.processStart) return { state: "active" };
    return terminated();
  } catch {
    return { state: "unproven", reason: "probe-failed" };
  }
}
