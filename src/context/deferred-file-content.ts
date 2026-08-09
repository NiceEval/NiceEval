import { isTransferTimeout } from "../sandbox/transfer-errors.ts";
import { classifySandboxIoError } from "../sandbox/errors.ts";

const DEFERRED_FILE_CONTENT: unique symbol = Symbol("niceeval.deferredFileContent");

/**
 * `t.sandbox.file(path)` 产生的延迟证据引用。它不是字符串；Fact collector
 * 在 finalize 阶段读取 Sandbox 内容后，再把真实文本交给 BooleanMatch。
 */
export interface DeferredFileContent {
  readonly [DEFERRED_FILE_CONTENT]: true;
}

/** @internal 只由 TestContext 构造；公开作者面只导出 DeferredFileContent 类型。 */
export class FileRef implements DeferredFileContent {
  readonly [DEFERRED_FILE_CONTENT] = true as const;

  constructor(readonly path: string) {}
}

// ── 延迟 file source 的纯证据解析 ──
//
// `t.sandbox.file(path)` 是 final 证据源(docs/roadmap/assertion-authoring/architecture.md
// 「延迟 Sandbox file」):reader 只执行一次 read 与一次 strict UTF-8 decode,之后把结果
// 分类成候选文本或确定性失败证据。分类只依赖单次读的结果,不依赖 matcher / Fact。
//
// | 读结果 | 分类 |
// | --- | --- |
// | string(provider 已解码) | available |
// | Uint8Array 且 strict decode 成功 | available |
// | Uint8Array 且 strict decode 失败 | invalid-utf8(failed 证据) |
// | missing(ENOENT / not found / EISDIR 等确定性拿不到文件内容) | missing(failed 证据) |
// | permission / transport / timeout / terminated | unavailable(reason=sandbox-file-unavailable) |
// | 其它返回值形状或未分类的异常 | defect(evaluator error) |

export type DeferredFileReadOutcome =
  | { readonly state: "available"; readonly text: string }
  | { readonly state: "missing" }
  | { readonly state: "invalid-utf8" }
  | {
      readonly state: "unavailable";
      readonly reason: "permission" | "transport" | "timeout" | "terminated";
    }
  /** provider 返回非法 envelope:既不是文本也不是字节,违反单次读取契约。 */
  | { readonly state: "defect"; readonly cause: unknown };

type DeferredFileReadErrorOutcome = Extract<DeferredFileReadOutcome, { readonly state: "missing" } | { readonly state: "unavailable" } | { readonly state: "defect" }>;

/** 单次 read 返回的候选:文本(已解码)或字节(未解码)。 */
export type DeferredFileRead = string | Uint8Array | undefined;

/** 单次 read 的语义:一次调用,不多读。read 抛错与返回值形状按上述表格分类。 */
export function resolveDeferredFileText(read: () => Promise<DeferredFileRead>): Promise<DeferredFileReadOutcome> {
  return (async () => {
    let value: unknown;
    try {
      value = await read();
    } catch (error) {
      return classifyDeferredFileReadError(error);
    }
    if (typeof value === "string") return { state: "available", text: value };
    if (value instanceof Uint8Array) {
      try {
        return { state: "available", text: STRICT_UTF8.decode(value) };
      } catch {
        return { state: "invalid-utf8" };
      }
    }
    // `readFile()` 的缺席值是确认文件不存在，而不是“未取得证据”。permission、
    // transport、timeout 与 sandbox 终止都必须通过 throw 进入下方的 unavailable 分类。
    if (value === undefined) return { state: "missing" };
    return { state: "defect", cause: value };
  })();
}

/**
 * 抛出的错误分类。先识别确定性文件结果，再识别宽泛传输类，避免一个带 ENOENT /
 * EACCES cause 的 provider wrapper 被 5xx、network 或 rate-limit 文案抢走。timeout 必须
 * 先于 terminated，因为 SDK 常将它表述为 “aborted due to timeout”。未分类异常是 evaluator
 * defect，不能伪装为 evidence unavailable。
 */
function classifyDeferredFileReadError(error: unknown): DeferredFileReadErrorOutcome {
  if (isMissingFileError(error)) return { state: "missing" };
  if (isPermissionError(error)) return { state: "unavailable", reason: "permission" };
  if (isTransferTimeout(error)) return { state: "unavailable", reason: "timeout" };
  if (isTerminatedError(error)) return { state: "unavailable", reason: "terminated" };
  if (classifySandboxIoError(error) !== "unknown") return { state: "unavailable", reason: "transport" };
  return { state: "defect", cause: error };
}

const STRICT_UTF8 = new TextDecoder("utf-8", { fatal: true });

function isMissingFileError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const record = typeof current === "object" ? (current as globalThis.Record<string, unknown>) : undefined;
    const name = record && typeof record.name === "string" ? record.name : "";
    const code = record && typeof record.code === "string" ? record.code : "";
    const message = current instanceof Error ? current.message : String(current);
    if (/^(ENOENT|ENOTDIR|EISDIR)$/.test(code)) return true;
    if (/no such file or directory|not found|does not exist|no such file/i.test(`${name} ${message}`)) return true;
    current = record?.cause;
  }
  return false;
}

function isPermissionError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const record = typeof current === "object" ? (current as globalThis.Record<string, unknown>) : undefined;
    const code = record && typeof record.code === "string" ? record.code : "";
    const message = current instanceof Error ? current.message : String(current);
    if (/^(EACCES|EPERM)$/.test(code)) return true;
    if (/permission denied|access denied|forbidden|EACCES|EPERM/i.test(message)) return true;
    current = record?.cause;
  }
  return false;
}

function isTerminatedError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    const record = typeof current === "object" ? (current as globalThis.Record<string, unknown>) : undefined;
    const name = record && typeof record.name === "string" ? record.name : "";
    const message = current instanceof Error ? current.message : String(current);
    if (/abort|cancel|terminated|killed|sandbox.*(?:closed|stopped)/i.test(`${name} ${message}`)) return true;
    current = record?.cause;
  }
  return false;
}
