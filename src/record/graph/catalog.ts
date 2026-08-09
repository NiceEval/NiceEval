import { Effect, Schema } from "effect";
import {
  ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE,
  ATTEMPT_MEDIA_TYPE,
  AttemptLocatorIndexPayloadV1Schema,
  AttemptPayloadV1Schema,
  ENTITY_CATALOG_MEDIA_TYPE,
  EntityCatalogPayloadV1Schema,
  RUN_CONTRIBUTION_MEDIA_TYPE,
  RUN_MEDIA_TYPE,
  RECORD_SUBJECT_MEDIA_TYPE,
  RecordSubjectV1Schema,
  RunContributionV1Schema,
  RunPayloadV1Schema,
  attemptLocatorIndexStrongEdges,
  attemptStrongEdges,
  entityCatalogStrongEdges,
  runContributionStrongEdges,
  runStrongEdges,
  recordSubjectStrongEdges,
  validateAttemptPayloadV1,
  validateAttemptLocatorIndexPayloadV1,
  validateEntityCatalogPayloadV1,
  validateRunContributionV1,
  validateRunPayloadV1,
  validateRecordSubjectV1,
  type AttemptLocatorIndexLeafV1,
  type AttemptLocatorKeyV1,
  type AttemptIdentityV1,
  type AttemptPayloadV1,
  type EntityCatalogKeyV1,
  type EntityCatalogLeafV1,
  type EntityCatalogOwnerV1,
  type ExpectedMembershipSlotV1,
  type RunContributionV1,
  type RunPayloadV1,
  type StreamBindingV1,
} from "../protocol/entities.ts";
import {
  NonEmptyProtocolStringSchema,
  GRAPH_NODE_MEDIA_TYPE,
  GraphNodeV1Schema,
  RadixNibbleV1Schema,
  RadixPathV1Schema,
  decodeProtocolSchema,
  encodeTypedJsonObject,
  typedReferenceEquals,
  type NodeRefV1,
  type RadixPathV1,
  type RecordProtocolError,
  type StrongEdgeV1,
} from "../protocol/core.ts";
import {
  CLAIM_MEDIA_TYPE,
  ClaimPayloadV1Schema,
  claimStrongEdges,
  validateClaimPayloadV1,
  type ClaimPayloadV1,
} from "../protocol/evidence.ts";
import {
  OBSERVATION_STREAM_INDEX_MEDIA_TYPE,
  ObservationStreamIndexV1Schema,
  observationStreamIndexStrongEdges,
  validateObservationStreamIndexV1,
  type ObservationStreamIndexV1,
} from "../protocol/observation.ts";
import { recordProtocolError } from "../protocol/errors.ts";
import { materializeCanonicalRadix } from "./materialize.ts";
import { encodeGraphNodeWithStrongEdgesV1, type RecordGraphEncodedObjectV1 } from "./objects.ts";
import { canonicalRadixKeyContractV1, radixPathForCanonicalPreimageV1 } from "./keys.ts";
import { buildCanonicalRadix, type CanonicalRadixEntry } from "./radix.ts";
import type { RecordGraphObjectReaderV1, RecordGraphReadFailureV1 } from "./read.ts";
import {
  readGraphNodePayloadV1,
  readTypedRecordGraphObjectV1,
  verifyKnownNodeStrongEdgesV1,
} from "./read.ts";

export interface EntityCatalogEntryV1 {
  readonly keyPreimage: EntityCatalogKeyV1;
  readonly owner: EntityCatalogOwnerV1;
  readonly entity: NodeRefV1;
}

export interface AttemptLocatorIndexEntryV1 {
  readonly keyPreimage: AttemptLocatorKeyV1;
  readonly owner: AttemptLocatorIndexLeafV1["owner"];
  readonly locator: AttemptLocatorIndexLeafV1["locator"];
  readonly attemptId: AttemptLocatorIndexLeafV1["attemptId"];
  readonly attemptRevision: NodeRefV1;
}

export interface EncodedNodeRadixV1 {
  readonly root: NodeRefV1;
  readonly objects: readonly RecordGraphEncodedObjectV1[];
}

/** The trusted entry point accepts only entity node refs; leaf identity and owner are decoded. */
export interface EntityCatalogBuildInputV1 {
  readonly recordId: string;
  readonly entities: Iterable<NodeRefV1>;
}

/** The trusted locator entry point accepts only current Attempt revision node refs. */
export interface AttemptLocatorIndexBuildInputV1 {
  readonly attempts: Iterable<NodeRefV1>;
}

export type CatalogBuildFailureV1<ReadFailure> =
  | RecordGraphReadFailureV1<ReadFailure>
  | RecordProtocolError;

/**
 * Store-bound checks intentionally excluded from pure graph decoding. A commit verifier supplies
 * this port to prove the historical stream prefix and that an adopted Attempt belongs to the same
 * Record's committed-root history. The graph layer still verifies all direct references and
 * immutable successor fields before calling either hook.
 */
export interface CatalogCommitBoundaryV1<Failure, Requirements> {
  readonly verifyStreamAppend: (input: CatalogStreamAppendInputV1) => Effect.Effect<void, Failure, Requirements>;
  readonly verifyAdoptedAttemptMembership: (
    input: CatalogAdoptedAttemptMembershipInputV1,
  ) => Effect.Effect<void, Failure, Requirements>;
}

export interface CatalogStreamAppendInputV1 {
  readonly owner:
    | { readonly kind: "run"; readonly runId: string; readonly experimentId: string }
    | {
        readonly kind: "attempt";
        readonly originRunId: string;
        readonly attemptId: string;
        readonly evalId: string;
      };
  readonly stream: NodeRefV1;
  readonly predecessor: NodeRefV1 | null;
  readonly payload: ObservationStreamIndexV1;
}

export interface CatalogAdoptedAttemptMembershipInputV1 {
  readonly recordId: string;
  readonly contribution: NodeRefV1;
  readonly adoptedAttempt: NodeRefV1;
  readonly attemptId: string;
}

export function entityCatalogKeyPathV1(
  key: EntityCatalogKeyV1,
): Effect.Effect<RadixPathV1, RecordProtocolError> {
  return radixPathForCanonicalPreimageV1(key);
}

export function attemptLocatorKeyPathV1(
  key: AttemptLocatorKeyV1,
): Effect.Effect<RadixPathV1, RecordProtocolError> {
  return radixPathForCanonicalPreimageV1(key);
}

/**
 * Concrete trusted builder: every catalog leaf is derived from a descriptor-checked known payload.
 * `recordId` is the Record context, while leaf owners and keys are never caller-supplied.
 */
export function buildEntityCatalogV1<ReadFailure, Requirements>(
  input: EntityCatalogBuildInputV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<
  EncodedNodeRadixV1,
  CatalogBuildFailureV1<ReadFailure>,
  Requirements
> {
  return Effect.gen(function* () {
    const recordId = yield* decodeProtocolSchema(
      NonEmptyProtocolStringSchema,
      input.recordId,
      "build-entity-catalog-record-id",
    );
    const entries: EntityCatalogEntryV1[] = [];
    for (const entity of input.entities) {
      entries.push(yield* deriveEntityCatalogEntryV1(recordId, entity, reader));
    }
    return yield* materializeEntityCatalogV1(entries);
  });
}

/**
 * Concrete trusted builder for the independent Attempt locator radix. Every leaf identity comes
 * from the decoded Attempt payload, including the canonical locator and direct predecessor check.
 */
export function buildAttemptLocatorIndexV1<ReadFailure, Requirements>(
  input: AttemptLocatorIndexBuildInputV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<
  EncodedNodeRadixV1,
  CatalogBuildFailureV1<ReadFailure>,
  Requirements
> {
  return Effect.gen(function* () {
    const entries: AttemptLocatorIndexEntryV1[] = [];
    for (const attempt of input.attempts) {
      const decoded = yield* readVerifiedAttemptV1(attempt, reader);
      entries.push(Object.freeze({
        keyPreimage: Object.freeze({
          schema: "niceeval.attempt-locator-key/1",
          locator: decoded.payload.identity.locator,
        }),
        owner: Object.freeze({
          kind: "attempt",
          attemptId: decoded.payload.identity.attemptId,
        }),
        locator: decoded.payload.identity.locator,
        attemptId: decoded.payload.identity.attemptId,
        attemptRevision: attempt,
      }));
    }
    return yield* materializeAttemptLocatorIndexV1(entries);
  });
}

/**
 * Low-level materializer for entries already derived by a concrete decoder. It intentionally does
 * not accept an arbitrary caller-supplied owner at the public trusted build boundary.
 */
export function materializeEntityCatalogV1(
  input: Iterable<EntityCatalogEntryV1>,
): Effect.Effect<EncodedNodeRadixV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const entries: CanonicalRadixEntry<EntityCatalogEntryV1>[] = [];
    for (const entry of input) {
      entries.push({
        key: yield* entityCatalogKeyPathV1(entry.keyPreimage),
        value: entry,
      });
    }
    const built = buildCanonicalRadix(entries, yield* canonicalRadixKeyContractV1());
    if (built.state === "invalid") {
      return yield* Effect.fail(invalidRadixBuild("build-entity-catalog", built.issues));
    }

    const objects: RecordGraphEncodedObjectV1[] = [];
    const root = yield* materializeCanonicalRadix(built.root, {
      leaf: (leaf) => encodeEntityCatalogLeaf(leaf.key, leaf.value, objects),
      branch: (branch) => encodeEntityCatalogBranch(branch.prefix, branch.children, objects),
    });
    return Object.freeze({ root, objects: Object.freeze(objects) });
  });
}

/** Low-level materializer for already decoded Attempt locator entries. */
export function materializeAttemptLocatorIndexV1(
  input: Iterable<AttemptLocatorIndexEntryV1>,
): Effect.Effect<EncodedNodeRadixV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const entries: CanonicalRadixEntry<AttemptLocatorIndexEntryV1>[] = [];
    for (const entry of input) {
      entries.push({
        key: yield* attemptLocatorKeyPathV1(entry.keyPreimage),
        value: entry,
      });
    }
    const built = buildCanonicalRadix(entries, yield* canonicalRadixKeyContractV1());
    if (built.state === "invalid") {
      return yield* Effect.fail(invalidRadixBuild("build-attempt-locator-index", built.issues));
    }

    const objects: RecordGraphEncodedObjectV1[] = [];
    const root = yield* materializeCanonicalRadix(built.root, {
      leaf: (leaf) => encodeAttemptLocatorLeaf(leaf.key, leaf.value, objects),
      branch: (branch) => encodeAttemptLocatorBranch(branch.prefix, branch.children, objects),
    });
    return Object.freeze({ root, objects: Object.freeze(objects) });
  });
}

function deriveEntityCatalogEntryV1<ReadFailure, Requirements>(
  recordId: string,
  entity: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<
  EntityCatalogEntryV1,
  CatalogBuildFailureV1<ReadFailure>,
  Requirements
> {
  return Effect.gen(function* () {
    const wrapper = yield* readTypedRecordGraphObjectV1(
      entity,
      GraphNodeV1Schema,
      GRAPH_NODE_MEDIA_TYPE,
      reader,
    );
    switch (wrapper.payload.mediaType) {
      case RUN_MEDIA_TYPE: {
        const decoded = yield* readVerifiedRunV1(entity, reader);
        return entityCatalogEntry(
          "run",
          decoded.payload.runId,
          Object.freeze({ kind: "record", recordId }),
          entity,
        );
      }
      case ATTEMPT_MEDIA_TYPE: {
        const decoded = yield* readVerifiedAttemptV1(entity, reader);
        return entityCatalogEntry(
          "attempt",
          decoded.payload.identity.attemptId,
          Object.freeze({ kind: "run", runId: decoded.payload.originRunId }),
          entity,
        );
      }
      case OBSERVATION_STREAM_INDEX_MEDIA_TYPE: {
        const decoded = yield* readVerifiedObservationStreamIndexV1(entity, reader);
        const owner: EntityCatalogOwnerV1 = decoded.payload.scope.kind === "run"
          ? Object.freeze({ kind: "run", runId: decoded.payload.scope.runId })
          : Object.freeze({ kind: "attempt", attemptId: decoded.payload.scope.attemptId });
        return entityCatalogEntry("stream", decoded.payload.streamId, owner, entity);
      }
      case CLAIM_MEDIA_TYPE: {
        const decoded = yield* readVerifiedClaimV1(entity, reader);
        const owner: EntityCatalogOwnerV1 = decoded.payload.scope.kind === "run"
          ? Object.freeze({ kind: "run", runId: decoded.payload.scope.runId })
          : Object.freeze({ kind: "attempt", attemptId: decoded.payload.scope.attemptId });
        return entityCatalogEntry("claim", decoded.payload.claim.id, owner, entity);
      }
      case RUN_CONTRIBUTION_MEDIA_TYPE: {
        const decoded = yield* readVerifiedRunContributionV1(entity, reader);
        return entityCatalogEntry(
          "contribution",
          decoded.payload.contributionId,
          Object.freeze({ kind: "run", runId: decoded.payload.runId }),
          entity,
        );
      }
      default:
        return yield* Effect.fail(catalogInvariant(
          "derive-entity-catalog-entry",
          "Entity catalog leaves only admit current Run, Attempt, stream, Claim or Contribution payloads",
        ));
    }
  });
}

/**
 * Verifies a decoded entity leaf against the concrete current payload rather than trusting its
 * caller-provided owner metadata. `recordId` must come from the decoded RecordSubject context.
 */
export function verifyEntityCatalogLeafV1<ReadFailure, Requirements>(
  recordId: string,
  leaf: EntityCatalogLeafV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    yield* validateEntityCatalogPayloadV1(leaf);
    const derived = yield* deriveEntityCatalogEntryV1(recordId, leaf.entity, reader);
    if (
      derived.keyPreimage.kind !== leaf.keyPreimage.kind
      || derived.keyPreimage.id !== leaf.keyPreimage.id
      || !sameEntityCatalogOwner(derived.owner, leaf.owner)
    ) {
      return yield* Effect.fail(catalogInvariant(
        "verify-entity-catalog-leaf",
        "Catalog leaf kind, ID and owner must be mechanically derived from its current entity payload",
      ));
    }
  });
}

/** Verifies all locator leaf identity fields against the exact current Attempt revision payload. */
export function verifyAttemptLocatorIndexLeafV1<ReadFailure, Requirements>(
  leaf: AttemptLocatorIndexLeafV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    yield* validateAttemptLocatorIndexPayloadV1(leaf);
    const decoded = yield* readVerifiedAttemptV1(leaf.attemptRevision, reader);
    if (
      leaf.attemptId !== decoded.payload.identity.attemptId
      || leaf.locator !== decoded.payload.identity.locator
      || leaf.keyPreimage.locator !== decoded.payload.identity.locator
      || leaf.owner.attemptId !== decoded.payload.identity.attemptId
    ) {
      return yield* Effect.fail(catalogInvariant(
        "verify-attempt-locator-index-leaf",
        "Locator leaf identity and owner must be mechanically derived from its current Attempt payload",
      ));
    }
  });
}

/**
 * Subject-bound entity verification closes the recordId trust boundary before checking a leaf.
 * Callers must already have read the leaf GraphNode and verified its own current-entity edge.
 */
export function verifyEntityCatalogLeafForSubjectV1<ReadFailure, Requirements>(
  subject: NodeRefV1,
  catalog: NodeRefV1,
  leaf: EntityCatalogLeafV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const decoded = yield* readRecordSubjectNodeV1(subject, reader);
    if (!typedReferenceEquals(decoded.payload.catalog, catalog)) {
      return yield* Effect.fail(catalogInvariant(
        "verify-entity-catalog-subject",
        "The verified RecordSubject must point to the exact entity catalog root",
      ));
    }
    yield* verifyEntityCatalogLeafV1(decoded.payload.recordId, leaf, reader);
  });
}

/** Subject-bound locator verification closes the locator-index edge before checking an Attempt leaf. */
export function verifyAttemptLocatorIndexLeafForSubjectV1<ReadFailure, Requirements>(
  subject: NodeRefV1,
  index: NodeRefV1,
  leaf: AttemptLocatorIndexLeafV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const decoded = yield* readRecordSubjectNodeV1(subject, reader);
    if (!typedReferenceEquals(decoded.payload.locatorIndex, index)) {
      return yield* Effect.fail(catalogInvariant(
        "verify-attempt-locator-subject",
        "The verified RecordSubject must point to the exact Attempt locator index root",
      ));
    }
    yield* verifyAttemptLocatorIndexLeafV1(leaf, reader);
  });
}

/**
 * Checks a same-key catalog replacement before a caller rebuilds an immutable radix root. A new
 * current ref must be the exact one-step successor of the old ref; Claims are immutable and may
 * only be retained unchanged.
 */
export function validateEntityCatalogReplacementV1<ReadFailure, Requirements>(
  recordId: string,
  previous: NodeRefV1,
  next: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const prior = yield* deriveEntityCatalogEntryV1(recordId, previous, reader);
    const successor = yield* deriveEntityCatalogEntryV1(recordId, next, reader);
    if (
      prior.keyPreimage.kind !== successor.keyPreimage.kind
      || prior.keyPreimage.id !== successor.keyPreimage.id
      || !sameEntityCatalogOwner(prior.owner, successor.owner)
    ) {
      return yield* Effect.fail(catalogInvariant(
        "validate-entity-catalog-replacement",
        "A catalog replacement must preserve the exact entity key and mechanically derived owner",
      ));
    }
    if (typedReferenceEquals(previous, next)) return;

    const wrapper = yield* readTypedRecordGraphObjectV1(
      next,
      GraphNodeV1Schema,
      GRAPH_NODE_MEDIA_TYPE,
      reader,
    );
    const direct = yield* entityPayloadPointsDirectlyToV1(next, previous, wrapper.payload.mediaType, reader);
    if (!direct) {
      return yield* Effect.fail(catalogInvariant(
        "validate-entity-catalog-replacement",
        "A changed catalog current ref must be an exact direct successor of the prior entity ref",
      ));
    }
  });
}

/**
 * Commit-time extension of `validateEntityCatalogReplacementV1`. It keeps the Store-dependent
 * stream-prefix and committed-membership proof as injected effects, rather than duplicating Store
 * traversal in graph. A Store `validateCommit` implementation should call this variant whenever
 * it advances a catalog current ref.
 */
export function validateEntityCatalogReplacementAtCommitV1<
  ReadFailure,
  Requirements,
  BoundaryFailure,
  BoundaryRequirements,
>(
  recordId: string,
  previous: NodeRefV1,
  next: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  boundary: CatalogCommitBoundaryV1<BoundaryFailure, BoundaryRequirements>,
): Effect.Effect<
  void,
  CatalogBuildFailureV1<ReadFailure> | BoundaryFailure,
  Requirements | BoundaryRequirements
> {
  return Effect.gen(function* () {
    yield* validateEntityCatalogReplacementV1(recordId, previous, next, reader);
    yield* validateCatalogCurrentEntityCommitBoundaryV1(recordId, next, reader, boundary);
  });
}

/**
 * Runs the two Store-bound proof hooks for an already decoded current entity. This is also useful
 * when a new catalog key is inserted (there is no previous catalog leaf to replace).
 */
export function validateCatalogCurrentEntityCommitBoundaryV1<
  ReadFailure,
  Requirements,
  BoundaryFailure,
  BoundaryRequirements,
>(
  recordId: string,
  entity: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  boundary: CatalogCommitBoundaryV1<BoundaryFailure, BoundaryRequirements>,
): Effect.Effect<
  void,
  CatalogBuildFailureV1<ReadFailure> | BoundaryFailure,
  Requirements | BoundaryRequirements
> {
  return Effect.gen(function* () {
    const wrapper = yield* readTypedRecordGraphObjectV1(
      entity,
      GraphNodeV1Schema,
      GRAPH_NODE_MEDIA_TYPE,
      reader,
    );
    switch (wrapper.payload.mediaType) {
      case RUN_MEDIA_TYPE: {
        const run = yield* readVerifiedRunV1(entity, reader);
        for (const binding of run.payload.streams) {
          const stream = yield* readVerifiedObservationStreamIndexV1(binding.index, reader);
          yield* boundary.verifyStreamAppend(Object.freeze({
            owner: Object.freeze({
              kind: "run" as const,
              runId: run.payload.runId,
              experimentId: run.payload.experimentId,
            }),
            stream: binding.index,
            predecessor: stream.payload.previous,
            payload: stream.payload,
          }));
        }
        return;
      }
      case ATTEMPT_MEDIA_TYPE: {
        const attempt = yield* readVerifiedAttemptV1(entity, reader);
        for (const binding of attempt.payload.streams) {
          const stream = yield* readVerifiedObservationStreamIndexV1(binding.index, reader);
          yield* boundary.verifyStreamAppend(Object.freeze({
            owner: Object.freeze({
              kind: "attempt" as const,
              originRunId: attempt.payload.originRunId,
              attemptId: attempt.payload.identity.attemptId,
              evalId: attempt.payload.identity.evalId,
            }),
            stream: binding.index,
            predecessor: stream.payload.previous,
            payload: stream.payload,
          }));
        }
        return;
      }
      case RUN_CONTRIBUTION_MEDIA_TYPE: {
        const contribution = yield* readVerifiedRunContributionV1(entity, reader);
        yield* boundary.verifyAdoptedAttemptMembership(Object.freeze({
          recordId,
          contribution: entity,
          adoptedAttempt: contribution.payload.attempt.adopted,
          attemptId: contribution.payload.attempt.attemptId,
        }));
        return;
      }
      case CLAIM_MEDIA_TYPE:
      case OBSERVATION_STREAM_INDEX_MEDIA_TYPE:
        return;
      default:
        return yield* Effect.fail(catalogInvariant(
          "validate-catalog-current-entity-commit-boundary",
          "Catalog commit-boundary validation only supports current entity payload media types",
        ));
    }
  });
}

/** Equivalent direct-successor guard for a stable locator key's current Attempt revision. */
export function validateAttemptLocatorReplacementV1<ReadFailure, Requirements>(
  previous: NodeRefV1,
  next: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const prior = yield* readVerifiedAttemptV1(previous, reader);
    const successor = yield* readVerifiedAttemptV1(next, reader);
    if (
      prior.payload.identity.attemptId !== successor.payload.identity.attemptId
      || prior.payload.identity.locator !== successor.payload.identity.locator
    ) {
      return yield* Effect.fail(catalogInvariant(
        "validate-attempt-locator-replacement",
        "A locator replacement must preserve the exact Attempt identity and locator",
      ));
    }
    if (!typedReferenceEquals(previous, next)) {
      const directPredecessor = successor.payload.previous;
      if (directPredecessor === null || !typedReferenceEquals(directPredecessor, previous)) {
        return yield* Effect.fail(catalogInvariant(
          "validate-attempt-locator-replacement",
          "A changed locator current ref must be an exact direct Attempt successor",
        ));
      }
    }
  });
}

function entityCatalogEntry(
  kind: EntityCatalogKeyV1["kind"],
  id: string,
  owner: EntityCatalogOwnerV1,
  entity: NodeRefV1,
): EntityCatalogEntryV1 {
  return Object.freeze({
    keyPreimage: Object.freeze({
      schema: "niceeval.entity-catalog-key/1",
      kind,
      id,
    }),
    owner,
    entity,
  });
}

function readVerifiedRunV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return Effect.gen(function* () {
    const decoded = yield* readRunNodeV1(reference, reader);
    if (decoded.payload.previous === null) {
      yield* validateRunRevisionContentsV1(decoded.payload, undefined, reader);
      return decoded;
    }
    const predecessor = yield* readRunNodeV1(decoded.payload.previous, reader);
    if (predecessor.payload.revision !== decoded.payload.revision - 1) {
      return yield* Effect.fail(catalogInvariant(
        "validate-run-direct-successor",
        "A Run successor revision must be exactly one greater than its direct predecessor",
      ));
    }
    yield* validateRunRevisionContentsV1(decoded.payload, predecessor.payload, reader);
    return decoded;
  });
}

function readVerifiedAttemptV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return Effect.gen(function* () {
    const decoded = yield* readAttemptNodeV1(reference, reader);
    if (decoded.payload.previous === null) {
      yield* validateAttemptRevisionContentsV1(decoded.payload, undefined, reader);
      return decoded;
    }
    const predecessor = yield* readAttemptNodeV1(decoded.payload.previous, reader);
    if (predecessor.payload.revision !== decoded.payload.revision - 1) {
      return yield* Effect.fail(catalogInvariant(
        "validate-attempt-direct-successor",
        "An Attempt successor revision must be exactly one greater than its direct predecessor",
      ));
    }
    yield* validateAttemptRevisionContentsV1(decoded.payload, predecessor.payload, reader);
    return decoded;
  });
}

function readVerifiedObservationStreamIndexV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return Effect.gen(function* () {
    const decoded = yield* readObservationStreamIndexNodeV1(reference, reader);
    if (decoded.payload.previous === null) return decoded;
    const predecessor = yield* readObservationStreamIndexNodeV1(decoded.payload.previous, reader);
    if (
      predecessor.payload.revision !== decoded.payload.revision - 1
      || predecessor.payload.streamId !== decoded.payload.streamId
      || !sameObservationScope(predecessor.payload.scope, decoded.payload.scope)
    ) {
      return yield* Effect.fail(catalogInvariant(
        "validate-stream-direct-successor",
        "A stream catalog update must point to the same scoped stream direct predecessor",
      ));
    }
    if (isTerminalStreamState(predecessor.payload.state) && predecessor.payload.state !== decoded.payload.state) {
      return yield* Effect.fail(catalogInvariant(
        "validate-stream-direct-successor",
        "A closed or abandoned stream cannot reopen or change to another terminal state",
      ));
    }
    if (decoded.payload.leafCount < predecessor.payload.leafCount) {
      return yield* Effect.fail(catalogInvariant(
        "validate-stream-direct-successor",
        "A stream successor cannot decrease its committed leafCount",
      ));
    }
    if (
      decoded.payload.leafCount === predecessor.payload.leafCount
      && (
        decoded.payload.throughSequence !== predecessor.payload.throughSequence
        || decoded.payload.merkleRoot !== predecessor.payload.merkleRoot
        || !sameOptionalNodeReference(decoded.payload.firstSegmentPage, predecessor.payload.firstSegmentPage)
      )
    ) {
      return yield* Effect.fail(catalogInvariant(
        "validate-stream-direct-successor",
        "An unchanged stream prefix must retain throughSequence, merkleRoot and firstSegmentPage",
      ));
    }
    if (
      isTerminalStreamState(predecessor.payload.state)
      && (
        decoded.payload.leafCount !== predecessor.payload.leafCount
        || decoded.payload.throughSequence !== predecessor.payload.throughSequence
        || decoded.payload.merkleRoot !== predecessor.payload.merkleRoot
        || !sameOptionalNodeReference(decoded.payload.firstSegmentPage, predecessor.payload.firstSegmentPage)
      )
    ) {
      return yield* Effect.fail(catalogInvariant(
        "validate-stream-direct-successor",
        "A terminal stream cannot append or replace its committed prefix",
      ));
    }
    return decoded;
  });
}

function readVerifiedClaimV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return readClaimNodeV1(reference, reader);
}

function readVerifiedRunContributionV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return Effect.gen(function* () {
    const decoded = yield* readRunContributionNodeV1(reference, reader);
    const adopted = yield* readVerifiedAttemptV1(decoded.payload.attempt.adopted, reader);
    if (adopted.payload.identity.attemptId !== decoded.payload.attempt.attemptId) {
      return yield* Effect.fail(catalogInvariant(
        "validate-contribution-adopted-attempt",
        "A Contribution adopted Attempt ref must have the payload attemptId bound by Contribution.attempt",
      ));
    }
    if (decoded.payload.previous === null) return decoded;
    const predecessorReference = decoded.payload.previous;
    const predecessor = yield* readRunContributionNodeV1(predecessorReference, reader);
    if (
      decoded.payload.supersedes === null
      || !typedReferenceEquals(decoded.payload.supersedes, predecessorReference)
      || predecessor.payload.revision !== decoded.payload.revision - 1
      || predecessor.payload.contributionId !== decoded.payload.contributionId
      || predecessor.payload.runId !== decoded.payload.runId
      || predecessor.payload.evalId !== decoded.payload.evalId
      || predecessor.payload.membershipSlot !== decoded.payload.membershipSlot
      || predecessor.payload.mode !== decoded.payload.mode
      || predecessor.payload.attempt.attemptId !== decoded.payload.attempt.attemptId
    ) {
      return yield* Effect.fail(catalogInvariant(
        "validate-contribution-direct-successor",
        "A Contribution successor must retain immutable identity fields and use its exact predecessor for previous and supersedes",
      ));
    }
    yield* requireSameOrDirectAttemptSuccessorV1(
      predecessor.payload.attempt.adopted,
      decoded.payload.attempt.adopted,
      reader,
      "validate-contribution-adopted-attempt",
    );
    return decoded;
  });
}

function validateRunRevisionContentsV1<ReadFailure, Requirements>(
  next: RunPayloadV1,
  previous: RunPayloadV1 | undefined,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    if (previous !== undefined) {
      if (
        previous.runId !== next.runId
        || previous.invocationId !== next.invocationId
        || previous.experimentId !== next.experimentId
        || !typedReferenceEquals(previous.provenance, next.provenance)
      ) {
        return yield* Effect.fail(catalogInvariant(
          "validate-run-direct-successor",
          "A Run successor must preserve runId, invocationId, experimentId and provenance",
        ));
      }
      if (isTerminalRunState(previous.state) && previous.state !== next.state) {
        return yield* Effect.fail(catalogInvariant(
          "validate-run-direct-successor",
          "A completed, incomplete or interrupted Run cannot return to active or change terminal state",
        ));
      }
      if (!sameExpectedMembershipSlots(previous.expectedMembershipSlots, next.expectedMembershipSlots)) {
        return yield* Effect.fail(catalogInvariant(
          "validate-run-direct-successor",
          "Run expectedMembershipSlots are fixed after revision 0",
        ));
      }
    }
    yield* validateRunStreamBindingsV1(next, previous?.streams, reader);
    yield* validateRunContributionPointersV1(next, previous?.contributions, reader);
  });
}

function validateAttemptRevisionContentsV1<ReadFailure, Requirements>(
  next: AttemptPayloadV1,
  previous: AttemptPayloadV1 | undefined,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    if (previous !== undefined) {
      if (
        !sameAttemptIdentity(previous.identity, next.identity)
        || previous.originRunId !== next.originRunId
        || !typedReferenceEquals(previous.provenance, next.provenance)
      ) {
        return yield* Effect.fail(catalogInvariant(
          "validate-attempt-direct-successor",
          "An Attempt successor must preserve attemptId, locator, evalId, ordinal, originRunId and provenance",
        ));
      }
      if (isTerminalAttemptState(previous.state) && previous.state !== next.state) {
        return yield* Effect.fail(catalogInvariant(
          "validate-attempt-direct-successor",
          "A completed or abandoned Attempt cannot return to active or change terminal state",
        ));
      }
    }
    yield* validateAttemptStreamBindingsV1(next, previous?.streams, reader);
  });
}

function validateRunStreamBindingsV1<ReadFailure, Requirements>(
  run: RunPayloadV1,
  previous: readonly StreamBindingV1[] | undefined,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const priorById = bindingsById(previous);
    const retained = new Set<string>();
    for (const binding of run.streams) {
      const stream = yield* readVerifiedObservationStreamIndexV1(binding.index, reader);
      if (!matchesRunBindingScope(run, binding, stream.payload)) {
        return yield* Effect.fail(catalogInvariant(
          "validate-run-stream-binding",
          "A Run binding must point to its declared streamId scoped to the same runId and experimentId",
        ));
      }
      const prior = priorById.get(binding.bindingId);
      if (prior === undefined) {
        if (previous !== undefined && binding.requirement !== "supplemental") {
          return yield* Effect.fail(catalogInvariant(
            "validate-run-stream-binding",
            "Only a new supplemental binding may be added to an existing Run",
          ));
        }
        continue;
      }
      retained.add(binding.bindingId);
      if (!sameBindingIdentity(prior, binding)) {
        return yield* Effect.fail(catalogInvariant(
          "validate-run-stream-binding",
          "A retained Run binding cannot change role, requirement or streamId",
        ));
      }
      yield* requireSameOrDirectStreamSuccessorV1(
        prior.index,
        binding.index,
        reader,
        "validate-run-stream-binding",
      );
    }
    if (previous !== undefined && retained.size !== previous.length) {
      return yield* Effect.fail(catalogInvariant(
        "validate-run-stream-binding",
        "An existing Run binding cannot be removed",
      ));
    }
  });
}

function validateAttemptStreamBindingsV1<ReadFailure, Requirements>(
  attempt: AttemptPayloadV1,
  previous: readonly StreamBindingV1[] | undefined,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const priorById = bindingsById(previous);
    const retained = new Set<string>();
    for (const binding of attempt.streams) {
      const stream = yield* readVerifiedObservationStreamIndexV1(binding.index, reader);
      if (!matchesAttemptBindingScope(attempt, binding, stream.payload)) {
        return yield* Effect.fail(catalogInvariant(
          "validate-attempt-stream-binding",
          "An Attempt binding must point to its declared streamId scoped to the same runId, attemptId and evalId",
        ));
      }
      const prior = priorById.get(binding.bindingId);
      if (prior === undefined) {
        if (previous !== undefined && binding.requirement !== "supplemental") {
          return yield* Effect.fail(catalogInvariant(
            "validate-attempt-stream-binding",
            "Only a new supplemental binding may be added to an existing Attempt",
          ));
        }
        continue;
      }
      retained.add(binding.bindingId);
      if (!sameBindingIdentity(prior, binding)) {
        return yield* Effect.fail(catalogInvariant(
          "validate-attempt-stream-binding",
          "A retained Attempt binding cannot change role, requirement or streamId",
        ));
      }
      yield* requireSameOrDirectStreamSuccessorV1(
        prior.index,
        binding.index,
        reader,
        "validate-attempt-stream-binding",
      );
    }
    if (previous !== undefined && retained.size !== previous.length) {
      return yield* Effect.fail(catalogInvariant(
        "validate-attempt-stream-binding",
        "An existing Attempt binding cannot be removed",
      ));
    }
  });
}

function validateRunContributionPointersV1<ReadFailure, Requirements>(
  run: RunPayloadV1,
  previous: RunPayloadV1["contributions"] | undefined,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const expected = new Map<string, string>();
    for (const slot of run.expectedMembershipSlots) {
      expected.set(slot.membershipSlot, slot.evalId);
    }
    const priorBySlot = previous === undefined
      ? new Map<string, RunPayloadV1["contributions"][number]>()
      : new Map(previous.map((pointer) => [pointer.membershipSlot, pointer]));
    const retained = new Set<string>();
    for (const pointer of run.contributions) {
      const expectedEvalId = expected.get(pointer.membershipSlot);
      if (expectedEvalId === undefined) {
        return yield* Effect.fail(catalogInvariant(
          "validate-run-contribution",
          "A Run current Contribution must occupy an expected membership slot",
        ));
      }
      const contribution = yield* readVerifiedRunContributionV1(pointer.node, reader);
      if (
        contribution.payload.runId !== run.runId
        || contribution.payload.evalId !== expectedEvalId
        || contribution.payload.membershipSlot !== pointer.membershipSlot
        || contribution.payload.contributionId !== pointer.contributionId
      ) {
        return yield* Effect.fail(catalogInvariant(
          "validate-run-contribution",
          "A Run current Contribution must preserve runId, expected evalId, membershipSlot and contributionId",
        ));
      }
      const prior = priorBySlot.get(pointer.membershipSlot);
      if (prior === undefined) continue;
      retained.add(pointer.membershipSlot);
      if (prior.contributionId !== pointer.contributionId) {
        return yield* Effect.fail(catalogInvariant(
          "validate-run-contribution",
          "A populated Run membershipSlot must remain bound to its original contributionId",
        ));
      }
      yield* requireSameOrDirectContributionSuccessorV1(
        prior.node,
        pointer.node,
        reader,
        "validate-run-contribution",
      );
    }
    if (previous !== undefined && retained.size !== previous.length) {
      return yield* Effect.fail(catalogInvariant(
        "validate-run-contribution",
        "A populated Run membershipSlot cannot be removed from a successor revision",
      ));
    }
  });
}

function requireSameOrDirectStreamSuccessorV1<ReadFailure, Requirements>(
  previous: NodeRefV1,
  next: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  operation: string,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  if (typedReferenceEquals(previous, next)) return Effect.void;
  return readVerifiedObservationStreamIndexV1(next, reader).pipe(
    Effect.flatMap((successor) =>
      successor.payload.previous !== null && typedReferenceEquals(successor.payload.previous, previous)
        ? Effect.void
        : Effect.fail(catalogInvariant(
          operation,
          "A changed binding index must be the exact direct stream successor",
        ))
    ),
  );
}

function requireSameOrDirectAttemptSuccessorV1<ReadFailure, Requirements>(
  previous: NodeRefV1,
  next: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  operation: string,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  if (typedReferenceEquals(previous, next)) return Effect.void;
  return readVerifiedAttemptV1(next, reader).pipe(
    Effect.flatMap((successor) =>
      successor.payload.previous !== null && typedReferenceEquals(successor.payload.previous, previous)
        ? Effect.void
        : Effect.fail(catalogInvariant(
          operation,
          "A changed adopted Attempt must be the exact direct successor of the previous adopted Attempt",
        ))
    ),
  );
}

function requireSameOrDirectContributionSuccessorV1<ReadFailure, Requirements>(
  previous: NodeRefV1,
  next: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  operation: string,
): Effect.Effect<void, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  if (typedReferenceEquals(previous, next)) return Effect.void;
  return readVerifiedRunContributionV1(next, reader).pipe(
    Effect.flatMap((successor) =>
      successor.payload.previous !== null && typedReferenceEquals(successor.payload.previous, previous)
        ? Effect.void
        : Effect.fail(catalogInvariant(
          operation,
          "A changed current Contribution must be the exact direct successor of the previous current Contribution",
        ))
    ),
  );
}

function bindingsById(
  bindings: readonly StreamBindingV1[] | undefined,
): Map<string, StreamBindingV1> {
  return new Map(bindings?.map((binding) => [binding.bindingId, binding]) ?? []);
}

function sameBindingIdentity(left: StreamBindingV1, right: StreamBindingV1): boolean {
  return left.role === right.role
    && left.requirement === right.requirement
    && left.streamId === right.streamId;
}

function matchesRunBindingScope(
  run: RunPayloadV1,
  binding: StreamBindingV1,
  stream: ObservationStreamIndexV1,
): boolean {
  return stream.streamId === binding.streamId
    && stream.scope.kind === "run"
    && stream.scope.runId === run.runId
    && stream.scope.experimentId === run.experimentId;
}

function matchesAttemptBindingScope(
  attempt: AttemptPayloadV1,
  binding: StreamBindingV1,
  stream: ObservationStreamIndexV1,
): boolean {
  return stream.streamId === binding.streamId
    && stream.scope.kind === "attempt"
    && stream.scope.runId === attempt.originRunId
    && stream.scope.attemptId === attempt.identity.attemptId
    && stream.scope.evalId === attempt.identity.evalId;
}

function sameExpectedMembershipSlots(
  left: readonly ExpectedMembershipSlotV1[],
  right: readonly ExpectedMembershipSlotV1[],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const prior = left[index];
    const next = right[index];
    if (
      prior === undefined
      || next === undefined
      || prior.membershipSlot !== next.membershipSlot
      || prior.evalId !== next.evalId
    ) return false;
  }
  return true;
}

function sameAttemptIdentity(left: AttemptIdentityV1, right: AttemptIdentityV1): boolean {
  return left.attemptId === right.attemptId
    && left.locator === right.locator
    && left.evalId === right.evalId
    && left.ordinal === right.ordinal;
}

function sameOptionalNodeReference(left: NodeRefV1 | null, right: NodeRefV1 | null): boolean {
  return left === null ? right === null : right !== null && typedReferenceEquals(left, right);
}

function isTerminalRunState(state: RunPayloadV1["state"]): boolean {
  return state !== "active";
}

function isTerminalAttemptState(state: AttemptPayloadV1["state"]): boolean {
  return state !== "active";
}

function isTerminalStreamState(state: ObservationStreamIndexV1["state"]): boolean {
  return state === "closed" || state === "abandoned";
}

function readRunNodeV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return readKnownEntityNodeV1(
    reference,
    RunPayloadV1Schema,
    RUN_MEDIA_TYPE,
    validateRunPayloadV1,
    runStrongEdges,
    reader,
  );
}

function entityPayloadPointsDirectlyToV1<ReadFailure, Requirements>(
  entity: NodeRefV1,
  predecessor: NodeRefV1,
  mediaType: string,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<boolean, CatalogBuildFailureV1<ReadFailure>, Requirements> {
  switch (mediaType) {
    case RUN_MEDIA_TYPE:
      return readVerifiedRunV1(entity, reader).pipe(
        Effect.map((decoded) => decoded.payload.previous !== null && typedReferenceEquals(decoded.payload.previous, predecessor)),
      );
    case ATTEMPT_MEDIA_TYPE:
      return readVerifiedAttemptV1(entity, reader).pipe(
        Effect.map((decoded) => decoded.payload.previous !== null && typedReferenceEquals(decoded.payload.previous, predecessor)),
      );
    case OBSERVATION_STREAM_INDEX_MEDIA_TYPE:
      return readVerifiedObservationStreamIndexV1(entity, reader).pipe(
        Effect.map((decoded) => decoded.payload.previous !== null && typedReferenceEquals(decoded.payload.previous, predecessor)),
      );
    case RUN_CONTRIBUTION_MEDIA_TYPE:
      return readVerifiedRunContributionV1(entity, reader).pipe(
        Effect.map((decoded) => decoded.payload.previous !== null && typedReferenceEquals(decoded.payload.previous, predecessor)),
      );
    case CLAIM_MEDIA_TYPE:
      return Effect.succeed(false);
    default:
      return Effect.fail(catalogInvariant(
        "validate-entity-catalog-replacement",
        "Catalog replacement target must use a supported current entity payload media type",
      ));
  }
}

function readRecordSubjectNodeV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return readKnownEntityNodeV1(
    reference,
    RecordSubjectV1Schema,
    RECORD_SUBJECT_MEDIA_TYPE,
    validateRecordSubjectV1,
    recordSubjectStrongEdges,
    reader,
  );
}

function readAttemptNodeV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return readKnownEntityNodeV1(
    reference,
    AttemptPayloadV1Schema,
    ATTEMPT_MEDIA_TYPE,
    validateAttemptPayloadV1,
    attemptStrongEdges,
    reader,
  );
}

function readObservationStreamIndexNodeV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return readKnownEntityNodeV1(
    reference,
    ObservationStreamIndexV1Schema,
    OBSERVATION_STREAM_INDEX_MEDIA_TYPE,
    validateObservationStreamIndexV1,
    observationStreamIndexStrongEdges,
    reader,
  );
}

function readClaimNodeV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return readKnownEntityNodeV1(
    reference,
    ClaimPayloadV1Schema,
    CLAIM_MEDIA_TYPE,
    validateClaimPayloadV1,
    claimStrongEdges,
    reader,
  );
}

function readRunContributionNodeV1<ReadFailure, Requirements>(
  reference: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return readKnownEntityNodeV1(
    reference,
    RunContributionV1Schema,
    RUN_CONTRIBUTION_MEDIA_TYPE,
    validateRunContributionV1,
    runContributionStrongEdges,
    reader,
  );
}

function readKnownEntityNodeV1<Payload, Encoded, ReadFailure, Requirements>(
  reference: NodeRefV1,
  schema: Schema.Schema<Payload, Encoded, never>,
  mediaType: string,
  validate: (payload: Payload) => Effect.Effect<void, RecordProtocolError>,
  strongEdges: (payload: Payload) => readonly StrongEdgeV1[],
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
) {
  return Effect.gen(function* () {
    const decoded = yield* readGraphNodePayloadV1(
      reference,
      schema,
      mediaType,
      reader,
    );
    yield* validate(decoded.payload);
    yield* verifyKnownNodeStrongEdgesV1(decoded.node, strongEdges(decoded.payload), reader);
    return decoded;
  });
}

function sameObservationScope(
  left: ObservationStreamIndexV1["scope"],
  right: ObservationStreamIndexV1["scope"],
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "run" && right.kind === "run") {
    return left.runId === right.runId && left.experimentId === right.experimentId;
  }
  if (left.kind === "attempt" && right.kind === "attempt") {
    return left.runId === right.runId
      && left.experimentId === right.experimentId
      && left.attemptId === right.attemptId
      && left.evalId === right.evalId
      && left.agentSessionId === right.agentSessionId
      && left.turnId === right.turnId;
  }
  return false;
}

function sameEntityCatalogOwner(
  left: EntityCatalogOwnerV1,
  right: EntityCatalogOwnerV1,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "record":
      return right.kind === "record" && left.recordId === right.recordId;
    case "run":
      return right.kind === "run" && left.runId === right.runId;
    case "attempt":
      return right.kind === "attempt" && left.attemptId === right.attemptId;
  }
}

function catalogInvariant(operation: string, message: string): RecordProtocolError {
  return recordProtocolError({
    code: "payload-invariant-invalid",
    operation,
    message,
  });
}

function encodeEntityCatalogLeaf(
  key: string,
  entry: EntityCatalogEntryV1,
  objects: RecordGraphEncodedObjectV1[],
): Effect.Effect<NodeRefV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const payload = yield* encodeTypedJsonObject(
      EntityCatalogPayloadV1Schema,
      ENTITY_CATALOG_MEDIA_TYPE,
      {
        schema: "niceeval.entity-catalog/1",
        node: "leaf",
        key: yield* decodeProtocolSchema(RadixPathV1Schema, key, "encode-entity-catalog-leaf-key"),
        keyPreimage: entry.keyPreimage,
        owner: entry.owner,
        entity: entry.entity,
      },
    );
    yield* validateEntityCatalogPayloadV1(payload.value);
    return yield* appendPayloadAndWrap(
      payload.descriptor,
      payload.bytes,
      entityCatalogStrongEdges(payload.value),
      objects,
    );
  });
}

function encodeEntityCatalogBranch(
  prefix: string,
  children: readonly { readonly nibble: string; readonly node: NodeRefV1 }[],
  objects: RecordGraphEncodedObjectV1[],
): Effect.Effect<NodeRefV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const encodedChildren: { readonly nibble: string; readonly node: NodeRefV1 }[] = [];
    for (const child of children) {
      encodedChildren.push(Object.freeze({
        nibble: yield* decodeProtocolSchema(
          RadixNibbleV1Schema,
          child.nibble,
          "encode-entity-catalog-branch-nibble",
        ),
        node: child.node,
      }));
    }
    const payload = yield* encodeTypedJsonObject(
      EntityCatalogPayloadV1Schema,
      ENTITY_CATALOG_MEDIA_TYPE,
      {
        schema: "niceeval.entity-catalog/1",
        node: "branch",
        prefix: yield* decodeProtocolSchema(
          RadixPathV1Schema,
          prefix,
          "encode-entity-catalog-branch-prefix",
        ),
        children: Object.freeze(encodedChildren),
      },
    );
    yield* validateEntityCatalogPayloadV1(payload.value);
    return yield* appendPayloadAndWrap(
      payload.descriptor,
      payload.bytes,
      entityCatalogStrongEdges(payload.value),
      objects,
    );
  });
}

function encodeAttemptLocatorLeaf(
  key: string,
  entry: AttemptLocatorIndexEntryV1,
  objects: RecordGraphEncodedObjectV1[],
): Effect.Effect<NodeRefV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const payload = yield* encodeTypedJsonObject(
      AttemptLocatorIndexPayloadV1Schema,
      ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE,
      {
        schema: "niceeval.attempt-locator-index/1",
        node: "leaf",
        key: yield* decodeProtocolSchema(RadixPathV1Schema, key, "encode-attempt-locator-leaf-key"),
        keyPreimage: entry.keyPreimage,
        owner: entry.owner,
        locator: entry.locator,
        attemptId: entry.attemptId,
        attemptRevision: entry.attemptRevision,
      },
    );
    yield* validateAttemptLocatorIndexPayloadV1(payload.value);
    return yield* appendPayloadAndWrap(
      payload.descriptor,
      payload.bytes,
      attemptLocatorIndexStrongEdges(payload.value),
      objects,
    );
  });
}

function encodeAttemptLocatorBranch(
  prefix: string,
  children: readonly { readonly nibble: string; readonly node: NodeRefV1 }[],
  objects: RecordGraphEncodedObjectV1[],
): Effect.Effect<NodeRefV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const encodedChildren: { readonly nibble: string; readonly node: NodeRefV1 }[] = [];
    for (const child of children) {
      encodedChildren.push(Object.freeze({
        nibble: yield* decodeProtocolSchema(
          RadixNibbleV1Schema,
          child.nibble,
          "encode-attempt-locator-branch-nibble",
        ),
        node: child.node,
      }));
    }
    const payload = yield* encodeTypedJsonObject(
      AttemptLocatorIndexPayloadV1Schema,
      ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE,
      {
        schema: "niceeval.attempt-locator-index/1",
        node: "branch",
        prefix: yield* decodeProtocolSchema(
          RadixPathV1Schema,
          prefix,
          "encode-attempt-locator-branch-prefix",
        ),
        children: Object.freeze(encodedChildren),
      },
    );
    yield* validateAttemptLocatorIndexPayloadV1(payload.value);
    return yield* appendPayloadAndWrap(
      payload.descriptor,
      payload.bytes,
      attemptLocatorIndexStrongEdges(payload.value),
      objects,
    );
  });
}

function appendPayloadAndWrap(
  descriptor: RecordGraphEncodedObjectV1["descriptor"],
  bytes: Uint8Array,
  edges: Parameters<typeof encodeGraphNodeWithStrongEdgesV1>[1],
  objects: RecordGraphEncodedObjectV1[],
): Effect.Effect<NodeRefV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const payload = Object.freeze({ descriptor, bytes });
    objects.push(payload);
    const wrapped = yield* encodeGraphNodeWithStrongEdgesV1(payload, edges);
    objects.push(...wrapped.objects);
    return wrapped.node;
  });
}

function invalidRadixBuild(
  operation: string,
  issues: readonly { readonly kind: string; readonly key?: string; readonly detail?: string }[],
): RecordProtocolError {
  return recordProtocolError({
    code: "payload-invariant-invalid",
    operation,
    message: issues.map((issue) => issue.key ?? issue.detail ?? issue.kind).join(", "),
  });
}
