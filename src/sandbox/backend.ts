// Provider Promise SDK 与公共 Sandbox facade 之间的唯一边界。

import { Cause, Effect, Exit, Option } from "effect";
import type {
  CommandOptions,
  CommandResult,
  Sandbox,
  SandboxTransferOperations,
} from "./types.ts";

export type SandboxBackendSupport<T> =
  | { readonly _tag: "Supported"; readonly value: T }
  | { readonly _tag: "Unsupported" };

export interface SandboxBackendCapabilities {
  readonly appendLog: SandboxBackendSupport<(line: string) => Promise<void>>;
  readonly suspend: SandboxBackendSupport<() => Promise<void>>;
  readonly ensureLifetime: SandboxBackendSupport<
    (minRemainingMs: number) => Promise<{ ready: true; expiresAt?: string } | { ready: false; reason: string }>
  >;
  readonly setCommandDeadline: SandboxBackendSupport<(deadlineAt?: number) => void>;
}

export interface SandboxProviderBackend extends SandboxTransferOperations {
  readonly workdir: string;
  readonly sandboxId: string;
  readonly otlpHost: string | null;
  readonly capabilities: SandboxBackendCapabilities;
  runCommand(command: string, args?: readonly string[], options?: CommandOptions): Promise<CommandResult>;
  runShell(script: string, options?: CommandOptions): Promise<CommandResult>;
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, content: Uint8Array): Promise<void>;
  pathExists(path: string): Promise<boolean>;
  stop(): Promise<void>;
}

export const unsupportedBackendCapability: SandboxBackendSupport<never> = Object.freeze({
  _tag: "Unsupported",
});

export const noSandboxBackendCapabilities: SandboxBackendCapabilities = Object.freeze({
  appendLog: unsupportedBackendCapability,
  suspend: unsupportedBackendCapability,
  ensureLifetime: unsupportedBackendCapability,
  setCommandDeadline: unsupportedBackendCapability,
});

export function supportedBackendCapability<T>(value: T): SandboxBackendSupport<T> {
  return Object.freeze({ _tag: "Supported", value });
}

/** Promise provider SDK 在这一处 lift 成 typed-error Effect；Error 实例原样保留给现有归因逻辑。 */
export function providerBoundaryEffect<T>(operation: () => Promise<T>): Effect.Effect<T, Error> {
  return Effect.tryPromise({
    try: operation,
    catch: (cause) => cause instanceof Error ? cause : new Error(String(cause)),
  });
}

export async function runProviderBoundary<T>(operation: () => Promise<T>): Promise<T> {
  const exit = await Effect.runPromiseExit(providerBoundaryEffect(operation));
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw Cause.squash(exit.cause);
}

/** defineSandbox() 的公共新接口实现显式降成 provider backend；不探测任何旧方法。 */
export function customSandboxBackend(sandbox: Sandbox): SandboxProviderBackend {
  const appendLog = sandbox.appendLog;
  // Provider facade 产出的 Sandbox 再经 runtime 归一化时必须保留 provider-only capabilities；
  // 作者直接返回的普通 Sandbox 没有登记项，仍严格退回 Unsupported，不能靠鸭子类型猜能力。
  const registered = SANDBOX_CAPABILITIES.get(sandbox) ?? noSandboxBackendCapabilities;
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
    capabilities: {
      ...registered,
      appendLog: appendLog === undefined
        ? unsupportedBackendCapability
        : supportedBackendCapability((line) => appendLog.call(sandbox, line)),
    },
    runCommand: (command, args, options) => sandbox.runCommand(command, args, options),
    runShell: (script, options) => sandbox.runShell(script, options),
    readText: (path) => sandbox.readText(path),
    writeText: (path, content) => sandbox.writeText(path, content),
    readBytes: (path) => sandbox.readBytes(path),
    writeBytes: (path, content) => sandbox.writeBytes(path, content),
    pathExists: (path) => sandbox.pathExists(path),
    uploadFile: (source, targetPath) => sandbox.uploadFile(source, targetPath),
    uploadDirectory: (sourceDir, targetDir, options) => sandbox.uploadDirectory(sourceDir, targetDir, options),
    downloadFile: (sourcePath, target) => sandbox.downloadFile(sourcePath, target),
    downloadDirectory: (sourceDir, targetDir, options) => sandbox.downloadDirectory(sourceDir, targetDir, options),
    stop: () => sandbox.stop(),
  };
}

const SANDBOX_CAPABILITIES = new WeakMap<Sandbox, SandboxBackendCapabilities>();

export function registerSandboxCapabilities(sandbox: Sandbox, capabilities: SandboxBackendCapabilities): void {
  SANDBOX_CAPABILITIES.set(sandbox, capabilities);
}

export function sandboxCapabilities(sandbox: Sandbox): SandboxBackendCapabilities {
  const capabilities = SANDBOX_CAPABILITIES.get(sandbox);
  if (capabilities === undefined) {
    throw new Error(`sandbox ${sandbox.sandboxId} was not constructed by the provider facade`);
  }
  return capabilities;
}
