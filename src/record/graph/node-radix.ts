import { Effect, Schema } from "effect";
import {
  ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE,
  AttemptLocatorIndexPayloadV1Schema,
  ENTITY_CATALOG_MEDIA_TYPE,
  EntityCatalogPayloadV1Schema,
  attemptLocatorIndexStrongEdges,
  entityCatalogStrongEdges,
  validateAttemptLocatorIndexPayloadV1,
  validateEntityCatalogPayloadV1,
  type AttemptLocatorIndexPayloadV1,
  type AttemptLocatorKeyV1,
  type EntityCatalogKeyV1,
  type EntityCatalogPayloadV1,
  type NodeRadixNonMembershipTerminalV1,
  type RadixMembershipProofStepV1,
} from "../protocol/entities.ts";
import {
  type NodeRefV1,
  type RadixNibbleV1,
  type RadixPathV1,
  type RecordProtocolError,
  type StrongEdgeV1,
} from "../protocol/core.ts";
import type { RecordGraphReadFailureV1, RecordGraphObjectReaderV1 } from "./read.ts";
import { readGraphNodePayloadV1, verifyKnownNodeStrongEdgesV1 } from "./read.ts";
import { attemptLocatorKeyPathV1, entityCatalogKeyPathV1 } from "./catalog.ts";

export interface NodeRadixBranchV1 {
  readonly prefix: RadixPathV1;
  readonly children: readonly { readonly nibble: RadixNibbleV1; readonly node: NodeRefV1 }[];
}

export interface NodeRadixLeafV1<KeyPreimage> {
  readonly key: RadixPathV1;
  readonly keyPreimage: KeyPreimage;
}

export interface NodeRadixPayloadShapeV1<Payload> {
  readonly branch: (payload: Payload) => NodeRadixBranchV1 | undefined;
  readonly leaf: (payload: Payload) => NodeRadixLeafV1<unknown> | undefined;
}

interface NodeRadixPayloadAdapter<Payload, Encoded, KeyPreimage>
  extends NodeRadixPayloadShapeV1<Payload> {
  readonly schema: Schema.Schema<Payload, Encoded, never>;
  readonly mediaType: string;
  readonly validate: (payload: Payload) => Effect.Effect<void, RecordProtocolError>;
  readonly strongEdges: (payload: Payload) => readonly StrongEdgeV1[];
  readonly keyPath: (preimage: KeyPreimage) => Effect.Effect<RadixPathV1, RecordProtocolError>;
}

/** Injects object decoding so the path engine remains pure with respect to storage. */
export interface NodeRadixPathReaderV1<Payload, ReadFailure, Requirements> {
  readonly read: (
    reference: NodeRefV1,
  ) => Effect.Effect<Payload, ReadFailure, Requirements>;
}

export type NodeRadixTraversalFailureV1 =
  | { readonly kind: "radix-invalid"; readonly reference: NodeRefV1; readonly detail: string }
  | { readonly kind: "invalid-limits"; readonly detail: string }
  | {
      readonly kind: "resource-limit";
      readonly limit: "objects" | "depth";
      readonly maximum: number;
      readonly observed: number;
    }
  | {
      readonly kind: "radix-cycle";
      readonly reference: NodeRefV1;
      readonly firstSeenDepth: number;
      readonly observedDepth: number;
    };

export type NodeRadixLookupFailureV1<ReadFailure> =
  | RecordGraphReadFailureV1<ReadFailure>
  | NodeRadixTraversalFailureV1;

/**
 * A lookup follows one radix child at a time. These limits bound malformed graphs even before
 * their canonical shape can be established. The defaults cover every legal 64-nibble path.
 */
export interface NodeRadixLookupLimitsV1 {
  readonly maximumObjects: number;
  readonly maximumDepth: number;
}

export const DEFAULT_NODE_RADIX_LOOKUP_LIMITS_V1: NodeRadixLookupLimitsV1 = Object.freeze({
  maximumObjects: 65,
  maximumDepth: 64,
});

export type NodeRadixLookupV1<Payload, ReadFailure> =
  | {
      readonly state: "found";
      readonly leaf: NodeRefV1;
      readonly payload: Payload;
      readonly path: readonly RadixMembershipProofStepV1[];
    }
  | {
      readonly state: "absent";
      readonly path: readonly RadixMembershipProofStepV1[];
      readonly terminal: NodeRadixNonMembershipTerminalV1;
    };

export function lookupEntityCatalogV1<ReadFailure, Requirements>(
  catalog: NodeRefV1,
  keyPreimage: EntityCatalogKeyV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: NodeRadixLookupLimitsV1 = DEFAULT_NODE_RADIX_LOOKUP_LIMITS_V1,
): Effect.Effect<
  NodeRadixLookupV1<EntityCatalogPayloadV1, ReadFailure>,
  NodeRadixLookupFailureV1<ReadFailure>,
  Requirements
> {
  return lookupNodeRadixV1(catalog, keyPreimage, ENTITY_CATALOG_ADAPTER, reader, limits).pipe(
    Effect.flatMap((result) => {
      if (
        result.state === "found"
        && !entityCatalogLookupMatchesRequestV1(keyPreimage, result.payload)
      ) {
        return Effect.fail(radixInvalidFailure(
          result.leaf,
          "An entity catalog lookup leaf keyPreimage must equal the requested full key preimage",
        ));
      }
      return Effect.succeed(result);
    }),
  );
}

export function lookupAttemptLocatorIndexV1<ReadFailure, Requirements>(
  index: NodeRefV1,
  keyPreimage: AttemptLocatorKeyV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: NodeRadixLookupLimitsV1 = DEFAULT_NODE_RADIX_LOOKUP_LIMITS_V1,
): Effect.Effect<
  NodeRadixLookupV1<AttemptLocatorIndexPayloadV1, ReadFailure>,
  NodeRadixLookupFailureV1<ReadFailure>,
  Requirements
> {
  return lookupNodeRadixV1(index, keyPreimage, ATTEMPT_LOCATOR_INDEX_ADAPTER, reader, limits).pipe(
    Effect.flatMap((result) => {
      if (
        result.state === "found"
        && !attemptLocatorIndexLookupMatchesRequestV1(keyPreimage, result.payload)
      ) {
        return Effect.fail(radixInvalidFailure(
          result.leaf,
          "An attempt locator lookup leaf keyPreimage must equal the requested full locator key",
        ));
      }
      return Effect.succeed(result);
    }),
  );
}

/** Concrete lookup binding is intentionally separate from hash-path traversal. */
export function entityCatalogLookupMatchesRequestV1(
  requested: EntityCatalogKeyV1,
  payload: EntityCatalogPayloadV1,
): boolean {
  return payload.node === "leaf"
    && payload.keyPreimage.schema === requested.schema
    && payload.keyPreimage.kind === requested.kind
    && payload.keyPreimage.id === requested.id;
}

/** Concrete lookup binding is intentionally separate from hash-path traversal. */
export function attemptLocatorIndexLookupMatchesRequestV1(
  requested: AttemptLocatorKeyV1,
  payload: AttemptLocatorIndexPayloadV1,
): boolean {
  return payload.node === "leaf"
    && payload.keyPreimage.schema === requested.schema
    && payload.keyPreimage.locator === requested.locator;
}

function lookupNodeRadixV1<Payload, Encoded, KeyPreimage, ReadFailure, Requirements>(
  root: NodeRefV1,
  keyPreimage: KeyPreimage,
  adapter: NodeRadixPayloadAdapter<Payload, Encoded, KeyPreimage>,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: NodeRadixLookupLimitsV1,
): Effect.Effect<
  NodeRadixLookupV1<Payload, ReadFailure>,
  NodeRadixLookupFailureV1<ReadFailure>,
  Requirements
> {
  return adapter.keyPath(keyPreimage).pipe(
    Effect.mapError((failure) => protocolFailure<ReadFailure>(root, failure)),
    Effect.flatMap((key) => followNodeRadixPathV1(
      root,
      key,
      adapter,
      nodeRadixGraphReader(adapter, reader),
      limits,
    )),
  );
}

/**
 * Follows one selected radix path with an injected verified payload reader. Concrete catalog and
 * locator lookups use descriptor-checked GraphNodes; this lower-level primitive makes the bounded
 * traversal reusable by other authenticated radix payloads.
 */
export function followNodeRadixPathV1<Payload, ReadFailure, Requirements>(
  root: NodeRefV1,
  key: RadixPathV1,
  shape: NodeRadixPayloadShapeV1<Payload>,
  reader: NodeRadixPathReaderV1<Payload, ReadFailure, Requirements>,
  limits: NodeRadixLookupLimitsV1 = DEFAULT_NODE_RADIX_LOOKUP_LIMITS_V1,
): Effect.Effect<
  NodeRadixLookupV1<Payload, ReadFailure>,
  ReadFailure | NodeRadixTraversalFailureV1,
  Requirements
> {
  return Effect.gen(function* () {
    const limitsIssue = validateLookupLimits(limits);
    if (limitsIssue !== undefined) {
      return yield* Effect.fail(invalidLimitsFailure(limitsIssue));
    }
    const path: RadixMembershipProofStepV1[] = [];
    const seen = new Map<string, number>();
    let current: NodeRadixLookupStateV1 = {
      reference: root,
      depth: 0,
      expectedChildPrefix: undefined,
      root: true,
    };

    while (true) {
      const identity = typedReferenceKey(current.reference);
      const firstSeenDepth = seen.get(identity);
      if (firstSeenDepth !== undefined) {
        return yield* Effect.fail(radixCycleFailure(
          current.reference,
          firstSeenDepth,
          current.depth,
        ));
      }
      if (current.depth > limits.maximumDepth) {
        return yield* Effect.fail(resourceLimitFailure(
          "depth",
          limits.maximumDepth,
          current.depth,
        ));
      }
      const observedObjects = seen.size + 1;
      if (observedObjects > limits.maximumObjects) {
        return yield* Effect.fail(resourceLimitFailure(
          "objects",
          limits.maximumObjects,
          observedObjects,
        ));
      }
      seen.set(identity, current.depth);

      const payload = yield* reader.read(current.reference);
      const branch = shape.branch(payload);
      if (branch !== undefined) {
        if (
          current.expectedChildPrefix !== undefined
          && !branch.prefix.startsWith(current.expectedChildPrefix)
        ) {
          return yield* Effect.fail(radixInvalidFailure(
            current.reference,
            "A selected child branch prefix must extend its parent prefix plus selected nibble",
          ));
        }
        if (branch.children.length === 0) {
          if (!current.root || branch.prefix !== "") {
            return yield* Effect.fail(radixInvalidFailure(
              current.reference,
              "Only the radix root may be an empty branch with prefix \"\"",
            ));
          }
          return {
            state: "absent",
            path: Object.freeze(path),
            terminal: { kind: "empty-root" },
          };
        }
        if (branch.children.length < 2) {
          return yield* Effect.fail(radixInvalidFailure(
            current.reference,
            "Non-empty canonical radix branches require 2..16 children",
          ));
        }
        if (!key.startsWith(branch.prefix)) {
          return {
            state: "absent",
            path: Object.freeze(path),
            terminal: { kind: "prefix-mismatch", branch: current.reference },
          };
        }

        const selectedInput = key[branch.prefix.length];
        if (selectedInput === undefined) {
          return yield* Effect.fail(radixInvalidFailure(
            current.reference,
            "A non-leaf radix branch must stop before the full 64-nibble key",
          ));
        }
        const selectedNibble = radixNibbleForCharacter(selectedInput);
        if (selectedNibble === undefined) {
          return yield* Effect.fail(radixInvalidFailure(
            current.reference,
            "A radix key must select a hexadecimal nibble",
          ));
        }
        const selected = branch.children.find((child) => child.nibble === selectedNibble);
        if (selected === undefined) {
          return {
            state: "absent",
            path: Object.freeze(path),
            terminal: { kind: "missing-child", branch: current.reference, nibble: selectedNibble },
          };
        }

        path.push(Object.freeze({
          branch: current.reference,
          prefix: branch.prefix,
          selectedNibble,
          siblings: Object.freeze(branch.children.filter((child) => child.nibble !== selectedNibble)),
        }));
        current = {
          reference: selected.node,
          depth: current.depth + 1,
          expectedChildPrefix: `${branch.prefix}${selectedNibble}`,
          root: false,
        };
        continue;
      }

      const leaf = shape.leaf(payload);
      if (leaf === undefined) {
        return yield* Effect.fail(radixInvalidFailure(
          current.reference,
          "Radix payload must be a branch or leaf",
        ));
      }
      if (
        current.expectedChildPrefix !== undefined
        && !leaf.key.startsWith(current.expectedChildPrefix)
      ) {
        return yield* Effect.fail(radixInvalidFailure(
          current.reference,
          "A selected child leaf key must extend its parent prefix plus selected nibble",
        ));
      }
      if (leaf.key === key) {
        return {
          state: "found",
          leaf: current.reference,
          payload,
          path: Object.freeze(path),
        };
      }
      return {
        state: "absent",
        path: Object.freeze(path),
        terminal: { kind: "mismatched-leaf", leaf: current.reference },
      };
    }
  });
}

interface NodeRadixLookupStateV1 {
  readonly reference: NodeRefV1;
  readonly depth: number;
  /** The child must continue this exact absolute radix prefix before query matching is considered. */
  readonly expectedChildPrefix: string | undefined;
  readonly root: boolean;
}

const ENTITY_CATALOG_ADAPTER: NodeRadixPayloadAdapter<
  EntityCatalogPayloadV1,
  Schema.Schema.Encoded<typeof EntityCatalogPayloadV1Schema>,
  EntityCatalogKeyV1
> = Object.freeze({
  schema: EntityCatalogPayloadV1Schema,
  mediaType: ENTITY_CATALOG_MEDIA_TYPE,
  validate: validateEntityCatalogPayloadV1,
  strongEdges: entityCatalogStrongEdges,
  branch: entityCatalogBranch,
  leaf: entityCatalogLeaf,
  keyPath: entityCatalogKeyPathV1,
});

const ATTEMPT_LOCATOR_INDEX_ADAPTER: NodeRadixPayloadAdapter<
  AttemptLocatorIndexPayloadV1,
  Schema.Schema.Encoded<typeof AttemptLocatorIndexPayloadV1Schema>,
  AttemptLocatorKeyV1
> = Object.freeze({
  schema: AttemptLocatorIndexPayloadV1Schema,
  mediaType: ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE,
  validate: validateAttemptLocatorIndexPayloadV1,
  strongEdges: attemptLocatorIndexStrongEdges,
  branch: attemptLocatorIndexBranch,
  leaf: attemptLocatorIndexLeaf,
  keyPath: attemptLocatorKeyPathV1,
});

function nodeRadixGraphReader<Payload, Encoded, KeyPreimage, ReadFailure, Requirements>(
  adapter: NodeRadixPayloadAdapter<Payload, Encoded, KeyPreimage>,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): NodeRadixPathReaderV1<
  Payload,
  NodeRadixLookupFailureV1<ReadFailure>,
  Requirements
> {
  return Object.freeze({
    read: (reference: NodeRefV1) => Effect.gen(function* () {
      const decoded = yield* readGraphNodePayloadV1<
        Payload,
        Encoded,
        never,
        ReadFailure,
        Requirements
      >(
        reference,
        adapter.schema,
        adapter.mediaType,
        reader,
      );
      yield* adapter.validate(decoded.payload).pipe(
        Effect.mapError((failure) => protocolFailure<ReadFailure>(reference, failure)),
      );
      yield* verifyKnownNodeStrongEdgesV1<ReadFailure, Requirements>(
        decoded.node,
        adapter.strongEdges(decoded.payload),
        reader,
      );
      return decoded.payload;
    }),
  });
}

function protocolFailure<ReadFailure>(
  reference: NodeRefV1,
  failure: RecordProtocolError,
): NodeRadixLookupFailureV1<ReadFailure> {
  return Object.freeze({ kind: "protocol-failure", reference, failure });
}

function radixInvalidFailure(
  reference: NodeRefV1,
  detail: string,
): NodeRadixTraversalFailureV1 {
  return Object.freeze({ kind: "radix-invalid", reference, detail });
}

function invalidLimitsFailure(
  detail: string,
): NodeRadixTraversalFailureV1 {
  return Object.freeze({ kind: "invalid-limits", detail });
}

function resourceLimitFailure(
  limit: "objects" | "depth",
  maximum: number,
  observed: number,
): NodeRadixTraversalFailureV1 {
  return Object.freeze({ kind: "resource-limit", limit, maximum, observed });
}

function radixCycleFailure(
  reference: NodeRefV1,
  firstSeenDepth: number,
  observedDepth: number,
): NodeRadixTraversalFailureV1 {
  return Object.freeze({
    kind: "radix-cycle",
    reference,
    firstSeenDepth,
    observedDepth,
  });
}

function typedReferenceKey(reference: NodeRefV1): string {
  return `${reference.mediaType}\u0000${reference.digest}\u0000${String(reference.size)}`;
}

function validateLookupLimits(limits: NodeRadixLookupLimitsV1): string | undefined {
  if (!isPositiveSafeInteger(limits.maximumObjects)) {
    return "maximumObjects must be a positive JSON-safe integer";
  }
  if (!isPositiveSafeInteger(limits.maximumDepth)) {
    return "maximumDepth must be a positive JSON-safe integer";
  }
  return undefined;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function radixNibbleForCharacter(value: string): RadixNibbleV1 | undefined {
  switch (value) {
    case "0":
    case "1":
    case "2":
    case "3":
    case "4":
    case "5":
    case "6":
    case "7":
    case "8":
    case "9":
    case "a":
    case "b":
    case "c":
    case "d":
    case "e":
    case "f":
      return value;
    default:
      return undefined;
  }
}

function entityCatalogBranch(
  payload: EntityCatalogPayloadV1,
): NodeRadixBranchV1 | undefined {
  return payload.node === "branch" ? payload : undefined;
}

function entityCatalogLeaf(
  payload: EntityCatalogPayloadV1,
): NodeRadixLeafV1<EntityCatalogKeyV1> | undefined {
  return payload.node === "leaf" ? payload : undefined;
}

function attemptLocatorIndexBranch(
  payload: AttemptLocatorIndexPayloadV1,
): NodeRadixBranchV1 | undefined {
  return payload.node === "branch" ? payload : undefined;
}

function attemptLocatorIndexLeaf(
  payload: AttemptLocatorIndexPayloadV1,
): NodeRadixLeafV1<AttemptLocatorKeyV1> | undefined {
  return payload.node === "leaf" ? payload : undefined;
}
