import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Kernel-backed identity; BSD ps exposes no POSIX session ID. */
export function procIdentity(pid: number): { readonly processGroupId: number; readonly sessionId?: number } {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`invalid PTY process ID: ${pid}`);
  if (process.platform === "darwin") {
    const output = execFileSync("/bin/ps", ["-p", String(pid), "-o", "pid=,pgid="], {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1024,
    }).trim();
    const fields = output.split(/\s+/);
    const processGroupId = Number(fields[1]);
    if (
      fields.length !== 2 ||
      Number(fields[0]) !== pid ||
      !Number.isSafeInteger(processGroupId) ||
      processGroupId <= 0
    ) {
      throw new Error(`cannot decode process identity for ${pid}`);
    }
    return { processGroupId };
  }
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = stat.lastIndexOf(")");
  const fields =
    end < 0
      ? []
      : stat
          .slice(end + 2)
          .trim()
          .split(/\s+/);
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  if (!Number.isSafeInteger(processGroupId) || !Number.isSafeInteger(sessionId)) {
    throw new Error(`cannot decode process identity for ${pid}`);
  }
  return { processGroupId, sessionId };
}

export function darwinProcessGroupState(groupId: number): "gone" | "terminal" | "running" {
  const output = execFileSync("/bin/ps", ["-A", "-o", "pgid=,stat="], {
    encoding: "utf8",
    timeout: 5_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  let terminal = false;
  for (const line of output.trim().split("\n")) {
    const fields = line.trim().split(/\s+/);
    const memberGroup = Number(fields[0]);
    const state = fields[1];
    if (fields.length !== 2 || !Number.isSafeInteger(memberGroup) || state === undefined) {
      throw new Error("cannot decode macOS process group snapshot");
    }
    if (memberGroup !== groupId) continue;
    if (!state.startsWith("Z")) return "running";
    terminal = true;
  }
  return terminal ? "terminal" : "gone";
}
