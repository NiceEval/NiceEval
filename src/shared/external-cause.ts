/**
 * 外部 throwable 的有界快照。`unknown` 只存在于 normalizeExternalCause 的输入边界；
 * 进入领域对象后，字段缺席、cause 截断与非 Error 抛出值都有显式 ADT 分支。
 */

import type { FailureClass } from "./failure-class.ts";

export type ExternalCauseScalar = string | number;

export type ExternalCauseFact<Value> =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Present"; readonly value: Value };

export type ExternalCauseLink =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Cause"; readonly value: ExternalCause }
  | { readonly _tag: "Truncated"; readonly reason: "cycle" | "depth" };

interface ExternalObjectFacts {
  readonly name: string;
  readonly message: string;
  readonly code: ExternalCauseFact<ExternalCauseScalar>;
  readonly status: ExternalCauseFact<number>;
  readonly stack: ExternalCauseFact<string>;
  readonly failureClass: ExternalCauseFact<FailureClass>;
  readonly cause: ExternalCauseLink;
}

export type ExternalCause =
  | ({ readonly _tag: "Error" } & ExternalObjectFacts)
  | ({ readonly _tag: "Object" } & ExternalObjectFacts)
  | {
      readonly _tag: "ThrownValue";
      readonly valueType: "null" | "undefined" | "string" | "number" | "boolean" | "bigint" | "symbol" | "function" | "object";
      readonly message: string;
      readonly cause: { readonly _tag: "Absent" };
    };

const MAX_CAUSE_DEPTH = 5;
const ABSENT = Object.freeze({ _tag: "Absent" as const });
type ExternalCauseValueType = Extract<ExternalCause, { readonly _tag: "ThrownValue" }>["valueType"];

const THROWN_VALUE_TYPES = new Set<ExternalCauseValueType>([
  "null",
  "undefined",
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "function",
  "object",
]);

function isExternalCauseValueType(value: unknown): value is ExternalCauseValueType {
  return typeof value === "string" && THROWN_VALUE_TYPES.has(value as ExternalCauseValueType);
}

function safeString(value: unknown): string {
  try {
    return String(value);
  } catch {
    return "[unprintable thrown value]";
  }
}

function field(value: object, key: string): unknown {
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function constructorName(value: object): string | undefined {
  try {
    const name = Object.getPrototypeOf(value)?.constructor?.name;
    return typeof name === "string" && name !== "" ? name : undefined;
  } catch {
    return undefined;
  }
}

function scalarFact(value: unknown): ExternalCauseFact<ExternalCauseScalar> {
  return typeof value === "string" || typeof value === "number"
    ? Object.freeze({ _tag: "Present" as const, value })
    : ABSENT;
}

function numberFact(value: unknown): ExternalCauseFact<number> {
  return typeof value === "number" && Number.isFinite(value)
    ? Object.freeze({ _tag: "Present" as const, value })
    : ABSENT;
}

function stringFact(value: unknown): ExternalCauseFact<string> {
  return typeof value === "string" && value !== ""
    ? Object.freeze({ _tag: "Present" as const, value })
    : ABSENT;
}

function failureClassFact(value: object): ExternalCauseFact<FailureClass> {
  const tag = field(value, "_tag");
  if (tag !== "NiceevalClassifiedError" && tag !== "ExperimentStateSequenceFailure") return ABSENT;
  const candidate = field(value, "class");
  if (typeof candidate !== "object" || candidate === null) return ABSENT;
  const retryable = field(candidate, "retryable");
  const reason = field(candidate, "reason");
  const scope = field(candidate, "scope");
  if (typeof retryable !== "boolean") return ABSENT;
  if (retryable && typeof reason !== "string") return ABSENT;
  if (reason !== undefined && typeof reason !== "string") return ABSENT;
  if (scope !== undefined && scope !== "attempt" && scope !== "eval" && scope !== "experiment") return ABSENT;
  return Object.freeze({
    _tag: "Present" as const,
    value: Object.freeze({
      retryable,
      ...(reason !== undefined ? { reason } : {}),
      ...(scope !== undefined ? { scope } : {}),
    }) as FailureClass,
  });
}

/** 已归一化快照再次跨模块边界时，也只接受完整 ADT；绝不原样保留调用者对象。 */
function snapshotFact<Value>(
  value: unknown,
  accepts: (candidate: unknown) => candidate is Value,
): ExternalCauseFact<Value> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const tag = field(value, "_tag");
  if (tag === "Absent") return ABSENT;
  const candidate = field(value, "value");
  if (tag !== "Present" || !accepts(candidate)) return undefined;
  return Object.freeze({ _tag: "Present" as const, value: candidate });
}

function isExternalCauseScalar(value: unknown): value is ExternalCauseScalar {
  return typeof value === "string" || typeof value === "number";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isFailureClassSnapshot(value: unknown): value is FailureClass {
  if (typeof value !== "object" || value === null) return false;
  const retryable = field(value, "retryable");
  const reason = field(value, "reason");
  const scope = field(value, "scope");
  return typeof retryable === "boolean" &&
    (!retryable || typeof reason === "string") &&
    (reason === undefined || typeof reason === "string") &&
    (scope === undefined || scope === "attempt" || scope === "eval" || scope === "experiment");
}

function snapshotFailureClass(value: unknown): ExternalCauseFact<FailureClass> | undefined {
  const fact = snapshotFact(value, isFailureClassSnapshot);
  if (fact === undefined || fact._tag !== "Present") return fact;
  return Object.freeze({
    _tag: "Present" as const,
    value: Object.freeze({
      retryable: fact.value.retryable,
      ...(fact.value.reason !== undefined ? { reason: fact.value.reason } : {}),
      ...(fact.value.scope !== undefined ? { scope: fact.value.scope } : {}),
    }) as FailureClass,
  });
}

function snapshotLink(
  value: unknown,
  depth: number,
  ancestors: ReadonlySet<object>,
): ExternalCauseLink | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const tag = field(value, "_tag");
  if (tag === "Absent") return ABSENT;
  if (tag === "Truncated") {
    const reason = field(value, "reason");
    return reason === "cycle" || reason === "depth"
      ? Object.freeze({ _tag: "Truncated" as const, reason })
      : undefined;
  }
  if (tag !== "Cause" || depth + 1 >= MAX_CAUSE_DEPTH) return undefined;
  const nested = field(value, "value");
  if (typeof nested !== "object" || nested === null || ancestors.has(nested)) return undefined;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  const normalized = snapshotCause(nested, depth + 1, nextAncestors);
  return normalized === undefined
    ? undefined
    : Object.freeze({ _tag: "Cause" as const, value: normalized });
}

/** 对已归一化快照做完整结构解码、复制和冻结；undefined 表示走普通 throwable 归一。 */
function snapshotCause(
  value: object,
  depth: number,
  ancestors: ReadonlySet<object>,
): ExternalCause | undefined {
  const tag = field(value, "_tag");
  if (tag === "ThrownValue") {
    const valueType = field(value, "valueType");
    const message = field(value, "message");
    const cause = snapshotLink(field(value, "cause"), depth, ancestors);
    if (!isExternalCauseValueType(valueType) || typeof message !== "string" || cause?._tag !== "Absent") {
      return undefined;
    }
    return Object.freeze({ _tag: "ThrownValue" as const, valueType, message, cause: ABSENT });
  }
  if (tag !== "Error" && tag !== "Object") return undefined;
  const name = field(value, "name");
  const message = field(value, "message");
  const code = snapshotFact(field(value, "code"), isExternalCauseScalar);
  const status = snapshotFact(field(value, "status"), isFiniteNumber);
  const stack = snapshotFact(field(value, "stack"), isNonEmptyString);
  const failureClass = snapshotFailureClass(field(value, "failureClass"));
  const cause = snapshotLink(field(value, "cause"), depth, ancestors);
  if (
    typeof name !== "string" || name === "" || typeof message !== "string" ||
    code === undefined || status === undefined || stack === undefined || failureClass === undefined || cause === undefined
  ) return undefined;
  return Object.freeze({ _tag: tag, name, message, code, status, stack, failureClass, cause });
}

function isError(value: object): boolean {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function normalizeObject(value: object, depth: number, ancestors: ReadonlySet<object>): ExternalCause {
  const nameValue = field(value, "name");
  const name = typeof nameValue === "string" && nameValue !== ""
    ? nameValue
    : constructorName(value) ?? "Object";
  const messageValue = field(value, "message");
  const message = typeof messageValue === "string" && messageValue !== "" ? messageValue : safeString(value);
  const rawCause = field(value, "cause");
  let cause: ExternalCauseLink = ABSENT;
  if (rawCause !== undefined && rawCause !== null) {
    if (depth + 1 >= MAX_CAUSE_DEPTH) {
      cause = { _tag: "Truncated", reason: "depth" };
    } else if (typeof rawCause === "object" && (rawCause === value || ancestors.has(rawCause))) {
      cause = { _tag: "Truncated", reason: "cycle" };
    } else {
      const nextAncestors = new Set(ancestors);
      nextAncestors.add(value);
      cause = { _tag: "Cause", value: normalizeCause(rawCause, depth + 1, nextAncestors) };
    }
  }
  return Object.freeze({
    _tag: isError(value) ? "Error" as const : "Object" as const,
    name,
    message,
    code: scalarFact(field(value, "code") ?? field(value, "errorCode")),
    status: numberFact(field(value, "status") ?? field(value, "statusCode") ?? field(value, "httpStatus")),
    stack: stringFact(field(value, "stack")),
    failureClass: failureClassFact(value),
    cause,
  });
}

function normalizeCause(value: unknown, depth: number, ancestors: ReadonlySet<object>): ExternalCause {
  if (typeof value === "object" && value !== null) {
    // 已经是快照也必须重新解码并深冻结，避免跨 package / JSON 往返的可变伪对象进入状态。
    return snapshotCause(value, depth, ancestors) ?? normalizeObject(value, depth, ancestors);
  }
  return Object.freeze({
    _tag: "ThrownValue" as const,
    valueType: value === null ? "null" as const : typeof value,
    message: safeString(value),
    cause: ABSENT,
  });
}

/** 动态 throwable 进入内部状态的唯一正规化边界。 */
export function normalizeExternalCause(value: unknown): ExternalCause {
  return normalizeCause(value, 0, new Set());
}

/** 已正规化快照的结构守卫；接收跨 package 副本的纯数据 ADT。 */
export function isExternalCause(value: unknown): value is ExternalCause {
  return typeof value === "object" && value !== null && snapshotCause(value, 0, new Set()) !== undefined;
}

function causeLabel(cause: Extract<ExternalCause, { readonly _tag: "Error" | "Object" }>): string {
  const code = cause.code._tag === "Present" ? ` (${String(cause.code.value)})` : "";
  return `${cause.name}${code}: ${cause.message}`;
}

/** 与 formatThrown 相同的可行动文本口径，但输入已经是强类型快照。 */
export function externalCauseText(cause: ExternalCause): string {
  if (cause._tag === "ThrownValue") return cause.message;
  const first = cause.stack._tag === "Present" ? cause.stack.value : `${cause.name}: ${cause.message}`;
  const suffix: string[] = [];
  let link = cause.cause;
  while (link._tag === "Cause") {
    const nested = link.value;
    suffix.push(`  caused by: ${nested._tag === "ThrownValue" ? nested.message : causeLabel(nested)}`);
    link = nested.cause;
  }
  if (link._tag === "Truncated") suffix.push(`  caused by: [${link.reason} truncated]`);
  return suffix.length === 0 ? first : `${first}\n${suffix.join("\n")}`;
}

/** 分类器与单行错误摘要共用的 message 链，不读取 stack 或任意原始对象字段。 */
export function externalCauseMessageChain(cause: ExternalCause): string {
  const messages = [cause.message];
  let link = cause.cause;
  while (link._tag === "Cause") {
    messages.push(link.value.message);
    link = link.value.cause;
  }
  if (link._tag === "Truncated") messages.push(`[${link.reason} truncated]`);
  return messages.filter((message) => message !== "").join(" · ");
}
