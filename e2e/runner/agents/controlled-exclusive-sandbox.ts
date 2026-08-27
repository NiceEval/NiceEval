import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, access, cp } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { acquireProcessFileLock } from "@niceeval/testkit";
import { Effect } from "effect";
import { defineSandbox } from "niceeval/sandbox";
import type { CommandOptions, CommandResult, Sandbox, SuccessfulCommandResult } from "niceeval/sandbox";

const HOST_LEDGER_LOCK = "/tmp/niceeval-e2e-host-sandbox-ledger.lock";

function pathIn(workdir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(workdir, path);
}

function execute(
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
        if (termination === "abort") return reject(options.signal?.reason ?? new Error("controlled provider command aborted"));
        if (termination === "timeout") return reject(new Error(`controlled provider command timed out after ${options.timeoutMs}ms`));
        resolveResult({ stdout, stderr, exitCode: code ?? 0 });
      }, reject);
    });
  });
}

async function createControlledExclusiveSandbox(workdir = process.cwd()): Promise<Sandbox> {
  const releaseHostLedgerLock = await acquireProcessFileLock(HOST_LEDGER_LOCK, {
    timeoutMs: 120_000,
    label: "controlled exclusive provider host ledger lock",
  });
  const runtimeRoot = resolve(workdir, ".niceeval-e2e-runtime", "controlled-exclusive-provider");
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
    execute(workdir, controlledEnv, command, args, options);
  const runShell = (script: string, options: CommandOptions = {}) => execute(workdir, controlledEnv, "bash", ["-c", script], options);
  const orThrow = async (receipt: Promise<CommandResult>): Promise<SuccessfulCommandResult> => {
    const result = await receipt;
    if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout || `command exited ${result.exitCode}`);
    return { ...result, exitCode: 0 };
  };
  const writeBytes = async (path: string, bytes: Uint8Array): Promise<void> => {
    const target = pathIn(workdir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  };
  return {
    sandboxId: "controlled-exclusive-e2e",
    workdir,
    otlpHost: "localhost",
    runCommand,
    runShell,
    runCommandOrThrow: (command, args, options) => orThrow(runCommand(command, args, options)),
    runShellOrThrow: (script, options) => orThrow(runShell(script, options)),
    readText: (path) => readFile(pathIn(workdir, path), "utf8"),
    writeText: (path, content) => writeBytes(path, Buffer.from(content, "utf8")),
    readBytes: (path) => readFile(pathIn(workdir, path)),
    writeBytes,
    pathExists: (path) => access(pathIn(workdir, path)).then(() => true, () => false),
    uploadFile: async (source, target) => writeBytes(target, await readFile(source)),
    uploadDirectory: async (source, target = ".") => cp(source, pathIn(workdir, target), { recursive: true }),
    downloadFile: async (source, target) => writeBytes(
      target instanceof URL ? target.pathname : target,
      await readFile(pathIn(workdir, source)),
    ),
    downloadDirectory: async (source, target) => cp(pathIn(workdir, source), target, { recursive: true }),
    stop: releaseHostLedgerLock,
  };
}

export const controlledExclusiveSandbox = defineSandbox({
  name: "runner-controlled-exclusive",
  targetPlatform: {
    _tag: "Linux",
    os: "linux",
    arch: process.arch === "arm64" ? "arm64" : "x64",
    libc: "gnu",
  },
  exclusive: true,
  create: () => Effect.promise(() => createControlledExclusiveSandbox()),
});
