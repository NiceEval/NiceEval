import { Effect, Either } from "effect";
import {
  makeRecordAttachmentWrite,
  type RecordAttachmentBlobBuild,
  type RecordAttachmentBlobBuilder,
  type RecordAttachmentFamily,
  type RecordAttachmentWrite,
  type RecordBlobDrafts,
  type RecordBlobErrors,
  type RecordBlobRequirements,
} from "../../record/attachment/index.ts";
import {
  isRecordAttachmentFamily,
  recordAttachmentFamilyCurrentDefinition,
  recordAttachmentFamilyOwner,
} from "../../record/attachment/internal.ts";
import { isNiceEvalRecordAttachmentName } from "../../record/model/identifiers.ts";
import type { JsonRecordAttachmentDefinition } from "../../record/attachment/types.ts";
import type { PluginRecordOwner } from "./model.ts";

const pluginAttachmentCapabilityTypeId: unique symbol = Symbol(
  "@niceeval/plugins/PluginAttachmentCapability",
);
const linkedPluginRecordAttachmentsTypeId: unique symbol = Symbol(
  "@niceeval/plugins/LinkedPluginRecordAttachments",
);
const pluginRecordAttachmentAcceptanceTypeId: unique symbol = Symbol(
  "@niceeval/plugins/PluginRecordAttachmentAcceptance",
);

/**
 * A declaration is an opaque authority token. Its family and owner live in a
 * module-private WeakMap, so copying fields or transplanting the nominal brand
 * cannot grant Record write access.
 */
export interface PluginAttachmentCapability<
  out Owner extends PluginRecordOwner,
  out Payload,
> {
  readonly [pluginAttachmentCapabilityTypeId]: () => {
    readonly owner: Owner;
    readonly payload: Payload;
  };
}

/** A link-owned allowlist. There is intentionally no Group specialization. */
export interface LinkedPluginRecordAttachments<out Owner extends PluginRecordOwner> {
  readonly [linkedPluginRecordAttachmentsTypeId]: () => Owner;
}

/** A receipt minted only after the generic Record writer accepted one write. */
export interface PluginRecordAttachmentAcceptance<
  out Owner extends PluginRecordOwner,
> {
  readonly [pluginRecordAttachmentAcceptanceTypeId]: () => Owner;
}

export type PluginRecordAttachmentWriteError =
  | { readonly code: "plugin-record-closed" }
  | { readonly code: "plugin-record-wrong-owner" }
  | { readonly code: "plugin-record-attachment-undeclared" }
  | { readonly code: "plugin-record-attachment-duplicate" };

export type PluginRecordAttachmentLinkError = PluginRecordAttachmentWriteError;

export interface PluginRecordSink<
  Owner extends PluginRecordOwner,
  SinkError,
  SinkRequirements,
> {
  readonly record: <E, R>(
    write: RecordAttachmentWrite<Owner, E, R>,
  ) => Effect.Effect<void, SinkError | E, SinkRequirements | R>;
}

export interface PluginRecordContext<
  Owner extends PluginRecordOwner,
  SinkError = never,
  SinkRequirements = never,
> {
  readonly record: <Payload, E, R>(
    capability: PluginAttachmentCapability<Owner, Payload>,
    write: RecordAttachmentWrite<Owner, E, R>,
  ) => Effect.Effect<
    void,
    PluginRecordAttachmentWriteError | SinkError | E,
    SinkRequirements | R
  >;
}

/** Framework code keeps the lease and passes only `context` to a lifecycle. */
export interface PluginRecordContextLease<
  Owner extends PluginRecordOwner,
  SinkError = never,
  SinkRequirements = never,
> {
  readonly context: PluginRecordContext<Owner, SinkError, SinkRequirements>;
  readonly close: () => void;
}

export interface CreatePluginRecordContextInput<
  Owner extends PluginRecordOwner,
  SinkError,
  SinkRequirements,
> {
  readonly linked: LinkedPluginRecordAttachments<Owner>;
  readonly sink: PluginRecordSink<Owner, SinkError, SinkRequirements>;
  /** Framework-only hook; invoked after the generic writer accepts a write. */
  readonly onAccepted?: (
    acceptance: PluginRecordAttachmentAcceptance<Owner>,
  ) => void;
}

interface CapabilityRuntime {
  readonly owner: PluginRecordOwner;
  readonly family: object;
  readonly definition: object;
}

interface LinkedRuntime {
  readonly owner: PluginRecordOwner;
  readonly capabilities: ReadonlySet<object>;
  readonly families: ReadonlySet<object>;
}

interface CapabilityWriteRuntime {
  readonly capability: object;
  readonly family: object;
  readonly owner: PluginRecordOwner;
}

interface AcceptanceRuntime {
  readonly capability: object;
  readonly linked: object;
}

const capabilities = new WeakMap<object, CapabilityRuntime>();
const linkedAttachments = new WeakMap<object, LinkedRuntime>();
const capabilityWrites = new WeakMap<object, CapabilityWriteRuntime>();
const acceptedWrites = new WeakMap<object, AcceptanceRuntime>();

const CLOSED_ERROR: PluginRecordAttachmentWriteError = Object.freeze({
  code: "plugin-record-closed",
});
const WRONG_OWNER_ERROR: PluginRecordAttachmentWriteError = Object.freeze({
  code: "plugin-record-wrong-owner",
});
const UNDECLARED_ERROR: PluginRecordAttachmentWriteError = Object.freeze({
  code: "plugin-record-attachment-undeclared",
});
const DUPLICATE_ERROR: PluginRecordAttachmentWriteError = Object.freeze({
  code: "plugin-record-attachment-duplicate",
});

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isPluginRecordOwner(value: unknown): value is PluginRecordOwner {
  return value === "run" || value === "attempt";
}

function capabilityRuntime(
  capability: unknown,
): CapabilityRuntime | undefined {
  return isObject(capability) ? capabilities.get(capability) : undefined;
}

function linkedRuntime(linked: unknown): LinkedRuntime | undefined {
  return isObject(linked) ? linkedAttachments.get(linked) : undefined;
}

function throwInvalidCapabilityDeclaration(): never {
  throw new TypeError(
    "declarePluginAttachment requires a genuine RecordAttachment family.",
  );
}

function mintPluginRecordAttachmentAcceptance<Owner extends PluginRecordOwner>(
  capability: PluginAttachmentCapability<Owner, unknown>,
  linked: LinkedPluginRecordAttachments<Owner>,
): PluginRecordAttachmentAcceptance<Owner> {
  const acceptance = {
    [pluginRecordAttachmentAcceptanceTypeId]: () => {
      throw new Error("PluginRecordAttachmentAcceptance type witness is never callable.");
    },
  } as unknown as PluginRecordAttachmentAcceptance<Owner>;
  acceptedWrites.set(
    acceptance,
    Object.freeze({ capability, linked }),
  );
  return Object.freeze(acceptance);
}

/**
 * Declares a typed capability without exposing an owner, name, schema id, path,
 * JSON route, or mutable family metadata to lifecycle code.
 */
export function declarePluginAttachment<
  const Owner extends PluginRecordOwner,
  Payload,
>(input: {
  readonly family: RecordAttachmentFamily<Owner, Payload>;
}): PluginAttachmentCapability<Owner, Payload> {
  const family = input.family;
  if (!isRecordAttachmentFamily(family)) {
    return throwInvalidCapabilityDeclaration();
  }
  const owner = recordAttachmentFamilyOwner(family);
  const definition = recordAttachmentFamilyCurrentDefinition(family);
  if (owner === undefined || definition === undefined) {
    return throwInvalidCapabilityDeclaration();
  }
  if (isNiceEvalRecordAttachmentName(definition.name)) {
    throw new TypeError(
      "declarePluginAttachment cannot grant a Plugin a framework-owned Attachment family.",
    );
  }

  const capability = {
    [pluginAttachmentCapabilityTypeId]: () => {
      throw new Error("PluginAttachmentCapability type witness is never callable.");
    },
  } as unknown as PluginAttachmentCapability<Owner, Payload>;
  capabilities.set(
    capability,
    Object.freeze({
      owner,
      family,
      definition,
    }),
  );
  return Object.freeze(capability);
}

/**
 * Link only Record declarations. This intentionally does not implement Plugin
 * discovery, lifecycle, Sandbox, or definition composition.
 */
export function linkPluginRecordAttachments<Owner extends PluginRecordOwner>(input: {
  readonly owner: Owner;
  readonly attachments: readonly PluginAttachmentCapability<Owner, unknown>[];
}): Either.Either<
  LinkedPluginRecordAttachments<Owner>,
  PluginRecordAttachmentLinkError
> {
  if (!isPluginRecordOwner(input.owner)) {
    return Either.left(WRONG_OWNER_ERROR);
  }
  if (!Array.isArray(input.attachments)) {
    return Either.left(UNDECLARED_ERROR);
  }

  const capabilityObjects = new Set<object>();
  const familyObjects = new Set<object>();
  for (const capability of input.attachments) {
    const runtime = capabilityRuntime(capability);
    if (runtime === undefined) {
      return Either.left(UNDECLARED_ERROR);
    }
    if (runtime.owner !== input.owner) {
      return Either.left(WRONG_OWNER_ERROR);
    }
    if (capabilityObjects.has(capability)) {
      return Either.left(DUPLICATE_ERROR);
    }
    if (familyObjects.has(runtime.family)) {
      return Either.left(DUPLICATE_ERROR);
    }
    capabilityObjects.add(capability);
    familyObjects.add(runtime.family);
  }

  const linked = {
    [linkedPluginRecordAttachmentsTypeId]: () => {
      throw new Error("LinkedPluginRecordAttachments type witness is never callable.");
    },
  } as unknown as LinkedPluginRecordAttachments<Owner>;
  linkedAttachments.set(
    linked,
    Object.freeze({
      owner: input.owner,
      capabilities: capabilityObjects,
      families: familyObjects,
    }),
  );
  return Either.right(Object.freeze(linked));
}

/**
 * Capability-specific write construction records the exact family object that
 * minted the write. A generic write from another family therefore cannot be
 * transplanted into this capability, even when the schemas look identical.
 */
export function makePluginAttachmentWrite<
  Owner extends PluginRecordOwner,
  Payload,
  const Blobs extends RecordBlobDrafts,
>(
  capability: PluginAttachmentCapability<Owner, Payload>,
  build: (
    blobs: RecordAttachmentBlobBuilder,
  ) => RecordAttachmentBlobBuild<Payload, Blobs>,
): RecordAttachmentWrite<
  Owner,
  RecordBlobErrors<Blobs>,
  RecordBlobRequirements<Blobs>
> {
  const runtime = capabilityRuntime(capability);
  if (runtime === undefined) {
    return throwInvalidCapabilityDeclaration();
  }
  const family = runtime.family as RecordAttachmentFamily<Owner, Payload>;
  const write = makeRecordAttachmentWrite(family, build);
  capabilityWrites.set(
    write,
    Object.freeze({
      capability,
      family: runtime.family,
      owner: runtime.owner,
    }),
  );
  return write;
}

/**
 * Build a narrow owner-local context. Its sole operation is the typed write;
 * raw names, schema ids, paths, payload JSON, and Group context do not exist.
 */
export function createPluginRecordContext<
  Owner extends PluginRecordOwner,
  SinkError,
  SinkRequirements,
>(
  input: CreatePluginRecordContextInput<Owner, SinkError, SinkRequirements>,
): PluginRecordContextLease<Owner, SinkError, SinkRequirements> {
  const linked = linkedRuntime(input.linked);
  if (linked === undefined) {
    throw new TypeError("createPluginRecordContext requires a genuine linked Record allowlist.");
  }

  let closed = false;
  const acceptedFamilies = new Set<object>();
  const pendingFamilies = new Set<object>();

  const context: PluginRecordContext<Owner, SinkError, SinkRequirements> = Object.freeze({
    record<Payload, E, R>(
      capability: PluginAttachmentCapability<Owner, Payload>,
      write: RecordAttachmentWrite<Owner, E, R>,
    ): Effect.Effect<
      void,
      PluginRecordAttachmentWriteError | SinkError | E,
      SinkRequirements | R
    > {
      return Effect.suspend<
        void,
        PluginRecordAttachmentWriteError | SinkError | E,
        SinkRequirements | R
      >(() => {
        if (closed) {
          return Effect.fail(CLOSED_ERROR);
        }
        const capabilityInfo = capabilityRuntime(capability);
        if (capabilityInfo === undefined) {
          return Effect.fail(UNDECLARED_ERROR);
        }
        if (capabilityInfo.owner !== linked.owner) {
          return Effect.fail(WRONG_OWNER_ERROR);
        }
        if (!linked.capabilities.has(capability)) {
          return Effect.fail(UNDECLARED_ERROR);
        }
        const writeInfo = isObject(write) ? capabilityWrites.get(write) : undefined;
        if (writeInfo !== undefined && writeInfo.owner !== linked.owner) {
          return Effect.fail(WRONG_OWNER_ERROR);
        }
        if (
          writeInfo === undefined ||
          writeInfo.capability !== capability ||
          writeInfo.family !== capabilityInfo.family
        ) {
          return Effect.fail(UNDECLARED_ERROR);
        }
        if (writeInfo.owner !== linked.owner) {
          return Effect.fail(WRONG_OWNER_ERROR);
        }
        if (
          acceptedFamilies.has(capabilityInfo.family) ||
          pendingFamilies.has(capabilityInfo.family)
        ) {
          return Effect.fail(DUPLICATE_ERROR);
        }

        pendingFamilies.add(capabilityInfo.family);
        let accepted = false;
        return input.sink.record(write).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              pendingFamilies.delete(capabilityInfo.family);
              acceptedFamilies.add(capabilityInfo.family);
              accepted = true;
              input.onAccepted?.(
                mintPluginRecordAttachmentAcceptance(
                  capability as PluginAttachmentCapability<Owner, unknown>,
                  input.linked,
                ),
              );
            }),
          ),
          Effect.ensuring(
            Effect.sync(() => {
              if (!accepted) {
                pendingFamilies.delete(capabilityInfo.family);
              }
            }),
          ),
        );
      });
    },
  });

  return Object.freeze({
    context,
    close: () => {
      closed = true;
    },
  });
}

/** @internal Framework provenance code uses this without opening a JSON route. */
export function pluginAttachmentCapabilityDefinition<
  Owner extends PluginRecordOwner,
  Payload,
>(
  capability: PluginAttachmentCapability<Owner, Payload>,
): JsonRecordAttachmentDefinition<Owner, Payload> | undefined {
  const runtime = capabilityRuntime(capability);
  return runtime === undefined
    ? undefined
    : (runtime.definition as JsonRecordAttachmentDefinition<Owner, Payload>);
}

/** @internal Explicit registry adaptation retains the genuine family object. */
export function pluginAttachmentCapabilityFamily<
  Owner extends PluginRecordOwner,
  Payload,
>(
  capability: PluginAttachmentCapability<Owner, Payload>,
): RecordAttachmentFamily<Owner, Payload> | undefined {
  const runtime = capabilityRuntime(capability);
  return runtime === undefined
    ? undefined
    : (runtime.family as RecordAttachmentFamily<Owner, Payload>);
}

/** @internal Provenance minting checks the exact linked declaration token. */
export function isLinkedPluginRecordAttachment<Owner extends PluginRecordOwner>(
  linked: LinkedPluginRecordAttachments<Owner>,
  capability: PluginAttachmentCapability<Owner, unknown>,
): boolean {
  const linkedInfo = linkedRuntime(linked);
  const capabilityInfo = capabilityRuntime(capability);
  return (
    linkedInfo !== undefined &&
    capabilityInfo !== undefined &&
    linkedInfo.owner === capabilityInfo.owner &&
    linkedInfo.capabilities.has(capability)
  );
}

/** @internal Runtime guard for framework provenance and lifecycle integration. */
export function isLinkedPluginRecordAttachments(
  value: unknown,
): value is LinkedPluginRecordAttachments<PluginRecordOwner> {
  return linkedRuntime(value) !== undefined;
}

/** @internal Provenance validates that its builder and link have one exact owner. */
export function linkedPluginRecordAttachmentsOwner(
  linked: LinkedPluginRecordAttachments<PluginRecordOwner>,
): PluginRecordOwner | undefined {
  return linkedRuntime(linked)?.owner;
}

/** @internal A provenance ref may only derive from this post-acceptance receipt. */
export function pluginRecordAttachmentAcceptanceCapability<
  Owner extends PluginRecordOwner,
>(
  acceptance: PluginRecordAttachmentAcceptance<Owner>,
): PluginAttachmentCapability<Owner, unknown> | undefined {
  const runtime = isObject(acceptance) ? acceptedWrites.get(acceptance) : undefined;
  return runtime?.capability as PluginAttachmentCapability<Owner, unknown> | undefined;
}

/** @internal Provenance must bind a receipt to its exact lifecycle allowlist. */
export function pluginRecordAttachmentAcceptanceLinked<
  Owner extends PluginRecordOwner,
>(
  acceptance: PluginRecordAttachmentAcceptance<Owner>,
): LinkedPluginRecordAttachments<Owner> | undefined {
  const runtime = isObject(acceptance) ? acceptedWrites.get(acceptance) : undefined;
  return runtime?.linked as LinkedPluginRecordAttachments<Owner> | undefined;
}
