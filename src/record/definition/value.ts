import { Either, Schema } from "effect";
import {
  canonicalizeRecordJson,
  canonicalizeRecordValue,
  type CanonicalRecordValue,
  type RecordCanonicalizationFailure,
  type RecordCanonicalizationOptions,
  type RecordJson,
  type RecordJsonObject,
  type RecordJsonWithBlobRefsObject,
  type RecordValueLimits,
} from "./canonical.ts";
import {
  isRecordProperty,
  type AnyRecordProperty,
  type RecordPropertyValue,
} from "./property.ts";

const recordValueDefinitionTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordValueDefinition",
);

export type RecordValueLeaf = "json" | "json-with-blob-refs";

export type RecordPropertyMap = Readonly<Record<string, AnyRecordProperty>>;

export type RecordValueOf<Properties extends RecordPropertyMap> = {
  readonly [Field in keyof Properties]: RecordPropertyValue<Properties[Field]>;
};

export type RecordValueEncoded<Leaf extends RecordValueLeaf, Blob extends object> =
  Leaf extends "json"
    ? RecordJsonObject
    : RecordJsonWithBlobRefsObject<Blob>;

export interface RecordValueIssue {
  readonly code: string;
  readonly path: readonly string[];
}

export type RecordValueFailure =
  | { readonly kind: "canonical"; readonly failure: RecordCanonicalizationFailure }
  | { readonly kind: "schema" }
  | { readonly kind: "refine"; readonly issues: readonly RecordValueIssue[] };

export interface RecordValueDefinition<
  Properties extends RecordPropertyMap = RecordPropertyMap,
  Leaf extends RecordValueLeaf = RecordValueLeaf,
  Blob extends object = never,
> {
  readonly properties: Properties;
  readonly leaf: Leaf;
  readonly limits: RecordValueLimits;
  readonly [recordValueDefinitionTypeId]: () => void;
  /** Validates the current TS field shape and its Core/domain refine, never durable keys. */
  readonly schema: Schema.Schema<RecordValueOf<Properties>>;
  /** Decodes the durable-key shape: canonicalize, exact Schema, then refine. */
  readonly decode: (input: unknown) => Either.Either<RecordValueOf<Properties>, RecordValueFailure>;
  /** Encodes the current TS field shape into canonical JSON (or JSON with opaque blob refs). */
  readonly encode: (
    value: RecordValueOf<Properties>,
  ) => Either.Either<RecordValueEncoded<Leaf, Blob>, RecordValueFailure>;
}

export interface DefineRecordValueInput<
  Properties extends RecordPropertyMap,
  Leaf extends RecordValueLeaf,
  Blob extends object = never,
> {
  readonly properties: Properties;
  readonly leaf: Leaf;
  readonly limits: RecordValueLimits;
  readonly isBlobRef?: (value: object) => value is Blob;
  readonly refine?: (value: RecordValueOf<Properties>) => readonly RecordValueIssue[];
}

/** Exact durable-object parsing is always an Effect Schema concern. */
export const RecordDefinitionParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

function assertLimits(limits: RecordValueLimits): void {
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`Record value limit ${key} must be a positive safe integer`);
    }
  }
}

function assertProperties(properties: RecordPropertyMap): readonly (readonly [string, AnyRecordProperty])[] {
  const entries = Object.entries(properties) as Array<readonly [string, AnyRecordProperty]>;
  if (entries.length === 0) throw new TypeError("A Record value needs at least one property");
  const tokenIds = new Set<string>();
  const durableKeys = new Set<string>();
  for (const [field, property] of entries) {
    if (field.length === 0 || !isRecordProperty(property)) {
      throw new TypeError("Record value properties must be minted Record properties");
    }
    if (tokenIds.has(property.id)) {
      throw new TypeError(`Duplicate Record property token: ${property.id}`);
    }
    if (durableKeys.has(property.durableKey)) {
      throw new TypeError(`Duplicate Record durable key: ${property.durableKey}`);
    }
    tokenIds.add(property.id);
    durableKeys.add(property.durableKey);
  }
  return Object.freeze(entries.map(([field, property]) => Object.freeze([field, property] as const)));
}

function isValueObject<Blob extends object>(
  value: CanonicalRecordValue<Blob>,
): value is RecordJsonWithBlobRefsObject<Blob> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function frozenCurrentValue<Properties extends RecordPropertyMap>(
  entries: readonly (readonly [string, AnyRecordProperty])[],
  encoded: Readonly<Record<string, unknown>>,
): RecordValueOf<Properties> {
  const output: Record<string, unknown> = {};
  for (const [field, property] of entries) {
    output[field] = encoded[property.durableKey];
  }
  return deepFreeze(output) as RecordValueOf<Properties>;
}

function frozenCurrentShape<Properties extends RecordPropertyMap>(
  parsed: Readonly<Record<string, unknown>>,
): RecordValueOf<Properties> {
  return deepFreeze({ ...parsed }) as RecordValueOf<Properties>;
}

function encodedCurrentValue(
  entries: readonly (readonly [string, AnyRecordProperty])[],
  value: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [field, property] of entries) {
    output[property.durableKey] = value[field];
  }
  return output;
}

function canonicalFailure(
  failure: RecordCanonicalizationFailure | undefined,
): Either.Either<never, RecordValueFailure> {
  return Either.left(
    Object.freeze({
      kind: "canonical" as const,
      failure: failure ?? Object.freeze({ code: "record-json-invalid" as const, path: Object.freeze([]) }),
    }),
  );
}

/**
 * Defines a current durable object. The declaration drives TS-field mapping,
 * durable-key mapping, exact Effect Schema parsing, canonical JSON, limits,
 * and optional domain refine.
 */
export function defineRecordValue<
  const Properties extends RecordPropertyMap,
  const Leaf extends RecordValueLeaf,
  Blob extends object = never,
>(input: DefineRecordValueInput<Properties, Leaf, Blob>): RecordValueDefinition<Properties, Leaf, Blob> {
  assertLimits(input.limits);
  if (input.leaf === "json" && input.isBlobRef !== undefined) {
    throw new TypeError("The json Record leaf cannot accept blob references");
  }
  const entries = assertProperties(input.properties);
  const frozenProperties = Object.freeze({ ...input.properties }) as Properties;
  const encodedShape: Record<string, Schema.Schema.AnyNoContext> = {};
  const currentShape: Record<string, Schema.Schema.AnyNoContext> = {};
  for (const [field, property] of entries) {
    encodedShape[property.durableKey] = property.schema;
    currentShape[field] = property.schema;
  }
  const encodedSchema = Schema.Struct(encodedShape);
  const currentSchema = Schema.Struct(currentShape);
  const options: RecordCanonicalizationOptions<Blob> = input.leaf === "json-with-blob-refs"
    ? { isBlobRef: input.isBlobRef }
    : {};

  const refine = (
    value: RecordValueOf<Properties>,
  ): Either.Either<RecordValueOf<Properties>, RecordValueFailure> => {
    const issues = input.refine?.(value) ?? [];
    return issues.length === 0
      ? Either.right(value)
      : Either.left(Object.freeze({ kind: "refine" as const, issues: Object.freeze([...issues]) }));
  };

  const validateCurrent = (
    raw: unknown,
  ): Either.Either<RecordValueOf<Properties>, RecordValueFailure> => {
    const parsed = Schema.decodeUnknownEither(currentSchema, RecordDefinitionParseOptions)(raw);
    if (Either.isLeft(parsed)) return Either.left(Object.freeze({ kind: "schema" as const }));
    return refine(frozenCurrentShape<Properties>(parsed.right as Readonly<Record<string, unknown>>));
  };

  const decode = (raw: unknown): Either.Either<RecordValueOf<Properties>, RecordValueFailure> => {
    const canonical = canonicalizeRecordValue(raw, input.limits, options);
    if (Either.isLeft(canonical) || !isValueObject(canonical.right)) {
      return canonicalFailure(Either.isLeft(canonical) ? canonical.left : undefined);
    }
    const parsed = Schema.decodeUnknownEither(encodedSchema, RecordDefinitionParseOptions)(canonical.right);
    if (Either.isLeft(parsed)) return Either.left(Object.freeze({ kind: "schema" as const }));
    return refine(frozenCurrentValue<Properties>(entries, parsed.right as Readonly<Record<string, unknown>>));
  };

  const encode = (
    value: RecordValueOf<Properties>,
  ): Either.Either<RecordValueEncoded<Leaf, Blob>, RecordValueFailure> => {
    const encodedCurrent = Schema.encodeUnknownEither(currentSchema, RecordDefinitionParseOptions)(value);
    if (Either.isLeft(encodedCurrent)) return Either.left(Object.freeze({ kind: "schema" as const }));
    const current = validateCurrent(value);
    if (Either.isLeft(current)) return current;
    const durable = encodedCurrentValue(entries, encodedCurrent.right as Readonly<Record<string, unknown>>);
    const canonical = input.leaf === "json"
      ? canonicalizeRecordJson(durable, input.limits)
      : canonicalizeRecordValue<Blob>(durable, input.limits, options);
    if (Either.isLeft(canonical) || !isValueObject(canonical.right)) {
      return canonicalFailure(Either.isLeft(canonical) ? canonical.left : undefined);
    }
    return Either.right(canonical.right as RecordValueEncoded<Leaf, Blob>);
  };

  const definition: RecordValueDefinition<Properties, Leaf, Blob> = {
    properties: frozenProperties,
    leaf: input.leaf,
    limits: Object.freeze({ ...input.limits }),
    [recordValueDefinitionTypeId]: () => undefined,
    schema: Schema.declare<RecordValueOf<Properties>>((value): value is RecordValueOf<Properties> =>
      Either.isRight(validateCurrent(value))),
    decode,
    encode,
  };
  return Object.freeze(definition);
}

/** Package-private mint check used by the closed fixed-family constructor. */
export function isRecordValueDefinition(
  value: unknown,
): value is Readonly<{ readonly leaf: RecordValueLeaf }> {
  return typeof value === "object" && value !== null && recordValueDefinitionTypeId in value;
}
