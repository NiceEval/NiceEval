import { runManagedProcess } from "@niceeval/testkit";
import { access, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type {
  CommandOptions,
  CommandResult,
  CustomProviderSandbox,
} from "niceeval/sandbox";

function pathIn(workdir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(workdir, path);
}

async function runProcess(
  workdir: string,
  controlledEnv: NodeJS.ProcessEnv,
  mapPrivateText: (value: string) => string,
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): Promise<CommandResult> {
  const environment = Object.fromEntries(
    Object.entries({ ...controlledEnv, ...options.env })
      .filter((entry): entry is [string, string] => entry[1] !== undefined)
      .map(([key, value]) => [key, value === "/tmp" ? controlledEnv.TMPDIR! : mapPrivateText(value)]),
  );
  const receipt = await runManagedProcess(
    [mapPrivateText(command), ...args.map(mapPrivateText)] as [string, ...string[]],
    {
      cwd: pathIn(workdir, mapPrivateText(options.cwd ?? workdir)),
      env: environment,
      envMode: "replace",
      processGroup: true,
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.onStdout === undefined ? {} : { onStdout: options.onStdout }),
      ...(options.onStderr === undefined ? {} : { onStderr: options.onStderr }),
    },
  );
  if (receipt.timedOut) throw new Error(`inspection Sandbox command timed out after ${options.timeoutMs}ms`);
  return { stdout: receipt.stdout, stderr: receipt.stderr, exitCode: receipt.exitCode ?? 1 };
}

/** Test-only local process provider for real command, timing, and diff evidence. */
export async function createInspectionProcessSandbox(workdir = process.cwd()): Promise<CustomProviderSandbox> {
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
      await cp(privatePath(sourceDir), targetDir, { recursive: true });
    },
    stop: async () => rm(runtimeRoot, { recursive: true, force: true }),
  };
}
