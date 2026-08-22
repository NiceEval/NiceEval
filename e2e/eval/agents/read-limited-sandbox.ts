import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, access, cp } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { acquireProcessFileLock } from "@niceeval/testkit";
import type { CommandOptions, CommandResult, Sandbox, SuccessfulCommandResult } from "niceeval/sandbox";

const MAXIMUM_SINGLE_READ_BYTES = 4_000_000;
const HOST_LEDGER_LOCK = "/tmp/niceeval-e2e-host-sandbox-ledger.lock";

function pathIn(workdir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(workdir, path);
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
          reject(options.signal?.reason ?? new Error("read-limited Sandbox command aborted"));
          return;
        }
        if (termination === "timeout") {
          reject(new Error(`read-limited Sandbox command timed out after ${options.timeoutMs}ms`));
          return;
        }
        resolveResult({ stdout, stderr, exitCode: code ?? 0 });
      }, reject);
    });
  });
}

/** Test-only custom provider whose file API rejects every read over 4,000,000 bytes. */
export async function createReadLimitedSandbox(workdir = process.cwd()): Promise<Sandbox> {
  const releaseHostLedgerLock = await acquireProcessFileLock(HOST_LEDGER_LOCK, {
    timeoutMs: 120_000,
    label: "read-limited provider host ledger lock",
  });
  const runtimeRoot = resolve(workdir, ".niceeval-e2e-runtime", "read-limited-provider");
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
  const readBytes = async (path: string): Promise<Uint8Array> => {
    const bytes = await readFile(pathIn(workdir, path));
    if (bytes.byteLength > MAXIMUM_SINGLE_READ_BYTES) {
      throw new Error(`provider single-read limit exceeded: ${bytes.byteLength} > ${MAXIMUM_SINGLE_READ_BYTES}`);
    }
    return bytes;
  };
  const writeBytes = async (path: string, content: Uint8Array): Promise<void> => {
    const target = pathIn(workdir, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };
  return {
    sandboxId: "read-limited-e2e",
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
    stop: releaseHostLedgerLock,
  };
}
