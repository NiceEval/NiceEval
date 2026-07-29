import { posix } from "node:path";
import { isAbsolute, resolve } from "node:path";
import type { CommandOptions, Sandbox } from "../types.ts";
import { withSandboxIoRetry } from "./io-retry.ts";

export function resolveSandboxPath(workdir: string, path?: string): string {
  if (!path || path === ".") return workdir;
  return path.startsWith("/") ? path : posix.join(workdir, path);
}

export function resolveLocalPath(baseDir: string | undefined, path: string): string {
  if (!baseDir || isAbsolute(path)) return path;
  return resolve(baseDir, path);
}

function resolveCommandOptions(workdir: string, opts: CommandOptions | undefined): CommandOptions | undefined {
  if (!opts?.cwd) return opts;
  return { ...opts, cwd: resolveSandboxPath(workdir, opts.cwd) };
}

/**
 * 有留存能力的 provider 实例带一个非公开接口成员 `suspend()`(`Sandbox` 接口不因留存扩大,
 * 契约见 docs/feature/sandbox/architecture.md「留存(keep)与注册表」的最后一段)。与 `keep.ts`
 * 的 `Suspendable` 结构一致但不跨模块共享类型——两处各自按运行时形状做最小声明。
 */
interface Suspendable {
  suspend(): Promise<void>;
}

/**
 * 复用寿命确认同样是「接口之外的可选能力」(见 sandbox/types.ts 的 `SandboxReuseCapability`)。
 * 与 `suspend()` 一模一样的原因必须原样转发:包装丢了它,复用池就探不到 provider 明明实现了的
 * 能力,`sandboxReuse` 会在第一条 Attempt 派发前假报「该 provider 不支持复用」。
 */
interface Reusable {
  ensureLifetime(minRemainingMs: number): Promise<{ ready: true; expiresAt?: string } | { ready: false; reason: string }>;
}

export function normalizeSandboxPaths(sandbox: Sandbox): Sandbox {
  // 留存路径的 sandbox.suspend(见 keep.ts 的 suspendSandbox)在这层包装之后按同一个实例调用——
  // 必须原样转发,否则 --keep-sandbox 的 Sample release 阶段永远找不到这个能力,报
  // "sandbox provider has no suspend capability" 并把现场错误地留在 alive(不省资源、
  // state 也回写不成 dormant)。appendLog 已经是同一种"接口之外的可选能力,原样转发"先例。
  const suspend = (sandbox as unknown as Partial<Suspendable>).suspend;
  const ensureLifetime = (sandbox as unknown as Partial<Reusable>).ensureLifetime;
  return {
    get workdir() {
      return sandbox.workdir;
    },
    get sandboxId() {
      return sandbox.sandboxId;
    },
    get otlpHost() {
      return sandbox.otlpHost;
    },
    runCommand: (cmd, args, opts) => sandbox.runCommand(cmd, args, resolveCommandOptions(sandbox.workdir, opts)),
    runShell: (script, opts) => sandbox.runShell(script, resolveCommandOptions(sandbox.workdir, opts)),
    readFile: (path) => withSandboxIoRetry(() => sandbox.readFile(resolveSandboxPath(sandbox.workdir, path))),
    fileExists: (path) => withSandboxIoRetry(() => sandbox.fileExists(resolveSandboxPath(sandbox.workdir, path))),
    writeFiles: (files, targetDir) => withSandboxIoRetry(
      () => sandbox.writeFiles(files, resolveSandboxPath(sandbox.workdir, targetDir)),
    ),
    uploadFiles: (files, targetDir) => withSandboxIoRetry(
      () => sandbox.uploadFiles(files, resolveSandboxPath(sandbox.workdir, targetDir)),
    ),
    uploadDirectory: (localDir, targetDir, opts) =>
      withSandboxIoRetry(
        () => sandbox.uploadDirectory(localDir, resolveSandboxPath(sandbox.workdir, targetDir), opts),
      ),
    downloadDirectory: (localDir, targetDir, opts) =>
      withSandboxIoRetry(
        () => sandbox.downloadDirectory(localDir, resolveSandboxPath(sandbox.workdir, targetDir), opts),
      ),
    stop: () => sandbox.stop(),
    appendLog: sandbox.appendLog ? (line) => sandbox.appendLog!(line) : undefined,
    downloadFile: (path) => withSandboxIoRetry(
      () => sandbox.downloadFile(resolveSandboxPath(sandbox.workdir, path)),
    ),
    uploadFile: (path, content) => withSandboxIoRetry(
      () => sandbox.uploadFile(resolveSandboxPath(sandbox.workdir, path), content),
    ),
    ...(typeof suspend === "function" ? { suspend: () => suspend.call(sandbox) } : {}),
    ...(typeof ensureLifetime === "function"
      ? { ensureLifetime: (minRemainingMs: number) => ensureLifetime.call(sandbox, minRemainingMs) }
      : {}),
  } as Sandbox;
}
