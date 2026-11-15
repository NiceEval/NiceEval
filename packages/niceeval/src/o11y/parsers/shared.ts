import * as Effect from "effect/Effect";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as SchemaGetter from "effect/SchemaGetter";
import type { JsonValue } from "../../types.ts";

/** JSON null and omitted protocol fields become one explicit internal absence. */
export function field<S extends Schema.Constraint>(schema: S) {
  return Schema.NullOr(schema).pipe(
    Schema.decodeTo(Schema.UndefinedOr(Schema.toType(schema)), {
      decode: SchemaGetter.transform((value) => value ?? undefined),
      encode: SchemaGetter.transform((value) => value ?? null),
    }),
    Schema.withDecodingDefault(Effect.succeed(null)),
  );
}

/** The only unknown input is the JSON boundary; consumers receive a tagged result. */
export function lineDecoder<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownResult(schema);
  return (
    line: string,
  ):
    | { readonly kind: "decoded"; readonly value: S["Type"] }
    | { readonly kind: "unrecognized"; readonly type: string }
    | { readonly kind: "invalid-json" } => {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return { kind: "invalid-json" };
    }
    const result = decode(value);
    if (Result.isSuccess(result)) return { kind: "decoded", value: result.success };
    // Classification is part of the failed decoding boundary, never event processing.
    if (Predicate.isObject(value)) {
      const type = value.type ?? value.kind;
      if (typeof type === "string") return { kind: "unrecognized", type };
    }
    return { kind: "unrecognized", type: "<missing-kind>" };
  };
}

const decodeArgs = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.MutableJson));

/** A string containing JSON is a second, explicitly embedded protocol boundary. */
export function coerceArgs(value: JsonValue | undefined): JsonValue {
  if (typeof value !== "string") return value ?? {};
  const decoded = decodeArgs(value);
  return Result.isSuccess(decoded) ? decoded.success : value;
}

export function unrecognized(counter: Record<string, number>, type: string): void {
  counter[type] = (counter[type] ?? 0) + 1;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected transcript variant: ${String(value)}`);
}
