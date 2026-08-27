import { Result } from "effect";

/** JSON object values are represented by an interface to keep recursion finite to TypeScript. */
export interface RecordJsonObject {
  readonly [key: string]: RecordJson;
}

export type RecordJson =
  | null
  | boolean
  | number
  | string
  | readonly RecordJson[]
  | RecordJsonObject;

/** The Attachment-only durable shape: JSON plus package-owned opaque blob references. */
export interface RecordJsonWithBlobRefsObject<Blob extends object> {
  readonly [key: string]: RecordJsonWithBlobRefs<Blob>;
}

export type RecordJsonWithBlobRefs<Blob extends object> =
  | null
  | boolean
  | number
  | string
  | Blob
  | readonly RecordJsonWithBlobRefs<Blob>[]
  | RecordJsonWithBlobRefsObject<Blob>;

/** Every durable value declares all of these budgets at its definition site. */
export interface RecordSchemaLimits {
  readonly maximumJsonBytes: number;
  readonly maximumDepth: number;
  readonly maximumNodes: number;
  readonly maximumObjectKeys: number;
  readonly maximumArrayItems: number;
  readonly maximumKeyUtf8Bytes: number;
  readonly maximumStringUtf8Bytes: number;
}

export interface RecordCanonicalizationFailure {
  readonly code: "record-json-invalid" | "record-json-limit-exceeded";
  readonly path: readonly string[];
}

export interface RecordCanonicalizationOptions<Blob extends object = never> {
  /** Only the Attachment leaf supplies this package-owned opaque-ref guard. */
  readonly isBlobRef?: (value: object) => value is Blob;
}

export type CanonicalRecordValue<Blob extends object = never> = RecordJsonWithBlobRefs<Blob>;

const encoder = new TextEncoder();

/**
 * Blob refs are intentionally opaque to the generic canonicalizer. Their
 * bounded, deterministic projection makes them count toward the generic JSON
 * budget; the low-level Attachment writer still verifies its actual envelope
 * bytes before persistence.
 */
const blobBudgetProjection: RecordJsonObject = Object.freeze({
  "$niceeval.record.blob-ref": true,
});

interface CanonicalizationState {
  nodes: number;
  readonly ancestors: WeakSet<object>;
  failure: RecordCanonicalizationFailure | undefined;
}

interface DataProperty {
  readonly value: unknown;
}

function failure(
  state: CanonicalizationState,
  code: RecordCanonicalizationFailure["code"],
  path: readonly string[],
): undefined {
  if (state.failure === undefined) {
    state.failure = Object.freeze({
      code,
      path: Object.freeze([...path]),
    });
  }
  return undefined;
}

function compareUtf8(left: string, right: string): number {
  if (left === right) return 0;
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.byteLength, rightBytes.byteLength);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.byteLength - rightBytes.byteLength;
}

/** UTF-8 replacement would make identity bytes ambiguous, so reject lone UTF-16 surrogates first. */
function isUnicodeScalarString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function enumerableDataProperty(
  value: object,
  key: string | symbol,
): DataProperty | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
    return undefined;
  }
  return Object.freeze({ value: descriptor.value });
}

function dataProperty(value: object, key: string | symbol): DataProperty | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor)) return undefined;
  return Object.freeze({ value: descriptor.value });
}

function enter(
  value: unknown,
  depth: number,
  path: readonly string[],
  limits: RecordSchemaLimits,
  state: CanonicalizationState,
): boolean {
  if (depth > limits.maximumDepth) {
    failure(state, "record-json-limit-exceeded", path);
    return false;
  }
  state.nodes += 1;
  if (state.nodes > limits.maximumNodes) {
    failure(state, "record-json-limit-exceeded", path);
    return false;
  }
  if (typeof value === "string") {
    if (!isUnicodeScalarString(value)) {
      failure(state, "record-json-invalid", path);
      return false;
    }
    if (encoder.encode(value).byteLength > limits.maximumStringUtf8Bytes) {
      failure(state, "record-json-limit-exceeded", path);
      return false;
    }
  }
  return true;
}

function sortedObjectKeys(
  value: object,
  path: readonly string[],
  limits: RecordSchemaLimits,
  state: CanonicalizationState,
): readonly string[] | undefined {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    return failure(state, "record-json-invalid", path);
  }
  if (keys.length > limits.maximumObjectKeys) {
    return failure(state, "record-json-limit-exceeded", path);
  }
  const textKeys = keys as string[];
  for (const key of textKeys) {
    if (!isUnicodeScalarString(key)) {
      return failure(state, "record-json-invalid", [...path, key]);
    }
    if (key.length === 0 || encoder.encode(key).byteLength > limits.maximumKeyUtf8Bytes) {
      return failure(state, "record-json-limit-exceeded", [...path, key]);
    }
  }
  return Object.freeze([...textKeys].sort(compareUtf8));
}

function frozenObject<Blob extends object>(
  entries: readonly (readonly [string, RecordJsonWithBlobRefs<Blob>])[],
): RecordJsonWithBlobRefsObject<Blob> {
  const output: Record<string, RecordJsonWithBlobRefs<Blob>> = Object.create(null) as Record<
    string,
    RecordJsonWithBlobRefs<Blob>
  >;
  for (const [key, value] of entries) {
    Object.defineProperty(output, key, {
      configurable: false,
      enumerable: true,
      value,
      writable: false,
    });
  }
  return Object.freeze(output);
}

function canonicalArray<Blob extends object>(
  value: readonly unknown[],
  depth: number,
  path: readonly string[],
  limits: RecordSchemaLimits,
  options: RecordCanonicalizationOptions<Blob>,
  state: CanonicalizationState,
): readonly RecordJsonWithBlobRefs<Blob>[] | undefined {
  if (value.length > limits.maximumArrayItems) {
    return failure(state, "record-json-limit-exceeded", path);
  }
  const expected = new Set<string>(["length"]);
  for (let index = 0; index < value.length; index += 1) expected.add(String(index));
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.size ||
    keys.some((key) => typeof key !== "string" || !expected.has(key))
  ) {
    return failure(state, "record-json-invalid", path);
  }
  const length = dataProperty(value, "length");
  if (length === undefined || length.value !== value.length) {
    return failure(state, "record-json-invalid", path);
  }
  const output: RecordJsonWithBlobRefs<Blob>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const property = enumerableDataProperty(value, String(index));
    if (property === undefined) {
      return failure(state, "record-json-invalid", [...path, String(index)]);
    }
    const item = canonicalizeValue(property.value, depth + 1, [...path, String(index)], limits, options, state);
    if (item === undefined) return undefined;
    output.push(item);
  }
  return Object.freeze(output);
}

function canonicalObject<Blob extends object>(
  value: Record<string, unknown>,
  depth: number,
  path: readonly string[],
  limits: RecordSchemaLimits,
  options: RecordCanonicalizationOptions<Blob>,
  state: CanonicalizationState,
): RecordJsonWithBlobRefsObject<Blob> | undefined {
  const keys = sortedObjectKeys(value, path, limits, state);
  if (keys === undefined) return undefined;
  const entries: Array<readonly [string, RecordJsonWithBlobRefs<Blob>]> = [];
  for (const key of keys) {
    const property = enumerableDataProperty(value, key);
    if (property === undefined) {
      return failure(state, "record-json-invalid", [...path, key]);
    }
    const child = canonicalizeValue(property.value, depth + 1, [...path, key], limits, options, state);
    if (child === undefined) return undefined;
    entries.push([key, child]);
  }
  return frozenObject(entries);
}

function canonicalizeValue<Blob extends object>(
  input: unknown,
  depth: number,
  path: readonly string[],
  limits: RecordSchemaLimits,
  options: RecordCanonicalizationOptions<Blob>,
  state: CanonicalizationState,
): CanonicalRecordValue<Blob> | undefined {
  if (!enter(input, depth, path, limits, state)) return undefined;
  if (input === null || typeof input === "boolean" || typeof input === "string") return input;
  if (typeof input === "number") {
    return Number.isFinite(input) && !Object.is(input, -0)
      ? input
      : failure(state, "record-json-invalid", path);
  }
  if (typeof input !== "object") return failure(state, "record-json-invalid", path);

  try {
    if (options.isBlobRef?.(input)) return input;
    if (state.ancestors.has(input)) return failure(state, "record-json-invalid", path);
    state.ancestors.add(input);
    try {
      if (Array.isArray(input)) return canonicalArray(input, depth, path, limits, options, state);
      return isPlainRecord(input)
        ? canonicalObject(input, depth, path, limits, options, state)
        : failure(state, "record-json-invalid", path);
    } finally {
      state.ancestors.delete(input);
    }
  } catch {
    return failure(state, "record-json-invalid", path);
  }
}

function projectBlobRefsForBudget<Blob extends object>(
  value: CanonicalRecordValue<Blob>,
  options: RecordCanonicalizationOptions<Blob>,
): RecordJson | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (typeof value !== "object") return undefined;
  if (options.isBlobRef?.(value)) return blobBudgetProjection;
  if (Array.isArray(value)) {
    const items: RecordJson[] = [];
    for (const item of value) {
      const projected = projectBlobRefsForBudget(item, options);
      if (projected === undefined) return undefined;
      items.push(projected);
    }
    return Object.freeze(items);
  }
  if (!isPlainRecord(value)) return undefined;
  const entries: Array<readonly [string, RecordJson]> = [];
  for (const key of Object.keys(value).sort(compareUtf8)) {
    const projected = projectBlobRefsForBudget(value[key] as CanonicalRecordValue<Blob>, options);
    if (projected === undefined) return undefined;
    entries.push([key, projected]);
  }
  return frozenObject(entries) as RecordJsonObject;
}

function jsonBytes(value: RecordJson): number | undefined {
  const text = JSON.stringify(value);
  return text === undefined ? undefined : encoder.encode(text).byteLength;
}

/**
 * The only generic JSON normalizer. It intentionally knows no durable field
 * names or domain types: exact shape belongs to Effect Schema, and Core-only
 * relationships belong to the definition's refine callback.
 */
export function canonicalizeRecordValue<Blob extends object = never>(
  input: unknown,
  limits: RecordSchemaLimits,
  options: RecordCanonicalizationOptions<Blob> = {},
): Result.Result<CanonicalRecordValue<Blob>, RecordCanonicalizationFailure> {
  const state: CanonicalizationState = {
    nodes: 0,
    ancestors: new WeakSet(),
    failure: undefined,
  };
  const value = canonicalizeValue(input, 0, [], limits, options, state);
  if (value === undefined) {
    return Result.fail(
      state.failure ?? Object.freeze({ code: "record-json-invalid" as const, path: Object.freeze([]) }),
    );
  }
  const projected = projectBlobRefsForBudget(value, options);
  const bytes = projected === undefined ? undefined : jsonBytes(projected);
  if (bytes === undefined || bytes > limits.maximumJsonBytes) {
    return Result.fail(
      Object.freeze({ code: "record-json-limit-exceeded" as const, path: Object.freeze([]) }),
    );
  }
  return Result.succeed(value);
}

export function canonicalizeRecordJson(
  input: unknown,
  limits: RecordSchemaLimits,
): Result.Result<RecordJson, RecordCanonicalizationFailure> {
  const result = canonicalizeRecordValue(input, limits);
  return Result.isFailure(result)
    ? Result.fail(result.failure)
    : Result.succeed(result.success as RecordJson);
}

export function canonicalRecordJsonText(value: RecordJson): string {
  const text = JSON.stringify(value);
  if (text === undefined) throw new Error("Canonical Record JSON must be serializable");
  return text;
}
