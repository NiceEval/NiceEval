// 逐条目原子文件原语:runner/teardown-registry.ts、sandbox/keep-registry.ts、runner/lock.ts
// 共用的写盘纪律(临时文件 → fsync 文件 → rename → fsync 目录)与损坏容错的全目录扫描,以及
// rename-墓碑认领互斥点。本模块语义无关——不知道登记/留存/锁各自的内容形状,也不做心跳、
// 过期判断或 pid/host 这类判活逻辑,那些都留在各消费方自己的模块里。

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

/**
 * 持久条目从 JSON.parse 出来后仍是 unknown。每个消费域必须在读取边界提供自己的完整 decoder，
 * 才能把它带入后续业务逻辑；返回 undefined 代表该条目对该领域而言已损坏或不属于该领域。
 */
export type EntryDecoder<T> = (value: unknown) => T | undefined;

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
export async function writeEntryFile(dir: string, id: string, data: unknown): Promise<void> {
  if (!isPlainJsonTree(data)) {
    throw new TypeError("Entry file data must be a finite, acyclic plain JSON tree");
  }
  await mkdir(dir, { recursive: true });
  const tmpPath = join(dir, `.${id}.${process.pid}.tmp`);
  const finalPath = join(dir, `${id}.json`);
  const handle = await open(tmpPath, "w");
  try {
    await handle.writeFile(JSON.stringify(data, null, 2), "utf-8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(tmpPath, finalPath);
  await fsyncDir(dir);
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
export async function readEntryFile<T>(dir: string, id: string, decode: EntryDecoder<T>): Promise<T | undefined> {
  try {
    return decode(JSON.parse(await readFile(join(dir, `${id}.json`), "utf-8")));
  } catch {
    return undefined;
  }
}

/**
 * 读全部 entry(目录不存在返回空集合;跳过点文件与非 `.json` 文件;JSON 损坏或 decoder 拒绝的
 * 条目跳过,不拖垮整次扫描)。
 */
export async function readAllEntryFiles<T>(dir: string, decode: EntryDecoder<T>): Promise<{ id: string; entry: T }[]> {
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return [];
  }
  const out: { id: string; entry: T }[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith(".")) continue; // 点文件是在飞临时/墓碑文件
    try {
      const raw = await readFile(join(dir, file), "utf-8");
      const entry = decode(JSON.parse(raw));
      if (entry !== undefined) out.push({ id: file.slice(0, -".json".length), entry });
    } catch {
      // 跳过 JSON 损坏条目,不让一条坏文件拖垮整次扫描。
    }
  }
  return out;
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
export async function claimEntryFile(dir: string, id: string): Promise<boolean> {
  const path = join(dir, `${id}.json`);
  const claimedPath = join(dir, `.${id}.${process.pid}.${randomUUID()}.claimed`);
  try {
    await rename(path, claimedPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw e;
  }
  try {
    await unlink(claimedPath);
    await fsyncDir(dir);
  } catch (e) {
    // 已经夺得认领权;清理墓碑失败不允许把 entry 重新暴露给第二个认领者。
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  return true;
}

/** 目录 fsync,尽力而为——部分平台/文件系统不支持目录 fsync(如 Windows),静默降级。 */
export async function fsyncDir(dir: string): Promise<void> {
  try {
    const handle = await open(dir, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // rename/rm 本身已是原子操作,fsync 只是尽力而为的额外保险。
  }
}
