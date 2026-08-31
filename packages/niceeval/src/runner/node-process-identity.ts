import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

import type { ProcessOwnerIdentity } from "../coordination/platform/sqlite-coordination.ts";

function processStartOf(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) throw new Error(`Could not decode /proc/${pid}/stat.`);
  const fieldsAfterCommand = stat.slice(commandEnd + 2).trim().split(/\s+/u);
  const processStart = fieldsAfterCommand[19];
  if (processStart === undefined || !/^\d+$/u.test(processStart)) throw new Error(`Could not decode process start for pid ${pid}.`);
  return processStart;
}

function bootId(): string {
  const value = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  if (value.length === 0) throw new Error("The local Linux boot ID is empty.");
  return value;
}

export function currentProcessOwnerIdentity(ownerId = `owner_${randomUUID()}`): ProcessOwnerIdentity {
  return Object.freeze({ ownerId, host: hostname(), pid: process.pid, bootId: bootId(), processStart: processStartOf(process.pid) });
}

export type ExactProcessState = "alive" | "dead" | "unknown";

/** Remote owners, read failures, and PID reuse deliberately fail closed. */
export function exactProcessState(owner: ProcessOwnerIdentity): ExactProcessState {
  if (owner.host !== hostname()) return "unknown";
  let localBootId: string;
  try {
    localBootId = bootId();
  } catch {
    return "unknown";
  }
  if (owner.bootId !== localBootId) return "dead";
  try {
    return processStartOf(owner.pid) === owner.processStart ? "alive" : "unknown";
  } catch (cause) {
    const code = typeof cause === "object" && cause !== null ? Reflect.get(cause, "code") : undefined;
    return code === "ENOENT" ? "dead" : "unknown";
  }
}
