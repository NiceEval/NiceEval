import { Effect, Schema } from "effect";
import { canonicalJsonBytes, compareCanonicalBytes } from "./canonical.ts";
import {
  JsonSafeUnsignedIntegerSchema,
  NodeRefV1Schema,
  type NodeRefV1,
  NonEmptyProtocolStringSchema,
  RadixNibbleV1Schema,
  RadixPathV1Schema,
  radixPathForCanonicalValue,
  RecordGraphRefV1Schema,
  type StrongEdgeV1,
  typedReferenceEquals,
} from "./core.ts";
import {
  recordProtocolError,
  type RecordProtocolError,
} from "./errors.ts";

export const RECORD_SUBJECT_MEDIA_TYPE: "application/vnd.niceeval.record.v1+jcs" =
  "application/vnd.niceeval.record.v1+jcs";
export const ENTITY_CATALOG_MEDIA_TYPE: "application/vnd.niceeval.entity-catalog.v1+jcs" =
  "application/vnd.niceeval.entity-catalog.v1+jcs";
export const ATTEMPT_LOCATOR_INDEX_MEDIA_TYPE: "application/vnd.niceeval.attempt-locator-index.v1+jcs" =
  "application/vnd.niceeval.attempt-locator-index.v1+jcs";
export const RUN_MEDIA_TYPE: "application/vnd.niceeval.run.v1+jcs" =
  "application/vnd.niceeval.run.v1+jcs";
export const ATTEMPT_MEDIA_TYPE: "application/vnd.niceeval.attempt.v1+jcs" =
  "application/vnd.niceeval.attempt.v1+jcs";
export const RUN_CONTRIBUTION_MEDIA_TYPE: "application/vnd.niceeval.run-contribution.v1+jcs" =
  "application/vnd.niceeval.run-contribution.v1+jcs";

const ATTEMPT_ID_PATTERN = /^[0-9a-f]{32}$/;
const ATTEMPT_LOCATOR_PATTERN = /^@[0-7][0-9ABCDEFGHJKMNPQRSTVWXYZ]{25}$/;
const NORMALIZABLE_ATTEMPT_LOCATOR_PATTERN =
  /^@[0-7][0-9A-HJ-KM-NP-TV-Za-hj-km-np-tv-z]{25}$/;
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const UTF8_ENCODER = new TextEncoder();

export const AttemptIdSchema = Schema.String.pipe(
  Schema.filter((value) => ATTEMPT_ID_PATTERN.test(value), {
    identifier: "AttemptId",
    description: "exactly 32 lowercase hexadecimal characters",
  }),
  Schema.brand("niceeval.AttemptId"),
);

export type AttemptId = Schema.Schema.Type<typeof AttemptIdSchema>;

export const AttemptLocatorSchema = Schema.String.pipe(
  Schema.filter((value) => ATTEMPT_LOCATOR_PATTERN.test(value), {
    identifier: "AttemptLocator",
    description: "@ followed by 26 canonical uppercase Crockford characters",
  }),
  Schema.brand("niceeval.AttemptLocator"),
);

export type AttemptLocator = Schema.Schema.Type<typeof AttemptLocatorSchema>;

export const RevisionV1Schema = JsonSafeUnsignedIntegerSchema;

function canonicalLocatorText(attemptId: string): string {
  let remaining = BigInt(`0x${attemptId}`);
  const body = new Array<string>(26);
  for (let index = body.length - 1; index >= 0; index -= 1) {
    const digit = Number(remaining & 31n);
    body[index] = CROCKFORD_ALPHABET[digit];
    remaining >>= 5n;
  }
  return `@${body.join("")}`;
}

export function attemptLocatorOfAttemptId(
  input: unknown,
): Effect.Effect<AttemptLocator, RecordProtocolError> {
  return Schema.decodeUnknown(AttemptIdSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(input).pipe(
    Effect.mapError((cause) =>
      recordProtocolError({
        code: "schema-invalid",
        operation: "encode-attempt-locator",
        path: ["attemptId"],
        message: String(cause),
      })
    ),
    Effect.flatMap((attemptId) =>
      Schema.decodeUnknown(AttemptLocatorSchema)(canonicalLocatorText(attemptId)).pipe(
        Effect.mapError((cause) =>
          recordProtocolError({
            code: "payload-invariant-invalid",
            operation: "encode-attempt-locator",
            message: String(cause),
          })
        ),
      )
    ),
  );
}

export function normalizeAttemptLocator(
  input: unknown,
): Effect.Effect<AttemptLocator, RecordProtocolError> {
  if (
    typeof input !== "string"
    || !NORMALIZABLE_ATTEMPT_LOCATOR_PATTERN.test(input)
  ) {
    return Effect.fail(recordProtocolError({
      code: "schema-invalid",
      operation: "normalize-attempt-locator",
      message:
        "Attempt locator must contain only ASCII Crockford characters and must exclude I, L, O and U",
    }));
  }
  return Schema.decodeUnknown(AttemptLocatorSchema)(input.toUpperCase()).pipe(
    Effect.mapError((cause) =>
      recordProtocolError({
        code: "schema-invalid",
        operation: "normalize-attempt-locator",
        message: String(cause),
      })
    ),
  );
}

export const RecordSubjectV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.record/1"),
  recordId: NonEmptyProtocolStringSchema,
  revision: RevisionV1Schema,
  previous: Schema.NullOr(NodeRefV1Schema),
  catalog: NodeRefV1Schema,
  locatorIndex: NodeRefV1Schema,
});

export type RecordSubjectV1 = Schema.Schema.Type<typeof RecordSubjectV1Schema>;

export const EntityKindSchema = Schema.Literal(
  "run",
  "attempt",
  "stream",
  "claim",
  "contribution",
);

export type EntityKind = Schema.Schema.Type<typeof EntityKindSchema>;

export const EntityCatalogKeyV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.entity-catalog-key/1"),
  kind: EntityKindSchema,
  id: NonEmptyProtocolStringSchema,
});

export type EntityCatalogKeyV1 = Schema.Schema.Type<
  typeof EntityCatalogKeyV1Schema
>;

export const EntityCatalogSelectorV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.entity-catalog-selector/1"),
  value: EntityCatalogKeyV1Schema,
});

export type EntityCatalogSelectorV1 = Schema.Schema.Type<
  typeof EntityCatalogSelectorV1Schema
>;

const EntityCatalogBranchChildV1Schema = Schema.Struct({
  nibble: RadixNibbleV1Schema,
  node: NodeRefV1Schema,
});

export const EntityCatalogBranchV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.entity-catalog/1"),
  node: Schema.Literal("branch"),
  prefix: RadixPathV1Schema,
  children: Schema.Array(EntityCatalogBranchChildV1Schema),
});

export type EntityCatalogBranchV1 = Schema.Schema.Type<
  typeof EntityCatalogBranchV1Schema
>;

export const EntityCatalogOwnerV1Schema = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("record"),
    recordId: NonEmptyProtocolStringSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("run"),
    runId: NonEmptyProtocolStringSchema,
  }),
  Schema.Struct({
    kind: Schema.Literal("attempt"),
    attemptId: AttemptIdSchema,
  }),
);

export type EntityCatalogOwnerV1 = Schema.Schema.Type<
  typeof EntityCatalogOwnerV1Schema
>;

export const EntityCatalogLeafV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.entity-catalog/1"),
  node: Schema.Literal("leaf"),
  key: RadixPathV1Schema,
  keyPreimage: EntityCatalogKeyV1Schema,
  owner: EntityCatalogOwnerV1Schema,
  entity: NodeRefV1Schema,
});

export type EntityCatalogLeafV1 = Schema.Schema.Type<
  typeof EntityCatalogLeafV1Schema
>;

export const EntityCatalogPayloadV1Schema = Schema.Union(
  EntityCatalogBranchV1Schema,
  EntityCatalogLeafV1Schema,
);

export type EntityCatalogPayloadV1 = Schema.Schema.Type<
  typeof EntityCatalogPayloadV1Schema
>;

export const AttemptLocatorKeyV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.attempt-locator-key/1"),
  locator: AttemptLocatorSchema,
});

export type AttemptLocatorKeyV1 = Schema.Schema.Type<
  typeof AttemptLocatorKeyV1Schema
>;

const AttemptLocatorIndexBranchChildV1Schema = Schema.Struct({
  nibble: RadixNibbleV1Schema,
  node: NodeRefV1Schema,
});

export const AttemptLocatorIndexBranchV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.attempt-locator-index/1"),
  node: Schema.Literal("branch"),
  prefix: RadixPathV1Schema,
  children: Schema.Array(AttemptLocatorIndexBranchChildV1Schema),
});

export type AttemptLocatorIndexBranchV1 = Schema.Schema.Type<
  typeof AttemptLocatorIndexBranchV1Schema
>;

export const AttemptLocatorIndexLeafV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.attempt-locator-index/1"),
  node: Schema.Literal("leaf"),
  key: RadixPathV1Schema,
  keyPreimage: AttemptLocatorKeyV1Schema,
  owner: Schema.Struct({
    kind: Schema.Literal("attempt"),
    attemptId: AttemptIdSchema,
  }),
  locator: AttemptLocatorSchema,
  attemptId: AttemptIdSchema,
  attemptRevision: NodeRefV1Schema,
});

export type AttemptLocatorIndexLeafV1 = Schema.Schema.Type<
  typeof AttemptLocatorIndexLeafV1Schema
>;

export const AttemptLocatorIndexPayloadV1Schema = Schema.Union(
  AttemptLocatorIndexBranchV1Schema,
  AttemptLocatorIndexLeafV1Schema,
);

export type AttemptLocatorIndexPayloadV1 = Schema.Schema.Type<
  typeof AttemptLocatorIndexPayloadV1Schema
>;

export const AttemptLocatorSelectorV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.attempt-locator-selector/1"),
  value: Schema.Struct({ locator: AttemptLocatorSchema }),
});

export type AttemptLocatorSelectorV1 = Schema.Schema.Type<
  typeof AttemptLocatorSelectorV1Schema
>;

export const RadixMembershipProofStepV1Schema = Schema.Struct({
  branch: NodeRefV1Schema,
  prefix: RadixPathV1Schema,
  selectedNibble: RadixNibbleV1Schema,
  siblings: Schema.Array(Schema.Struct({
    nibble: RadixNibbleV1Schema,
    node: NodeRefV1Schema,
  })),
});

export type RadixMembershipProofStepV1 = Schema.Schema.Type<
  typeof RadixMembershipProofStepV1Schema
>;

export const NodeRadixNonMembershipTerminalV1Schema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("empty-root") }),
  Schema.Struct({
    kind: Schema.Literal("prefix-mismatch"),
    branch: NodeRefV1Schema,
  }),
  Schema.Struct({
    kind: Schema.Literal("missing-child"),
    branch: NodeRefV1Schema,
    nibble: RadixNibbleV1Schema,
  }),
  Schema.Struct({
    kind: Schema.Literal("mismatched-leaf"),
    leaf: NodeRefV1Schema,
  }),
);

export type NodeRadixNonMembershipTerminalV1 = Schema.Schema.Type<
  typeof NodeRadixNonMembershipTerminalV1Schema
>;

export const EntityMembershipProofV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.entity-membership-proof/1"),
  source: RecordGraphRefV1Schema,
  catalog: NodeRefV1Schema,
  key: RadixPathV1Schema,
  keyPreimage: EntityCatalogKeyV1Schema,
  leaf: NodeRefV1Schema,
  path: Schema.Array(RadixMembershipProofStepV1Schema),
});

export type EntityMembershipProofV1 = Schema.Schema.Type<
  typeof EntityMembershipProofV1Schema
>;

export const EntityNonMembershipProofV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.entity-nonmembership-proof/1"),
  source: RecordGraphRefV1Schema,
  catalog: NodeRefV1Schema,
  key: RadixPathV1Schema,
  keyPreimage: EntityCatalogKeyV1Schema,
  path: Schema.Array(RadixMembershipProofStepV1Schema),
  terminal: NodeRadixNonMembershipTerminalV1Schema,
});

export type EntityNonMembershipProofV1 = Schema.Schema.Type<
  typeof EntityNonMembershipProofV1Schema
>;

export const AttemptLocatorNonMembershipProofV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.attempt-locator-nonmembership-proof/1"),
  source: RecordGraphRefV1Schema,
  index: NodeRefV1Schema,
  selector: AttemptLocatorSelectorV1Schema,
  key: RadixPathV1Schema,
  keyPreimage: AttemptLocatorKeyV1Schema,
  path: Schema.Array(RadixMembershipProofStepV1Schema),
  terminal: NodeRadixNonMembershipTerminalV1Schema,
});

export type AttemptLocatorNonMembershipProofV1 = Schema.Schema.Type<
  typeof AttemptLocatorNonMembershipProofV1Schema
>;

export const StreamRequirementSchema = Schema.Literal(
  "required-for-completion",
  "supplemental",
);

export type StreamRequirement = Schema.Schema.Type<
  typeof StreamRequirementSchema
>;

export const StreamBindingV1Schema = Schema.Struct({
  bindingId: NonEmptyProtocolStringSchema,
  role: NonEmptyProtocolStringSchema,
  requirement: StreamRequirementSchema,
  streamId: NonEmptyProtocolStringSchema,
  index: NodeRefV1Schema,
});

export type StreamBindingV1 = Schema.Schema.Type<typeof StreamBindingV1Schema>;

export const ExpectedMembershipSlotV1Schema = Schema.Struct({
  membershipSlot: NonEmptyProtocolStringSchema,
  evalId: NonEmptyProtocolStringSchema,
});

export type ExpectedMembershipSlotV1 = Schema.Schema.Type<
  typeof ExpectedMembershipSlotV1Schema
>;

export const ExpectedMembershipSlotSelectorV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.expected-membership-slot-selector/1"),
  value: Schema.Struct({
    runId: NonEmptyProtocolStringSchema,
    membershipSlot: NonEmptyProtocolStringSchema,
    evalId: NonEmptyProtocolStringSchema,
  }),
});

export type ExpectedMembershipSlotSelectorV1 = Schema.Schema.Type<
  typeof ExpectedMembershipSlotSelectorV1Schema
>;

export const RunStateSchema = Schema.Literal(
  "active",
  "completed",
  "incomplete",
  "interrupted",
);

export type RunState = Schema.Schema.Type<typeof RunStateSchema>;

const RunContributionPointerV1Schema = Schema.Struct({
  membershipSlot: NonEmptyProtocolStringSchema,
  contributionId: NonEmptyProtocolStringSchema,
  node: NodeRefV1Schema,
});

export const RunPayloadV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.run/1"),
  runId: NonEmptyProtocolStringSchema,
  revision: RevisionV1Schema,
  previous: Schema.NullOr(NodeRefV1Schema),
  invocationId: NonEmptyProtocolStringSchema,
  experimentId: NonEmptyProtocolStringSchema,
  provenance: NodeRefV1Schema,
  state: RunStateSchema,
  streams: Schema.Array(StreamBindingV1Schema),
  expectedMembershipSlots: Schema.Array(ExpectedMembershipSlotV1Schema),
  contributions: Schema.Array(RunContributionPointerV1Schema),
});

export type RunPayloadV1 = Schema.Schema.Type<typeof RunPayloadV1Schema>;

export const AttemptIdentityV1Schema = Schema.Struct({
  attemptId: AttemptIdSchema,
  locator: AttemptLocatorSchema,
  evalId: NonEmptyProtocolStringSchema,
  ordinal: JsonSafeUnsignedIntegerSchema,
});

export type AttemptIdentityV1 = Schema.Schema.Type<
  typeof AttemptIdentityV1Schema
>;

export const AttemptStateSchema = Schema.Literal(
  "active",
  "completed",
  "abandoned",
);

export type AttemptState = Schema.Schema.Type<typeof AttemptStateSchema>;

export const AttemptPayloadV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.attempt/1"),
  revision: RevisionV1Schema,
  previous: Schema.NullOr(NodeRefV1Schema),
  identity: AttemptIdentityV1Schema,
  originRunId: NonEmptyProtocolStringSchema,
  provenance: NodeRefV1Schema,
  state: AttemptStateSchema,
  streams: Schema.Array(StreamBindingV1Schema),
});

export type AttemptPayloadV1 = Schema.Schema.Type<
  typeof AttemptPayloadV1Schema
>;

export const ContributionModeSchema = Schema.Literal(
  "executed",
  "carried",
  "accepted",
  "renamed",
);

export type ContributionMode = Schema.Schema.Type<
  typeof ContributionModeSchema
>;

const ContributionBasisClaimV1Schema = Schema.Struct({
  claimId: NonEmptyProtocolStringSchema,
  node: NodeRefV1Schema,
});

export const RunContributionV1Schema = Schema.Struct({
  schema: Schema.Literal("niceeval.run-contribution/1"),
  contributionId: NonEmptyProtocolStringSchema,
  revision: RevisionV1Schema,
  previous: Schema.NullOr(NodeRefV1Schema),
  supersedes: Schema.NullOr(NodeRefV1Schema),
  runId: NonEmptyProtocolStringSchema,
  evalId: NonEmptyProtocolStringSchema,
  membershipSlot: NonEmptyProtocolStringSchema,
  mode: ContributionModeSchema,
  attempt: Schema.Struct({
    attemptId: AttemptIdSchema,
    adopted: NodeRefV1Schema,
  }),
  basisClaims: Schema.Array(ContributionBasisClaimV1Schema),
});

export type RunContributionV1 = Schema.Schema.Type<
  typeof RunContributionV1Schema
>;

function edge(relation: string, target: NodeRefV1): StrongEdgeV1 {
  return Object.freeze({ relation, target });
}

export function recordSubjectStrongEdges(
  payload: RecordSubjectV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    edge("niceeval.record-catalog", payload.catalog),
    edge("niceeval.record-locator-index", payload.locatorIndex),
    ...(payload.previous === null
      ? []
      : [edge("niceeval.record-previous", payload.previous)]),
  ]);
}

export function entityCatalogStrongEdges(
  payload: EntityCatalogPayloadV1,
): readonly StrongEdgeV1[] {
  if (payload.node === "leaf") {
    return Object.freeze([edge("niceeval.entity-current", payload.entity)]);
  }
  return Object.freeze(payload.children.map((child) =>
    edge(`niceeval.radix-child:${child.nibble}`, child.node)
  ));
}

export function attemptLocatorIndexStrongEdges(
  payload: AttemptLocatorIndexPayloadV1,
): readonly StrongEdgeV1[] {
  if (payload.node === "leaf") {
    return Object.freeze([edge("niceeval.attempt-current", payload.attemptRevision)]);
  }
  return Object.freeze(payload.children.map((child) =>
    edge(`niceeval.radix-child:${child.nibble}`, child.node)
  ));
}

export function runStrongEdges(
  payload: RunPayloadV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    ...(payload.previous === null
      ? []
      : [edge("niceeval.run-previous", payload.previous)]),
    edge("niceeval.run-provenance", payload.provenance),
    ...payload.streams.map((binding) =>
      edge("niceeval.run-stream-index", binding.index)
    ),
    ...payload.contributions.map((contribution) =>
      edge("niceeval.run-current-contribution", contribution.node)
    ),
  ]);
}

export function attemptStrongEdges(
  payload: AttemptPayloadV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    ...(payload.previous === null
      ? []
      : [edge("niceeval.attempt-previous", payload.previous)]),
    edge("niceeval.attempt-provenance", payload.provenance),
    ...payload.streams.map((binding) =>
      edge("niceeval.attempt-stream-index", binding.index)
    ),
  ]);
}

export function runContributionStrongEdges(
  payload: RunContributionV1,
): readonly StrongEdgeV1[] {
  return Object.freeze([
    ...(payload.previous === null
      ? []
      : [edge("niceeval.contribution-previous", payload.previous)]),
    ...(payload.supersedes === null
      ? []
      : [edge("niceeval.contribution-supersedes", payload.supersedes)]),
    edge("niceeval.contribution-adopted-attempt", payload.attempt.adopted),
    ...payload.basisClaims.map((claim) =>
      edge("niceeval.contribution-basis-claim", claim.node)
    ),
  ]);
}

function compareUtf8(left: string, right: string): number {
  return compareCanonicalBytes(
    UTF8_ENCODER.encode(left),
    UTF8_ENCODER.encode(right),
  );
}

function invalidInvariant(
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

function sortedUniqueBy<T>(
  values: readonly T[],
  key: (value: T) => string,
  operation: string,
  path: readonly string[],
): RecordProtocolError | undefined {
  for (let index = 1; index < values.length; index += 1) {
    const order = compareUtf8(key(values[index - 1]), key(values[index]));
    if (order >= 0) {
      return invalidInvariant(
        operation,
        [...path, String(index)],
        order === 0
          ? "Canonical payload arrays must not contain duplicate keys"
          : "Canonical payload arrays must be in ascending UTF-8 byte order",
      );
    }
  }
  return undefined;
}

function validateRevisionEnvelope(
  revision: number,
  previous: NodeRefV1 | null,
  operation: string,
): RecordProtocolError | undefined {
  if ((revision === 0) !== (previous === null)) {
    return invalidInvariant(
      operation,
      ["previous"],
      "Revision 0 requires previous=null and every later revision requires a predecessor",
    );
  }
  return undefined;
}

function validateStreamBindings(
  streams: readonly StreamBindingV1[],
  operation: string,
): RecordProtocolError | undefined {
  const sorted = sortedUniqueBy(
    streams,
    (binding) => binding.bindingId,
    operation,
    ["streams"],
  );
  if (sorted !== undefined) return sorted;
  const lifecycle = streams.filter((binding) => binding.role === "lifecycle");
  if (
    lifecycle.length !== 1
    || lifecycle[0].requirement !== "required-for-completion"
  ) {
    return invalidInvariant(
      operation,
      ["streams"],
      "Each Run or Attempt must have exactly one required-for-completion lifecycle binding",
    );
  }
  return undefined;
}

function validateRadixBranchArity(
  children: readonly unknown[],
  operation: string,
): RecordProtocolError | undefined {
  if (children.length === 1 || children.length > 16) {
    return invalidInvariant(
      operation,
      ["children"],
      "A radix branch must be empty or contain between 2 and 16 children",
    );
  }
  return undefined;
}

function effectFromInvariant(
  error: RecordProtocolError | undefined,
): Effect.Effect<void, RecordProtocolError> {
  return error === undefined ? Effect.void : Effect.fail(error);
}

export function validateRecordSubjectV1(
  payload: RecordSubjectV1,
): Effect.Effect<void, RecordProtocolError> {
  return effectFromInvariant(validateRevisionEnvelope(
    payload.revision,
    payload.previous,
    "validate-record-subject",
  ));
}

export function validateEntityCatalogPayloadV1(
  payload: EntityCatalogPayloadV1,
): Effect.Effect<void, RecordProtocolError> {
  if (payload.node === "leaf") {
    return radixPathForCanonicalValue(payload.keyPreimage).pipe(
      Effect.flatMap((expectedKey) => expectedKey === payload.key
        ? Effect.void
        : Effect.fail(invalidInvariant(
          "validate-entity-catalog",
          ["key"],
          "Entity catalog leaf key must be SHA-256 of canonical keyPreimage bytes",
        ))),
    );
  }
  const arity = validateRadixBranchArity(
    payload.children,
    "validate-entity-catalog",
  );
  if (arity !== undefined) return Effect.fail(arity);
  return effectFromInvariant(sortedUniqueBy(
    payload.children,
    (child) => child.nibble,
    "validate-entity-catalog",
    ["children"],
  ));
}

export function validateAttemptLocatorIndexPayloadV1(
  payload: AttemptLocatorIndexPayloadV1,
): Effect.Effect<void, RecordProtocolError> {
  if (payload.node === "branch") {
    const arity = validateRadixBranchArity(
      payload.children,
      "validate-attempt-locator-index",
    );
    if (arity !== undefined) return Effect.fail(arity);
    return effectFromInvariant(sortedUniqueBy(
      payload.children,
      (child) => child.nibble,
      "validate-attempt-locator-index",
      ["children"],
    ));
  }
  const expected = canonicalLocatorText(payload.attemptId);
  if (
    payload.locator !== expected
    || payload.keyPreimage.locator !== expected
    || payload.owner.attemptId !== payload.attemptId
  ) {
    return Effect.fail(invalidInvariant(
      "validate-attempt-locator-index",
      ["locator"],
      "Locator leaf identity, owner and key preimage must encode the same full attemptId",
    ));
  }
  return radixPathForCanonicalValue(payload.keyPreimage).pipe(
    Effect.flatMap((expectedKey) => expectedKey === payload.key
      ? Effect.void
      : Effect.fail(invalidInvariant(
        "validate-attempt-locator-index",
        ["key"],
        "Attempt locator leaf key must be SHA-256 of canonical keyPreimage bytes",
      ))),
  );
}

export function validateRunPayloadV1(
  payload: RunPayloadV1,
): Effect.Effect<void, RecordProtocolError> {
  const revision = validateRevisionEnvelope(
    payload.revision,
    payload.previous,
    "validate-run-payload",
  );
  if (revision !== undefined) return Effect.fail(revision);
  const streams = validateStreamBindings(payload.streams, "validate-run-payload");
  if (streams !== undefined) return Effect.fail(streams);
  const expected = sortedUniqueBy(
    payload.expectedMembershipSlots,
    (slot) => slot.membershipSlot,
    "validate-run-payload",
    ["expectedMembershipSlots"],
  );
  if (expected !== undefined) return Effect.fail(expected);
  const contributions = sortedUniqueBy(
    payload.contributions,
    (contribution) => contribution.membershipSlot,
    "validate-run-payload",
    ["contributions"],
  );
  if (contributions !== undefined) return Effect.fail(contributions);
  const expectedBySlot = new Map(
    payload.expectedMembershipSlots.map((slot) => [slot.membershipSlot, slot.evalId]),
  );
  for (let index = 0; index < payload.contributions.length; index += 1) {
    const contribution = payload.contributions[index];
    if (!expectedBySlot.has(contribution.membershipSlot)) {
      return Effect.fail(invalidInvariant(
        "validate-run-payload",
        ["contributions", String(index), "membershipSlot"],
        "Every current Contribution must occupy a declared expected membership slot",
      ));
    }
  }
  return Effect.void;
}

export function validateAttemptPayloadV1(
  payload: AttemptPayloadV1,
): Effect.Effect<void, RecordProtocolError> {
  const revision = validateRevisionEnvelope(
    payload.revision,
    payload.previous,
    "validate-attempt-payload",
  );
  if (revision !== undefined) return Effect.fail(revision);
  const streams = validateStreamBindings(payload.streams, "validate-attempt-payload");
  if (streams !== undefined) return Effect.fail(streams);
  const expectedLocator = canonicalLocatorText(payload.identity.attemptId);
  if (payload.identity.locator !== expectedLocator) {
    return Effect.fail(invalidInvariant(
      "validate-attempt-payload",
      ["identity", "locator"],
      "Attempt locator must be the full canonical Crockford encoding of attemptId",
    ));
  }
  return Effect.void;
}

export function validateRunContributionV1(
  payload: RunContributionV1,
): Effect.Effect<void, RecordProtocolError> {
  const revision = validateRevisionEnvelope(
    payload.revision,
    payload.previous,
    "validate-run-contribution",
  );
  if (revision !== undefined) return Effect.fail(revision);
  if ((payload.revision === 0) !== (payload.supersedes === null)) {
    return Effect.fail(invalidInvariant(
      "validate-run-contribution",
      ["supersedes"],
      "Contribution revision 0 requires supersedes=null; successors require supersedes",
    ));
  }
  if (
    payload.previous !== null
    && payload.supersedes !== null
    && !typedReferenceEquals(payload.previous, payload.supersedes)
  ) {
    return Effect.fail(invalidInvariant(
      "validate-run-contribution",
      ["supersedes"],
      "Contribution previous and supersedes must identify the same direct predecessor",
    ));
  }
  return Effect.gen(function*() {
    const entries = yield* Effect.forEach(payload.basisClaims, (claim) =>
      canonicalJsonBytes(claim.node).pipe(
        Effect.map((nodeBytes) => Object.freeze({ claim, nodeBytes })),
      )
    );
    for (let index = 1; index < entries.length; index += 1) {
      const left = entries[index - 1];
      const right = entries[index];
      const claimOrder = compareUtf8(left.claim.claimId, right.claim.claimId);
      const order = claimOrder === 0
        ? compareCanonicalBytes(left.nodeBytes, right.nodeBytes)
        : claimOrder;
      if (order >= 0) {
        return yield* Effect.fail(invalidInvariant(
          "validate-run-contribution",
          ["basisClaims", String(index)],
          order === 0
            ? "Contribution basisClaims must not contain duplicate claimId/node pairs"
            : "Contribution basisClaims must be sorted by claimId then complete typed node reference JCS bytes",
        ));
      }
    }
  });
}
