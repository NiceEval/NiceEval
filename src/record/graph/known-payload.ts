import { Effect } from "effect";
import {
  GRAPH_NODE_MEDIA_TYPE,
  GraphNodeV1Schema,
  type DescriptorV1,
} from "../protocol/core.ts";
import type { RecordProtocolCodecRegistryV1 } from "../protocol/codecs.ts";
import type { RecordProtocolError } from "../protocol/errors.ts";
import type {
  DependencyStrongEdgeReadLimitsV1,
  RecordGraphObjectReaderV1,
  RecordGraphReadFailureV1,
} from "./read.ts";
import {
  DEFAULT_DEPENDENCY_STRONG_EDGE_READ_LIMITS_V1,
  readRequiredRecordGraphObjectV1,
  readTypedRecordGraphObjectV1,
  verifyKnownNodeStrongEdgesV1,
} from "./read.ts";

/**
 * A codec-aware verification outcome. Unknown payloads remain deliberately opaque: descriptor
 * integrity is checked, but no parser-derived dependency contract is invented for them.
 */
export type KnownPayloadEdgeVerificationV1 =
  | { readonly state: "opaque"; readonly payload: DescriptorV1 }
  | {
      readonly state: "known";
      readonly payload: DescriptorV1;
      readonly strongEdgeCount: number;
    };

export type KnownPayloadEdgeVerificationFailureV1<ReadFailure> =
  RecordGraphReadFailureV1<ReadFailure>;

/**
 * Decodes one GraphNode through the protocol codec registry and, for known media types, compares
 * its codec-derived ordered strong edges with the full canonical dependency-page chain.
 *
 * A concrete commit/verifier calls this after discovering a GraphNode via the core closure. This
 * is intentionally separate from the opaque frozen-core walker so extension payloads remain
 * traversable without forcing a payload parser. Pass `null` for `limits` only when `reader`
 * already enforces one finite verification-wide descriptor and byte budget.
 */
export function verifyKnownPayloadEdgesForGraphNodeV1<ReadFailure, Requirements>(
  reference: DescriptorV1,
  registry: RecordProtocolCodecRegistryV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: DependencyStrongEdgeReadLimitsV1 | null = DEFAULT_DEPENDENCY_STRONG_EDGE_READ_LIMITS_V1,
): Effect.Effect<
  KnownPayloadEdgeVerificationV1,
  KnownPayloadEdgeVerificationFailureV1<ReadFailure>,
  Requirements
> {
  return Effect.gen(function* () {
    const node = yield* readTypedRecordGraphObjectV1(
      reference,
      GraphNodeV1Schema,
      GRAPH_NODE_MEDIA_TYPE,
      reader,
    );
    const payloadBytes = yield* readRequiredRecordGraphObjectV1(node.payload, reader);
    const decoded = yield* registry.decodeTypedObject(node.payload, payloadBytes).pipe(
      Effect.mapError((failure) => protocolReadFailure<ReadFailure>(node.payload, failure)),
    );
    if (decoded.state === "opaque") {
      return Object.freeze({ state: "opaque", payload: node.payload });
    }
    yield* verifyKnownNodeStrongEdgesV1(node, decoded.strongEdges, reader, limits);
    return Object.freeze({
      state: "known",
      payload: node.payload,
      strongEdgeCount: decoded.strongEdges.length,
    });
  });
}

function protocolReadFailure<ReadFailure>(
  reference: DescriptorV1,
  failure: RecordProtocolError,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "protocol-failure", reference, failure });
}
