// Store 后端的外部边界错误。这里不把 Node 的 Error 暴露给上层：所有文件系统、锁与
// 持久化失败都先收敛为可路由的 Schema.TaggedErrorClass（当前安装的 Effect 将构造器公开为
// `Schema.TaggedError`），随后由 public adapter 映射到
// RecordStoreError / RecordWriteError 等领域 failure。

import { Schema } from "effect";
import type { DescriptorV1 } from "../protocol/core.ts";

/**
 * Store-to-graph failures are deliberately data, not diagnostics.  The public Record adapter can
 * map these variants without inspecting an Error class name or message.  `cause` is retained only
 * at the physical object-read boundary where it remains an implementation diagnostic.
 */
export type LocalGraphAccessComponent =
  | "commit-layout"
  | "current-layout"
  | "committed-roots"
  | "graph-root"
  | "strong-closure"
  | "record-history"
  | "catalog"
  | "locator-index"
  | "stream-prefix"
  | "adopted-attempt"
  | "mirror-layout"
  | "mirror-history";

export type LocalGraphSemanticViolationCode =
  | "layout-head-mismatch"
  | "layout-generation-invalid"
  | "layout-record-id-mismatch"
  | "expected-head-mismatch"
  | "committed-root-membership-invalid"
  | "committed-root-append-invalid"
  | "record-history-invalid"
  | "record-subject-invalid"
  | "strong-closure-invalid"
  | "catalog-transition-invalid"
  | "catalog-key-rebound"
  | "catalog-key-deleted"
  | "locator-key-rebound"
  | "locator-key-deleted"
  | "stream-append-invalid"
  | "adopted-attempt-not-committed"
  | "catalog-locator-mismatch";

export interface LocalGraphSemanticViolation {
  readonly code: LocalGraphSemanticViolationCode;
  readonly component: LocalGraphAccessComponent;
  readonly ref?: DescriptorV1;
  readonly related?: DescriptorV1;
}

export interface LocalGraphResourceLimit {
  readonly name: "objects" | "depth" | "bytes";
  readonly maximum: number;
}

export type LocalStoreObjectReadCause =
  | { readonly kind: "permission"; readonly cause: unknown }
  | { readonly kind: "unavailable"; readonly cause: unknown }
  | { readonly kind: "io"; readonly cause: unknown };

/** Closed internal failure union for all graph bridge entry points. */
export type LocalGraphAccessFailure =
  | {
      readonly kind: "graph-semantic-violation";
      readonly violations: readonly [LocalGraphSemanticViolation, ...LocalGraphSemanticViolation[]];
    }
  | {
      readonly kind: "missing-object";
      readonly component: LocalGraphAccessComponent;
      readonly ref: DescriptorV1;
    }
  | {
      readonly kind: "corrupt";
      readonly component: LocalGraphAccessComponent;
      readonly ref?: DescriptorV1;
    }
  | {
      readonly kind: "unsupported-digest";
      readonly component: LocalGraphAccessComponent;
      readonly ref: DescriptorV1;
    }
  | {
      readonly kind: "unsupported-schema";
      readonly component: LocalGraphAccessComponent;
      readonly ref?: DescriptorV1;
    }
  | {
      readonly kind: "unsupported-capability";
      readonly component: LocalGraphAccessComponent;
      readonly ref?: DescriptorV1;
    }
  | {
      readonly kind: "resource-limit";
      readonly component: LocalGraphAccessComponent;
      readonly limit: LocalGraphResourceLimit;
      readonly observed: number;
      readonly ref?: DescriptorV1;
    }
  | {
      readonly kind: "object-read";
      readonly component: LocalGraphAccessComponent;
      readonly ref: DescriptorV1;
      readonly cause: LocalStoreObjectReadCause;
    };

/** 发生文件系统交互时的稳定操作名；不是 public Record API 的 operation 词表。 */
export const LocalStoreIoOperation = Schema.Literal(
  "create-directory",
  "read-file",
  "write-file",
  "sync-file",
  "sync-directory",
  "rename",
  "remove",
  "acquire-lock",
  "renew-lock",
  "release-lock",
  "read-journal",
  "write-journal",
);

export type LocalStoreIoOperation = typeof LocalStoreIoOperation.Type;

/**
 * Node `fs/promises` 是外部边界。保留 defect 供诊断，但调用方只能依赖本类的稳定字段，
 * 不能把原始 Error 作为 Record 的错误契约。
 */
export class LocalStoreIoError extends Schema.TaggedError<LocalStoreIoError>("LocalStoreIoError")(
  "LocalStoreIoError",
  {
    operation: LocalStoreIoOperation,
    path: Schema.String,
    cause: Schema.Defect,
  },
) {}

/** 本地 marker、journal 或 lock 的字节不符合该实现的固定物理形状。 */
export class LocalStorePhysicalCorruptionError extends Schema.TaggedError<LocalStorePhysicalCorruptionError>("LocalStorePhysicalCorruptionError")(
  "LocalStorePhysicalCorruptionError",
  {
    component: Schema.Literal("marker", "layout", "journal", "lock", "staging", "read-lease", "pin"),
    path: Schema.String,
    detail: Schema.String,
  },
) {}

/** 调用方请求的 root 不能安全地作为 bundled local Store 目录。 */
export class LocalStoreRootError extends Schema.TaggedError<LocalStoreRootError>("LocalStoreRootError")(
  "LocalStoreRootError",
  {
    root: Schema.String,
    issue: Schema.Literal(
      "empty",
      "not-absolute",
      "malformed-url",
      "file-url-host",
      "query-or-fragment",
      "url-scheme-unsupported",
    ),
  },
) {}

/** 写租约失效或被另一个 fencing token 接管。 */
export class LocalStoreLeaseLostError extends Schema.TaggedError<LocalStoreLeaseLostError>("LocalStoreLeaseLostError")(
  "LocalStoreLeaseLostError",
  {
    transactionId: Schema.String,
    fencingToken: Schema.String,
    reason: Schema.Literal("expired", "missing", "superseded", "released"),
  },
) {}

/** 当前 root 已由仍存活的本地写 lease 持有；调用方可等待或把它映射为临时 unavailable。 */
export class LocalStoreLeaseBusyError extends Schema.TaggedError<LocalStoreLeaseBusyError>("LocalStoreLeaseBusyError")(
  "LocalStoreLeaseBusyError",
  {
    transactionId: Schema.String,
    fencingToken: Schema.String,
    expiresAt: Schema.String,
  },
) {}

/** 同一个 transaction 的 staging 归属与当前 fencing token 不一致。 */
export class LocalStoreStagingOwnershipError extends Schema.TaggedError<LocalStoreStagingOwnershipError>("LocalStoreStagingOwnershipError")(
  "LocalStoreStagingOwnershipError",
  {
    transactionId: Schema.String,
    fencingToken: Schema.String,
    detail: Schema.String,
  },
) {}

/** backend 已开始关闭，不能再派生新的 retain / capability。 */
export class LocalStoreClosedError extends Schema.TaggedError<LocalStoreClosedError>("LocalStoreClosedError")(
  "LocalStoreClosedError",
  {
    operation: Schema.Literal("retain", "begin-write", "open-read", "begin-gc", "mirror-install"),
  },
) {}

export class LocalStoreAlreadyExistsError extends Schema.TaggedError<LocalStoreAlreadyExistsError>("LocalStoreAlreadyExistsError")(
  "LocalStoreAlreadyExistsError",
  { root: Schema.String },
) {}

export class LocalStoreMissingError extends Schema.TaggedError<LocalStoreMissingError>("LocalStoreMissingError")(
  "LocalStoreMissingError",
  { root: Schema.String },
) {}

export class LocalStoreInvalidFormatError extends Schema.TaggedError<LocalStoreInvalidFormatError>("LocalStoreInvalidFormatError")(
  "LocalStoreInvalidFormatError",
  {
    root: Schema.String,
    detail: Schema.String,
  },
) {}

export class LocalStoreReadLeaseError extends Schema.TaggedError<LocalStoreReadLeaseError>("LocalStoreReadLeaseError")(
  "LocalStoreReadLeaseError",
  {
    reason: Schema.Literal("expired", "closed"),
  },
) {}

/**
 * This Error carries the exact closed bridge union.  It intentionally is not a schema error:
 * object-read causes can preserve a native IO failure without leaking that native shape into the
 * bridge's stable discriminant.
 */
export class LocalStoreGraphAccessError extends Error {
  readonly operation: "validate-commit" | "validate-mirror-snapshot" | "enumerate-committed-roots";
  readonly failure: LocalGraphAccessFailure;

  constructor(input: {
    readonly operation: "validate-commit" | "validate-mirror-snapshot" | "enumerate-committed-roots";
    readonly failure: LocalGraphAccessFailure;
  }) {
    super(input.failure.kind);
    this.name = "LocalStoreGraphAccessError";
    this.operation = input.operation;
    this.failure = input.failure;
  }
}

/** mirror install 的 typed snapshot 与待安装 Layout 不同；不能降级成普通 commit。 */
export class LocalStoreMirrorInstallError extends Schema.TaggedError<LocalStoreMirrorInstallError>("LocalStoreMirrorInstallError")(
  "LocalStoreMirrorInstallError",
  {
    code: Schema.Literal("snapshot-layout-mismatch", "initialize-conflict"),
  },
) {}

export type LocalStoreFailure =
  | LocalStoreIoError
  | LocalStoreLeaseBusyError
  | LocalStoreLeaseLostError
  | LocalStorePhysicalCorruptionError
  | LocalStoreRootError
  | LocalStoreClosedError
  | LocalStoreAlreadyExistsError
  | LocalStoreInvalidFormatError
  | LocalStoreMissingError
  | LocalStoreGraphAccessError
  | LocalStoreReadLeaseError
  | LocalStoreStagingOwnershipError
  | LocalStoreMirrorInstallError;

/**
 * 不使用 `as`：只从 unknown 反射读取 errno。`runLocalStoreIo` 会把 Node error 放进
 * LocalStoreIoError.cause；这里最多展开四层并防环，既能分类 rename/unlink 的正常 ENOENT
 * 竞争，也不会把任意递归结构无限解包。
 */
export function nodeErrorCode(cause: unknown): string | undefined {
  let current: unknown = cause;
  const seen = new Set<object>();
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    if (seen.has(current)) return undefined;
    seen.add(current);
    const code = Reflect.get(current, "code");
    if (typeof code === "string") return code;
    current = Reflect.get(current, "cause");
  }
  return undefined;
}
