import { Either, Schema } from "effect";
import {
  makeRecordAttachmentWrite,
  type RecordAttachmentBlobDraft,
  type RecordAttachmentWrite,
} from "../../record/attachment/index.ts";
import {
  AttemptPluginProvenanceV1Family,
  RunPluginProvenanceV1Family,
} from "./attachment.ts";
import {
  isLinkedPluginRecordAttachment,
  isLinkedPluginRecordAttachments,
  linkedPluginRecordAttachmentsOwner,
  pluginAttachmentCapabilityDefinition,
  pluginRecordAttachmentAcceptanceCapability,
  pluginRecordAttachmentAcceptanceLinked,
  type LinkedPluginRecordAttachments,
  type PluginAttachmentCapability,
  type PluginRecordAttachmentAcceptance,
} from "./capability.ts";
import {
  AttemptPluginProvenanceEntryV1Schema,
  AttemptPluginProvenanceV1Schema,
  PluginProvenanceExactParseOptions,
  RunPluginProvenanceEntryV1Schema,
  RunPluginProvenanceV1Schema,
} from "./codec.ts";
import type {
  AttemptPluginProvenanceEntryV1,
  AttemptPluginProvenanceV1,
  EvalOwnerFragmentContributionRefV1,
  ExperimentOwnerFragmentContributionRefV1,
  PluginBehaviorIdentityItemV1,
  PluginBehaviorIdentityValueV1,
  PluginContributionRefV1,
  PluginProvenanceCredentialV1,
  PluginProvenanceTextV1,
  PluginRecordOwner,
  ReceiverProjectionContributionRefV1,
  RunPluginProvenanceEntryV1,
  RunPluginProvenanceV1,
  TypedAttachmentContributionRefV1,
} from "./model.ts";

const pluginProvenanceEntryBuilderTypeId: unique symbol = Symbol(
  "@niceeval/plugins/PluginProvenanceEntryBuilder",
);

export type PluginProvenanceBuilderError =
  | { readonly code: "plugin-provenance-builder-invalid" }
  | { readonly code: "plugin-provenance-builder-wrong-owner" }
  | { readonly code: "plugin-provenance-builder-attachment-undeclared" }
  | { readonly code: "plugin-provenance-builder-contribution-limit" };

export interface PluginProvenanceCredentialInput {
  readonly domain: PluginProvenanceTextV1;
  readonly revision: PluginProvenanceTextV1;
}

export interface PluginProvenanceEntryBaseInput {
  readonly name: PluginProvenanceTextV1;
  readonly instance: PluginProvenanceTextV1;
  readonly revision: PluginProvenanceTextV1;
  readonly sourcePosition: number;
  readonly effectiveBehaviorIdentity: readonly PluginBehaviorIdentityItemV1[];
  /** Only a redacted domain/revision token has a durable representation. */
  readonly credential?: PluginProvenanceCredentialInput;
}

export interface RunPluginProvenanceEntryBuilderInput
  extends PluginProvenanceEntryBaseInput {
  readonly owner: "run";
  readonly mount: "experiment";
  readonly linked: LinkedPluginRecordAttachments<"run">;
}

export interface EvalAttemptPluginProvenanceEntryBuilderInput
  extends PluginProvenanceEntryBaseInput {
  readonly owner: "attempt";
  readonly mount: "eval";
  readonly subject: "eval" | "pair";
  readonly linked: LinkedPluginRecordAttachments<"attempt">;
}

export interface ExperimentPairPluginProvenanceEntryBuilderInput
  extends PluginProvenanceEntryBaseInput {
  readonly owner: "attempt";
  readonly mount: "experiment";
  readonly subject: "pair";
  readonly linked: LinkedPluginRecordAttachments<"attempt">;
}

export type AttemptPluginProvenanceEntryBuilderInput =
  | EvalAttemptPluginProvenanceEntryBuilderInput
  | ExperimentPairPluginProvenanceEntryBuilderInput;

export type PluginProvenanceEntryBuilderInput =
  | RunPluginProvenanceEntryBuilderInput
  | AttemptPluginProvenanceEntryBuilderInput;

/**
 * Framework-owned mutable assembly state. Plugins receive no instance of this
 * token, so they cannot add raw contribution references or mutate provenance.
 */
export interface PluginProvenanceEntryBuilder<out Owner extends PluginRecordOwner> {
  readonly [pluginProvenanceEntryBuilderTypeId]: () => Owner;
}

interface BuilderRuntime {
  readonly owner: PluginRecordOwner;
  readonly linked: object;
  readonly name: PluginProvenanceTextV1;
  readonly instance: PluginProvenanceTextV1;
  readonly revision: PluginProvenanceTextV1;
  readonly mount: "eval" | "experiment";
  readonly subject: "eval" | "pair" | undefined;
  readonly sourcePosition: number;
  readonly effectiveBehaviorIdentity: readonly PluginBehaviorIdentityItemV1[];
  readonly credential: PluginProvenanceCredentialV1 | undefined;
  readonly contributionRefs: PluginContributionRefV1[];
}

const builders = new WeakMap<object, BuilderRuntime>();

/**
 * The framework supplies no blob drafts for provenance. The generic Record
 * builder's empty-tuple conditional otherwise infers `unknown`; this exact
 * impossible-draft element type preserves the real `never` E/R boundary.
 */
function noPluginProvenanceBlobs(): readonly RecordAttachmentBlobDraft<
  never,
  never
>[] {
  return [];
}

const INVALID_ERROR: PluginProvenanceBuilderError = Object.freeze({
  code: "plugin-provenance-builder-invalid",
});
const WRONG_OWNER_ERROR: PluginProvenanceBuilderError = Object.freeze({
  code: "plugin-provenance-builder-wrong-owner",
});
const UNDECLARED_ATTACHMENT_ERROR: PluginProvenanceBuilderError = Object.freeze({
  code: "plugin-provenance-builder-attachment-undeclared",
});
const CONTRIBUTION_LIMIT_ERROR: PluginProvenanceBuilderError = Object.freeze({
  code: "plugin-provenance-builder-contribution-limit",
});

const EVAL_FRAGMENT_FIELDS = new Set<EvalOwnerFragmentContributionRefV1["field"]>([
  "requirements",
  "sandbox-layer",
  "flags",
  "labels",
  "eval-hook",
]);
const EXPERIMENT_FRAGMENT_FIELDS = new Set<
  ExperimentOwnerFragmentContributionRefV1["field"]
>([
  "requirements",
  "sandbox-layer",
  "flags",
  "labels",
  "experiment-hook",
]);

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function builderRuntime(builder: unknown): BuilderRuntime | undefined {
  return isObject(builder) ? builders.get(builder) : undefined;
}

function copyBehaviorIdentity(
  items: readonly PluginBehaviorIdentityItemV1[],
): readonly PluginBehaviorIdentityItemV1[] {
  return Object.freeze(
    [...items]
      .map((item) => Object.freeze({ key: item.key, value: item.value }))
      .sort((left, right) =>
        left.key === right.key ? 0 : left.key < right.key ? -1 : 1,
      ),
  );
}

function copyCredential(
  credential: PluginProvenanceCredentialInput | undefined,
): PluginProvenanceCredentialV1 | undefined {
  return credential === undefined
    ? undefined
    : Object.freeze({
        kind: "redacted" as const,
        domain: credential.domain,
        revision: credential.revision,
      });
}

function validEntryShape(input: PluginProvenanceEntryBuilderInput): boolean {
  if (
    (input.owner !== "run" && input.owner !== "attempt") ||
    !isLinkedPluginRecordAttachments(input.linked) ||
    linkedPluginRecordAttachmentsOwner(input.linked) !== input.owner
  ) {
    return false;
  }
  if (!Array.isArray(input.effectiveBehaviorIdentity)) {
    return false;
  }
  if (input.owner === "run") {
    return input.mount === "experiment";
  }
  return (
    (input.mount === "eval" && (input.subject === "eval" || input.subject === "pair")) ||
    (input.mount === "experiment" && input.subject === "pair")
  );
}

export function createPluginProvenanceEntryBuilder(
  input: RunPluginProvenanceEntryBuilderInput,
): Either.Either<PluginProvenanceEntryBuilder<"run">, PluginProvenanceBuilderError>;
export function createPluginProvenanceEntryBuilder(
  input: AttemptPluginProvenanceEntryBuilderInput,
): Either.Either<PluginProvenanceEntryBuilder<"attempt">, PluginProvenanceBuilderError>;
export function createPluginProvenanceEntryBuilder(
  input: PluginProvenanceEntryBuilderInput,
): Either.Either<
  PluginProvenanceEntryBuilder<PluginRecordOwner>,
  PluginProvenanceBuilderError
> {
  if (!validEntryShape(input)) {
    return Either.left(INVALID_ERROR);
  }

  const builder = {
    [pluginProvenanceEntryBuilderTypeId]: () => {
      throw new Error("PluginProvenanceEntryBuilder type witness is never callable.");
    },
  } as unknown as PluginProvenanceEntryBuilder<PluginRecordOwner>;
  builders.set(
    builder,
    Object.freeze({
      owner: input.owner,
      linked: input.linked,
      name: input.name,
      instance: input.instance,
      revision: input.revision,
      mount: input.mount,
      subject: input.owner === "attempt" ? input.subject : undefined,
      sourcePosition: input.sourcePosition,
      effectiveBehaviorIdentity: copyBehaviorIdentity(input.effectiveBehaviorIdentity),
      credential: copyCredential(input.credential),
      contributionRefs: [],
    }),
  );
  return Either.right(Object.freeze(builder));
}

function appendContribution(
  runtime: BuilderRuntime,
  ref: PluginContributionRefV1,
): Either.Either<void, PluginProvenanceBuilderError> {
  if (runtime.contributionRefs.length >= 64) {
    return Either.left(CONTRIBUTION_LIMIT_ERROR);
  }
  runtime.contributionRefs.push(Object.freeze(ref));
  return Either.right(undefined);
}

/**
 * Only an acceptance receipt can turn a typed Attachment write into a durable
 * contribution reference. The ref is derived from the exact family definition,
 * never from Plugin-supplied name/schema/path data.
 */
export function mintTypedAttachmentContributionRef<Owner extends PluginRecordOwner>(
  builder: PluginProvenanceEntryBuilder<Owner>,
  acceptance: PluginRecordAttachmentAcceptance<Owner>,
): Either.Either<void, PluginProvenanceBuilderError> {
  const runtime = builderRuntime(builder);
  const capability = pluginRecordAttachmentAcceptanceCapability(acceptance);
  const acceptedLinked = pluginRecordAttachmentAcceptanceLinked(acceptance);
  if (
    runtime === undefined ||
    capability === undefined ||
    acceptedLinked === undefined
  ) {
    return Either.left(INVALID_ERROR);
  }
  if (runtime.owner !== capabilityOwner(capability)) {
    return Either.left(WRONG_OWNER_ERROR);
  }
  if (acceptedLinked !== runtime.linked) {
    return Either.left(UNDECLARED_ATTACHMENT_ERROR);
  }
  const linked = runtime.linked as LinkedPluginRecordAttachments<Owner>;
  if (!isLinkedPluginRecordAttachment(linked, capability)) {
    return Either.left(UNDECLARED_ATTACHMENT_ERROR);
  }
  const definition = pluginAttachmentCapabilityDefinition(capability);
  if (definition === undefined) {
    return Either.left(INVALID_ERROR);
  }
  const ref: TypedAttachmentContributionRefV1 = Object.freeze({
    kind: "typed-attachment",
    owner: runtime.owner,
    family: Object.freeze({
      name: definition.name,
      schemaId: definition.schemaId,
    }),
  });
  return appendContribution(runtime, ref);
}

function capabilityOwner<Owner extends PluginRecordOwner>(
  capability: PluginAttachmentCapability<Owner, unknown>,
): PluginRecordOwner | undefined {
  const definition = pluginAttachmentCapabilityDefinition(capability);
  return definition?.owner;
}

/** Framework minting for a contribution that was accepted during owner link. */
export function mintOwnerFragmentContributionRef<Owner extends PluginRecordOwner>(
  builder: PluginProvenanceEntryBuilder<Owner>,
  field:
    | EvalOwnerFragmentContributionRefV1["field"]
    | ExperimentOwnerFragmentContributionRefV1["field"],
): Either.Either<void, PluginProvenanceBuilderError> {
  const runtime = builderRuntime(builder);
  if (runtime === undefined) {
    return Either.left(INVALID_ERROR);
  }
  if (runtime.owner === "run") {
    if (!EXPERIMENT_FRAGMENT_FIELDS.has(field as ExperimentOwnerFragmentContributionRefV1["field"])) {
      return Either.left(WRONG_OWNER_ERROR);
    }
    return appendContribution(
      runtime,
      Object.freeze({
        kind: "owner-fragment" as const,
        owner: "experiment" as const,
        field: field as ExperimentOwnerFragmentContributionRefV1["field"],
      }),
    );
  }
  if (runtime.mount === "eval") {
    if (!EVAL_FRAGMENT_FIELDS.has(field as EvalOwnerFragmentContributionRefV1["field"])) {
      return Either.left(WRONG_OWNER_ERROR);
    }
    return appendContribution(
      runtime,
      Object.freeze({
        kind: "owner-fragment" as const,
        owner: "eval" as const,
        field: field as EvalOwnerFragmentContributionRefV1["field"],
      }),
    );
  }
  if (!EXPERIMENT_FRAGMENT_FIELDS.has(field as ExperimentOwnerFragmentContributionRefV1["field"])) {
    return Either.left(WRONG_OWNER_ERROR);
  }
  return appendContribution(
    runtime,
    Object.freeze({
      kind: "owner-fragment" as const,
      owner: "experiment" as const,
      field: field as ExperimentOwnerFragmentContributionRefV1["field"],
    }),
  );
}

/** Framework minting for the receiver's already-accepted safe projection. */
export function mintReceiverProjectionContributionRef<Owner extends PluginRecordOwner>(
  builder: PluginProvenanceEntryBuilder<Owner>,
  input: {
    readonly receiver: PluginProvenanceTextV1;
    readonly projection: PluginProvenanceTextV1;
  },
): Either.Either<void, PluginProvenanceBuilderError> {
  const runtime = builderRuntime(builder);
  if (runtime === undefined) {
    return Either.left(INVALID_ERROR);
  }
  const ref: ReceiverProjectionContributionRefV1 = Object.freeze({
    kind: "receiver-projection",
    scope: runtime.owner,
    receiver: input.receiver,
    projection: input.projection,
  });
  return appendContribution(runtime, ref);
}

function entryFromRuntime(runtime: BuilderRuntime): unknown {
  const base = {
    name: runtime.name,
    instance: runtime.instance,
    revision: runtime.revision,
    mount: runtime.mount,
    source: Object.freeze({
      kind: "plugins-array" as const,
      position: runtime.sourcePosition,
    }),
    effectiveBehaviorIdentity: runtime.effectiveBehaviorIdentity,
    contributionRefs: Object.freeze([...runtime.contributionRefs]),
    ...(runtime.credential === undefined ? {} : { credential: runtime.credential }),
  };
  return runtime.owner === "run"
    ? Object.freeze(base)
    : Object.freeze({ ...base, subject: runtime.subject });
}

export function buildPluginProvenanceEntry(
  builder: PluginProvenanceEntryBuilder<"run">,
): Either.Either<RunPluginProvenanceEntryV1, PluginProvenanceBuilderError>;
export function buildPluginProvenanceEntry(
  builder: PluginProvenanceEntryBuilder<"attempt">,
): Either.Either<AttemptPluginProvenanceEntryV1, PluginProvenanceBuilderError>;
export function buildPluginProvenanceEntry(
  builder: PluginProvenanceEntryBuilder<PluginRecordOwner>,
): Either.Either<
  RunPluginProvenanceEntryV1 | AttemptPluginProvenanceEntryV1,
  PluginProvenanceBuilderError
> {
  const runtime = builderRuntime(builder);
  if (runtime === undefined) {
    return Either.left(INVALID_ERROR);
  }
  if (runtime.owner === "run") {
    const decoded = Schema.decodeUnknownEither(
      RunPluginProvenanceEntryV1Schema,
      PluginProvenanceExactParseOptions,
    )(entryFromRuntime(runtime));
    return Either.isLeft(decoded)
      ? Either.left(INVALID_ERROR)
      : Either.right(decoded.right);
  }
  const decoded = Schema.decodeUnknownEither(
    AttemptPluginProvenanceEntryV1Schema,
    PluginProvenanceExactParseOptions,
  )(entryFromRuntime(runtime));
  return Either.isLeft(decoded)
    ? Either.left(INVALID_ERROR)
    : Either.right(decoded.right);
}

function buildRunDocument(
  entries: readonly PluginProvenanceEntryBuilder<"run">[],
): Either.Either<RunPluginProvenanceV1, PluginProvenanceBuilderError> {
  const built: RunPluginProvenanceEntryV1[] = [];
  for (const builder of entries) {
    const runtime = builderRuntime(builder);
    if (runtime === undefined) {
      return Either.left(INVALID_ERROR);
    }
    if (runtime.owner !== "run") {
      return Either.left(WRONG_OWNER_ERROR);
    }
    const entry = buildPluginProvenanceEntry(builder);
    if (Either.isLeft(entry)) {
      return Either.left(entry.left);
    }
    built.push(entry.right);
  }
  const decoded = Schema.decodeUnknownEither(
    RunPluginProvenanceV1Schema,
    PluginProvenanceExactParseOptions,
  )({ scope: "run", entries: built });
  return Either.isLeft(decoded)
    ? Either.left(INVALID_ERROR)
    : Either.right(decoded.right);
}

function buildAttemptDocument(
  entries: readonly PluginProvenanceEntryBuilder<"attempt">[],
): Either.Either<AttemptPluginProvenanceV1, PluginProvenanceBuilderError> {
  const built: AttemptPluginProvenanceEntryV1[] = [];
  for (const builder of entries) {
    const runtime = builderRuntime(builder);
    if (runtime === undefined) {
      return Either.left(INVALID_ERROR);
    }
    if (runtime.owner !== "attempt") {
      return Either.left(WRONG_OWNER_ERROR);
    }
    const entry = buildPluginProvenanceEntry(builder);
    if (Either.isLeft(entry)) {
      return Either.left(entry.left);
    }
    built.push(entry.right);
  }
  const decoded = Schema.decodeUnknownEither(
    AttemptPluginProvenanceV1Schema,
    PluginProvenanceExactParseOptions,
  )({ scope: "attempt", entries: built });
  return Either.isLeft(decoded)
    ? Either.left(INVALID_ERROR)
    : Either.right(decoded.right);
}

export function buildRunPluginProvenanceV1(
  entries: readonly PluginProvenanceEntryBuilder<"run">[],
): Either.Either<RunPluginProvenanceV1, PluginProvenanceBuilderError> {
  return buildRunDocument(entries);
}

export function buildAttemptPluginProvenanceV1(
  entries: readonly PluginProvenanceEntryBuilder<"attempt">[],
): Either.Either<AttemptPluginProvenanceV1, PluginProvenanceBuilderError> {
  return buildAttemptDocument(entries);
}

/** Framework-only write construction for the exact Run-owned document. */
export function makeRunPluginProvenanceWrite(
  entries: readonly PluginProvenanceEntryBuilder<"run">[],
): Either.Either<
  RecordAttachmentWrite<"run", never, never>,
  PluginProvenanceBuilderError
> {
  const document = buildRunPluginProvenanceV1(entries);
  if (Either.isLeft(document)) {
    return Either.left(document.left);
  }
  return Either.right(
    makeRecordAttachmentWrite<
      "run",
      RunPluginProvenanceV1,
      readonly RecordAttachmentBlobDraft<never, never>[]
    >(
      RunPluginProvenanceV1Family,
      () => ({
        payload: document.right,
        blobs: noPluginProvenanceBlobs(),
      }),
    ),
  );
}

/** Framework-only write construction for the exact Attempt-owned document. */
export function makeAttemptPluginProvenanceWrite(
  entries: readonly PluginProvenanceEntryBuilder<"attempt">[],
): Either.Either<
  RecordAttachmentWrite<"attempt", never, never>,
  PluginProvenanceBuilderError
> {
  const document = buildAttemptPluginProvenanceV1(entries);
  if (Either.isLeft(document)) {
    return Either.left(document.left);
  }
  return Either.right(
    makeRecordAttachmentWrite<
      "attempt",
      AttemptPluginProvenanceV1,
      readonly RecordAttachmentBlobDraft<never, never>[]
    >(
      AttemptPluginProvenanceV1Family,
      () => ({
        payload: document.right,
        blobs: noPluginProvenanceBlobs(),
      }),
    ),
  );
}

/** Narrow helper for framework inputs; it admits only durable scalar identity values. */
export function pluginBehaviorIdentityValue(
  value: PluginBehaviorIdentityValueV1,
): PluginBehaviorIdentityValueV1 {
  return value;
}
