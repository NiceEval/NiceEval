import { posix } from "node:path";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandOptions, Sandbox } from "../types.ts";
import { withSandboxIoRetry } from "./io-retry.ts";
import { enrichTransferErrors, withTransferErrors } from "./transfer-errors.ts";
import { putSandboxContent, successfulCommandResult } from "./operations.ts";
import {
  providerBoundaryEffect,
  providerCompatibilityPromise,
  registerSandboxCapabilities,
  type SandboxProviderBackend,
} from "./backend.ts";
import type { SandboxRequestExecutor } from "./request-executor.ts";

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
 * resource facade:不捕获 Attempt executor、不做 IO 重试,只供 registry / stop / suspend 等
 * 内部流程与 provider backend 归一化使用。作者面的可中断请求走 makeSandboxAuthorFacade。
 *
 * @param provider physical plan 已确定的 provider 名，只用于报错点名是谁的 SDK
 * 在超时(见 transfer-errors.ts);省略时报错说 `sandbox`,行为不变。
 */
export function normalizeSandboxPaths(sandbox: SandboxProviderBackend, provider: string): Sandbox {
  const appendLog = sandbox.capabilities.appendLog;
  let normalized!: Sandbox;
  normalized = {
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
      providerCompatibilityPromise(() => sandbox.runCommand(cmd, args, resolveCommandOptions(sandbox.workdir, opts))),
    runShell: (script, opts) =>
      providerCompatibilityPromise(() => sandbox.runShell(script, resolveCommandOptions(sandbox.workdir, opts))),
    runCommandOrThrow: (cmd, args, opts) => {
      const resolved = resolveCommandOptions(sandbox.workdir, opts);
      return providerCompatibilityPromise(async () => successfulCommandResult(
        await sandbox.runCommand(cmd, args, resolved),
        resolved?.sensitiveValues,
      ));
    },
    runShellOrThrow: (script, opts) => {
      const resolved = resolveCommandOptions(sandbox.workdir, opts);
      return providerCompatibilityPromise(async () => successfulCommandResult(
        await sandbox.runShell(script, resolved),
        resolved?.sensitiveValues,
      ));
    },
    readText: (path) => providerCompatibilityPromise(() =>
      sandbox.readText(resolveSandboxPath(sandbox.workdir, path)),
    ),
    writeText: (path, content) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return providerCompatibilityPromise(() => withTransferErrors(
        { provider, operation: "writeText", path: abs, bytes: Buffer.byteLength(content) },
        () => sandbox.writeText(abs, content),
      ));
    },
    readBytes: (path) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return providerCompatibilityPromise(() => withTransferErrors({ provider, operation: "readBytes", path: abs }, () =>
        sandbox.readBytes(abs),
      ));
    },
    writeBytes: (path, content) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return providerCompatibilityPromise(() => withTransferErrors(
        { provider, operation: "writeBytes", path: abs, bytes: content.byteLength },
        () => sandbox.writeBytes(abs, content),
      ));
    },
    pathExists: (path) => providerCompatibilityPromise(() =>
      sandbox.pathExists(resolveSandboxPath(sandbox.workdir, path)),
    ),
    upload: (content, targetPath) => putSandboxContent(normalized, content, targetPath),
    uploadFile: (source, targetPath) => {
      const abs = resolveSandboxPath(sandbox.workdir, targetPath);
      return providerCompatibilityPromise(() => withTransferErrors(
        { provider, operation: "uploadFile", path: abs, localPath: resolveLocalPath(undefined, source) },
        () => sandbox.uploadFile(source, abs),
      ));
    },
    uploadDirectory: (sourceDir, targetDir, opts) => {
      const base = resolveSandboxPath(sandbox.workdir, targetDir);
      return providerCompatibilityPromise(() => withTransferErrors(
        { provider, operation: "uploadDirectory", path: base, localPath: resolveLocalPath(undefined, sourceDir) },
        () => sandbox.uploadDirectory(sourceDir, base, opts),
      ));
    },
    downloadFile: (sourcePath, target) => {
      const abs = resolveSandboxPath(sandbox.workdir, sourcePath);
      return providerCompatibilityPromise(() => withTransferErrors({ provider, operation: "downloadFile", path: abs, localPath: resolveLocalPath(undefined, target) }, () =>
        sandbox.downloadFile(abs, target),
      ));
    },
    downloadDirectory: (sourceDir, targetDir, opts) => {
      const base = resolveSandboxPath(sandbox.workdir, sourceDir);
      return providerCompatibilityPromise(() => withTransferErrors(
        { provider, operation: "downloadDirectory", path: base, localPath: resolveLocalPath(undefined, targetDir) },
        () => sandbox.downloadDirectory(base, targetDir, opts),
      ));
    },
    stop: () => providerCompatibilityPromise(() => sandbox.stop()),
    ...(appendLog._tag === "Supported"
      ? { appendLog: (line: string) => providerCompatibilityPromise(() => appendLog.value(line)) }
      : {}),
  };
  registerSandboxCapabilities(normalized, sandbox.capabilities);
  return normalized;
}

/**
 * author facade:Attempt 作者面拿到的那份 Sandbox。所有公开方法都经 executor 作为
 * owner Scope 子 fiber 运行(Scope 关闭统一中断);只有幂等 IO/transfer 使用 Effect 型
 * withSandboxIoRetry,runCommand / runShell / appendLog / stop 一律不重试。路径解析在
 * 调用点做一次;provider Promise 叶子只经 providerBoundaryEffect 适配一次,重试分类只
 * 看到 raw provider 失败,transfer 超时 enrichment 在重试耗尽后做一次(见 transfer-errors.ts)。
 *
 * 文件传输的超时报错在终局失败上补齐三要素(操作名 / 对象 / 这是 SDK 往返超时而非 attempt
 * 预算):provider 各家 SDK 抛的裸超时串没有任何上下文,读到它的人会跑去调 --timeout。
 * 只有超时形态被改写,其它错误原样上抛(见 transfer-errors.ts)。
 */
export function makeSandboxAuthorFacade(
  sandbox: SandboxProviderBackend,
  executor: SandboxRequestExecutor,
  provider: string,
): Sandbox {
  const appendLog = sandbox.capabilities.appendLog;
  let normalized!: Sandbox;
  normalized = {
    get workdir() {
      return sandbox.workdir;
    },
    get sandboxId() {
      return sandbox.sandboxId;
    },
    get otlpHost() {
      return sandbox.otlpHost;
    },
    runCommand: (cmd, args, opts) => {
      const resolved = resolveCommandOptions(sandbox.workdir, opts);
      return executor.run(providerBoundaryEffect(() => sandbox.runCommand(cmd, args, resolved)));
    },
    runShell: (script, opts) => {
      const resolved = resolveCommandOptions(sandbox.workdir, opts);
      return executor.run(providerBoundaryEffect(() => sandbox.runShell(script, resolved)));
    },
    runCommandOrThrow: (cmd, args, opts) => {
      const resolved = resolveCommandOptions(sandbox.workdir, opts);
      return executor.run(providerBoundaryEffect(async () => successfulCommandResult(
        await sandbox.runCommand(cmd, args, resolved),
        resolved?.sensitiveValues,
      )));
    },
    runShellOrThrow: (script, opts) => {
      const resolved = resolveCommandOptions(sandbox.workdir, opts);
      return executor.run(providerBoundaryEffect(async () => successfulCommandResult(
        await sandbox.runShell(script, resolved),
        resolved?.sensitiveValues,
      )));
    },
    readText: (path) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return executor.run(withSandboxIoRetry(providerBoundaryEffect(() => sandbox.readText(abs))));
    },
    writeText: (path, content) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return executor.run(withSandboxIoRetry(providerBoundaryEffect(() => sandbox.writeText(abs, content))).pipe(
        enrichTransferErrors({ provider, operation: "writeText", path: abs, bytes: Buffer.byteLength(content) }),
      ));
    },
    readBytes: (path) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return executor.run(withSandboxIoRetry(providerBoundaryEffect(() => sandbox.readBytes(abs))).pipe(
        enrichTransferErrors({ provider, operation: "readBytes", path: abs }),
      ));
    },
    writeBytes: (path, content) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return executor.run(withSandboxIoRetry(providerBoundaryEffect(() => sandbox.writeBytes(abs, content))).pipe(
        enrichTransferErrors({ provider, operation: "writeBytes", path: abs, bytes: content.byteLength }),
      ));
    },
    pathExists: (path) => {
      const abs = resolveSandboxPath(sandbox.workdir, path);
      return executor.run(withSandboxIoRetry(providerBoundaryEffect(() => sandbox.pathExists(abs))));
    },
    upload: (content, targetPath) => putSandboxContent(normalized, content, targetPath),
    uploadFile: (source, targetPath) => {
      const abs = resolveSandboxPath(sandbox.workdir, targetPath);
      return executor.run(withSandboxIoRetry(providerBoundaryEffect(() => sandbox.uploadFile(source, abs))).pipe(
        enrichTransferErrors({ provider, operation: "uploadFile", path: abs, localPath: resolveLocalPath(undefined, source) }),
      ));
    },
    uploadDirectory: (sourceDir, targetDir, opts) => {
      const base = resolveSandboxPath(sandbox.workdir, targetDir);
      return executor.run(withSandboxIoRetry(providerBoundaryEffect(() => sandbox.uploadDirectory(sourceDir, base, opts))).pipe(
        enrichTransferErrors({ provider, operation: "uploadDirectory", path: base, localPath: resolveLocalPath(undefined, sourceDir) }),
      ));
    },
    downloadFile: (sourcePath, target) => {
      const abs = resolveSandboxPath(sandbox.workdir, sourcePath);
      return executor.run(withSandboxIoRetry(providerBoundaryEffect(() => sandbox.downloadFile(abs, target))).pipe(
        enrichTransferErrors({ provider, operation: "downloadFile", path: abs, localPath: resolveLocalPath(undefined, target) }),
      ));
    },
    downloadDirectory: (sourceDir, targetDir, opts) => {
      const base = resolveSandboxPath(sandbox.workdir, sourceDir);
      return executor.run(withSandboxIoRetry(providerBoundaryEffect(() => sandbox.downloadDirectory(base, targetDir, opts))).pipe(
        enrichTransferErrors({ provider, operation: "downloadDirectory", path: base, localPath: resolveLocalPath(undefined, targetDir) }),
      ));
    },
    stop: () => executor.run(providerBoundaryEffect(() => sandbox.stop())),
    ...(appendLog._tag === "Supported"
      ? { appendLog: (line: string) => executor.run(providerBoundaryEffect(() => appendLog.value(line))) }
      : {}),
  };
  registerSandboxCapabilities(normalized, sandbox.capabilities);
  return normalized;
}
