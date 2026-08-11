import { Effect } from "effect";
import {
  COMMITTED_ROOT_PAGE_MEDIA_TYPE,
  CommittedRootPageV1Schema,
  typedReferenceEquals,
  validateCommittedRootPageV1,
  type CommittedRootPageRefV1,
  type CommittedRootPageV1,
  type GraphRootRefV1,
  type RadixNibbleV1,
  type RadixPathV1,
  type RecordProtocolError,
} from "../protocol/core.ts";
import { committedRootKeyPathV1 } from "./committed-roots.ts";
import type { RecordGraphObjectReaderV1, RecordGraphReadFailureV1 } from "./read.ts";
import { readTypedRecordGraphObjectV1 } from "./read.ts";

export interface CommittedRootRadixProofStepV1 {
  readonly branch: CommittedRootPageRefV1;
  readonly prefix: RadixPathV1;
  readonly selectedNibble: RadixNibbleV1;
  readonly siblings: readonly {
    readonly nibble: RadixNibbleV1;
    readonly page: CommittedRootPageRefV1;
  }[];
}

export type CommittedRootRadixTerminalV1 =
  | { readonly kind: "empty-root" }
  | { readonly kind: "prefix-mismatch"; readonly branch: CommittedRootPageRefV1 }
  | {
      readonly kind: "missing-child";
      readonly branch: CommittedRootPageRefV1;
      readonly nibble: RadixNibbleV1;
    }
  | { readonly kind: "mismatched-leaf"; readonly leaf: CommittedRootPageRefV1 };

export interface CommittedRootLookupLimitsV1 {
  readonly maximumObjects: number;
  readonly maximumDepth: number;
}

/** A legal v1 radix path has at most 64 selected nibbles plus its root. */
export const DEFAULT_COMMITTED_ROOT_LOOKUP_LIMITS_V1: CommittedRootLookupLimitsV1 = Object.freeze({
  maximumObjects: 65,
  maximumDepth: 64,
});

export type CommittedRootTraversalFailureV1 =
  | { readonly kind: "radix-invalid"; readonly page: CommittedRootPageRefV1; readonly detail: string }
  | { readonly kind: "invalid-limits"; readonly detail: string }
  | {
      readonly kind: "resource-limit";
      readonly limit: "objects" | "depth";
      readonly maximum: number;
      readonly observed: number;
    }
  | {
      readonly kind: "radix-cycle";
      readonly page: CommittedRootPageRefV1;
      readonly firstSeenDepth: number;
      readonly observedDepth: number;
    }
  | {
      readonly kind: "protocol-failure";
      readonly reference: CommittedRootPageRefV1;
      readonly failure: RecordProtocolError;
    };

export type CommittedRootLookupFailureV1<ReadFailure> =
  | RecordGraphReadFailureV1<ReadFailure>
  | CommittedRootTraversalFailureV1;

export type CommittedRootLookupV1<ReadFailure> =
  | {
      readonly state: "found";
      readonly leaf: CommittedRootPageRefV1;
      readonly page: Extract<CommittedRootPageV1, { readonly node: "leaf" }>;
      readonly path: readonly CommittedRootRadixProofStepV1[];
    }
  | {
      readonly state: "absent";
      readonly path: readonly CommittedRootRadixProofStepV1[];
      readonly terminal: CommittedRootRadixTerminalV1;
    };

/** Injects page decoding; the traversal itself remains independent of store or mirror services. */
export interface CommittedRootRadixPageReaderV1<ReadFailure, Requirements> {
  readonly read: (
    reference: CommittedRootPageRefV1,
  ) => Effect.Effect<CommittedRootPageV1, ReadFailure, Requirements>;
}

/** Looks up a fixed GraphRootRef in an append-only committed-root radix. */
export function lookupCommittedRootV1<ReadFailure, Requirements>(
  root: CommittedRootPageRefV1,
  graph: GraphRootRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: CommittedRootLookupLimitsV1 = DEFAULT_COMMITTED_ROOT_LOOKUP_LIMITS_V1,
): Effect.Effect<
  CommittedRootLookupV1<ReadFailure>,
  CommittedRootLookupFailureV1<ReadFailure>,
  Requirements
> {
  return committedRootKeyPathV1(graph).pipe(
    Effect.mapError((failure) => protocolFailure(root, failure)),
    Effect.flatMap((key) => followCommittedRootRadixPathV1(
      root,
      key,
      Object.freeze({
        read: (reference: CommittedRootPageRefV1) => readTypedRecordGraphObjectV1(
          reference,
          CommittedRootPageV1Schema,
          COMMITTED_ROOT_PAGE_MEDIA_TYPE,
          reader,
        ),
      }),
      limits,
    )),
    Effect.flatMap((result) => {
      if (
        result.state === "found"
        && !committedRootLookupMatchesGraphV1(graph, result.page)
      ) {
        return Effect.fail(radixInvalidFailure(
          result.leaf,
          "A committed-root lookup leaf keyPreimage.graph and graph must equal the requested full GraphRootRef",
        ));
      }
      return Effect.succeed(result);
    }),
  );
}

/** Concrete lookup binding is intentionally separate from hash-path traversal. */
export function committedRootLookupMatchesGraphV1(
  requested: GraphRootRefV1,
  leaf: Extract<CommittedRootPageV1, { readonly node: "leaf" }>,
): boolean {
  return typedReferenceEquals(requested, leaf.keyPreimage.graph)
    && typedReferenceEquals(requested, leaf.graph);
}

/**
 * Bounded committed-root radix traversal. Every fetched page passes protocol invariant validation
 * before it may contribute a membership, absence or successor proof step.
 */
export function followCommittedRootRadixPathV1<ReadFailure, Requirements>(
  root: CommittedRootPageRefV1,
  key: RadixPathV1,
  reader: CommittedRootRadixPageReaderV1<ReadFailure, Requirements>,
  limits: CommittedRootLookupLimitsV1 = DEFAULT_COMMITTED_ROOT_LOOKUP_LIMITS_V1,
): Effect.Effect<
  CommittedRootLookupV1<ReadFailure>,
  ReadFailure | CommittedRootTraversalFailureV1,
  Requirements
> {
  return Effect.gen(function* () {
    const limitsIssue = validateLookupLimits(limits);
    if (limitsIssue !== undefined) {
      return yield* Effect.fail(invalidLimitsFailure(limitsIssue));
    }

    const path: CommittedRootRadixProofStepV1[] = [];
    const seen = new Map<string, number>();
    let current: CommittedRootLookupStateV1 = {
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

      const page = yield* reader.read(current.reference);
      yield* validateCommittedRootPageV1(page).pipe(
        Effect.mapError((failure) => protocolFailure(current.reference, failure)),
      );

      if (page.node === "leaf") {
        if (
          current.expectedChildPrefix !== undefined
          && !page.key.startsWith(current.expectedChildPrefix)
        ) {
          return yield* Effect.fail(radixInvalidFailure(
            current.reference,
            "A selected child leaf key must extend its parent prefix plus selected nibble",
          ));
        }
        if (page.key === key) {
          return {
            state: "found",
            leaf: current.reference,
            page,
            path: Object.freeze(path),
          };
        }
        return {
          state: "absent",
          path: Object.freeze(path),
          terminal: { kind: "mismatched-leaf", leaf: current.reference },
        };
      }

      if (
        current.expectedChildPrefix !== undefined
        && !page.prefix.startsWith(current.expectedChildPrefix)
      ) {
        return yield* Effect.fail(radixInvalidFailure(
          current.reference,
          "A selected child branch prefix must extend its parent prefix plus selected nibble",
        ));
      }
      if (page.children.length === 0) {
        if (!current.root || page.prefix !== "") {
          return yield* Effect.fail(radixInvalidFailure(
            current.reference,
            "Only the committed-root radix root may be an empty branch with prefix \"\"",
          ));
        }
        return {
          state: "absent",
          path: Object.freeze(path),
          terminal: { kind: "empty-root" },
        };
      }
      if (!key.startsWith(page.prefix)) {
        return {
          state: "absent",
          path: Object.freeze(path),
          terminal: { kind: "prefix-mismatch", branch: current.reference },
        };
      }

      const selectedInput = key[page.prefix.length];
      if (selectedInput === undefined) {
        return yield* Effect.fail(radixInvalidFailure(
          current.reference,
          "A committed-root branch must stop before the full key",
        ));
      }
      const selectedNibble = radixNibbleForCharacter(selectedInput);
      if (selectedNibble === undefined) {
        return yield* Effect.fail(radixInvalidFailure(
          current.reference,
          "A committed-root radix key must select a hexadecimal nibble",
        ));
      }
      const selected = page.children.find((child) => child.nibble === selectedNibble);
      if (selected === undefined) {
        return {
          state: "absent",
          path: Object.freeze(path),
          terminal: { kind: "missing-child", branch: current.reference, nibble: selectedNibble },
        };
      }
      path.push(Object.freeze({
        branch: current.reference,
        prefix: page.prefix,
        selectedNibble,
        siblings: Object.freeze(page.children.filter((child) => child.nibble !== selectedNibble)),
      }));
      current = {
        reference: selected.page,
        depth: current.depth + 1,
        expectedChildPrefix: `${page.prefix}${selectedNibble}`,
        root: false,
      };
    }
  });
}

interface CommittedRootLookupStateV1 {
  readonly reference: CommittedRootPageRefV1;
  readonly depth: number;
  readonly expectedChildPrefix: string | undefined;
  readonly root: boolean;
}

function protocolFailure(
  reference: CommittedRootPageRefV1,
  failure: RecordProtocolError,
): CommittedRootTraversalFailureV1 {
  return Object.freeze({ kind: "protocol-failure", reference, failure });
}

function radixInvalidFailure(
  page: CommittedRootPageRefV1,
  detail: string,
): CommittedRootTraversalFailureV1 {
  return Object.freeze({ kind: "radix-invalid", page, detail });
}

function invalidLimitsFailure(detail: string): CommittedRootTraversalFailureV1 {
  return Object.freeze({ kind: "invalid-limits", detail });
}

function resourceLimitFailure(
  limit: "objects" | "depth",
  maximum: number,
  observed: number,
): CommittedRootTraversalFailureV1 {
  return Object.freeze({ kind: "resource-limit", limit, maximum, observed });
}

function radixCycleFailure(
  page: CommittedRootPageRefV1,
  firstSeenDepth: number,
  observedDepth: number,
): CommittedRootTraversalFailureV1 {
  return Object.freeze({
    kind: "radix-cycle",
    page,
    firstSeenDepth,
    observedDepth,
  });
}

function typedReferenceKey(reference: CommittedRootPageRefV1): string {
  return `${reference.mediaType}\u0000${reference.digest}\u0000${String(reference.size)}`;
}

function validateLookupLimits(limits: CommittedRootLookupLimitsV1): string | undefined {
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
