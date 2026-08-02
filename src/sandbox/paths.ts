import { posix } from "node:path";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandOptions, Sandbox } from "../types.ts";
import { withSandboxIoRetry } from "./io-retry.ts";
import { withTransferErrors } from "./transfer-errors.ts";
import { successfulCommandResult } from "./operations.ts";
import {
  registerSandboxCapabilities,
  runProviderBoundary,
  type SandboxProviderBackend,
} from "./backend.ts";

export function resolveSandboxPath(workdir: string, path?: string): string {
  if (!path || path === ".") return workdir;
  return path.startsWith("/") ? path : posix.join(workdir, path);
}

export function resolveLocalPath(baseDir: string | undefined, path: string | URL): string {
  if (path instanceof URL) return fileURLToPath(path);
  if (!baseDir || isAbsolute(path)) return path;
  return resolve(baseDir, path);
}

/** Eval 作者面的宿主传输锚点：只展开相对字符串，URL 必须原样穿过视图包装。 */
export function resolveEvalLocalPath(baseDir: string | undefined, path: string | URL): string | URL {
  return path instanceof URL ? path : resolveLocalPath(baseDir, path);
}

function resolveCommandOptions(workdir: string, opts: CommandOptions | undefined): CommandOptions | undefined {
  if (!opts?.cwd) return opts;
  return { ...opts, cwd: resolveSandboxPath(workdir, opts.cwd) };
}

/**
 * @param provider physical plan 已确定的 provider 名，只用于报错点名是谁的 SDK
 * 在超时(见 transfer-errors.ts);省略时报错说 `sandbox`,行为不变。
 */
export function normalizeSandboxPaths(sandbox: SandboxProviderBackend, provider: string): Sandbox {
  const appendLog = sandbox.capabilities.appendLog;
  const normalized: Sandbox = {
    get workdir() {
      return sandbox.workdir;
    },
    get sandboxId() {
      return sandbox.sandboxId;
    },
    get otlpHost() {
      return sandbox.otlpHost;
    },
    runCommand: (cmd, args, opts) =>
      runProviderBoundary(() => sandbox.runCommand(cmd, args, resolveCommandOptions(sandbox.workdir, opts))),
    runShell: (script, opts) =>
      runProviderBoundary(() => sandbox.runShell(script, resolveCommandOptions(sandbox.workdir, opts))),
    runCommandOrThrow: (cmd, args, opts) =>
      runProviderBoundary(async () => successfulCommandResult(
        await sandbox.runCommand(cmd, args, resolveCommandOptions(sandbox.workdir, opts)),
      )),
    runShellOrThrow: (script, opts) =>
      runProviderBoundary(async () =>
        successfulCommandResult(await sandbox.runShell(script, resolveCommandOptions(sandbox.workdir, opts))),
      ),
    readText: (path) => runProviderBoundary(() =>
      withSandboxIoRetry(() => sandbox.readText(resolveSandboxPath(sandbox.workdir, path))),
    ),
    writeText: (path, content) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return runProviderBoundary(() => withTransferErrors(
        { provider, operation: "writeText", path: abs, bytes: Buffer.byteLength(content) },
        () => withSandboxIoRetry(() => sandbox.writeText(abs, content)),
      ));
    },
    readBytes: (path) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return runProviderBoundary(() => withTransferErrors({ provider, operation: "readBytes", path: abs }, () =>
        withSandboxIoRetry(() => sandbox.readBytes(abs)),
      ));
    },
    writeBytes: (path, content) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return runProviderBoundary(() => withTransferErrors(
        { provider, operation: "writeBytes", path: abs, bytes: content.byteLength },
        () => withSandboxIoRetry(() => sandbox.writeBytes(abs, content)),
      ));
    },
    pathExists: (path) => runProviderBoundary(() =>
      withSandboxIoRetry(() => sandbox.pathExists(resolveSandboxPath(sandbox.workdir, path))),
    ),
    // 文件传输的超时报错在这一层补齐三要素(操作名 / 对象 / 这是 SDK 往返超时而非 attempt
    // 预算):provider 各家 SDK 抛的裸超时串没有任何上下文,读到它的人会跑去调 --timeout。
    // 只有超时形态被改写,其它错误原样上抛(见 transfer-errors.ts)。
    uploadFile: (source, targetPath) => {
      const abs = resolveSandboxPath(sandbox.workdir, targetPath);
      return runProviderBoundary(() => withTransferErrors(
        { provider, operation: "uploadFile", path: abs, localPath: resolveLocalPath(undefined, source) },
        () => withSandboxIoRetry(() => sandbox.uploadFile(source, abs)),
      ));
    },
    uploadDirectory: (sourceDir, targetDir, opts) => {
      const base = resolveSandboxPath(sandbox.workdir, targetDir);
      return runProviderBoundary(() => withTransferErrors(
        { provider, operation: "uploadDirectory", path: base, localPath: resolveLocalPath(undefined, sourceDir) },
        () => withSandboxIoRetry(() => sandbox.uploadDirectory(sourceDir, base, opts)),
      ));
    },
    downloadFile: (sourcePath, target) => {
      const abs = resolveSandboxPath(sandbox.workdir, sourcePath);
      return runProviderBoundary(() => withTransferErrors({ provider, operation: "downloadFile", path: abs, localPath: resolveLocalPath(undefined, target) }, () =>
        withSandboxIoRetry(() => sandbox.downloadFile(abs, target)),
      ));
    },
    downloadDirectory: (sourceDir, targetDir, opts) => {
      const base = resolveSandboxPath(sandbox.workdir, sourceDir);
      return runProviderBoundary(() => withTransferErrors(
        { provider, operation: "downloadDirectory", path: base, localPath: resolveLocalPath(undefined, targetDir) },
        () => withSandboxIoRetry(() => sandbox.downloadDirectory(base, targetDir, opts)),
      ));
    },
    stop: () => runProviderBoundary(() => sandbox.stop()),
    ...(appendLog._tag === "Supported"
      ? { appendLog: (line: string) => runProviderBoundary(() => appendLog.value(line)) }
      : {}),
  };
  registerSandboxCapabilities(normalized, sandbox.capabilities);
  return normalized;
}
