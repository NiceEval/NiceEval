import { Predicate } from "effect";
import { decodeExperimentFlags } from "./experiment/flags.ts";
import type { ExperimentFlags, FlagValue } from "./shared/types.ts";

export type AdapterFlagsParser = ((input: unknown) => unknown) | undefined;
export type AdapterFlagsValue<Parser extends AdapterFlagsParser> = Parser extends (input: unknown) => infer Flags
  ? Flags
  : Record<string, FlagValue>;
type ReadonlyFlags<Value> = Readonly<Value>;
export type AdapterFlagsOutput<Parser extends AdapterFlagsParser> = Parser extends (input: unknown) => infer Flags
  ? ReadonlyFlags<Flags>
  : Readonly<Record<string, FlagValue>>;

type InvalidFlagsRecord<Value> = unknown extends Value ? never
  : Value extends readonly unknown[] | ((...args: never[]) => unknown) | PromiseLike<unknown> ? Value
  : Value extends object ? {
    [Key in keyof Value]-?: Key extends string | number
      ? Exclude<Value[Key], FlagValue | ({} extends Pick<Value, Key> ? undefined : never)>
      : Value[Key]
  }[keyof Value]
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

/** The author parser runs exactly once, at the synchronous Experiment definition boundary. */
export function parseAdapterFlags(parseFlags: Exclude<AdapterFlagsParser, undefined>, input: ExperimentFlags): ExperimentFlags {
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
  return decodeExperimentFlags(value, "Adapter flags");
}
