// Commit-time catalog and locator transition verification.  This remains in graph because the
// authenticated radix walk, canonical reconstruction, and current-entity successor rules are
// protocol semantics; Store only injects raw-object reads and maps this closed failure surface.

import { Effect } from "effect";
import {
  type AttemptLocatorIndexLeafV1,
  type EntityCatalogLeafV1,
  type EntityCatalogOwnerV1,
  type RecordSubjectV1,
} from "../protocol/entities.ts";
import {
  type DescriptorV1,
  type GraphRootRefV1,
  type NodeRefV1,
  type RecordProtocolError,
  typedReferenceEquals,
} from "../protocol/core.ts";
import {
  OBSERVATION_SEGMENT_MEDIA_TYPE,
  OBSERVATION_SEGMENT_PAGE_MEDIA_TYPE,
  ObservationSegmentPageV1Schema,
  ObservationSegmentV1Schema,
  ObservationStreamIndexV1Schema,
  computeObservationMerkleRootV1,
  observationSegmentPageStrongEdges,
  observationSegmentStrongEdges,
  validateObservationSegmentPageV1,
  validateObservationSegmentV1,
  validateObservationStreamIndexV1,
  type ObservationEventV1,
  type ObservationStreamIndexV1,
} from "../protocol/observation.ts";
import { canonicalJsonBytes } from "../protocol/canonical.ts";
import {
  materializeAttemptLocatorIndexV1,
  materializeEntityCatalogV1,
  validateAttemptLocatorReplacementV1,
  validateCatalogCurrentEntityCommitBoundaryV1,
  validateEntityCatalogReplacementAtCommitV1,
  verifyAttemptLocatorIndexLeafV1,
  verifyEntityCatalogLeafV1,
  type AttemptLocatorIndexEntryV1,
  type CatalogAdoptedAttemptMembershipInputV1,
  type CatalogBuildFailureV1,
  type CatalogCommitBoundaryV1,
  type CatalogStreamAppendInputV1,
  type EntityCatalogEntryV1,
} from "./catalog.ts";
import {
  enumerateAttemptLocatorIndexV1,
  enumerateEntityCatalogV1,
  type NodeRadixEnumerationLimitsV1,
  type NodeRadixLookupFailureV1,
} from "./node-radix.ts";
import type { RecordGraphReadFailureV1, RecordGraphObjectReaderV1 } from "./read.ts";
import { readGraphNodePayloadV1, verifyKnownNodeStrongEdgesV1 } from "./read.ts";

/** A small closed vocabulary deliberately suitable for a Store/public error mapper. */
export type CatalogTransitionSemanticCodeV1 =
  | "catalog-transition-invalid"
  | "catalog-key-deleted"
  | "catalog-key-rebound"
  | "locator-key-deleted"
  | "locator-key-rebound"
  | "stream-append-invalid"
  | "adopted-attempt-not-committed"
  | "catalog-locator-mismatch";

export interface CatalogTransitionSemanticFailureV1 {
  readonly kind: "catalog-transition-semantic";
  readonly code: CatalogTransitionSemanticCodeV1;
  readonly ref?: DescriptorV1;
  readonly related?: DescriptorV1;
}

export interface CatalogTransitionResourceLimitFailureV1 {
  readonly kind: "catalog-transition-resource-limit";
  readonly limit: "objects" | "depth" | "bytes";
  readonly maximum: number;
  readonly observed: number;
  readonly ref?: DescriptorV1;
}

export type CatalogTransitionFailureV1<ReadFailure> =
  | CatalogBuildFailureV1<ReadFailure>
  | NodeRadixLookupFailureV1<ReadFailure>
  | RecordGraphReadFailureV1<ReadFailure>
  | CatalogTransitionSemanticFailureV1
  | CatalogTransitionResourceLimitFailureV1;

export interface CatalogTransitionVerificationLimitsV1 {
  readonly objects: { readonly maximum: number };
  readonly depth: { readonly maximum: number };
  readonly bytes: { readonly maximum: number };
}

export interface CatalogHistorySubjectV1 {
  readonly graph: GraphRootRefV1;
  readonly subject: NodeRefV1;
  readonly payload: RecordSubjectV1;
}

export interface VerifiedCatalogEntityV1 {
  readonly reference: NodeRefV1;
  readonly leaf: EntityCatalogLeafV1;
}

export interface VerifiedAttemptLocatorV1 {
  readonly reference: NodeRefV1;
  readonly leaf: AttemptLocatorIndexLeafV1;
}

export interface VerifiedCatalogSnapshotV1 extends CatalogHistorySubjectV1 {
  readonly entities: readonly VerifiedCatalogEntityV1[];
  readonly locators: readonly VerifiedAttemptLocatorV1[];
}

/**
 * Authenticate every current catalog and locator leaf, then require that the disclosed leaves
 * rebuild the exact canonical root.  This admits non-empty genesis trees while rejecting an
 * alternate compression, sharing, invented leaf key, or raw Store-side interpretation.
 */
export function verifyCatalogHistorySnapshotsV1<ReadFailure, Requirements>(
  input: {
    readonly recordId: string;
    readonly subjects: readonly CatalogHistorySubjectV1[];
    readonly reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>;
    readonly limits: CatalogTransitionVerificationLimitsV1;
  },
): Effect.Effect<
  readonly VerifiedCatalogSnapshotV1[],
  CatalogTransitionFailureV1<ReadFailure>,
  Requirements
> {
  return Effect.gen(function* () {
    const snapshots: VerifiedCatalogSnapshotV1[] = [];
    for (const subject of input.subjects) {
      snapshots.push(yield* verifyCatalogSnapshotV1({
        recordId: input.recordId,
        subject,
        reader: input.reader,
        limits: input.limits,
      }));
    }
    return Object.freeze(snapshots);
  });
}

/**
 * Verify one direct Record successor.  `current` may be absent only for revision zero; each
 * retained catalog/locator key is immutable in identity and a changed current ref is checked by
 * the protocol's direct-successor verifier.  New keys are permitted.
 */
export function verifyCatalogSuccessorV1<ReadFailure, Requirements>(
  input: {
    readonly recordId: string;
    readonly current: VerifiedCatalogSnapshotV1 | undefined;
    readonly next: VerifiedCatalogSnapshotV1;
    readonly history: readonly VerifiedCatalogSnapshotV1[];
    readonly reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>;
    readonly limits: CatalogTransitionVerificationLimitsV1;
  },
): Effect.Effect<void, CatalogTransitionFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const currentEntities = new Map<string, VerifiedCatalogEntityV1>();
    const currentLocators = new Map<string, VerifiedAttemptLocatorV1>();
    if (input.current !== undefined) {
      for (const entity of input.current.entities) currentEntities.set(entity.leaf.key, entity);
      for (const locator of input.current.locators) currentLocators.set(locator.leaf.key, locator);
    }
    const nextEntities = new Map<string, VerifiedCatalogEntityV1>();
    const nextLocators = new Map<string, VerifiedAttemptLocatorV1>();
    for (const entity of input.next.entities) nextEntities.set(entity.leaf.key, entity);
    for (const locator of input.next.locators) nextLocators.set(locator.leaf.key, locator);

    const historicAttempts = new Map<string, string>();
    for (const snapshot of input.history) {
      for (const entity of snapshot.entities) {
        if (entity.leaf.keyPreimage.kind !== "attempt") continue;
        historicAttempts.set(referenceKey(entity.leaf.entity), entity.leaf.keyPreimage.id);
      }
    }

    const boundary = catalogBoundaryV1(
      input.current,
      historicAttempts,
      input.reader,
      input.limits,
    );

    for (const [key, previous] of currentEntities) {
      const next = nextEntities.get(key);
      if (next === undefined) {
        return yield* Effect.fail(semanticFailure("catalog-key-deleted", previous.reference));
      }
      if (!sameCatalogOwner(previous.leaf.owner, next.leaf.owner)) {
        return yield* Effect.fail(semanticFailure(
          "catalog-key-rebound",
          next.reference,
          previous.reference,
        ));
      }
      if (!typedReferenceEquals(previous.leaf.entity, next.leaf.entity)) {
        yield* validateEntityCatalogReplacementAtCommitV1(
          input.recordId,
          previous.leaf.entity,
          next.leaf.entity,
          input.reader,
          boundary,
        );
      }
    }
    for (const [key, next] of nextEntities) {
      if (currentEntities.has(key)) continue;
      yield* validateCatalogCurrentEntityCommitBoundaryV1(
        input.recordId,
        next.leaf.entity,
        input.reader,
        boundary,
      );
    }

    for (const [key, previous] of currentLocators) {
      const next = nextLocators.get(key);
      if (next === undefined) {
        return yield* Effect.fail(semanticFailure("locator-key-deleted", previous.reference));
      }
      if (
        previous.leaf.attemptId !== next.leaf.attemptId
        || previous.leaf.locator !== next.leaf.locator
        || previous.leaf.owner.attemptId !== next.leaf.owner.attemptId
      ) {
        return yield* Effect.fail(semanticFailure(
          "locator-key-rebound",
          next.reference,
          previous.reference,
        ));
      }
      if (!typedReferenceEquals(previous.leaf.attemptRevision, next.leaf.attemptRevision)) {
        yield* validateAttemptLocatorReplacementV1(
          previous.leaf.attemptRevision,
          next.leaf.attemptRevision,
          input.reader,
        );
      }
    }
  });
}

function verifyCatalogSnapshotV1<ReadFailure, Requirements>(
  input: {
    readonly recordId: string;
    readonly subject: CatalogHistorySubjectV1;
    readonly reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>;
    readonly limits: CatalogTransitionVerificationLimitsV1;
  },
): Effect.Effect<
  VerifiedCatalogSnapshotV1,
  CatalogTransitionFailureV1<ReadFailure>,
  Requirements
> {
  return Effect.gen(function* () {
    const radixLimits: NodeRadixEnumerationLimitsV1 = Object.freeze({
      maximumObjects: input.limits.objects.maximum,
      maximumDepth: input.limits.depth.maximum,
    });
    const entities = yield* enumerateEntityCatalogV1(
      input.subject.payload.catalog,
      input.reader,
      radixLimits,
    );
    const verifiedEntities: VerifiedCatalogEntityV1[] = [];
    const materializedEntities: EntityCatalogEntryV1[] = [];
    for (const item of entities.leaves) {
      if (item.payload.node !== "leaf") {
        return yield* Effect.fail(semanticFailure("catalog-transition-invalid", item.reference));
      }
      yield* verifyEntityCatalogLeafV1(input.recordId, item.payload, input.reader);
      verifiedEntities.push(Object.freeze({ reference: item.reference, leaf: item.payload }));
      materializedEntities.push(Object.freeze({
        keyPreimage: item.payload.keyPreimage,
        owner: item.payload.owner,
        entity: item.payload.entity,
      }));
    }
    const rebuiltCatalog = yield* materializeEntityCatalogV1(materializedEntities);
    if (!typedReferenceEquals(rebuiltCatalog.root, input.subject.payload.catalog)) {
      return yield* Effect.fail(semanticFailure(
        "catalog-transition-invalid",
        input.subject.payload.catalog,
      ));
    }

    const locators = yield* enumerateAttemptLocatorIndexV1(
      input.subject.payload.locatorIndex,
      input.reader,
      radixLimits,
    );
    const verifiedLocators: VerifiedAttemptLocatorV1[] = [];
    const materializedLocators: AttemptLocatorIndexEntryV1[] = [];
    for (const item of locators.leaves) {
      if (item.payload.node !== "leaf") {
        return yield* Effect.fail(semanticFailure("catalog-transition-invalid", item.reference));
      }
      yield* verifyAttemptLocatorIndexLeafV1(item.payload, input.reader);
      verifiedLocators.push(Object.freeze({ reference: item.reference, leaf: item.payload }));
      materializedLocators.push(Object.freeze({
        keyPreimage: item.payload.keyPreimage,
        owner: item.payload.owner,
        locator: item.payload.locator,
        attemptId: item.payload.attemptId,
        attemptRevision: item.payload.attemptRevision,
      }));
    }
    const rebuiltLocator = yield* materializeAttemptLocatorIndexV1(materializedLocators);
    if (!typedReferenceEquals(rebuiltLocator.root, input.subject.payload.locatorIndex)) {
      return yield* Effect.fail(semanticFailure(
        "catalog-transition-invalid",
        input.subject.payload.locatorIndex,
      ));
    }

    // Locator leaves name an Attempt revision, but only a current catalog Attempt makes that
    // revision part of this Record state.  This ties the two independent authenticated indexes
    // without inventing a Store-side identity table.
    const currentAttempts = new Map<string, NodeRefV1>();
    for (const entity of verifiedEntities) {
      if (entity.leaf.keyPreimage.kind === "attempt") {
        currentAttempts.set(entity.leaf.keyPreimage.id, entity.leaf.entity);
      }
    }
    const locatorAttempts = new Set<string>();
    for (const locator of verifiedLocators) {
      const current = currentAttempts.get(locator.leaf.attemptId);
      if (current === undefined || !typedReferenceEquals(current, locator.leaf.attemptRevision)) {
        return yield* Effect.fail(semanticFailure(
          "catalog-locator-mismatch",
          locator.reference,
          locator.leaf.attemptRevision,
        ));
      }
      if (locatorAttempts.has(locator.leaf.attemptId)) {
        return yield* Effect.fail(semanticFailure("catalog-locator-mismatch", locator.reference));
      }
      locatorAttempts.add(locator.leaf.attemptId);
    }
    for (const [attemptId, attempt] of currentAttempts) {
      if (!locatorAttempts.has(attemptId)) {
        return yield* Effect.fail(semanticFailure("catalog-locator-mismatch", attempt));
      }
    }

    return Object.freeze({
      ...input.subject,
      entities: Object.freeze(verifiedEntities),
      locators: Object.freeze(verifiedLocators),
    });
  });
}

function catalogBoundaryV1<ReadFailure, Requirements>(
  current: VerifiedCatalogSnapshotV1 | undefined,
  historicAttempts: ReadonlyMap<string, string>,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: CatalogTransitionVerificationLimitsV1,
): CatalogCommitBoundaryV1<CatalogTransitionSemanticFailureV1 | CatalogTransitionResourceLimitFailureV1 | RecordGraphReadFailureV1<ReadFailure> | RecordProtocolError, Requirements> {
  const currentStreamReferences = new Set<string>();
  if (current !== undefined) {
    for (const entity of current.entities) {
      if (entity.leaf.keyPreimage.kind === "stream") {
        currentStreamReferences.add(referenceKey(entity.leaf.entity));
      }
    }
  }
  return Object.freeze({
    verifyStreamAppend: (input: CatalogStreamAppendInputV1) => Effect.gen(function* () {
      if (
        input.predecessor !== null
        && !currentStreamReferences.has(referenceKey(input.predecessor))
      ) {
        return yield* Effect.fail(semanticFailure(
          "stream-append-invalid",
          input.stream,
          input.predecessor,
        ));
      }
      const nextEvents = yield* readObservationStreamEventsV1(
        input.stream,
        input.payload,
        reader,
        limits,
      );
      if (input.predecessor === null) return;

      const predecessor = yield* readGraphNodePayloadV1(
        input.predecessor,
        ObservationStreamIndexV1Schema,
        "application/vnd.niceeval.observation-stream-index.v1+jcs",
        reader,
      );
      yield* validateObservationStreamIndexV1(predecessor.payload);
      yield* verifyKnownNodeStrongEdgesV1(
        predecessor.node,
        Object.freeze([
          ...(predecessor.payload.previous === null
            ? []
            : [{ relation: "niceeval.stream-previous", target: predecessor.payload.previous }]),
          ...(predecessor.payload.firstSegmentPage === null
            ? []
            : [{ relation: "niceeval.stream-segment-page-first", target: predecessor.payload.firstSegmentPage }]),
        ]),
        reader,
      );
      const previousEvents = yield* readObservationStreamEventsV1(
        input.predecessor,
        predecessor.payload,
        reader,
        limits,
      );
      if (nextEvents.length < previousEvents.length) {
        return yield* Effect.fail(semanticFailure("stream-append-invalid", input.stream, input.predecessor));
      }
      for (let index = 0; index < previousEvents.length; index += 1) {
        const previousEvent = previousEvents[index];
        const nextEvent = nextEvents[index];
        if (previousEvent === undefined || nextEvent === undefined) {
          return yield* Effect.fail(semanticFailure("stream-append-invalid", input.stream, input.predecessor));
        }
        const previousBytes = yield* canonicalJsonBytes(previousEvent);
        const nextBytes = yield* canonicalJsonBytes(nextEvent);
        if (!sameBytes(previousBytes, nextBytes)) {
          return yield* Effect.fail(semanticFailure("stream-append-invalid", input.stream, input.predecessor));
        }
      }
    }),
    verifyAdoptedAttemptMembership: (input: CatalogAdoptedAttemptMembershipInputV1) => {
      const attemptId = historicAttempts.get(referenceKey(input.adoptedAttempt));
      return attemptId === input.attemptId
        ? Effect.void
        : Effect.fail(semanticFailure(
          "adopted-attempt-not-committed",
          input.contribution,
          input.adoptedAttempt,
        ));
    },
  });
}

function readObservationStreamEventsV1<ReadFailure, Requirements>(
  index: NodeRefV1,
  payload: ObservationStreamIndexV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: CatalogTransitionVerificationLimitsV1,
): Effect.Effect<
  readonly ObservationEventV1[],
  CatalogTransitionSemanticFailureV1 | CatalogTransitionResourceLimitFailureV1 | RecordGraphReadFailureV1<ReadFailure> | RecordProtocolError,
  Requirements
> {
  return Effect.gen(function* () {
    const budget = new StreamBudgetV1(limits);
    const indexBudget = budget.observe(index, 1);
    if (indexBudget !== undefined) return yield* Effect.fail(indexBudget);
    const events: ObservationEventV1[] = [];
    const seenPages = new Set<string>();
    let pageReference = payload.firstSegmentPage;
    let depth = 0;
    while (pageReference !== null) {
      if (depth > limits.depth.maximum) {
        return yield* Effect.fail(resourceFailure("depth", limits.depth.maximum, depth, pageReference));
      }
      const pageKey = referenceKey(pageReference);
      if (seenPages.has(pageKey)) {
        return yield* Effect.fail(semanticFailure("stream-append-invalid", index, pageReference));
      }
      seenPages.add(pageKey);
      const page = yield* readGraphNodePayloadV1(
        pageReference,
        ObservationSegmentPageV1Schema,
        OBSERVATION_SEGMENT_PAGE_MEDIA_TYPE,
        reader,
      );
      const pageBudget = budget.observe(pageReference, page.node.payload.size);
      if (pageBudget !== undefined) return yield* Effect.fail(pageBudget);
      yield* validateObservationSegmentPageV1(page.payload);
      yield* verifyKnownNodeStrongEdgesV1(
        page.node,
        observationSegmentPageStrongEdges(page.payload),
        reader,
      );
      if (page.payload.streamId !== payload.streamId) {
        return yield* Effect.fail(semanticFailure("stream-append-invalid", pageReference, index));
      }
      for (const entry of page.payload.entries) {
        if (entry.firstSequence !== events.length) {
          return yield* Effect.fail(semanticFailure("stream-append-invalid", pageReference, entry.segment));
        }
        const segment = yield* readGraphNodePayloadV1(
          entry.segment,
          ObservationSegmentV1Schema,
          OBSERVATION_SEGMENT_MEDIA_TYPE,
          reader,
        );
        const segmentBudget = budget.observe(entry.segment, segment.node.payload.size);
        if (segmentBudget !== undefined) return yield* Effect.fail(segmentBudget);
        yield* validateObservationSegmentV1(segment.payload);
        yield* verifyKnownNodeStrongEdgesV1(
          segment.node,
          observationSegmentStrongEdges(segment.payload),
          reader,
        );
        if (
          segment.payload.streamId !== payload.streamId
          || segment.payload.firstSequence !== entry.firstSequence
          || entry.lastSequence !== entry.firstSequence + segment.payload.events.length - 1
        ) {
          return yield* Effect.fail(semanticFailure("stream-append-invalid", entry.segment, index));
        }
        events.push(...segment.payload.events);
      }
      pageReference = page.payload.next;
      depth += 1;
    }
    if (
      events.length !== payload.leafCount
      || (events.length === 0 ? payload.throughSequence !== null : payload.throughSequence !== events.length - 1)
    ) {
      return yield* Effect.fail(semanticFailure("stream-append-invalid", index));
    }
    const merkleRoot = yield* computeObservationMerkleRootV1(payload.streamId, events);
    if (merkleRoot !== payload.merkleRoot) {
      return yield* Effect.fail(semanticFailure("stream-append-invalid", index));
    }
    return Object.freeze(events);
  });
}

class StreamBudgetV1 {
  #objects = 0;
  #bytes = 0;

  constructor(private readonly limits: CatalogTransitionVerificationLimitsV1) {}

  observe(
    ref: DescriptorV1,
    payloadBytes: number,
  ): CatalogTransitionResourceLimitFailureV1 | undefined {
    this.#objects += 2;
    this.#bytes += ref.size + payloadBytes;
    if (this.#objects > this.limits.objects.maximum) {
      return resourceFailure("objects", this.limits.objects.maximum, this.#objects, ref);
    }
    if (this.#bytes > this.limits.bytes.maximum) {
      return resourceFailure("bytes", this.limits.bytes.maximum, this.#bytes, ref);
    }
    return undefined;
  }
}

function sameCatalogOwner(left: EntityCatalogOwnerV1, right: EntityCatalogOwnerV1): boolean {
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

function semanticFailure(
  code: CatalogTransitionSemanticCodeV1,
  ref?: DescriptorV1,
  related?: DescriptorV1,
): CatalogTransitionSemanticFailureV1 {
  return Object.freeze({
    kind: "catalog-transition-semantic",
    code,
    ...(ref === undefined ? {} : { ref }),
    ...(related === undefined ? {} : { related }),
  });
}

function resourceFailure(
  limit: "objects" | "depth" | "bytes",
  maximum: number,
  observed: number,
  ref?: DescriptorV1,
): CatalogTransitionResourceLimitFailureV1 {
  return Object.freeze({
    kind: "catalog-transition-resource-limit",
    limit,
    maximum,
    observed,
    ...(ref === undefined ? {} : { ref }),
  });
}

function referenceKey(reference: DescriptorV1): string {
  return `${reference.mediaType}\u0000${reference.digest}\u0000${String(reference.size)}`;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
