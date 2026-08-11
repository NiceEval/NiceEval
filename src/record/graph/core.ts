import { Effect } from "effect";
import {
  EDGE_PAGE_MEDIA_TYPE,
  EdgePageV1Schema,
  GRAPH_NODE_MEDIA_TYPE,
  GraphNodeV1Schema,
  GRAPH_ROOT_MEDIA_TYPE,
  GraphRootV1Schema,
  decodeTypedJsonObject,
  validateStrongEdgeSequence,
  verifyTypedObjectDescriptor,
  type DescriptorV1,
  type RecordProtocolError,
} from "../protocol/core.ts";
import { recordProtocolError } from "../protocol/errors.ts";
import type {
  StrongClosureInspection,
  StrongClosureProtocol,
  StrongClosureStep,
} from "./traversal.ts";

/** Expected core role is carried separately from a descriptor so type mismatches stay observable. */
export type RecordGraphCoreExpectationV1 =
  | { readonly kind: "graph-root" }
  | { readonly kind: "graph-node" }
  | {
      readonly kind: "edge-page";
      /** Only this dependency chain's ancestors: global sharing is still legal. */
      readonly ancestors: readonly DescriptorV1[];
    }
  | { readonly kind: "payload" };

export type RecordGraphCoreStrongClosureProtocolV1 = StrongClosureProtocol<
  DescriptorV1,
  RecordGraphCoreExpectationV1,
  RecordProtocolError,
  never
>;

const GRAPH_ROOT_EXPECTATION: RecordGraphCoreExpectationV1 = Object.freeze({ kind: "graph-root" });
const GRAPH_NODE_EXPECTATION: RecordGraphCoreExpectationV1 = Object.freeze({ kind: "graph-node" });
const EDGE_PAGE_EXPECTATION: RecordGraphCoreExpectationV1 = Object.freeze({
  kind: "edge-page",
  ancestors: Object.freeze([]),
});
const PAYLOAD_EXPECTATION: RecordGraphCoreExpectationV1 = Object.freeze({ kind: "payload" });

/** Public construction helper so every walker, mirror and GC user shares core decoding semantics. */
export function recordGraphCoreStrongClosureProtocolV1(): RecordGraphCoreStrongClosureProtocolV1 {
  return Object.freeze({
    referenceKey: typedReferenceKey,
    inspect: inspectRecordGraphCoreObject,
    onRevisit: recordGraphCoreRevisitV1,
  });
}

export function graphRootClosureStepV1(reference: DescriptorV1): StrongClosureStep<
  DescriptorV1,
  RecordGraphCoreExpectationV1
> {
  return Object.freeze({ reference, expected: GRAPH_ROOT_EXPECTATION });
}

/** Creates an EdgePage closure step while retaining only that dependency chain's ancestors. */
export function edgePageClosureStepV1(
  reference: DescriptorV1,
  ancestors: readonly DescriptorV1[] = Object.freeze([]),
): StrongClosureStep<DescriptorV1, RecordGraphCoreExpectationV1> {
  return step(reference, edgePageExpectation(ancestors));
}

function inspectRecordGraphCoreObject(
  reference: DescriptorV1,
  expected: RecordGraphCoreExpectationV1,
  bytes: Uint8Array,
): Effect.Effect<
  StrongClosureInspection<DescriptorV1, RecordGraphCoreExpectationV1, RecordProtocolError>,
  RecordProtocolError
> {
  switch (expected.kind) {
    case "graph-root":
      return decodeTypedJsonObject(
        GraphRootV1Schema,
        reference,
        bytes,
        GRAPH_ROOT_MEDIA_TYPE,
      ).pipe(
        Effect.map((root) => validInspection([
          step(root.subject, GRAPH_NODE_EXPECTATION),
        ])),
      );
    case "graph-node":
      return decodeTypedJsonObject(
        GraphNodeV1Schema,
        reference,
        bytes,
        GRAPH_NODE_MEDIA_TYPE,
      ).pipe(
        Effect.map((node) => {
          const next: StrongClosureStep<DescriptorV1, RecordGraphCoreExpectationV1>[] = [
            step(node.payload, PAYLOAD_EXPECTATION),
          ];
          if (node.dependencies !== null) {
            next.push(step(node.dependencies, EDGE_PAGE_EXPECTATION));
          }
          return validInspection(next);
        }),
      );
    case "edge-page":
      return decodeTypedJsonObject(
        EdgePageV1Schema,
        reference,
        bytes,
        EDGE_PAGE_MEDIA_TYPE,
      ).pipe(
        Effect.flatMap((page) =>
          validateStrongEdgeSequence(page.edges, page.edges).pipe(
            Effect.flatMap(() => validateDependencyPageShape(page.edges.length, page.pages.length)),
            Effect.map(() => {
              const next: StrongClosureStep<DescriptorV1, RecordGraphCoreExpectationV1>[] = [];
              for (const edge of page.edges) {
                next.push(step(edge.target, GRAPH_NODE_EXPECTATION));
              }
              for (const child of page.pages) {
                next.push(step(child, edgePageExpectation([
                  ...expected.ancestors,
                  reference,
                ])));
              }
              return validInspection(next);
            }),
          )
        ),
      );
    case "payload":
      return verifyTypedObjectDescriptor(reference, bytes).pipe(
        Effect.map(() => validInspection([])),
      );
  }
}

/**
 * A page reused by separate GraphNodes is a normal immutable DAG edge. Only an attempt to revisit
 * a page already present in this exact `pages[0]` chain is a forbidden dependency-page cycle.
 */
export function recordGraphCoreRevisitV1(
  reference: DescriptorV1,
  expected: RecordGraphCoreExpectationV1,
): RecordProtocolError | undefined {
  if (expected.kind !== "edge-page") return undefined;
  if (!expected.ancestors.some((ancestor) => typedReferenceKey(ancestor) === typedReferenceKey(reference))) {
    return undefined;
  }
  return recordProtocolError({
    code: "edge-contract-invalid",
    operation: "verify-dependency-edge-page",
    message: "Dependency EdgePage successor chains must not contain cycles",
  });
}

function validateDependencyPageShape(
  edgeCount: number,
  childPageCount: number,
): Effect.Effect<void, RecordProtocolError> {
  if (childPageCount === 0 && edgeCount >= 1 && edgeCount <= 128) {
    return Effect.void;
  }
  if (childPageCount === 1 && edgeCount === 128) {
    return Effect.void;
  }
  return Effect.fail(recordProtocolError({
    code: "edge-contract-invalid",
    operation: "verify-dependency-edge-page",
    message: "Dependency edge pages must be non-empty; non-final pages must contain 128 edges and one child",
  }));
}

function validInspection(
  next: readonly StrongClosureStep<DescriptorV1, RecordGraphCoreExpectationV1>[],
): StrongClosureInspection<DescriptorV1, RecordGraphCoreExpectationV1, RecordProtocolError> {
  return Object.freeze({ state: "valid", next: Object.freeze([...next]) });
}

function step(
  reference: DescriptorV1,
  expected: RecordGraphCoreExpectationV1,
): StrongClosureStep<DescriptorV1, RecordGraphCoreExpectationV1> {
  return Object.freeze({ reference, expected });
}

function edgePageExpectation(
  ancestors: readonly DescriptorV1[],
): RecordGraphCoreExpectationV1 {
  return Object.freeze({
    kind: "edge-page",
    ancestors: Object.freeze([...ancestors]),
  });
}

/**
 * The codec has already parsed a valid descriptor. This tuple uses every typed-reference field and
 * NUL cannot occur in any v1 media type or digest, so two different typed references never merge.
 */
function typedReferenceKey(reference: DescriptorV1): string {
  return `${reference.mediaType}\u0000${reference.digest}\u0000${String(reference.size)}`;
}
