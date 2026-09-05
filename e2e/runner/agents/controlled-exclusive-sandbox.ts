import { mkdir, readFile, writeFile, access, cp } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { acquireProcessFileLock, runManagedProcess } from "@niceeval/testkit";
import { Effect } from "effect";
import { defineSandbox } from "niceeval/sandbox";
import type { CommandOptions, CommandResult, CustomProviderSandbox } from "niceeval/sandbox";

const HOST_LEDGER_LOCK = "/tmp/niceeval-e2e-host-sandbox-ledger.lock";

function pathIn(workdir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(workdir, path);
}

async function execute(
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
  if (receipt.timedOut) throw new Error(`controlled provider command timed out after ${options.timeoutMs}ms`);
  return { stdout: receipt.stdout, stderr: receipt.stderr, exitCode: receipt.exitCode ?? 1 };
}

async function createControlledExclusiveSandbox(workdir = process.cwd()): Promise<CustomProviderSandbox> {
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
