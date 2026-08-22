import type { JsonValue } from "./types.ts";

/**
 * 动态 SDK/JSON 边界的运行时判定。这里只接受真正可序列化的 JSON 树；循环引用、
 * 非有限数字以及带自定义原型的实例都不能进入 NiceEval 的领域事件。
 */
export function isJsonValue(value: unknown, ancestors: ReadonlySet<object> = new Set()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(value);
  if (Array.isArray(value)) return value.every((item) => isJsonValue(item, nextAncestors));

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value).every((item) => isJsonValue(item, nextAncestors));
}

/**
 * 把外部 SDK 值收口成 JsonValue。已经合规的值保持引用；其余值先按 JSON 语义清洗，
 * 仍无法序列化时使用调用方给出的强类型回退值。
 */
export function normalizeJsonValue(value: unknown, fallback: JsonValue = null): JsonValue {
  if (isJsonValue(value)) return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) return fallback;
    const parsed: unknown = JSON.parse(serialized);
    return isJsonValue(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}
