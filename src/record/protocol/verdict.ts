import { Effect, Schema } from "effect";
import {
  canonicalJsonBytes,
  compareCanonicalBytes,
} from "./canonical.ts";
import {
  decodeProtocolSchema,
  DigestV1Schema,
  type DigestV1,
  NodeRefV1Schema,
  type NodeRefV1,
  NonEmptyProtocolStringSchema,
  sha256DigestOfBytes,
  typedReferenceEquals,
} from "./core.ts";
import {
  AttemptIdSchema,
  EntityCatalogKeyV1Schema,
  type EntityCatalogKeyV1,
} from "./entities.ts";
import {
  EvidenceTargetSchema,
  type EvidenceTarget,
  type ObjectEvidenceTarget,
  validateClaimPayloadV1,
} from "./evidence.ts";
import {
  recordProtocolError,
  type RecordProtocolError,
} from "./errors.ts";

export const VERDICT_CLAIM_KIND: "verdict" = "verdict";
export const VERDICT_CLAIM_SCHEMA: "niceeval.verdict/1" = "niceeval.verdict/1";
export const VERDICT_CLAIM_ID_PREIMAGE_SCHEMA: "niceeval.verdict-claim-id/1" =
  "niceeval.verdict-claim-id/1";
export const VERDICT_EVALUATOR_NAMESPACE: "niceeval" = "niceeval";
export const VERDICT_EVALUATOR_NAME: "verdict" = "verdict";
export const VERDICT_EVALUATOR_VERSION: "1" = "1";

export const VerdictV1Schema = Schema.Literal(
  "passed",
  "failed",
  "errored",
  "skipped",
);

export type VerdictV1 = Schema.Schema.Type<typeof VerdictV1Schema>;

export const VerdictClaimValueV1Schema = Schema.Struct({
  verdict: VerdictV1Schema,
  strict: Schema.Boolean,
});

export type VerdictClaimValueV1 = Schema.Schema.Type<
  typeof VerdictClaimValueV1Schema
>;

export const VerdictClaimIdPreimageV1Schema = Schema.Struct({
  schema: Schema.Literal(VERDICT_CLAIM_ID_PREIMAGE_SCHEMA),
  attempt: NodeRefV1Schema,
});

export type VerdictClaimIdPreimageV1 = Schema.Schema.Type<
  typeof VerdictClaimIdPreimageV1Schema
>;

export const BuiltInVerdictClaimV1Schema = Schema.Struct({
  id: DigestV1Schema,
  kind: Schema.Literal(VERDICT_CLAIM_KIND),
  schema: Schema.Literal(VERDICT_CLAIM_SCHEMA),
  value: VerdictClaimValueV1Schema,
  evaluator: Schema.Struct({
    namespace: Schema.Literal(VERDICT_EVALUATOR_NAMESPACE),
    name: Schema.Literal(VERDICT_EVALUATOR_NAME),
    version: Schema.Literal(VERDICT_EVALUATOR_VERSION),
  }),
  basedOn: Schema.Array(EvidenceTargetSchema),
  producedAt: NonEmptyProtocolStringSchema,
});

export type BuiltInVerdictClaimV1 = Schema.Schema.Type<
  typeof BuiltInVerdictClaimV1Schema
>;

export const BuiltInVerdictClaimPayloadV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.claim/1"),
  scope: Schema.Struct({
    kind: Schema.Literal("attempt"),
    attemptId: AttemptIdSchema,
  }),
  claim: BuiltInVerdictClaimV1Schema,
});

export type BuiltInVerdictClaimPayloadV1 = Schema.Schema.Type<
  typeof BuiltInVerdictClaimPayloadV1Schema
>;

export interface ValidatedBuiltInVerdictClaimV1 {
  readonly payload: BuiltInVerdictClaimPayloadV1;
  /** The only selector-free object basis target; it is the exact judged Attempt revision. */
  readonly anchor: ObjectEvidenceTarget;
}

/** The frozen preimage is the only identity input; recordId, attemptId and wall time are excluded. */
export function verdictClaimIdPreimageV1(
  attemptInput: unknown,
): Effect.Effect<VerdictClaimIdPreimageV1, RecordProtocolError> {
  return decodeProtocolSchema(
    NodeRefV1Schema,
    attemptInput,
    "derive-verdict-claim-id",
  ).pipe(
    Effect.map((attempt) => Object.freeze({
      schema: VERDICT_CLAIM_ID_PREIMAGE_SCHEMA,
      attempt,
    })),
  );
}

/** RFC 8785 JCS UTF-8 followed by SHA-256, encoded as `sha256:<64 lowercase hex>`. */
export function verdictClaimIdForAttemptV1(
  attemptInput: unknown,
): Effect.Effect<DigestV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const preimage = yield* verdictClaimIdPreimageV1(attemptInput);
    return yield* sha256DigestOfBytes(yield* canonicalJsonBytes(preimage));
  });
}

/** Exact entity-catalog point lookup key used by the verifier and built-in Projector. */
export function verdictClaimCatalogKeyForAttemptV1(
  attemptInput: unknown,
): Effect.Effect<EntityCatalogKeyV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const id = yield* verdictClaimIdForAttemptV1(attemptInput);
    return yield* decodeProtocolSchema(
      EntityCatalogKeyV1Schema,
      {
        schema: "niceeval.entity-catalog-key/1",
        kind: "claim",
        id,
      },
      "derive-verdict-claim-catalog-key",
    );
  });
}

/**
 * A selector-free object basis is reserved for the judged Attempt anchor. Verdict inputs other
 * than that anchor are Claim, event or authenticated-absence targets.
 */
export function verdictClaimAnchorForAttemptV1(
  attemptInput: unknown,
): Effect.Effect<ObjectEvidenceTarget, RecordProtocolError> {
  return decodeProtocolSchema(
    NodeRefV1Schema,
    attemptInput,
    "derive-verdict-claim-anchor",
  ).pipe(
    Effect.map((attempt) => Object.freeze({ kind: "object" as const, node: attempt })),
  );
}

/** True only for the frozen built-in semantic identity; it does not validate value or basis. */
export function hasBuiltInVerdictClaimIdentityV1(
  payload: { readonly claim: {
    readonly kind: string;
    readonly schema: string;
    readonly evaluator: {
      readonly namespace: string;
      readonly name: string;
      readonly version: string;
      readonly model?: string;
    };
  } },
): boolean {
  return payload.claim.kind === VERDICT_CLAIM_KIND
    && payload.claim.schema === VERDICT_CLAIM_SCHEMA
    && payload.claim.evaluator.namespace === VERDICT_EVALUATOR_NAMESPACE
    && payload.claim.evaluator.name === VERDICT_EVALUATOR_NAME
    && payload.claim.evaluator.version === VERDICT_EVALUATOR_VERSION
    && payload.claim.evaluator.model === undefined;
}

/**
 * Decode and bind a catalog occupant to one exact Attempt revision. Graph verification separately
 * checks that the generic Claim strong-edge sequence equals the validated `basedOn` sequence.
 */
export function validateBuiltInVerdictClaimForAttemptV1(
  payloadInput: unknown,
  attemptInput: unknown,
): Effect.Effect<ValidatedBuiltInVerdictClaimV1, RecordProtocolError> {
  return Effect.gen(function*() {
    const attempt = yield* decodeProtocolSchema(
      NodeRefV1Schema,
      attemptInput,
      "validate-verdict-claim-attempt",
    );
    const payload = yield* decodeProtocolSchema(
      BuiltInVerdictClaimPayloadV1Schema,
      payloadInput,
      "validate-verdict-claim",
    );
    yield* validateClaimPayloadV1(payload);

    const expectedId = yield* verdictClaimIdForAttemptV1(attempt);
    if (payload.claim.id !== expectedId) {
      return yield* Effect.fail(verdictInvariant(
        ["claim", "id"],
        "Built-in Verdict Claim id must be derived from the exact Attempt revision anchor",
        expectedId,
        payload.claim.id,
      ));
    }

    const selectorFreeObjects = payload.claim.basedOn.filter(
      (target): target is ObjectEvidenceTarget =>
        target.kind === "object" && target.selector === undefined,
    );
    if (
      selectorFreeObjects.length !== 1
      || !typedReferenceEquals(selectorFreeObjects[0].node, attempt)
    ) {
      return yield* Effect.fail(verdictInvariant(
        ["claim", "basedOn"],
        "Built-in Verdict Claim must have exactly one selector-free object basis targeting the exact Attempt revision",
      ));
    }

    return Object.freeze({
      payload,
      anchor: selectorFreeObjects[0],
    });
  });
}

/** Used by producers before generic Claim canonical sorting. */
export function verdictClaimBasisForAttemptV1(
  attempt: NodeRefV1,
  consumed: readonly EvidenceTarget[],
): Effect.Effect<readonly EvidenceTarget[], RecordProtocolError> {
  return Effect.gen(function*() {
    const extraAnchorIndex = consumed.findIndex(
      (target) => target.kind === "object" && target.selector === undefined,
    );
    if (extraAnchorIndex !== -1) {
      return yield* Effect.fail(verdictInvariant(
        ["claim", "basedOn", String(extraAnchorIndex + 1)],
        "Only the exact judged Attempt revision may be a selector-free object basis target",
      ));
    }

    const anchor = yield* verdictClaimAnchorForAttemptV1(attempt);
    const encoded = yield* Effect.forEach(
      [anchor, ...consumed],
      (target) => canonicalJsonBytes(target).pipe(
        Effect.map((bytes) => Object.freeze({ target, bytes })),
      ),
    );
    encoded.sort((left, right) =>
      compareCanonicalBytes(left.bytes, right.bytes)
    );
    for (let index = 1; index < encoded.length; index += 1) {
      if (
        compareCanonicalBytes(encoded[index - 1].bytes, encoded[index].bytes)
          === 0
      ) {
        return yield* Effect.fail(verdictInvariant(
          ["claim", "basedOn", String(index)],
          "Built-in Verdict Claim basis must not contain duplicate EvidenceTarget values",
        ));
      }
    }
    return Object.freeze(encoded.map((entry) => entry.target));
  });
}

function verdictInvariant(
  path: readonly string[],
  message: string,
  expected?: string,
  actual?: string,
): RecordProtocolError {
  return recordProtocolError({
    code: "payload-invariant-invalid",
    operation: "validate-verdict-claim",
    path,
    message,
    ...(expected === undefined ? {} : { expected }),
    ...(actual === undefined ? {} : { actual }),
  });
}
