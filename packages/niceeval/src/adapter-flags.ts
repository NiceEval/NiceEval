import { Predicate, Result, Schema } from "effect";
import type { JsonValue } from "./shared/types.ts";

export type AdapterFlagsParser = ((input: unknown) => unknown) | undefined;
export type AdapterFlagsValue<Parser extends AdapterFlagsParser> = Parser extends (input: unknown) => infer Flags
  ? Flags
  : Record<string, JsonValue>;
type ReadonlyFlags<Value> = Value extends object ? { readonly [Key in keyof Value]: ReadonlyFlags<Value[Key]> } : Value;
export type AdapterFlagsOutput<Parser extends AdapterFlagsParser> = Parser extends (input: unknown) => infer Flags
  ? ReadonlyFlags<Flags>
  : Readonly<Record<string, JsonValue>>;

type InvalidJsonMember<Value, Seen = never> = unknown extends Value ? never
  : [Value] extends [Seen] ? never
  : Value extends JsonValue ? never
  : Value extends string | number | boolean | null | undefined ? never
  : Value extends (...args: never[]) => unknown ? Value
  : Value extends PromiseLike<unknown> ? Value
  : Value extends readonly (infer Item)[] ? InvalidJsonMember<Item, Seen | Value>
  : Value extends object ? { [Key in keyof Value]-?: InvalidJsonMember<Value[Key], Seen | Value> }[keyof Value]
  : Value;
type InvalidFlagsRecord<Value> = unknown extends Value ? never
  : Value extends readonly unknown[] | ((...args: never[]) => unknown) | PromiseLike<unknown> ? Value
  : Value extends object ? InvalidJsonMember<Value>
  : Value;
type InvalidParser<Parser extends AdapterFlagsParser> = Parser extends (input: unknown) => infer Flags
  ? InvalidFlagsRecord<Flags>
  : never;
export type AdapterFlagsParserValidation<Parser extends AdapterFlagsParser> = [InvalidParser<Parser>] extends [never]
  ? unknown
  : { readonly invalidAdapterFlags: InvalidParser<Parser> };
export type AdapterFlagsParserValidationArgs<Parser extends AdapterFlagsParser> = [InvalidParser<Parser>] extends [never]
  ? []
  : [error: { readonly invalidAdapterFlags: InvalidParser<Parser> }];

export function assertAdapterFlagsParser(value: unknown): asserts value is Exclude<AdapterFlagsParser, undefined> {
  if (!Predicate.isFunction(value)) throw new TypeError("Adapter parseFlags must be a synchronous function.");
}

const JsonPrimitive = Schema.Union([Schema.Null, Schema.String, Schema.Boolean, Schema.Finite]);
const decodePrimitive = Schema.decodeUnknownResult(JsonPrimitive);

/** Copy data properties only: accessors, prototypes, cycles and hidden keys cannot enter identity. */
function copyJson(value: unknown, ancestors: Set<object>, path: string): JsonValue {
  if (!Predicate.isObjectOrArray(value)) {
    const primitive = decodePrimitive(value);
    if (Result.isFailure(primitive)) throw new TypeError(`${path} must contain only JSON values.`);
    return primitive.success;
  }
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain cycles.`);
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} must contain only ordinary JSON objects.`);
  }
  const keys = Reflect.ownKeys(value);
  if (array && keys.length !== value.length + 1) {
    throw new TypeError(`${path} must contain a dense JSON array without extra properties.`);
  }
  ancestors.add(value);
  try {
    const entries: [string, JsonValue][] = [];
    for (const key of keys) {
      if (array && key === "length") continue;
      if (!Predicate.isString(key)) throw new TypeError(`${path} must not contain symbol keys.`);
      if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
        throw new TypeError(`${path} must contain a JSON array without extra properties.`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
        throw new TypeError(`${path}.${key} must be an enumerable JSON data property.`);
      }
      entries.push([key, copyJson(descriptor.value, ancestors, `${path}.${key}`)]);
    }
    if (array) {
      const copy = entries.map(([, child]) => child);
      Object.freeze(copy);
      return copy;
    }
    return Object.freeze(Object.fromEntries(entries));
  } finally {
    ancestors.delete(value);
  }
}

/** The author parser runs exactly once, at the synchronous Experiment definition boundary. */
export function parseAdapterFlags(parseFlags: Exclude<AdapterFlagsParser, undefined>, input: unknown): Readonly<Record<string, JsonValue>> {
  const value = parseFlags(input);
  if (Predicate.isObjectKeyword(value)) {
    const then = Object.getOwnPropertyDescriptor(value, "then");
    if (then && !Object.hasOwn(then, "value")) {
      throw new TypeError("Adapter flags must not contain accessors.");
    }
  }
  if (Predicate.isPromiseLike(value)) {
    // Observe rejection even though asynchronous validation is unsupported.
    void new Promise((resolve) => resolve(value)).catch(() => undefined);
    throw new TypeError("Adapter flags parsing must be synchronous; Promise and thenable results are not supported.");
  }
  if (!Predicate.isObject(value) || Array.isArray(value)) {
    throw new TypeError("Adapter parseFlags output must be a JSON record.");
  }
  return copyJson(value, new Set(), "Adapter flags") as Readonly<Record<string, JsonValue>>;
}
