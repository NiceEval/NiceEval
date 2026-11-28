import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Schema } from "effect";
import type { ResourceCleanup } from "./contracts.ts";

const dockerOwnerLabel = "dev.niceeval.e2e.owner";
const pid = Schema.Int.check(Schema.isGreaterThan(1), Schema.isLessThanOrEqualTo(0x7fffffff));
const registration = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["process-group", "process"]), pid, birth: Schema.optional(Schema.String) }),
  Schema.Struct({ kind: Schema.Literal("docker"), owner: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("scenario"), detail: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("pending-process") }),
]);
type Registration = typeof registration.Type;
type ProcessRegistration = Extract<Registration, { readonly pid: number }>;

export function createTestkitRegistry(env = process.env) {
  const settings = Object.entries(env).filter(
    ([name, value]) => (name.startsWith("DOCKER_") || name === "HOME") && value !== undefined,
  );
  settings.sort(([left], [right]) => left.localeCompare(right));
  const owner = randomUUID();
  const directory = mkdtempSync(join(tmpdir(), "niceeval-e2e-resources-"));
  return {
    owner,
    directory,
    env: {
      ...env,
      NICEEVAL_E2E_RESOURCE_REGISTRY: directory,
      NICEEVAL_E2E_RESOURCE_OWNER: owner,
      NICEEVAL_E2E_DOCKER_ENDPOINT: createHash("sha256").update(JSON.stringify(settings)).digest("hex"),
    },
  };
}
export type TestkitRegistry = ReturnType<typeof createTestkitRegistry>;

function codeOf(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function procFields(pid: number): string[] | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/u);
  } catch (error) {
    if (codeOf(error) === "ENOENT") return undefined;
    throw error;
  }
}

function reclaimProcess(
  entry: ProcessRegistration,
  graceMs: number,
  liveGroup: (pid: number) => boolean,
): Promise<string | undefined> {
  const name = `${entry.kind} ${entry.pid}`;
  return (async () => {
    const group = entry.kind === "process-group";
    const running = () => {
      const fields = procFields(entry.pid);
      if (fields !== undefined && entry.birth !== undefined && fields[19] !== entry.birth) return false;
      if (group) return liveGroup(entry.pid);
      if (process.platform === "linux") return fields !== undefined && fields[0] !== "Z" && fields[0] !== "X";
      process.kill(entry.pid, 0);
      return true;
    };
    try {
      if (entry.pid === process.pid) return `${name}: recording process cannot be the runner`;
      if (!running()) return undefined;
      const target = group ? -entry.pid : entry.pid;
      process.kill(target, "SIGTERM");
      const deadline = performance.now() + graceMs;
      const killAt = performance.now() + graceMs / 2;
      let escalated = false;
      while (running() && performance.now() < deadline) {
        if (!escalated && performance.now() >= killAt) {
          process.kill(target, "SIGKILL");
          escalated = true;
        }
        await delay(Math.min(25, graceMs / 4));
      }
      return running() ? `${name}: still running or unverified after cleanup` : undefined;
    } catch (error) {
      return codeOf(error) === "ESRCH" ? undefined : `${name}: cleanup could not be confirmed`;
    }
  })();
}

async function reclaimDocker(registry: TestkitRegistry, cwd: string, graceMs: number): Promise<string | undefined> {
  const deadline = performance.now() + graceMs;
  const docker = (args: readonly string[]) =>
    new Promise<string>((resolve, reject) => {
      const timeout = Math.floor(deadline - performance.now());
      if (timeout <= 0) {
        reject(new Error("Docker cleanup budget expired"));
        return;
      }
      execFile("docker", args, { cwd, env: registry.env, timeout, killSignal: "SIGKILL" }, (error, stdout) =>
        error === null ? resolve(stdout) : reject(error),
      );
    });
  const list = async () => {
    const output = await docker([
      "ps",
      "--all",
      "--quiet",
      "--no-trunc",
      "--filter",
      `label=${dockerOwnerLabel}=${registry.owner}`,
    ]);
    const ids = output.trim().split(/\s+/u).filter(Boolean);
    if (ids.some((id) => !/^[0-9a-f]{64}$/u.test(id))) throw new Error("Docker did not return exact container IDs");
    return ids;
  };
  let ids: readonly string[] = [];
  try {
    ids = await list();
    if (ids.length === 0) return undefined;
    // The container can disappear through --rm between listing and removal.
    await docker(["rm", "--force", ...ids]).catch(() => {});
    ids = await list();
    return ids.length === 0 ? undefined : `Docker containers still present: ${ids.join(", ")}`;
  } catch {
    return (
      `Docker cleanup could not be confirmed for ${dockerOwnerLabel}=${registry.owner}` +
      (ids.length === 0 ? "" : ` (last observed: ${ids.join(", ")})`)
    );
  }
}

export async function reclaimTestkitResources(
  registry: TestkitRegistry,
  cwd: string,
  graceMs: number,
  liveGroup: (pid: number) => boolean,
): Promise<ResourceCleanup | undefined> {
  const residual: string[] = [];
  const scenarioOwned = new Set<string>();
  const visited = new Set<string>();
  const deadline = performance.now() + graceMs;
  try {
    writeFileSync(join(registry.directory, "closing"), "");
    for (;;) {
      const pending: Promise<string | undefined>[] = [];
      const incomplete: string[] = [];
      for (const name of readdirSync(registry.directory)) {
        if (!name.endsWith(".json") || visited.has(name)) continue;
        try {
          const entry = Schema.decodeUnknownSync(registration)(
            JSON.parse(readFileSync(join(registry.directory, name), "utf8")),
          );
          if (entry.kind === "pending-process") {
            incomplete.push(name);
            continue;
          }
          visited.add(name);
          const remaining = Math.max(1, deadline - performance.now());
          if (entry.kind === "scenario") scenarioOwned.add(entry.detail);
          else if (entry.kind === "docker") {
            if (entry.owner !== registry.owner) throw new Error("Docker ownership marker did not match");
            pending.push(reclaimDocker(registry, cwd, remaining));
          } else pending.push(reclaimProcess(entry, remaining, liveGroup));
        } catch (error) {
          if (codeOf(error) !== "ENOENT") {
            visited.add(name);
            residual.push(`resource registration ${name} could not be read`);
          }
        }
      }
      if (pending.length > 0) {
        for (const detail of await Promise.all(pending)) if (detail !== undefined) residual.push(detail);
        continue;
      }
      for (const name of incomplete) residual.push(`process launch ${name} did not publish a PID`);
      break;
    }
  } catch {
    residual.push("Testkit resource registry could not be read");
  }
  try {
    rmSync(registry.directory, { recursive: true, force: true });
  } catch {
    residual.push(`Testkit resource registry could not be removed: ${registry.directory}`);
  }
  return visited.size === 0 && residual.length === 0 && scenarioOwned.size === 0
    ? undefined
    : { ok: residual.length === 0, residual, scenarioOwned: [...scenarioOwned] };
}
