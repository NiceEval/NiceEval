import { Effect } from "effect";
import {
  COMMITTED_ROOT_PAGE_MEDIA_TYPE,
  CommittedRootPageV1Schema,
  validateCommittedRootPageV1,
  type CommittedRootPageRefV1,
  type DescriptorV1,
  type GraphRootRefV1,
  type RecordProtocolError,
} from "../protocol/core.ts";
import { buildCommittedRootRadixV1 } from "./committed-roots.ts";
import type { RecordGraphObjectReaderV1, RecordGraphReadFailureV1 } from "./read.ts";
import { readTypedRecordGraphObjectV1 } from "./read.ts";

export interface CommittedRootRadixVerificationLimitsV1 {
  readonly maximumObjects: number;
  readonly maximumDepth: number;
}

/** The canonical bootstrap radix has a 64-nibble key depth; callers may choose a lower policy. */
export const DEFAULT_COMMITTED_ROOT_RADIX_VERIFICATION_LIMITS_V1: CommittedRootRadixVerificationLimitsV1 = Object.freeze({
  maximumObjects: 4_096,
  maximumDepth: 64,
});

export type CommittedRootRadixVerificationFailureV1<ReadFailure> =
  | RecordGraphReadFailureV1<ReadFailure>
  | { readonly kind: "invalid-limits"; readonly detail: string }
  | {
      readonly kind: "resource-limit";
      readonly limit: "objects" | "depth";
      readonly maximum: number;
      readonly observed: number;
    }
  | {
      readonly kind: "radix-cycle-or-sharing";
      readonly page: CommittedRootPageRefV1;
      readonly firstSeenDepth: number;
      readonly observedDepth: number;
    }
  | { readonly kind: "radix-invalid"; readonly page: CommittedRootPageRefV1; readonly detail: string }
  | {
      readonly kind: "protocol-failure";
      readonly reference: DescriptorV1;
      readonly failure: RecordProtocolError;
    };

interface PendingCommittedRootPageV1 {
  readonly reference: CommittedRootPageRefV1;
  readonly depth: number;
  readonly expectedChildPrefix: string | undefined;
  readonly root: boolean;
}

/**
 * Enumerates and verifies the whole committed-root bootstrap radix. In addition to descriptor and
 * per-page protocol checks, it rebuilds the canonical tree from disclosed leaves and requires the
 * rebuilt root descriptor to equal `root`; alternate compression, stale children and page sharing
 * therefore cannot be accepted as an equivalent logical set.
 */
export function verifyCommittedRootRadixV1<ReadFailure, Requirements>(
  root: CommittedRootPageRefV1,
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
  limits: CommittedRootRadixVerificationLimitsV1 = DEFAULT_COMMITTED_ROOT_RADIX_VERIFICATION_LIMITS_V1,
): Effect.Effect<
  readonly GraphRootRefV1[],
  CommittedRootRadixVerificationFailureV1<ReadFailure>,
  Requirements
> {
  return Effect.gen(function* () {
    const limitsIssue = validateLimits(limits);
    if (limitsIssue !== undefined) return yield* Effect.fail(limitsIssue);

    const pending: PendingCommittedRootPageV1[] = [{
      reference: root,
      depth: 0,
      expectedChildPrefix: undefined,
      root: true,
    }];
    const seen = new Map<string, number>();
    const leaves: { readonly key: string; readonly graph: GraphRootRefV1 }[] = [];

    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) continue;
      const identity = descriptorKey(current.reference);
      const firstSeenDepth = seen.get(identity);
      if (firstSeenDepth !== undefined) {
        return yield* Effect.fail(Object.freeze({
          kind: "radix-cycle-or-sharing" as const,
          page: current.reference,
          firstSeenDepth,
          observedDepth: current.depth,
        }));
      }
      if (current.depth > limits.maximumDepth) {
        return yield* Effect.fail(resourceLimitFailure("depth", limits.maximumDepth, current.depth));
      }
      const observedObjects = seen.size + 1;
      if (observedObjects > limits.maximumObjects) {
        return yield* Effect.fail(resourceLimitFailure("objects", limits.maximumObjects, observedObjects));
      }
      seen.set(identity, current.depth);

      const page = yield* readTypedRecordGraphObjectV1(
        current.reference,
        CommittedRootPageV1Schema,
        COMMITTED_ROOT_PAGE_MEDIA_TYPE,
        reader,
      );
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
            "A committed-root leaf key must continue its parent absolute prefix plus selected nibble",
          ));
        }
        leaves.push(Object.freeze({ key: page.key, graph: page.graph }));
        continue;
      }

      if (
        current.expectedChildPrefix !== undefined
        && !page.prefix.startsWith(current.expectedChildPrefix)
      ) {
        return yield* Effect.fail(radixInvalidFailure(
          current.reference,
          "A committed-root branch prefix must continue its parent absolute prefix plus selected nibble",
        ));
      }
      if (page.children.length === 0) {
        if (!current.root || page.prefix !== "") {
          return yield* Effect.fail(radixInvalidFailure(
            current.reference,
            "Only the committed-root radix root may be the canonical empty branch",
          ));
        }
        continue;
      }
      if (page.prefix.length >= 64) {
        return yield* Effect.fail(radixInvalidFailure(
          current.reference,
          "A non-empty committed-root branch must stop before the full 64-nibble key",
        ));
      }
      for (let index = page.children.length - 1; index >= 0; index -= 1) {
        const child = page.children[index];
        if (child === undefined) continue;
        pending.push(Object.freeze({
          reference: child.page,
          depth: current.depth + 1,
          expectedChildPrefix: `${page.prefix}${child.nibble}`,
          root: false,
        }));
      }
    }

    const canonicalLeaves = leaves.sort((left, right) =>
      left.key < right.key ? -1 : left.key > right.key ? 1 : 0
    );
    const rebuilt = yield* buildCommittedRootRadixV1(canonicalLeaves.map((leaf) => leaf.graph)).pipe(
      Effect.mapError((failure) => protocolFailure(root, failure)),
    );
    if (!sameDescriptor(root, rebuilt.root)) {
      return yield* Effect.fail(radixInvalidFailure(
        root,
        "Committed-root pages must equal the unique canonical radix rebuilt from their leaves",
      ));
    }
    return Object.freeze(canonicalLeaves.map((leaf) => leaf.graph));
  });
}

function validateLimits(
  limits: CommittedRootRadixVerificationLimitsV1,
): { readonly kind: "invalid-limits"; readonly detail: string } | undefined {
  if (!isPositiveSafeInteger(limits.maximumObjects)) {
    return Object.freeze({ kind: "invalid-limits", detail: "maximumObjects must be a positive JSON-safe integer" });
  }
  if (!isPositiveSafeInteger(limits.maximumDepth)) {
    return Object.freeze({ kind: "invalid-limits", detail: "maximumDepth must be a positive JSON-safe integer" });
  }
  return undefined;
}

function resourceLimitFailure(
  limit: "objects" | "depth",
  maximum: number,
  observed: number,
): CommittedRootRadixVerificationFailureV1<never> {
  return Object.freeze({ kind: "resource-limit", limit, maximum, observed });
}

function radixInvalidFailure(
  page: CommittedRootPageRefV1,
  detail: string,
): CommittedRootRadixVerificationFailureV1<never> {
  return Object.freeze({ kind: "radix-invalid", page, detail });
}

function protocolFailure(
  reference: DescriptorV1,
  failure: RecordProtocolError,
): CommittedRootRadixVerificationFailureV1<never> {
  return Object.freeze({ kind: "protocol-failure", reference, failure });
}

function descriptorKey(reference: DescriptorV1): string {
  return `${reference.mediaType}\u0000${reference.digest}\u0000${String(reference.size)}`;
}

function sameDescriptor(left: DescriptorV1, right: DescriptorV1): boolean {
  return left.mediaType === right.mediaType && left.digest === right.digest && left.size === right.size;
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
