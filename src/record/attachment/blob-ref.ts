import { Schema } from "effect";

const recordBlobRefTypeId: unique symbol = Symbol("@niceeval/record/RecordBlobRef");
const recordBlobRefBuilderOwnerTypeId: unique symbol = Symbol("@niceeval/record/RecordBlobRefBuilderOwner");

/** A package-minted, owner-local blob handle. It deliberately exposes no key. */
export interface RecordBlobRef {
  readonly [recordBlobRefTypeId]: () => void;
}

/** @internal Opaque ownership capability for one attachment write builder. */
export interface RecordBlobRefBuilderOwner {
  readonly [recordBlobRefBuilderOwnerTypeId]: () => void;
}

interface BlobRefRuntime {
  readonly builderOwner: RecordBlobRefBuilderOwner | undefined;
}

const builders = new WeakSet<object>();
const refs = new WeakMap<object, BlobRefRuntime>();

/** @internal Creates the unforgeable owner token retained by one write builder. */
export function makeRecordBlobRefBuilderOwner(): RecordBlobRefBuilderOwner {
  const owner = Object.freeze({
    [recordBlobRefBuilderOwnerTypeId]: () => undefined,
  }) as RecordBlobRefBuilderOwner;
  builders.add(owner);
  return owner;
}

/** @internal Mints either a reader-hydrated ref or a ref owned by one write builder. */
export function makeRecordBlobRef(builderOwner?: RecordBlobRefBuilderOwner): RecordBlobRef {
  if (builderOwner !== undefined && !builders.has(builderOwner)) {
    throw new TypeError("Record BlobRef builder owner must be package minted");
  }
  const ref = Object.freeze({
    [recordBlobRefTypeId]: () => undefined,
  }) as RecordBlobRef;
  refs.set(ref, Object.freeze({ builderOwner }));
  return ref;
}

/** WeakMap membership, not shape, is the BlobRef authority check. */
export function isRecordBlobRef(value: unknown): value is RecordBlobRef {
  return typeof value === "object" && value !== null && refs.has(value);
}

/** @internal Returns only the opaque builder identity associated with a minted ref. */
export function getRecordBlobRefBuilderOwner(
  ref: RecordBlobRef,
): RecordBlobRefBuilderOwner | undefined {
  return refs.get(ref)?.builderOwner;
}

/** The sole Declaration the Attachment schema compiler is permitted to accept. */
export const RecordBlobRefSchema: Schema.Schema<RecordBlobRef, RecordBlobRef, never> = Schema.declare<RecordBlobRef>(
  isRecordBlobRef,
  { identifier: "RecordBlobRef" },
);
