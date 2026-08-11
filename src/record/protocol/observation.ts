import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { Effect, Schema } from "effect";
import { canonicalJsonBytes, compareCanonicalBytes } from "./canonical.ts";
import {
  decodeProtocolSchema,
  DigestV1Schema,
  JsonSafeUnsignedIntegerSchema,
  NodeRefV1Schema,
  type NodeRefV1,
  NonEmptyProtocolStringSchema,
  type StrongEdgeV1,
} from "./core.ts";
import type { DigestV1 } from "./core.ts";
import {
  AttemptIdSchema,
  RevisionV1Schema,
} from "./entities.ts";
import {
  recordProtocolError,
  type RecordProtocolError,
} from "./errors.ts";
import { JsonValueSchema, type JsonValue } from "./json.ts";

export const OBSERVATION_STREAM_INDEX_MEDIA_TYPE: "application/vnd.niceeval.observation-stream-index.v1+jcs" =
  "application/vnd.niceeval.observation-stream-index.v1+jcs";
export const OBSERVATION_SEGMENT_PAGE_MEDIA_TYPE: "application/vnd.niceeval.observation-segment-page.v1+jcs" =
  "application/vnd.niceeval.observation-segment-page.v1+jcs";
export const OBSERVATION_SEGMENT_MEDIA_TYPE: "application/vnd.niceeval.observation-segment.v1+jcs" =
  "application/vnd.niceeval.observation-segment.v1+jcs";

export const OBSERVATION_ENVELOPE_MAX_BYTES: 1048576 = 1_048_576;

export const VersionedSelectorSchema = Schema.Struct({
  schema: NonEmptyProtocolStringSchema,
  value: JsonValueSchema,
});

export type VersionedSelector = Schema.Schema.Type<
  typeof VersionedSelectorSchema
>;

export const RedactionPolicyIdV1Schema = Schema.Struct({
  namespace: NonEmptyProtocolStringSchema,
  name: NonEmptyProtocolStringSchema,
  version: NonEmptyProtocolStringSchema,
});

export type RedactionPolicyIdV1 = Schema.Schema.Type<
  typeof RedactionPolicyIdV1Schema
>;

export const EvidenceTransformationV1Schema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("redacted"),
    selector: VersionedSelectorSchema,
    policy: RedactionPolicyIdV1Schema,
  }),
  Schema.Struct({
    kind: Schema.Literal("truncated"),
    selector: VersionedSelectorSchema,
    inputBytes: JsonSafeUnsignedIntegerSchema,
  }),
);

export type EvidenceTransformationV1 = Schema.Schema.Type<
  typeof EvidenceTransformationV1Schema
>;

/** Check the ordering and selector-schema invariant shared by persisted transformations. */
export function validateEvidenceTransformationSequenceV1(
  transformations: readonly EvidenceTransformationV1[],
): Effect.Effect<void, RecordProtocolError> {
  const first = transformations[0];
  if (first === undefined) return Effect.void;

  const selectorSchema = first.selector.schema;
  let seenTruncation = false;
  for (let index = 0; index < transformations.length; index += 1) {
    const transformation = transformations[index];
    if (transformation.selector.schema !== selectorSchema) {
      return Effect.fail(invariantError(
        "validate-evidence-transformation-sequence",
        [String(index), "selector", "schema"],
        "All transformation selectors must use the same exact schema string",
      ));
    }
    if (transformation.kind === "truncated") {
      seenTruncation = true;
      continue;
    }
    if (seenTruncation) {
      return Effect.fail(invariantError(
        "validate-evidence-transformation-sequence",
        [String(index), "kind"],
        "Redacted transformations must precede every truncated transformation",
      ));
    }
  }
  return Effect.void;
}

export const ObservationScopeV1Schema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("run"),
    runId: NonEmptyProtocolStringSchema,
    experimentId: NonEmptyProtocolStringSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("attempt"),
    runId: NonEmptyProtocolStringSchema,
    experimentId: NonEmptyProtocolStringSchema,
    attemptId: AttemptIdSchema,
    evalId: NonEmptyProtocolStringSchema,
    agentSessionId: Schema.optionalWith(NonEmptyProtocolStringSchema, {
      exact: true,
    }),
    turnId: Schema.optionalWith(NonEmptyProtocolStringSchema, { exact: true }),
  }),
);

export type ObservationScopeV1 = Schema.Schema.Type<
  typeof ObservationScopeV1Schema
>;

const DecimalUnsignedIntegerStringSchema = Schema.String.pipe(
  Schema.filter((value) => /^(0|[1-9][0-9]*)$/.test(value), {
    identifier: "DecimalUnsignedIntegerString",
    description: "a canonical unsigned decimal integer string",
  }),
);

export const ObservationEventV1Schema = Schema.Struct({
  format: Schema.Literal("niceeval.observation"),
  id: NonEmptyProtocolStringSchema,
  name: NonEmptyProtocolStringSchema,
  schema: NonEmptyProtocolStringSchema,
  stream: Schema.Struct({
    id: NonEmptyProtocolStringSchema,
    sequence: JsonSafeUnsignedIntegerSchema,
  }),
  scope: ObservationScopeV1Schema,
  time: Schema.Struct({
    observedAt: NonEmptyProtocolStringSchema,
    monotonicOffsetNs: DecimalUnsignedIntegerStringSchema,
    occurredAt: Schema.optionalWith(NonEmptyProtocolStringSchema, { exact: true }),
  }),
  source: Schema.Struct({
    component: NonEmptyProtocolStringSchema,
    version: Schema.optionalWith(NonEmptyProtocolStringSchema, { exact: true }),
    adapter: Schema.optionalWith(NonEmptyProtocolStringSchema, { exact: true }),
    mapperVersion: Schema.optionalWith(NonEmptyProtocolStringSchema, { exact: true }),
  }),
  correlation: Schema.optionalWith(Schema.Struct({
    parentEventId: Schema.optionalWith(NonEmptyProtocolStringSchema, {
      exact: true,
    }),
    traceId: Schema.optionalWith(NonEmptyProtocolStringSchema, { exact: true }),
    spanId: Schema.optionalWith(NonEmptyProtocolStringSchema, { exact: true }),
  }), { exact: true }),
  transformations: Schema.Array(EvidenceTransformationV1Schema),
  body: JsonValueSchema,
});

export type ObservationEventV1 = Schema.Schema.Type<
  typeof ObservationEventV1Schema
>;
export type ObservationEvent<T extends JsonValue = JsonValue> = Omit<
  ObservationEventV1,
  "body"
> & { readonly body: T };

/** Validate event-level persistence rules that cannot be expressed by a shape alone. */
export function validateObservationEventV1(
  payload: ObservationEventV1,
): Effect.Effect<void, RecordProtocolError> {
  return validateEvidenceTransformationSequenceV1(payload.transformations);
}

export const StreamStateSchema = Schema.Literal("open", "closed", "abandoned");
export type StreamState = Schema.Schema.Type<typeof StreamStateSchema>;

export const ObservationStreamIndexV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.observation-stream-index/1"),
  streamId: NonEmptyProtocolStringSchema,
  revision: RevisionV1Schema,
  previous: Schema.NullOr(NodeRefV1Schema),
  scope: ObservationScopeV1Schema,
  state: StreamStateSchema,
  leafCount: JsonSafeUnsignedIntegerSchema,
  throughSequence: Schema.NullOr(JsonSafeUnsignedIntegerSchema),
  merkleRoot: DigestV1Schema,
  firstSegmentPage: Schema.NullOr(NodeRefV1Schema),
});

export type ObservationStreamIndexV1 = Schema.Schema.Type<
  typeof ObservationStreamIndexV1Schema
>;

const ObservationSegmentPageEntryV1Schema = Schema.Struct({
  firstSequence: JsonSafeUnsignedIntegerSchema,
  lastSequence: JsonSafeUnsignedIntegerSchema,
  segment: NodeRefV1Schema,
});

export const ObservationSegmentPageV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.observation-segment-page/1"),
  streamId: NonEmptyProtocolStringSchema,
  entries: Schema.NonEmptyArray(ObservationSegmentPageEntryV1Schema),
  next: Schema.NullOr(NodeRefV1Schema),
});

export type ObservationSegmentPageV1 = Schema.Schema.Type<
  typeof ObservationSegmentPageV1Schema
>;

export const ObservationSegmentV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.observation-segment/1"),
  streamId: NonEmptyProtocolStringSchema,
  firstSequence: JsonSafeUnsignedIntegerSchema,
  events: Schema.NonEmptyArray(ObservationEventV1Schema),
  externalObjects: Schema.Array(NodeRefV1Schema),
});

export type ObservationSegmentV1 = Schema.Schema.Type<
  typeof ObservationSegmentV1Schema
>;

export const LifecyclePhaseSchema = Schema.Literal(
  "judge.precheck",
  "experiment.setup",
  "experiment.teardown",
  "sandbox.queue",
  "sandbox.create",
  "sandbox.prepare",
  "sandbox.prepare.eval",
  "sandbox.prepare.experiment",
  "agent.ensure",
  "workspace.baseline",
  "agent.setup",
  "telemetry.configure",
  "eval.run",
  "agent.run",
  "workspace.diff",
  "assertions.evaluate",
  "telemetry.collect",
  "agent.teardown",
  "sandbox.cleanup",
  "sandbox.suspend",
  "sandbox.stop",
);

export type LifecyclePhase = Schema.Schema.Type<typeof LifecyclePhaseSchema>;

const NonNegativeJsonNumberSchema = Schema.JsonNumber.pipe(
  Schema.filter((value) => value >= 0, {
    identifier: "NonNegativeJsonNumber",
    description: "a finite non-negative JSON number",
  }),
);

export const UsageSchema = Schema.Struct({
  inputTokens: Schema.optionalWith(JsonSafeUnsignedIntegerSchema, { exact: true }),
  outputTokens: Schema.optionalWith(JsonSafeUnsignedIntegerSchema, { exact: true }),
  cacheReadTokens: Schema.optionalWith(JsonSafeUnsignedIntegerSchema, { exact: true }),
  cacheCreationTokens: Schema.optionalWith(JsonSafeUnsignedIntegerSchema, { exact: true }),
  reasoningTokens: Schema.optionalWith(JsonSafeUnsignedIntegerSchema, { exact: true }),
  requests: Schema.optionalWith(JsonSafeUnsignedIntegerSchema, { exact: true }),
  costUSD: Schema.optionalWith(NonNegativeJsonNumberSchema, { exact: true }),
});

export type Usage = Schema.Schema.Type<typeof UsageSchema>;

function edge(relation: string, target: NodeRefV1): StrongEdgeV1 {
  return Object.freeze({ relation, target });
}

export function observationStreamIndexStrongEdges(
  payload: ObservationStreamIndexV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    ...(payload.previous === null
      ? []
      : [edge("niceeval.stream-previous", payload.previous)]),
    ...(payload.firstSegmentPage === null
      ? []
      : [edge("niceeval.stream-segment-page-first", payload.firstSegmentPage)]),
  ]);
}

export function observationSegmentPageStrongEdges(
  payload: ObservationSegmentPageV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    ...payload.entries.map((entry) =>
      edge("niceeval.stream-segment", entry.segment)
    ),
    ...(payload.next === null
      ? []
      : [edge("niceeval.stream-segment-page-next", payload.next)]),
  ]);
}

export function observationSegmentStrongEdges(
  payload: ObservationSegmentV1,
): readonly StrongEdgeV1[] {
  return Object.freeze(payload.externalObjects.map((target) =>
    edge("niceeval.observation-external-object", target)
  ));
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

export function validateObservationStreamIndexV1(
  payload: ObservationStreamIndexV1,
): Effect.Effect<void, RecordProtocolError> {
  if ((payload.revision === 0) !== (payload.previous === null)) {
    return Effect.fail(invariantError(
      "validate-observation-stream-index",
      ["previous"],
      "Stream revision 0 requires previous=null and every later revision requires a predecessor",
    ));
  }
  const empty = payload.leafCount === 0;
  if (
    empty
      ? payload.throughSequence !== null || payload.firstSegmentPage !== null
      : payload.throughSequence !== payload.leafCount - 1
        || payload.firstSegmentPage === null
  ) {
    return Effect.fail(invariantError(
      "validate-observation-stream-index",
      ["leafCount"],
      "leafCount, throughSequence and firstSegmentPage do not describe one committed prefix",
    ));
  }
  return Effect.void;
}

export function validateObservationSegmentPageV1(
  payload: ObservationSegmentPageV1,
): Effect.Effect<void, RecordProtocolError> {
  let expectedFirst: number | undefined;
  for (let index = 0; index < payload.entries.length; index += 1) {
    const entry = payload.entries[index];
    if (entry.lastSequence < entry.firstSequence) {
      return Effect.fail(invariantError(
        "validate-observation-segment-page",
        ["entries", String(index), "lastSequence"],
        "Segment page ranges must not be inverted",
      ));
    }
    if (expectedFirst !== undefined && entry.firstSequence !== expectedFirst) {
      return Effect.fail(invariantError(
        "validate-observation-segment-page",
        ["entries", String(index), "firstSequence"],
        "Segment page entries must be contiguous and strictly ordered",
      ));
    }
    expectedFirst = entry.lastSequence + 1;
  }
  return Effect.void;
}

export function validateObservationSegmentV1(
  payload: ObservationSegmentV1,
): Effect.Effect<void, RecordProtocolError> {
  return Effect.gen(function*() {
    if (payload.events.length === 0) {
      return yield* Effect.fail(invariantError(
        "validate-observation-segment",
        ["events"],
        "Observation segments must contain at least one event",
      ));
    }
    const eventIds = new Set<string>();
    for (let index = 0; index < payload.events.length; index += 1) {
      const event = payload.events[index];
      yield* validateObservationEventV1(event);
      if (
        event.stream.id !== payload.streamId
        || event.stream.sequence !== payload.firstSequence + index
      ) {
        return yield* Effect.fail(invariantError(
          "validate-observation-segment",
          ["events", String(index), "stream"],
          "Segment events must use the segment streamId and a contiguous sequence",
        ));
      }
      if (eventIds.has(event.id)) {
        return yield* Effect.fail(invariantError(
          "validate-observation-segment",
          ["events", String(index), "id"],
          "A segment must not contain duplicate event IDs",
        ));
      }
      eventIds.add(event.id);
      const eventBytes = yield* canonicalJsonBytes(event);
      if (eventBytes.byteLength > OBSERVATION_ENVELOPE_MAX_BYTES) {
        return yield* Effect.fail(invariantError(
          "validate-observation-segment",
          ["events", String(index)],
          `Observation envelopes must not exceed ${OBSERVATION_ENVELOPE_MAX_BYTES} bytes`,
        ));
      }
    }

    const encodedRefs = yield* Effect.forEach(payload.externalObjects, (reference) =>
      canonicalJsonBytes(reference).pipe(
        Effect.map((bytes) => Object.freeze({ reference, bytes })),
      )
    );
    for (let index = 1; index < encodedRefs.length; index += 1) {
      const order = compareCanonicalBytes(
        encodedRefs[index - 1].bytes,
        encodedRefs[index].bytes,
      );
      if (order >= 0) {
        return yield* Effect.fail(invariantError(
          "validate-observation-segment",
          ["externalObjects", String(index)],
          order === 0
            ? "externalObjects must not contain duplicate typed references"
            : "externalObjects must be sorted by complete reference JCS bytes",
        ));
      }
    }
  });
}

function sha256Raw(parts: readonly Uint8Array[]): Uint8Array {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function u32be(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

function u64be(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt(value), false);
  return bytes;
}

function rawDigestOf(digest: DigestV1): Uint8Array {
  return Buffer.from(digest.slice("sha256:".length), "hex");
}

function eventLeaf(
  streamId: string,
  sequence: number,
  eventBytes: Uint8Array,
): Uint8Array {
  const streamBytes = new TextEncoder().encode(streamId);
  return sha256Raw([
    Uint8Array.of(0x00),
    ascii("niceeval:event-leaf:v1"),
    u32be(streamBytes.byteLength),
    streamBytes,
    u64be(sequence),
    u64be(eventBytes.byteLength),
    eventBytes,
  ]);
}

function parentNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256Raw([
    Uint8Array.of(0x01),
    ascii("niceeval:event-node:v1"),
    left,
    right,
  ]);
}

function emptyTree(): Uint8Array {
  return sha256Raw([
    Uint8Array.of(0x02),
    ascii("niceeval:event-empty:v1"),
  ]);
}

function commitment(leafCount: number, treeRoot: Uint8Array): Uint8Array {
  return sha256Raw([
    Uint8Array.of(0x03),
    ascii("niceeval:event-tree:v1"),
    u64be(leafCount),
    treeRoot,
  ]);
}

function digestText(raw: Uint8Array): string {
  return `sha256:${Buffer.from(raw).toString("hex")}`;
}

export function computeObservationMerkleRootV1(
  streamId: unknown,
  eventsInput: unknown,
): Effect.Effect<DigestV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const normalizedStreamId = yield* decodeProtocolSchema(
      NonEmptyProtocolStringSchema,
      streamId,
      "compute-observation-merkle-root",
    );
    const events = yield* decodeProtocolSchema(
      Schema.Array(ObservationEventV1Schema),
      eventsInput,
      "compute-observation-merkle-root",
    );
    const leaves: Uint8Array[] = [];
    for (let index = 0; index < events.length; index += 1) {
      const event = events[index];
      if (event.stream.id !== normalizedStreamId || event.stream.sequence !== index) {
        return yield* Effect.fail(invariantError(
          "compute-observation-merkle-root",
          ["events", String(index), "stream"],
          "Merkle input events must form the complete zero-based stream prefix",
        ));
      }
      leaves.push(eventLeaf(
        normalizedStreamId,
        index,
        yield* canonicalJsonBytes(event),
      ));
    }

    let level = leaves;
    while (level.length > 1) {
      const next: Uint8Array[] = [];
      for (let index = 0; index < level.length; index += 2) {
        const left = level[index];
        const right = level[index + 1];
        next.push(right === undefined ? left : parentNode(left, right));
      }
      level = next;
    }
    const treeRoot = level[0] ?? emptyTree();
    return yield* decodeProtocolSchema(
      DigestV1Schema,
      digestText(commitment(events.length, treeRoot)),
      "compute-observation-merkle-root",
    );
  });
}

export const ObservationMerkleProofV1Schema = Schema.Struct({
  leafCount: JsonSafeUnsignedIntegerSchema,
  leafOrdinal: JsonSafeUnsignedIntegerSchema,
  merklePath: Schema.Array(DigestV1Schema),
  commitment: DigestV1Schema,
});

export type ObservationMerkleProofV1 = Schema.Schema.Type<
  typeof ObservationMerkleProofV1Schema
>;

export function verifyObservationEventMerkleProofV1(
  eventInput: unknown,
  proofInput: unknown,
): Effect.Effect<boolean, RecordProtocolError> {
  return Effect.gen(function*() {
    const event = yield* decodeProtocolSchema(
      ObservationEventV1Schema,
      eventInput,
      "verify-observation-merkle-proof",
    );
    const proof = yield* decodeProtocolSchema(
      ObservationMerkleProofV1Schema,
      proofInput,
      "verify-observation-merkle-proof",
    );
    if (
      proof.leafCount === 0
      || proof.leafOrdinal >= proof.leafCount
      || event.stream.sequence !== proof.leafOrdinal
    ) return false;

    let current = eventLeaf(
      event.stream.id,
      event.stream.sequence,
      yield* canonicalJsonBytes(event),
    );
    let ordinal = proof.leafOrdinal;
    let count = proof.leafCount;
    let pathIndex = 0;
    while (count > 1) {
      const isRight = ordinal % 2 === 1;
      const hasRightSibling = !isRight && ordinal + 1 < count;
      if (isRight || hasRightSibling) {
        const sibling = proof.merklePath[pathIndex];
        if (sibling === undefined) return false;
        const rawSibling = rawDigestOf(sibling);
        current = isRight
          ? parentNode(rawSibling, current)
          : parentNode(current, rawSibling);
        pathIndex += 1;
      }
      ordinal = Math.floor(ordinal / 2);
      count = Math.ceil(count / 2);
    }
    if (pathIndex !== proof.merklePath.length) return false;
    return digestText(commitment(proof.leafCount, current)) === proof.commitment;
  });
}
