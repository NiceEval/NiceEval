import { Effect } from "effect";
import {
  EDGE_PAGE_MEDIA_TYPE,
  EdgePageRefV1Schema,
  EdgePageV1Schema,
  GRAPH_NODE_MEDIA_TYPE,
  GraphNodeV1Schema,
  NodeRefV1Schema,
  STRONG_EDGE_PAGE_ENTRIES,
  decodeProtocolSchema,
  encodeTypedJsonObject,
  validateStrongEdgeSequence,
  type DescriptorV1,
  type EdgePageRefV1,
  type GraphNodeV1,
  type NodeRefV1,
  type RecordProtocolError,
  type StrongEdgeV1,
} from "../protocol/core.ts";
import { recordProtocolError } from "../protocol/errors.ts";
import {
  materializeStrongEdgePages,
  type StrongEdgeSequenceProtocol,
} from "./edge-pages.ts";

/** A deterministic encoded object ready for a Store boundary; graph itself never writes it. */
export interface RecordGraphEncodedObjectV1 {
  readonly descriptor: DescriptorV1;
  readonly bytes: Uint8Array;
}

export interface EncodedGraphNodeV1 {
  readonly node: NodeRefV1;
  readonly objects: readonly RecordGraphEncodedObjectV1[];
}

const ALREADY_VALIDATED_STRONG_EDGE_SEQUENCE: StrongEdgeSequenceProtocol<
  StrongEdgeV1,
  RecordProtocolError
> = Object.freeze({
  validate: validatedStrongEdgeSequence,
});

/**
 * Wraps one already encoded payload in its canonical GraphNode and dependency-page chain.
 * The edge sequence remains caller-owned so protocol's payload-specific matrix is the only source
 * of relation and ordinal semantics.
 */
export function encodeGraphNodeWithStrongEdgesV1(
  payload: RecordGraphEncodedObjectV1,
  edges: readonly StrongEdgeV1[],
): Effect.Effect<EncodedGraphNodeV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const canonicalEdges = yield* validateStrongEdgeSequence(edges, edges);
    const pageObjects: RecordGraphEncodedObjectV1[] = [];
    const pageResult = yield* materializeStrongEdgePages<
      StrongEdgeV1,
      EdgePageRefV1,
      RecordProtocolError,
      never
    >(
      canonicalEdges,
      STRONG_EDGE_PAGE_ENTRIES,
      ALREADY_VALIDATED_STRONG_EDGE_SEQUENCE,
      {
        page: (input) => encodeDependencyEdgePage(input.edges, input.next, pageObjects),
      },
    );
    if (pageResult.state === "invalid") {
      return yield* Effect.fail(pageResult.failure);
    }
    if (pageResult.state === "invalid-page-size") {
      return yield* Effect.fail(recordProtocolError({
        code: "edge-contract-invalid",
        operation: "encode-graph-node",
        message: "The frozen strong-edge page size must be a positive integer",
      }));
    }

    const encoded = yield* encodeTypedJsonObject(
      GraphNodeV1Schema,
      GRAPH_NODE_MEDIA_TYPE,
      {
        schema: "niceeval.graph-node/1",
        payload: payload.descriptor,
        dependencies: pageResult.first,
      },
    );
    const node = yield* decodeProtocolSchema(
      NodeRefV1Schema,
      encoded.descriptor,
      "encode-graph-node-ref",
    );
    return Object.freeze({
      node,
      objects: Object.freeze([
        ...pageObjects,
        Object.freeze({ descriptor: encoded.descriptor, bytes: encoded.bytes }),
      ]),
    });
  });
}

function validatedStrongEdgeSequence(
  _edges: readonly StrongEdgeV1[],
): { readonly state: "valid" } {
  return { state: "valid" };
}

function encodeDependencyEdgePage(
  edges: readonly StrongEdgeV1[],
  next: EdgePageRefV1 | null,
  pageObjects: RecordGraphEncodedObjectV1[],
): Effect.Effect<EdgePageRefV1, RecordProtocolError> {
  return Effect.gen(function* () {
    const encoded = yield* encodeTypedJsonObject(
      EdgePageV1Schema,
      EDGE_PAGE_MEDIA_TYPE,
      {
        schema: "niceeval.edge-page/1",
        edges,
        pages: next === null ? [] : [next],
      },
    );
    const page = yield* decodeProtocolSchema(
      EdgePageRefV1Schema,
      encoded.descriptor,
      "encode-dependency-edge-page-ref",
    );
    pageObjects.push(Object.freeze({ descriptor: encoded.descriptor, bytes: encoded.bytes }));
    return page;
  });
}

/** Retains the schema type in the exported surface without copying GraphNodeV1's core shape. */
export type { GraphNodeV1 };
