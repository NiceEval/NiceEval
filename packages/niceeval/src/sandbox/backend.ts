// Provider Promise SDK 与公共 Sandbox facade 之间的唯一边界。

import { Data, Effect } from "effect";
import type { SandboxActionState } from "./action.ts";
import type {
  CommandOptions,
  CommandResult,
  Sandbox,
  ManagedProcess,
  ManagedProcessStart,
  SandboxReuseCapability,
  SandboxTransferOperations,
} from "./types.ts";

export type SandboxBackendSupport<T> =
  | { readonly _tag: "Supported"; readonly value: T }
  | { readonly _tag: "Unsupported"; readonly reason: string };

export type SandboxSetupPrefixCacheUnsupportedCode =
  | "provider-unsupported"
  | "profile-managed"
  | "compose"
  | "host-socket"
  | "read-only-rootfs"
  | "base-image-unverified"
  | "dynamic-runner-tools"
  | "mounted-state"
  | "sensitive-state"
  | "profile-backed-dind";

export type SandboxSetupPrefixCacheEligibility =
  | {
      readonly _tag: "Eligible";
      readonly persistence: "persistent";
      readonly dependency: "parent-backed";
      /** Complete action-state surface this provider captures and restores. */
      readonly coverage: SandboxActionState;
      /** Exact immutable Base resolved and verified during provider initialization. */
      readonly baseImageId: string;
      /** Provider-owned key scope; omission preserves the ordinary Docker rootfs identity exactly. */
      readonly keyScope?: {
        readonly protocol: string;
        readonly storageSchemaRevision: string;
        readonly artifactFormatRevision: string;
        readonly semanticIdentity: import("../shared/types.ts").JsonValue;
      };
    }
  | {
      readonly _tag: "Unsupported";
      readonly code: SandboxSetupPrefixCacheUnsupportedCode;
      readonly reason: string;
    };

export interface SandboxSetupPrefixCacheManifest {
  /** Exact immutable Base identity; floating source references never enter the durable root key alone. */
  readonly baseImageId: string;
  /** Content-addressed key planned by the provider-neutral runtime. */
  readonly setupPrefixKey: string;
  readonly setupManifestDigest: string;
  /** Cumulative state required by this exact logical prefix. */
  readonly requiredState: SandboxActionState;
  readonly storageSchemaRevision: string;
  readonly artifactFormatRevision: string;
  readonly changeFrequency: number;
  /** Frozen, non-sensitive declaration metadata used for bidirectional registry validation. */
  readonly declarationMetadata: unknown;
}

export interface SandboxSetupPrefixCacheOperation {
  readonly operationId: string;
  readonly manifest: SandboxSetupPrefixCacheManifest;
  /** Defense-in-depth only; values are checked before an image is published and are never persisted. */
  readonly knownSensitiveValues?: readonly string[];
}

interface SandboxSetupPrefixCacheErrorFields {
  readonly operation: string;
  readonly reason: string;
  readonly setupPrefixKey?: string;
  readonly domainId?: string;
  readonly cause?: unknown;
}

export class SandboxSetupPrefixCacheRegistryError extends Data.TaggedError("SandboxSetupPrefixCacheRegistryError")<
  SandboxSetupPrefixCacheErrorFields
> {}

export class SandboxSetupPrefixCacheLookupError extends Data.TaggedError("SandboxSetupPrefixCacheLookupError")<
  SandboxSetupPrefixCacheErrorFields
> {}

export class SandboxSetupPrefixCacheCaptureError extends Data.TaggedError("SandboxSetupPrefixCacheCaptureError")<
  SandboxSetupPrefixCacheErrorFields
> {}

export class SandboxSetupPrefixCacheRestoreError extends Data.TaggedError("SandboxSetupPrefixCacheRestoreError")<
  SandboxSetupPrefixCacheErrorFields
> {}

export class SandboxSetupPrefixCacheValidationError extends Data.TaggedError("SandboxSetupPrefixCacheValidationError")<
  SandboxSetupPrefixCacheErrorFields
> {}

export class SandboxSetupPrefixCacheCleanupError extends Data.TaggedError("SandboxSetupPrefixCacheCleanupError")<
  SandboxSetupPrefixCacheErrorFields
> {}

export class SandboxSetupPrefixCacheAmbiguityError extends Data.TaggedError(
  "SandboxSetupPrefixCacheAmbiguityError",
)<SandboxSetupPrefixCacheErrorFields & {
  readonly operationId: string;
  readonly terminal: "unresolved";
  readonly diagnosticCommand: string;
}> {}

export class SandboxSetupPrefixCacheCancellationError extends Data.TaggedError(
  "SandboxSetupPrefixCacheCancellationError",
)<SandboxSetupPrefixCacheErrorFields & {
  readonly operationId: string;
  readonly terminal: "cancel-fenced";
}> {}

export type SandboxSetupPrefixCacheError =
  | SandboxSetupPrefixCacheRegistryError
  | SandboxSetupPrefixCacheLookupError
  | SandboxSetupPrefixCacheCaptureError
  | SandboxSetupPrefixCacheRestoreError
  | SandboxSetupPrefixCacheValidationError
  | SandboxSetupPrefixCacheCleanupError
  | SandboxSetupPrefixCacheAmbiguityError
  | SandboxSetupPrefixCacheCancellationError;

export type SandboxSetupPrefixCacheLookupResult =
  | Exclude<SandboxSetupPrefixCacheEligibility, { readonly _tag: "Eligible" }>
  | {
      readonly _tag: "Miss";
      readonly setupPrefixKey: string;
      /** A failed hit was scrubbed in the same private slot before this clean miss receipt. */
      readonly recovery?: "restore-failed-replayed";
    }
  | {
      readonly _tag: "Restored";
      readonly setupPrefixKey: string;
      readonly entryId: string;
      readonly generation: number;
      /** Provider-neutral immutable artifact identity. */
      readonly artifactId: string;
      /** Present only when the provider artifact is an exact Docker image. */
      readonly imageId?: string;
      readonly sandboxId: string;
    };

export type SandboxSetupPrefixCacheCaptureResult =
  | Exclude<SandboxSetupPrefixCacheEligibility, { readonly _tag: "Eligible" }>
  | {
      readonly _tag: "Contended";
      readonly setupPrefixKey: string;
      readonly reason: "active-writer" | "indexed-generation";
    }
  | {
      /**
       * The action already succeeded and the same private sandbox is still a
       * verified active continuation. The Runner must never clean-base/replay
       * that action and must disable publication for the remainder of Attempt.
       */
      readonly _tag: "ContinuedUncached";
      readonly setupPrefixKey: string;
      readonly reason: "capture-failed" | "publish-failed";
      readonly sandboxId: string;
    }
  | {
      readonly _tag: "Captured";
      readonly setupPrefixKey: string;
      readonly entryId: string;
      readonly generation: number;
      /** Provider-neutral immutable artifact identity. */
      readonly artifactId: string;
      /** Present only when the provider artifact is an exact Docker image. */
      readonly imageId?: string;
      readonly sandboxId: string;
    };

export type SandboxSetupPrefixCacheRecoveryResult =
  | Exclude<SandboxSetupPrefixCacheEligibility, { readonly _tag: "Eligible" }>
  | {
      readonly _tag: "RecoveredCleanBase";
      readonly baseImageId: string;
      readonly sandboxId: string;
    };

export interface SandboxSetupPrefixCacheCapability {
  eligibility(): SandboxSetupPrefixCacheEligibility;
  lookupAndRebase(
    input: SandboxSetupPrefixCacheOperation,
  ): Effect.Effect<SandboxSetupPrefixCacheLookupResult, SandboxSetupPrefixCacheError>;
  captureAndRebase(
    input: SandboxSetupPrefixCacheOperation,
  ): Effect.Effect<SandboxSetupPrefixCacheCaptureResult, SandboxSetupPrefixCacheError>;
  /**
   * One-shot degraded-path seam, only valid before any Action has succeeded in
   * the current Attempt. The provider DestroyOnly-retires a failed lookup
   * instance and rebases this stable backend onto the exact Base. Capture
   * failure paths must return ContinuedUncached or fail; they must never call
   * this seam and replay an already-successful Action.
   */
  recoverCleanBase(): Effect.Effect<SandboxSetupPrefixCacheRecoveryResult, SandboxSetupPrefixCacheError>;
}

export interface SandboxBackendCapabilities {
  /** Provider 能否兑现 CommandOptions.user 的 root 覆盖；runner 私有基础设施按这项能力选择身份。 */
  readonly rootCommands: SandboxBackendSupport<true>;
  readonly appendLog: SandboxBackendSupport<(line: string) => Promise<void>>;
  readonly suspend: SandboxBackendSupport<() => Promise<void>>;
  readonly ensureLifetime: SandboxBackendSupport<
    (minRemainingMs: number) => Promise<{ ready: true; expiresAt?: string } | { ready: false; reason: string }>
  >;
  readonly setCommandDeadline: SandboxBackendSupport<(deadlineAt?: number) => void>;
  readonly managedProcess: SandboxBackendSupport<(input: ManagedProcessStart) => Promise<ManagedProcess>>;
  /** Missing providers are normalized to an explicit Unsupported result by setupPrefixCacheCapability(). */
  readonly setupPrefixCache?: SandboxBackendSupport<SandboxSetupPrefixCacheCapability>;
}

export interface SandboxProviderBackend extends Omit<SandboxTransferOperations, "upload"> {
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
  reason: "the provider does not implement this capability",
});

export function unsupportedBackendCapabilityBecause(reason: string): SandboxBackendSupport<never> {
  return Object.freeze({ _tag: "Unsupported", reason });
}

export const noSandboxBackendCapabilities: SandboxBackendCapabilities = Object.freeze({
  rootCommands: unsupportedBackendCapability,
  appendLog: unsupportedBackendCapability,
  suspend: unsupportedBackendCapability,
  ensureLifetime: unsupportedBackendCapability,
  setCommandDeadline: unsupportedBackendCapability,
  managedProcess: unsupportedBackendCapability,
});

export function supportedBackendCapability<T>(value: T): SandboxBackendSupport<T> {
  return Object.freeze({ _tag: "Supported", value });
}

/** Provider-neutral query seam; absence never masquerades as a cache miss. */
export function setupPrefixCacheCapability(
  capabilities: SandboxBackendCapabilities,
): SandboxBackendSupport<SandboxSetupPrefixCacheCapability> {
  return capabilities.setupPrefixCache ?? unsupportedBackendCapabilityBecause(
    "the provider does not implement persistent sandbox setup-prefix caching",
  );
}

function providerBoundaryError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/** Promise provider SDK 在这一处 lift 成 typed-error Effect；Error 实例原样保留给现有归因逻辑。 */
export function providerBoundaryEffect<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): Effect.Effect<T, Error> {
  return Effect.tryPromise({
    // 保留 Effect 运行时的取消信号，供真正支持 AbortSignal 的 SDK adapter 接入；不把中断
    // 编码成 Error，也不在这里启动嵌套 runtime。
    try: (signal) => operation(signal),
    catch: providerBoundaryError,
  });
}

/**
 * 公开 Sandbox Promise 接口唯一的兼容入口。
 *
 * 这不是内部 Effect runner：它只把 provider Promise 原样留在公开兼容面，并归一化非 Error
 * rejection。runtime / resource lifecycle 必须改用 providerBoundaryEffect() 组合 Effect。
 */
export async function providerCompatibilityPromise<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw providerBoundaryError(cause);
  }
}

/** defineSandbox() 的公共新接口实现显式降成 provider backend；不探测任何旧方法。 */
export function customSandboxBackend(sandbox: Sandbox): SandboxProviderBackend {
  const appendLog = sandbox.appendLog;
  // Provider facade 产出的 Sandbox 再经 runtime 归一化时必须保留 provider-only capabilities；
  // 作者直接返回的普通 Sandbox 没有登记项，仍严格退回 Unsupported，不能靠鸭子类型猜能力。
  const registered = SANDBOX_CAPABILITIES.get(sandbox) ?? {
    ...noSandboxBackendCapabilities,
    managedProcess: unsupportedBackendCapabilityBecause("custom Sandbox facades do not declare the internal managed-process capability"),
  };
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

/** 装饰器产生新 Sandbox 对象时显式继承同一份 provider-only 能力，不靠接口外成员探测。 */
export function inheritSandboxCapabilities(source: Sandbox, target: Sandbox): void {
  const capabilities = SANDBOX_CAPABILITIES.get(source);
  if (capabilities !== undefined) SANDBOX_CAPABILITIES.set(target, capabilities);
}

export function sandboxCapabilities(sandbox: Sandbox): SandboxBackendCapabilities {
  const capabilities = SANDBOX_CAPABILITIES.get(sandbox);
  if (capabilities === undefined) {
    throw new Error(`sandbox ${sandbox.sandboxId} was not constructed by the provider facade`);
  }
  return capabilities;
}

/** 未经 provider facade 登记的普通自定义 Sandbox 保守视为不支持提权，不做鸭子类型猜测。 */
export function sandboxSupportsRootCommands(sandbox: Sandbox): boolean {
  return SANDBOX_CAPABILITIES.get(sandbox)?.rootCommands._tag === "Supported";
}

export class SandboxManagedProcessCapabilityError extends Error {
  readonly name = "SandboxManagedProcessCapabilityError";
  constructor(readonly agent: string, readonly sandboxId: string, readonly reason: string) {
    super(`Agent ${agent} requires the sandbox managed-process capability, but sandbox ${sandboxId} does not support it: ${reason}`);
  }
}

export function requireManagedProcessCapability(
  sandbox: Sandbox,
  agent: string,
): (input: ManagedProcessStart) => Promise<ManagedProcess> {
  const capability = sandboxCapabilities(sandbox).managedProcess;
  if (capability._tag === "Unsupported") {
    throw new SandboxManagedProcessCapabilityError(agent, sandbox.sandboxId, capability.reason);
  }
  return capability.value;
}

/** Provider facade 登记的复用寿命能力；不存在时保持显式 Unsupported，不做鸭子类型探测。 */
export function sandboxReuseCapability(sandbox: Sandbox): SandboxReuseCapability | undefined {
  const capability = sandboxCapabilities(sandbox).ensureLifetime;
  return capability._tag === "Supported" ? { ensureLifetime: capability.value } : undefined;
}
