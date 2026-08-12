import {
  compareObservabilityReferenceTargetV1,
  compareObservabilityTextV1,
  isAttemptObservabilityFamilySchemaIdV1,
  isAttemptReferenceTargetV1,
  isCanonicalAttemptReferencesV1,
  isCanonicalRunReferencesV1,
  isObservabilityEntityIdV1,
  isRunObservabilityFamilySchemaIdV1,
  isRunReferenceTargetV1,
  referenceTargetKeyV1,
  type AttemptObservabilityFamilySchemaIdV1,
  type AttemptReferenceTargetV1,
  type AttemptReferencesForFamilyV1,
  type ObservabilityEntityIdV1,
  type ObservabilityOwnerV1,
  type ObservabilityReferenceTargetV1,
  type RunObservabilityFamilySchemaIdV1,
  type RunReferenceTargetV1,
  type RunReferencesForFamilyV1,
} from "./model.ts";
import {
  observabilityCrossReferenceInvalidErrorV1,
  observabilityIdentityInvalidErrorV1,
  observabilityOwnerOrSchemaInvalidErrorV1,
  observabilityRequiredAttachmentMissingErrorV1,
  type ObservabilityRecordContractError,
} from "./errors.ts";

const observabilityFamilyValidationTypeId: unique symbol = Symbol(
  "@niceeval/o11y/ObservabilityFamilyValidationV1",
);

/**
 * A package-created proof that one family has completed its local validation.
 * Payloads remain in their owning family; this proof carries only entity and
 * direct-reference facts needed by the whole-Run contract.
 */
export interface ObservabilityFamilyValidationV1<Owner extends ObservabilityOwnerV1> {
  readonly [observabilityFamilyValidationTypeId]: () => Owner;
}

export interface AttemptReferenceSourceV1<
  Family extends AttemptObservabilityFamilySchemaIdV1,
> {
  readonly sourceId: ObservabilityEntityIdV1;
  readonly refs: readonly AttemptReferencesForFamilyV1<Family>[];
}

export interface RunReferenceSourceV1<Family extends RunObservabilityFamilySchemaIdV1> {
  readonly sourceId: ObservabilityEntityIdV1;
  readonly refs: readonly RunReferencesForFamilyV1<Family>[];
}

export interface AttemptObservabilityFamilyValidationInputV1<
  Family extends AttemptObservabilityFamilySchemaIdV1,
> {
  readonly schemaId: Family;
  readonly entities: readonly AttemptReferenceTargetV1[];
  readonly references: readonly AttemptReferenceSourceV1<Family>[];
  /** Family-local timing/source-frame errors use the stable aggregate union. */
  readonly localErrors?: readonly ObservabilityRecordContractError[];
}

export interface RunObservabilityFamilyValidationInputV1<
  Family extends RunObservabilityFamilySchemaIdV1,
> {
  readonly schemaId: Family;
  readonly entities: readonly RunReferenceTargetV1[];
  readonly references: readonly RunReferenceSourceV1<Family>[];
  /** Family-local timing/source-frame errors use the stable aggregate union. */
  readonly localErrors?: readonly ObservabilityRecordContractError[];
}

interface ReferenceSourceRuntime {
  readonly sourceId: string;
  readonly refs: readonly ObservabilityReferenceTargetV1[];
}

interface FamilyValidationRuntime {
  readonly owner: ObservabilityOwnerV1;
  readonly schemaId: string;
  readonly entities: readonly ObservabilityReferenceTargetV1[];
  readonly references: readonly ReferenceSourceRuntime[];
  readonly localErrors: readonly ObservabilityRecordContractError[];
}

const familyValidations = new WeakMap<object, FamilyValidationRuntime>();

const ATTEMPT_REQUIRED_FAMILIES_V1 = Object.freeze([
  "niceeval.conversation/v1",
  "niceeval.commands/v1",
  "niceeval.usage/v1",
  "niceeval.timing/v1",
  "niceeval.diagnostics/v1",
] as const);

const RUN_REQUIRED_FAMILIES_V1 = Object.freeze([
  "niceeval.timing/v1",
  "niceeval.diagnostics/v1",
] as const);

export const REQUIRED_ATTEMPT_OBSERVABILITY_FAMILIES_V1 =
  ATTEMPT_REQUIRED_FAMILIES_V1;
export const REQUIRED_RUN_OBSERVABILITY_FAMILIES_V1 = RUN_REQUIRED_FAMILIES_V1;

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function validationRuntime(
  value: ObservabilityFamilyValidationV1<ObservabilityOwnerV1>,
): FamilyValidationRuntime | undefined {
  return isObject(value) ? familyValidations.get(value) : undefined;
}

function freezeArray<Value>(values: readonly Value[]): readonly Value[] {
  return Object.freeze([...values]);
}

function cloneTarget<Target extends ObservabilityReferenceTargetV1>(target: Target): Target {
  return Object.freeze({
    family: target.family,
    kind: target.kind,
    id: target.id,
  }) as Target;
}

function invalidEntityText(): "invalid" {
  return "invalid";
}

export function compareObservabilityFamilySchemaIdV1(left: string, right: string): number {
  return compareObservabilityTextV1(left, right);
}

export function compareObservabilityEntityTargetV1(
  left: ObservabilityReferenceTargetV1,
  right: ObservabilityReferenceTargetV1,
): number {
  return compareObservabilityReferenceTargetV1(left, right);
}

/** A pure convenience for family encoders that need a canonical entity order. */
export function sortObservabilityEntityTargetsV1(
  targets: readonly ObservabilityReferenceTargetV1[],
): readonly ObservabilityReferenceTargetV1[] {
  return Object.freeze([...targets].sort(compareObservabilityEntityTargetV1));
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

export function compareObservabilityRecordContractErrorV1(
  left: ObservabilityRecordContractError,
  right: ObservabilityRecordContractError,
): number {
  return compareObservabilityTextV1(contractErrorKey(left), contractErrorKey(right));
}

export function sortObservabilityRecordContractErrorsV1(
  errors: readonly ObservabilityRecordContractError[],
): readonly ObservabilityRecordContractError[] {
  return Object.freeze([...errors].sort(compareObservabilityRecordContractErrorV1));
}

function validateAttemptEntities(
  schemaId: string,
  entities: readonly AttemptReferenceTargetV1[],
): {
  readonly entities: readonly AttemptReferenceTargetV1[];
  readonly errors: readonly ObservabilityRecordContractError[];
} {
  const errors: ObservabilityRecordContractError[] = [];
  const valid: AttemptReferenceTargetV1[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    if (!isAttemptReferenceTargetV1(entity) || entity.family !== schemaId) {
      errors.push(observabilityIdentityInvalidErrorV1(schemaId, invalidEntityText()));
      continue;
    }
    const key = referenceTargetKeyV1(entity);
    if (seen.has(key)) {
      errors.push(observabilityIdentityInvalidErrorV1(schemaId, entity.id));
      continue;
    }
    seen.add(key);
    valid.push(cloneTarget(entity));
  }
  return Object.freeze({ entities: freezeArray(valid), errors: freezeArray(errors) });
}

function validateRunEntities(
  schemaId: string,
  entities: readonly RunReferenceTargetV1[],
): {
  readonly entities: readonly RunReferenceTargetV1[];
  readonly errors: readonly ObservabilityRecordContractError[];
} {
  const errors: ObservabilityRecordContractError[] = [];
  const valid: RunReferenceTargetV1[] = [];
  const seen = new Set<string>();
  for (const entity of entities) {
    if (!isRunReferenceTargetV1(entity) || entity.family !== schemaId) {
      errors.push(observabilityIdentityInvalidErrorV1(schemaId, invalidEntityText()));
      continue;
    }
    const key = referenceTargetKeyV1(entity);
    if (seen.has(key)) {
      errors.push(observabilityIdentityInvalidErrorV1(schemaId, entity.id));
      continue;
    }
    seen.add(key);
    valid.push(cloneTarget(entity));
  }
  return Object.freeze({ entities: freezeArray(valid), errors: freezeArray(errors) });
}

function validateAttemptReferences<Family extends AttemptObservabilityFamilySchemaIdV1>(input: {
  readonly schemaId: Family;
  readonly entities: readonly AttemptReferenceTargetV1[];
  readonly sources: readonly AttemptReferenceSourceV1<Family>[];
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
    if (!isObservabilityEntityIdV1(sourceId) || !entityIds.has(sourceId)) {
      errors.push(observabilityIdentityInvalidErrorV1(input.schemaId, invalidEntityText()));
      continue;
    }
    if (sourceIds.has(sourceId)) {
      errors.push(observabilityIdentityInvalidErrorV1(input.schemaId, sourceId));
      continue;
    }
    sourceIds.add(sourceId);
    if (!isCanonicalAttemptReferencesV1(source.refs, input.schemaId)) {
      errors.push(observabilityCrossReferenceInvalidErrorV1(input.schemaId, sourceId));
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

function validateRunReferences<Family extends RunObservabilityFamilySchemaIdV1>(input: {
  readonly schemaId: Family;
  readonly entities: readonly RunReferenceTargetV1[];
  readonly sources: readonly RunReferenceSourceV1<Family>[];
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
    if (!isObservabilityEntityIdV1(sourceId) || !entityIds.has(sourceId)) {
      errors.push(observabilityIdentityInvalidErrorV1(input.schemaId, invalidEntityText()));
      continue;
    }
    if (sourceIds.has(sourceId)) {
      errors.push(observabilityIdentityInvalidErrorV1(input.schemaId, sourceId));
      continue;
    }
    sourceIds.add(sourceId);
    if (!isCanonicalRunReferencesV1(source.refs, input.schemaId)) {
      errors.push(observabilityCrossReferenceInvalidErrorV1(input.schemaId, sourceId));
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

function attemptRuntime<Family extends AttemptObservabilityFamilySchemaIdV1>(
  input: AttemptObservabilityFamilyValidationInputV1<Family>,
): FamilyValidationRuntime {
  const schemaId = isAttemptObservabilityFamilySchemaIdV1(input.schemaId)
    ? input.schemaId
    : "invalid";
  const entities = validateAttemptEntities(schemaId, input.entities);
  const references = isAttemptObservabilityFamilySchemaIdV1(schemaId)
    ? validateAttemptReferences({
        schemaId,
        entities: entities.entities,
        sources: input.references,
      })
    : Object.freeze({
        sources: Object.freeze([]) as readonly ReferenceSourceRuntime[],
        errors: Object.freeze([
          observabilityOwnerOrSchemaInvalidErrorV1("attempt", schemaId),
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

function runRuntime<Family extends RunObservabilityFamilySchemaIdV1>(
  input: RunObservabilityFamilyValidationInputV1<Family>,
): FamilyValidationRuntime {
  const schemaId = isRunObservabilityFamilySchemaIdV1(input.schemaId)
    ? input.schemaId
    : "invalid";
  const entities = validateRunEntities(schemaId, input.entities);
  const references = isRunObservabilityFamilySchemaIdV1(schemaId)
    ? validateRunReferences({
        schemaId,
        entities: entities.entities,
        sources: input.references,
      })
    : Object.freeze({
        sources: Object.freeze([]) as readonly ReferenceSourceRuntime[],
        errors: Object.freeze([
          observabilityOwnerOrSchemaInvalidErrorV1("run", schemaId),
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

export function validateAttemptObservabilityFamilyV1<
  Family extends AttemptObservabilityFamilySchemaIdV1,
>(
  input: AttemptObservabilityFamilyValidationInputV1<Family>,
): readonly ObservabilityRecordContractError[] {
  return sortObservabilityRecordContractErrorsV1(attemptRuntime(input).localErrors);
}

export function validateRunObservabilityFamilyV1<
  Family extends RunObservabilityFamilySchemaIdV1,
>(
  input: RunObservabilityFamilyValidationInputV1<Family>,
): readonly ObservabilityRecordContractError[] {
  return sortObservabilityRecordContractErrorsV1(runRuntime(input).localErrors);
}

export function makeAttemptObservabilityFamilyValidationV1<
  Family extends AttemptObservabilityFamilySchemaIdV1,
>(
  input: AttemptObservabilityFamilyValidationInputV1<Family>,
): ObservabilityFamilyValidationV1<"attempt"> {
  const validation: ObservabilityFamilyValidationV1<"attempt"> = Object.freeze({
    [observabilityFamilyValidationTypeId]: () => "attempt",
  });
  familyValidations.set(validation, attemptRuntime(input));
  return validation;
}

export function makeRunObservabilityFamilyValidationV1<
  Family extends RunObservabilityFamilySchemaIdV1,
>(
  input: RunObservabilityFamilyValidationInputV1<Family>,
): ObservabilityFamilyValidationV1<"run"> {
  const validation: ObservabilityFamilyValidationV1<"run"> = Object.freeze({
    [observabilityFamilyValidationTypeId]: () => "run",
  });
  familyValidations.set(validation, runRuntime(input));
  return validation;
}

export interface AttemptObservabilityContractInputV1 {
  readonly families: readonly ObservabilityFamilyValidationV1<"attempt">[];
}

export interface RunObservabilityContractInputV1 {
  readonly families: readonly ObservabilityFamilyValidationV1<"run">[];
}

export interface ObservabilityRecordContractValidationInputV1 {
  readonly run: RunObservabilityContractInputV1;
  readonly attempts: readonly AttemptObservabilityContractInputV1[];
}

function isRequiredSchemaId(
  owner: ObservabilityOwnerV1,
  schemaId: string,
): boolean {
  return owner === "attempt"
    ? ATTEMPT_REQUIRED_FAMILIES_V1.some((candidate) => candidate === schemaId)
    : RUN_REQUIRED_FAMILIES_V1.some((candidate) => candidate === schemaId);
}

function requiredSchemaIds(
  owner: ObservabilityOwnerV1,
): readonly string[] {
  return owner === "attempt" ? ATTEMPT_REQUIRED_FAMILIES_V1 : RUN_REQUIRED_FAMILIES_V1;
}

function validateOwnerContract(
  owner: ObservabilityOwnerV1,
  validations: readonly ObservabilityFamilyValidationV1<ObservabilityOwnerV1>[],
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
      errors.push(observabilityOwnerOrSchemaInvalidErrorV1(owner, "invalid"));
      continue;
    }
    families.push(runtime);
    bySchemaId.set(runtime.schemaId, (bySchemaId.get(runtime.schemaId) ?? 0) + 1);
    if (!isRequiredSchemaId(owner, runtime.schemaId)) {
      errors.push(observabilityOwnerOrSchemaInvalidErrorV1(owner, runtime.schemaId));
    }
    errors.push(...runtime.localErrors);
  }
  for (const schemaId of requiredSchemaIds(owner)) {
    const count = bySchemaId.get(schemaId) ?? 0;
    if (count === 0) {
      errors.push(observabilityRequiredAttachmentMissingErrorV1(owner, schemaId));
    } else if (count !== 1) {
      errors.push(observabilityOwnerOrSchemaInvalidErrorV1(owner, schemaId));
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
      const key = referenceTargetKeyV1(entity);
      targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
    }
  }
  for (const family of families) {
    for (const source of family.references) {
      for (const ref of source.refs) {
        if ((targetCounts.get(referenceTargetKeyV1(ref)) ?? 0) !== 1) {
          errors.push(
            observabilityCrossReferenceInvalidErrorV1(family.schemaId, source.sourceId),
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
export function validateObservabilityRecordContractV1(
  input: ObservabilityRecordContractValidationInputV1,
): readonly ObservabilityRecordContractError[] {
  const errors: ObservabilityRecordContractError[] = [];
  const run = validateOwnerContract("run", input.run.families);
  errors.push(...run.errors, ...validateOwnerCrossReferences(run.families));
  for (const attempt of input.attempts) {
    const validated = validateOwnerContract("attempt", attempt.families);
    errors.push(...validated.errors, ...validateOwnerCrossReferences(validated.families));
  }
  return sortObservabilityRecordContractErrorsV1(errors);
}
