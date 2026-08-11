import { Effect, Schema } from "effect";
import { canonicalJsonBytes, compareCanonicalBytes } from "../protocol/canonical.ts";
import {
  EDGE_PAGE_MEDIA_TYPE,
  EdgePageV1Schema,
  GRAPH_NODE_MEDIA_TYPE,
  GraphNodeV1Schema,
  GRAPH_ROOT_MEDIA_TYPE,
  GraphRootV1Schema,
  decodeTypedJsonObject,
  typedReferenceEquals,
  validateEdgePageV1,
  validateStrongEdgeSequence,
  type DescriptorV1,
  type EdgePageRefV1,
  type GraphRootRefV1,
  type NodeRefV1,
  type RecordGraphRefV1,
  type RecordProtocolError,
} from "../protocol/core.ts";
import {
  type EvidenceRef,
  type RecordEvidencePathStepV1,
} from "../protocol/evidence.ts";
import { recordProtocolError } from "../protocol/errors.ts";
import type { RecordProtocolCodecRegistryV1 } from "../protocol/codecs.ts";
import type { RecordGraphObjectReaderV1, RecordGraphReadFailureV1 } from "./read.ts";
import { readRequiredRecordGraphObjectV1 } from "./read.ts";
import { verifyKnownPayloadEdgesForGraphNodeV1 } from "./known-payload.ts";
import {
  selectCanonicalStrongPath,
  type CanonicalStrongPathEdge,
} from "./path.ts";

export interface EvidencePathLimitsV1 {
  readonly maximumObjects: number;
  readonly maximumDepth: number;
  readonly maximumBytes: number;
  /** Candidate simple-path states considered during canonical tie breaking. */
  readonly maximumPathStates: number;
}

export const DEFAULT_EVIDENCE_PATH_LIMITS_V1: EvidencePathLimitsV1 = Object.freeze({
  maximumObjects: 4_096,
  maximumDepth: 256,
  maximumBytes: 64 * 1024 * 1024,
  maximumPathStates: 16_384,
});

export type EvidencePathFailureV1<ReadFailure> =
  | RecordGraphReadFailureV1<ReadFailure>
  | { readonly kind: "resource-limit"; readonly limit: "objects" | "depth" | "bytes" | "states"; readonly maximum: number; readonly observed: number }
  | { readonly kind: "edge-page-cycle"; readonly page: EdgePageRefV1 }
  | { readonly kind: "path-invalid"; readonly detail: string }
  | { readonly kind: "target-unreachable"; readonly target: NodeRefV1 };

interface EvidencePathCandidateV1 {
  readonly step: RecordEvidencePathStepV1;
  readonly bytes: Uint8Array;
}

interface EvidencePathNodeV1 {
  readonly reference: DescriptorV1;
  readonly outgoing: readonly CanonicalStrongPathEdge<DescriptorV1, EvidencePathCandidateV1>[];
}

type EvidencePathPendingV1 =
  | { readonly kind: "graph-root"; readonly reference: GraphRootRefV1; readonly depth: number }
  | { readonly kind: "graph-node"; readonly reference: NodeRefV1; readonly depth: number }
  | {
      readonly kind: "edge-page";
      readonly reference: EdgePageRefV1;
      readonly depth: number;
      readonly ancestors: readonly EdgePageRefV1[];
    };

type EvidencePathMeteredReadFailureV1<ReadFailure> =
  | { readonly kind: "evidence-path-source-read-failure"; readonly failure: ReadFailure }
  | {
      readonly kind: "evidence-path-reader-resource-limit";
      readonly limit: "objects" | "bytes";
      readonly maximum: number;
      readonly observed: number;
    };

type CachedEvidencePathReadV1 =
  | { readonly state: "present"; readonly bytes: Uint8Array }
  | { readonly state: "missing" };

/**
 * Builds the unique shortest/JCS-tie-broken authenticated path from `source.graph` to a target
 * NodeRef. It traverses only frozen GraphRoot, GraphNode and EdgePage transitions, so unknown
 * payload bytes remain opaque while their declared strong edges are still usable.
 */
export function buildRecordEvidencePathV1<ReadFailure, Requirements>(
  source: RecordGraphRefV1,
  target: NodeRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: EvidencePathLimitsV1 = DEFAULT_EVIDENCE_PATH_LIMITS_V1,
): Effect.Effect<
  readonly RecordEvidencePathStepV1[],
  EvidencePathFailureV1<ReadFailure>,
  Requirements
> {
  return Effect.gen(function* () {
    const limitsIssue = validatePathLimits(limits);
    if (limitsIssue !== undefined) {
      return yield* Effect.fail(pathInvalid(limitsIssue));
    }

    const pending: EvidencePathPendingV1[] = [{
      kind: "graph-root",
      reference: source.graph,
      depth: 0,
    }];
    const nodes = new Map<string, EvidencePathNodeV1>();
    const seen = new Set<string>();
    let bytes = 0;

    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const current = pending[cursor];
      if (current === undefined) continue;

      if (
        current.kind === "edge-page"
        && current.ancestors.some((ancestor) => typedReferenceEquals(ancestor, current.reference))
      ) {
        return yield* Effect.fail(edgePageCycleFailure<ReadFailure>(current.reference));
      }
      if (current.depth > limits.maximumDepth) {
        return yield* Effect.fail(resourceLimitFailure<ReadFailure>(
          "depth",
          limits.maximumDepth,
          current.depth,
        ));
      }

      const identity = descriptorKey(current.reference);
      if (seen.has(identity)) continue;

      const observedObjects = seen.size + 1;
      if (observedObjects > limits.maximumObjects) {
        return yield* Effect.fail(resourceLimitFailure<ReadFailure>(
          "objects",
          limits.maximumObjects,
          observedObjects,
        ));
      }
      seen.add(identity);

      switch (current.kind) {
        case "graph-root": {
          const decoded = yield* readEvidenceObjectV1(
            current.reference,
            GraphRootV1Schema,
            GRAPH_ROOT_MEDIA_TYPE,
            reader,
          );
          bytes += decoded.bytes.byteLength;
          if (bytes > limits.maximumBytes) {
            return yield* Effect.fail(resourceLimitFailure<ReadFailure>(
              "bytes",
              limits.maximumBytes,
              bytes,
            ));
          }
          const step: RecordEvidencePathStepV1 = Object.freeze({
            kind: "graph-subject",
            from: current.reference,
            relation: "niceeval.graph-subject",
            to: decoded.value.subject,
          });
          nodes.set(identity, Object.freeze({
            reference: current.reference,
            outgoing: Object.freeze([yield* evidencePathEdgeForReferenceV1<ReadFailure>(
              current.reference,
              step,
            )]),
          }));
          pending.push({
            kind: "graph-node",
            reference: decoded.value.subject,
            depth: current.depth + 1,
          });
          break;
        }
        case "graph-node": {
          const decoded = yield* readEvidenceObjectV1(
            current.reference,
            GraphNodeV1Schema,
            GRAPH_NODE_MEDIA_TYPE,
            reader,
          );
          bytes += decoded.bytes.byteLength;
          if (bytes > limits.maximumBytes) {
            return yield* Effect.fail(resourceLimitFailure<ReadFailure>(
              "bytes",
              limits.maximumBytes,
              bytes,
            ));
          }
          const outgoing: CanonicalStrongPathEdge<DescriptorV1, EvidencePathCandidateV1>[] = [];
          if (decoded.value.dependencies !== null) {
            const step: RecordEvidencePathStepV1 = Object.freeze({
              kind: "node-dependencies",
              from: current.reference,
              relation: "niceeval.node-dependencies",
              to: decoded.value.dependencies,
            });
            outgoing.push(yield* evidencePathEdgeForReferenceV1<ReadFailure>(
              current.reference,
              step,
            ));
            pending.push({
              kind: "edge-page",
              reference: decoded.value.dependencies,
              depth: current.depth + 1,
              ancestors: Object.freeze([]),
            });
          }
          nodes.set(identity, Object.freeze({
            reference: current.reference,
            outgoing: Object.freeze(outgoing),
          }));
          break;
        }
        case "edge-page": {
          const decoded = yield* readEvidenceObjectV1(
            current.reference,
            EdgePageV1Schema,
            EDGE_PAGE_MEDIA_TYPE,
            reader,
          );
          bytes += decoded.bytes.byteLength;
          if (bytes > limits.maximumBytes) {
            return yield* Effect.fail(resourceLimitFailure<ReadFailure>(
              "bytes",
              limits.maximumBytes,
              bytes,
            ));
          }
          yield* validateEdgePageV1(decoded.value).pipe(
            Effect.mapError((failure) => protocolReadFailure<ReadFailure>(current.reference, failure)),
          );
          yield* validateStrongEdgeSequence(decoded.value.edges, decoded.value.edges).pipe(
            Effect.mapError((failure) => protocolReadFailure<ReadFailure>(current.reference, failure)),
          );
          const outgoing: CanonicalStrongPathEdge<DescriptorV1, EvidencePathCandidateV1>[] = [];
          for (let ordinal = 0; ordinal < decoded.value.edges.length; ordinal += 1) {
            const edge = decoded.value.edges[ordinal];
            if (edge === undefined) continue;
            const step: RecordEvidencePathStepV1 = Object.freeze({
              kind: "strong-edge",
              from: current.reference,
              edgeOrdinal: ordinal,
              relation: edge.relation,
              to: edge.target,
            });
            outgoing.push(yield* evidencePathEdgeForReferenceV1<ReadFailure>(
              current.reference,
              step,
            ));
            pending.push({
              kind: "graph-node",
              reference: edge.target,
              depth: current.depth + 1,
            });
          }
          for (let ordinal = 0; ordinal < decoded.value.pages.length; ordinal += 1) {
            const child = decoded.value.pages[ordinal];
            if (child === undefined) continue;
            const step: RecordEvidencePathStepV1 = Object.freeze({
              kind: "edge-page",
              from: current.reference,
              pageOrdinal: ordinal,
              relation: "niceeval.edge-page-child",
              to: child,
            });
            outgoing.push(yield* evidencePathEdgeForReferenceV1<ReadFailure>(
              current.reference,
              step,
            ));
            pending.push({
              kind: "edge-page",
              reference: child,
              depth: current.depth + 1,
              ancestors: Object.freeze([...current.ancestors, current.reference]),
            });
          }
          nodes.set(identity, Object.freeze({
            reference: current.reference,
            outgoing: Object.freeze(outgoing),
          }));
          break;
        }
      }
    }

    if (!nodes.has(descriptorKey(target))) {
      return yield* Effect.fail(targetUnreachableFailure<ReadFailure>(target));
    }
    const selected = selectCanonicalStrongPath<DescriptorV1, EvidencePathCandidateV1>(
      source.graph,
      (reference) => typedReferenceEquals(reference, target),
      {
        nodeIdentity: descriptorKey,
        outgoing: (reference) => nodes.get(descriptorKey(reference))?.outgoing ?? Object.freeze([]),
        compareStep: (left, right) => compareCanonicalBytes(left.bytes, right.bytes),
        comparePath: compareEvidencePathCandidates,
      },
      {
        maximumStates: limits.maximumPathStates,
        maximumDepth: limits.maximumDepth,
      },
    );
    switch (selected.state) {
      case "found":
        return Object.freeze(selected.path.map((candidate) => candidate.step));
      case "not-found":
        return yield* Effect.fail(targetUnreachableFailure<ReadFailure>(target));
      case "resource-limit":
        return yield* Effect.fail(resourceLimitFailure<ReadFailure>(
          selected.name,
          selected.name === "states" ? limits.maximumPathStates : limits.maximumDepth,
          selected.observed,
        ));
    }
  });
}

/**
 * Verifies every path transition against descriptor-checked archived/live graph bytes, then checks
 * the codec-derived full dependency-page sequence for every GraphNode exposed by that path.
 * The injected registry keeps unknown payload media types opaque while known payloads cannot use a
 * merely reachable—but semantically different—strong-edge chain.
 */
export function verifyRecordEvidencePathV1<ReadFailure, Requirements>(
  source: RecordGraphRefV1,
  subject: NodeRefV1,
  target: NodeRefV1,
  path: readonly RecordEvidencePathStepV1[],
  registry: RecordProtocolCodecRegistryV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: EvidencePathLimitsV1 = DEFAULT_EVIDENCE_PATH_LIMITS_V1,
): Effect.Effect<void, EvidencePathFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const limitsIssue = validatePathLimits(limits);
    if (limitsIssue !== undefined) {
      return yield* Effect.fail(pathInvalid(limitsIssue));
    }
    const first = path[0];
    if (
      first === undefined
      || first.kind !== "graph-subject"
      || !typedReferenceEquals(first.from, source.graph)
      || !typedReferenceEquals(first.to, subject)
    ) {
      return yield* Effect.fail(pathInvalid("Evidence paths must begin with source.graph to subject graph-subject"));
    }
    const firstDepth = 1;
    if (firstDepth > limits.maximumDepth) {
      return yield* Effect.fail(resourceLimitFailure<ReadFailure>(
        "depth",
        limits.maximumDepth,
        firstDepth,
      ));
    }

    const meteredReader = evidencePathMeteredReaderV1(reader, limits);
    let previous: DescriptorV1 = first.to;
    const graphNodes = new Map<string, DescriptorV1>([[descriptorKey(subject), subject]]);
    yield* verifyGraphSubjectStepV1(first, meteredReader).pipe(
      Effect.mapError(liftMeteredEvidencePathFailureV1),
    );

    for (let index = 1; index < path.length; index += 1) {
      const step = path[index];
      if (step === undefined) {
        return yield* Effect.fail(pathInvalid("Evidence path contained a missing step"));
      }
      if (step.kind === "graph-subject") {
        return yield* Effect.fail(pathInvalid("graph-subject may occur only as the first evidence path step"));
      }
      const depth = index + 1;
      if (depth > limits.maximumDepth) {
        return yield* Effect.fail(resourceLimitFailure<ReadFailure>(
          "depth",
          limits.maximumDepth,
          depth,
        ));
      }
      if (!typedReferenceEquals(previous, step.from)) {
        return yield* Effect.fail(pathInvalid("Each evidence path step must start at the previous step target"));
      }
      switch (step.kind) {
        case "node-dependencies":
          yield* verifyNodeDependenciesStepV1(step, meteredReader).pipe(
            Effect.mapError(liftMeteredEvidencePathFailureV1),
          );
          graphNodes.set(descriptorKey(step.from), step.from);
          break;
        case "edge-page":
          yield* verifyEdgePageChildStepV1(step, meteredReader).pipe(
            Effect.mapError(liftMeteredEvidencePathFailureV1),
          );
          break;
        case "strong-edge":
          yield* verifyStrongEdgeStepV1(step, meteredReader).pipe(
            Effect.mapError(liftMeteredEvidencePathFailureV1),
          );
          graphNodes.set(descriptorKey(step.to), step.to);
          break;
      }
      previous = step.to;
    }
    if (!typedReferenceEquals(previous, target)) {
      return yield* Effect.fail(pathInvalid("Evidence path final target must equal the requested target"));
    }
    for (const node of graphNodes.values()) {
      yield* verifyKnownPayloadEdgesForGraphNodeV1(node, registry, meteredReader, null).pipe(
        Effect.mapError(liftMeteredRecordGraphReadFailureV1),
      );
    }
  });
}

/**
 * Verifies the frozen absence-selector bindings that are independent of the radix/stream proof
 * traversal itself. The caller supplies the whole EvidenceRef so source equality remains checked.
 */
export function verifyEvidenceAbsenceSelectorV1(
  evidence: EvidenceRef,
): Effect.Effect<void, RecordProtocolError> {
  if (evidence.target.kind !== "absence") return Effect.void;
  const target = evidence.target;
  return Effect.gen(function* () {
    switch (target.index.kind) {
      case "entity-catalog": {
        yield* equalCanonicalJson(target.selector, target.index.selector, "Outer and entity-catalog selectors must match");
        yield* equalCanonicalJson(
          target.index.selector.value,
          target.index.nonmembership.keyPreimage,
          "Entity selector value and nonmembership key preimage must match",
        );
        if (!typedReferenceEquals(target.index.catalog, target.index.nonmembership.catalog)) {
          return yield* Effect.fail(absenceInvariant("Entity nonmembership catalog must equal the authenticated index catalog"));
        }
        if (!sameRecordGraphRef(evidence.source, target.index.nonmembership.source)) {
          return yield* Effect.fail(absenceInvariant("Entity nonmembership source must equal EvidenceRef source"));
        }
        return;
      }
      case "attempt-locator": {
        yield* equalCanonicalJson(target.selector, target.index.selector, "Outer and locator selectors must match");
        yield* equalCanonicalJson(
          target.index.selector,
          target.index.nonmembership.selector,
          "Locator index and nonmembership selectors must match",
        );
        yield* equalCanonicalJson(
          target.index.selector.value,
          Object.freeze({ locator: target.index.nonmembership.keyPreimage.locator }),
          "Locator selector value and nonmembership key preimage locator must match",
        );
        if (!typedReferenceEquals(target.index.index, target.index.nonmembership.index)) {
          return yield* Effect.fail(absenceInvariant("Locator nonmembership index must equal the authenticated index"));
        }
        if (!sameRecordGraphRef(evidence.source, target.index.nonmembership.source)) {
          return yield* Effect.fail(absenceInvariant("Locator nonmembership source must equal EvidenceRef source"));
        }
        return;
      }
      case "stream-tail": {
        yield* equalCanonicalJson(target.selector, target.index.selector, "Outer and stream-tail selectors must match");
        yield* equalCanonicalJson(
          target.index.selector,
          target.index.completePrefix.selector,
          "Stream-tail selector and complete-prefix selector must match",
        );
        yield* equalCanonicalJson(
          target.index.selector.value,
          Object.freeze({
            streamId: target.index.completePrefix.streamId,
            afterSequence: target.index.completePrefix.pinnedThroughSequence,
          }),
          "Stream-tail selector value must bind streamId and pinnedThroughSequence",
        );
        if (
          !typedReferenceEquals(target.index.index, target.index.completePrefix.index)
          || target.index.pinnedThroughSequence !== target.index.completePrefix.pinnedThroughSequence
          || !sameRecordGraphRef(evidence.source, target.index.completePrefix.source)
        ) {
          return yield* Effect.fail(absenceInvariant(
            "Stream-tail authenticated index, pinnedThroughSequence and source must equal completePrefix",
          ));
        }
        return;
      }
    }
  });
}

/**
 * One verifier invocation has one descriptor-keyed raw-object cache and one budget ledger. The
 * cache deliberately includes missing reads: a repeated lookup is not a second raw read and must
 * not consume a second object allowance. Source failures are not cached because the source owns
 * their retry semantics.
 */
function evidencePathMeteredReaderV1<ReadFailure, Requirements>(
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: EvidencePathLimitsV1,
): RecordGraphObjectReaderV1<EvidencePathMeteredReadFailureV1<ReadFailure>, Requirements> {
  const cached = new Map<string, CachedEvidencePathReadV1>();
  const observedReferences = new Set<string>();
  let observedBytes = 0;

  return Object.freeze({
    read: (reference: DescriptorV1) => {
      const key = descriptorKey(reference);
      const cachedRead = cached.get(key);
      if (cachedRead !== undefined) {
        return cachedRead.state === "present"
          ? Effect.succeed(cachedRead.bytes)
          : Effect.succeed(undefined);
      }

      const nextObjects = observedReferences.size + 1;
      if (nextObjects > limits.maximumObjects) {
        return Effect.fail(meteredReaderResourceLimitFailure<ReadFailure>(
          "objects",
          limits.maximumObjects,
          nextObjects,
        ));
      }
      observedReferences.add(key);

      return reader.read(reference).pipe(
        Effect.mapError((failure) => meteredSourceReadFailure(failure)),
        Effect.flatMap((raw) => {
          if (raw === undefined) {
            const missing: CachedEvidencePathReadV1 = Object.freeze({ state: "missing" });
            cached.set(key, missing);
            return Effect.succeed(undefined);
          }
          const nextBytes = observedBytes + raw.byteLength;
          if (!Number.isSafeInteger(nextBytes) || nextBytes > limits.maximumBytes) {
            return Effect.fail(meteredReaderResourceLimitFailure<ReadFailure>(
              "bytes",
              limits.maximumBytes,
              nextBytes,
            ));
          }
          observedBytes = nextBytes;
          const present: CachedEvidencePathReadV1 = Object.freeze({ state: "present", bytes: raw });
          cached.set(key, present);
          return Effect.succeed(raw);
        }),
      );
    },
  });
}

function liftMeteredEvidencePathFailureV1<ReadFailure>(
  failure: EvidencePathFailureV1<EvidencePathMeteredReadFailureV1<ReadFailure>>,
): EvidencePathFailureV1<ReadFailure> {
  if (failure.kind !== "read-failure") return failure;
  return liftMeteredRecordGraphReadFailureV1(failure);
}

function liftMeteredRecordGraphReadFailureV1<ReadFailure>(
  failure: RecordGraphReadFailureV1<EvidencePathMeteredReadFailureV1<ReadFailure>>,
): EvidencePathFailureV1<ReadFailure> {
  if (failure.kind !== "read-failure") return failure;
  switch (failure.failure.kind) {
    case "evidence-path-source-read-failure":
      return Object.freeze({
        kind: "read-failure",
        reference: failure.reference,
        failure: failure.failure.failure,
      });
    case "evidence-path-reader-resource-limit":
      return resourceLimitFailure<ReadFailure>(
        failure.failure.limit,
        failure.failure.maximum,
        failure.failure.observed,
      );
  }
}

function meteredSourceReadFailure<ReadFailure>(
  failure: ReadFailure,
): EvidencePathMeteredReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "evidence-path-source-read-failure", failure });
}

function meteredReaderResourceLimitFailure<ReadFailure>(
  limit: "objects" | "bytes",
  maximum: number,
  observed: number,
): EvidencePathMeteredReadFailureV1<ReadFailure> {
  return Object.freeze({
    kind: "evidence-path-reader-resource-limit",
    limit,
    maximum,
    observed,
  });
}

function readEvidenceObjectV1<Payload, Encoded, ReadFailure, Requirements>(
  reference: DescriptorV1,
  schema: Schema.Schema<Payload, Encoded, never>,
  mediaType: string,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<
  { readonly value: Payload; readonly bytes: Uint8Array },
  RecordGraphReadFailureV1<ReadFailure>,
  Requirements
> {
  return readRequiredRecordGraphObjectV1(reference, reader).pipe(
    Effect.flatMap((bytes) => decodeTypedJsonObject(schema, reference, bytes, mediaType).pipe(
      Effect.mapError((failure) => protocolReadFailure<ReadFailure>(reference, failure)),
      Effect.map((value) => Object.freeze({ value, bytes })),
    )),
  );
}

function evidencePathEdgeV1(
  step: RecordEvidencePathStepV1,
): Effect.Effect<CanonicalStrongPathEdge<DescriptorV1, EvidencePathCandidateV1>, RecordProtocolError> {
  return canonicalJsonBytes(step).pipe(
    Effect.map((bytes) => Object.freeze({
      to: step.to,
      step: Object.freeze({ step, bytes }),
    })),
  );
}

function evidencePathEdgeForReferenceV1<ReadFailure>(
  reference: DescriptorV1,
  step: RecordEvidencePathStepV1,
): Effect.Effect<CanonicalStrongPathEdge<DescriptorV1, EvidencePathCandidateV1>, RecordGraphReadFailureV1<ReadFailure>> {
  return evidencePathEdgeV1(step).pipe(
    Effect.mapError((failure) => protocolReadFailure<ReadFailure>(reference, failure)),
  );
}

function verifyGraphSubjectStepV1<ReadFailure, Requirements>(
  step: Extract<RecordEvidencePathStepV1, { readonly kind: "graph-subject" }>,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, EvidencePathFailureV1<ReadFailure>, Requirements> {
  return readEvidenceObjectV1(step.from, GraphRootV1Schema, GRAPH_ROOT_MEDIA_TYPE, reader).pipe(
    Effect.flatMap((decoded) => typedReferenceEquals(decoded.value.subject, step.to)
      ? Effect.void
      : Effect.fail(pathInvalid("graph-subject target must equal GraphRoot.subject"))),
  );
}

function verifyNodeDependenciesStepV1<ReadFailure, Requirements>(
  step: Extract<RecordEvidencePathStepV1, { readonly kind: "node-dependencies" }>,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, EvidencePathFailureV1<ReadFailure>, Requirements> {
  return readEvidenceObjectV1(step.from, GraphNodeV1Schema, GRAPH_NODE_MEDIA_TYPE, reader).pipe(
    Effect.flatMap((decoded) =>
      decoded.value.dependencies !== null && typedReferenceEquals(decoded.value.dependencies, step.to)
        ? Effect.void
        : Effect.fail(pathInvalid("node-dependencies target must equal GraphNode.dependencies"))
    ),
  );
}

function verifyEdgePageChildStepV1<ReadFailure, Requirements>(
  step: Extract<RecordEvidencePathStepV1, { readonly kind: "edge-page" }>,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, EvidencePathFailureV1<ReadFailure>, Requirements> {
  return verifyDecodedEdgePageV1(step.from, reader).pipe(
    Effect.flatMap((page) => {
      const child = page.pages[step.pageOrdinal];
      return child !== undefined && typedReferenceEquals(child, step.to)
        ? Effect.void
        : Effect.fail(pathInvalid("edge-page ordinal and target must match EdgePage.pages"));
    }),
  );
}

function verifyStrongEdgeStepV1<ReadFailure, Requirements>(
  step: Extract<RecordEvidencePathStepV1, { readonly kind: "strong-edge" }>,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<void, EvidencePathFailureV1<ReadFailure>, Requirements> {
  return verifyDecodedEdgePageV1(step.from, reader).pipe(
    Effect.flatMap((page) => {
      const edge = page.edges[step.edgeOrdinal];
      return edge !== undefined
        && edge.relation === step.relation
        && typedReferenceEquals(edge.target, step.to)
        ? Effect.void
        : Effect.fail(pathInvalid("strong-edge ordinal, relation and target must match EdgePage.edges"));
    }),
  );
}

function verifyDecodedEdgePageV1<ReadFailure, Requirements>(
  reference: EdgePageRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<
  Schema.Schema.Type<typeof EdgePageV1Schema>,
  EvidencePathFailureV1<ReadFailure>,
  Requirements
> {
  return Effect.gen(function* () {
    const decoded = yield* readEvidenceObjectV1(reference, EdgePageV1Schema, EDGE_PAGE_MEDIA_TYPE, reader);
    yield* validateEdgePageV1(decoded.value).pipe(
      Effect.mapError((failure) => protocolReadFailure<ReadFailure>(reference, failure)),
    );
    yield* validateStrongEdgeSequence(decoded.value.edges, decoded.value.edges).pipe(
      Effect.mapError((failure) => protocolReadFailure<ReadFailure>(reference, failure)),
    );
    return decoded.value;
  });
}

function compareEvidencePathCandidates(
  left: readonly EvidencePathCandidateV1[],
  right: readonly EvidencePathCandidateV1[],
): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftCandidate = left[index];
    const rightCandidate = right[index];
    if (leftCandidate === undefined || rightCandidate === undefined) continue;
    const order = compareCanonicalBytes(leftCandidate.bytes, rightCandidate.bytes);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}

function descriptorKey(reference: DescriptorV1): string {
  return `${reference.mediaType}\u0000${reference.digest}\u0000${String(reference.size)}`;
}

function validatePathLimits(limits: EvidencePathLimitsV1): string | undefined {
  for (const value of [
    limits.maximumObjects,
    limits.maximumDepth,
    limits.maximumBytes,
    limits.maximumPathStates,
  ]) {
    if (!Number.isSafeInteger(value) || value < 1) {
      return "Evidence path limits must be positive JSON-safe integers";
    }
  }
  return undefined;
}

function resourceLimitFailure<ReadFailure>(
  limit: "objects" | "depth" | "bytes" | "states",
  maximum: number,
  observed: number,
): EvidencePathFailureV1<ReadFailure> {
  return Object.freeze({ kind: "resource-limit", limit, maximum, observed });
}

function edgePageCycleFailure<ReadFailure>(page: EdgePageRefV1): EvidencePathFailureV1<ReadFailure> {
  return Object.freeze({ kind: "edge-page-cycle", page });
}

function targetUnreachableFailure<ReadFailure>(target: NodeRefV1): EvidencePathFailureV1<ReadFailure> {
  return Object.freeze({ kind: "target-unreachable", target });
}

function pathInvalid(detail: string): EvidencePathFailureV1<never> {
  return Object.freeze({ kind: "path-invalid", detail });
}

function protocolReadFailure<ReadFailure>(
  reference: DescriptorV1,
  failure: RecordProtocolError,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "protocol-failure", reference, failure });
}

function sameRecordGraphRef(left: RecordGraphRefV1, right: RecordGraphRefV1): boolean {
  return left.recordId === right.recordId && typedReferenceEquals(left.graph, right.graph);
}

function absenceInvariant(message: string): RecordProtocolError {
  return recordProtocolError({
    code: "payload-invariant-invalid",
    operation: "verify-evidence-absence-selector",
    message,
  });
}

function equalCanonicalJson(
  left: unknown,
  right: unknown,
  message: string,
): Effect.Effect<void, RecordProtocolError> {
  return Effect.gen(function* () {
    const leftBytes = yield* canonicalJsonBytes(left);
    const rightBytes = yield* canonicalJsonBytes(right);
    if (compareCanonicalBytes(leftBytes, rightBytes) !== 0) {
      return yield* Effect.fail(absenceInvariant(message));
    }
  });
}
