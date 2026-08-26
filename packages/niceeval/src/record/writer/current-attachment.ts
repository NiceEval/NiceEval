import { Effect, Either, Schema, Stream } from "effect";

import {
  encodeRecordAttachmentCurrent,
  inspectRecordAttachmentOpaqueClosure,
  isRecordAttachmentDefinition,
  isRecordAttachmentReference,
  mintRecordAttachmentReference,
  recordAttachmentReferenceDefinition,
  recordAttachmentReferenceWire,
  resolveRecordAttachmentDefinition,
  RecordAttachmentReference,
  type RecordAttachmentReferenceTarget,
  type RecordAttachmentDefinition,
} from "../attachment/protocol.ts";
import {
  isRecordContentHandle,
  mintRecordContentHandle,
  type RecordBytesContentHandle,
  type RecordContentHandle,
  type RecordTextContentHandle,
} from "../attachment/content.ts";
import {
  recordAttachmentClosureInvalid,
  recordAttachmentIssue,
  recordAttachmentPayloadInvalid,
} from "../attachment/errors.ts";
import { canonicalizeRecordJson, type RecordJson } from "../definition/canonical.ts";
import { RecordBlobKeySchema } from "../codec/identifiers.ts";
import type { RecordBlobKey, Sha256Digest } from "../model/identifiers.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import { RecordResourceLimitExceeded } from "../platform/errors.ts";
import { recordAttachmentEncodeError, type RecordAttachmentCallbackFailed } from "./errors.ts";
import type { RecordWriteError } from "./types.ts";
import { RECORD_JSON_MAXIMUM_BYTES, encodeRecordJsonUtf8 } from "./limits.ts";

const contentEffectTypeId: unique symbol = Symbol("@niceeval/record/AttachedContentEffect");

export type AttachedRecordContent<Handle, E, R> = Handle & {
  readonly [contentEffectTypeId]: () => { readonly error: E; readonly requirements: R };
};

type PreviousAttachmentTraversalDepth = readonly [never, 0, 1, 2, 3, 4, 5, 6, 7];
type PreviousDepth<Depth extends number> = Depth extends keyof PreviousAttachmentTraversalDepth
  ? PreviousAttachmentTraversalDepth[Depth]
  : never;

export type AttachedContentError<Value, Depth extends number = 7> = Depth extends 0
  ? never
  : Value extends { readonly [contentEffectTypeId]: () => { readonly error: infer E } }
  ? E
  : Value extends readonly (infer Item)[] ? AttachedContentError<Item, PreviousDepth<Depth>>
  : Value extends object ? Exclude<{
      [Key in keyof Value]: AttachedContentError<Value[Key], PreviousDepth<Depth>>
    }[keyof Value], undefined>
  : never;

export type AttachedContentRequirements<Value, Depth extends number = 7> = Depth extends 0
  ? never
  : Value extends { readonly [contentEffectTypeId]: () => { readonly requirements: infer R } }
  ? R
  : Value extends readonly (infer Item)[] ? AttachedContentRequirements<Item, PreviousDepth<Depth>>
  : Value extends object ? Exclude<{
      [Key in keyof Value]: AttachedContentRequirements<Value[Key], PreviousDepth<Depth>>
    }[keyof Value], undefined>
  : never;

type AnyDefinition = RecordAttachmentDefinition<RecordAttachmentOwner, string, Schema.Schema.AnyNoContext>;

export interface RecordAttachmentSessionBuilder {
  readonly content: {
    readonly text: (text: string) => AttachedRecordContent<RecordTextContentHandle, never, never>;
    readonly bytes: (bytes: Uint8Array) => AttachedRecordContent<RecordBytesContentHandle, never, never>;
    readonly stream: <E, R>(stream: Stream.Stream<Uint8Array, E, R>) =>
      AttachedRecordContent<RecordBytesContentHandle, E, R>;
  };
  readonly reference: {
    readonly to: <Definition extends RecordAttachmentReferenceTarget, Value>(
      definition: Definition,
      value: Value,
    ) => import("../attachment/protocol.ts").RecordAttachmentReference<AnyDefinition, Value>;
  };
}

interface CapturedSource {
  readonly kind: "text" | "bytes";
  readonly stream: Stream.Stream<Uint8Array, unknown, unknown>;
}

export interface PreparedCurrentAttachment {
  readonly payloadBytes: Uint8Array;
  readonly contents: readonly {
    readonly key: RecordBlobKey;
    readonly sha256: Sha256Digest;
    readonly bytes: Uint8Array;
  }[];
  readonly references: readonly { readonly owner: RecordAttachmentOwner; readonly family: string }[];
  readonly referenceDefinitions: readonly RecordAttachmentDefinition<
    RecordAttachmentOwner,
    string,
    Schema.Schema.AnyNoContext
  >[];
}

/**
 * SQLite capture keeps the canonical logical payload in memory while leaving
 * every Content source as a one-shot Stream. The Host consumes those Streams
 * outside transactions and persists fixed-size chunks incrementally.
 */
export interface PreparedStreamingRecordAttachment<Error = unknown, Requirements = unknown> {
  readonly payloadBytes: Uint8Array;
  readonly contents: readonly {
    readonly key: RecordBlobKey;
    readonly logicalHandle: string;
    readonly kind: "text" | "bytes";
    readonly maximumBytes: number | undefined;
    readonly stream: Stream.Stream<Uint8Array, Error, Requirements>;
  }[];
  readonly references: readonly { readonly owner: RecordAttachmentOwner; readonly family: string }[];
  readonly referenceDefinitions: readonly RecordAttachmentDefinition<
    RecordAttachmentOwner,
    string,
    Schema.Schema.AnyNoContext
  >[];
}

export const RECORD_ATTACHMENT_MAXIMUM_CONTENTS = 100_000;
export const RECORD_ATTACHMENT_MAXIMUM_CONTENT_BYTES = 64 * 1024 * 1024;
export const RECORD_ATTACHMENT_MAXIMUM_TOTAL_CONTENT_BYTES = 128 * 1024 * 1024;

const jsonLimits = Object.freeze({
  maximumJsonBytes: RECORD_JSON_MAXIMUM_BYTES,
  maximumDepth: 64,
  maximumNodes: 100_000,
  maximumObjectKeys: 10_000,
  maximumArrayItems: 100_000,
  maximumKeyUtf8Bytes: 16_384,
  maximumStringUtf8Bytes: 1_048_576,
});

function callbackFailed(cause: unknown): RecordAttachmentCallbackFailed {
  return Object.freeze({ code: "record-attachment-callback-failed", cause });
}

function closureFailed(): ReturnType<typeof recordAttachmentClosureInvalid> {
  return recordAttachmentClosureInvalid([
    recordAttachmentIssue("record-attachment-closure-mismatch", ["value"]),
  ]);
}

function encodeFailed() {
  return recordAttachmentEncodeError(recordAttachmentPayloadInvalid([
    recordAttachmentIssue("record-attachment-schema-invalid", ["value"]),
  ]));
}

function makeBuilder(sources: Map<object, CapturedSource>): RecordAttachmentSessionBuilder {
  const content = <E, R>(
    kind: "text" | "bytes",
    stream: Stream.Stream<Uint8Array, E, R>,
  ): AttachedRecordContent<RecordContentHandle, E, R> => {
    const handle = mintRecordContentHandle(kind);
    sources.set(handle, Object.freeze({
      kind,
      stream: stream as Stream.Stream<Uint8Array, unknown, unknown>,
    }));
    return handle as AttachedRecordContent<RecordContentHandle, E, R>;
  };
  return Object.freeze({
    content: Object.freeze({
      text: (text: string) => content("text", Stream.succeed(new TextEncoder().encode(text))) as AttachedRecordContent<RecordTextContentHandle, never, never>,
      bytes: (bytes: Uint8Array) => content("bytes", Stream.succeed(new Uint8Array(bytes))) as AttachedRecordContent<RecordBytesContentHandle, never, never>,
      stream: <E, R>(stream: Stream.Stream<Uint8Array, E, R>) =>
        content("bytes", stream) as AttachedRecordContent<RecordBytesContentHandle, E, R>,
    }),
    reference: Object.freeze({
      to: <Definition extends RecordAttachmentReferenceTarget, Value>(definition: Definition, value: Value) => {
        const resolved = resolveRecordAttachmentDefinition(definition);
        if (resolved === undefined) {
          throw new TypeError("Record reference requires an exact Attachment definition");
        }
        return mintRecordAttachmentReference(
          RecordAttachmentReference.to<AnyDefinition, Value>(resolved),
          value,
        );
      },
    }),
  });
}

function contentKey(index: number): RecordBlobKey | undefined {
  const value = `content-${String(index + 1).padStart(6, "0")}`;
  const decoded = Schema.decodeUnknownEither(RecordBlobKeySchema)(value);
  return Either.isRight(decoded) ? decoded.right : undefined;
}

function collectContent(
  stream: Stream.Stream<Uint8Array, unknown, unknown>,
  maximumBytes: number,
  family: string,
): Effect.Effect<Uint8Array, unknown | RecordWriteError, unknown> {
  interface CollectState {
    readonly chunks: Uint8Array[];
    readonly byteLength: number;
  }
  return stream.pipe(
    Stream.runFoldEffect(
      { chunks: [], byteLength: 0 } satisfies CollectState,
      (state: CollectState, chunk): Effect.Effect<CollectState, RecordWriteError> => {
        if (!(chunk instanceof Uint8Array)) return Effect.fail(closureFailed());
        const observedAtLeast = state.byteLength + chunk.byteLength;
        if (observedAtLeast > maximumBytes) {
          return Effect.fail(new RecordResourceLimitExceeded({
            code: "record-resource-limit-exceeded",
            resource: "file-bytes",
            maximum: maximumBytes,
            observedAtLeast,
            path: family,
          }));
        }
        return Effect.succeed({
          chunks: [...state.chunks, chunk.slice()],
          byteLength: observedAtLeast,
        });
      },
    ),
    Effect.map(({ chunks, byteLength }) => {
      const bytes = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    }),
  );
}

function replaceOpaque(
  value: unknown,
  replacements: ReadonlyMap<object, RecordJson>,
  active = new WeakSet<object>(),
): unknown {
  if (typeof value !== "object" || value === null) return value;
  const replacement = replacements.get(value);
  if (replacement !== undefined) return replacement;
  if (active.has(value)) throw new TypeError("Record Attachment value is cyclic");
  active.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => replaceOpaque(item, replacements, active));
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!("value" in descriptor) || !descriptor.enumerable) throw new TypeError("Record Attachment value is not data-only");
      output[key] = replaceOpaque(descriptor.value, replacements, active);
    }
    return output;
  } finally {
    active.delete(value);
  }
}

/**
 * Session-only current encoder. It closes every content/reference token before
 * returning physical bytes and never places storage metadata in logical values.
 */
export function prepareCurrentRecordAttachment<
  Definition extends AnyDefinition,
  Value extends Schema.Schema.Type<Definition["schema"]>,
>(input: {
  readonly definition: Definition;
  readonly value: Value | ((build: RecordAttachmentSessionBuilder) => Value);
  readonly digest: (bytes: Uint8Array) => Sha256Digest;
}): Effect.Effect<
  PreparedCurrentAttachment,
  RecordWriteError | AttachedContentError<Value>,
  AttachedContentRequirements<Value>
> {
  const sources = new Map<object, CapturedSource>();
  return Effect.gen(function* () {
    const value = yield* Effect.try({
      try: () => typeof input.value === "function"
        ? (input.value as (build: RecordAttachmentSessionBuilder) => Value)(makeBuilder(sources))
        : input.value,
      catch: callbackFailed,
    });
    const encoded = yield* Effect.try({
      try: () => encodeRecordAttachmentCurrent(input.definition, value),
      catch: callbackFailed,
    });
    if (Either.isLeft(encoded)) return yield* Effect.fail(encodeFailed());
    const inspected = yield* Effect.try({
      try: () => inspectRecordAttachmentOpaqueClosure(input.definition, value),
      catch: callbackFailed,
    });
    if (Either.isLeft(inspected)) return yield* Effect.fail(encodeFailed());

    const contentEntries = inspected.right.filter(({ value }) => isRecordContentHandle(value));
    if (contentEntries.length > RECORD_ATTACHMENT_MAXIMUM_CONTENTS) {
      return yield* Effect.fail(new RecordResourceLimitExceeded({
        code: "record-resource-limit-exceeded",
        resource: "file-bytes",
        maximum: RECORD_ATTACHMENT_MAXIMUM_CONTENTS,
        observedAtLeast: contentEntries.length,
        path: input.definition.family,
      }));
    }
    const replacements = new Map<object, RecordJson>();
    const contents: PreparedCurrentAttachment["contents"][number][] = [];
    let totalBytes = 0;
    for (let index = 0; index < contentEntries.length; index += 1) {
      const entry = contentEntries[index]!;
      const source = sources.get(entry.value);
      const declaration = entry.metadata as { readonly category?: string; readonly kind?: "text" | "bytes"; readonly maximumBytes?: number };
      if (source === undefined || declaration.category !== "content" || declaration.kind !== source.kind) {
        return yield* Effect.fail(closureFailed());
      }
      const maximumBytes = Math.min(
        declaration.maximumBytes ?? RECORD_ATTACHMENT_MAXIMUM_CONTENT_BYTES,
        RECORD_ATTACHMENT_MAXIMUM_CONTENT_BYTES,
      );
      const bytes = yield* collectContent(source.stream, maximumBytes, input.definition.family);
      totalBytes += bytes.byteLength;
      if (totalBytes > RECORD_ATTACHMENT_MAXIMUM_TOTAL_CONTENT_BYTES) {
        return yield* Effect.fail(new RecordResourceLimitExceeded({
          code: "record-resource-limit-exceeded",
          resource: "file-bytes",
          maximum: RECORD_ATTACHMENT_MAXIMUM_TOTAL_CONTENT_BYTES,
          observedAtLeast: totalBytes,
          path: input.definition.family,
        }));
      }
      const key = contentKey(index);
      if (key === undefined) return yield* Effect.fail(closureFailed());
      replacements.set(entry.value, Object.freeze({ "$niceeval.record.content": key }));
      contents.push(Object.freeze({ key, sha256: input.digest(bytes), bytes }));
    }
    if (sources.size !== contentEntries.length) return yield* Effect.fail(closureFailed());

    const referenceIdentities = new Map<string, {
      readonly owner: RecordAttachmentOwner;
      readonly family: string;
      readonly definition: AnyDefinition;
    }>();
    for (const entry of inspected.right) {
      if (!isRecordAttachmentReference(entry.value)) continue;
      const wire = recordAttachmentReferenceWire(entry.value);
      const referenceDefinition = recordAttachmentReferenceDefinition(entry.value);
      if (wire === undefined || referenceDefinition === undefined) {
        return yield* Effect.fail(closureFailed());
      }
      const referenceValue = canonicalizeRecordJson(wire.value, jsonLimits);
      if (Either.isLeft(referenceValue)) return yield* Effect.fail(encodeFailed());
      replacements.set(entry.value, Object.freeze({
        "$niceeval.record.reference": Object.freeze({
          owner: wire.owner,
          family: wire.family,
          value: referenceValue.right,
        }),
      }));
      const identity = `${wire.owner}\u0000${wire.family}`;
      const existing = referenceIdentities.get(identity);
      if (existing !== undefined && existing.definition !== referenceDefinition) {
        return yield* Effect.fail(closureFailed());
      }
      referenceIdentities.set(identity, Object.freeze({
        owner: wire.owner,
        family: wire.family,
        definition: referenceDefinition,
      }));
    }

    const replaced = yield* Effect.try({
      try: () => replaceOpaque(encoded.right, replacements),
      catch: callbackFailed,
    });
    const canonical = canonicalizeRecordJson(replaced, jsonLimits);
    if (Either.isLeft(canonical)) return yield* Effect.fail(encodeFailed());
    const payloadBytes = encodeRecordJsonUtf8(canonical.right);
    if (payloadBytes.byteLength > RECORD_JSON_MAXIMUM_BYTES) return yield* Effect.fail(encodeFailed());
    const orderedReferences = [...referenceIdentities.values()].sort((left, right) =>
      `${left.owner}\u0000${left.family}`.localeCompare(`${right.owner}\u0000${right.family}`)
    );
    return Object.freeze({
      payloadBytes,
      contents: Object.freeze(contents),
      references: Object.freeze(orderedReferences.map(({ owner, family }) =>
        Object.freeze({ owner, family })
      )),
      referenceDefinitions: Object.freeze(orderedReferences.map(({ definition }) => definition)),
    });
  }).pipe(
    Effect.catchAllDefect((cause) => Effect.fail(callbackFailed(cause))),
  ) as Effect.Effect<
    PreparedCurrentAttachment,
    RecordWriteError | AttachedContentError<Value>,
    AttachedContentRequirements<Value>
  >;
}

/**
 * Prepare one immutable logical snapshot without reading any Content bytes.
 * The builder and Schema encoder run exactly once in the capture fiber.
 */
export function prepareStreamingRecordAttachment<
  Definition extends AnyDefinition,
  Value extends Schema.Schema.Type<Definition["schema"]>,
>(input: {
  readonly definition: Definition;
  readonly value: Value | ((build: RecordAttachmentSessionBuilder) => Value);
}): Effect.Effect<
  PreparedStreamingRecordAttachment<
    AttachedContentError<Value>,
    AttachedContentRequirements<Value>
  >,
  RecordWriteError | AttachedContentError<Value>,
  AttachedContentRequirements<Value>
> {
  const sources = new Map<object, CapturedSource>();
  return Effect.gen(function* () {
    const value = yield* Effect.try({
      try: () => typeof input.value === "function"
        ? (input.value as (build: RecordAttachmentSessionBuilder) => Value)(makeBuilder(sources))
        : input.value,
      catch: callbackFailed,
    });
    const encoded = yield* Effect.try({
      try: () => encodeRecordAttachmentCurrent(input.definition, value),
      catch: callbackFailed,
    });
    if (Either.isLeft(encoded)) return yield* Effect.fail(encodeFailed());
    const inspected = yield* Effect.try({
      try: () => inspectRecordAttachmentOpaqueClosure(input.definition, value),
      catch: callbackFailed,
    });
    if (Either.isLeft(inspected)) return yield* Effect.fail(encodeFailed());

    const contentEntries = inspected.right.filter(({ value }) => isRecordContentHandle(value));
    const replacements = new Map<object, RecordJson>();
    const contents: PreparedStreamingRecordAttachment["contents"][number][] = [];
    for (let index = 0; index < contentEntries.length; index += 1) {
      const entry = contentEntries[index]!;
      const source = sources.get(entry.value);
      const declaration = entry.metadata as {
        readonly category?: string;
        readonly kind?: "text" | "bytes";
        readonly maximumBytes?: number;
      };
      if (source === undefined || declaration.category !== "content" || declaration.kind !== source.kind) {
        return yield* Effect.fail(closureFailed());
      }
      const key = contentKey(index);
      if (key === undefined) return yield* Effect.fail(closureFailed());
      replacements.set(entry.value, Object.freeze({ "$niceeval.record.content": key }));
      contents.push(Object.freeze({
        key,
        logicalHandle: key,
        kind: source.kind,
        maximumBytes: declaration.maximumBytes,
        stream: source.stream,
      }));
    }
    if (sources.size !== contentEntries.length) return yield* Effect.fail(closureFailed());

    const referenceIdentities = new Map<string, {
      readonly owner: RecordAttachmentOwner;
      readonly family: string;
      readonly definition: AnyDefinition;
    }>();
    for (const entry of inspected.right) {
      if (!isRecordAttachmentReference(entry.value)) continue;
      const wire = recordAttachmentReferenceWire(entry.value);
      const referenceDefinition = recordAttachmentReferenceDefinition(entry.value);
      if (wire === undefined || referenceDefinition === undefined) return yield* Effect.fail(closureFailed());
      const referenceValue = canonicalizeRecordJson(wire.value, jsonLimits);
      if (Either.isLeft(referenceValue)) return yield* Effect.fail(encodeFailed());
      replacements.set(entry.value, Object.freeze({
        "$niceeval.record.reference": Object.freeze({
          owner: wire.owner,
          family: wire.family,
          value: referenceValue.right,
        }),
      }));
      const identity = `${wire.owner}\u0000${wire.family}`;
      const existing = referenceIdentities.get(identity);
      if (existing !== undefined && existing.definition !== referenceDefinition) {
        return yield* Effect.fail(closureFailed());
      }
      referenceIdentities.set(identity, Object.freeze({
        owner: wire.owner,
        family: wire.family,
        definition: referenceDefinition,
      }));
    }

    const replaced = yield* Effect.try({
      try: () => replaceOpaque(encoded.right, replacements),
      catch: callbackFailed,
    });
    const canonical = canonicalizeRecordJson(replaced, jsonLimits);
    if (Either.isLeft(canonical)) return yield* Effect.fail(encodeFailed());
    const payloadBytes = encodeRecordJsonUtf8(canonical.right);
    if (payloadBytes.byteLength > RECORD_JSON_MAXIMUM_BYTES) return yield* Effect.fail(encodeFailed());
    const orderedReferences = [...referenceIdentities.values()].sort((left, right) =>
      `${left.owner}\u0000${left.family}`.localeCompare(`${right.owner}\u0000${right.family}`)
    );
    return Object.freeze({
      payloadBytes,
      contents: Object.freeze(contents),
      references: Object.freeze(orderedReferences.map(({ owner, family }) => Object.freeze({ owner, family }))),
      referenceDefinitions: Object.freeze(orderedReferences.map(({ definition }) => definition)),
    });
  }).pipe(
    Effect.catchAllDefect((cause) => Effect.fail(callbackFailed(cause))),
  ) as Effect.Effect<
    PreparedStreamingRecordAttachment<
      AttachedContentError<Value>,
      AttachedContentRequirements<Value>
    >,
    RecordWriteError | AttachedContentError<Value>,
    AttachedContentRequirements<Value>
  >;
}
