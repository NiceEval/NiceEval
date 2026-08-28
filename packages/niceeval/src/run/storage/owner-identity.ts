import { readFileSync, readlinkSync } from "node:fs";

import { Schema } from "effect";

const VERIFIED_WRITER_PREFIX = "local-linux-process-v1:";
const OPAQUE_WRITER_PREFIX = "opaque-writer-v1:";

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
  | { readonly state: "terminated"; readonly evidenceIdentity: string }
  | { readonly state: "active" }
  | { readonly state: "unproven" };

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
  const fields = raw.slice(closing + 2).trim().split(/\s+/u);
  const state = fields[0];
  if (state === "Z" || state === "X" || state === "x") return undefined;
  if (state === undefined || !/^[A-Za-z]$/u.test(state)) throw new Error("Linux process state is malformed");
  const processStart = fields[19];
  if (processStart === undefined || !/^\d+$/u.test(processStart)) {
    throw new Error("Linux process start identity is malformed");
  }
  return processStart;
}

function encodeVerified(identity: VerifiedWriterIdentity): string {
  return `${VERIFIED_WRITER_PREFIX}${Buffer.from(JSON.stringify(identity), "utf8").toString("base64url")}`;
}

function decodeVerified(value: string): VerifiedWriterIdentity | undefined {
  if (!value.startsWith(VERIFIED_WRITER_PREFIX)) return undefined;
  try {
    const encoded = value.slice(VERIFIED_WRITER_PREFIX.length);
    const decoded: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    const identity = Schema.decodeUnknownSync(VerifiedWriterIdentitySchema)(decoded);
    if (
      identity.machineId.length === 0
      || identity.bootId.length === 0
      || identity.pidNamespace.length === 0
      || identity.pid < 1
      || identity.processStart.length === 0
      || identity.generation.length === 0
    ) return undefined;
    return identity;
  } catch {
    return undefined;
  }
}

/** Creates recoverable evidence when Linux exposes a stable machine/process identity. */
export function createRunWriterGeneration(generation: string): string {
  if (process.platform !== "linux") return `${OPAQUE_WRITER_PREFIX}${generation}`;
  try {
    const processStart = linuxProcessStart(process.pid);
    if (processStart === undefined) return `${OPAQUE_WRITER_PREFIX}${generation}`;
    return encodeVerified({
      machineId: nonEmptyFile("/etc/machine-id"),
      bootId: nonEmptyFile("/proc/sys/kernel/random/boot_id"),
      pidNamespace: readlinkSync("/proc/self/ns/pid"),
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
  if (identity === undefined || process.platform !== "linux") return { state: "unproven" };
  try {
    if (nonEmptyFile("/etc/machine-id") !== identity.machineId) return { state: "unproven" };
    if (readlinkSync("/proc/self/ns/pid") !== identity.pidNamespace) return { state: "unproven" };
    const currentBootId = nonEmptyFile("/proc/sys/kernel/random/boot_id");
    if (currentBootId !== identity.bootId) {
      return { state: "terminated", evidenceIdentity: writerGeneration };
    }
    const currentProcessStart = linuxProcessStart(identity.pid);
    if (currentProcessStart === identity.processStart) return { state: "active" };
    return { state: "terminated", evidenceIdentity: writerGeneration };
  } catch {
    return { state: "unproven" };
  }
}
