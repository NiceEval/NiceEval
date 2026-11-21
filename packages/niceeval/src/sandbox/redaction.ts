/**
 * Attempt 与命令敏感值的记录面实现。
 *
 * 值只在当前 Attempt 的内存里参与精确替换，不进入 timing、commands、result 或 provider
 * 参数的派生身份。这里故意不按 `token` / `api_key` / `Authorization` 等键名猜 secret：
 * 自由文本没有可靠语法，误猜既会漏报，也会把普通输出破坏掉。
 */

export const REDACTED_SENSITIVE_VALUE = "<redacted>";

export type RedactEvidenceText = ((value: string) => string) & { readonly hasValues?: () => boolean };

export function createSensitiveTextRedactor(values: ReadonlySet<string>): RedactEvidenceText {
  let size = 0;
  let pattern: RegExp | undefined;
  return Object.assign(
    (text: string) => {
      // The Attempt registry grows by adding strings. Recompile only after registration.
      if (size !== values.size) {
        size = values.size;
        pattern = sensitivePattern(values);
      }
      return pattern === undefined ? text : text.replace(pattern, REDACTED_SENSITIVE_VALUE);
    },
    { hasValues: () => values.size > 0 },
  );
}

export function activeEvidenceRedactor(redact: RedactEvidenceText | undefined): RedactEvidenceText | undefined {
  return redact?.hasValues?.() === false ? undefined : redact;
}

// @concord-code
// @concord-implements docs/feature/eval/library/context.md#登记敏感值
export function registerAttemptSensitiveValues(target: Set<string>, values: readonly string[]): void {
  if (values.some((value) => typeof value !== "string" || value.length < 8)) {
    throw new TypeError("sensitiveValues() requires strings of at least 8 characters.");
  }
  rememberSensitiveValues(target, values);
}

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
  const pattern = sensitivePattern(values);
  return pattern === undefined ? text : text.replace(pattern, REDACTED_SENSITIVE_VALUE);
}

function sensitivePattern(values: Iterable<string>): RegExp | undefined {
  const ordered = [...new Set(values)].filter((value) => value.length > 0).sort((a, b) => b.length - a.length);
  if (ordered.length === 0) return undefined;
  const pattern = ordered.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return new RegExp(pattern, "g");
}

/** 对已经是证据数据的普通对象/数组递归替换所有字符串叶子，不修改调用方对象。 */
export function redactSensitiveEvidence<Value>(value: Value, values: Iterable<string>): Value {
  const captured = [...new Set(values)].filter((entry) => entry.length > 0);
  if (captured.length === 0) return value;

  return mapEvidenceText(value, (text) => redactSensitiveText(text, captured));
}

/** Replaces string leaves of an evidence snapshot before it is encoded or bounded. */
export function mapEvidenceText<Value>(value: Value, redact: RedactEvidenceText | undefined): Value {
  const active = activeEvidenceRedactor(redact);
  if (active === undefined) return value;
  const visit = (candidate: unknown): unknown => {
    if (typeof candidate === "string") return active(candidate);
    if (Array.isArray(candidate)) return candidate.map(visit);
    if (typeof candidate !== "object" || candidate === null) return candidate;
    return Object.fromEntries(Object.entries(candidate).map(([key, entry]) => [key, visit(entry)]));
  };
  return visit(value) as Value;
}

/** Redacts decoded content so escaping does not hide a registered substring. */
export function redactJsonEvidence(
  text: string,
  redact: RedactEvidenceText | undefined,
  encode: (value: unknown) => string = JSON.stringify,
  depth = 0,
): string {
  const active = activeEvidenceRedactor(redact);
  if (active === undefined) return text;
  if (depth >= 4) return active(text);
  let decoded: unknown;
  try {
    decoded = JSON.parse(text);
  } catch {
    return active(text);
  }
  let changed = false;
  const mapped = mapEvidenceText(decoded, (value) => {
    const redacted = /^[{[]/u.test(value.trimStart())
      ? redactJsonEvidence(value, active, encode, depth + 1)
      : active(value);
    changed ||= redacted !== value;
    return redacted;
  });
  return changed ? encode(mapped) : text;
}
/** Redact before shortening so truncation never retains a prefix of a known secret. */
export function commandDisplay(cmd: string, args?: readonly string[], sensitiveValues: Iterable<string> = []): string {
  const summary = redactSensitiveText([cmd, ...(args ?? [])].join(" "), sensitiveValues);
  return summary.length > 160 ? `${summary.slice(0, 159)}…` : summary;
}
