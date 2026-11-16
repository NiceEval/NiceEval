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

/** These upstream fields historically treat the empty string as absent. */
export const nonEmptyString = field(Schema.String).pipe(
  Schema.decodeTo(Schema.UndefinedOr(Schema.NonEmptyString), {
    decode: SchemaGetter.transform((value) => value || undefined),
    encode: SchemaGetter.passthrough(),
  }),
);

/** The only unknown input is the JSON boundary; consumers receive a tagged result. */
export function lineDecoder<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  discriminator: "type" | "kind" = "type",
) {
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
      const type = value[discriminator];
      if (typeof type === "string") return { kind: "unrecognized", type };
      if (discriminator === "kind" && typeof value.type === "string")
        return { kind: "unrecognized", type: `type:${value.type}` };
    }
    return { kind: "unrecognized", type: "<missing-kind>" };
  };
}

const decodeArgs = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.MutableJson));

/** Null inside an arbitrary JSON payload is data, rather than a missing field. */
export const jsonField = Schema.UndefinedOr(Schema.MutableJson).pipe(
  Schema.withDecodingDefault(Effect.succeed(undefined)),
);

/** A string containing JSON is a second, explicitly embedded protocol boundary. */
export function coerceArgs(value: JsonValue | undefined): JsonValue {
  if (typeof value !== "string") return value === undefined ? {} : value;
  const decoded = decodeArgs(value);
  return Result.isSuccess(decoded) ? decoded.success : value;
}

export function unrecognized(counter: Record<string, number>, type: string): void {
  counter[type] = (counter[type] ?? 0) + 1;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected transcript variant: ${String(value)}`);
}

/** Last member of nested unions: retain the upstream tag without guessing fields. */
export const UnknownPart = Schema.Struct({ type: field(Schema.String) }).pipe(
  Schema.decodeTo(
    Schema.Struct({ type: Schema.Literal("<unrecognized>"), originalType: Schema.UndefinedOr(Schema.String) }),
    {
      decode: SchemaGetter.transform((part) => ({ type: "<unrecognized>" as const, originalType: part.type })),
      encode: SchemaGetter.transform((part) => ({ type: part.originalType })),
    },
  ),
);
