import { Either, Schema } from "effect";
import { makeFixedAttachmentWriteSpec } from "../attachment/internal.ts";
import type {
  FixedAttachmentWriteSpec,
  RecordAttachmentWrite,
} from "../attachment/types.ts";
import { RecordExactParseOptions } from "../codec/core.ts";
import type {
  RecordAttachmentAdjacentMigrationLink,
  RecordAttachmentDefinition,
  RecordAttachmentOwnerDefinition,
  RecordAttachmentOwnerInputs,
} from "../definition/index.ts";
import { assertionsRecordAttachment } from "./assertions.ts";
import { artifactsRecordAttachment } from "./artifacts.ts";
import {
  type FixedRecordAttachmentOwner,
} from "./common.ts";
import { fileChangesRecordAttachment } from "./file-changes.ts";
import { observabilityRecordAttachment } from "./observability.ts";
import { sourceNavigationRecordAttachment } from "./source-navigation.ts";
import { sourcesRecordAttachment } from "./sources.ts";

/** The catalog lists declarations only; family identities come from them. */
export const NiceEvalRecordAttachments = Object.freeze({
  assertions: assertionsRecordAttachment,
  observability: observabilityRecordAttachment,
  fileChanges: fileChangesRecordAttachment,
  sourceNavigation: sourceNavigationRecordAttachment,
  sources: sourcesRecordAttachment,
  artifacts: artifactsRecordAttachment,
});

export const NICE_EVAL_FAMILIES = Object.freeze([
  NiceEvalRecordAttachments.assertions.family,
  NiceEvalRecordAttachments.observability.family,
  NiceEvalRecordAttachments.fileChanges.family,
  NiceEvalRecordAttachments.sourceNavigation.family,
  NiceEvalRecordAttachments.sources.family,
  NiceEvalRecordAttachments.artifacts.family,
] as const);

export type NiceEvalFamily = (typeof NICE_EVAL_FAMILIES)[number];

export const NiceEvalFamilySchema: Schema.Schema<NiceEvalFamily> = Schema.Literal(
  ...NICE_EVAL_FAMILIES,
);

function requireFixed<Result, Failure>(result: Either.Either<Result, Failure>, message: string): Result {
  if (Either.isLeft(result)) throw new Error(message);
  return result.right;
}

/** One closed catalog entry derived from one compiled fixed-family owner. */
export interface FixedRecordFamilyDescriptor<
  Family extends NiceEvalFamily,
  Owner extends FixedRecordAttachmentOwner,
  Payload,
> {
  readonly family: Family;
  readonly schemaVersion: number;
  readonly owner: Owner;
  /** The sole low-level closure/write primitive minted from this declaration owner. */
  readonly write: FixedAttachmentWriteSpec<Owner, Payload>;
  /** Declared adjacent upgrade graph; implementations remain lazy. */
  readonly adjacentMigrationLinks: readonly RecordAttachmentAdjacentMigrationLink[];
}

type FixedAttachmentDeclaration = RecordAttachmentDefinition<
  NiceEvalFamily,
  RecordAttachmentOwnerInputs
>;

type DeclaredOwnerDefinition<
  Declaration extends FixedAttachmentDeclaration,
  Owner extends keyof Declaration["current"]["owners"],
> = Declaration extends {
  readonly current: { readonly owners: infer Owners };
}
  ? Owner extends keyof Owners
    ? Exclude<Owners[Owner], undefined>
    : never
  : never;

type DeclaredOwnerPayload<
  Declaration extends FixedAttachmentDeclaration,
  Owner extends keyof Declaration["current"]["owners"],
> = DeclaredOwnerDefinition<Declaration, Owner> extends RecordAttachmentOwnerDefinition<
  Owner & FixedRecordAttachmentOwner,
  infer Payload,
  infer _SourceSchema
>
  ? Payload
  : never;

function fixedFamily<
  const Declaration extends FixedAttachmentDeclaration,
  const Owner extends Extract<keyof Declaration["current"]["owners"], FixedRecordAttachmentOwner>,
>(
  declaration: Declaration,
  owner: Owner,
): FixedRecordFamilyDescriptor<
  Declaration["family"],
  Owner,
  DeclaredOwnerPayload<Declaration, Owner>
>;
function fixedFamily(
  declaration: FixedAttachmentDeclaration,
  owner: FixedRecordAttachmentOwner,
) {
  const ownerDefinition = declaration.current.owners[owner];
  if (ownerDefinition === undefined) {
    throw new Error(`Fixed Record family ${declaration.family} does not declare a ${owner} owner`);
  }
  const write = requireFixed(
    makeFixedAttachmentWriteSpec(ownerDefinition),
    `Fixed Record family ${declaration.family} must have a valid compiled ${owner} owner`,
  );
  return Object.freeze({
    family: declaration.family,
    schemaVersion: declaration.current.schemaVersion,
    owner,
    write,
    adjacentMigrationLinks: declaration.adjacentMigrationLinks,
  });
}

export const assertionsRecordFamily = fixedFamily(NiceEvalRecordAttachments.assertions, "attempt");
export const attemptObservabilityRecordFamily = fixedFamily(NiceEvalRecordAttachments.observability, "attempt");
export const runObservabilityRecordFamily = fixedFamily(NiceEvalRecordAttachments.observability, "run");
export const fileChangesRecordFamily = fixedFamily(NiceEvalRecordAttachments.fileChanges, "attempt");
export const sourceNavigationRecordFamily = fixedFamily(NiceEvalRecordAttachments.sourceNavigation, "attempt");
export const sourcesRecordFamily = fixedFamily(NiceEvalRecordAttachments.sources, "run");
export const attemptArtifactsRecordFamily = fixedFamily(NiceEvalRecordAttachments.artifacts, "attempt");
export const runArtifactsRecordFamily = fixedFamily(NiceEvalRecordAttachments.artifacts, "run");

/** The static Record v1 catalog is closed; family protocol remains at each declaration. */
export const NiceEvalRecordFamilyCatalog = Object.freeze({
  assertions: assertionsRecordFamily,
  observability: Object.freeze({
    attempt: attemptObservabilityRecordFamily,
    run: runObservabilityRecordFamily,
  }),
  fileChanges: fileChangesRecordFamily,
  sourceNavigation: sourceNavigationRecordFamily,
  sources: sourcesRecordFamily,
  artifacts: Object.freeze({
    attempt: attemptArtifactsRecordFamily,
    run: runArtifactsRecordFamily,
  }),
});

export const FixedRecordAttachmentEnvelopeSchema: Schema.Schema<{
  readonly family: NiceEvalFamily;
  readonly schemaVersion: number;
}> = Schema.Struct({
  family: NiceEvalFamilySchema,
  schemaVersion: Schema.Int.pipe(Schema.positive()),
});

export function decodeFixedRecordAttachmentEnvelope(input: unknown): Either.Either<
  { readonly family: NiceEvalFamily; readonly schemaVersion: number },
  { readonly code: "record-fixed-family-envelope-invalid" }
> {
  const decoded = Schema.decodeUnknownEither(FixedRecordAttachmentEnvelopeSchema, RecordExactParseOptions)(input);
  return Either.isLeft(decoded)
    ? Either.left(Object.freeze({ code: "record-fixed-family-envelope-invalid" as const }))
    : Either.right(decoded.right);
}

export function encodeFixedRecordAttachmentEnvelope(
  envelope: { readonly family: NiceEvalFamily; readonly schemaVersion: number },
): Either.Either<
  { readonly family: NiceEvalFamily; readonly schemaVersion: number },
  { readonly code: "record-fixed-family-envelope-invalid" }
> {
  const encoded = Schema.encodeUnknownEither(FixedRecordAttachmentEnvelopeSchema, RecordExactParseOptions)(envelope);
  return Either.isLeft(encoded)
    ? Either.left(Object.freeze({ code: "record-fixed-family-envelope-invalid" as const }))
    : Either.right(encoded.right);
}

type DescriptorPayload<Descriptor> =
  Descriptor extends FixedRecordFamilyDescriptor<
    NiceEvalFamily,
    FixedRecordAttachmentOwner,
    infer Payload
  >
    ? Payload
    : never;

export type FixedRecordFamilyPayload =
  | DescriptorPayload<typeof assertionsRecordFamily>
  | DescriptorPayload<typeof attemptObservabilityRecordFamily>
  | DescriptorPayload<typeof runObservabilityRecordFamily>
  | DescriptorPayload<typeof fileChangesRecordFamily>
  | DescriptorPayload<typeof sourceNavigationRecordFamily>
  | DescriptorPayload<typeof sourcesRecordFamily>
  | DescriptorPayload<typeof attemptArtifactsRecordFamily>
  | DescriptorPayload<typeof runArtifactsRecordFamily>;

export type FixedRecordFamilyWrite<
  Owner extends FixedRecordAttachmentOwner,
  Error = never,
  Requirements = never,
> = RecordAttachmentWrite<Owner, Error, Requirements>;
