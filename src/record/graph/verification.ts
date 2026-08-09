import { Either, Effect } from "effect";
import type {
  DescriptorV1,
  RecordGraphRefV1,
  RecordProtocolError,
} from "../protocol/core.ts";
import type { RecordProtocolCodecRegistryV1 } from "../protocol/codecs.ts";
import {
  graphRootClosureStepV1,
  recordGraphCoreStrongClosureProtocolV1,
  type RecordGraphCoreExpectationV1,
} from "./core.ts";
import {
  verifyKnownPayloadEdgesForGraphNodeV1,
  type KnownPayloadEdgeVerificationV1,
} from "./known-payload.ts";
import type {
  DependencyStrongEdgeReadLimitsV1,
  RecordGraphObjectReaderV1,
  RecordGraphReadFailureV1,
} from "./read.ts";
import {
  walkStrongClosure,
  type StrongClosureFailure,
  type StrongClosureResourceLimit,
  type StrongClosureUsage,
} from "./traversal.ts";

export type RecordGraphVerificationLimitNameV1 = "objects" | "depth" | "bytes";

/**
 * Full graph verification never silently runs unbounded. The Store, mirror or GC caller owns
 * these policy values and can surface the original limit and observed usage in its API failure.
 */
export interface RecordGraphVerificationLimitsV1 {
  readonly objects: StrongClosureResourceLimit<"objects">;
  readonly depth: StrongClosureResourceLimit<"depth">;
  readonly bytes: StrongClosureResourceLimit<"bytes">;
}

export interface RecordGraphCompleteVerificationInputV1<ReadFailure, Requirements> {
  readonly source: RecordGraphRefV1;
  readonly registry: RecordProtocolCodecRegistryV1;
  readonly reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>;
  readonly limits: RecordGraphVerificationLimitsV1;
}

export interface RecordGraphVerificationConfigurationFailureV1 {
  readonly kind: "invalid-verification-limit";
  readonly limit: RecordGraphVerificationLimitNameV1;
  readonly maximum: number;
}

export type RecordGraphCompleteVerificationFailureV1<ReadFailure> =
  | StrongClosureFailure<
      DescriptorV1,
      RecordGraphCoreExpectationV1,
      RecordProtocolError,
      ReadFailure,
      RecordGraphVerificationLimitNameV1
    >
  | {
      readonly kind: "known-payload-invalid";
      /** GraphNode wrapper whose known payload-derived edge contract failed. */
      readonly node: DescriptorV1;
      readonly failure: RecordGraphReadFailureV1<ReadFailure>;
    };

export type RecordGraphCompleteVerificationV1<ReadFailure> =
  | {
      readonly state: "complete";
      readonly usage: StrongClosureUsage;
      /** Canonical core-walk order, one entry for every discovered GraphNode. */
      readonly payloads: readonly KnownPayloadEdgeVerificationV1[];
    }
  | {
      readonly state: "invalid";
      readonly usage: StrongClosureUsage;
      readonly failures: readonly RecordGraphCompleteVerificationFailureV1<ReadFailure>[];
    };

/**
 * Verifies a whole Record graph at a supplied `RecordGraphRefV1` trust boundary.
 *
 * First it executes the frozen core closure, including descriptor identity, GraphRoot/GraphNode/
 * EdgePage canonical form and dependency-page cycle checks. Only if that closure is complete, it
 * revisits every discovered GraphNode through the injected codec registry and compares a known
 * payload's codec-derived edge sequence with its flattened dependency pages. Unknown media types
 * remain opaque: their exact descriptor-checked bytes are read through the registry but are never
 * parsed, normalized or re-encoded.
 *
 * The memoizing reader makes the second pass consume the exact bytes already accounted for by the
 * core walk; therefore `usage.bytes` covers both core and codec-aware verification rather than
 * permitting an unmetered reread. This is the common pure adapter intended for commit, mirror and
 * GC validation boundaries.
 *
 * “Complete” here means every object in the frozen strong closure and every known payload edge
 * contract has been checked. Cross-revision catalog replacement, full stream-prefix append proof
 * and Store committed-membership are deliberately separate domain/Store checks; callers must not
 * treat this core-and-codec result as proof of those higher-level facts.
 */
export function verifyRecordGraphCompleteV1<ReadFailure, Requirements>(
  input: RecordGraphCompleteVerificationInputV1<ReadFailure, Requirements>,
): Effect.Effect<
  RecordGraphCompleteVerificationV1<ReadFailure>,
  RecordGraphVerificationConfigurationFailureV1,
  Requirements
> {
  return Effect.gen(function* () {
    const configurationFailure = validateVerificationLimits(input.limits);
    if (configurationFailure !== undefined) {
      return yield* Effect.fail(configurationFailure);
    }

    const reader = memoizingReaderV1(input.reader);
    const core = yield* walkStrongClosure({
      root: graphRootClosureStepV1(input.source.graph),
      protocol: recordGraphCoreStrongClosureProtocolV1(),
      reader,
      limits: input.limits,
    });
    if (core.state === "invalid") {
      return Object.freeze({
        state: "invalid" as const,
        usage: core.usage,
        failures: core.failures,
      });
    }

    const payloads: KnownPayloadEdgeVerificationV1[] = [];
    const failures: RecordGraphCompleteVerificationFailureV1<ReadFailure>[] = [];
    const dependencyLimits: DependencyStrongEdgeReadLimitsV1 = Object.freeze({
      maximumObjects: input.limits.objects.maximum,
      maximumBytes: input.limits.bytes.maximum,
    });
    for (const step of core.visited) {
      if (step.expected.kind !== "graph-node") continue;
      const verification = yield* Effect.either(
        verifyKnownPayloadEdgesForGraphNodeV1(
          step.reference,
          input.registry,
          reader,
          dependencyLimits,
        ),
      );
      if (Either.isLeft(verification)) {
        failures.push(Object.freeze({
          kind: "known-payload-invalid",
          node: step.reference,
          failure: verification.left,
        }));
      } else {
        payloads.push(verification.right);
      }
    }
    if (failures.length > 0) {
      return Object.freeze({
        state: "invalid" as const,
        usage: core.usage,
        failures: Object.freeze(failures),
      });
    }
    return Object.freeze({
      state: "complete" as const,
      usage: core.usage,
      payloads: Object.freeze(payloads),
    });
  });
}

function memoizingReaderV1<ReadFailure, Requirements>(
  reader: RecordGraphObjectReaderV1<ReadFailure, Requirements>,
): RecordGraphObjectReaderV1<ReadFailure, Requirements> {
  const objects = new Map<string, Uint8Array>();
  return Object.freeze({
    read: (reference: DescriptorV1) => {
      const key = descriptorKey(reference);
      const cached = objects.get(key);
      if (cached !== undefined) return Effect.succeed(cached);
      return reader.read(reference).pipe(
        Effect.tap((bytes) => {
          if (bytes !== undefined) objects.set(key, bytes);
        }),
      );
    },
  });
}

function validateVerificationLimits(
  limits: RecordGraphVerificationLimitsV1,
): RecordGraphVerificationConfigurationFailureV1 | undefined {
  const values: readonly [RecordGraphVerificationLimitNameV1, StrongClosureResourceLimit<RecordGraphVerificationLimitNameV1>][] = [
    ["objects", limits.objects],
    ["depth", limits.depth],
    ["bytes", limits.bytes],
  ];
  for (const [name, limit] of values) {
    if (limit.name !== name || !Number.isSafeInteger(limit.maximum) || limit.maximum < 1) {
      return Object.freeze({
        kind: "invalid-verification-limit",
        limit: name,
        maximum: limit.maximum,
      });
    }
  }
  return undefined;
}

function descriptorKey(reference: DescriptorV1): string {
  return `${reference.mediaType}\u0000${reference.digest}\u0000${String(reference.size)}`;
}
