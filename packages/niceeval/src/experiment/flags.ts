import { Predicate, Result, Schema } from "effect";
import type { ExperimentFlags, FlagValue } from "../shared/types.ts";

const decodeValue = Schema.decodeUnknownResult(Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]));

/** Copy only enumerable data properties; flags are a flat set of execution conditions. */
export function decodeExperimentFlags(value: unknown, label = "Experiment flags"): ExperimentFlags {
  if (!Predicate.isObject(value) || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object of string, finite number, or boolean values.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const entries: [string, FlagValue][] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (!Predicate.isString(key)) throw new TypeError(`${label} must not contain symbol keys.`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new TypeError(`${label}.${key} must be an enumerable data property.`);
    }
    const decoded = decodeValue(descriptor.value);
    if (Result.isFailure(decoded)) {
      throw new TypeError(`${label}.${key} must be a string, finite number, or boolean.`);
    }
    entries.push([key, decoded.success]);
  }
  return Object.freeze(Object.fromEntries(entries));
}
