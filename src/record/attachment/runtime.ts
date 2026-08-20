import { Either, Stream } from "effect";
import {
  isRecordAttachmentOwnerDefinition,
  type RecordAttachmentOwnerDefinition,
} from "../definition/attachment.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import {
  getRecordBlobRefBuilderOwner,
  isRecordBlobRef,
  makeRecordBlobRef,
  makeRecordBlobRefBuilderOwner,
  type RecordBlobRefBuilderOwner,
} from "./blob-ref.ts";
import {
  recordAttachmentClosureInvalid,
  recordAttachmentDefinitionInvalid,
  recordAttachmentIssue,
  recordAttachmentPayloadInvalid,
  type RecordAttachmentClosureInvalid,
  type RecordAttachmentDefinitionError,
  type RecordAttachmentIssue,
  type RecordAttachmentPayloadInvalid,
} from "./errors.ts";
import {
  fixedAttachmentWriteSpecBrand,
  recordAttachmentBlobBuilderBrand,
  recordAttachmentBlobDraftBrand,
  recordAttachmentBlobSourceBrand,
  recordAttachmentTypeWitness,
  recordAttachmentWriteBrand,
  type FixedAttachmentWriteSpec,
  type RecordAttachmentBlobBuild,
  type RecordAttachmentBlobBuilder,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentBlobs,
  type RecordAttachmentJson,
  type RecordAttachmentMaterializedBlob,
  type RecordAttachmentPayloadSnapshot,
  type RecordAttachmentWrite,
  type RecordBlobDrafts,
  type RecordBlobErrors,
  type RecordBlobRef,
  type RecordBlobRequirements,
  type RecordBlobSource,
} from "./types.ts";

type ObjectRecord = Record<PropertyKey, unknown>;

interface BlobSourceRuntime {
  readonly stream: Stream.Stream<Uint8Array, unknown, unknown>;
}

interface BuilderRuntime {
  readonly owner: RecordBlobRefBuilderOwner;
  readonly drafts: RecordAttachmentBlobDraft<unknown, unknown>[];
}

interface DraftRuntime {
  readonly builder: BuilderRuntime;
  readonly ref: RecordBlobRef;
  readonly source: BlobSourceRuntime | undefined;
}

interface WriteRuntime {
  readonly fixed: FixedAttachmentWriteSpec<RecordAttachmentOwner, unknown> | undefined;
  readonly builder: BuilderRuntime | undefined;
  readonly build: { readonly payload: unknown; readonly blobs: unknown } | undefined;
}

const blobSources = new WeakMap<object, BlobSourceRuntime>();
const blobDrafts = new WeakMap<object, DraftRuntime>();
const writes = new WeakMap<object, WriteRuntime>();
const fixedWriteSpecs = new WeakSet<object>();

const recordBlobHandleInvalid = Object.freeze({
  code: "record-blob-handle-invalid" as const,
});

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isObjectRecord(value: unknown): value is ObjectRecord {
  return isObject(value);
}

function readOwn(value: unknown, key: PropertyKey): unknown {
  return isObjectRecord(value) && Object.prototype.hasOwnProperty.call(value, key)
    ? value[key]
    : undefined;
}

function freezeArray<Value>(items: readonly Value[]): readonly Value[] {
  return Object.freeze([...items]);
}

function payloadInvalid(path: readonly string[] = ["payload"]): RecordAttachmentPayloadInvalid {
  return recordAttachmentPayloadInvalid([
    recordAttachmentIssue("record-attachment-schema-invalid", path),
  ]);
}

function closureInvalid(): RecordAttachmentClosureInvalid {
  return recordAttachmentClosureInvalid([
    recordAttachmentIssue("record-attachment-closure-mismatch", ["write"]),
  ]);
}

function fixedSpecInvalid(): RecordAttachmentDefinitionError {
  return recordAttachmentDefinitionInvalid([
    recordAttachmentIssue("record-attachment-family-invalid", []),
  ]);
}

export { isRecordBlobRef, makeRecordBlobRef } from "./blob-ref.ts";

/** Build a source capability from an Effect stream; raw bytes never enter this API. */
export function makeRecordBlobSource<E, R>(
  stream: Stream.Stream<Uint8Array, E, R>,
): RecordBlobSource<E, R> {
  const source = {
    stream,
    [recordAttachmentBlobSourceBrand]: () =>
      recordAttachmentTypeWitness<{ readonly error: E; readonly requirements: R }>(),
  } as unknown as RecordBlobSource<E, R>;
  blobSources.set(source, Object.freeze({ stream: stream as Stream.Stream<Uint8Array, unknown, unknown> }));
  return Object.freeze(source);
}

function makeBuilder(): { readonly builder: RecordAttachmentBlobBuilder; readonly runtime: BuilderRuntime } {
  const runtime: BuilderRuntime = { owner: makeRecordBlobRefBuilderOwner(), drafts: [] };
  const builder = {
    add<E, R>(source: RecordBlobSource<E, R>): RecordAttachmentBlobDraft<E, R> {
      const sourceRuntime = isObject(source) ? blobSources.get(source) : undefined;
      const ref = makeRecordBlobRef(runtime.owner);
      const draft = {
        ref,
        [recordAttachmentBlobDraftBrand]: () =>
          recordAttachmentTypeWitness<{ readonly error: E; readonly requirements: R }>(),
      } as unknown as RecordAttachmentBlobDraft<E, R>;
      blobDrafts.set(draft, Object.freeze({
        builder: runtime,
        ref,
        source: sourceRuntime,
      }));
      runtime.drafts.push(draft as RecordAttachmentBlobDraft<unknown, unknown>);
      return Object.freeze(draft);
    },
    [recordAttachmentBlobBuilderBrand]: () => recordAttachmentTypeWitness<void>(),
  } as unknown as RecordAttachmentBlobBuilder;
  return Object.freeze({ builder: Object.freeze(builder), runtime });
}

function isJsonArrayIndex(key: string): boolean {
  if (key === "0") return true;
  if (!/^[1-9][0-9]*$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < 4_294_967_295;
}

/** Defends the storage bridge in addition to RecordSchemaCodec canonicalization. */
function isAttachmentJson(value: unknown, active = new WeakSet<object>()): value is RecordAttachmentJson {
  if (isRecordBlobRef(value)) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object":
      break;
    default:
      return false;
  }
  if (value === null || !isObject(value) || active.has(value)) return value === null;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      for (const key of Reflect.ownKeys(value)) {
        if (key === "length") continue;
        if (typeof key !== "string" || !isJsonArrayIndex(key)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
      }
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index) || !isAttachmentJson(value[index], active)) return false;
      }
      return true;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return false;
      if (!isAttachmentJson(descriptor.value, active)) return false;
    }
    return true;
  } catch {
    return false;
  } finally {
    active.delete(value);
  }
}

function deepFreezePayload<Payload>(
  value: Payload,
  seen = new WeakSet<object>(),
): RecordAttachmentPayloadSnapshot<Payload> {
  if (!isObject(value) || isRecordBlobRef(value) || seen.has(value)) {
    return value as RecordAttachmentPayloadSnapshot<Payload>;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreezePayload(item, seen);
  } else {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor !== undefined && "value" in descriptor) deepFreezePayload(descriptor.value, seen);
    }
  }
  Object.freeze(value);
  return value as RecordAttachmentPayloadSnapshot<Payload>;
}

function encodeThroughCodec<Payload>(
  ownerDefinition: RecordAttachmentOwnerDefinition<RecordAttachmentOwner, Payload>,
  payload: Payload,
): Either.Either<RecordAttachmentJson, RecordAttachmentPayloadInvalid> {
  const encoded = ownerDefinition.codec.encode(payload);
  if (Either.isLeft(encoded)) return Either.left(payloadInvalid());
  return isAttachmentJson(encoded.right)
    ? Either.right(encoded.right)
    : Either.left(payloadInvalid());
}

function decodeThroughCodec<Payload>(
  ownerDefinition: RecordAttachmentOwnerDefinition<RecordAttachmentOwner, Payload>,
  input: unknown,
): Either.Either<Payload, RecordAttachmentPayloadInvalid> {
  const decoded = ownerDefinition.codec.decode(input);
  if (Either.isLeft(decoded)) return Either.left(payloadInvalid());
  return Either.right(decoded.right as Payload);
}

/**
 * Mint the sole owner-local primitive from a static declaration value. This is
 * deliberately not a registration API: all identity comes from the caller's
 * exact fixed declaration and no global table is kept here.
 */
export function makeFixedAttachmentWriteSpec<
  Owner extends RecordAttachmentOwner,
  Payload,
>(ownerDefinition: RecordAttachmentOwnerDefinition<Owner, Payload>): Either.Either<
  FixedAttachmentWriteSpec<Owner, Payload>,
  RecordAttachmentDefinitionError
> {
  if (!isRecordAttachmentOwnerDefinition(ownerDefinition)) {
    return Either.left(fixedSpecInvalid());
  }
  const exactOwner = ownerDefinition as RecordAttachmentOwnerDefinition<RecordAttachmentOwner, Payload>;
  const spec = {
    owner: ownerDefinition.owner,
    family: ownerDefinition.family,
    schemaVersion: ownerDefinition.schemaVersion,
    encodePayload: (payload: Payload) => encodeThroughCodec(exactOwner, payload),
    decodePayload: (inputValue: unknown) => decodeThroughCodec<Payload>(exactOwner, inputValue),
    refs: ownerDefinition.refs,
    budget: Object.freeze({ ...ownerDefinition.budget }),
    verify: ownerDefinition.verify,
    [fixedAttachmentWriteSpecBrand]: () =>
      recordAttachmentTypeWitness<{ readonly owner: Owner; readonly payload: Payload }>(),
  } as unknown as FixedAttachmentWriteSpec<Owner, Payload>;
  fixedWriteSpecs.add(spec);
  return Either.right(Object.freeze(spec));
}

function validateProjectedRefs(
  extract: (payload: unknown) => readonly RecordBlobRef[],
  payload: unknown,
  builder: BuilderRuntime | undefined,
  issues: RecordAttachmentIssue[],
): readonly RecordBlobRef[] | undefined {
  const projected = extract(payload);
  if (!Array.isArray(projected)) {
    issues.push(recordAttachmentIssue("record-attachment-blob-refs-invalid", ["blobRefs"]));
    return undefined;
  }
  const refs: RecordBlobRef[] = [];
  const seen = new Set<RecordBlobRef>();
  for (const [index, ref] of projected.entries()) {
    const builderOwner = isRecordBlobRef(ref) ? getRecordBlobRefBuilderOwner(ref) : undefined;
    if (!isRecordBlobRef(ref) || (builder !== undefined && builderOwner !== builder.owner)) {
      issues.push(recordAttachmentIssue("record-attachment-blob-ref-illegal", ["payload", String(index)]));
      continue;
    }
    if (seen.has(ref)) {
      issues.push(recordAttachmentIssue("record-attachment-blob-ref-duplicate", ["payload", String(index)]));
      continue;
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function validateWriteRuntime(runtime: WriteRuntime): Either.Either<void, RecordAttachmentClosureInvalid> {
  if (runtime.fixed === undefined || runtime.builder === undefined || runtime.build === undefined) {
    return Either.left(closureInvalid());
  }
  const issues: RecordAttachmentIssue[] = [];
  const encoded = runtime.fixed.encodePayload(runtime.build.payload);
  if (Either.isLeft(encoded)) {
    issues.push(recordAttachmentIssue("record-attachment-payload-invalid", ["payload"]));
  } else if (!isAttachmentJson(encoded.right)) {
    issues.push(recordAttachmentIssue("record-attachment-json-invalid", ["payload"]));
  }
  const projected = validateProjectedRefs(runtime.fixed.refs, runtime.build.payload, runtime.builder, issues);
  if (projected !== undefined && projected.length > runtime.fixed.budget.maximumBlobs) {
    issues.push(recordAttachmentIssue("record-attachment-blob-budget-exceeded", ["blobs"]));
  }
  const projectedSet = new Set<RecordBlobRef>(projected ?? []);
  if (!Array.isArray(runtime.build.blobs)) {
    issues.push(recordAttachmentIssue("record-attachment-closure-mismatch", ["blobs"]));
  } else {
    const submitted = new Map<RecordBlobRef, number>();
    for (const [index, draft] of runtime.build.blobs.entries()) {
      const draftRuntime = isObject(draft) ? blobDrafts.get(draft) : undefined;
      if (draftRuntime === undefined || draftRuntime.builder !== runtime.builder || !isRecordBlobRef(draftRuntime.ref)) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-illegal", ["blobs", String(index)]));
        continue;
      }
      if (draftRuntime.source === undefined) {
        issues.push(recordAttachmentIssue("record-attachment-closure-mismatch", ["blobs", String(index)]));
        continue;
      }
      const count = (submitted.get(draftRuntime.ref) ?? 0) + 1;
      submitted.set(draftRuntime.ref, count);
      if (count > 1) issues.push(recordAttachmentIssue("record-attachment-blob-ref-duplicate", ["blobs", String(index)]));
      if (!projectedSet.has(draftRuntime.ref)) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-extra", ["blobs", String(index)]));
      }
    }
    if (projected !== undefined) {
      for (const [index, ref] of projected.entries()) {
        if ((submitted.get(ref) ?? 0) === 0) {
          issues.push(recordAttachmentIssue("record-attachment-blob-ref-missing", ["payload", String(index)]));
        }
      }
    }
    for (const draft of runtime.builder.drafts) {
      const draftRuntime = blobDrafts.get(draft);
      if (draftRuntime === undefined) throw new Error("RecordAttachment builder registry lost a draft it minted");
      if (!projectedSet.has(draftRuntime.ref) && (submitted.get(draftRuntime.ref) ?? 0) === 0) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-extra", ["builder"]));
      }
    }
  }
  return issues.length === 0 ? Either.right(undefined) : Either.left(recordAttachmentClosureInvalid(issues));
}

/** Build one opaque write from a genuine fixed owner primitive. */
export function makeFixedRecordAttachmentWrite<
  Owner extends RecordAttachmentOwner,
  Payload,
  const Blobs extends RecordBlobDrafts,
>(
  fixed: FixedAttachmentWriteSpec<Owner, Payload>,
  build: (blobs: RecordAttachmentBlobBuilder) => RecordAttachmentBlobBuild<Payload, Blobs>,
): RecordAttachmentWrite<Owner, RecordBlobErrors<Blobs>, RecordBlobRequirements<Blobs>> {
  const builder = isObject(fixed) && fixedWriteSpecs.has(fixed) ? makeBuilder() : undefined;
  const result = builder === undefined ? undefined : build(builder.builder);
  const buildRuntime = isObjectRecord(result)
    ? Object.freeze({ payload: readOwn(result, "payload"), blobs: readOwn(result, "blobs") })
    : undefined;
  const write = {
    [recordAttachmentWriteBrand]: () =>
      recordAttachmentTypeWitness<{
        readonly owner: Owner;
        readonly error: RecordBlobErrors<Blobs>;
        readonly requirements: RecordBlobRequirements<Blobs>;
      }>(),
  } as unknown as RecordAttachmentWrite<Owner, RecordBlobErrors<Blobs>, RecordBlobRequirements<Blobs>>;
  writes.set(write, Object.freeze({
    fixed: builder === undefined ? undefined : fixed as FixedAttachmentWriteSpec<RecordAttachmentOwner, unknown>,
    builder: builder?.runtime,
    build: buildRuntime,
  }));
  return Object.freeze(write);
}

/** Pure closure check used before any blob Stream is consumed. */
export function validateRecordAttachmentWrite<Owner extends RecordAttachmentOwner, E, R>(
  write: RecordAttachmentWrite<Owner, E, R>,
): Either.Either<void, RecordAttachmentClosureInvalid> {
  return isObject(write)
    ? validateWriteRuntime(writes.get(write) ?? Object.freeze({ fixed: undefined, builder: undefined, build: undefined }))
    : Either.left(closureInvalid());
}

/** @internal Integration writer consumes this only after closure validation. */
export interface RecordAttachmentWriteContents<Owner extends RecordAttachmentOwner, Payload, E, R> {
  readonly fixed: FixedAttachmentWriteSpec<Owner, Payload>;
  readonly payload: Payload;
  readonly blobs: readonly {
    readonly ref: RecordBlobRef;
    readonly stream: Stream.Stream<Uint8Array, E, R>;
  }[];
}

/** @internal Extract captured sources without exposing a raw write facade. */
export function recordAttachmentWriteContents<Owner extends RecordAttachmentOwner, Payload, E, R>(
  write: RecordAttachmentWrite<Owner, E, R>,
): Either.Either<RecordAttachmentWriteContents<Owner, Payload, E, R>, RecordAttachmentClosureInvalid> {
  const checked = validateRecordAttachmentWrite(write);
  if (Either.isLeft(checked) || !isObject(write)) return Either.left(Either.isLeft(checked) ? checked.left : closureInvalid());
  const runtime = writes.get(write);
  if (runtime?.fixed === undefined || runtime.build === undefined || !Array.isArray(runtime.build.blobs)) {
    throw new Error("RecordAttachment write passed closure validation without retained fixed contents");
  }
  const captured: { readonly ref: RecordBlobRef; readonly stream: Stream.Stream<Uint8Array, E, R> }[] = [];
  for (const draft of runtime.build.blobs) {
    const draftRuntime = isObject(draft) ? blobDrafts.get(draft) : undefined;
    if (draftRuntime?.source === undefined) throw new Error("RecordAttachment write passed closure validation with an invalid source");
    captured.push(Object.freeze({
      ref: draftRuntime.ref,
      stream: draftRuntime.source.stream as Stream.Stream<Uint8Array, E, R>,
    }));
  }
  return Either.right(Object.freeze({
    fixed: runtime.fixed as FixedAttachmentWriteSpec<Owner, Payload>,
    payload: runtime.build.payload as Payload,
    blobs: freezeArray(captured),
  }));
}

/** @internal The reader-only closure result; it never crosses the Host API. */
export interface FixedMaterializedAttachment<Payload> {
  readonly value: RecordAttachmentPayloadSnapshot<Payload>;
  readonly blobs: RecordAttachmentBlobs;
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array;
}

function validateDecodedMaterializedClosure<Owner extends RecordAttachmentOwner, Payload>(
  fixed: FixedAttachmentWriteSpec<Owner, Payload>,
  payload: Payload,
  blobs: unknown,
): Either.Either<
  { readonly payload: Payload; readonly refs: readonly RecordBlobRef[]; readonly bytes: ReadonlyMap<RecordBlobRef, Uint8Array> },
  RecordAttachmentPayloadInvalid | RecordAttachmentClosureInvalid
> {
  const issues: RecordAttachmentIssue[] = [];
  const projected = validateProjectedRefs(
    fixed.refs as (payload: unknown) => readonly RecordBlobRef[],
    payload,
    undefined,
    issues,
  );
  const expected = new Set<RecordBlobRef>(projected ?? []);
  const materialized = new Map<RecordBlobRef, Uint8Array>();
  let totalBytes = 0;
  if (!Array.isArray(blobs)) {
    issues.push(recordAttachmentIssue("record-attachment-closure-mismatch", ["blobs"]));
  } else {
    for (const [index, entry] of blobs.entries()) {
      const ref = readOwn(entry, "ref");
      const bytes = readOwn(entry, "bytes");
      if (!isRecordBlobRef(ref)) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-illegal", ["blobs", String(index), "ref"]));
        continue;
      }
      if (!isUint8Array(bytes)) {
        issues.push(recordAttachmentIssue("record-attachment-snapshot-bytes-invalid", ["blobs", String(index), "bytes"]));
        continue;
      }
      if (bytes.byteLength > fixed.budget.maximumBlobBytes) {
        issues.push(recordAttachmentIssue("record-attachment-blob-budget-exceeded", ["blobs", String(index), "bytes"]));
      }
      totalBytes += bytes.byteLength;
      if (totalBytes > fixed.budget.maximumTotalBytes) {
        issues.push(recordAttachmentIssue("record-attachment-blob-budget-exceeded", ["blobs"]));
      }
      if (materialized.has(ref)) {
        issues.push(recordAttachmentIssue("record-attachment-blob-ref-duplicate", ["blobs", String(index)]));
        continue;
      }
      materialized.set(ref, bytes);
      if (!expected.has(ref)) issues.push(recordAttachmentIssue("record-attachment-blob-ref-extra", ["blobs", String(index)]));
    }
  }
  for (const [index, ref] of (projected ?? []).entries()) {
    if (!materialized.has(ref)) {
      issues.push(recordAttachmentIssue("record-attachment-blob-ref-missing", ["payload", String(index)]));
    }
  }
  if (materialized.size > fixed.budget.maximumBlobs) {
    issues.push(recordAttachmentIssue("record-attachment-blob-budget-exceeded", ["blobs"]));
  }
  if (issues.length === 0) {
    try {
      const snapshot = Object.freeze([...materialized.entries()].map(([ref, bytes]) => Object.freeze({ ref, bytes })));
      issues.push(...fixed.verify(payload, snapshot));
    } catch {
      issues.push(recordAttachmentIssue("record-attachment-materialized-invalid", ["payload"]));
    }
  }
  return issues.length === 0
    ? Either.right(Object.freeze({ payload, refs: freezeArray(projected ?? []), bytes: materialized }))
    : Either.left(recordAttachmentClosureInvalid(issues));
}

/**
 * Materialize a payload that the fixed owner's exact decoder has just accepted.
 *
 * The reader already performed bytes -> canonical JSON -> exact decode. Re-encoding,
 * cloning, and decoding that same value here neither strengthens the disk trust
 * boundary nor adds an owner check. Blob closure, budgets, owner verification, and
 * the final immutable snapshot remain mandatory.
 */
export function makeFixedRecordAttachmentValueFromDecoded<Owner extends RecordAttachmentOwner, Payload>(
  fixed: FixedAttachmentWriteSpec<Owner, Payload>,
  payload: Payload,
  blobs: readonly RecordAttachmentMaterializedBlob[],
): Either.Either<FixedMaterializedAttachment<Payload>, RecordAttachmentPayloadInvalid | RecordAttachmentClosureInvalid> {
  if (!isObject(fixed) || !fixedWriteSpecs.has(fixed)) return Either.left(payloadInvalid());
  const checked = validateDecodedMaterializedClosure(fixed, payload, blobs);
  if (Either.isLeft(checked)) return Either.left(checked.left);
  const snapshotBytes = new Map<RecordBlobRef, Uint8Array>();
  for (const [ref, bytes] of checked.right.bytes) snapshotBytes.set(ref, new Uint8Array(bytes));
  const refs = freezeArray(checked.right.refs);
  const snapshotBlobs: RecordAttachmentBlobs = Object.freeze({
    refs: () => freezeArray(refs),
    bytes: (ref: RecordBlobRef) => {
      const bytes = isObject(ref) ? snapshotBytes.get(ref) : undefined;
      return bytes === undefined ? Either.left(recordBlobHandleInvalid) : Either.right(new Uint8Array(bytes));
    },
  });
  return Either.right(Object.freeze({
    value: deepFreezePayload(checked.right.payload),
    blobs: snapshotBlobs,
  }));
}
