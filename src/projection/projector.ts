import type {
  RecordAttachmentFamily,
  RecordAttachmentValue,
} from "../record/attachment/index.ts";
import { recordAttachmentFamilyOwner } from "../record/attachment/internal.ts";
import type { RecordAttachmentOwner } from "../record/model/core.ts";
import type { ProjectionAccess } from "./model.ts";

const recordAttachmentProjectorTypeId: unique symbol = Symbol(
  "@niceeval/projection/RecordAttachmentProjector",
);
const recordProjectionTypeId: unique symbol = Symbol(
  "@niceeval/projection/RecordProjection",
);
const recordAttachmentProjectorRuntimeTypeId: unique symbol = Symbol(
  "@niceeval/projection/RecordAttachmentProjectorRuntime",
);
const recordProjectionRuntimeTypeId: unique symbol = Symbol(
  "@niceeval/projection/RecordProjectionRuntime",
);

/**
 * A synchronous interpretation of exactly one owner-local Attachment family.
 * The nominal symbol only protects ordinary TypeScript construction; the
 * package-private WeakMap below is the actual runtime authority.
 */
export interface RecordAttachmentProjector<
  Owner extends RecordAttachmentOwner,
  Value,
> {
  readonly owner: Owner;
  readonly [recordAttachmentProjectorTypeId]: (value: Value) => Value;
}

export interface RecordProjection<
  Access extends ProjectionAccess,
  Value,
> {
  readonly access: Access;
  readonly [recordProjectionTypeId]: (value: Value) => Value;
}

interface ProjectorIdentity {
  readonly owner: RecordAttachmentOwner;
}

interface ProjectionIdentity {
  readonly access: ProjectionAccess;
}

interface ProjectorRuntime<
  Owner extends RecordAttachmentOwner,
  Value,
> {
  readonly use: <Result>(
    use: <Payload>(
      family: RecordAttachmentFamily<Owner, Payload>,
      project: (value: RecordAttachmentValue<Payload>) => Value,
    ) => Result,
  ) => Result;
}

interface PackageRecordAttachmentProjector<
  Owner extends RecordAttachmentOwner,
  Value,
> extends RecordAttachmentProjector<Owner, Value> {
  readonly [recordAttachmentProjectorRuntimeTypeId]: ProjectorRuntime<
    Owner,
    Value
  >;
}

interface AttemptSlotProjectionDeclaration<Value> {
  readonly access: "attempt-slot";
  readonly projector: RecordAttachmentProjector<"attempt", Value>;
}

interface AttemptOriginRunProjectionDeclaration<Value> {
  readonly access: "attempt-origin-run";
  readonly projector: RecordAttachmentProjector<"run", Value>;
}

interface SelectedRunProjectionDeclaration<Value> {
  readonly access: "selected-run";
  readonly projector: RecordAttachmentProjector<"run", Value>;
}

/**
 * @internal The factory closure is the Value witness. The union gives runtime
 * consumers an exact owner after discriminating access.
 */
export type RecordProjectionDeclaration<Value> =
  | AttemptSlotProjectionDeclaration<Value>
  | AttemptOriginRunProjectionDeclaration<Value>
  | SelectedRunProjectionDeclaration<Value>;

interface ProjectionRuntime<Value> {
  readonly declaration: () => RecordProjectionDeclaration<Value>;
}

interface PackageRecordProjection<
  Access extends ProjectionAccess,
  Value,
> extends RecordProjection<Access, Value> {
  readonly [recordProjectionRuntimeTypeId]: ProjectionRuntime<Value>;
}

const projectorIdentityByProjector = new WeakMap<object, ProjectorIdentity>();
const projectionIdentityByProjection = new WeakMap<object, ProjectionIdentity>();

export function defineRecordAttachmentProjector<
  Owner extends RecordAttachmentOwner,
  Payload,
  Value,
>(input: {
  readonly attachment: RecordAttachmentFamily<Owner, Payload>;
  readonly project: (value: RecordAttachmentValue<Payload>) => Value;
}): RecordAttachmentProjector<Owner, Value> {
  const owner = recordAttachmentFamilyOwner(input.attachment);
  if (owner === undefined) {
    throw new TypeError("attachment must be a RecordAttachmentFamily created by NiceEval");
  }
  if (typeof input.project !== "function") {
    throw new TypeError("project must be a synchronous function");
  }

  const runtime: ProjectorRuntime<Owner, Value> = Object.freeze({
    use: <Result>(use: <CurrentPayload>(
      family: RecordAttachmentFamily<Owner, CurrentPayload>,
      project: (value: RecordAttachmentValue<CurrentPayload>) => Value,
    ) => Result): Result => use(input.attachment, input.project),
  });
  const projector: PackageRecordAttachmentProjector<Owner, Value> = {
    owner,
    [recordAttachmentProjectorTypeId]: (value: Value): Value => value,
    [recordAttachmentProjectorRuntimeTypeId]: runtime,
  };
  const frozenProjector = Object.freeze(projector);
  projectorIdentityByProjector.set(frozenProjector, Object.freeze({ owner }));
  return frozenProjector;
}

export function attemptSlotProjection<Value>(
  projector: RecordAttachmentProjector<"attempt", Value>,
): RecordProjection<"attempt-slot", Value> {
  assertRecordAttachmentProjectorOwner(projector, "attempt");
  const declaration: AttemptSlotProjectionDeclaration<Value> = Object.freeze({
    access: "attempt-slot",
    projector,
  });
  return makeRecordProjection("attempt-slot", declaration);
}

export function attemptOriginRunProjection<Value>(
  projector: RecordAttachmentProjector<"run", Value>,
): RecordProjection<"attempt-origin-run", Value> {
  assertRecordAttachmentProjectorOwner(projector, "run");
  const declaration: AttemptOriginRunProjectionDeclaration<Value> = Object.freeze({
    access: "attempt-origin-run",
    projector,
  });
  return makeRecordProjection("attempt-origin-run", declaration);
}

export function selectedRunProjection<Value>(
  projector: RecordAttachmentProjector<"run", Value>,
): RecordProjection<"selected-run", Value> {
  assertRecordAttachmentProjectorOwner(projector, "run");
  const declaration: SelectedRunProjectionDeclaration<Value> = Object.freeze({
    access: "selected-run",
    projector,
  });
  return makeRecordProjection("selected-run", declaration);
}

/**
 * @internal Invokes a factory-captured generic closure after WeakMap identity
 * validation. This retains the exact attachment payload and public Value
 * without recovering either from erased map contents.
 */
export function withRecordAttachmentProjector<
  Owner extends RecordAttachmentOwner,
  Value,
  Result,
>(
  projector: RecordAttachmentProjector<Owner, Value>,
  use: <Payload>(
    family: RecordAttachmentFamily<Owner, Payload>,
    project: (value: RecordAttachmentValue<Payload>) => Value,
  ) => Result,
): Result {
  if (!isPackageRecordAttachmentProjector(projector)) {
    throw new TypeError("projector must be created by defineRecordAttachmentProjector");
  }
  return projector[recordAttachmentProjectorRuntimeTypeId].use(use);
}

/** @internal Rejects a copied or type-asserted projection before Record I/O. */
export function recordProjectionDeclaration<
  Access extends ProjectionAccess,
  Value,
>(
  projection: RecordProjection<Access, Value>,
): RecordProjectionDeclaration<Value> {
  if (!isPackageRecordProjection(projection)) {
    throw new TypeError("projection must be created by a projection factory");
  }
  const identity = projectionIdentityByProjection.get(projection);
  if (identity === undefined || identity.access !== projection.access) {
    throw new TypeError("projection must be created by a projection factory");
  }
  const declaration = projection[recordProjectionRuntimeTypeId].declaration();
  if (declaration.access !== identity.access) {
    throw new Error("projection factory declaration lost its access invariant");
  }
  return declaration;
}

function makeRecordProjection<Value>(
  access: "attempt-slot",
  declaration: AttemptSlotProjectionDeclaration<Value>,
): RecordProjection<"attempt-slot", Value>;
function makeRecordProjection<Value>(
  access: "attempt-origin-run",
  declaration: AttemptOriginRunProjectionDeclaration<Value>,
): RecordProjection<"attempt-origin-run", Value>;
function makeRecordProjection<Value>(
  access: "selected-run",
  declaration: SelectedRunProjectionDeclaration<Value>,
): RecordProjection<"selected-run", Value>;
function makeRecordProjection<Value>(
  access: ProjectionAccess,
  declaration: RecordProjectionDeclaration<Value>,
): RecordProjection<ProjectionAccess, Value> {
  const runtime: ProjectionRuntime<Value> = Object.freeze({
    declaration: (): RecordProjectionDeclaration<Value> => declaration,
  });
  const projection: PackageRecordProjection<ProjectionAccess, Value> = {
    access,
    [recordProjectionTypeId]: (value: Value): Value => value,
    [recordProjectionRuntimeTypeId]: runtime,
  };
  const frozenProjection = Object.freeze(projection);
  projectionIdentityByProjection.set(frozenProjection, Object.freeze({ access }));
  return frozenProjection;
}

function assertRecordAttachmentProjectorOwner<
  Owner extends RecordAttachmentOwner,
  Value,
>(
  projector: RecordAttachmentProjector<Owner, Value>,
  owner: Owner,
): void {
  if (!isPackageRecordAttachmentProjector(projector) || projector.owner !== owner) {
    throw new TypeError("projector owner does not match projection access");
  }
}

function isPackageRecordAttachmentProjector<
  Owner extends RecordAttachmentOwner,
  Value,
>(
  projector: RecordAttachmentProjector<Owner, Value>,
): projector is PackageRecordAttachmentProjector<Owner, Value> {
  const identity = projectorIdentityByProjector.get(projector);
  return identity !== undefined && identity.owner === projector.owner;
}

function isPackageRecordProjection<
  Access extends ProjectionAccess,
  Value,
>(
  projection: RecordProjection<Access, Value>,
): projection is PackageRecordProjection<Access, Value> {
  return projectionIdentityByProjection.has(projection);
}
