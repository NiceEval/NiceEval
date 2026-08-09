import { Buffer } from "node:buffer";
import { Effect, Schema } from "effect";
import {
  canonicalJsonBytes,
  compareCanonicalBytes,
  decodeCanonicalJsonBytes,
} from "./canonical.ts";
import {
  decodeDescriptorV1,
  decodeProtocolSchema,
  DescriptorV1Schema,
  type DescriptorV1,
  DigestV1Schema,
  type DigestV1,
  EdgePageRefV1Schema,
  GraphRootRefV1Schema,
  type GraphNodeV1,
  JsonSafeUnsignedIntegerSchema,
  NodeRefV1Schema,
  type NodeRefV1,
  NonEmptyProtocolStringSchema,
  RecordGraphRefV1Schema,
  sha256DigestOfBytes,
  type StrongEdgeV1,
  typedReferenceEquals,
} from "./core.ts";
import {
  AttemptIdSchema,
  AttemptLocatorNonMembershipProofV1Schema,
  AttemptLocatorSelectorV1Schema,
  EntityCatalogSelectorV1Schema,
  EntityNonMembershipProofV1Schema,
} from "./entities.ts";
import {
  recordProtocolError,
  type RecordProtocolError,
} from "./errors.ts";
import { JsonValueSchema, type JsonValue } from "./json.ts";
import {
  VersionedSelectorSchema,
} from "./observation.ts";

export const CLAIM_MEDIA_TYPE: "application/vnd.niceeval.claim.v1+jcs" =
  "application/vnd.niceeval.claim.v1+jcs";
export const ARCHIVED_BYTES_CHUNK_MEDIA_TYPE: "application/vnd.niceeval.archived-bytes-chunk+json;v=1" =
  "application/vnd.niceeval.archived-bytes-chunk+json;v=1";
export const ARCHIVED_CHUNK_PAGE_MEDIA_TYPE: "application/vnd.niceeval.archived-chunk-page+json;v=1" =
  "application/vnd.niceeval.archived-chunk-page+json;v=1";
export const ARCHIVED_OBJECT_MEDIA_TYPE: "application/vnd.niceeval.archived-object+json;v=1" =
  "application/vnd.niceeval.archived-object+json;v=1";
export const ARCHIVED_OBJECT_TABLE_MEDIA_TYPE: "application/vnd.niceeval.archived-object-table+json;v=1" =
  "application/vnd.niceeval.archived-object-table+json;v=1";
export const ARCHIVED_OBJECT_TABLE_PAGE_MEDIA_TYPE: "application/vnd.niceeval.archived-object-table-page+json;v=1" =
  "application/vnd.niceeval.archived-object-table-page+json;v=1";
export const RECORD_EVIDENCE_PROOF_MEDIA_TYPE: "application/vnd.niceeval.record-evidence-proof+json;v=1" =
  "application/vnd.niceeval.record-evidence-proof+json;v=1";
export const RECORD_EVIDENCE_PROOF_INDEX_MEDIA_TYPE: "application/vnd.niceeval.record-evidence-proof-index+json;v=1" =
  "application/vnd.niceeval.record-evidence-proof-index+json;v=1";
export const RECORD_EVIDENCE_PROOF_INDEX_PAGE_MEDIA_TYPE: "application/vnd.niceeval.record-evidence-proof-index-page+json;v=1" =
  "application/vnd.niceeval.record-evidence-proof-index-page+json;v=1";

export const ARCHIVE_CHUNK_BYTES: 1048576 = 1_048_576;
export const ARCHIVE_PAGE_ENTRIES: 128 = 128;

export const RecordEvidencePathStepV1Schema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("graph-subject"),
    from: GraphRootRefV1Schema,
    relation: Schema.Literal("niceeval.graph-subject"),
    to: NodeRefV1Schema,
  }),
  Schema.Struct({
    kind: Schema.Literal("node-dependencies"),
    from: NodeRefV1Schema,
    relation: Schema.Literal("niceeval.node-dependencies"),
    to: EdgePageRefV1Schema,
  }),
  Schema.Struct({
    kind: Schema.Literal("edge-page"),
    from: EdgePageRefV1Schema,
    pageOrdinal: JsonSafeUnsignedIntegerSchema,
    relation: Schema.Literal("niceeval.edge-page-child"),
    to: EdgePageRefV1Schema,
  }),
  Schema.Struct({
    kind: Schema.Literal("strong-edge"),
    from: EdgePageRefV1Schema,
    edgeOrdinal: JsonSafeUnsignedIntegerSchema,
    relation: NonEmptyProtocolStringSchema,
    to: NodeRefV1Schema,
  }),
);

export type RecordEvidencePathStepV1 = Schema.Schema.Type<
  typeof RecordEvidencePathStepV1Schema
>;

export const StreamTailAbsenceSelectorV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.stream-tail-absence-selector/1"),
  value: Schema.Struct({
    streamId: NonEmptyProtocolStringSchema,
    afterSequence: Schema.NullOr(JsonSafeUnsignedIntegerSchema),
  }),
});

export type StreamTailAbsenceSelectorV1 = Schema.Schema.Type<
  typeof StreamTailAbsenceSelectorV1Schema
>;

export const AuthenticatedStreamTailProofV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.authenticated-stream-tail-proof/1"),
  source: RecordGraphRefV1Schema,
  selector: StreamTailAbsenceSelectorV1Schema,
  streamId: NonEmptyProtocolStringSchema,
  index: NodeRefV1Schema,
  closed: Schema.Literal(true),
  pinnedThroughSequence: Schema.NullOr(JsonSafeUnsignedIntegerSchema),
  firstSegmentPage: Schema.NullOr(NodeRefV1Schema),
  path: Schema.Array(RecordEvidencePathStepV1Schema),
});

export type AuthenticatedStreamTailProofV1 = Schema.Schema.Type<
  typeof AuthenticatedStreamTailProofV1Schema
>;

export const AuthenticatedAbsenceIndexV1Schema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("entity-catalog"),
    catalog: NodeRefV1Schema,
    selector: EntityCatalogSelectorV1Schema,
    nonmembership: EntityNonMembershipProofV1Schema,
  }),
  Schema.Struct({
    kind: Schema.Literal("attempt-locator"),
    index: NodeRefV1Schema,
    selector: AttemptLocatorSelectorV1Schema,
    nonmembership: AttemptLocatorNonMembershipProofV1Schema,
  }),
  Schema.Struct({
    kind: Schema.Literal("stream-tail"),
    index: NodeRefV1Schema,
    selector: StreamTailAbsenceSelectorV1Schema,
    closed: Schema.Literal(true),
    pinnedThroughSequence: Schema.NullOr(JsonSafeUnsignedIntegerSchema),
    completePrefix: AuthenticatedStreamTailProofV1Schema,
  }),
);

export type AuthenticatedAbsenceIndexV1 = Schema.Schema.Type<
  typeof AuthenticatedAbsenceIndexV1Schema
>;

export const EventEvidenceTargetSchema = Schema.Struct({
  kind: Schema.Literal("event"),
  stream: Schema.Struct({
    streamId: NonEmptyProtocolStringSchema,
    index: NodeRefV1Schema,
  }),
  sequence: JsonSafeUnsignedIntegerSchema,
  eventId: NonEmptyProtocolStringSchema,
});

export type EventEvidenceTarget = Schema.Schema.Type<
  typeof EventEvidenceTargetSchema
>;

export const ObjectEvidenceTargetSchema = Schema.Struct({
  kind: Schema.Literal("object"),
  node: NodeRefV1Schema,
  selector: Schema.optionalWith(VersionedSelectorSchema, { exact: true }),
});

export type ObjectEvidenceTarget = Schema.Schema.Type<
  typeof ObjectEvidenceTargetSchema
>;

export const ClaimEvidenceTargetSchema = Schema.Struct({
  kind: Schema.Literal("claim"),
  node: NodeRefV1Schema,
  claimId: NonEmptyProtocolStringSchema,
});

export type ClaimEvidenceTarget = Schema.Schema.Type<
  typeof ClaimEvidenceTargetSchema
>;

export const AbsenceEvidenceTargetSchema = Schema.Struct({
  kind: Schema.Literal("absence"),
  selector: VersionedSelectorSchema,
  index: AuthenticatedAbsenceIndexV1Schema,
});

export type AbsenceEvidenceTarget = Schema.Schema.Type<
  typeof AbsenceEvidenceTargetSchema
>;

export const EvidenceTargetSchema = Schema.Union(
  EventEvidenceTargetSchema,
  ObjectEvidenceTargetSchema,
  ClaimEvidenceTargetSchema,
  AbsenceEvidenceTargetSchema,
);

export type EvidenceTarget = Schema.Schema.Type<typeof EvidenceTargetSchema>;

export const EvidenceRefSchema = Schema.Struct({
  source: RecordGraphRefV1Schema,
  target: EvidenceTargetSchema,
});

export type EvidenceRef = Schema.Schema.Type<typeof EvidenceRefSchema>;

export const ClaimSchema = Schema.Struct({
  id: NonEmptyProtocolStringSchema,
  kind: NonEmptyProtocolStringSchema,
  schema: NonEmptyProtocolStringSchema,
  value: JsonValueSchema,
  evaluator: Schema.Struct({
    namespace: NonEmptyProtocolStringSchema,
    name: NonEmptyProtocolStringSchema,
    version: NonEmptyProtocolStringSchema,
    model: Schema.optionalWith(NonEmptyProtocolStringSchema, { exact: true }),
  }),
  basedOn: Schema.Array(EvidenceTargetSchema),
  producedAt: NonEmptyProtocolStringSchema,
});

export type ClaimV1 = Schema.Schema.Type<typeof ClaimSchema>;
export type Claim<T extends JsonValue = JsonValue> = Omit<ClaimV1, "value"> & {
  readonly value: T;
};

export const ClaimPayloadV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.claim/1"),
  scope: Schema.Union(
    Schema.Struct({
      kind: Schema.Literal("run"),
      runId: NonEmptyProtocolStringSchema,
    }),
    Schema.Struct({
      kind: Schema.Literal("attempt"),
      attemptId: AttemptIdSchema,
    }),
  ),
  claim: ClaimSchema,
});

export type ClaimPayloadV1 = Schema.Schema.Type<typeof ClaimPayloadV1Schema>;

function evidenceTargetNode(target: EvidenceTarget): NodeRefV1 {
  switch (target.kind) {
    case "event":
      return target.stream.index;
    case "object":
    case "claim":
      return target.node;
    case "absence":
      return target.index.kind === "entity-catalog"
        ? target.index.catalog
        : target.index.index;
  }
}

function evidenceTargetRelation(target: EvidenceTarget): string {
  switch (target.kind) {
    case "event":
      return "niceeval.claim-basis-event-index";
    case "object":
      return "niceeval.claim-basis-object";
    case "claim":
      return "niceeval.claim-basis-claim";
    case "absence":
      return "niceeval.claim-basis-absence-index";
  }
}

export function claimStrongEdges(
  payload: ClaimPayloadV1,
): readonly StrongEdgeV1[] {
  return Object.freeze(payload.claim.basedOn.map((target) => Object.freeze({
    relation: evidenceTargetRelation(target),
    target: evidenceTargetNode(target),
  })));
}

function invariantError(
  operation: string,
  path: readonly string[],
  message: string,
): RecordProtocolError {
  return recordProtocolError({
    code: "payload-invariant-invalid",
    operation,
    path,
    message,
  });
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function validateClaimPayloadV1(
  payload: ClaimPayloadV1,
): Effect.Effect<void, RecordProtocolError> {
  return Effect.gen(function*() {
    const entries = yield* Effect.forEach(payload.claim.basedOn, (target) =>
      canonicalJsonBytes(target).pipe(
        Effect.map((bytes) => Object.freeze({ target, bytes })),
      )
    );
    for (let index = 1; index < entries.length; index += 1) {
      const order = compareCanonicalBytes(entries[index - 1].bytes, entries[index].bytes);
      if (order >= 0) {
        return yield* Effect.fail(invariantError(
          "validate-claim-payload",
          ["claim", "basedOn", String(index)],
          order === 0
            ? "Claim basedOn must not contain duplicate EvidenceTarget values"
            : "Claim basedOn must be sorted by complete EvidenceTarget JCS bytes",
        ));
      }
    }
  });
}

export const ArchivedBytesChunkNodeRefV1Schema = NodeRefV1Schema.pipe(
  Schema.brand("niceeval.ArchivedBytesChunkNodeRefV1"),
);
export type ArchivedBytesChunkNodeRefV1 = Schema.Schema.Type<
  typeof ArchivedBytesChunkNodeRefV1Schema
>;

export const ArchivedChunkPageNodeRefV1Schema = NodeRefV1Schema.pipe(
  Schema.brand("niceeval.ArchivedChunkPageNodeRefV1"),
);
export type ArchivedChunkPageNodeRefV1 = Schema.Schema.Type<
  typeof ArchivedChunkPageNodeRefV1Schema
>;

export const ArchivedObjectNodeRefV1Schema = NodeRefV1Schema.pipe(
  Schema.brand("niceeval.ArchivedObjectNodeRefV1"),
);
export type ArchivedObjectNodeRefV1 = Schema.Schema.Type<
  typeof ArchivedObjectNodeRefV1Schema
>;

export const ArchivedObjectTableNodeRefV1Schema = NodeRefV1Schema.pipe(
  Schema.brand("niceeval.ArchivedObjectTableNodeRefV1"),
);
export type ArchivedObjectTableNodeRefV1 = Schema.Schema.Type<
  typeof ArchivedObjectTableNodeRefV1Schema
>;

export const ArchivedObjectTablePageNodeRefV1Schema = NodeRefV1Schema.pipe(
  Schema.brand("niceeval.ArchivedObjectTablePageNodeRefV1"),
);
export type ArchivedObjectTablePageNodeRefV1 = Schema.Schema.Type<
  typeof ArchivedObjectTablePageNodeRefV1Schema
>;

export const RecordEvidenceProofNodeRefV1Schema = NodeRefV1Schema.pipe(
  Schema.brand("niceeval.RecordEvidenceProofNodeRefV1"),
);
export type RecordEvidenceProofNodeRefV1 = Schema.Schema.Type<
  typeof RecordEvidenceProofNodeRefV1Schema
>;

export const RecordEvidenceProofIndexRefV1Schema = NodeRefV1Schema.pipe(
  Schema.brand("niceeval.RecordEvidenceProofIndexRefV1"),
);
export type RecordEvidenceProofIndexRefV1 = Schema.Schema.Type<
  typeof RecordEvidenceProofIndexRefV1Schema
>;

export const RecordEvidenceProofIndexPageNodeRefV1Schema = NodeRefV1Schema.pipe(
  Schema.brand("niceeval.RecordEvidenceProofIndexPageNodeRefV1"),
);
export type RecordEvidenceProofIndexPageNodeRefV1 = Schema.Schema.Type<
  typeof RecordEvidenceProofIndexPageNodeRefV1Schema
>;

export const ArchiveNodeKindV1Schema = Schema.Literal(
  "archived-bytes-chunk",
  "archived-chunk-page",
  "archived-object",
  "archived-object-table",
  "archived-object-table-page",
  "record-evidence-proof",
  "record-evidence-proof-index",
  "record-evidence-proof-index-page",
);

export type ArchiveNodeKindV1 = Schema.Schema.Type<
  typeof ArchiveNodeKindV1Schema
>;

export function archiveNodePayloadMediaTypeV1(
  kind: ArchiveNodeKindV1,
): string {
  switch (kind) {
    case "archived-bytes-chunk":
      return ARCHIVED_BYTES_CHUNK_MEDIA_TYPE;
    case "archived-chunk-page":
      return ARCHIVED_CHUNK_PAGE_MEDIA_TYPE;
    case "archived-object":
      return ARCHIVED_OBJECT_MEDIA_TYPE;
    case "archived-object-table":
      return ARCHIVED_OBJECT_TABLE_MEDIA_TYPE;
    case "archived-object-table-page":
      return ARCHIVED_OBJECT_TABLE_PAGE_MEDIA_TYPE;
    case "record-evidence-proof":
      return RECORD_EVIDENCE_PROOF_MEDIA_TYPE;
    case "record-evidence-proof-index":
      return RECORD_EVIDENCE_PROOF_INDEX_MEDIA_TYPE;
    case "record-evidence-proof-index-page":
      return RECORD_EVIDENCE_PROOF_INDEX_PAGE_MEDIA_TYPE;
  }
}

/** Brands are compile-time only; proof readers must run this after opening the GraphNode. */
export function validateArchiveNodePayloadMediaTypeV1(
  kind: ArchiveNodeKindV1,
  node: GraphNodeV1,
): Effect.Effect<void, RecordProtocolError> {
  const expected = archiveNodePayloadMediaTypeV1(kind);
  return node.payload.mediaType === expected
    ? Effect.void
    : Effect.fail(recordProtocolError({
      code: "archive-invalid",
      operation: "validate-archive-node-media-type",
      path: ["payload", "mediaType"],
      message: "Archive NodeRef resolved to a GraphNode with the wrong payload media type",
      expected,
      actual: node.payload.mediaType,
    }));
}

export const ArchiveIdPreimageV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.archive-id/1"),
  descriptor: DescriptorV1Schema,
});

export type ArchiveIdPreimageV1 = Schema.Schema.Type<
  typeof ArchiveIdPreimageV1Schema
>;
export const ArchiveIdV1Schema = DigestV1Schema;
export type ArchiveIdV1 = DigestV1;

const CanonicalBase64Schema = Schema.String.pipe(
  Schema.filter((value) => {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
      return false;
    }
    return Buffer.from(value, "base64").toString("base64") === value;
  }, {
    identifier: "CanonicalBase64",
    description: "RFC 4648 standard base64 with required padding and no whitespace",
  }),
);

export const ArchivedBytesChunkV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.archived-bytes-chunk/1"),
  archiveId: ArchiveIdV1Schema,
  ordinal: JsonSafeUnsignedIntegerSchema,
  decodedBytes: JsonSafeUnsignedIntegerSchema,
  dataBase64: CanonicalBase64Schema,
});

export type ArchivedBytesChunkV1 = Schema.Schema.Type<
  typeof ArchivedBytesChunkV1Schema
>;

export const ArchivedChunkPageV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.archived-chunk-page/1"),
  archiveId: ArchiveIdV1Schema,
  firstOrdinal: JsonSafeUnsignedIntegerSchema,
  chunks: Schema.NonEmptyArray(ArchivedBytesChunkNodeRefV1Schema),
  next: Schema.NullOr(ArchivedChunkPageNodeRefV1Schema),
});

export type ArchivedChunkPageV1 = Schema.Schema.Type<
  typeof ArchivedChunkPageV1Schema
>;

export const ArchivedObjectV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.archived-object/1"),
  archiveId: ArchiveIdV1Schema,
  descriptorJcsBase64: CanonicalBase64Schema,
  decodedBytes: JsonSafeUnsignedIntegerSchema,
  chunkCount: JsonSafeUnsignedIntegerSchema,
  firstChunkPage: Schema.NullOr(ArchivedChunkPageNodeRefV1Schema),
});

export type ArchivedObjectV1 = Schema.Schema.Type<
  typeof ArchivedObjectV1Schema
>;

export const ArchivedObjectTableEntryV1Schema = Schema.Struct({
  archiveId: ArchiveIdV1Schema,
  descriptor: DescriptorV1Schema,
  object: ArchivedObjectNodeRefV1Schema,
});

export type ArchivedObjectTableEntryV1 = Schema.Schema.Type<
  typeof ArchivedObjectTableEntryV1Schema
>;

export const ArchivedObjectTableV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.archived-object-table/1"),
  entryCount: JsonSafeUnsignedIntegerSchema,
  firstPage: Schema.NullOr(ArchivedObjectTablePageNodeRefV1Schema),
});

export type ArchivedObjectTableV1 = Schema.Schema.Type<
  typeof ArchivedObjectTableV1Schema
>;

export const ArchivedObjectTablePageV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.archived-object-table-page/1"),
  entries: Schema.NonEmptyArray(ArchivedObjectTableEntryV1Schema),
  next: Schema.NullOr(ArchivedObjectTablePageNodeRefV1Schema),
});

export type ArchivedObjectTablePageV1 = Schema.Schema.Type<
  typeof ArchivedObjectTablePageV1Schema
>;

export const RecordEvidenceArchiveRefV1Schema = Schema.Struct({
  archiveId: ArchiveIdV1Schema,
  descriptor: DescriptorV1Schema,
});

export type RecordEvidenceArchiveRefV1 = Schema.Schema.Type<
  typeof RecordEvidenceArchiveRefV1Schema
>;

const RecordEvidenceProofBaseFields = {
  schema: Schema.Literal("niceeval.record-evidence-proof/1"),
  source: RecordGraphRefV1Schema,
  graphRoot: GraphRootRefV1Schema,
  subject: NodeRefV1Schema,
  catalog: NodeRefV1Schema,
  objectTable: ArchivedObjectTableNodeRefV1Schema,
  target: EvidenceTargetSchema,
  path: Schema.Array(RecordEvidencePathStepV1Schema),
  archives: Schema.Array(RecordEvidenceArchiveRefV1Schema),
};

export const EventEvidenceProofV1Schema = Schema.Struct({
  ...RecordEvidenceProofBaseFields,
  kind: Schema.Literal("event"),
  target: EventEvidenceTargetSchema,
  streamIndex: NodeRefV1Schema,
  segment: NodeRefV1Schema,
  event: Schema.Struct({
    streamId: NonEmptyProtocolStringSchema,
    sequence: JsonSafeUnsignedIntegerSchema,
    eventId: NonEmptyProtocolStringSchema,
    segmentEventOrdinal: JsonSafeUnsignedIntegerSchema,
  }),
  leafCount: JsonSafeUnsignedIntegerSchema,
  merklePath: Schema.Array(DigestV1Schema),
});

export type EventEvidenceProofV1 = Schema.Schema.Type<
  typeof EventEvidenceProofV1Schema
>;

export const ObjectEvidenceProofV1Schema = Schema.Struct({
  ...RecordEvidenceProofBaseFields,
  kind: Schema.Literal("object"),
  target: ObjectEvidenceTargetSchema,
  object: RecordEvidenceArchiveRefV1Schema,
});

export type ObjectEvidenceProofV1 = Schema.Schema.Type<
  typeof ObjectEvidenceProofV1Schema
>;

export const ClaimEvidenceProofV1Schema = Schema.Struct({
  ...RecordEvidenceProofBaseFields,
  kind: Schema.Literal("claim"),
  target: ClaimEvidenceTargetSchema,
  claim: RecordEvidenceArchiveRefV1Schema,
  basedOn: Schema.Array(EvidenceRefSchema),
});

export type ClaimEvidenceProofV1 = Schema.Schema.Type<
  typeof ClaimEvidenceProofV1Schema
>;

export const AbsenceEvidenceProofV1Schema = Schema.Struct({
  ...RecordEvidenceProofBaseFields,
  kind: Schema.Literal("absence"),
  target: AbsenceEvidenceTargetSchema,
  absence: AuthenticatedAbsenceIndexV1Schema,
});

export type AbsenceEvidenceProofV1 = Schema.Schema.Type<
  typeof AbsenceEvidenceProofV1Schema
>;

export const RecordEvidenceProofV1Schema = Schema.Union(
  EventEvidenceProofV1Schema,
  ObjectEvidenceProofV1Schema,
  ClaimEvidenceProofV1Schema,
  AbsenceEvidenceProofV1Schema,
);

export type RecordEvidenceProofV1 = Schema.Schema.Type<
  typeof RecordEvidenceProofV1Schema
>;

export const RecordEvidenceProofIndexV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.record-evidence-proof-index/1"),
  objectTable: ArchivedObjectTableNodeRefV1Schema,
  proofCount: JsonSafeUnsignedIntegerSchema,
  firstPage: Schema.NullOr(RecordEvidenceProofIndexPageNodeRefV1Schema),
});

export type RecordEvidenceProofIndexV1 = Schema.Schema.Type<
  typeof RecordEvidenceProofIndexV1Schema
>;

export const RecordEvidenceProofKeyV1Schema = DigestV1Schema;
export type RecordEvidenceProofKeyV1 = DigestV1;

export const RecordEvidenceProofIndexEntryV1Schema = Schema.Struct({
  key: RecordEvidenceProofKeyV1Schema,
  evidence: EvidenceRefSchema,
  proof: RecordEvidenceProofNodeRefV1Schema,
});

export type RecordEvidenceProofIndexEntryV1 = Schema.Schema.Type<
  typeof RecordEvidenceProofIndexEntryV1Schema
>;

export const RecordEvidenceProofIndexPageV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.record-evidence-proof-index-page/1"),
  entries: Schema.NonEmptyArray(RecordEvidenceProofIndexEntryV1Schema),
  next: Schema.NullOr(RecordEvidenceProofIndexPageNodeRefV1Schema),
});

export type RecordEvidenceProofIndexPageV1 = Schema.Schema.Type<
  typeof RecordEvidenceProofIndexPageV1Schema
>;

function edge(relation: string, target: NodeRefV1): StrongEdgeV1 {
  return Object.freeze({ relation, target });
}

export function archivedBytesChunkStrongEdges(
  _payload: ArchivedBytesChunkV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([]);
}

export function archivedChunkPageStrongEdges(
  payload: ArchivedChunkPageV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    ...payload.chunks.map((target) => edge("niceeval.archive-chunk", target)),
    ...(payload.next === null
      ? []
      : [edge("niceeval.archive-chunk-page-next", payload.next)]),
  ]);
}

export function archivedObjectStrongEdges(
  payload: ArchivedObjectV1,
): readonly StrongEdgeV1[] {
  return payload.firstChunkPage === null
    ? Object.freeze([])
    : Object.freeze([
      edge("niceeval.archive-chunk-page-first", payload.firstChunkPage),
    ]);
}

export function archivedObjectTableStrongEdges(
  payload: ArchivedObjectTableV1,
): readonly StrongEdgeV1[] {
  return payload.firstPage === null
    ? Object.freeze([])
    : Object.freeze([
      edge("niceeval.archive-object-table-page-first", payload.firstPage),
    ]);
}

export function archivedObjectTablePageStrongEdges(
  payload: ArchivedObjectTablePageV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    ...payload.entries.map((entry) => edge("niceeval.archive-object", entry.object)),
    ...(payload.next === null
      ? []
      : [edge("niceeval.archive-object-table-page-next", payload.next)]),
  ]);
}

export function recordEvidenceProofStrongEdges(
  payload: RecordEvidenceProofV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    edge("niceeval.evidence-object-table", payload.objectTable),
  ]);
}

export function recordEvidenceProofIndexStrongEdges(
  payload: RecordEvidenceProofIndexV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    edge("niceeval.evidence-object-table", payload.objectTable),
    ...(payload.firstPage === null
      ? []
      : [edge("niceeval.evidence-proof-index-page-first", payload.firstPage)]),
  ]);
}

export function recordEvidenceProofIndexPageStrongEdges(
  payload: RecordEvidenceProofIndexPageV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    ...payload.entries.map((entry) => edge("niceeval.evidence-proof", entry.proof)),
    ...(payload.next === null
      ? []
      : [edge("niceeval.evidence-proof-index-page-next", payload.next)]),
  ]);
}

export function archiveIdForDescriptor(
  descriptorInput: unknown,
): Effect.Effect<ArchiveIdV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const descriptor = yield* decodeDescriptorV1(descriptorInput, "compute-archive-id");
    const bytes = yield* canonicalJsonBytes({
      schema: "niceeval.archive-id/1",
      descriptor,
    });
    return yield* sha256DigestOfBytes(bytes);
  });
}

export function recordEvidenceProofKeyV1(
  evidenceInput: unknown,
): Effect.Effect<RecordEvidenceProofKeyV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const evidence = yield* decodeProtocolSchema(
      EvidenceRefSchema,
      evidenceInput,
      "compute-evidence-proof-key",
    );
    return yield* sha256DigestOfBytes(yield* canonicalJsonBytes(evidence));
  });
}

export function decodeArchivedObjectDescriptorV1(
  payloadInput: unknown,
): Effect.Effect<DescriptorV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const payload = yield* decodeProtocolSchema(
      ArchivedObjectV1Schema,
      payloadInput,
      "decode-archived-object-descriptor",
    );
    const bytes = Buffer.from(payload.descriptorJcsBase64, "base64");
    const descriptor = yield* decodeDescriptorV1(
      yield* decodeCanonicalJsonBytes(bytes),
      "decode-archived-object-descriptor",
    );
    const expectedArchiveId = yield* archiveIdForDescriptor(descriptor);
    if (expectedArchiveId !== payload.archiveId) {
      return yield* Effect.fail(recordProtocolError({
        code: "archive-invalid",
        operation: "decode-archived-object-descriptor",
        path: ["archiveId"],
        message: "Archived object ID does not match its descriptor preimage",
        expected: expectedArchiveId,
        actual: payload.archiveId,
      }));
    }
    if (payload.decodedBytes !== descriptor.size) {
      return yield* Effect.fail(recordProtocolError({
        code: "archive-invalid",
        operation: "decode-archived-object-descriptor",
        path: ["decodedBytes"],
        message: "Archived object decodedBytes must equal descriptor size",
        expected: String(descriptor.size),
        actual: String(payload.decodedBytes),
      }));
    }
    return descriptor;
  });
}

export function validateArchivedBytesChunkV1(
  payload: ArchivedBytesChunkV1,
): Effect.Effect<void, RecordProtocolError> {
  const decodedLength = Buffer.from(payload.dataBase64, "base64").byteLength;
  if (
    decodedLength === 0
    || decodedLength !== payload.decodedBytes
    || decodedLength > ARCHIVE_CHUNK_BYTES
  ) {
    return Effect.fail(recordProtocolError({
      code: "archive-invalid",
      operation: "validate-archived-bytes-chunk",
      path: ["decodedBytes"],
      message: "Chunk decoded length must match decodedBytes and fit the 1 MiB chunk limit",
      expected: String(payload.decodedBytes),
      actual: String(decodedLength),
    }));
  }
  return Effect.void;
}

export function validateArchivedChunkPageV1(
  payload: ArchivedChunkPageV1,
): Effect.Effect<void, RecordProtocolError> {
  if (payload.chunks.length > ARCHIVE_PAGE_ENTRIES) {
    return Effect.fail(invariantError(
      "validate-archived-chunk-page",
      ["chunks"],
      `Archive pages contain at most ${ARCHIVE_PAGE_ENTRIES} entries`,
    ));
  }
  if (payload.next !== null && payload.chunks.length !== ARCHIVE_PAGE_ENTRIES) {
    return Effect.fail(invariantError(
      "validate-archived-chunk-page",
      ["chunks"],
      "Every non-final archive chunk page must contain exactly 128 chunks",
    ));
  }
  return Effect.void;
}

export function validateArchivedObjectV1(
  payload: ArchivedObjectV1,
): Effect.Effect<void, RecordProtocolError> {
  if (
    (payload.decodedBytes === 0)
      !== (payload.chunkCount === 0 && payload.firstChunkPage === null)
    || (payload.chunkCount === 0) !== (payload.firstChunkPage === null)
  ) {
    return Effect.fail(invariantError(
      "validate-archived-object",
      ["chunkCount"],
      "Empty archived objects have zero chunks and no first page; non-empty objects have both",
    ));
  }
  const expectedChunkCount = Math.ceil(payload.decodedBytes / ARCHIVE_CHUNK_BYTES);
  if (payload.chunkCount !== expectedChunkCount) {
    return Effect.fail(invariantError(
      "validate-archived-object",
      ["chunkCount"],
      "Archived object chunkCount must equal the canonical 1 MiB partition count",
    ));
  }
  return Effect.void;
}

export function validateArchivedObjectTableV1(
  payload: ArchivedObjectTableV1,
): Effect.Effect<void, RecordProtocolError> {
  if ((payload.entryCount === 0) !== (payload.firstPage === null)) {
    return Effect.fail(invariantError(
      "validate-archived-object-table",
      ["entryCount"],
      "Only an empty archive table may omit firstPage",
    ));
  }
  return Effect.void;
}

export function validateArchivedObjectTablePageV1(
  payload: ArchivedObjectTablePageV1,
): Effect.Effect<void, RecordProtocolError> {
  return Effect.gen(function*() {
    if (payload.entries.length > ARCHIVE_PAGE_ENTRIES) {
      return yield* Effect.fail(invariantError(
        "validate-archived-object-table-page",
        ["entries"],
        `Archive table pages contain at most ${ARCHIVE_PAGE_ENTRIES} entries`,
      ));
    }
    if (payload.next !== null && payload.entries.length !== ARCHIVE_PAGE_ENTRIES) {
      return yield* Effect.fail(invariantError(
        "validate-archived-object-table-page",
        ["entries"],
        "Every non-final archive table page must contain exactly 128 entries",
      ));
    }
    const entries = yield* Effect.forEach(payload.entries, (entry) =>
      Effect.gen(function*() {
        const expectedArchiveId = yield* archiveIdForDescriptor(entry.descriptor);
        if (expectedArchiveId !== entry.archiveId) {
          return yield* Effect.fail(invariantError(
            "validate-archived-object-table-page",
            ["entries", entry.archiveId, "archiveId"],
            "Archive table entry ID must be SHA-256 of its descriptor preimage",
          ));
        }
        const descriptorBytes = yield* canonicalJsonBytes(entry.descriptor);
        return Object.freeze({ entry, descriptorBytes });
      })
    );
    for (let index = 1; index < entries.length; index += 1) {
      const left = entries[index - 1];
      const right = entries[index];
      const archiveOrder = compareAscii(left.entry.archiveId, right.entry.archiveId);
      if (archiveOrder === 0) {
        const descriptorOrder = compareCanonicalBytes(
          left.descriptorBytes,
          right.descriptorBytes,
        );
        return yield* Effect.fail(invariantError(
          "validate-archived-object-table-page",
          ["entries", String(index)],
          descriptorOrder === 0
            ? "Archive table entries must not duplicate archiveId/descriptor pairs"
            : "One archiveId must not identify different descriptors",
        ));
      }
      if (archiveOrder > 0) {
        return yield* Effect.fail(invariantError(
          "validate-archived-object-table-page",
          ["entries", String(index)],
          "Archive table entries must be sorted by archiveId then descriptor JCS bytes",
        ));
      }
    }
  });
}

function pathStepToDescriptor(
  step: RecordEvidencePathStepV1,
): DescriptorV1 {
  return step.to;
}

function pathStepFromDescriptor(
  step: RecordEvidencePathStepV1,
): DescriptorV1 {
  return step.from;
}

export function validateRecordEvidenceProofV1(
  payload: RecordEvidenceProofV1,
): Effect.Effect<void, RecordProtocolError> {
  return Effect.gen(function*() {
    if (!typedReferenceEquals(payload.source.graph, payload.graphRoot)) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof",
        ["graphRoot"],
        "Evidence proof graphRoot must equal source.graph",
      ));
    }
    const first = payload.path[0];
    if (
      first === undefined
      || first.kind !== "graph-subject"
      || !typedReferenceEquals(first.from, payload.graphRoot)
      || !typedReferenceEquals(first.to, payload.subject)
    ) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof",
        ["path", "0"],
        "Evidence path must start with the unique graph-root to subject transition",
      ));
    }
    for (let index = 1; index < payload.path.length; index += 1) {
      if (payload.path[index].kind === "graph-subject") {
        return yield* Effect.fail(invariantError(
          "validate-record-evidence-proof",
          ["path", String(index)],
          "The graph-subject transition may appear only once at path ordinal 0",
        ));
      }
      if (!typedReferenceEquals(
        pathStepToDescriptor(payload.path[index - 1]),
        pathStepFromDescriptor(payload.path[index]),
      )) {
        return yield* Effect.fail(invariantError(
          "validate-record-evidence-proof",
          ["path", String(index)],
          "Every evidence path transition must continue from the previous target",
        ));
      }
    }
    const finalStep = payload.path[payload.path.length - 1];
    const expectedEndpoint = payload.kind === "event"
      ? payload.segment
      : evidenceTargetNode(payload.target);
    if (!typedReferenceEquals(finalStep.to, expectedEndpoint)) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof",
        ["path", String(payload.path.length - 1), "to"],
        "Evidence path must terminate at the node fixed by its proof variant",
      ));
    }
    if (payload.kind !== payload.target.kind) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof",
        ["target", "kind"],
        "Evidence proof variant and target kind must match",
      ));
    }
    if (
      payload.kind === "event"
      && (
        payload.event.streamId !== payload.target.stream.streamId
        || payload.event.sequence !== payload.target.sequence
        || payload.event.eventId !== payload.target.eventId
        || !typedReferenceEquals(payload.streamIndex, payload.target.stream.index)
      )
    ) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof",
        ["event"],
        "Event proof fields must repeat the exact target stream, sequence and event ID",
      ));
    }
    if (
      payload.kind === "event"
      && (
        payload.leafCount === 0
        || payload.target.sequence >= payload.leafCount
        || payload.event.segmentEventOrdinal > payload.event.sequence
      )
    ) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof",
        ["leafCount"],
        "Event proof ordinal and sequence must fit the committed non-empty leaf prefix",
      ));
    }
    if (
      payload.kind === "object"
      && !typedReferenceEquals(payload.object.descriptor, payload.target.node)
    ) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof",
        ["object", "descriptor"],
        "Object proof archive descriptor must equal the target node",
      ));
    }
    if (
      payload.kind === "claim"
      && !typedReferenceEquals(payload.claim.descriptor, payload.target.node)
    ) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof",
        ["claim", "descriptor"],
        "Claim proof archive descriptor must equal the target node",
      ));
    }
    if (payload.kind === "claim") {
      const basedOn = yield* Effect.forEach(payload.basedOn, (evidence) =>
        canonicalJsonBytes(evidence)
      );
      for (let index = 1; index < basedOn.length; index += 1) {
        const order = compareCanonicalBytes(basedOn[index - 1], basedOn[index]);
        if (order >= 0) {
          return yield* Effect.fail(invariantError(
            "validate-record-evidence-proof",
            ["basedOn", String(index)],
            order === 0
              ? "Claim proof basedOn must not contain duplicate EvidenceRef values"
              : "Claim proof basedOn must be sorted by EvidenceRef JCS bytes",
          ));
        }
      }
    }
    if (payload.kind === "absence") {
      const declared = yield* canonicalJsonBytes(payload.absence);
      const targeted = yield* canonicalJsonBytes(payload.target.index);
      if (compareCanonicalBytes(declared, targeted) !== 0) {
        return yield* Effect.fail(invariantError(
          "validate-record-evidence-proof",
          ["absence"],
          "Absence proof fields must exactly equal the target authenticated index",
        ));
      }
    }

    const archives = yield* Effect.forEach(payload.archives, (archive) =>
      Effect.gen(function*() {
        const expectedArchiveId = yield* archiveIdForDescriptor(archive.descriptor);
        if (expectedArchiveId !== archive.archiveId) {
          return yield* Effect.fail(invariantError(
            "validate-record-evidence-proof",
            ["archives", archive.archiveId],
            "Proof archive ID must be SHA-256 of its descriptor preimage",
          ));
        }
        const descriptorBytes = yield* canonicalJsonBytes(archive.descriptor);
        return Object.freeze({ archive, descriptorBytes });
      })
    );
    for (let index = 1; index < archives.length; index += 1) {
      const left = archives[index - 1];
      const right = archives[index];
      const archiveOrder = compareAscii(left.archive.archiveId, right.archive.archiveId);
      if (archiveOrder === 0) {
        const descriptorOrder = compareCanonicalBytes(
          left.descriptorBytes,
          right.descriptorBytes,
        );
        return yield* Effect.fail(invariantError(
          "validate-record-evidence-proof",
          ["archives", String(index)],
          descriptorOrder === 0
            ? "Proof archives must not duplicate archiveId/descriptor pairs"
            : "One proof archiveId must not identify different descriptors",
        ));
      }
      if (archiveOrder > 0) {
        return yield* Effect.fail(invariantError(
          "validate-record-evidence-proof",
          ["archives", String(index)],
          "Proof archives must be sorted by archiveId then descriptor JCS bytes",
        ));
      }
    }
  });
}

export function validateRecordEvidenceProofIndexV1(
  payload: RecordEvidenceProofIndexV1,
): Effect.Effect<void, RecordProtocolError> {
  if ((payload.proofCount === 0) !== (payload.firstPage === null)) {
    return Effect.fail(invariantError(
      "validate-record-evidence-proof-index",
      ["proofCount"],
      "Only an empty proof index may omit firstPage",
    ));
  }
  return Effect.void;
}

export function validateRecordEvidenceProofIndexPageV1(
  payload: RecordEvidenceProofIndexPageV1,
): Effect.Effect<void, RecordProtocolError> {
  return Effect.gen(function*() {
    if (payload.entries.length > ARCHIVE_PAGE_ENTRIES) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof-index-page",
        ["entries"],
        `Proof index pages contain at most ${ARCHIVE_PAGE_ENTRIES} entries`,
      ));
    }
    if (payload.next !== null && payload.entries.length !== ARCHIVE_PAGE_ENTRIES) {
      return yield* Effect.fail(invariantError(
        "validate-record-evidence-proof-index-page",
        ["entries"],
        "Every non-final proof index page must contain exactly 128 entries",
      ));
    }
    const entries = yield* Effect.forEach(payload.entries, (entry) =>
      canonicalJsonBytes(entry.evidence).pipe(
        Effect.map((evidenceBytes) => Object.freeze({ entry, evidenceBytes })),
      )
    );
    for (let index = 0; index < entries.length; index += 1) {
      const expectedKey = yield* recordEvidenceProofKeyV1(entries[index].entry.evidence);
      if (expectedKey !== entries[index].entry.key) {
        return yield* Effect.fail(invariantError(
          "validate-record-evidence-proof-index-page",
          ["entries", String(index), "key"],
          "Proof index key must be SHA-256 of canonical EvidenceRef bytes",
        ));
      }
      if (index === 0) continue;
      const left = entries[index - 1];
      const right = entries[index];
      const keyOrder = compareAscii(left.entry.key, right.entry.key);
      if (keyOrder === 0) {
        const evidenceOrder = compareCanonicalBytes(
          left.evidenceBytes,
          right.evidenceBytes,
        );
        return yield* Effect.fail(invariantError(
          "validate-record-evidence-proof-index-page",
          ["entries", String(index)],
          evidenceOrder === 0
            ? "Proof index entries must not duplicate key/EvidenceRef pairs"
            : "One proof key must not identify different EvidenceRef values",
        ));
      }
      if (keyOrder > 0) {
        return yield* Effect.fail(invariantError(
          "validate-record-evidence-proof-index-page",
          ["entries", String(index)],
          "Proof index entries must be sorted by key then EvidenceRef JCS bytes",
        ));
      }
    }
  });
}
