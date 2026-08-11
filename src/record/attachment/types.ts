import type { Either, Effect, Schema, Stream } from "effect";
import type { RecordAttachmentOwner } from "../model/core.ts";
import type {
  RecordAttachmentName,
  RecordAttachmentSchemaId,
} from "../model/identifiers.ts";
import type {
  RecordAttachmentDefinitionError,
  RecordAttachmentFamilyError,
  RecordAttachmentMigrationDefinitionError,
  RecordAttachmentRegistryError,
  RecordAttachmentPayloadInvalid,
  RecordAttachmentClosureInvalid,
} from "./errors.ts";

/**
 * The symbols deliberately stay module-private. They make accidental structural
 * manufacture inconvenient at the type boundary; runtime authority lives in the
 * module-private WeakMaps in `runtime.ts`.
 */
const recordBlobRefTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordBlobRef",
);
const recordBlobSourceTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordBlobSource",
);
const recordAttachmentBlobDraftTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentBlobDraft",
);
const recordAttachmentBlobBuilderTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentBlobBuilder",
);
const recordAttachmentWriteTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentWrite",
);
const recordAttachmentDefinitionTypeId: unique symbol = Symbol(
  "@niceeval/record/JsonRecordAttachmentDefinition",
);
const recordAttachmentFamilyTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentFamily",
);
const recordAttachmentMigrationEdgeTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentMigrationEdge",
);
const recordAttachmentMigrationTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentMigration",
);
const recordAttachmentRegistryTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentRegistry",
);
const recordAttachmentValueTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentValue",
);

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
export const recordAttachmentDefinitionBrand = recordAttachmentDefinitionTypeId;
/** @internal */
export const recordAttachmentFamilyBrand = recordAttachmentFamilyTypeId;
/** @internal */
export const recordAttachmentMigrationEdgeBrand = recordAttachmentMigrationEdgeTypeId;
/** @internal */
export const recordAttachmentMigrationBrand = recordAttachmentMigrationTypeId;
/** @internal */
export const recordAttachmentRegistryBrand = recordAttachmentRegistryTypeId;
/** @internal */
export const recordAttachmentValueBrand = recordAttachmentValueTypeId;

/** @internal A runtime-only witness for nominal fields. It must never run. */
export function recordAttachmentTypeWitness<T>(): T {
  throw new Error("RecordAttachment runtime type witnesses are never callable.");
}

/** A package-minted, owner-local blob handle. It deliberately exposes no key. */
export interface RecordBlobRef {
  readonly [recordBlobRefTypeId]: () => void;
}

/**
 * A source is an Effect Stream capability, never a raw bytes payload. The
 * runtime verifies the exact object created by `makeRecordBlobSource` before a
 * builder can retain it.
 */
export interface RecordBlobSource<out E, out R> {
  readonly stream: Stream.Stream<Uint8Array, E, R>;
  readonly [recordBlobSourceTypeId]: () => {
    readonly error: E;
    readonly requirements: R;
  };
}

/** A definition owns one exact JSON schema and blob projection. */
export interface JsonRecordAttachmentDefinition<
  out Owner extends RecordAttachmentOwner,
  Payload,
> {
  readonly owner: Owner;
  readonly name: RecordAttachmentName;
  readonly schemaId: RecordAttachmentSchemaId;
  readonly blobRefs: (payload: Payload) => readonly RecordBlobRef[];
  readonly [recordAttachmentDefinitionTypeId]: () => {
    readonly owner: Owner;
    readonly payload: Payload;
  };
}

/** A draft is minted only by the builder that owns its source stream. */
export interface RecordAttachmentBlobDraft<out E, out R> {
  readonly ref: RecordBlobRef;
  readonly [recordAttachmentBlobDraftTypeId]: () => {
    readonly error: E;
    readonly requirements: R;
  };
}

export type RecordBlobDrafts = readonly RecordAttachmentBlobDraft<unknown, unknown>[];

export type RecordBlobErrors<Blobs extends RecordBlobDrafts> =
  Blobs[number] extends RecordAttachmentBlobDraft<infer E, unknown> ? E : never;

export type RecordBlobRequirements<Blobs extends RecordBlobDrafts> =
  Blobs[number] extends RecordAttachmentBlobDraft<unknown, infer R> ? R : never;

export interface RecordAttachmentBlobBuilder {
  readonly add: <E, R>(
    source: RecordBlobSource<E, R>,
  ) => RecordAttachmentBlobDraft<E, R>;
  readonly [recordAttachmentBlobBuilderTypeId]: () => void;
}

export interface RecordAttachmentBlobBuild<
  Payload,
  Blobs extends RecordBlobDrafts,
> {
  readonly payload: Payload;
  readonly blobs: Blobs;
}

/** Opaque captured write consumed by the generic Record writer. */
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

/** The deep-frozen, self-contained part of an available Attachment read. */
export type RecordAttachmentPayloadSnapshot<Payload> =
  // Keep primitive brands intact before the object branch. In particular,
  // Effect/Brand strings must remain their original branded string types.
  Payload extends null | undefined | string | number | boolean | bigint | symbol
    ? Payload
    : // Blob refs are opaque capabilities, not structural payload objects.
      Payload extends RecordBlobRef
      ? Payload
      : Payload extends readonly (infer Item)[]
        ? readonly RecordAttachmentPayloadSnapshot<Item>[]
        : Payload extends object
          ? {
              readonly [Key in keyof Payload]: RecordAttachmentPayloadSnapshot<
                Payload[Key]
              >;
            }
          : Payload;

export interface RecordBlobHandleInvalid {
  readonly code: "record-blob-handle-invalid";
}

export interface RecordAttachmentBlobs {
  readonly refs: () => readonly RecordBlobRef[];
  readonly bytes: (
    ref: RecordBlobRef,
  ) => Either.Either<Uint8Array, RecordBlobHandleInvalid>;
}

/** A materialized value remains usable after the reader Scope has closed. */
export interface RecordAttachmentValue<out Payload> {
  readonly payload: RecordAttachmentPayloadSnapshot<Payload>;
  readonly blobs: RecordAttachmentBlobs;
  readonly [recordAttachmentValueTypeId]: () => Payload;
}

/** Current schema plus its complete, adjacent evolution graph. */
export interface RecordAttachmentFamily<
  out Owner extends RecordAttachmentOwner,
  out Payload,
> {
  readonly [recordAttachmentFamilyTypeId]: () => {
    readonly owner: Owner;
    readonly payload: Payload;
  };
}

export interface RecordAttachmentMigrationEdge<
  out Owner extends RecordAttachmentOwner,
> {
  readonly [recordAttachmentMigrationEdgeTypeId]: () => Owner;
}

export interface RecordAttachmentMigration<
  out Owner extends RecordAttachmentOwner,
  out E,
  out R,
> extends RecordAttachmentMigrationEdge<Owner> {
  readonly [recordAttachmentMigrationTypeId]: () => {
    readonly error: E;
    readonly requirements: R;
  };
}

export interface RecordAttachmentMigrationTarget<
  Owner extends RecordAttachmentOwner,
  To,
> {
  readonly create: <const Blobs extends RecordBlobDrafts>(
    build: (
      blobs: RecordAttachmentBlobBuilder,
    ) => RecordAttachmentBlobBuild<To, Blobs>,
  ) => RecordAttachmentWrite<
    Owner,
    RecordBlobErrors<Blobs>,
    RecordBlobRequirements<Blobs>
  >;
}

/** A pure lookup registry for the installed Attachment families. */
export interface RecordAttachmentRegistry {
  readonly [recordAttachmentRegistryTypeId]: () => void;
}

export type AnyRecordAttachmentFamily =
  | RecordAttachmentFamily<"run", unknown>
  | RecordAttachmentFamily<"attempt", unknown>;

/** JSON-compatible encoded values, with package-minted refs as the sole in-memory exception. */
export type RecordAttachmentJson =
  | null
  | boolean
  | number
  | string
  | RecordBlobRef
  | readonly RecordAttachmentJson[]
  | { readonly [key: string]: RecordAttachmentJson };

/**
 * Definition callbacks only observe a package-owned payload. Bivariance keeps
 * ordinary named interfaces ergonomic when Effect's Struct type is readonly;
 * the definition still stores Schema.Type<S> as its exact public payload type.
 */
export type RecordAttachmentBlobRefs<Payload> = {
  bivarianceHack(payload: Payload): readonly RecordBlobRef[];
}["bivarianceHack"];

export type DefineJsonRecordAttachmentInput<
  Owner extends RecordAttachmentOwner,
  S extends Schema.Schema.AnyNoContext,
> = {
  readonly owner: Owner;
  readonly name: string;
  readonly schemaId: string;
  readonly schema: S;
  readonly blobRefs: RecordAttachmentBlobRefs<Schema.Schema.Type<S>>;
};

export type DefineRecordAttachmentMigrationInput<
  Owner extends RecordAttachmentOwner,
  From,
  To,
  E,
  R,
> = {
  readonly from: JsonRecordAttachmentDefinition<Owner, From>;
  readonly to: JsonRecordAttachmentDefinition<Owner, To>;
  readonly convert: (
    source: RecordAttachmentValue<From>,
    target: RecordAttachmentMigrationTarget<Owner, To>,
  ) => Effect.Effect<RecordAttachmentWrite<Owner, E, R>, E, R>;
};

export type DeclareRecordAttachmentMigrationUnavailableInput<
  Owner extends RecordAttachmentOwner,
  From,
  To,
> = {
  readonly from: JsonRecordAttachmentDefinition<Owner, From>;
  readonly to: JsonRecordAttachmentDefinition<Owner, To>;
  readonly reason: string;
};

export type DefineRecordAttachmentFamilyInput<
  Owner extends RecordAttachmentOwner,
  Current,
> = {
  readonly current: JsonRecordAttachmentDefinition<Owner, Current>;
  readonly migrations: readonly RecordAttachmentMigrationEdge<Owner>[];
};

export type RecordAttachmentMigrationResolution =
  | { readonly state: "current" }
  | {
      readonly state: "migration-required";
      readonly from: RecordAttachmentSchemaId;
      readonly to: RecordAttachmentSchemaId;
      readonly edges: readonly RecordAttachmentMigrationEdge<RecordAttachmentOwner>[];
    }
  | {
      readonly state: "migration-unavailable";
      readonly from: RecordAttachmentSchemaId;
      readonly to: RecordAttachmentSchemaId;
      readonly reason: string;
    }
  | { readonly state: "unsupported" };

/** Kept here so public operation signatures retain their stable error unions. */
export type RecordAttachmentRuntimeErrors =
  | RecordAttachmentDefinitionError
  | RecordAttachmentPayloadInvalid
  | RecordAttachmentClosureInvalid
  | RecordAttachmentMigrationDefinitionError
  | RecordAttachmentFamilyError
  | RecordAttachmentRegistryError;
