import * as Schema from "effect/Schema";
import * as Result from "effect/Result";

import type { TraceJson } from "../../../adapter-execution-trace.ts";

const IdentifierSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => value.length > 0, { identifier: "ExecutionTraceIdentifier" })),
);
const NonNegativeSafeIntegerSchema = Schema.Number.pipe(
  Schema.check(
    Schema.makeFilter((value) => Number.isSafeInteger(value) && value >= 0, {
      identifier: "ExecutionTraceNonNegativeSafeInteger",
    }),
  ),
);
const FiniteNumberSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter(Number.isFinite, { identifier: "ExecutionTraceFiniteNumber" })),
);
const Sha256Schema = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => /^[0-9a-f]{64}$/u.test(value), { identifier: "ExecutionTraceSha256" })),
);

const TraceInputJsonSchema = Schema.declare<TraceJson>((value): value is TraceJson =>
  Result.isSuccess(snapshotTraceJson(value)),
);
export const ExecutionTraceJsonSchema: Schema.Codec<TraceJson> = Schema.suspend(() =>
  Schema.Union([
    Schema.Null,
    Schema.Boolean,
    FiniteNumberSchema,
    Schema.String,
    Schema.Array(ExecutionTraceJsonSchema),
    Schema.Record(Schema.String, ExecutionTraceJsonSchema),
  ]),
);

// With the Unicode flag, this matches lone surrogates only.
const loneSurrogate = /[\uD800-\uDFFF]/u;

function compareCodePoints(left: string, right: string): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const point = left.codePointAt(index)!;
    const difference = point - right.codePointAt(index)!;
    if (difference !== 0) return difference;
    if (point > 0xffff) index += 1;
  }
  return left.length - right.length;
}

interface TraceJsonFrame {
  readonly source: object;
  readonly output: TraceJson[] | Record<string, TraceJson>;
  readonly keys: readonly string[] | undefined;
  readonly end: number;
  next: number;
}

/** Copy and validate plain JSON without calling producer accessors or using the JS call stack. */
export function snapshotTraceJson(input: unknown): Result.Result<TraceJson, { readonly path: readonly string[] }> {
  const ancestors = new WeakSet<object>();
  const stack: TraceJsonFrame[] = [];
  const path: string[] = [];
  let value: unknown = input;
  try {
    for (;;) {
      let accepted: TraceJson;
      if (value === null || typeof value === "boolean") accepted = value;
      else if (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0)) accepted = value;
      else if (typeof value === "string" && !loneSurrogate.test(value)) accepted = value;
      else if (typeof value === "object" && value !== null && !ancestors.has(value)) {
        const keys = Reflect.ownKeys(value);
        if (Array.isArray(value)) {
          if (keys.length !== value.length + 1) break;
          const output: TraceJson[] = [];
          stack.push({ source: value, output, keys: undefined, end: value.length, next: 0 });
          accepted = output;
        } else {
          const prototype = Object.getPrototypeOf(value);
          if (prototype !== null && prototype !== Object.prototype) break;
          if (!keys.every((key): key is string => typeof key === "string" && !loneSurrogate.test(key))) break;
          const sorted = keys.sort(compareCodePoints);
          const output: Record<string, TraceJson> = Object.create(null);
          stack.push({ source: value, output, keys: sorted, end: sorted.length, next: 0 });
          accepted = output;
        }
        ancestors.add(value);
      } else break;
      if (path.length > 0) {
        const parent = stack[path.length - 1]!;
        if (Array.isArray(parent.output)) parent.output.push(accepted);
        else parent.output[path[path.length - 1]!] = accepted;
      } else input = accepted;

      while (stack.length > 0 && stack[stack.length - 1]!.next === stack[stack.length - 1]!.end) {
        ancestors.delete(stack.pop()!.source);
      }
      const next = stack[stack.length - 1];
      if (next === undefined) return Result.succeed(input as TraceJson);
      const key = next.keys?.[next.next] ?? String(next.next);
      next.next += 1;
      path.length = stack.length;
      path[path.length - 1] = key;
      const descriptor = Object.getOwnPropertyDescriptor(next.source, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) break;
      value = descriptor.value;
    }
  } catch {
    // Reflective operations can fail for a proxy. Treat it like other invalid inputs.
  }
  return Result.fail({ path });
}

/** The same canonical bytes as JSON.stringify on the sorted snapshot, emitted in small pieces. */
export function* canonicalTraceJsonChunks(value: TraceJson): Generator<string> {
  type Frame = {
    readonly value: readonly TraceJson[] | { readonly [key: string]: TraceJson };
    readonly keys: readonly string[] | undefined;
    readonly end: number;
    next: number;
  };
  const stack: Frame[] = [];
  const pieces = function* (): Generator<string> {
    let current = value;
    for (;;) {
      if (current !== null && typeof current === "object") {
        const keys = Array.isArray(current) ? undefined : Object.keys(current);
        stack.push({ value: current, keys, end: keys?.length ?? (current as readonly TraceJson[]).length, next: 0 });
        yield keys === undefined ? "[" : "{";
      } else if (typeof current === "string" && current.length > 16_384) {
        yield '"';
        for (let offset = 0; offset < current.length; ) {
          let end = Math.min(offset + 16_384, current.length);
          const last = current.charCodeAt(end - 1);
          if (end < current.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
          yield JSON.stringify(current.slice(offset, end)).slice(1, -1);
          offset = end;
        }
        yield '"';
      } else yield JSON.stringify(current);

      while (stack.length > 0 && stack[stack.length - 1]!.next === stack[stack.length - 1]!.end) {
        yield stack.pop()!.keys === undefined ? "]" : "}";
      }
      const frame = stack[stack.length - 1];
      if (frame === undefined) return;
      if (frame.next > 0) yield ",";
      if (frame.keys === undefined) current = (frame.value as readonly TraceJson[])[frame.next]!;
      else {
        const key = frame.keys[frame.next]!;
        yield JSON.stringify(key);
        yield ":";
        current = (frame.value as { readonly [key: string]: TraceJson })[key]!;
      }
      frame.next += 1;
    }
  };
  let chunk = "";
  for (const piece of pieces()) {
    if (chunk.length + piece.length > 16_384 && chunk !== "") {
      yield chunk;
      chunk = "";
    }
    chunk += piece;
  }
  if (chunk !== "") yield chunk;
}

/** Decode UTF-8 across storage chunk boundaries without concatenating byte buffers. */
export function parseTraceArtifactJson(chunks: Iterable<Uint8Array>): unknown {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  for (const chunk of chunks) text += decoder.decode(chunk, { stream: true });
  return JSON.parse(text + decoder.decode());
}

export const ExecutionTraceCollectionSchema = Schema.Union([
  Schema.Struct({
    state: Schema.Literal("complete"),
    limitations: Schema.Tuple([]),
  }),
  Schema.Struct({
    state: Schema.Literal("partial"),
    limitations: Schema.NonEmptyArray(
      Schema.Struct({
        code: IdentifierSchema,
        message: Schema.String,
      }),
    ),
  }),
]);

const ScopeSchema = Schema.Struct({
  scopeId: IdentifierSchema,
  label: Schema.String,
  boundary: ExecutionTraceJsonSchema,
});
const InputScopeSchema = ScopeSchema.mapFields((fields) => ({ ...fields, boundary: TraceInputJsonSchema }));

export const ExecutionTraceArchiveRecordSchema = Schema.Struct({
  system: IdentifierSchema.pipe(
    Schema.check(
      Schema.makeFilter((value) => !/[\p{Cc}\uD800-\uDFFF]/u.test(value), {
        identifier: "ExecutionTraceArchiveSystem",
      }),
    ),
  ),
  locator: ExecutionTraceJsonSchema,
  sha256: Schema.optional(Sha256Schema),
  byteLength: Schema.optional(NonNegativeSafeIntegerSchema),
});
const InputArchiveSchema = ExecutionTraceArchiveRecordSchema.mapFields((fields) => ({
  ...fields,
  locator: TraceInputJsonSchema,
}));

const LinkSchema = Schema.Union([
  Schema.Struct({ relation: IdentifierSchema, targetKey: IdentifierSchema }),
  Schema.Struct({
    relation: IdentifierSchema,
    unresolved: Schema.Struct({
      sourceEventId: IdentifierSchema,
      reason: Schema.String,
    }),
  }),
]);

const DisplayRoleSchema = Schema.Literals(["user", "assistant", "system", "other"]);
const DisplayScalarSchema = Schema.Union([Schema.String, FiniteNumberSchema, Schema.Boolean, Schema.Null]);
const DisplayFieldsSchema = Schema.Array(Schema.Struct({ label: Schema.String, value: DisplayScalarSchema }));

const InputDisplayBlockSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("message"),
    role: DisplayRoleSchema,
    speaker: Schema.optional(Schema.String),
    text: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("fields"), fields: DisplayFieldsSchema }),
  Schema.Struct({ kind: Schema.Literal("code"), language: Schema.optional(Schema.String), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("image"), artifactId: IdentifierSchema, alt: Schema.String }),
]);

/** Persisted image blocks carry the descriptor fixed at acceptance. */
export const ExecutionDisplayBlockRecordSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("message"),
    role: DisplayRoleSchema,
    speaker: Schema.optional(Schema.String),
    text: Schema.String,
  }),
  Schema.Struct({ kind: Schema.Literal("fields"), fields: DisplayFieldsSchema }),
  Schema.Struct({ kind: Schema.Literal("code"), language: Schema.optional(Schema.String), text: Schema.String }),
  Schema.Struct({
    kind: Schema.Literal("image"),
    artifactId: IdentifierSchema,
    alt: Schema.String,
    mediaType: Schema.Literals(["image/png", "image/jpeg", "image/webp", "image/gif"]),
    byteLength: NonNegativeSafeIntegerSchema,
    sha256: Sha256Schema,
  }),
]);

const InputEvidenceSchema = Schema.Struct({
  key: IdentifierSchema,
  label: Schema.String,
  artifactId: IdentifierSchema,
  pointer: Schema.String,
});

const InputEventSchema = Schema.Struct({
  key: IdentifierSchema,
  type: IdentifierSchema,
  source: Schema.Struct({
    id: IdentifierSchema,
    eventId: Schema.optional(IdentifierSchema),
    sequence: Schema.optional(NonNegativeSafeIntegerSchema),
  }),
  actor: Schema.optional(
    Schema.Struct({
      id: IdentifierSchema,
      label: Schema.optional(Schema.String),
    }),
  ),
  time: Schema.optional(
    Schema.Struct({
      clockId: IdentifierSchema,
      value: FiniteNumberSchema,
      unit: IdentifierSchema,
    }),
  ),
  summary: Schema.String,
  payload: Schema.optional(TraceInputJsonSchema),
  links: Schema.optional(Schema.Array(LinkSchema)),
  evidence: Schema.optional(Schema.Array(InputEvidenceSchema)),
  scopeMemberships: Schema.optional(
    Schema.Array(
      Schema.Struct({
        scopeId: IdentifierSchema,
        state: Schema.Literals(["included", "excluded", "unknown"]),
      }),
    ),
  ),
  display: Schema.optional(Schema.Array(InputDisplayBlockSchema)),
});

export const ExecutionTraceInputHeaderSchema = Schema.Struct({
  traceId: IdentifierSchema,
  schema: Schema.Struct({ id: IdentifierSchema }),
  archive: Schema.optional(InputArchiveSchema),
});

export const ExecutionTraceInputSchema = ExecutionTraceInputHeaderSchema.pipe(
  Schema.fieldsAssign({
    collection: ExecutionTraceCollectionSchema,
    scopes: Schema.Array(InputScopeSchema),
    events: Schema.Array(InputEventSchema),
  }),
);

export const ExecutionTraceStreamItemSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("scope"), scope: InputScopeSchema }),
  Schema.Struct({ kind: Schema.Literal("event"), event: InputEventSchema }),
  Schema.Struct({ kind: Schema.Literal("end"), collection: ExecutionTraceCollectionSchema }),
]);

export const ExecutionTraceHeaderRecordSchema = Schema.Struct({
  kind: Schema.Literal("trace-header"),
  traceId: IdentifierSchema,
  sourceTraceId: IdentifierSchema,
  schema: Schema.Struct({ id: IdentifierSchema }),
  archive: Schema.optional(ExecutionTraceArchiveRecordSchema),
  collection: ExecutionTraceCollectionSchema,
  scopes: Schema.Array(ScopeSchema),
  index: Schema.optional(Schema.Literal("published")),
  scopeCount: Schema.optional(NonNegativeSafeIntegerSchema),
  eventCount: Schema.optional(NonNegativeSafeIntegerSchema),
  evidenceCount: Schema.optional(NonNegativeSafeIntegerSchema),
});

export const ExecutionTraceEventRecordSchema = Schema.Struct({
  kind: Schema.Literal("event"),
  traceId: IdentifierSchema,
  eventId: IdentifierSchema,
  ordinal: NonNegativeSafeIntegerSchema,
  key: IdentifierSchema,
  type: IdentifierSchema,
  source: Schema.Struct({
    id: IdentifierSchema,
    eventId: Schema.optional(IdentifierSchema),
    sequence: Schema.optional(NonNegativeSafeIntegerSchema),
  }),
  actor: Schema.optional(
    Schema.Struct({
      id: IdentifierSchema,
      label: Schema.optional(Schema.String),
    }),
  ),
  time: Schema.optional(
    Schema.Struct({
      clockId: IdentifierSchema,
      value: FiniteNumberSchema,
      unit: IdentifierSchema,
    }),
  ),
  summary: Schema.String,
  payload: Schema.optional(ExecutionTraceJsonSchema),
  links: Schema.Array(LinkSchema),
  evidence: Schema.Array(
    Schema.Struct({
      key: IdentifierSchema,
      label: Schema.String,
      artifactId: IdentifierSchema,
      pointer: Schema.String,
      evidenceId: IdentifierSchema,
      artifactSha256: Sha256Schema,
      targetSha256: Sha256Schema,
      targetByteLength: NonNegativeSafeIntegerSchema,
    }),
  ),
  scopeMemberships: Schema.Array(
    Schema.Struct({
      scopeId: IdentifierSchema,
      state: Schema.Literals(["included", "excluded", "unknown"]),
    }),
  ),
  // Revision 1 widening: absent on every event written before display blocks.
  display: Schema.optional(Schema.NonEmptyArray(ExecutionDisplayBlockRecordSchema)),
});

export const ExecutionTraceRecordSchema = Schema.Union([
  ExecutionTraceHeaderRecordSchema,
  ExecutionTraceEventRecordSchema,
]);

export const ExecutionTraceScopeRecordSchema = Schema.Struct({
  kind: Schema.Literal("scope"),
  traceId: IdentifierSchema,
  ordinal: NonNegativeSafeIntegerSchema,
  scope: ScopeSchema,
});
export const ExecutionTraceStoredRecordSchema = Schema.Union([
  ExecutionTraceHeaderRecordSchema,
  ExecutionTraceEventRecordSchema,
  ExecutionTraceScopeRecordSchema,
]);

export type ExecutionTraceHeaderRecord = Schema.Schema.Type<typeof ExecutionTraceHeaderRecordSchema>;
export type ExecutionTraceEventRecord = Schema.Schema.Type<typeof ExecutionTraceEventRecordSchema>;
export type ExecutionTraceRecord = Schema.Schema.Type<typeof ExecutionTraceRecordSchema>;
export type ExecutionTraceScopeRecord = Schema.Schema.Type<typeof ExecutionTraceScopeRecordSchema>;
export type ExecutionTraceStoredRecord = Schema.Schema.Type<typeof ExecutionTraceStoredRecordSchema>;
export type ExecutionDisplayBlockRecord = Schema.Schema.Type<typeof ExecutionDisplayBlockRecordSchema>;

export const ExecutionTraceRecordLimits = Object.freeze({
  maximumDetailPreviewBytes: 2 * 1024,
  maximumDetailBytes: 512 * 1024,
  maximumOutlineEvents: 32,
  maximumOutlineBytes: 64 * 1024,
  maximumDisplayPreviewBytes: 1024,
  maximumOutlineEventBytes: 8 * 1024,
  maximumDisplayInlineImageBytes: 16 * 1024 * 1024,
});

export const ExecutionDisplayImageMediaTypes: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

// eslint-disable-next-line no-control-regex
const DISALLOWED_DISPLAY_CHARACTER =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u2028\u2029\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

/** True when a display string contains a control or bidirectional formatting character other than tab and newline. */
export function displayTextHasForbiddenCharacter(value: string): boolean {
  return DISALLOWED_DISPLAY_CHARACTER.test(value);
}
