import { Effect, Schema } from "effect";
import {
  recordProtocolError,
  RecordProtocolError,
} from "./errors.ts";
import { JsonValueSchema, type JsonValue } from "./json.ts";

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function failCanonical(
  code:
    | "canonical-json-invalid"
    | "canonical-json-cycle"
    | "canonical-json-unsupported"
    | "canonical-json-nonfinite"
    | "canonical-json-unicode-invalid",
  path: readonly string[],
  message: string,
): never {
  throw recordProtocolError({
    code,
    operation: "canonicalize-json",
    path,
    message,
  });
}

function hasOnlyPairedSurrogates(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}

function encodeString(value: string, path: readonly string[]): string {
  if (!hasOnlyPairedSurrogates(value)) {
    failCanonical(
      "canonical-json-unicode-invalid",
      path,
      "JSON strings and object keys must not contain lone UTF-16 surrogates",
    );
  }
  const encoded: string | undefined = JSON.stringify(value);
  if (encoded === undefined) {
    failCanonical(
      "canonical-json-invalid",
      path,
      "JSON string serialization did not produce bytes",
    );
  }
  return encoded;
}

function isPlainRecord(
  value: unknown,
): value is globalThis.Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: object | null = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function canonicalizeArray(
  value: readonly unknown[],
  path: readonly string[],
  ancestors: WeakSet<object>,
): string {
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    failCanonical(
      "canonical-json-unsupported",
      path,
      "JSON arrays must use the built-in Array prototype",
    );
  }
  if (ancestors.has(value)) {
    failCanonical(
      "canonical-json-cycle",
      path,
      "JSON values must not contain reference cycles",
    );
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    failCanonical(
      "canonical-json-unsupported",
      path,
      "JSON arrays must not contain symbol properties",
    );
  }
  const ownNames = Object.getOwnPropertyNames(value);
  if (ownNames.length !== value.length + 1 || !ownNames.includes("length")) {
    failCanonical(
      "canonical-json-unsupported",
      path,
      "JSON arrays must be dense and must not contain extra properties",
    );
  }

  ancestors.add(value);
  try {
    const encoded: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const key = String(index);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !("value" in descriptor)
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        failCanonical(
          "canonical-json-unsupported",
          [...path, key],
          "JSON array entries must be enumerable data properties",
        );
      }
      const item: unknown = descriptor.value;
      encoded.push(canonicalize(item, [...path, key], ancestors));
    }
    return `[${encoded.join(",")}]`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalizeRecord(
  value: globalThis.Record<string, unknown>,
  path: readonly string[],
  ancestors: WeakSet<object>,
): string {
  if (ancestors.has(value)) {
    failCanonical(
      "canonical-json-cycle",
      path,
      "JSON values must not contain reference cycles",
    );
  }

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    failCanonical(
      "canonical-json-unsupported",
      path,
      "JSON objects must not contain symbol properties",
    );
  }

  const keys = Object.getOwnPropertyNames(value).sort();
  ancestors.add(value);
  try {
    const encoded: string[] = [];
    for (const key of keys) {
      const keyPath = [...path, key];
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !("value" in descriptor)
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        failCanonical(
          "canonical-json-unsupported",
          keyPath,
          "JSON object members must be enumerable data properties",
        );
      }
      const member: unknown = descriptor.value;
      encoded.push(
        `${encodeString(key, keyPath)}:${canonicalize(member, keyPath, ancestors)}`,
      );
    }
    return `{${encoded.join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalize(
  value: unknown,
  path: readonly string[],
  ancestors: WeakSet<object>,
): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return encodeString(value, path);
    case "number": {
      if (!Number.isFinite(value)) {
        failCanonical(
          "canonical-json-nonfinite",
          path,
          "JSON numbers must be finite",
        );
      }
      const encoded: string | undefined = JSON.stringify(value);
      if (encoded === undefined) {
        failCanonical(
          "canonical-json-invalid",
          path,
          "JSON number serialization did not produce bytes",
        );
      }
      return encoded;
    }
    case "object":
      if (isUnknownArray(value)) {
        return canonicalizeArray(value, path, ancestors);
      }
      if (isPlainRecord(value)) {
        return canonicalizeRecord(value, path, ancestors);
      }
      failCanonical(
        "canonical-json-unsupported",
        path,
        "Only plain JSON objects and arrays are supported",
      );
    default:
      failCanonical(
        "canonical-json-unsupported",
        path,
        `Unsupported JSON value type: ${typeof value}`,
      );
  }
}

function normalizeCanonicalFailure(cause: unknown): RecordProtocolError {
  if (cause instanceof RecordProtocolError) return cause;
  return recordProtocolError({
    code: "canonical-json-invalid",
    operation: "canonicalize-json",
    message: causeMessage(cause),
  });
}

/** RFC 8785 JCS text using ECMAScript primitive serialization and UTF-16 key order. */
export function canonicalJsonText(
  value: unknown,
): Effect.Effect<string, RecordProtocolError> {
  return Effect.try({
    try: () => canonicalize(value, [], new WeakSet()),
    catch: normalizeCanonicalFailure,
  });
}

export function canonicalJsonBytes(
  value: unknown,
): Effect.Effect<Uint8Array, RecordProtocolError> {
  return canonicalJsonText(value).pipe(
    Effect.map((text) => UTF8_ENCODER.encode(text)),
  );
}

export function compareCanonicalBytes(
  left: Uint8Array,
  right: Uint8Array,
): number {
  const shared = Math.min(left.byteLength, right.byteLength);
  for (let index = 0; index < shared; index += 1) {
    const difference = left[index] - right[index];
    if (difference !== 0) return difference;
  }
  return left.byteLength - right.byteLength;
}

export function canonicalBytesEqual(
  left: Uint8Array,
  right: Uint8Array,
): boolean {
  return compareCanonicalBytes(left, right) === 0;
}

/** Decode only exact canonical UTF-8 bytes; whitespace, duplicate keys and alternate escapes fail. */
export function decodeCanonicalJsonBytes(
  input: unknown,
): Effect.Effect<JsonValue, RecordProtocolError> {
  const parsed = Effect.try({
    try: (): unknown => {
      if (!(input instanceof Uint8Array)) {
        throw recordProtocolError({
          code: "canonical-json-bytes-invalid",
          operation: "decode-canonical-json",
          message: "Canonical JSON input must be a Uint8Array",
        });
      }
      const text = UTF8_DECODER.decode(input);
      const value: unknown = JSON.parse(text);
      const canonical = UTF8_ENCODER.encode(
        canonicalize(value, [], new WeakSet()),
      );
      if (!canonicalBytesEqual(input, canonical)) {
        throw recordProtocolError({
          code: "canonical-json-not-canonical",
          operation: "decode-canonical-json",
          message: "Input bytes are valid JSON but not exact RFC 8785 canonical bytes",
        });
      }
      return value;
    },
    catch: (cause) => {
      if (cause instanceof RecordProtocolError) return cause;
      return recordProtocolError({
        code: "canonical-json-bytes-invalid",
        operation: "decode-canonical-json",
        message: causeMessage(cause),
      });
    },
  });

  return parsed.pipe(
    Effect.flatMap((value) =>
      Schema.decodeUnknown(JsonValueSchema, {
        errors: "all",
        onExcessProperty: "error",
      })(value).pipe(
        Effect.mapError((cause) =>
          recordProtocolError({
            code: "canonical-json-invalid",
            operation: "decode-canonical-json",
            message: String(cause),
          })
        ),
      )
    ),
  );
}
