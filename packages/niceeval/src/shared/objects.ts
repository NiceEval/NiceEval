import * as Predicate from "effect/Predicate";

/** Object-shaped external values, including arrays, but excluding functions. */
export function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return Predicate.isObjectOrArray(value);
}

/** Object-shaped external values whose string keys represent fields. */
export const isRecord = Predicate.isObject;

/** Optional field-map projection used at permissive protocol boundaries. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

/** Plain author objects; class instances retain their separate semantics. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
