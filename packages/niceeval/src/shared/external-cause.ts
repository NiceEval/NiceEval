/**
 * 外部 throwable 的诊断快照。`unknown` 只存在于 normalizeExternalCause 的输入边界；
 * 进入领域对象后，字段缺席、cause 环与非 Error 抛出值都有显式 ADT 分支。
 */

import type { FailureClass } from "./failure-class.ts";

/** Limits retained external diagnostic fields to text and numbers; complex live objects are not accepted as scalar facts. */
export type ExternalCauseScalar = string | number;

/** Distinguishes an absent diagnostic property from a captured value; an absent property must not be replaced with an invented default. */
export type ExternalCauseFact<Value> =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Present"; readonly value: Value };

/** Preserves a nested cause, a cycle, or depth truncation from a legacy snapshot. */
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

/** Preserves diagnostic facts from an external thrown value without retaining the live object. */
export type ExternalCause =
  | ({ readonly _tag: "Error" } & ExternalObjectFacts)
  | ({ readonly _tag: "Object" } & ExternalObjectFacts)
  | {
      readonly _tag: "ThrownValue";
      readonly valueType:
        | "null"
        | "undefined"
        | "string"
        | "number"
        | "boolean"
        | "bigint"
        | "symbol"
        | "function"
        | "object";
      readonly message: string;
      readonly cause: { readonly _tag: "Absent" };
    };

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
  return typeof value === "string" || typeof value === "number" ? { _tag: "Present" as const, value } : ABSENT;
}

function numberFact(value: unknown): ExternalCauseFact<number> {
  return typeof value === "number" && Number.isFinite(value) ? { _tag: "Present" as const, value } : ABSENT;
}

function stringFact(value: unknown): ExternalCauseFact<string> {
  return typeof value === "string" && value !== "" ? { _tag: "Present" as const, value } : ABSENT;
}

function failureClassFact(value: object): ExternalCauseFact<FailureClass> {
  const tag = field(value, "_tag");
  if (tag !== "NiceevalClassifiedError") return ABSENT;
  const candidate = field(value, "class");
  if (typeof candidate !== "object" || candidate === null) return ABSENT;
  const retryable = field(candidate, "retryable");
  const reason = field(candidate, "reason");
  const scope = field(candidate, "scope");
  if (typeof retryable !== "boolean") return ABSENT;
  if (retryable && typeof reason !== "string") return ABSENT;
  if (reason !== undefined && typeof reason !== "string") return ABSENT;
  if (scope !== undefined && scope !== "attempt" && scope !== "eval" && scope !== "experiment") return ABSENT;
  return {
    _tag: "Present" as const,
    value: {
      retryable,
      ...(reason !== undefined ? { reason } : {}),
      ...(scope !== undefined ? { scope } : {}),
    } as FailureClass,
  };
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
  return { _tag: "Present" as const, value: candidate };
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
  return (
    typeof retryable === "boolean" &&
    (!retryable || typeof reason === "string") &&
    (reason === undefined || typeof reason === "string") &&
    (scope === undefined || scope === "attempt" || scope === "eval" || scope === "experiment")
  );
}

function snapshotFailureClass(value: unknown): ExternalCauseFact<FailureClass> | undefined {
  const fact = snapshotFact(value, isFailureClassSnapshot);
  if (fact === undefined || fact._tag !== "Present") return fact;
  return {
    _tag: "Present" as const,
    value: {
      retryable: fact.value.retryable,
      ...(fact.value.reason !== undefined ? { reason: fact.value.reason } : {}),
      ...(fact.value.scope !== undefined ? { scope: fact.value.scope } : {}),
    } as FailureClass,
  };
}

type CauseFrame = Omit<Extract<ExternalCause, { _tag: "Error" | "Object" }>, "cause">;

function closeCauseChain(frames: readonly CauseFrame[], tail: ExternalCauseLink): ExternalCauseLink {
  let link = tail;
  for (let index = frames.length - 1; index >= 0; index--) {
    link = { _tag: "Cause", value: { ...frames[index]!, cause: link } };
  }
  return link;
}

function snapshotFrame(value: object, tag: "Error" | "Object"): CauseFrame | undefined {
  const name = field(value, "name");
  const message = field(value, "message");
  const code = snapshotFact(field(value, "code"), isExternalCauseScalar);
  const status = snapshotFact(field(value, "status"), isFiniteNumber);
  const stack = snapshotFact(field(value, "stack"), isNonEmptyString);
  const failureClass = snapshotFailureClass(field(value, "failureClass"));
  if (
    typeof name !== "string" ||
    name === "" ||
    typeof message !== "string" ||
    code === undefined ||
    status === undefined ||
    stack === undefined ||
    failureClass === undefined
  ) {
    return undefined;
  }
  return { _tag: tag, name, message, code, status, stack, failureClass };
}

/** Decode and copy an existing snapshot across a package boundary. */
function snapshotCause(value: object): ExternalCause | undefined {
  const frames: CauseFrame[] = [];
  const seen = new Set<object>();
  let current = value;
  let tail: ExternalCauseLink;
  for (;;) {
    if (seen.has(current)) return undefined;
    seen.add(current);

    const tag = field(current, "_tag");
    if (tag !== "Error" && tag !== "Object" && tag !== "ThrownValue") return undefined;
    const link = field(current, "cause");
    if (typeof link !== "object" || link === null) return undefined;
    const linkTag = field(link, "_tag");
    if (tag === "ThrownValue") {
      const valueType = field(current, "valueType");
      const message = field(current, "message");
      if (!isExternalCauseValueType(valueType) || typeof message !== "string" || linkTag !== "Absent") return undefined;
      tail = { _tag: "Cause", value: { _tag: "ThrownValue", valueType, message, cause: ABSENT } };
      break;
    }
    const frame = snapshotFrame(current, tag);
    if (frame === undefined) return undefined;
    frames.push(frame);

    if (linkTag === "Absent") {
      tail = ABSENT;
      break;
    }
    if (linkTag === "Truncated") {
      const reason = field(link, "reason");
      if (reason !== "cycle" && reason !== "depth") return undefined;
      tail = { _tag: "Truncated", reason };
      break;
    }
    if (linkTag !== "Cause") return undefined;
    const nested = field(link, "value");
    if (typeof nested !== "object" || nested === null) return undefined;
    current = nested;
  }
  const normalized = closeCauseChain(frames, tail);
  return normalized._tag === "Cause" ? normalized.value : undefined;
}

function isError(value: object): boolean {
  try {
    return value instanceof Error;
  } catch {
    return false;
  }
}

function normalizeFrame(value: object): CauseFrame {
  const nameValue = field(value, "name");
  const name = typeof nameValue === "string" && nameValue !== "" ? nameValue : (constructorName(value) ?? "Object");
  const messageValue = field(value, "message");
  const message = typeof messageValue === "string" && messageValue !== "" ? messageValue : safeString(value);
  return {
    _tag: isError(value) ? "Error" : "Object",
    name,
    message,
    code: scalarFact(field(value, "code") ?? field(value, "errorCode")),
    status: numberFact(field(value, "status") ?? field(value, "statusCode") ?? field(value, "httpStatus")),
    stack: stringFact(field(value, "stack")),
    failureClass: failureClassFact(value),
  };
}

function thrownValue(value: unknown): Extract<ExternalCause, { _tag: "ThrownValue" }> {
  return {
    _tag: "ThrownValue",
    valueType: value === null ? "null" : typeof value,
    message: safeString(value),
    cause: ABSENT,
  };
}

/** Visit the finite prefix of an external throwable's cause chain, once per value. */
export function* externalCauseChain(value: unknown): Generator<unknown> {
  const seen = new Set<unknown>();
  let current = value;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    yield current;
    current = typeof current === "object" ? field(current, "cause") : undefined;
  }
}

/** 动态 throwable 进入内部状态的唯一正规化边界。 */
export function normalizeExternalCause(value: unknown): ExternalCause {
  if (value == null) return thrownValue(value);
  const frames: CauseFrame[] = [];
  const seen = new Set<object>();
  let current: unknown = value;
  let tail: ExternalCauseLink = ABSENT;
  while (current != null) {
    if (typeof current !== "object") {
      tail = { _tag: "Cause", value: thrownValue(current) };
      break;
    }
    if (seen.has(current)) {
      tail = { _tag: "Truncated", reason: "cycle" };
      break;
    }
    seen.add(current);
    const tag = field(current, "_tag");
    const snapshot = tag === "Error" || tag === "Object" || tag === "ThrownValue" ? snapshotCause(current) : undefined;
    if (snapshot !== undefined) {
      tail = { _tag: "Cause", value: snapshot };
      break;
    }
    frames.push(normalizeFrame(current));
    current = field(current, "cause");
  }
  const normalized = closeCauseChain(frames, tail);
  return normalized._tag === "Cause" ? normalized.value : thrownValue(value);
}

/** 已正规化快照的结构守卫；接收跨 package 副本的纯数据 ADT。 */
export function isExternalCause(value: unknown): value is ExternalCause {
  return typeof value === "object" && value !== null && snapshotCause(value) !== undefined;
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
