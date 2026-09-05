import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { acquireProcessFileLock, runManagedProcess } from "@niceeval/testkit";
import { Effect } from "effect";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import {
  defineSandbox,
  shell,
  type CommandOptions,
  type CommandResult,
  type CustomProviderSandbox,
} from "niceeval/sandbox";

const barrierRoot = process.env.NICEEVAL_SHARED_STATE_PROVIDER_STOP_BARRIER;
const failProviderStop = process.env.NICEEVAL_SHARED_STATE_PROVIDER_STOP_FAIL === "1";
const HOST_LEDGER_LOCK = "/tmp/niceeval-e2e-host-sandbox-ledger.lock";

function pathIn(workdir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(workdir, path);
}

async function mark(name: string): Promise<void> {
  if (barrierRoot === undefined) return;
  await mkdir(barrierRoot, { recursive: true });
  await writeFile(join(barrierRoot, name), "");
}

async function runProcess(
  workdir: string,
  controlledEnv: NodeJS.ProcessEnv,
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const receipt = await runManagedProcess([command, ...args] as [string, ...string[]], {
    cwd: pathIn(workdir, options.cwd ?? workdir),
    env: { ...controlledEnv, ...options.env },
    envMode: "replace",
    processGroup: true,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onStdout === undefined ? {} : { onStdout: options.onStdout }),
    ...(options.onStderr === undefined ? {} : { onStderr: options.onStderr }),
  });
  if (receipt.timedOut) throw new Error(`provider-stop fixture command timed out after ${options.timeoutMs}ms`);
  return { stdout: receipt.stdout, stderr: receipt.stderr, exitCode: receipt.exitCode ?? 1 };
}

/** A public custom Provider whose group.stop boundary can fail deterministically. */
async function createProviderStopSandbox(workdir = process.cwd()): Promise<CustomProviderSandbox> {
  const releaseHostLedgerLock = await acquireProcessFileLock(HOST_LEDGER_LOCK, {
    timeoutMs: 120_000,
    label: "provider-stop fixture host ledger lock",
  });
  const runtimeRoot = resolve(workdir, ".niceeval-e2e-runtime", "provider-stop");
  const home = resolve(runtimeRoot, "home");
  const codexHome = resolve(runtimeRoot, "codex-home");
  const tmpdir = resolve(runtimeRoot, "tmp");
  try {
    await Promise.all([
      mkdir(home, { recursive: true }),
      mkdir(codexHome, { recursive: true }),
      mkdir(tmpdir, { recursive: true }),
    ]);
  } catch (error) {
    await releaseHostLedgerLock();
    throw error;
  }
  const controlledEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    CODEX_HOME: codexHome,
    TMPDIR: tmpdir,
    LANG: "C.UTF-8",
  };
  const runCommand = (command: string, args: readonly string[] = [], options: CommandOptions = {}) =>
    runProcess(workdir, controlledEnv, command, args, options);
  const runShell = (script: string, options: CommandOptions = {}) =>
    runProcess(workdir, controlledEnv, "bash", ["-c", script], options);
  const readBytes = (path: string): Promise<Uint8Array> => readFile(pathIn(workdir, path));
  const writeBytes = async (path: string, content: Uint8Array): Promise<void> => {
    const target = pathIn(workdir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  return {
    sandboxId: "provider-stop-e2e",
    workdir,
    otlpHost: "localhost",
    runCommand,
    runShell,
    readText: (path) => readFile(pathIn(workdir, path), "utf8"),
    writeText: (path, content) => writeBytes(path, Buffer.from(content, "utf8")),
    readBytes,
    writeBytes,
    pathExists: async (path) => access(pathIn(workdir, path)).then(() => true, () => false),
    uploadFile: async (source, targetPath) => writeBytes(targetPath, await readFile(source)),
    uploadDirectory: async (sourceDir, targetDir) => {
      await cp(sourceDir, pathIn(workdir, targetDir ?? "."), { recursive: true });
    },
    downloadFile: async (sourcePath, target) => {
      const destination = target instanceof URL ? target : resolve(target);
      await mkdir(dirname(destination instanceof URL ? destination.pathname : destination), { recursive: true });
      await writeFile(destination, await readBytes(sourcePath));
    },
    downloadDirectory: async (sourceDir, targetDir) => {
      await cp(pathIn(workdir, sourceDir), targetDir, { recursive: true });
    },
    stop: async () => {
      try {
        await mark("provider-group-stop-started");
        if (failProviderStop) throw new Error("deterministic Provider group.stop failure");
        await mark("provider-group-stop-complete");
      } finally {
        await releaseHostLedgerLock();
      }
    },
  };
}

export const sharedStateProviderStopSandbox = defineSandbox({
  name: "runner-provider-stop-failure",
  targetPlatform: {
    _tag: "Linux",
    os: "linux",
    arch: process.arch === "arm64" ? "arm64" : "x64",
    libc: "gnu",
  },
  exclusive: true,
  create: () => Effect.promise(() => createProviderStopSandbox()),
});

export function sharedStateProviderStopHooks(role: string) {
  return {
    async setup() {
      if (barrierRoot === undefined) return;
      await mark(`${role}-setup-attempted`);
      await writeFile(join(barrierRoot, "provider-stop-external-state-owner"), role, { flag: "wx" });
      await mark(`${role}-setup-complete`);
    },
    async teardown() {
      if (barrierRoot === undefined) return;
      await rm(join(barrierRoot, "provider-stop-external-state-owner"), { force: true });
      await mark(`${role}-teardown-complete`);
    },
  };
}

export const sharedStateProviderStopAgent = defineSandboxAgent({
  name: "runner-shared-state-provider-stop",
  evidenceCoverage: {
    ...completeEvidenceCoverage,
    usage: { status: "unavailable", reason: "deterministic Provider stop fixture has no token usage" },
  },
  ensure: {
    identity: { agent: "runner-shared-state-provider-stop", version: "1", revision: "1" },
    probe: shell("true"),
  },
  send: async (_input, ctx) => {
    const role = typeof ctx.flags.role === "string" ? ctx.flags.role : "unknown";
    await mark(`${role}-agent-started`);
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "provider-stop-fixture-ok" }] };
  },
});
