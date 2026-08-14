import type { Either, Stream } from "effect";
import type { RecordValueDefinition } from "../definition/value.ts";
import type { RecordAttachmentOwner } from "../model/core.ts";
import type {
  RecordAttachmentClosureInvalid,
  RecordAttachmentDefinitionError,
  RecordAttachmentIssue,
  RecordAttachmentPayloadInvalid,
} from "./errors.ts";

const recordBlobRefTypeId: unique symbol = Symbol("@niceeval/record/RecordBlobRef");
const recordBlobSourceTypeId: unique symbol = Symbol("@niceeval/record/RecordBlobSource");
const recordAttachmentBlobDraftTypeId: unique symbol = Symbol("@niceeval/record/RecordAttachmentBlobDraft");
const recordAttachmentBlobBuilderTypeId: unique symbol = Symbol("@niceeval/record/RecordAttachmentBlobBuilder");
const recordAttachmentWriteTypeId: unique symbol = Symbol("@niceeval/record/RecordAttachmentWrite");
const fixedAttachmentWriteSpecTypeId: unique symbol = Symbol("@niceeval/record/FixedAttachmentWriteSpec");

/** @internal Runtime factories need these symbols; WeakMap membership is authority. */
export const recordAttachmentBlobRefBrand = recordBlobRefTypeId;
/** @internal */
export const recordAttachmentBlobSourceBrand = recordBlobSourceTypeId;
/** @internal */
export const recordAttachmentBlobDraftBrand = recordAttachmentBlobDraftTypeId;
/** @internal */
export const recordAttachmentBlobBuilderBrand = recordAttachmentBlobBuilderTypeId;
/** @internal */
export const recordAttachmentWriteBrand = recordAttachmentWriteTypeId;
/** @internal */
export const fixedAttachmentWriteSpecBrand = fixedAttachmentWriteSpecTypeId;

/** @internal A runtime-only witness for nominal fields. It must never run. */
export function recordAttachmentTypeWitness<T>(): T {
  throw new Error("RecordAttachment runtime type witnesses are never callable.");
}

/** A package-minted, owner-local blob handle. It deliberately exposes no key. */
export interface RecordBlobRef {
  readonly [recordBlobRefTypeId]: () => void;
}

/** Static per-owner resource envelope for a fixed family closure. */
export interface RecordAttachmentBlobBudget {
  readonly maximumBlobs: number;
  readonly maximumBlobBytes: number;
  readonly maximumTotalBytes: number;
}

/** Bytes are exposed only to the sealed reader/writer materialization boundary. */
export interface RecordAttachmentMaterializedBlob {
  readonly ref: RecordBlobRef;
  readonly bytes: Uint8Array;
}

/**
 * Family-owned relation checks that need the exact materialized closure, such
 * as byte length and digest claims. They cannot be truthfully established by
 * payload shape validation alone.
 */
export type RecordAttachmentMaterializedRefine<Payload> = (
  payload: Payload,
  blobs: readonly RecordAttachmentMaterializedBlob[],
) => readonly RecordAttachmentIssue[];

export interface RecordBlobSource<out E, out R> {
  readonly stream: Stream.Stream<Uint8Array, E, R>;
  readonly [recordBlobSourceTypeId]: () => {
    readonly error: E;
    readonly requirements: R;
  };
}

export interface RecordAttachmentBlobDraft<out E, out R> {
  readonly ref: RecordBlobRef;
  readonly [recordAttachmentBlobDraftTypeId]: () => {
    readonly error: E;
    readonly requirements: R;
  };
}

export type RecordBlobDrafts = readonly RecordAttachmentBlobDraft<unknown, unknown>[];

export type RecordBlobErrors<Blobs extends RecordBlobDrafts> =
  [Blobs[number]] extends [never]
    ? never
    : Blobs[number] extends RecordAttachmentBlobDraft<infer E, unknown>
      ? E
      : never;

export type RecordBlobRequirements<Blobs extends RecordBlobDrafts> =
  [Blobs[number]] extends [never]
    ? never
    : Blobs[number] extends RecordAttachmentBlobDraft<unknown, infer R>
      ? R
      : never;

export interface RecordAttachmentBlobBuilder {
  readonly add: <E, R>(source: RecordBlobSource<E, R>) => RecordAttachmentBlobDraft<E, R>;
  readonly [recordAttachmentBlobBuilderTypeId]: () => void;
}

export interface RecordAttachmentBlobBuild<Payload, Blobs extends RecordBlobDrafts> {
  readonly payload: Payload;
  readonly blobs: Blobs;
}

/** Opaque write captured by a fixed static family owner primitive. */
export interface RecordAttachmentWrite<
  out Owner extends RecordAttachmentOwner,
  out E,
  out R,
> {
  readonly [recordAttachmentWriteTypeId]: () => {
    readonly owner: Owner;
    readonly error: E;
    readonly requirements: R;
  };
}

export type RecordAttachmentJson =
  | null
  | boolean
  | number
  | string
  | RecordBlobRef
  | readonly RecordAttachmentJson[]
  | { readonly [key: string]: RecordAttachmentJson };

export type RecordAttachmentBlobRefs<Payload> = {
  bivarianceHack(payload: Payload): readonly RecordBlobRef[];
}["bivarianceHack"];

/**
 * A static owner codec and closure primitive, minted from exactly one
 * `defineRecordAttachment(...).current.owners[owner]` value. It contains no
 * lookup, registration, historic decoder, or migration chain.
 */
export interface FixedAttachmentWriteSpec<
  out Owner extends RecordAttachmentOwner,
  Payload,
> {
  readonly owner: Owner;
  readonly family: string;
  readonly schemaVersion: number;
  readonly value: RecordValueDefinition<
    any,
    "json-with-blob-refs",
    RecordBlobRef
  >;
  readonly encodePayload: (
    payload: Payload,
  ) => Either.Either<RecordAttachmentJson, RecordAttachmentPayloadInvalid>;
  readonly decodePayload: (
    input: unknown,
  ) => Either.Either<Payload, RecordAttachmentPayloadInvalid>;
  readonly blobRefs: (payload: Payload) => readonly RecordBlobRef[];
  readonly blobBudget: RecordAttachmentBlobBudget;
  readonly materializedRefine: RecordAttachmentMaterializedRefine<Payload>;
  readonly [fixedAttachmentWriteSpecTypeId]: () => {
    readonly owner: Owner;
    readonly payload: Payload;
  };
}

export type RecordAttachmentPayloadSnapshot<Payload> =
  Payload extends null | undefined | string | number | boolean | bigint | symbol
    ? Payload
    : Payload extends RecordBlobRef
      ? Payload
      : Payload extends readonly (infer Item)[]
        ? readonly RecordAttachmentPayloadSnapshot<Item>[]
        : Payload extends object
          ? { readonly [Key in keyof Payload]: RecordAttachmentPayloadSnapshot<Payload[Key]> }
          : Payload;

export interface RecordBlobHandleInvalid {
  readonly code: "record-blob-handle-invalid";
}

export interface RecordAttachmentBlobs {
  readonly refs: () => readonly RecordBlobRef[];
  readonly bytes: (ref: RecordBlobRef) => Either.Either<Uint8Array, RecordBlobHandleInvalid>;
}

/** Kept so internal operation signatures retain their exact error union. */
export type RecordAttachmentRuntimeErrors =
  | RecordAttachmentDefinitionError
  | RecordAttachmentPayloadInvalid
  | RecordAttachmentClosureInvalid;
