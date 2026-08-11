// 本地 Store 唯一的文件系统原语。对象、marker、Layout 和 journal 都必须经这里写入，
// 以维持同目录 temp → fsync(file) → rename → fsync(parent) 的崩溃恢复纪律。

import { randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Cause, Effect, Exit, Option } from "effect";
import {
  LocalStoreIoError,
  type LocalStoreIoOperation,
  nodeErrorCode,
} from "./errors.ts";

/**
 * Promise 型 Node IO 的唯一 Effect 边界。公共 backend 再把本错误按 operation 映射成
 * Record 的错误契约，因此原始 Error 不会越过 store 包。
 */
export function runLocalStoreIo<A>(
  operation: LocalStoreIoOperation,
  path: string,
  action: () => Promise<A>,
): Promise<A> {
  return runLocalStoreIoEffect(
    Effect.tryPromise({
      try: action,
      catch: (cause) => new LocalStoreIoError({ operation, path, cause }),
    }),
    operation,
    path,
  );
}

/**
 * `Effect.runPromise` wraps an expected tagged failure in FiberFailure, which would hide errno
 * from lock-race classification. Run the Effect to Exit and rethrow the typed failure itself;
 * defects are still wrapped before leaving this filesystem boundary.
 */
async function runLocalStoreIoEffect<A>(
  effect: Effect.Effect<A, LocalStoreIoError>,
  operation: LocalStoreIoOperation,
  path: string,
): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) return exit.value;
  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) throw failure.value;
  throw new LocalStoreIoError({ operation, path, cause: Cause.squash(exit.cause) });
}

export async function ensureDirectory(path: string): Promise<void> {
  await runLocalStoreIo("create-directory", path, () => mkdir(path, { recursive: true }));
}

/** 首次 create 的 CAS 点：根目录一旦存在，第二个 creator 必须输而不能覆写 marker。 */
export async function createDirectoryExclusively(path: string): Promise<"created" | "exists"> {
  try {
    await mkdir(path);
    return "created";
  } catch (cause) {
    if (nodeErrorCode(cause) === "EEXIST") return "exists";
    throw new LocalStoreIoError({ operation: "create-directory", path, cause });
  }
}

/** 文件不存在是普通状态；其它失败仍以 typed IO error 交给调用方。 */
export async function readFileIfPresent(path: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(path);
  } catch (cause) {
    if (nodeErrorCode(cause) === "ENOENT") return undefined;
    throw new LocalStoreIoError({ operation: "read-file", path, cause });
  }
}

export async function readFileRequired(path: string): Promise<Uint8Array> {
  return runLocalStoreIo("read-file", path, () => readFile(path));
}

/**
 * 读取可选 file 的 stat。对象命名空间只将 regular file 当作对象；目录、socket 等物理形状
 * 由上层转为 Store corruption，不把它们当成正常 "不存在"。
 */
export async function statIfPresent(path: string): Promise<Awaited<ReturnType<typeof stat>> | undefined> {
  try {
    return await stat(path);
  } catch (cause) {
    if (nodeErrorCode(cause) === "ENOENT") return undefined;
    throw new LocalStoreIoError({ operation: "read-file", path, cause });
  }
}

/** 目录不存在是空集合；其它底层错误保留为 typed IO failure。 */
export async function readDirectoryIfPresent(path: string): Promise<readonly string[]> {
  try {
    return Object.freeze(await readdir(path));
  } catch (cause) {
    if (nodeErrorCode(cause) === "ENOENT") return Object.freeze([]);
    throw new LocalStoreIoError({ operation: "read-file", path, cause });
  }
}

/**
 * 原子替换一个元数据文件。临时文件与目标放在同一目录，避免跨设备 rename 退化；关闭文件柄前
 * 先 sync，rename 后再 sync 父目录。失败时只尝试删除本调用独有的 temp，不覆盖主错误。
 */
export async function writeFileAtomically(path: string, bytes: Uint8Array): Promise<void> {
  const parent = dirname(path);
  await ensureDirectory(parent);
  const tempPath = join(parent, `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);

  try {
    const handle = await runLocalStoreIo("write-file", tempPath, () => open(tempPath, "wx", 0o600));
    try {
      await runLocalStoreIo("write-file", tempPath, () => handle.writeFile(bytes));
      await runLocalStoreIo("sync-file", tempPath, () => handle.sync());
    } finally {
      await runLocalStoreIo("write-file", tempPath, () => handle.close());
    }
    await runLocalStoreIo("rename", path, () => rename(tempPath, path));
    await syncDirectory(parent);
  } catch (cause) {
    await removeFileIfPresent(tempPath).catch(() => undefined);
    throw cause;
  }
}

/**
 * 成功创建的新对象也必须让目录项 durable。object path 没有替换语义，因此使用 exclusive
 * create；若已经存在，由调用方读回并校验 bytes，而不是静默把它当作同一个对象。
 */
export async function writeFileExclusively(path: string, bytes: Uint8Array): Promise<"created" | "exists"> {
  const parent = dirname(path);
  await ensureDirectory(parent);
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(path, "wx", 0o600);
  } catch (cause) {
    if (nodeErrorCode(cause) === "EEXIST") return "exists";
    throw new LocalStoreIoError({ operation: "write-file", path, cause });
  }

  let primaryFailure: unknown;
  try {
    await runLocalStoreIo("write-file", path, () => handle.writeFile(bytes));
    await runLocalStoreIo("sync-file", path, () => handle.sync());
  } catch (cause) {
    primaryFailure = cause;
  }
  try {
    await runLocalStoreIo("write-file", path, () => handle.close());
  } catch (cause) {
    // A close failure matters when no earlier write/sync failure exists. It still must not mask
    // the primary failure, and cleanup only runs after the handle is no longer open (notably on
    // Windows, where unlinking an open handle commonly fails).
    if (primaryFailure === undefined) primaryFailure = cause;
  }
  if (primaryFailure !== undefined) {
    await removeFileIfPresent(path).catch(() => undefined);
    throw primaryFailure;
  }
  try {
    await syncDirectory(parent);
  } catch (cause) {
    // A file whose parent entry never reached the durability barrier is not a successful
    // exclusive create. The handle is already closed; remove only this call's newly-created path
    // and retain the parent-sync failure as the caller-visible typed failure.
    await removeFileIfPresent(path).catch(() => undefined);
    throw cause;
  }
  return "created";
}

/** 普通 Store 路径支持目录 fsync 的平台上必须成功；不能默默略过 durability barrier。 */
export async function syncDirectory(path: string): Promise<void> {
  const handle = await runLocalStoreIo("sync-directory", path, () => open(path, "r"));
  try {
    await runLocalStoreIo("sync-directory", path, () => handle.sync());
  } finally {
    await runLocalStoreIo("sync-directory", path, () => handle.close());
  }
}

/**
 * 删除仅用于自己拥有的 temp、staging、lease 或已经 mark/sweep 的对象。即使 unlink 看到
 * ENOENT，仍会在现存 parent 上 fsync：前一次调用可能已经删掉目录项、却在 parent fsync 时
 * 失败；重试必须补完那个 durability step，不能把“文件已不见”误当成“删除已经 durable”。
 */
export async function removeFileIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (cause) {
    if (nodeErrorCode(cause) !== "ENOENT") {
      throw new LocalStoreIoError({ operation: "remove", path, cause });
    }
  }
  try {
    await syncDirectory(dirname(path));
  } catch (cause) {
    // A never-created optional parent has no deletion to make durable. Every other parent fsync
    // failure remains typed and leaves its owning close capability retryable.
    if (nodeErrorCode(cause) === "ENOENT") return;
    throw new LocalStoreIoError({ operation: "remove", path, cause });
  }
}

/** 只作为持久化边界的 JSON.parse 入口；schema/physical decoder 仍由 owner 提供。 */
export async function readJsonIfPresent<T>(
  path: string,
  decode: (value: unknown) => T | undefined,
): Promise<T | undefined> {
  const bytes = await readFileIfPresent(path);
  if (bytes === undefined) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (cause) {
    throw new LocalStoreIoError({ operation: "read-file", path, cause });
  }
  return decode(value);
}
