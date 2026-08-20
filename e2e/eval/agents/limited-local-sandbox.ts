import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access, cp, open, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { CommandOptions, CommandResult, Sandbox, SuccessfulCommandResult } from "niceeval/sandbox";

const MAXIMUM_SINGLE_READ_BYTES = 4_000_000;
const HOST_LEDGER_LOCK = "/tmp/niceeval-limited-local-e2e.lock";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) === "EPERM";
  }
}

async function moveExactLockAside(expected: string, suffix: string): Promise<void> {
  const current = await readFile(HOST_LEDGER_LOCK, "utf8").catch(() => undefined);
  if (current !== expected) return;
  const quarantine = `${HOST_LEDGER_LOCK}.${suffix}`;
  await rename(HOST_LEDGER_LOCK, quarantine).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error;
  });
  await rm(quarantine, { force: true });
}

/**
 * This E2E custom Provider deliberately runs on the host, while NiceEval's
 * fallback ledger path is fixed for isolated VMs. Serialize only this fixture
 * across native test processes so concurrent takeover matrices cannot remove
 * one another's private Git ledger. The exact token prevents stale cleanup
 * from deleting a successor's lock.
 */
async function acquireHostLedgerLock(): Promise<() => Promise<void>> {
  const token = `${process.pid}:${randomUUID()}`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const handle = await open(HOST_LEDGER_LOCK, "wx", 0o600);
      try {
        await handle.writeFile(token, "utf8");
      } finally {
        await handle.close();
      }
      return async () => moveExactLockAside(token, `released-${randomUUID()}`);
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
    }

    const current = await readFile(HOST_LEDGER_LOCK, "utf8").catch(() => undefined);
    const ownerPid = current?.match(/^(\d+):/u)?.[1];
    const malformedAgeMs = ownerPid === undefined
      ? await stat(HOST_LEDGER_LOCK).then(({ mtimeMs }) => Date.now() - mtimeMs, () => 0)
      : 0;
    if (
      (ownerPid !== undefined && !processIsAlive(Number(ownerPid))) ||
      (ownerPid === undefined && malformedAgeMs > 5_000)
    ) {
      await moveExactLockAside(current ?? "", `stale-${randomUUID()}`);
      continue;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for host ledger fixture lock ${HOST_LEDGER_LOCK}`);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
}

function pathIn(workdir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(workdir, path);
}

function runProcess(
  workdir: string,
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, [...args], {
      cwd: pathIn(workdir, options.cwd ?? workdir),
      env: { ...process.env, ...options.env },
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
          reject(options.signal?.reason ?? new Error("limited local Sandbox command aborted"));
          return;
        }
        if (termination === "timeout") {
          reject(new Error(`limited local Sandbox command timed out after ${options.timeoutMs}ms`));
          return;
        }
        resolveResult({ stdout, stderr, exitCode: code ?? 0 });
      }, reject);
    });
  });
}

/** Public custom-provider boundary whose file API rejects every read over 4,000,000 bytes. */
export async function createLimitedLocalSandbox(workdir = process.cwd()): Promise<Sandbox> {
  const releaseHostLedgerLock = await acquireHostLedgerLock();
  const runCommand = (command: string, args: readonly string[] = [], options: CommandOptions = {}) =>
    runProcess(workdir, command, args, options);
  const runShell = (script: string, options: CommandOptions = {}) =>
    runProcess(workdir, "bash", ["-c", script], options);
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
    sandboxId: "limited-local-e2e",
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
