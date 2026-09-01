// 沙箱文件传输的超时报错质量:SDK / HTTP 往返超时不许原样透出。
//
// e2b 一类 provider 的 SDK 把往返超时抛成 `The operation was aborted due to timeout` ——
// 三要素(哪个操作 / 对什么对象 / 预算多少谁定的)一样不带,读到它的人第一反应是去调
// `--timeout`,而那是 attempt 预算,和这层完全无关(契约见 docs/error-feedback.md
// 「超时报错的三要素」)。这里在 provider 中立层补齐三要素:操作名与传输对象由调用点给,
// 「这是 SDK/HTTP 层而非 attempt 预算」由文案说死,原始错误留在 `cause` 里不丢证据。
//
// 只包超时形态:其它失败(权限、路径不存在、瞬时网络重试耗尽)照原样抛回,保持
// 「重试耗尽抛回原始错误链」不变。

import { stat, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";

/** 一次传输的可描述对象:沙箱侧路径 + 本地侧来源(有则给)+ 字节数(知道才给)。 */
export interface TransferTarget {
  /** 中性操作名,与 `Sandbox` 接口的方法同名(用户就是照这个名字调的)。 */
  operation: string;
  /** provider 名(超时报错要点名是谁的 SDK 在超时);拿不到时按 `sandbox` 说。 */
  provider?: string;
  /** 沙箱侧路径(已解析成绝对路径)。 */
  path: string;
  /** 本地侧来源路径(上传类操作有)。 */
  localPath?: string;
  /** 传输字节数;算不出来就不写——不猜也不填 0。 */
  bytes?: number;
}

/** 超时形态判定:沿 cause 链找 SDK / HTTP / socket 各家的超时词法与错误码。 */
export function isTransferTimeout(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const record = typeof current === "object" ? (current as globalThis.Record<string, unknown>) : undefined;
    const name = record && typeof record.name === "string" ? record.name : "";
    const code = record && typeof record.code === "string" ? record.code : "";
    const message = current instanceof Error ? current.message : String(current);
    if (/TimeoutError|HeadersTimeoutError|BodyTimeoutError|ConnectTimeoutError/i.test(name)) return true;
    if (/^(ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT)$/i.test(code)) {
      return true;
    }
    if (/aborted due to timeout|timed? ?out|timeout exceeded|deadline exceeded/i.test(message)) return true;
    current = record?.cause;
  }
  return false;
}

/**
 * 包一次传输:超时时抛出带三要素的错误(原始错误进 `cause`),其它错误原样上抛。
 * 字节数在**失败路径**上才现算(上传类可以量本地来源),正常路径不付任何代价。
 */
export async function withTransferErrors<T>(target: TransferTarget, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isTransferTimeout(error)) throw error;
    const bytes = target.bytes ?? (target.localPath ? await measureLocalBytes(target.localPath) : undefined);
    throw transferTimeoutError({ ...target, ...(bytes !== undefined ? { bytes } : {}) }, error);
  }
}

/**
 * 纯错误映射:超时形态 → 带三要素的 Error(原始错误进 `cause`)。不含字节量测与任何
 * IO,调用方(含 Effect 组合器)在失败路径上自行补齐 bytes 后再调它。
 */
export function transferTimeoutError(target: TransferTarget, error: unknown): Error {
  return new Error(
    `${target.provider ?? "sandbox"} ${target.operation} timed out transferring ${describeTransferObject(target)}. This is the provider SDK / HTTP round trip timing out, not the attempt's timeoutMs budget — raising --timeout will not help. fix: split the transfer into smaller batches, bake large fixtures into the image/template, or download them inside the sandbox instead.`,
    { cause: error },
  );
}

/** 失败路径专用的字节量测 Effect:已有 bytes 或没有本地来源时不测,量不到就当不知道。 */
function measureTransferBytes(target: TransferTarget): Effect.Effect<number | undefined> {
  const localPath = target.localPath;
  if (target.bytes !== undefined || localPath === undefined) return Effect.succeed(undefined);
  return Effect.tryPromise({
    try: () => measureLocalBytes(localPath),
    catch: (error) => error,
  }).pipe(Effect.catch(() => Effect.succeed(undefined)));
}

/**
 * Effect 组合器:retry 耗尽后的**终局失败**上做一次 transfer 超时 enrichment。
 *
 * 必须排在 withSandboxIoRetry 之外、之后:重试分类只看到 raw provider 失败(分类器按
 * 原始错误形态判定),只有不再重试的失败才替换成带三要素的超时 Error。非超时错误原样
 * 透传,defect / interruption 不经过这里(它们在 Cause 里,不进 typed failure 通道)。
 */
export function enrichTransferErrors<A, E>(
  target: TransferTarget,
): (self: Effect.Effect<A, E>) => Effect.Effect<A, E | Error> {
  return (self) =>
    Effect.catch(self, (error): Effect.Effect<never, E | Error> =>
      isTransferTimeout(error)
        ? Effect.flatMap(measureTransferBytes(target), (bytes) =>
          Effect.fail(transferTimeoutError({ ...target, ...(bytes !== undefined ? { bytes } : {}) }, error)),
        )
        : Effect.fail<E>(error),
    );
}

/** 「对什么对象」:沙箱侧路径、本地来源与字节数拼成一句可定位的描述。 */
export function describeTransferObject(target: Pick<TransferTarget, "path" | "localPath" | "bytes">): string {
  const parts = [target.path];
  if (target.localPath !== undefined) parts.push(`← ${target.localPath}`);
  if (target.bytes !== undefined) parts.push(`(${formatBytes(target.bytes)})`);
  return parts.join(" ");
}

/** 内容字节数合计(文本按 UTF-8 字节算,不按字符数)。 */
export function totalBytes(contents: readonly (string | Uint8Array)[]): number {
  return contents.reduce((sum, c) => sum + (typeof c === "string" ? Buffer.byteLength(c, "utf8") : c.byteLength), 0);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (const next of units.slice(1)) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(1)} ${unit}`;
}

/** 失败路径专用的本地体积量测:递归 stat,量不到(权限 / 已删除)就当不知道。 */
async function measureLocalBytes(localPath: string): Promise<number | undefined> {
  try {
    const st = await stat(localPath);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return undefined;
    let total = 0;
    let visited = 0;
    const stack = [localPath];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        // 只是给报错凑一个数量级,不为它遍历一个巨型树:够多就停,当作不知道。
        if ((visited += 1) > 20_000) return undefined;
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(abs);
        else if (entry.isFile()) total += (await stat(abs)).size;
      }
    }
    return total;
  } catch {
    return undefined;
  }
}
