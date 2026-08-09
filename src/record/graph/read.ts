import { Either, Effect, Schema } from "effect";
import {
  EDGE_PAGE_MEDIA_TYPE,
  EdgePageV1Schema,
  GRAPH_NODE_MEDIA_TYPE,
  GraphNodeV1Schema,
  STRONG_EDGE_PAGE_ENTRIES,
  decodeTypedJsonObject,
  validateStrongEdgeSequence,
  type DescriptorV1,
  type EdgePageRefV1,
  type EdgePageV1,
  type GraphNodeV1,
  type NodeRefV1,
  type StrongEdgeV1,
} from "../protocol/core.ts";
import type { RecordProtocolError } from "../protocol/errors.ts";

/** All object access stays injected; this layer neither discovers paths nor touches a Store. */
export interface RecordGraphObjectReaderV1<ReadFailure, Requirements> {
  readonly read: (
    reference: DescriptorV1,
  ) => Effect.Effect<Uint8Array | undefined, ReadFailure, Requirements>;
}

export type RecordGraphReadFailureV1<ReadFailure> =
  | { readonly kind: "missing-object"; readonly reference: DescriptorV1 }
  | {
      readonly kind: "read-failure";
      readonly reference: DescriptorV1;
      readonly failure: ReadFailure;
    }
  | {
      readonly kind: "protocol-failure";
      readonly reference: DescriptorV1;
      readonly failure: RecordProtocolError;
    }
  | { readonly kind: "dependency-page-cycle"; readonly page: EdgePageRefV1 }
  | {
      readonly kind: "dependency-page-shape";
      readonly page: EdgePageRefV1;
      readonly detail: string;
    }
  | {
      readonly kind: "dependency-page-resource-limit";
      readonly limit: "objects" | "bytes";
      readonly maximum: number;
      readonly observed: number;
    }
  | { readonly kind: "dependency-page-invalid-limits"; readonly detail: string }
  | { readonly kind: "edge-contract-invalid"; readonly failure: RecordProtocolError };

export interface DecodedGraphNodePayloadV1<Payload> {
  readonly node: GraphNodeV1;
  readonly payload: Payload;
}

/** Limits for one flattened dependency-page chain, independent of Store I/O policy. */
export interface DependencyStrongEdgeReadLimitsV1 {
  readonly maximumObjects: number;
  readonly maximumBytes: number;
}

export const DEFAULT_DEPENDENCY_STRONG_EDGE_READ_LIMITS_V1: DependencyStrongEdgeReadLimitsV1 = Object.freeze({
  maximumObjects: 4_096,
  maximumBytes: 64 * 1024 * 1024,
});

/** Reads a required raw object and keeps absence distinct from backend failures. */
export function readRequiredRecordGraphObjectV1<ReadFailure, Requirements>(
  reference: DescriptorV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<Uint8Array, RecordGraphReadFailureV1<ReadFailure>, Requirements> {
  return Effect.gen(function* () {
    const loaded: Either.Either<Uint8Array | undefined, ReadFailure> = yield* Effect.either(
      reader.read(reference),
    );
    if (Either.isLeft(loaded)) {
      return yield* Effect.fail(readFailure<ReadFailure>(reference, loaded.left));
    }
    if (loaded.right === undefined) {
      return yield* Effect.fail(missingObjectFailure<ReadFailure>(reference));
    }
    return loaded.right;
  });
}

/** Decodes a typed object only after its raw bytes have passed descriptor verification. */
export function readTypedRecordGraphObjectV1<Payload, Encoded, SchemaRequirements, ReadFailure, Requirements>(
  reference: DescriptorV1,
  schema: Schema.Schema<Payload, Encoded, SchemaRequirements>,
  expectedMediaType: string,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<
  Payload,
  RecordGraphReadFailureV1<ReadFailure>,
  Requirements | SchemaRequirements
> {
  return readRequiredRecordGraphObjectV1<ReadFailure, Requirements>(reference, reader).pipe(
    Effect.flatMap((bytes) =>
      decodeTypedJsonObject(schema, reference, bytes, expectedMediaType).pipe(
        Effect.mapError((failure) => protocolReadFailure<ReadFailure>(reference, failure)),
      )
    ),
  );
}

/** Reads the GraphNode wrapper, then its payload with a protocol-owned schema and media type. */
export function readGraphNodePayloadV1<Payload, Encoded, SchemaRequirements, ReadFailure, Requirements>(
  reference: NodeRefV1,
  payloadSchema: Schema.Schema<Payload, Encoded, SchemaRequirements>,
  payloadMediaType: string,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): Effect.Effect<
  DecodedGraphNodePayloadV1<Payload>,
  RecordGraphReadFailureV1<ReadFailure>,
  Requirements | SchemaRequirements
> {
  return readTypedRecordGraphObjectV1<
    GraphNodeV1,
    Schema.Schema.Encoded<typeof GraphNodeV1Schema>,
    never,
    ReadFailure,
    Requirements
  >(
    reference,
    GraphNodeV1Schema,
    GRAPH_NODE_MEDIA_TYPE,
    reader,
  ).pipe(
    Effect.flatMap((node) =>
      readTypedRecordGraphObjectV1<
        Payload,
        Encoded,
        SchemaRequirements,
        ReadFailure,
        Requirements
      >(
        node.payload,
        payloadSchema,
        payloadMediaType,
        reader,
      ).pipe(
        Effect.map((payload) => Object.freeze({ node, payload })),
      )
    ),
  );
}

/**
 * Flattens and validates the one-child dependency EdgePage chain.
 *
 * `null` is reserved for a caller whose reader already enforces one shared, finite budget across
 * the entire verification. Ordinary callers omit this argument and receive the local default.
 */
export function readDependencyStrongEdgesV1<ReadFailure, Requirements>(
  first: EdgePageRefV1 | null,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: DependencyStrongEdgeReadLimitsV1 | null = DEFAULT_DEPENDENCY_STRONG_EDGE_READ_LIMITS_V1,
): Effect.Effect<readonly StrongEdgeV1[], RecordGraphReadFailureV1<ReadFailure>, Requirements> {
  if (first === null) return Effect.succeed(Object.freeze([]));

  return Effect.gen(function* () {
    if (limits !== null) {
      const limitsIssue = validateDependencyStrongEdgeReadLimits(limits);
      if (limitsIssue !== undefined) {
        return yield* Effect.fail(invalidDependencyPageLimitsFailure<ReadFailure>(limitsIssue));
      }
    }
    const edges: StrongEdgeV1[] = [];
    const seen = new Set<string>();
    let current: EdgePageRefV1 | null = first;
    let bytes = 0;
    while (current !== null) {
      const pageReference: EdgePageRefV1 = current;
      const identity = typedReferenceKey(pageReference);
      if (seen.has(identity)) {
        return yield* Effect.fail(dependencyPageCycleFailure<ReadFailure>(pageReference));
      }
      seen.add(identity);

      if (limits !== null && seen.size > limits.maximumObjects) {
        return yield* Effect.fail(dependencyPageResourceLimitFailure<ReadFailure>(
          "objects",
          limits.maximumObjects,
          seen.size,
        ));
      }

      const raw = yield* readRequiredRecordGraphObjectV1(pageReference, reader);
      bytes += raw.byteLength;
      if (limits !== null && bytes > limits.maximumBytes) {
        return yield* Effect.fail(dependencyPageResourceLimitFailure<ReadFailure>(
          "bytes",
          limits.maximumBytes,
          bytes,
        ));
      }
      const page: EdgePageV1 = yield* decodeTypedJsonObject(
        EdgePageV1Schema,
        pageReference,
        raw,
        EDGE_PAGE_MEDIA_TYPE,
      ).pipe(
        Effect.mapError((failure) => protocolReadFailure<ReadFailure>(pageReference, failure)),
      );
      const finalPage = page.pages.length === 0;
      if (
        finalPage
          ? page.edges.length < 1 || page.edges.length > STRONG_EDGE_PAGE_ENTRIES
          : page.edges.length !== STRONG_EDGE_PAGE_ENTRIES || page.pages.length !== 1
      ) {
        return yield* Effect.fail(dependencyPageShapeFailure<ReadFailure>(
          pageReference,
          finalPage
            ? "The final dependency page must contain 1..128 edges and no child pages"
            : "A non-final dependency page must contain 128 edges and exactly one child page",
        ));
      }
      edges.push(...page.edges);
      if (finalPage) {
        current = null;
      } else {
        const next = page.pages[0];
        if (next === undefined) {
          return yield* Effect.fail(dependencyPageShapeFailure<ReadFailure>(
            pageReference,
            "A non-final dependency page must have exactly one child page",
          ));
        }
        current = next;
      }
    }
    return Object.freeze(edges);
  });
}

/** Compares flattened pages with an owner-derived protocol edge sequence. */
export function verifyKnownNodeStrongEdgesV1<ReadFailure, Requirements>(
  node: GraphNodeV1,
  expected: readonly StrongEdgeV1[],
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: DependencyStrongEdgeReadLimitsV1 | null = DEFAULT_DEPENDENCY_STRONG_EDGE_READ_LIMITS_V1,
): Effect.Effect<readonly StrongEdgeV1[], RecordGraphReadFailureV1<ReadFailure>, Requirements> {
  return readDependencyStrongEdgesV1<ReadFailure, Requirements>(node.dependencies, reader, limits).pipe(
    Effect.flatMap((actual) =>
      validateStrongEdgeSequence(expected, actual).pipe(
        Effect.mapError(edgeContractFailure<ReadFailure>),
        Effect.map(() => actual),
      )
    ),
  );
}

function typedReferenceKey(reference: DescriptorV1): string {
  return `${reference.mediaType}\u0000${reference.digest}\u0000${String(reference.size)}`;
}

function protocolReadFailure<ReadFailure>(
  reference: DescriptorV1,
  failure: RecordProtocolError,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "protocol-failure", reference, failure });
}

function readFailure<ReadFailure>(
  reference: DescriptorV1,
  failure: ReadFailure,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "read-failure", reference, failure });
}

function missingObjectFailure<ReadFailure>(
  reference: DescriptorV1,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "missing-object", reference });
}

function dependencyPageCycleFailure<ReadFailure>(
  page: EdgePageRefV1,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "dependency-page-cycle", page });
}

function dependencyPageShapeFailure<ReadFailure>(
  page: EdgePageRefV1,
  detail: string,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "dependency-page-shape", page, detail });
}

function dependencyPageResourceLimitFailure<ReadFailure>(
  limit: "objects" | "bytes",
  maximum: number,
  observed: number,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "dependency-page-resource-limit", limit, maximum, observed });
}

function invalidDependencyPageLimitsFailure<ReadFailure>(
  detail: string,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "dependency-page-invalid-limits", detail });
}

function edgeContractFailure<ReadFailure>(
  failure: RecordProtocolError,
): RecordGraphReadFailureV1<ReadFailure> {
  return Object.freeze({ kind: "edge-contract-invalid", failure });
}

function validateDependencyStrongEdgeReadLimits(
  limits: DependencyStrongEdgeReadLimitsV1,
): string | undefined {
  if (!Number.isSafeInteger(limits.maximumObjects) || limits.maximumObjects < 1) {
    return "maximumObjects must be a positive JSON-safe integer";
  }
  if (!Number.isSafeInteger(limits.maximumBytes) || limits.maximumBytes < 1) {
    return "maximumBytes must be a positive JSON-safe integer";
  }
  return undefined;
}
