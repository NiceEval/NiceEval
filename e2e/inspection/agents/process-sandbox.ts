import { spawn } from "node:child_process";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type {
  CommandOptions,
  CommandResult,
  Sandbox,
  SuccessfulCommandResult,
} from "niceeval/sandbox";

function pathIn(workdir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(workdir, path);
}

function runProcess(
  workdir: string,
  controlledEnv: NodeJS.ProcessEnv,
  mapPrivateText: (value: string) => string,
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  return new Promise((resolveResult, reject) => {
    const environment = Object.fromEntries(
      Object.entries({ ...controlledEnv, ...options.env })
        .filter((entry): entry is [string, string] => entry[1] !== undefined)
        .map(([key, value]) => [key, value === "/tmp" ? controlledEnv.TMPDIR! : mapPrivateText(value)]),
    );
    const child = spawn(mapPrivateText(command), args.map(mapPrivateText), {
      cwd: pathIn(workdir, mapPrivateText(options.cwd ?? workdir)),
      env: environment,
    });
    let stdout = "";
    let stderr = "";
    let callbacks = Promise.resolve();
    let termination: "abort" | "timeout" | undefined;
    const timer = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
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
          reject(options.signal?.reason ?? new Error("inspection Sandbox command aborted"));
          return;
        }
        if (termination === "timeout") {
          reject(new Error(`inspection Sandbox command timed out after ${options.timeoutMs}ms`));
          return;
        }
        resolveResult({ stdout, stderr, exitCode: code ?? 0 });
      }, reject);
    });
  });
}

/** Test-only local process provider for real command, timing, and diff evidence. */
export async function createInspectionProcessSandbox(workdir = process.cwd()): Promise<Sandbox> {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "niceeval-inspection-process-"));
  const home = resolve(runtimeRoot, "home");
  const privateTmp = resolve(runtimeRoot, "tmp");
  await Promise.all([mkdir(home, { recursive: true }), mkdir(privateTmp, { recursive: true })]);

  // The production ledger paths are fixed inside a provider's isolated /tmp. This
  // host-process fixture has no mount namespace, so map that private prefix into
  // this Sandbox instance instead of letting parallel E2E processes share it.
  const mapPrivateText = (value: string): string =>
    value.replaceAll("/tmp/.niceeval-ledger", resolve(privateTmp, ".niceeval-ledger"));
  const privatePath = (path: string): string => pathIn(workdir, mapPrivateText(path));

  const controlledEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    TMPDIR: privateTmp,
    LANG: "C.UTF-8",
  };
  const runCommand = (command: string, args: readonly string[] = [], options: CommandOptions = {}) =>
    runProcess(workdir, controlledEnv, mapPrivateText, command, args, options);
  const runShell = (script: string, options: CommandOptions = {}) =>
    runProcess(workdir, controlledEnv, mapPrivateText, "bash", ["-c", script], options);
  const orThrow = async (result: Promise<CommandResult>): Promise<SuccessfulCommandResult> => {
    const settled = await result;
    if (settled.exitCode !== 0) {
      throw new Error(settled.stderr || settled.stdout || `command exited ${settled.exitCode}`);
    }
    return { ...settled, exitCode: 0 };
  };
  const readBytes = (path: string): Promise<Uint8Array> => readFile(privatePath(path));
  const writeBytes = async (path: string, content: Uint8Array): Promise<void> => {
    const target = privatePath(path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  };

  return {
    sandboxId: `inspection-process-sandbox-${basename(runtimeRoot)}`,
    workdir,
    otlpHost: "localhost",
    runCommand,
    runShell,
    runCommandOrThrow: (command, args, options) => orThrow(runCommand(command, args, options)),
    runShellOrThrow: (script, options) => orThrow(runShell(script, options)),
    readText: (path) => readFile(privatePath(path), "utf8"),
    writeText: (path, content) => writeBytes(path, Buffer.from(content, "utf8")),
    readBytes,
    writeBytes,
    pathExists: async (path) => access(privatePath(path)).then(() => true, () => false),
    uploadFile: async (source, targetPath) => writeBytes(targetPath, await readFile(source)),
    uploadDirectory: async (sourceDir, targetDir) => {
      await cp(sourceDir, privatePath(targetDir ?? "."), { recursive: true });
    },
    downloadFile: async (sourcePath, target) => {
      const destination = target instanceof URL ? target.pathname : resolve(target);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, await readBytes(sourcePath));
    },
    downloadDirectory: async (sourceDir, targetDir) => {
      await cp(pathIn(workdir, sourceDir), targetDir, { recursive: true });
    },
    stop: async () => rm(runtimeRoot, { recursive: true, force: true }),
  };
}
