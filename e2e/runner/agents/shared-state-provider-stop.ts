import { spawn } from "node:child_process";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { acquireProcessFileLock } from "@niceeval/testkit";
import { Effect } from "effect";
import { completeEvidenceCoverage, defineSandboxAgent } from "niceeval/adapter";
import {
  defineSandbox,
  shell,
  type CommandOptions,
  type CommandResult,
  type Sandbox,
  type SuccessfulCommandResult,
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

function runProcess(
  workdir: string,
  controlledEnv: NodeJS.ProcessEnv,
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args], {
      cwd: pathIn(workdir, options.cwd ?? workdir),
      env: { ...controlledEnv, ...options.env },
    });
    let stdout = "";
    let stderr = "";
    let callbacks = Promise.resolve();
    let termination: "timeout" | "abort" | undefined;
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      termination = "timeout";
      child.kill("SIGKILL");
    }, options.timeoutMs);
    const abort = (): void => {
      termination = "abort";
      child.kill("SIGKILL");
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stdout += text;
      if (options.onStdout !== undefined) callbacks = callbacks.then(() => options.onStdout!(text));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      if (options.onStderr !== undefined) callbacks = callbacks.then(() => options.onStderr!(text));
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      void callbacks.then(() => {
        if (termination === "abort") {
          reject(options.signal?.reason ?? new Error("provider-stop fixture command aborted"));
          return;
        }
        if (termination === "timeout") {
          reject(new Error(`provider-stop fixture command timed out after ${options.timeoutMs}ms`));
          return;
        }
        resolveResult({ stdout, stderr, exitCode: code ?? 0 });
      }, reject);
    });
  });
}

/** A public custom Provider whose group.stop boundary can fail deterministically. */
async function createProviderStopSandbox(workdir = process.cwd()): Promise<Sandbox> {
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
  const orThrow = async (result: Promise<CommandResult>): Promise<SuccessfulCommandResult> => {
    const settled = await result;
    if (settled.exitCode !== 0) throw new Error(settled.stderr || settled.stdout || `command exited ${settled.exitCode}`);
    return { ...settled, exitCode: 0 };
  };
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
    runCommandOrThrow: (command, args, options) => orThrow(runCommand(command, args, options)),
    runShellOrThrow: (script, options) => orThrow(runShell(script, options)),
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
    setup: () => Effect.tryPromise({
      try: async () => {
      if (barrierRoot === undefined) return;
      await mark(`${role}-setup-attempted`);
      await writeFile(join(barrierRoot, "provider-stop-external-state-owner"), role, { flag: "wx" });
      await mark(`${role}-setup-complete`);

      },
      catch: (cause) => cause,
    }),
    teardown: () => Effect.tryPromise({
      try: async () => {
      if (barrierRoot === undefined) return;
      await rm(join(barrierRoot, "provider-stop-external-state-owner"), { force: true });
      await mark(`${role}-teardown-complete`);

      },
      catch: (cause) => cause,
    }),
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
  send: (_input, ctx) => Effect.tryPromise({
      try: async () => {
    const role = typeof ctx.flags.role === "string" ? ctx.flags.role : "unknown";
    await mark(`${role}-agent-started`);
    return { status: "completed", events: [{ type: "message", role: "assistant", text: "provider-stop-fixture-ok" }] };

      },
      catch: (cause) => cause,
    }),
});
