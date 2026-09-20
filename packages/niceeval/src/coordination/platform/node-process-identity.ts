import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

import type { ProcessOwnerIdentity } from "./sqlite-coordination.ts";

const PROCESS_SESSION_ID = `process-session-v1:${randomUUID()}`;

function errnoCode(cause: unknown): unknown {
  return typeof cause === "object" && cause !== null ? Reflect.get(cause, "code") : undefined;
}

function linuxProcessStartOf(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) throw new Error(`Could not decode /proc/${pid}/stat.`);
  const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/u);
  const processStart = fieldsAfterCommand[19];
  if (processStart === undefined || !/^\d+$/u.test(processStart)) throw new Error(`Could not decode process start for pid ${pid}.`);
  return processStart;
}

function linuxBootId(): string {
  const value = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  if (value.length === 0) throw new Error("The local Linux boot ID is empty.");
  return value;
}

function darwinBootSessionUuid(): string {
  return execFileSync(
    "/usr/sbin/sysctl",
    ["-n", "kern.bootsessionuuid"],
    {
      encoding: "utf8",
      env: { LANG: "C", LC_ALL: "C", TZ: "UTC" },
      maxBuffer: 4_096,
      timeout: 1_000,
    },
  );
}

function validatedDarwinBootId(readBootSessionUuid: () => string): string {
  const value = readBootSessionUuid().trim();
  if (!/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/iu.test(value)) {
    throw new Error("The local Darwin boot session UUID is unavailable or malformed.");
  }
  return value;
}

export type ExactProcessState = "alive" | "dead" | "unknown";

/** @internal Injectable operating-system boundary for deterministic classification tests. */
export interface ProcessIdentityRuntime {
  readonly platform: NodeJS.Platform;
  readonly pid: number;
  readonly processSessionId: string;
  readonly host: () => string;
  readonly linuxBootId: () => string;
  readonly linuxProcessStartOf: (pid: number) => string;
  readonly darwinBootSessionUuid: () => string;
  readonly signalZero: (pid: number) => void;
}

/** @internal Keeps trust classification separate from the live OS observation boundary. */
export function makeProcessIdentity(runtime: ProcessIdentityRuntime): Readonly<{
  current: (ownerId: string) => ProcessOwnerIdentity;
  exactState: (owner: ProcessOwnerIdentity) => ExactProcessState;
}> {
  const current = (ownerId: string): ProcessOwnerIdentity => {
    if (runtime.platform !== "linux" && runtime.platform !== "darwin") {
      throw new Error(`Process identity is unsupported on ${runtime.platform}.`);
    }
    const bootId = runtime.platform === "linux"
      ? runtime.linuxBootId()
      : validatedDarwinBootId(runtime.darwinBootSessionUuid);
    const processStart = runtime.platform === "linux"
      ? runtime.linuxProcessStartOf(runtime.pid)
      : runtime.processSessionId;
    return Object.freeze({ ownerId, host: runtime.host(), pid: runtime.pid, bootId, processStart });
  };

  const exactState = (owner: ProcessOwnerIdentity): ExactProcessState => {
    if (owner.host !== runtime.host()) return "unknown";

    if (runtime.platform === "linux") {
      let localBootId: string;
      try {
        localBootId = runtime.linuxBootId();
      } catch {
        return "unknown";
      }
      if (owner.bootId !== localBootId) return "dead";
      try {
        const processStart = runtime.linuxProcessStartOf(owner.pid);
        return processStart === owner.processStart ? "alive" : "unknown";
      } catch (cause) {
        return errnoCode(cause) === "ENOENT" ? "dead" : "unknown";
      }
    }

    if (runtime.platform !== "darwin") return "unknown";
    let localBootId: string;
    try {
      localBootId = validatedDarwinBootId(runtime.darwinBootSessionUuid);
    } catch {
      return "unknown";
    }
    if (owner.bootId !== localBootId) return "dead";
    if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0) return "unknown";

    // A per-process nonce proves only this exact process. It is intentionally
    // opaque to other processes rather than weakening PID reuse protection.
    if (owner.pid === runtime.pid && owner.processStart === runtime.processSessionId) return "alive";
    try {
      runtime.signalZero(owner.pid);
      // macOS `ps lstart` is second-granularity presentation data. A present PID
      // therefore cannot prove that the durable owner, rather than a reuse, lives.
      return "unknown";
    } catch (cause) {
      return errnoCode(cause) === "ESRCH" ? "dead" : "unknown";
    }
  };

  return Object.freeze({ current, exactState });
}

const liveProcessIdentity = makeProcessIdentity({
  platform: process.platform,
  pid: process.pid,
  processSessionId: PROCESS_SESSION_ID,
  host: hostname,
  linuxBootId,
  linuxProcessStartOf,
  darwinBootSessionUuid,
  signalZero: (pid) => process.kill(pid, 0),
});

export function currentProcessOwnerIdentity(ownerId = `owner_${randomUUID()}`): ProcessOwnerIdentity {
  return liveProcessIdentity.current(ownerId);
}

/** Remote owners, read failures, and PID reuse deliberately fail closed. */
export function exactProcessState(owner: ProcessOwnerIdentity): ExactProcessState {
  return liveProcessIdentity.exactState(owner);
}
