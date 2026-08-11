import { Effect, Schema } from "effect";
import { canonicalJsonBytes, decodeCanonicalJsonBytes } from "./canonical.ts";
import {
  decodeProtocolSchema,
  descriptorForBytes,
  MediaTypeV1Schema,
  type DescriptorV1,
  type StrongEdgeV1,
  validateStrongEdgeSequence,
  verifyTypedObjectDescriptor,
} from "./core.ts";
import {
  ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE,
  ATTEMPT_MEDIA_TYPE,
  AttemptLocatorIndexPayloadV1Schema,
  attemptLocatorIndexStrongEdges,
  AttemptPayloadV1Schema,
  attemptStrongEdges,
  ENTITY_CATALOG_MEDIA_TYPE,
  EntityCatalogPayloadV1Schema,
  entityCatalogStrongEdges,
  RECORD_SUBJECT_MEDIA_TYPE,
  RecordSubjectV1Schema,
  recordSubjectStrongEdges,
  RUN_CONTRIBUTION_MEDIA_TYPE,
  RUN_MEDIA_TYPE,
  RunContributionV1Schema,
  runContributionStrongEdges,
  RunPayloadV1Schema,
  runStrongEdges,
  validateAttemptLocatorIndexPayloadV1,
  validateAttemptPayloadV1,
  validateEntityCatalogPayloadV1,
  validateRecordSubjectV1,
  validateRunContributionV1,
  validateRunPayloadV1,
} from "./entities.ts";
import {
  ARCHIVED_BYTES_CHUNK_MEDIA_TYPE,
  ARCHIVED_CHUNK_PAGE_MEDIA_TYPE,
  ARCHIVED_OBJECT_MEDIA_TYPE,
  ARCHIVED_OBJECT_TABLE_MEDIA_TYPE,
  ARCHIVED_OBJECT_TABLE_PAGE_MEDIA_TYPE,
  archivedBytesChunkStrongEdges,
  ArchivedBytesChunkV1Schema,
  archivedChunkPageStrongEdges,
  ArchivedChunkPageV1Schema,
  archivedObjectStrongEdges,
  ArchivedObjectV1Schema,
  archivedObjectTablePageStrongEdges,
  ArchivedObjectTablePageV1Schema,
  archivedObjectTableStrongEdges,
  ArchivedObjectTableV1Schema,
  CLAIM_MEDIA_TYPE,
  claimStrongEdges,
  ClaimPayloadV1Schema,
  decodeArchivedObjectDescriptorV1,
  RECORD_EVIDENCE_PROOF_INDEX_MEDIA_TYPE,
  RECORD_EVIDENCE_PROOF_INDEX_PAGE_MEDIA_TYPE,
  RECORD_EVIDENCE_PROOF_MEDIA_TYPE,
  recordEvidenceProofIndexPageStrongEdges,
  RecordEvidenceProofIndexPageV1Schema,
  recordEvidenceProofIndexStrongEdges,
  RecordEvidenceProofIndexV1Schema,
  recordEvidenceProofStrongEdges,
  RecordEvidenceProofV1Schema,
  validateArchivedBytesChunkV1,
  validateArchivedChunkPageV1,
  validateArchivedObjectTablePageV1,
  validateArchivedObjectTableV1,
  validateArchivedObjectV1,
  validateClaimPayloadV1,
  validateRecordEvidenceProofIndexPageV1,
  validateRecordEvidenceProofIndexV1,
  validateRecordEvidenceProofV1,
} from "./evidence.ts";
import {
  recordProtocolError,
  type RecordProtocolError,
} from "./errors.ts";
import {
  OBSERVATION_SEGMENT_MEDIA_TYPE,
  OBSERVATION_SEGMENT_PAGE_MEDIA_TYPE,
  OBSERVATION_STREAM_INDEX_MEDIA_TYPE,
  ObservationSegmentPageV1Schema,
  observationSegmentPageStrongEdges,
  ObservationSegmentV1Schema,
  observationSegmentStrongEdges,
  ObservationStreamIndexV1Schema,
  observationStreamIndexStrongEdges,
  validateObservationSegmentPageV1,
  validateObservationSegmentV1,
  validateObservationStreamIndexV1,
} from "./observation.ts";
import {
  TRANSFORMED_EVIDENCE_MEDIA_TYPE,
  transformedEvidenceStrongEdges,
  TransformedEvidenceV1Schema,
  validateTransformedEvidenceV1,
} from "./transformed-evidence.ts";

export interface DecodedPayloadV1 {
  readonly value: unknown;
  readonly strongEdges: readonly StrongEdgeV1[];
}

export interface EncodedPayloadV1 extends DecodedPayloadV1 {
  readonly descriptor: DescriptorV1;
  readonly bytes: Uint8Array;
}

export interface PayloadCodecV1 {
  readonly mediaType: string;
  decode(value: unknown): Effect.Effect<DecodedPayloadV1, RecordProtocolError>;
  encode(value: unknown): Effect.Effect<EncodedPayloadV1, RecordProtocolError>;
}

export interface PayloadCodecDefinitionV1<A, I> {
  readonly mediaType: string;
  readonly schema: Schema.Schema<A, I, never>;
  readonly validate: (payload: A) => Effect.Effect<void, RecordProtocolError>;
  readonly strongEdges: (payload: A) => readonly StrongEdgeV1[];
}

/** Define an additive payload codec without widening the frozen core union. */
export function definePayloadCodecV1<A, I>(
  definition: PayloadCodecDefinitionV1<A, I>,
): PayloadCodecV1 {
  const decode = (
    input: unknown,
  ): Effect.Effect<DecodedPayloadV1, RecordProtocolError> =>
    Effect.gen(function*() {
      const value = yield* decodeProtocolSchema(
        definition.schema,
        input,
        `decode-payload:${definition.mediaType}`,
      );
      yield* definition.validate(value);
      const strongEdges = definition.strongEdges(value);
      yield* validateStrongEdgeSequence(strongEdges, strongEdges);
      return Object.freeze({
        value,
        strongEdges: Object.freeze([...strongEdges]),
      });
    });

  const encode = (
    input: unknown,
  ): Effect.Effect<EncodedPayloadV1, RecordProtocolError> =>
    Effect.gen(function*() {
      const decoded = yield* decode(input);
      const encoded = yield* Schema.encodeUnknown(definition.schema, {
        errors: "all",
        onExcessProperty: "error",
      })(decoded.value).pipe(
        Effect.mapError((cause) =>
          recordProtocolError({
            code: "schema-invalid",
            operation: `encode-payload:${definition.mediaType}`,
            message: String(cause),
          })
        ),
      );
      const bytes = yield* canonicalJsonBytes(encoded);
      const descriptor = yield* descriptorForBytes(definition.mediaType, bytes);
      return Object.freeze({
        descriptor,
        bytes,
        value: decoded.value,
        strongEdges: decoded.strongEdges,
      });
    });

  return Object.freeze({
    mediaType: definition.mediaType,
    decode,
    encode,
  });
}

export const RECORD_PROTOCOL_V1_PAYLOAD_CODECS: readonly PayloadCodecV1[] =
  Object.freeze([
    definePayloadCodecV1({
      mediaType: RECORD_SUBJECT_MEDIA_TYPE,
      schema: RecordSubjectV1Schema,
      validate: validateRecordSubjectV1,
      strongEdges: recordSubjectStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: ENTITY_CATALOG_MEDIA_TYPE,
      schema: EntityCatalogPayloadV1Schema,
      validate: validateEntityCatalogPayloadV1,
      strongEdges: entityCatalogStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE,
      schema: AttemptLocatorIndexPayloadV1Schema,
      validate: validateAttemptLocatorIndexPayloadV1,
      strongEdges: attemptLocatorIndexStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: RUN_MEDIA_TYPE,
      schema: RunPayloadV1Schema,
      validate: validateRunPayloadV1,
      strongEdges: runStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: ATTEMPT_MEDIA_TYPE,
      schema: AttemptPayloadV1Schema,
      validate: validateAttemptPayloadV1,
      strongEdges: attemptStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: RUN_CONTRIBUTION_MEDIA_TYPE,
      schema: RunContributionV1Schema,
      validate: validateRunContributionV1,
      strongEdges: runContributionStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: OBSERVATION_STREAM_INDEX_MEDIA_TYPE,
      schema: ObservationStreamIndexV1Schema,
      validate: validateObservationStreamIndexV1,
      strongEdges: observationStreamIndexStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: OBSERVATION_SEGMENT_PAGE_MEDIA_TYPE,
      schema: ObservationSegmentPageV1Schema,
      validate: validateObservationSegmentPageV1,
      strongEdges: observationSegmentPageStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: OBSERVATION_SEGMENT_MEDIA_TYPE,
      schema: ObservationSegmentV1Schema,
      validate: validateObservationSegmentV1,
      strongEdges: observationSegmentStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: TRANSFORMED_EVIDENCE_MEDIA_TYPE,
      schema: TransformedEvidenceV1Schema,
      validate: validateTransformedEvidenceV1,
      strongEdges: transformedEvidenceStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: CLAIM_MEDIA_TYPE,
      schema: ClaimPayloadV1Schema,
      validate: validateClaimPayloadV1,
      strongEdges: claimStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: ARCHIVED_BYTES_CHUNK_MEDIA_TYPE,
      schema: ArchivedBytesChunkV1Schema,
      validate: validateArchivedBytesChunkV1,
      strongEdges: archivedBytesChunkStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: ARCHIVED_CHUNK_PAGE_MEDIA_TYPE,
      schema: ArchivedChunkPageV1Schema,
      validate: validateArchivedChunkPageV1,
      strongEdges: archivedChunkPageStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: ARCHIVED_OBJECT_MEDIA_TYPE,
      schema: ArchivedObjectV1Schema,
      validate: (payload) =>
        validateArchivedObjectV1(payload).pipe(
          Effect.andThen(decodeArchivedObjectDescriptorV1(payload)),
          Effect.asVoid,
        ),
      strongEdges: archivedObjectStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: ARCHIVED_OBJECT_TABLE_MEDIA_TYPE,
      schema: ArchivedObjectTableV1Schema,
      validate: validateArchivedObjectTableV1,
      strongEdges: archivedObjectTableStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: ARCHIVED_OBJECT_TABLE_PAGE_MEDIA_TYPE,
      schema: ArchivedObjectTablePageV1Schema,
      validate: validateArchivedObjectTablePageV1,
      strongEdges: archivedObjectTablePageStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: RECORD_EVIDENCE_PROOF_MEDIA_TYPE,
      schema: RecordEvidenceProofV1Schema,
      validate: validateRecordEvidenceProofV1,
      strongEdges: recordEvidenceProofStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: RECORD_EVIDENCE_PROOF_INDEX_MEDIA_TYPE,
      schema: RecordEvidenceProofIndexV1Schema,
      validate: validateRecordEvidenceProofIndexV1,
      strongEdges: recordEvidenceProofIndexStrongEdges,
    }),
    definePayloadCodecV1({
      mediaType: RECORD_EVIDENCE_PROOF_INDEX_PAGE_MEDIA_TYPE,
      schema: RecordEvidenceProofIndexPageV1Schema,
      validate: validateRecordEvidenceProofIndexPageV1,
      strongEdges: recordEvidenceProofIndexPageStrongEdges,
    }),
  ]);

export interface OpaqueTypedObjectV1 {
  readonly state: "opaque";
  readonly descriptor: DescriptorV1;
  /** Owned copy of the exact bytes; callers must preserve rather than re-encode it. */
  readonly bytes: Uint8Array;
}

export interface KnownTypedObjectV1 extends DecodedPayloadV1 {
  readonly state: "known";
  readonly descriptor: DescriptorV1;
  readonly bytes: Uint8Array;
  readonly codec: PayloadCodecV1;
}

export type DecodedTypedObjectV1 = OpaqueTypedObjectV1 | KnownTypedObjectV1;

export interface RecordProtocolCodecRegistryV1 {
  readonly mediaTypes: readonly string[];
  codecFor(mediaType: string): PayloadCodecV1 | undefined;
  decodeTypedObject(
    descriptor: unknown,
    bytes: unknown,
  ): Effect.Effect<DecodedTypedObjectV1, RecordProtocolError>;
}

export function createRecordProtocolCodecRegistryV1(
  extensions: readonly PayloadCodecV1[] = [],
): Effect.Effect<RecordProtocolCodecRegistryV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const codecs = [...RECORD_PROTOCOL_V1_PAYLOAD_CODECS, ...extensions];
    const byMediaType = new Map<string, PayloadCodecV1>();
    for (let index = 0; index < codecs.length; index += 1) {
      const codec = codecs[index];
      const mediaType = yield* decodeProtocolSchema(
        MediaTypeV1Schema,
        codec.mediaType,
        "register-payload-codec",
      );
      if (byMediaType.has(mediaType)) {
        return yield* Effect.fail(recordProtocolError({
          code: "payload-codec-duplicate",
          operation: "register-payload-codec",
          path: [String(index), "mediaType"],
          message: "Each payload media type may have exactly one codec",
          actual: mediaType,
        }));
      }
      byMediaType.set(mediaType, codec);
    }

    const decodeTypedObject = (
      descriptorInput: unknown,
      bytesInput: unknown,
    ): Effect.Effect<DecodedTypedObjectV1, RecordProtocolError> =>
      Effect.gen(function*() {
        const descriptor = yield* verifyTypedObjectDescriptor(
          descriptorInput,
          bytesInput,
        );
        if (!(bytesInput instanceof Uint8Array)) {
          return yield* Effect.fail(recordProtocolError({
            code: "descriptor-invalid",
            operation: "decode-payload-object",
            message: "Typed object bytes must be a Uint8Array",
          }));
        }
        const bytes = Uint8Array.from(bytesInput);
        const codec = byMediaType.get(descriptor.mediaType);
        if (codec === undefined) {
          return Object.freeze({
            state: "opaque",
            descriptor,
            bytes,
          });
        }
        const json = yield* decodeCanonicalJsonBytes(bytes);
        const decoded = yield* codec.decode(json);
        return Object.freeze({
          state: "known",
          descriptor,
          bytes,
          codec,
          value: decoded.value,
          strongEdges: decoded.strongEdges,
        });
      });

    const mediaTypes = Object.freeze([...byMediaType.keys()].sort());
    return Object.freeze({
      mediaTypes,
      codecFor: (mediaType: string) => byMediaType.get(mediaType),
      decodeTypedObject,
    });
  });
}
