import { createHash } from "node:crypto";
import { Effect, Schema } from "effect";
import {
  canonicalJsonBytes,
  compareCanonicalBytes,
  decodeCanonicalJsonBytes,
} from "./canonical.ts";
import {
  recordProtocolError,
  type RecordProtocolError,
} from "./errors.ts";

export type { RecordProtocolError } from "./errors.ts";

export const RECORD_FILE_MAX_BYTES: 16777216 = 16_777_216;
export const STRONG_EDGE_PAGE_ENTRIES: 128 = 128;

export const GRAPH_NODE_MEDIA_TYPE: "application/vnd.niceeval.graph-node.v1+jcs" =
  "application/vnd.niceeval.graph-node.v1+jcs";
export const EDGE_PAGE_MEDIA_TYPE: "application/vnd.niceeval.edge-page.v1+jcs" =
  "application/vnd.niceeval.edge-page.v1+jcs";
export const GRAPH_ROOT_MEDIA_TYPE: "application/vnd.niceeval.graph-root.v1+jcs" =
  "application/vnd.niceeval.graph-root.v1+jcs";
export const COMMITTED_ROOT_PAGE_MEDIA_TYPE: "application/vnd.niceeval.committed-root-page.v1+jcs" =
  "application/vnd.niceeval.committed-root-page.v1+jcs";

const MEDIA_TYPE_TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const MEDIA_TYPE_QUOTED = '"(?:[\\t !#-\\[\\]-~]|\\\\[\\t -~])*"';
const MEDIA_TYPE_PATTERN = new RegExp(
  `^${MEDIA_TYPE_TOKEN}/${MEDIA_TYPE_TOKEN}(?:;${MEDIA_TYPE_TOKEN}=(?:${MEDIA_TYPE_TOKEN}|${MEDIA_TYPE_QUOTED}))*$`,
);
const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const RADIX_PATH_PATTERN = /^[0-9a-f]{0,64}$/;

export const MediaTypeV1Schema = Schema.String.pipe(
  Schema.filter((value) => MEDIA_TYPE_PATTERN.test(value), {
    identifier: "MediaTypeV1",
    description: "a canonical RFC media type without separator whitespace",
  }),
);

export const DigestV1Schema = Schema.String.pipe(
  Schema.filter((value) => SHA256_DIGEST_PATTERN.test(value), {
    identifier: "DigestV1",
    description: "sha256 followed by exactly 64 lowercase hexadecimal digits",
  }),
  Schema.brand("niceeval.DigestV1"),
);

export type DigestV1 = Schema.Schema.Type<typeof DigestV1Schema>;

export const JsonSafeUnsignedIntegerSchema = Schema.Number.pipe(
  Schema.filter(
    (value) => Number.isSafeInteger(value) && value >= 0,
    {
      identifier: "JsonSafeUnsignedInteger",
      description: "a non-negative JSON safe integer",
    },
  ),
);

export const JsonSafePositiveIntegerSchema = Schema.Number.pipe(
  Schema.filter(
    (value) => Number.isSafeInteger(value) && value > 0,
    {
      identifier: "JsonSafePositiveInteger",
      description: "a positive JSON safe integer",
    },
  ),
);

export const ByteLengthV1Schema = JsonSafeUnsignedIntegerSchema.pipe(
  Schema.filter((value) => value <= RECORD_FILE_MAX_BYTES, {
    identifier: "ByteLengthV1",
    description: `an object byte length no greater than ${RECORD_FILE_MAX_BYTES}`,
  }),
);

export type ByteLengthV1 = Schema.Schema.Type<typeof ByteLengthV1Schema>;

export const RadixNibbleV1Schema = Schema.Literal(
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "a",
  "b",
  "c",
  "d",
  "e",
  "f",
);

export type RadixNibbleV1 = Schema.Schema.Type<typeof RadixNibbleV1Schema>;

export const RadixPathV1Schema = Schema.String.pipe(
  Schema.filter((value) => RADIX_PATH_PATTERN.test(value), {
    identifier: "RadixPathV1",
    description: "zero to 64 lowercase hexadecimal nibbles",
  }),
  Schema.brand("niceeval.RadixPathV1"),
);

export type RadixPathV1 = Schema.Schema.Type<typeof RadixPathV1Schema>;

export const NonEmptyProtocolStringSchema = Schema.String.pipe(
  Schema.filter((value) => value.length > 0 && !value.includes("\u0000"), {
    identifier: "NonEmptyProtocolString",
    description: "a non-empty string without NUL",
  }),
);

export const DescriptorV1Schema = Schema.Struct({
  mediaType: MediaTypeV1Schema,
  digest: DigestV1Schema,
  size: ByteLengthV1Schema,
});

export type DescriptorV1 = Schema.Schema.Type<typeof DescriptorV1Schema>;
export const TypedObjectDescriptorV1Schema = DescriptorV1Schema;
export type TypedObjectDescriptorV1 = DescriptorV1;
export const TypedObjectDescriptorSchema = DescriptorV1Schema;
export type TypedObjectDescriptor = DescriptorV1;
export type MediaTypeV1 = Schema.Schema.Type<typeof MediaTypeV1Schema>;

function isNodeRefDescriptor(
  descriptor: DescriptorV1,
): descriptor is DescriptorV1 & { readonly mediaType: typeof GRAPH_NODE_MEDIA_TYPE } {
  return descriptor.mediaType === GRAPH_NODE_MEDIA_TYPE;
}

function isEdgePageRefDescriptor(
  descriptor: DescriptorV1,
): descriptor is DescriptorV1 & { readonly mediaType: typeof EDGE_PAGE_MEDIA_TYPE } {
  return descriptor.mediaType === EDGE_PAGE_MEDIA_TYPE;
}

function isGraphRootRefDescriptor(
  descriptor: DescriptorV1,
): descriptor is DescriptorV1 & { readonly mediaType: typeof GRAPH_ROOT_MEDIA_TYPE } {
  return descriptor.mediaType === GRAPH_ROOT_MEDIA_TYPE;
}

function isCommittedRootPageRefDescriptor(
  descriptor: DescriptorV1,
): descriptor is DescriptorV1 & { readonly mediaType: typeof COMMITTED_ROOT_PAGE_MEDIA_TYPE } {
  return descriptor.mediaType === COMMITTED_ROOT_PAGE_MEDIA_TYPE;
}

export const NodeRefV1Schema = DescriptorV1Schema.pipe(
  Schema.filter(isNodeRefDescriptor, {
    identifier: "NodeRefV1",
    description: `a descriptor with media type ${GRAPH_NODE_MEDIA_TYPE}`,
  }),
  Schema.brand("niceeval.NodeRefV1"),
);

export type NodeRefV1 = Schema.Schema.Type<typeof NodeRefV1Schema>;

export const EdgePageRefV1Schema = DescriptorV1Schema.pipe(
  Schema.filter(isEdgePageRefDescriptor, {
    identifier: "EdgePageRefV1",
    description: `a descriptor with media type ${EDGE_PAGE_MEDIA_TYPE}`,
  }),
  Schema.brand("niceeval.EdgePageRefV1"),
);

export type EdgePageRefV1 = Schema.Schema.Type<typeof EdgePageRefV1Schema>;

export const GraphRootRefV1Schema = DescriptorV1Schema.pipe(
  Schema.filter(isGraphRootRefDescriptor, {
    identifier: "GraphRootRefV1",
    description: `a descriptor with media type ${GRAPH_ROOT_MEDIA_TYPE}`,
  }),
  Schema.brand("niceeval.GraphRootRefV1"),
);

export type GraphRootRefV1 = Schema.Schema.Type<typeof GraphRootRefV1Schema>;

export const CommittedRootPageRefV1Schema = DescriptorV1Schema.pipe(
  Schema.filter(isCommittedRootPageRefDescriptor, {
    identifier: "CommittedRootPageRefV1",
    description: `a descriptor with media type ${COMMITTED_ROOT_PAGE_MEDIA_TYPE}`,
  }),
  Schema.brand("niceeval.CommittedRootPageRefV1"),
);

export type CommittedRootPageRefV1 = Schema.Schema.Type<
  typeof CommittedRootPageRefV1Schema
>;

export const StrongEdgeV1Schema = Schema.Struct({
  relation: NonEmptyProtocolStringSchema,
  target: NodeRefV1Schema,
});

export type StrongEdgeV1 = Schema.Schema.Type<typeof StrongEdgeV1Schema>;

export const EdgePageV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.edge-page/1"),
  edges: Schema.Array(StrongEdgeV1Schema),
  pages: Schema.Array(EdgePageRefV1Schema),
});

export type EdgePageV1 = Schema.Schema.Type<typeof EdgePageV1Schema>;

export const GraphNodeV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.graph-node/1"),
  payload: DescriptorV1Schema,
  dependencies: Schema.NullOr(EdgePageRefV1Schema),
});

export type GraphNodeV1 = Schema.Schema.Type<typeof GraphNodeV1Schema>;

export const GraphRootV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.graph-root/1"),
  subject: NodeRefV1Schema,
});

export type GraphRootV1 = Schema.Schema.Type<typeof GraphRootV1Schema>;

export const StoreFormatMarkerV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.record-store-marker/1"),
  format: Schema.Literal("niceeval.record-store"),
  version: Schema.Literal(1),
});

export type StoreFormatMarkerV1 = Schema.Schema.Type<
  typeof StoreFormatMarkerV1Schema
>;

export const CommittedRootKeyV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.committed-root-key/1"),
  graph: GraphRootRefV1Schema,
});

export type CommittedRootKeyV1 = Schema.Schema.Type<
  typeof CommittedRootKeyV1Schema
>;

const CommittedRootBranchChildV1Schema = Schema.Struct({
  nibble: RadixNibbleV1Schema,
  page: CommittedRootPageRefV1Schema,
});

export const CommittedRootBranchV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.committed-root-page/1"),
  node: Schema.Literal("branch"),
  prefix: RadixPathV1Schema,
  children: Schema.Array(CommittedRootBranchChildV1Schema),
});

export type CommittedRootBranchV1 = Schema.Schema.Type<
  typeof CommittedRootBranchV1Schema
>;

export const CommittedRootLeafV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.committed-root-page/1"),
  node: Schema.Literal("leaf"),
  key: RadixPathV1Schema,
  keyPreimage: CommittedRootKeyV1Schema,
  owner: Schema.Struct({
    kind: Schema.Literal("committed-root"),
    graph: GraphRootRefV1Schema,
  }),
  graph: GraphRootRefV1Schema,
});

export type CommittedRootLeafV1 = Schema.Schema.Type<
  typeof CommittedRootLeafV1Schema
>;

export const CommittedRootPageV1Schema = Schema.Union(
  CommittedRootBranchV1Schema,
  CommittedRootLeafV1Schema,
);

export type CommittedRootPageV1 = Schema.Schema.Type<
  typeof CommittedRootPageV1Schema
>;

export const LayoutV2Schema = Schema.Struct({
  format: Schema.Literal("niceeval"),
  schema: Schema.Literal("niceeval.layout/2"),
  recordId: NonEmptyProtocolStringSchema,
  generation: JsonSafePositiveIntegerSchema,
  head: GraphRootRefV1Schema,
  committedRoots: CommittedRootPageRefV1Schema,
});

export type LayoutV2 = Schema.Schema.Type<typeof LayoutV2Schema>;

export const RecordGraphRefV1Schema = Schema.Struct({
  recordId: NonEmptyProtocolStringSchema,
  graph: GraphRootRefV1Schema,
});

export type RecordGraphRefV1 = Schema.Schema.Type<
  typeof RecordGraphRefV1Schema
>;
export type RecordGraphRef = RecordGraphRefV1;
export const GraphRefV1Schema = RecordGraphRefV1Schema;
export type GraphRefV1 = RecordGraphRefV1;

export const RecordWalkerResourceLimitSchema = Schema.Struct({
  name: Schema.Literal("objects", "depth", "bytes"),
  maximum: JsonSafeUnsignedIntegerSchema,
});

export type RecordWalkerResourceLimit = Schema.Schema.Type<
  typeof RecordWalkerResourceLimitSchema
>;

export const RecordGraphViolationCodeSchema = Schema.Literal(
  "core-canonical-invalid",
  "graph-root-invalid",
  "graph-node-invalid",
  "descriptor-invalid",
  "descriptor-digest-mismatch",
  "descriptor-size-mismatch",
  "missing-object",
  "strong-closure-invalid",
  "strong-edge-invalid",
  "committed-root-membership-invalid",
  "committed-root-key-invalid",
  "generation-revision-invalid",
  "revision-chain-invalid",
  "record-previous-invalid",
  "revision-edge-contract-invalid",
  "record-subject-edge-contract-invalid",
  "domain-edge-contract-invalid",
  "radix-key-invalid",
  "radix-branch-invalid",
  "radix-leaf-invalid",
  "radix-edge-contract-invalid",
  "radix-successor-invalid",
  "digest-collision",
  "claim-basis-cycle",
  "known-payload-schema-invalid",
  "known-payload-invariant-invalid",
);

export type RecordGraphViolationCode = Schema.Schema.Type<
  typeof RecordGraphViolationCodeSchema
>;

export const RecordGraphViolationSchema = Schema.Struct({
  code: RecordGraphViolationCodeSchema,
  path: Schema.Array(Schema.String),
  message: Schema.String,
});

export type RecordGraphViolation = Schema.Schema.Type<
  typeof RecordGraphViolationSchema
>;

export const RecordGraphVerificationSchema = Schema.Union(
  Schema.Struct({ state: Schema.Literal("valid") }),
  Schema.Struct({
    state: Schema.Literal("invalid"),
    violations: Schema.NonEmptyArray(RecordGraphViolationSchema),
  }),
);

export type RecordGraphVerification = Schema.Schema.Type<
  typeof RecordGraphVerificationSchema
>;

export function decodeProtocolSchema<A, I, R>(
  schema: Schema.Schema<A, I, R>,
  input: unknown,
  operation: string,
): Effect.Effect<A, RecordProtocolError, R> {
  return Schema.decodeUnknown(schema, {
    errors: "all",
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError((cause) =>
      recordProtocolError({
        code: "schema-invalid",
        operation,
        message: String(cause),
      })
    ),
  );
}

const DescriptorEnvelopeV1Schema = Schema.Struct({
  mediaType: Schema.String,
  digest: Schema.String,
  size: Schema.Number,
});

export function decodeDescriptorV1(
  input: unknown,
  operation = "decode-descriptor",
): Effect.Effect<DescriptorV1, RecordProtocolError> {
  return Schema.decodeUnknown(DescriptorEnvelopeV1Schema, {
    errors: "all",
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError((cause) =>
      recordProtocolError({
        code: "descriptor-invalid",
        operation,
        message: String(cause),
      })
    ),
    Effect.flatMap((envelope) => {
      const separator = envelope.digest.indexOf(":");
      const algorithm = separator < 0
        ? envelope.digest
        : envelope.digest.slice(0, separator);
      if (algorithm !== "sha256") {
        return Effect.fail(recordProtocolError({
          code: "unsupported-digest",
          operation,
          path: ["digest"],
          message: `Record format v1 only supports SHA-256, received ${JSON.stringify(algorithm)}`,
          expected: "sha256",
          actual: algorithm,
        }));
      }
      return decodeProtocolSchema(DescriptorV1Schema, envelope, operation).pipe(
        Effect.mapError((cause) =>
          recordProtocolError({
            code: cause.code === "schema-invalid"
              ? "descriptor-invalid"
              : cause.code,
            operation,
            path: cause.path,
            message: cause.message,
            ...(cause.expected === undefined ? {} : { expected: cause.expected }),
            ...(cause.actual === undefined ? {} : { actual: cause.actual }),
          })
        ),
      );
    }),
  );
}

function bytesFromUnknown(
  input: unknown,
  operation: string,
): Effect.Effect<Uint8Array, RecordProtocolError> {
  if (!(input instanceof Uint8Array)) {
    return Effect.fail(recordProtocolError({
      code: "descriptor-invalid",
      operation,
      message: "Typed object bytes must be a Uint8Array",
    }));
  }
  if (input.byteLength > RECORD_FILE_MAX_BYTES) {
    return Effect.fail(recordProtocolError({
      code: "object-too-large",
      operation,
      message: `Typed object exceeds the ${RECORD_FILE_MAX_BYTES}-byte Record v1 limit`,
      expected: String(RECORD_FILE_MAX_BYTES),
      actual: String(input.byteLength),
    }));
  }
  return Effect.succeed(input);
}

export function sha256DigestOfBytes(
  input: unknown,
): Effect.Effect<DigestV1, RecordProtocolError> {
  return bytesFromUnknown(input, "hash-typed-object").pipe(
    Effect.flatMap((bytes) =>
      decodeProtocolSchema(
        DigestV1Schema,
        `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        "hash-typed-object",
      )
    ),
  );
}

export function radixPathForCanonicalValue(
  input: unknown,
): Effect.Effect<RadixPathV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const bytes = yield* canonicalJsonBytes(input);
    return yield* decodeProtocolSchema(
      RadixPathV1Schema,
      createHash("sha256").update(bytes).digest("hex"),
      "compute-radix-path",
    );
  });
}

export function descriptorForBytes(
  mediaType: unknown,
  input: unknown,
): Effect.Effect<DescriptorV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const normalizedMediaType = yield* decodeProtocolSchema(
      MediaTypeV1Schema,
      mediaType,
      "describe-typed-object",
    ).pipe(
      Effect.mapError((cause) =>
        recordProtocolError({
          code: "media-type-invalid",
          operation: "describe-typed-object",
          path: ["mediaType"],
          message: cause.message,
        })
      ),
    );
    const bytes = yield* bytesFromUnknown(input, "describe-typed-object");
    const digest = yield* sha256DigestOfBytes(bytes);
    return yield* decodeProtocolSchema(DescriptorV1Schema, {
      mediaType: normalizedMediaType,
      digest,
      size: bytes.byteLength,
    }, "describe-typed-object");
  });
}

export function verifyTypedObjectDescriptor(
  descriptor: unknown,
  input: unknown,
): Effect.Effect<DescriptorV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const decoded = yield* decodeDescriptorV1(descriptor, "verify-typed-object");
    const bytes = yield* bytesFromUnknown(input, "verify-typed-object");
    if (decoded.size !== bytes.byteLength) {
      return yield* Effect.fail(recordProtocolError({
        code: "descriptor-size-mismatch",
        operation: "verify-typed-object",
        path: ["size"],
        message: "Descriptor size does not match the raw object byte length",
        expected: String(decoded.size),
        actual: String(bytes.byteLength),
      }));
    }
    const actual = yield* sha256DigestOfBytes(bytes);
    if (decoded.digest !== actual) {
      return yield* Effect.fail(recordProtocolError({
        code: "descriptor-digest-mismatch",
        operation: "verify-typed-object",
        path: ["digest"],
        message: "Descriptor digest does not match the raw object bytes",
        expected: decoded.digest,
        actual,
      }));
    }
    return decoded;
  });
}

export function typedReferenceEquals(
  left: DescriptorV1,
  right: DescriptorV1,
): boolean {
  return left.mediaType === right.mediaType
    && left.digest === right.digest
    && left.size === right.size;
}

export function typedReferenceIdentityBytes(
  descriptor: DescriptorV1,
): Effect.Effect<Uint8Array, RecordProtocolError> {
  return canonicalJsonBytes(descriptor);
}

interface CanonicalDescriptorEntry {
  readonly descriptor: DescriptorV1;
  readonly bytes: Uint8Array;
}

/** Normalize descriptor sets by complete typed-reference JCS bytes, never digest alone. */
export function normalizeTypedObjectDescriptors(
  input: unknown,
): Effect.Effect<readonly DescriptorV1[], RecordProtocolError> {
  return Effect.gen(function*() {
    const descriptors = yield* decodeProtocolSchema(
      Schema.Array(DescriptorV1Schema),
      input,
      "normalize-typed-object-descriptors",
    );
    const entries: readonly CanonicalDescriptorEntry[] = yield* Effect.forEach(
      descriptors,
      (descriptor) => typedReferenceIdentityBytes(descriptor).pipe(
        Effect.map((bytes) => Object.freeze({ descriptor, bytes })),
      ),
    );
    const sorted = [...entries].sort((left, right) =>
      compareCanonicalBytes(left.bytes, right.bytes)
    );
    for (let index = 1; index < sorted.length; index += 1) {
      if (compareCanonicalBytes(sorted[index - 1].bytes, sorted[index].bytes) === 0) {
        return yield* Effect.fail(recordProtocolError({
          code: "descriptor-invalid",
          operation: "normalize-typed-object-descriptors",
          path: [String(index)],
          message: "Typed descriptor sets must not contain duplicate complete references",
        }));
      }
    }
    return Object.freeze(sorted.map((entry) => entry.descriptor));
  });
}

export function assertCanonicalTypedObjectDescriptors(
  input: unknown,
): Effect.Effect<readonly DescriptorV1[], RecordProtocolError> {
  return Effect.gen(function*() {
    const descriptors = yield* decodeProtocolSchema(
      Schema.Array(DescriptorV1Schema),
      input,
      "assert-canonical-typed-object-descriptors",
    );
    const normalized = yield* normalizeTypedObjectDescriptors(descriptors);
    for (let index = 0; index < descriptors.length; index += 1) {
      if (!typedReferenceEquals(descriptors[index], normalized[index])) {
        return yield* Effect.fail(recordProtocolError({
          code: "descriptor-invalid",
          operation: "assert-canonical-typed-object-descriptors",
          path: [String(index)],
          message: "Typed descriptors are not in canonical JCS byte order",
        }));
      }
    }
    return normalized;
  });
}

export function nodeRefV1(
  descriptor: unknown,
): Effect.Effect<NodeRefV1, RecordProtocolError> {
  return decodeProtocolSchema(NodeRefV1Schema, descriptor, "decode-node-ref");
}

export function edgePageRefV1(
  descriptor: unknown,
): Effect.Effect<EdgePageRefV1, RecordProtocolError> {
  return decodeProtocolSchema(
    EdgePageRefV1Schema,
    descriptor,
    "decode-edge-page-ref",
  );
}

export function graphRootRefV1(
  descriptor: unknown,
): Effect.Effect<GraphRootRefV1, RecordProtocolError> {
  return decodeProtocolSchema(
    GraphRootRefV1Schema,
    descriptor,
    "decode-graph-root-ref",
  );
}

export function committedRootPageRefV1(
  descriptor: unknown,
): Effect.Effect<CommittedRootPageRefV1, RecordProtocolError> {
  return decodeProtocolSchema(
    CommittedRootPageRefV1Schema,
    descriptor,
    "decode-committed-root-page-ref",
  );
}

export function validateEdgePageV1(
  page: EdgePageV1,
): Effect.Effect<void, RecordProtocolError> {
  if (page.edges.length === 0 || page.edges.length > STRONG_EDGE_PAGE_ENTRIES) {
    return Effect.fail(recordProtocolError({
      code: "edge-contract-invalid",
      operation: "validate-edge-page",
      path: ["edges"],
      message: "Edge pages contain between one and 128 strong edges",
    }));
  }
  if (page.pages.length > 1) {
    return Effect.fail(recordProtocolError({
      code: "edge-contract-invalid",
      operation: "validate-edge-page",
      path: ["pages"],
      message: "An EdgePage may point to at most one successor page",
    }));
  }
  if (page.pages.length === 1 && page.edges.length !== STRONG_EDGE_PAGE_ENTRIES) {
    return Effect.fail(recordProtocolError({
      code: "edge-contract-invalid",
      operation: "validate-edge-page",
      path: ["edges"],
      message: "Every non-final EdgePage must contain exactly 128 strong edges",
    }));
  }
  return Effect.void;
}

export function validateCommittedRootPageV1(
  page: CommittedRootPageV1,
): Effect.Effect<void, RecordProtocolError> {
  return Effect.gen(function*() {
    if (page.node === "branch") {
      if (page.children.length === 1 || page.children.length > 16) {
        return yield* Effect.fail(recordProtocolError({
          code: "payload-invariant-invalid",
          operation: "validate-committed-root-page",
          path: ["children"],
          message: "Committed-root branches are empty roots or have 2 to 16 children",
        }));
      }
      for (let index = 1; index < page.children.length; index += 1) {
        if (page.children[index - 1].nibble >= page.children[index].nibble) {
          return yield* Effect.fail(recordProtocolError({
            code: "payload-invariant-invalid",
            operation: "validate-committed-root-page",
            path: ["children", String(index), "nibble"],
            message: "Committed-root child nibbles must be unique and strictly ascending",
          }));
        }
      }
      return;
    }
    if (
      !typedReferenceEquals(page.keyPreimage.graph, page.graph)
      || !typedReferenceEquals(page.owner.graph, page.graph)
    ) {
      return yield* Effect.fail(recordProtocolError({
        code: "payload-invariant-invalid",
        operation: "validate-committed-root-page",
        path: ["graph"],
        message: "Committed-root leaf preimage, owner and graph must be identical",
      }));
    }
    const expectedKey = yield* radixPathForCanonicalValue(page.keyPreimage);
    if (expectedKey !== page.key) {
      return yield* Effect.fail(recordProtocolError({
        code: "payload-invariant-invalid",
        operation: "validate-committed-root-page",
        path: ["key"],
        message: "Committed-root leaf key must be SHA-256 of canonical keyPreimage bytes",
        expected: expectedKey,
        actual: page.key,
      }));
    }
  });
}

export interface EncodedTypedJsonObjectV1<A> {
  readonly descriptor: DescriptorV1;
  readonly value: A;
  readonly bytes: Uint8Array;
}

export function encodeTypedJsonObject<A, I, R>(
  schema: Schema.Schema<A, I, R>,
  mediaType: unknown,
  input: unknown,
): Effect.Effect<EncodedTypedJsonObjectV1<A>, RecordProtocolError, R> {
  return Effect.gen(function*() {
    const value = yield* decodeProtocolSchema(schema, input, "encode-typed-json");
    const encoded = yield* Schema.encodeUnknown(schema, {
      errors: "all",
      onExcessProperty: "error",
    })(value).pipe(
      Effect.mapError((cause) =>
        recordProtocolError({
          code: "schema-invalid",
          operation: "encode-typed-json",
          message: String(cause),
        })
      ),
    );
    const bytes = yield* canonicalJsonBytes(encoded);
    const descriptor = yield* descriptorForBytes(mediaType, bytes);
    return Object.freeze({ descriptor, value, bytes });
  });
}

export function decodeTypedJsonObject<A, I, R>(
  schema: Schema.Schema<A, I, R>,
  descriptor: unknown,
  input: unknown,
  expectedMediaType?: string,
): Effect.Effect<A, RecordProtocolError, R> {
  return Effect.gen(function*() {
    const verified = yield* verifyTypedObjectDescriptor(descriptor, input);
    if (
      expectedMediaType !== undefined
      && verified.mediaType !== expectedMediaType
    ) {
      return yield* Effect.fail(recordProtocolError({
        code: "media-type-invalid",
        operation: "decode-typed-json",
        path: ["mediaType"],
        message: "Typed object media type does not match the requested codec",
        expected: expectedMediaType,
        actual: verified.mediaType,
      }));
    }
    const json = yield* decodeCanonicalJsonBytes(input);
    return yield* decodeProtocolSchema(schema, json, "decode-typed-json");
  });
}

interface CanonicalStrongEdgeEntry {
  readonly edge: StrongEdgeV1;
  readonly bytes: Uint8Array;
}

function canonicalStrongEdgeEntries(
  edges: readonly StrongEdgeV1[],
): Effect.Effect<readonly CanonicalStrongEdgeEntry[], RecordProtocolError> {
  return Effect.forEach(edges, (edge) =>
    canonicalJsonBytes(edge).pipe(
      Effect.map((bytes) => Object.freeze({ edge, bytes })),
    )
  );
}

function rejectDuplicateStrongEdges(
  entries: readonly CanonicalStrongEdgeEntry[],
  operation: string,
): Effect.Effect<void, RecordProtocolError> {
  const sorted = [...entries].sort((left, right) =>
    compareCanonicalBytes(left.bytes, right.bytes)
  );
  for (let index = 1; index < sorted.length; index += 1) {
    if (compareCanonicalBytes(sorted[index - 1].bytes, sorted[index].bytes) === 0) {
      return Effect.fail(recordProtocolError({
        code: "strong-edge-duplicate",
        operation,
        path: [String(index)],
        message: "A strong-edge sequence must not contain duplicate relation/target pairs",
      }));
    }
  }
  return Effect.void;
}

/** Canonical set order for owners whose edge contract is a set, not a semantic sequence. */
export function normalizeStrongEdges(
  input: unknown,
): Effect.Effect<readonly StrongEdgeV1[], RecordProtocolError> {
  return Effect.gen(function*() {
    const edges = yield* decodeProtocolSchema(
      Schema.Array(StrongEdgeV1Schema),
      input,
      "normalize-strong-edges",
    ).pipe(
      Effect.mapError((cause) =>
        recordProtocolError({
          code: "strong-edge-invalid",
          operation: "normalize-strong-edges",
          message: cause.message,
        })
      ),
    );
    const entries = yield* canonicalStrongEdgeEntries(edges);
    yield* rejectDuplicateStrongEdges(entries, "normalize-strong-edges");
    const sorted = [...entries].sort((left, right) =>
      compareCanonicalBytes(left.bytes, right.bytes)
    );
    return Object.freeze(sorted.map((entry) => entry.edge));
  });
}

export function assertCanonicalStrongEdges(
  input: unknown,
): Effect.Effect<readonly StrongEdgeV1[], RecordProtocolError> {
  return Effect.gen(function*() {
    const edges = yield* decodeProtocolSchema(
      Schema.Array(StrongEdgeV1Schema),
      input,
      "assert-canonical-strong-edges",
    );
    const normalized = yield* normalizeStrongEdges(edges);
    for (let index = 0; index < edges.length; index += 1) {
      const actual = edges[index];
      const expected = normalized[index];
      if (
        actual.relation !== expected.relation
        || !typedReferenceEquals(actual.target, expected.target)
      ) {
        return yield* Effect.fail(recordProtocolError({
          code: "strong-edge-order-invalid",
          operation: "assert-canonical-strong-edges",
          path: [String(index)],
          message: "Strong edges are not in canonical JCS byte order",
        }));
      }
    }
    return normalized;
  });
}

/** Owner-defined edge matrices preserve every relation/ordinal/target entry exactly. */
export function validateStrongEdgeSequence(
  expected: readonly StrongEdgeV1[],
  actualInput: unknown,
): Effect.Effect<readonly StrongEdgeV1[], RecordProtocolError> {
  return Effect.gen(function*() {
    const actual = yield* decodeProtocolSchema(
      Schema.Array(StrongEdgeV1Schema),
      actualInput,
      "validate-strong-edge-sequence",
    );
    if (actual.length !== expected.length) {
      return yield* Effect.fail(recordProtocolError({
        code: "edge-contract-invalid",
        operation: "validate-strong-edge-sequence",
        message: "Strong-edge count does not match the payload edge contract",
        expected: String(expected.length),
        actual: String(actual.length),
      }));
    }
    for (let index = 0; index < expected.length; index += 1) {
      const expectedEdge = expected[index];
      const actualEdge = actual[index];
      if (
        expectedEdge.relation !== actualEdge.relation
        || !typedReferenceEquals(expectedEdge.target, actualEdge.target)
      ) {
        return yield* Effect.fail(recordProtocolError({
          code: "edge-contract-invalid",
          operation: "validate-strong-edge-sequence",
          path: [String(index)],
          message: "Strong edge does not match the payload relation, ordinal and target",
        }));
      }
    }
    return Object.freeze([...actual]);
  });
}

export function partitionStrongEdgesV1(
  input: unknown,
): Effect.Effect<readonly (readonly StrongEdgeV1[])[], RecordProtocolError> {
  return Effect.gen(function*() {
    const edges = yield* decodeProtocolSchema(
      Schema.Array(StrongEdgeV1Schema),
      input,
      "partition-strong-edges",
    );
    const pages: (readonly StrongEdgeV1[])[] = [];
    for (let offset = 0; offset < edges.length; offset += STRONG_EDGE_PAGE_ENTRIES) {
      pages.push(Object.freeze(edges.slice(offset, offset + STRONG_EDGE_PAGE_ENTRIES)));
    }
    return Object.freeze(pages);
  });
}
