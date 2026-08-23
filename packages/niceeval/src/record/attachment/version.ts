import type { Schema } from "effect";

import type { RecordAttachmentOwner } from "../model/core.ts";
import type { RecordSchemaLimits } from "../definition/schema-codec.ts";
import { RecordBlobRefSchema, type RecordBlobRef } from "./blob-ref.ts";
import type { RecordAttachmentBlobBudget } from "./blob-policy.ts";
import type { RecordAttachmentIssue } from "./errors.ts";
import type { RecordAttachmentBlobDraft, RecordBlobDrafts } from "./types.ts";

const recordAttachmentVersionTypeId: unique symbol = Symbol(
  "@niceeval/record/RecordAttachmentVersion",
);

const versions = new WeakSet<object>();

/** Logical content is an opaque handle; storage kind, path, digest and bytes are not value fields. */
export type RecordContentHandle = RecordBlobRef;

/** Capture-only source draft; it is not a durable logical value or read handle. */
export type RecordContentSourceDraft<E, R> = RecordAttachmentBlobDraft<E, R>;
export type RecordContentSourceDrafts = RecordBlobDrafts;

/** The only opaque content declaration accepted by an Attachment value Schema. */
export const RecordContentHandleSchema = RecordBlobRefSchema;

/** A dependency on another owner/family definition. It grants no content capability. */
export interface RecordAttachmentReferenceDescriptor {
  readonly owner: RecordAttachmentOwner;
  readonly family: string;
}

/**
 * Trusted family projection plus the budgets the Core must enforce against
 * hostile encoded values and materialized source bytes.
 */
export interface RecordAttachmentContentDescriptor<Value> {
  readonly select: (value: Value) => readonly RecordContentHandle[];
  readonly valueLimits: RecordSchemaLimits;
  readonly budget: RecordAttachmentBlobBudget;
}

/** Trusted dependency projection; the Core still bounds and validates every descriptor. */
export interface RecordAttachmentReferencesDescriptor<Value> {
  readonly select: (value: Value) => readonly RecordAttachmentReferenceDescriptor[];
  readonly maximumReferences: number;
}

export type RecordAttachmentInvariants<Value> = (
  value: Value,
) => readonly RecordAttachmentIssue[];

export interface RecordAttachmentVersion<
  out Version extends number,
  SourceSchema extends Schema.Schema.AnyNoContext,
> {
  readonly version: Version;
  readonly schema: SourceSchema;
  readonly invariants: RecordAttachmentInvariants<Schema.Schema.Type<SourceSchema>>;
  readonly contents: RecordAttachmentContentDescriptor<Schema.Schema.Type<SourceSchema>>;
  readonly references: RecordAttachmentReferencesDescriptor<Schema.Schema.Type<SourceSchema>>;
  readonly [recordAttachmentVersionTypeId]: () => {
    readonly version: Version;
    readonly value: Schema.Schema.Type<SourceSchema>;
  };
}

export type AnyRecordAttachmentVersion = RecordAttachmentVersion<
  number,
  Schema.Schema.AnyNoContext
>;

/**
 * Define one current-root Attachment version. Historical root/legacy decoders
 * intentionally have no field in this algebra.
 */
export function recordAttachmentVersion<
  const Version extends number,
  const SourceSchema extends Schema.Schema.AnyNoContext,
>(input: {
  readonly version: Version;
  readonly schema: SourceSchema;
  readonly invariants: RecordAttachmentInvariants<Schema.Schema.Type<SourceSchema>>;
  readonly contents: RecordAttachmentContentDescriptor<Schema.Schema.Type<SourceSchema>>;
  readonly references: RecordAttachmentReferencesDescriptor<Schema.Schema.Type<SourceSchema>>;
}): RecordAttachmentVersion<Version, SourceSchema> {
  const version = {
    version: input.version,
    schema: input.schema,
    invariants: input.invariants,
    contents: Object.freeze({
      select: input.contents.select,
      valueLimits: Object.freeze({ ...input.contents.valueLimits }),
      budget: Object.freeze({ ...input.contents.budget }),
    }),
    references: Object.freeze({
      select: input.references.select,
      maximumReferences: input.references.maximumReferences,
    }),
    [recordAttachmentVersionTypeId]: () => ({
      version: input.version,
      value: undefined as never,
    }),
  } as RecordAttachmentVersion<Version, SourceSchema>;
  versions.add(version);
  return Object.freeze(version);
}

/** @internal Runtime authority check; structural copies are not version tokens. */
export function isRecordAttachmentVersion(value: unknown): value is AnyRecordAttachmentVersion {
  return typeof value === "object" && value !== null && versions.has(value);
}

export type RecordAttachmentVersionValue<Version> =
  Version extends RecordAttachmentVersion<number, infer SourceSchema>
    ? Schema.Schema.Type<SourceSchema>
    : never;
