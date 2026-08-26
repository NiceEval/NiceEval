// 逐条目原子文件原语:runner/teardown-registry.ts、sandbox/keep-registry.ts、runner/lock.ts
// 共用的写盘纪律(临时文件 → fsync 文件 → rename → fsync 目录)与损坏容错的全目录扫描,以及
// rename-墓碑认领互斥点。本模块语义无关——不知道登记/留存/锁各自的内容形状,也不做心跳、
// 过期判断或 pid/host 这类判活逻辑,那些都留在各消费方自己的模块里。

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";

/**
 * 持久条目从 JSON.parse 出来后仍是 unknown。每个消费域必须在读取边界提供自己的完整 decoder，
 * 才能把它带入后续业务逻辑；返回 undefined 代表该条目对该领域而言已损坏或不属于该领域。
 */
export type EntryDecoder<T extends {}> = (value: unknown) => T | undefined;

/** 共享层只保留 Node I/O 的真实 unknown failure；各消费域决定哪些读取失败是可恢复的。 */
export type EntryFileStoreEffect<A> = Effect.Effect<A, unknown>;

function nodeIo<A>(operation: (signal: AbortSignal) => Promise<A>): EntryFileStoreEffect<A> {
  return Effect.tryPromise({ try: operation, catch: (cause) => cause });
}

function nodeSync<A>(operation: () => A): EntryFileStoreEffect<A> {
  return Effect.try({ try: operation, catch: (cause) => cause });
}

function errnoCode(cause: unknown): string | undefined {
  return typeof cause === "object" && cause !== null && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

function removeFileIfPresent(path: string): EntryFileStoreEffect<void> {
  return nodeIo(() => unlink(path)).pipe(
    Effect.catch((cause) => errnoCode(cause) === "ENOENT" ? Effect.void : Effect.fail(cause)),
  );
}

/** 持有 FileHandle 的 Scope；成功、失败与 interruption 都关闭它。 */
function withOpenFile<A>(
  path: string,
  flags: string,
  use: (handle: FileHandle) => EntryFileStoreEffect<A>,
): EntryFileStoreEffect<A> {
  return Effect.scoped(
    Effect.acquireRelease(
      nodeIo(() => open(path, flags)),
      (handle) => nodeIo(() => handle.close()).pipe(Effect.orDie),
    ).pipe(Effect.flatMap(use)),
  );
}

/** 纯哈希 entry id:parts 用 ":" 拼接后 sha256,取十六进制前缀。不带可读前缀,只须无碰撞。 */
export function hashEntryId(parts: readonly string[], length = 12): string {
  return createHash("sha256").update(parts.join(":")).digest("hex").slice(0, length);
}

/**
 * slug + 哈希 entry id:人可读前缀(非 `[\w.-]` 字符替换为 `-`)拼接 `hashEntryId`,便于在目录里
 * 目测定位是哪条身份;哈希部分仍然是唯一性的权威来源,slug 只是不承载解析的展示前缀。
 */
export function slugHashEntryId(slugSource: string, hashParts: readonly string[], length = 12): string {
  const slug = slugSource.replace(/[^\w.-]/g, "-");
  return `${slug}-${hashEntryId(hashParts, length)}`;
}

/** 原子写入一条 entry:先验证 plain JSON tree，再临时文件 → fsync 文件 → rename → fsync 目录。 */
export function writeEntryFileEffect(dir: string, id: string, data: unknown): EntryFileStoreEffect<void> {
  if (!isPlainJsonTree(data)) {
    return Effect.fail(new TypeError("Entry file data must be a finite, acyclic plain JSON tree"));
  }
  const tmpPath = join(dir, `.${id}.${process.pid}.tmp`);
  const finalPath = join(dir, `${id}.json`);
  let renamed = false;
  const writeTmp = withOpenFile(
    tmpPath,
    "w",
    (handle) => nodeIo(() => handle.writeFile(JSON.stringify(data, null, 2), "utf-8")).pipe(
      Effect.andThen(nodeIo(() => handle.sync())),
    ),
  );

  return nodeIo(() => mkdir(dir, { recursive: true })).pipe(
    Effect.andThen(
      writeTmp.pipe(
        Effect.andThen(
          nodeIo(() => rename(tmpPath, finalPath)).pipe(
            Effect.tap(() => Effect.sync(() => {
              renamed = true;
            })),
          ),
        ),
        Effect.andThen(fsyncDirEffect(dir)),
        // rename 前的失败或 interruption 不能留下会被后续扫描跳过的临时残骸；rename 后
        // tmp 已不存在，清理只会成为 no-op，不触碰已发布的最终路径。
        Effect.ensuring(Effect.suspend(() => renamed ? Effect.void : removeFileIfPresent(tmpPath)).pipe(Effect.orDie)),
      ),
    ),
  );
}

/** unknown 只活在写入边界；通过后才允许交给 JSON.stringify 与持久层。 */
function isPlainJsonTree(value: unknown, ancestors: ReadonlySet<object> = new Set()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  const next = new Set(ancestors);
  next.add(value);
  return Array.isArray(value)
    ? value.every((item) => isPlainJsonTree(item, next))
    : Object.values(value).every((item) => isPlainJsonTree(item, next));
}

/** 读一条 entry(不存在、JSON 损坏或 decoder 拒绝都返回 undefined,不抛错)。 */
export function readEntryFileEffect<T extends {}>(
  dir: string,
  id: string,
  decode: EntryDecoder<T>,
): EntryFileStoreEffect<T | undefined> {
  return nodeIo(() => readFile(join(dir, `${id}.json`), "utf-8")).pipe(
    Effect.flatMap((raw) => nodeSync(() => decode(JSON.parse(raw)))),
    Effect.catch(() => Effect.succeed(undefined)),
  );
}

/**
 * 读全部 entry(目录不存在返回空集合;跳过点文件与非 `.json` 文件;JSON 损坏或 decoder 拒绝的
 * 条目跳过,不拖垮整次扫描)。
 */
export function readAllEntryFilesEffect<T extends {}>(
  dir: string,
  decode: EntryDecoder<T>,
): EntryFileStoreEffect<{ id: string; entry: T }[]> {
  return nodeIo(() => readdir(dir)).pipe(
    Effect.catch(() => Effect.succeed([] as string[])),
    Effect.flatMap((files) => Effect.forEach(files, (file) => {
      if (!file.endsWith(".json") || file.startsWith(".")) return Effect.succeed(undefined);
      const id = file.slice(0, -".json".length);
      return readEntryFileEffect(dir, id, decode).pipe(
        Effect.map((entry) => entry === undefined ? undefined : { id, entry }),
      );
    })),
    Effect.map((entries) => entries.filter((entry): entry is { id: string; entry: T } => entry !== undefined)),
  );
}

/**
 * 认领互斥点:用 rename 把 entry 移到本次调用独有的墓碑名,而不是直接 `unlink`。同一个源路径的
 * rename 只有一个调用者能命中——其余全部拿到 ENOENT,这把「谁先抢到」这件事和后续清理动作分开,
 * 在某些文件系统里,并发对同一路径 `unlink` 的语义并不保证「恰好一个成功」,而并发 `rename` 到
 * 各自独占的目标名没有这个歧义。抢到墓碑之后再尝试 `unlink` 墓碑并 fsync 目录,但即使墓碑清理
 * 本身失败也不放弃已经拿到的认领权——它已经不在原路径,不会被第二个认领者看到。
 *
 * 两种上层用法共用同一个操作,只是拿到 `true` 之后做的事不同:
 * - 「删除且只删一次」(收尾登记的用法):认领成功即代表删除完成,不必再写回。
 * - 「接管后立刻在原路径重建」(用例锁的过期接管用法):认领成功后原路径已空出,赢家随即在
 *   该路径写入自己的新记录;若这一步撞上 EEXIST(另一个赢家已经抢先写回),按认领失败处理即可,
 *   不需要报错。
 *
 * 返回 `true` 即拿到认领权;返回 `false` 表示 entry 已被别的调用者认领或删除(rename 源
 * ENOENT);其余错误原样抛出。
 */
export function claimEntryFileEffect(dir: string, id: string): EntryFileStoreEffect<boolean> {
  const path = join(dir, `${id}.json`);
  const claimedPath = join(dir, `.${id}.${process.pid}.${randomUUID()}.claimed`);
  return nodeIo(() => rename(path, claimedPath)).pipe(
    Effect.as(true),
    Effect.catch((cause) => errnoCode(cause) === "ENOENT" ? Effect.succeed(false) : Effect.fail(cause)),
    Effect.flatMap((claimed) => claimed
      ? removeFileIfPresent(claimedPath).pipe(Effect.andThen(fsyncDirEffect(dir)), Effect.as(true))
      : Effect.succeed(false)),
  );
}

/** 目录 fsync,尽力而为——部分平台/文件系统不支持目录 fsync(如 Windows),静默降级。 */
export function fsyncDirEffect(dir: string): EntryFileStoreEffect<void> {
  return withOpenFile(dir, "r", (handle) => nodeIo(() => handle.sync())).pipe(
    Effect.catch(() => Effect.void),
  );
}
