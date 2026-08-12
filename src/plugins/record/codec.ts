import { Either, ParseResult, Schema } from "effect";
import {
  isRecordAttachmentName,
  recordAttachmentNameTextOfSchemaId,
} from "../../record/model/identifiers.ts";
import type {
  AttemptPluginProvenanceEntryV1,
  AttemptPluginProvenanceV1,
  EvalAttemptPluginContributionRefV1,
  EvalOwnerFragmentContributionRefV1,
  ExperimentOwnerFragmentContributionRefV1,
  ExperimentPairPluginContributionRefV1,
  PluginBehaviorIdentityItemV1,
  PluginBehaviorIdentityValueV1,
  PluginContributionRefV1,
  PluginProvenanceCredentialV1,
  PluginProvenanceSourceV1,
  PluginProvenanceTextV1,
  ReceiverProjectionContributionRefV1,
  RunPluginContributionRefV1,
  RunPluginProvenanceEntryV1,
  RunPluginProvenanceV1,
  TypedAttachmentContributionRefV1,
} from "./model.ts";

export const MAX_PLUGIN_PROVENANCE_TEXT_CODE_POINTS_V1 = 128;
export const MAX_PLUGIN_PROVENANCE_IDENTITY_ITEMS_V1 = 64;
export const MAX_PLUGIN_PROVENANCE_CONTRIBUTION_REFS_V1 = 64;

/** All durable provenance objects decode their full shape and reject extras. */
export const PluginProvenanceExactParseOptions = Object.freeze({
  errors: "all" as const,
  onExcessProperty: "error" as const,
});

const CONTROL_CHARACTER = /[\p{Cc}]/u;
const REVERSE_DOMAIN_NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const SENSITIVE_IDENTITY_KEY =
  /secret|token|credential|password|private|config|default|selector|receiver/iu;

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function isNormalizedProvenanceText(value: string): boolean {
  return (
    codePointLength(value) >= 1 &&
    codePointLength(value) <= MAX_PLUGIN_PROVENANCE_TEXT_CODE_POINTS_V1 &&
    value.normalize("NFC") === value &&
    !CONTROL_CHARACTER.test(value)
  );
}

function isPluginName(value: string): boolean {
  return isNormalizedProvenanceText(value) && REVERSE_DOMAIN_NAME.test(value);
}

function isSafeBehaviorIdentityKey(value: string): boolean {
  return isNormalizedProvenanceText(value) && !SENSITIVE_IDENTITY_KEY.test(value);
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function isCanonicallySortedUniqueIdentity(
  items: readonly PluginBehaviorIdentityItemV1[],
): boolean {
  let previous: string | undefined;
  for (const item of items) {
    if (previous !== undefined && previous >= item.key) {
      return false;
    }
    previous = item.key;
  }
  return true;
}

function hasStrictlyIncreasingSources<
  Entry extends { readonly source: PluginProvenanceSourceV1 },
>(entries: readonly Entry[]): boolean {
  let previous = -1;
  for (const entry of entries) {
    if (entry.source.position <= previous) {
      return false;
    }
    previous = entry.source.position;
  }
  return true;
}

function hasUniquePluginIdentities<
  Entry extends {
    readonly name: PluginProvenanceTextV1;
    readonly instance: PluginProvenanceTextV1;
  },
>(entries: readonly Entry[]): boolean {
  const identities = new Set<string>();
  for (const entry of entries) {
    const identity = `${entry.name}\u0000${entry.instance}`;
    if (identities.has(identity)) {
      return false;
    }
    identities.add(identity);
  }
  return true;
}

function hasMatchingAttachmentFamilyIdentity(
  ref: TypedAttachmentContributionRefV1,
): boolean {
  return (
    isRecordAttachmentName(ref.family.name) &&
    recordAttachmentNameTextOfSchemaId(ref.family.schemaId) === ref.family.name
  );
}

const PluginProvenanceTextV1Schema = Schema.String.pipe(
  Schema.filter(isNormalizedProvenanceText, {
    identifier: "PluginProvenanceTextV1",
    description: "an NFC, control-character-free text value of 1 to 128 code points",
  }),
);

const PluginNameV1Schema = Schema.String.pipe(
  Schema.filter(isPluginName, {
    identifier: "PluginProvenanceNameV1",
    description: "a lowercase reverse-domain Plugin namespace",
  }),
);

const SafeBehaviorIdentityKeyV1Schema = Schema.String.pipe(
  Schema.filter(isSafeBehaviorIdentityKey, {
    identifier: "PluginBehaviorIdentityKeyV1",
    description: "a normalized behavior identity key with no secret-bearing category",
  }),
);

const NonNegativeIntegerV1Schema = Schema.JsonNumber.pipe(
  Schema.filter(isNonNegativeInteger, {
    identifier: "PluginProvenanceNonNegativeIntegerV1",
    description: "a finite non-negative integer",
  }),
);

export const PluginProvenanceSourceV1Schema: Schema.Schema<PluginProvenanceSourceV1> =
  Schema.Struct({
    kind: Schema.Literal("plugins-array"),
    position: NonNegativeIntegerV1Schema,
  });

export const PluginBehaviorIdentityValueV1Schema: Schema.Schema<PluginBehaviorIdentityValueV1> =
  Schema.Union(
    PluginProvenanceTextV1Schema,
    Schema.JsonNumber,
    Schema.Boolean,
    Schema.Null,
  );

export const PluginBehaviorIdentityItemV1Schema: Schema.Schema<PluginBehaviorIdentityItemV1> =
  Schema.Struct({
    key: SafeBehaviorIdentityKeyV1Schema,
    value: PluginBehaviorIdentityValueV1Schema,
  });

const PluginBehaviorIdentityItemsV1Schema = Schema.Array(
  PluginBehaviorIdentityItemV1Schema,
).pipe(
  Schema.filter((items) => items.length <= MAX_PLUGIN_PROVENANCE_IDENTITY_ITEMS_V1, {
    identifier: "PluginBehaviorIdentityItemsV1",
    description: "at most 64 behavior identity items",
  }),
  Schema.filter(isCanonicallySortedUniqueIdentity, {
    identifier: "PluginBehaviorIdentityOrderV1",
    description: "behavior identity items sorted by unique canonical keys",
  }),
);

const TypedAttachmentContributionRefBaseV1Schema = Schema.Struct({
  kind: Schema.Literal("typed-attachment"),
  owner: Schema.Literal("run", "attempt"),
  family: Schema.Struct({
    name: PluginProvenanceTextV1Schema,
    schemaId: PluginProvenanceTextV1Schema,
  }),
}).pipe(
  Schema.filter(hasMatchingAttachmentFamilyIdentity, {
    identifier: "PluginTypedAttachmentFamilyIdentityV1",
    description: "a matching RecordAttachment family name and schema identity",
  }),
);

export const TypedAttachmentContributionRefV1Schema: Schema.Schema<TypedAttachmentContributionRefV1> =
  TypedAttachmentContributionRefBaseV1Schema;

const TypedRunAttachmentContributionRefV1Schema: Schema.Schema<
  TypedAttachmentContributionRefV1 & { readonly owner: "run" }
> = Schema.Struct({
  kind: Schema.Literal("typed-attachment"),
  owner: Schema.Literal("run"),
  family: Schema.Struct({
    name: PluginProvenanceTextV1Schema,
    schemaId: PluginProvenanceTextV1Schema,
  }),
}).pipe(
  Schema.filter(hasMatchingAttachmentFamilyIdentity, {
    identifier: "PluginRunAttachmentFamilyIdentityV1",
    description: "a matching Run RecordAttachment family name and schema identity",
  }),
);

const TypedAttemptAttachmentContributionRefV1Schema: Schema.Schema<
  TypedAttachmentContributionRefV1 & { readonly owner: "attempt" }
> = Schema.Struct({
  kind: Schema.Literal("typed-attachment"),
  owner: Schema.Literal("attempt"),
  family: Schema.Struct({
    name: PluginProvenanceTextV1Schema,
    schemaId: PluginProvenanceTextV1Schema,
  }),
}).pipe(
  Schema.filter(hasMatchingAttachmentFamilyIdentity, {
    identifier: "PluginAttemptAttachmentFamilyIdentityV1",
    description: "a matching Attempt RecordAttachment family name and schema identity",
  }),
);

export const EvalOwnerFragmentContributionRefV1Schema: Schema.Schema<EvalOwnerFragmentContributionRefV1> =
  Schema.Struct({
    kind: Schema.Literal("owner-fragment"),
    owner: Schema.Literal("eval"),
    field: Schema.Literal(
      "requirements",
      "sandbox-layer",
      "flags",
      "labels",
      "eval-hook",
    ),
  });

export const ExperimentOwnerFragmentContributionRefV1Schema: Schema.Schema<ExperimentOwnerFragmentContributionRefV1> =
  Schema.Struct({
    kind: Schema.Literal("owner-fragment"),
    owner: Schema.Literal("experiment"),
    field: Schema.Literal(
      "requirements",
      "sandbox-layer",
      "flags",
      "labels",
      "experiment-hook",
    ),
  });

const ReceiverProjectionContributionRefBaseV1Schema = Schema.Struct({
  kind: Schema.Literal("receiver-projection"),
  scope: Schema.Literal("run", "attempt"),
  receiver: PluginProvenanceTextV1Schema,
  projection: PluginProvenanceTextV1Schema,
});

export const ReceiverProjectionContributionRefV1Schema: Schema.Schema<ReceiverProjectionContributionRefV1> =
  ReceiverProjectionContributionRefBaseV1Schema;

const RunReceiverProjectionContributionRefV1Schema: Schema.Schema<
  ReceiverProjectionContributionRefV1 & { readonly scope: "run" }
> = Schema.Struct({
  kind: Schema.Literal("receiver-projection"),
  scope: Schema.Literal("run"),
  receiver: PluginProvenanceTextV1Schema,
  projection: PluginProvenanceTextV1Schema,
});

const AttemptReceiverProjectionContributionRefV1Schema: Schema.Schema<
  ReceiverProjectionContributionRefV1 & { readonly scope: "attempt" }
> = Schema.Struct({
  kind: Schema.Literal("receiver-projection"),
  scope: Schema.Literal("attempt"),
  receiver: PluginProvenanceTextV1Schema,
  projection: PluginProvenanceTextV1Schema,
});

export const PluginContributionRefV1Schema: Schema.Schema<PluginContributionRefV1> =
  Schema.Union(
    TypedAttachmentContributionRefV1Schema,
    EvalOwnerFragmentContributionRefV1Schema,
    ExperimentOwnerFragmentContributionRefV1Schema,
    ReceiverProjectionContributionRefV1Schema,
  );

export const RunPluginContributionRefV1Schema: Schema.Schema<RunPluginContributionRefV1> =
  Schema.Union(
    TypedRunAttachmentContributionRefV1Schema,
    ExperimentOwnerFragmentContributionRefV1Schema,
    RunReceiverProjectionContributionRefV1Schema,
  );

export const EvalAttemptPluginContributionRefV1Schema: Schema.Schema<EvalAttemptPluginContributionRefV1> =
  Schema.Union(
    TypedAttemptAttachmentContributionRefV1Schema,
    EvalOwnerFragmentContributionRefV1Schema,
    AttemptReceiverProjectionContributionRefV1Schema,
  );

export const ExperimentPairPluginContributionRefV1Schema: Schema.Schema<ExperimentPairPluginContributionRefV1> =
  Schema.Union(
    TypedAttemptAttachmentContributionRefV1Schema,
    ExperimentOwnerFragmentContributionRefV1Schema,
    AttemptReceiverProjectionContributionRefV1Schema,
  );

export const PluginProvenanceCredentialV1Schema: Schema.Schema<PluginProvenanceCredentialV1> =
  Schema.Struct({
    kind: Schema.Literal("redacted"),
    domain: PluginProvenanceTextV1Schema,
    revision: PluginProvenanceTextV1Schema,
  });

const RunContributionRefsV1Schema = Schema.Array(RunPluginContributionRefV1Schema).pipe(
  Schema.filter((refs) => refs.length <= MAX_PLUGIN_PROVENANCE_CONTRIBUTION_REFS_V1, {
    identifier: "RunPluginContributionRefsV1",
    description: "at most 64 Run-compatible contribution references",
  }),
);

const EvalAttemptContributionRefsV1Schema = Schema.Array(
  EvalAttemptPluginContributionRefV1Schema,
).pipe(
  Schema.filter((refs) => refs.length <= MAX_PLUGIN_PROVENANCE_CONTRIBUTION_REFS_V1, {
    identifier: "EvalAttemptPluginContributionRefsV1",
    description: "at most 64 Eval Attempt-compatible contribution references",
  }),
);

const ExperimentPairContributionRefsV1Schema = Schema.Array(
  ExperimentPairPluginContributionRefV1Schema,
).pipe(
  Schema.filter((refs) => refs.length <= MAX_PLUGIN_PROVENANCE_CONTRIBUTION_REFS_V1, {
    identifier: "ExperimentPairPluginContributionRefsV1",
    description: "at most 64 Experiment pair-compatible contribution references",
  }),
);

const RunPluginProvenanceEntrySchema = Schema.Struct({
  name: PluginNameV1Schema,
  instance: PluginProvenanceTextV1Schema,
  revision: PluginProvenanceTextV1Schema,
  mount: Schema.Literal("experiment"),
  source: PluginProvenanceSourceV1Schema,
  effectiveBehaviorIdentity: PluginBehaviorIdentityItemsV1Schema,
  contributionRefs: RunContributionRefsV1Schema,
  credential: Schema.optional(PluginProvenanceCredentialV1Schema),
});

export const RunPluginProvenanceEntryV1Schema: Schema.Schema<RunPluginProvenanceEntryV1> =
  RunPluginProvenanceEntrySchema;

const EvalAttemptPluginProvenanceEntryV1Schema = Schema.Struct({
  name: PluginNameV1Schema,
  instance: PluginProvenanceTextV1Schema,
  revision: PluginProvenanceTextV1Schema,
  mount: Schema.Literal("eval"),
  subject: Schema.Literal("eval", "pair"),
  source: PluginProvenanceSourceV1Schema,
  effectiveBehaviorIdentity: PluginBehaviorIdentityItemsV1Schema,
  contributionRefs: EvalAttemptContributionRefsV1Schema,
  credential: Schema.optional(PluginProvenanceCredentialV1Schema),
});

const ExperimentPairPluginProvenanceEntryV1Schema = Schema.Struct({
  name: PluginNameV1Schema,
  instance: PluginProvenanceTextV1Schema,
  revision: PluginProvenanceTextV1Schema,
  mount: Schema.Literal("experiment"),
  subject: Schema.Literal("pair"),
  source: PluginProvenanceSourceV1Schema,
  effectiveBehaviorIdentity: PluginBehaviorIdentityItemsV1Schema,
  contributionRefs: ExperimentPairContributionRefsV1Schema,
  credential: Schema.optional(PluginProvenanceCredentialV1Schema),
});

export const AttemptPluginProvenanceEntryV1Schema: Schema.Schema<AttemptPluginProvenanceEntryV1> =
  Schema.Union(
    EvalAttemptPluginProvenanceEntryV1Schema,
    ExperimentPairPluginProvenanceEntryV1Schema,
  );

export const RunPluginProvenanceV1Schema: Schema.Schema<RunPluginProvenanceV1> =
  Schema.Struct({
    scope: Schema.Literal("run"),
    entries: Schema.Array(RunPluginProvenanceEntrySchema),
  }).pipe(
    Schema.filter(
      (document) =>
        hasStrictlyIncreasingSources(document.entries) &&
        hasUniquePluginIdentities(document.entries),
      {
        identifier: "RunPluginProvenanceEntriesV1",
        description: "Run entries with strictly increasing source positions and unique Plugin identities",
      },
    ),
  );

export const AttemptPluginProvenanceV1Schema: Schema.Schema<AttemptPluginProvenanceV1> =
  Schema.Struct({
    scope: Schema.Literal("attempt"),
    entries: Schema.Array(AttemptPluginProvenanceEntryV1Schema),
  }).pipe(
    Schema.filter(
      (document) =>
        hasStrictlyIncreasingSources(document.entries) &&
        hasUniquePluginIdentities(document.entries),
      {
        identifier: "AttemptPluginProvenanceEntriesV1",
        description:
          "Attempt entries with strictly increasing source positions and unique Plugin identities",
      },
    ),
  );

export function decodeRunPluginProvenanceV1(
  input: unknown,
): Either.Either<RunPluginProvenanceV1, ParseResult.ParseError> {
  return Schema.decodeUnknownEither(
    RunPluginProvenanceV1Schema,
    PluginProvenanceExactParseOptions,
  )(input);
}

export function decodeAttemptPluginProvenanceV1(
  input: unknown,
): Either.Either<AttemptPluginProvenanceV1, ParseResult.ParseError> {
  return Schema.decodeUnknownEither(
    AttemptPluginProvenanceV1Schema,
    PluginProvenanceExactParseOptions,
  )(input);
}
