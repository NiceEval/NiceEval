import {
  compareObservabilityReferenceTarget,
  compareObservabilityText,
  isAttemptObservabilityFamilySchemaId,
  isAttemptReferenceTarget,
  isCanonicalAttemptReferences,
  isCanonicalRunReferences,
  isObservabilityEntityId,
  isRunObservabilityFamilySchemaId,
  isRunReferenceTarget,
  referenceTargetKey,
  type AttemptObservabilityFamilySchemaId,
  type AttemptReferenceTarget,
  type AttemptReferencesForFamily,
  type ObservabilityEntityId,
  type ObservabilityOwner,
  type ObservabilityReferenceTarget,
  type RunObservabilityFamilySchemaId,
  type RunReferenceTarget,
  type RunReferencesForFamily,
} from "./model.ts";
import {
  observabilityCrossReferenceInvalidError,
  observabilityIdentityInvalidError,
  observabilityOwnerOrSchemaInvalidError,
  observabilityRequiredAttachmentMissingError,
  type ObservabilityRecordContractError,
} from "./errors.ts";

const observabilityFamilyValidationTypeId: unique symbol = Symbol(
  "@niceeval/o11y/ObservabilityFamilyValidation",
);

/**
 * A package-created proof that one family has completed its local validation.
 * Payloads remain in their owning family; this proof carries only entity and
 * direct-reference facts needed by the whole-Run contract.
 */
export interface ObservabilityFamilyValidation<Owner extends ObservabilityOwner> {
  readonly [observabilityFamilyValidationTypeId]: () => Owner;
}

export interface AttemptReferenceSource<
  Family extends AttemptObservabilityFamilySchemaId,
> {
  readonly sourceId: ObservabilityEntityId;
  readonly refs: readonly AttemptReferencesForFamily<Family>[];
}

export interface RunReferenceSource<Family extends RunObservabilityFamilySchemaId> {
  readonly sourceId: ObservabilityEntityId;
  readonly refs: readonly RunReferencesForFamily<Family>[];
}

export interface AttemptObservabilityFamilyValidationInput<
  Family extends AttemptObservabilityFamilySchemaId,
> {
  readonly schemaId: Family;
  readonly entities: readonly AttemptReferenceTarget[];
  readonly references: readonly AttemptReferenceSource<Family>[];
  /** Family-local timing/source-frame errors use the stable aggregate union. */
  readonly localErrors?: readonly ObservabilityRecordContractError[];
}

export interface RunObservabilityFamilyValidationInput<
  Family extends RunObservabilityFamilySchemaId,
> {
  readonly schemaId: Family;
  readonly entities: readonly RunReferenceTarget[];
  readonly references: readonly RunReferenceSource<Family>[];
  /** Family-local timing/source-frame errors use the stable aggregate union. */
  readonly localErrors?: readonly ObservabilityRecordContractError[];
}

interface ReferenceSourceRuntime {
  readonly sourceId: string;
  readonly refs: readonly ObservabilityReferenceTarget[];
}

interface FamilyValidationRuntime {
  readonly owner: ObservabilityOwner;
  readonly schemaId: string;
  readonly entities: readonly ObservabilityReferenceTarget[];
  readonly references: readonly ReferenceSourceRuntime[];
  readonly localErrors: readonly ObservabilityRecordContractError[];
}

const familyValidations = new WeakMap<object, FamilyValidationRuntime>();

const ATTEMPT_REQUIRED_FAMILIES = Object.freeze([
  "niceeval.observability",
  "niceeval.observability",
  "niceeval.observability",
  "niceeval.observability",
  "niceeval.observability",
] as const);

const RUN_REQUIRED_FAMILIES = Object.freeze([
  "niceeval.observability",
  "niceeval.observability",
] as const);

export const REQUIRED_ATTEMPT_OBSERVABILITY_FAMILIES =
  ATTEMPT_REQUIRED_FAMILIES;
export const REQUIRED_RUN_OBSERVABILITY_FAMILIES = RUN_REQUIRED_FAMILIES;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function validationRuntime(
  value: ObservabilityFamilyValidation<ObservabilityOwner>,
): FamilyValidationRuntime | undefined {
  return isObject(value) ? familyValidations.get(value) : undefined;
}

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function cloneTarget<Target extends ObservabilityReferenceTarget>(target: Target): Target {
  return Object.freeze({
    family: target.family,
    kind: target.kind,
    id: target.id,
  }) as Target;
}

function invalidEntityText(): "invalid" {
  return "invalid";
}

export function compareObservabilityFamilySchemaId(left: string, right: string): number {
  return compareObservabilityText(left, right);
}

export function compareObservabilityEntityTarget(
  left: ObservabilityReferenceTarget,
  right: ObservabilityReferenceTarget,
): number {
  return compareObservabilityReferenceTarget(left, right);
}

/** A pure convenience for family encoders that need a canonical entity order. */
export function sortObservabilityEntityTargets(
  targets: readonly ObservabilityReferenceTarget[],
): readonly ObservabilityReferenceTarget[] {
  return Object.freeze([...targets].sort(compareObservabilityEntityTarget));
}

function contractErrorKey(error: ObservabilityRecordContractError): string {
  switch (error.code) {
    case "observability-required-attachment-missing":
    case "observability-owner-or-schema-invalid":
      return `${error.code}\u0000${error.owner}\u0000${error.schemaId}`;
    case "observability-identity-invalid":
      return `${error.code}\u0000${error.schemaId}\u0000${error.entity}`;
    case "observability-cross-reference-invalid":
      return `${error.code}\u0000${error.schemaId}\u0000${error.sourceId}`;
    case "observability-timing-tree-invalid":
      return `${error.code}\u0000${error.intervalId}`;
    case "observability-source-frame-invalid":
      return `${error.code}\u0000${error.diagnosticId}`;
  }
}

export function compareObservabilityRecordContractError(
  left: ObservabilityRecordContractError,
  right: ObservabilityRecordContractError,
): number {
  return compareObservabilityText(contractErrorKey(left), contractErrorKey(right));
}

export function sortObservabilityRecordContractErrors(
  errors: readonly ObservabilityRecordContractError[],
): readonly ObservabilityRecordContractError[] {
  return Object.freeze([...errors].sort(compareObservabilityRecordContractError));
}

function validateAttemptEntities(
  schemaId: string,
  entities: readonly AttemptReferenceTarget[],
): {
  readonly entities: readonly AttemptReferenceTarget[];
  readonly errors: readonly ObservabilityRecordContractError[];
} {
  const errors: ObservabilityRecordContractError[] = [];
  const valid: AttemptReferenceTarget[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    if (!isAttemptReferenceTarget(entity) || entity.family !== schemaId) {
      errors.push(observabilityIdentityInvalidError(schemaId, invalidEntityText()));
      continue;
    }
    const key = referenceTargetKey(entity);
    if (seen.has(key)) {
      errors.push(observabilityIdentityInvalidError(schemaId, entity.id));
      continue;
    }
    seen.add(key);
    valid.push(cloneTarget(entity));
  }
  return Object.freeze({ entities: freezeArray(valid), errors: freezeArray(errors) });
}

function validateRunEntities(
  schemaId: string,
  entities: readonly RunReferenceTarget[],
): {
  readonly entities: readonly RunReferenceTarget[];
  readonly errors: readonly ObservabilityRecordContractError[];
} {
  const errors: ObservabilityRecordContractError[] = [];
  const valid: RunReferenceTarget[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    if (!isRunReferenceTarget(entity) || entity.family !== schemaId) {
      errors.push(observabilityIdentityInvalidError(schemaId, invalidEntityText()));
      continue;
    }
    const key = referenceTargetKey(entity);
    if (seen.has(key)) {
      errors.push(observabilityIdentityInvalidError(schemaId, entity.id));
      continue;
    }
    seen.add(key);
    valid.push(cloneTarget(entity));
  }
  return Object.freeze({ entities: freezeArray(valid), errors: freezeArray(errors) });
}

function validateAttemptReferences<Family extends AttemptObservabilityFamilySchemaId>(input: {
  readonly schemaId: Family;
  readonly entities: readonly AttemptReferenceTarget[];
  readonly sources: readonly AttemptReferenceSource<Family>[];
}): {
  readonly sources: readonly ReferenceSourceRuntime[];
  readonly errors: readonly ObservabilityRecordContractError[];
} {
  const errors: ObservabilityRecordContractError[] = [];
  const sources: ReferenceSourceRuntime[] = [];
  const entityIds = new Set<string>(input.entities.map((entity) => entity.id));
  const sourceIds = new Set<string>();
  for (const source of input.sources) {
    const sourceId = source.sourceId;
    if (!isObservabilityEntityId(sourceId) || !entityIds.has(sourceId)) {
      errors.push(observabilityIdentityInvalidError(input.schemaId, invalidEntityText()));
      continue;
    }
    if (sourceIds.has(sourceId)) {
      errors.push(observabilityIdentityInvalidError(input.schemaId, sourceId));
      continue;
    }
    sourceIds.add(sourceId);
    if (!isCanonicalAttemptReferences(source.refs, input.schemaId)) {
      errors.push(observabilityCrossReferenceInvalidError(input.schemaId, sourceId));
      continue;
    }
    sources.push(
      Object.freeze({
        sourceId,
        refs: freezeArray(source.refs.map((ref) => cloneTarget(ref))),
      }),
    );
  }
  return Object.freeze({ sources: freezeArray(sources), errors: freezeArray(errors) });
}

function validateRunReferences<Family extends RunObservabilityFamilySchemaId>(input: {
  readonly schemaId: Family;
  readonly entities: readonly RunReferenceTarget[];
  readonly sources: readonly RunReferenceSource<Family>[];
}): {
  readonly sources: readonly ReferenceSourceRuntime[];
  readonly errors: readonly ObservabilityRecordContractError[];
} {
  const errors: ObservabilityRecordContractError[] = [];
  const sources: ReferenceSourceRuntime[] = [];
  const entityIds = new Set<string>(input.entities.map((entity) => entity.id));
  const sourceIds = new Set<string>();
  for (const source of input.sources) {
    const sourceId = source.sourceId;
    if (!isObservabilityEntityId(sourceId) || !entityIds.has(sourceId)) {
      errors.push(observabilityIdentityInvalidError(input.schemaId, invalidEntityText()));
      continue;
    }
    if (sourceIds.has(sourceId)) {
      errors.push(observabilityIdentityInvalidError(input.schemaId, sourceId));
      continue;
    }
    sourceIds.add(sourceId);
    if (!isCanonicalRunReferences(source.refs, input.schemaId)) {
      errors.push(observabilityCrossReferenceInvalidError(input.schemaId, sourceId));
      continue;
    }
    sources.push(
      Object.freeze({
        sourceId,
        refs: freezeArray(source.refs.map((ref) => cloneTarget(ref))),
      }),
    );
  }
  return Object.freeze({ sources: freezeArray(sources), errors: freezeArray(errors) });
}

function attemptRuntime<Family extends AttemptObservabilityFamilySchemaId>(
  input: AttemptObservabilityFamilyValidationInput<Family>,
): FamilyValidationRuntime {
  const schemaId = isAttemptObservabilityFamilySchemaId(input.schemaId)
    ? input.schemaId
    : "invalid";
  const entities = validateAttemptEntities(schemaId, input.entities);
  const references = isAttemptObservabilityFamilySchemaId(schemaId)
    ? validateAttemptReferences({
        schemaId,
        entities: entities.entities,
        sources: input.references,
      })
    : Object.freeze({
        sources: Object.freeze([]) as readonly ReferenceSourceRuntime[],
        errors: Object.freeze([
          observabilityOwnerOrSchemaInvalidError("attempt", schemaId),
        ]) as readonly ObservabilityRecordContractError[],
      });
  return Object.freeze({
    owner: "attempt" as const,
    schemaId,
    entities: entities.entities,
    references: references.sources,
    localErrors: freezeArray([
      ...entities.errors,
      ...references.errors,
      ...(input.localErrors ?? []),
    ]),
  });
}

function runRuntime<Family extends RunObservabilityFamilySchemaId>(
  input: RunObservabilityFamilyValidationInput<Family>,
): FamilyValidationRuntime {
  const schemaId = isRunObservabilityFamilySchemaId(input.schemaId)
    ? input.schemaId
    : "invalid";
  const entities = validateRunEntities(schemaId, input.entities);
  const references = isRunObservabilityFamilySchemaId(schemaId)
    ? validateRunReferences({
        schemaId,
        entities: entities.entities,
        sources: input.references,
      })
    : Object.freeze({
        sources: Object.freeze([]) as readonly ReferenceSourceRuntime[],
        errors: Object.freeze([
          observabilityOwnerOrSchemaInvalidError("run", schemaId),
        ]) as readonly ObservabilityRecordContractError[],
      });
  return Object.freeze({
    owner: "run" as const,
    schemaId,
    entities: entities.entities,
    references: references.sources,
    localErrors: freezeArray([
      ...entities.errors,
      ...references.errors,
      ...(input.localErrors ?? []),
    ]),
  });
}

export function validateAttemptObservabilityFamily<
  Family extends AttemptObservabilityFamilySchemaId,
>(
  input: AttemptObservabilityFamilyValidationInput<Family>,
): readonly ObservabilityRecordContractError[] {
  return sortObservabilityRecordContractErrors(attemptRuntime(input).localErrors);
}

export function validateRunObservabilityFamily<
  Family extends RunObservabilityFamilySchemaId,
>(
  input: RunObservabilityFamilyValidationInput<Family>,
): readonly ObservabilityRecordContractError[] {
  return sortObservabilityRecordContractErrors(runRuntime(input).localErrors);
}

export function makeAttemptObservabilityFamilyValidation<
  Family extends AttemptObservabilityFamilySchemaId,
>(
  input: AttemptObservabilityFamilyValidationInput<Family>,
): ObservabilityFamilyValidation<"attempt"> {
  const validation: ObservabilityFamilyValidation<"attempt"> = Object.freeze({
    [observabilityFamilyValidationTypeId]: () => "attempt",
  });
  familyValidations.set(validation, attemptRuntime(input));
  return validation;
}

export function makeRunObservabilityFamilyValidation<
  Family extends RunObservabilityFamilySchemaId,
>(
  input: RunObservabilityFamilyValidationInput<Family>,
): ObservabilityFamilyValidation<"run"> {
  const validation: ObservabilityFamilyValidation<"run"> = Object.freeze({
    [observabilityFamilyValidationTypeId]: () => "run",
  });
  familyValidations.set(validation, runRuntime(input));
  return validation;
}

export interface AttemptObservabilityContractInput {
  readonly families: readonly ObservabilityFamilyValidation<"attempt">[];
}

export interface RunObservabilityContractInput {
  readonly families: readonly ObservabilityFamilyValidation<"run">[];
}

export interface ObservabilityRecordContractValidationInput {
  readonly run: RunObservabilityContractInput;
  readonly attempts: readonly AttemptObservabilityContractInput[];
}

function isRequiredSchemaId(
  owner: ObservabilityOwner,
  schemaId: string,
): boolean {
  return owner === "attempt"
    ? ATTEMPT_REQUIRED_FAMILIES.some((candidate) => candidate === schemaId)
    : RUN_REQUIRED_FAMILIES.some((candidate) => candidate === schemaId);
}

function requiredSchemaIds(
  owner: ObservabilityOwner,
): readonly string[] {
  return owner === "attempt" ? ATTEMPT_REQUIRED_FAMILIES : RUN_REQUIRED_FAMILIES;
}

function validateOwnerContract(
  owner: ObservabilityOwner,
  validations: readonly ObservabilityFamilyValidation<ObservabilityOwner>[],
): {
  readonly families: readonly FamilyValidationRuntime[];
  readonly errors: readonly ObservabilityRecordContractError[];
} {
  const errors: ObservabilityRecordContractError[] = [];
  const families: FamilyValidationRuntime[] = [];
  const bySchemaId = new Map<string, number>();
  for (const validation of validations) {
    const runtime = validationRuntime(validation);
    if (runtime === undefined || runtime.owner !== owner) {
      errors.push(observabilityOwnerOrSchemaInvalidError(owner, "invalid"));
      continue;
    }
    families.push(runtime);
    bySchemaId.set(runtime.schemaId, (bySchemaId.get(runtime.schemaId) ?? 0) + 1);
    if (!isRequiredSchemaId(owner, runtime.schemaId)) {
      errors.push(observabilityOwnerOrSchemaInvalidError(owner, runtime.schemaId));
    }
    errors.push(...runtime.localErrors);
  }
  for (const schemaId of requiredSchemaIds(owner)) {
    const count = bySchemaId.get(schemaId) ?? 0;
    if (count === 0) {
      errors.push(observabilityRequiredAttachmentMissingError(owner, schemaId));
    } else if (count !== 1) {
      errors.push(observabilityOwnerOrSchemaInvalidError(owner, schemaId));
    }
  }
  return Object.freeze({ families: freezeArray(families), errors: freezeArray(errors) });
}

function validateOwnerCrossReferences(
  families: readonly FamilyValidationRuntime[],
): readonly ObservabilityRecordContractError[] {
  const errors: ObservabilityRecordContractError[] = [];
  const targetCounts = new Map<string, number>();
  for (const family of families) {
    for (const entity of family.entities) {
      const key = referenceTargetKey(entity);
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
    }
  }
  for (const family of families) {
    for (const source of family.references) {
      for (const ref of source.refs) {
        if ((targetCounts.get(referenceTargetKey(ref)) ?? 0) !== 1) {
          errors.push(
            observabilityCrossReferenceInvalidError(family.schemaId, source.sourceId),
          );
          break;
        }
      }
    }
  }
  return freezeArray(errors);
}

/**
 * Pure aggregate preflight for the official five Attempt and two Run families.
 * It validates only durable official facts; opening a writer, emitting blobs,
 * and publishing the complete marker remain Record's separate responsibilities.
 */
export function validateObservabilityRecordContract(
  input: ObservabilityRecordContractValidationInput,
): readonly ObservabilityRecordContractError[] {
  const errors: ObservabilityRecordContractError[] = [];
  const run = validateOwnerContract("run", input.run.families);
  errors.push(...run.errors, ...validateOwnerCrossReferences(run.families));
  for (const attempt of input.attempts) {
    const validated = validateOwnerContract("attempt", attempt.families);
    errors.push(...validated.errors, ...validateOwnerCrossReferences(validated.families));
  }
  return sortObservabilityRecordContractErrors(errors);
}
