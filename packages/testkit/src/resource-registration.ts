import type { ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Argv } from "./process.js";

const registry = () => process.env.NICEEVAL_E2E_RESOURCE_REGISTRY;
const ownerLabel = "dev.niceeval.e2e.owner";

function register(entry: object, name: string = randomUUID()): () => void {
  const directory = registry();
  if (directory === undefined) return () => {};
  const path = join(directory, `${name}.json`);
  const pending = join(directory, `${randomUUID()}.tmp`);
  try {
    writeFileSync(pending, JSON.stringify(entry), { flag: "wx" });
    renameSync(pending, path);
  } catch (error) {
    rmSync(pending, { force: true });
    throw error;
  }
  return () => rmSync(path, { force: true });
}

function errorCode(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

function birthOf(pid: number): string | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(/\s+/u)[19];
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    return undefined;
  }
}

export function registerProcess(pid: number, group: boolean): () => void {
  if (registry() === undefined) return () => {};
  return register({ kind: group ? "process-group" : "process", pid, birth: birthOf(pid) });
}

function registerSpawn(child: ChildProcess, group: boolean): void {
  const pid = child.pid;
  if (pid === undefined || registry() === undefined) return;
  let release: () => void;
  try {
    release = registerProcess(pid, group);
  } catch (error) {
    child.once("error", () => {});
    try {
      if (group) process.kill(-pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch (signalError) {
      if (errorCode(signalError) !== "ESRCH") throw signalError;
    }
    throw error;
  }
  child.once("exit", () => {
    if (!group) {
      release();
      return;
    }
    try {
      process.kill(-pid, 0);
    } catch (error) {
      if (errorCode(error) === "ESRCH") release();
    }
  });
}

export function spawnTestkitProcess<A extends ChildProcess>(
  argv: Argv,
  env: NodeJS.ProcessEnv,
  group: boolean,
  spawn: (command: Argv) => A,
): A {
  const directory = registry();
  if (directory === undefined) return spawn(argv);
  const assertOpen = () => {
    if (!existsSync(directory) || existsSync(join(directory, "closing")))
      throw new Error("E2E runner is already cleaning up Testkit resources");
  };
  assertOpen();
  const release = register({ kind: "pending-process" });
  try {
    assertOpen();
    const child = spawn(registerDockerLaunch(argv, env));
    registerSpawn(child, group);
    return child;
  } finally {
    release();
  }
}

function registerDockerLaunch(argv: Argv, env: NodeJS.ProcessEnv): Argv {
  const owner = process.env.NICEEVAL_E2E_RESOURCE_OWNER;
  if (registry() === undefined || owner === undefined || !["docker", "docker.exe"].includes(basename(argv[0])))
    return argv;
  const command = argv[1];
  if (command === "run" || command === "create") {
    if (
      argv[0] === "docker" &&
      dockerEndpoint(env) === process.env.NICEEVAL_E2E_DOCKER_ENDPOINT &&
      !argv.some((arg) => arg.includes(ownerLabel))
    ) {
      register({ kind: "docker", owner }, "docker");
      return [argv[0], command, "--label", `${ownerLabel}=${owner}`, ...argv.slice(2)];
    }
    register({ kind: "scenario", detail: `docker ${command}: custom daemon or ownership label` });
  } else if (
    command === "start" ||
    (command === "compose" && ["up", "run", "create", "start", "watch"].includes(argv[2] ?? "")) ||
    (command === "container" && ["run", "create", "start"].includes(argv[2] ?? "")) ||
    (command?.startsWith("-") === true && argv.some((arg) => ["run", "create", "compose"].includes(arg)))
  ) {
    register({ kind: "scenario", detail: "docker container launch cannot be tracked through this command form" });
  }
  return argv;
}

function dockerEndpoint(env: NodeJS.ProcessEnv): string {
  const settings = Object.entries(env).filter(
    ([name, value]) => (name.startsWith("DOCKER_") || name === "HOME") && value !== undefined,
  );
  settings.sort(([left], [right]) => left.localeCompare(right));
  return createHash("sha256").update(JSON.stringify(settings)).digest("hex");
}
