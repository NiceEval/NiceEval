/**
 * CommandOptions.sensitiveValues 的记录面实现。
 *
 * 值只在当前 Attempt 的内存里参与精确替换，不进入 timing、commands、result 或 provider
 * 参数的派生身份。这里故意不按 `token` / `api_key` / `Authorization` 等键名猜 secret：
 * 自由文本没有可靠语法，误猜既会漏报，也会把普通输出破坏掉。
 */

export const REDACTED_SENSITIVE_VALUE = "<redacted>";

/** 动态调用方可能绕过 TypeScript；只接受非空字符串，空串不能拿来做全局替换。 */
export function commandSensitiveValues(options: unknown): readonly string[] {
  if (typeof options !== "object" || options === null) return [];
  const values = (options as { sensitiveValues?: unknown }).sensitiveValues;
  if (!Array.isArray(values)) return [];
  return values.filter((value): value is string => typeof value === "string" && value.length > 0);
}

/** 把本次公开命令声明的值并入 Attempt 级集合；集合本身从不持久化。 */
export function rememberSensitiveValues(target: Set<string>, values: Iterable<string>): void {
  for (const value of values) {
    if (value.length > 0) target.add(value);
  }
}

/**
 * 最长值优先，避免 `token` 与 `Bearer token` 同时登记时先留下可识别的半截。
 * 替换发生在命令摘要截断之前，也用于失败输出、事件与错误的最终证据封口。
 */
export function redactSensitiveText(text: string, values: Iterable<string>): string {
  const ordered = [...new Set(values)].filter((value) => value.length > 0).sort((a, b) => b.length - a.length);
  let redacted = text;
  for (const value of ordered) redacted = redacted.replaceAll(value, REDACTED_SENSITIVE_VALUE);
  return redacted;
}

/** 对已经是证据数据的普通对象/数组递归替换所有字符串叶子，不修改调用方对象。 */
export function redactSensitiveEvidence<Value>(value: Value, values: Iterable<string>): Value {
  const captured = [...new Set(values)].filter((entry) => entry.length > 0);
  if (captured.length === 0) return value;

  const visit = (candidate: unknown): unknown => {
    if (typeof candidate === "string") return redactSensitiveText(candidate, captured);
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (typeof candidate !== "object" || candidate === null) return candidate;
    return Object.fromEntries(Object.entries(candidate).map(([key, entry]) => [key, visit(entry)]));
  };

  return visit(value) as Value;
}
