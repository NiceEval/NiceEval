import type { JsonValue } from "../protocol/json.ts";
import type {
  EvidenceTransformationV1,
  RedactionPolicyIdV1,
  VersionedSelector,
} from "../protocol/observation.ts";

export type RecordEvidenceRepresentationKeyV1 =
  | {
      readonly kind: "object";
      readonly selectorSchema: string;
      readonly mediaType: string;
    }
  | {
      readonly kind: "event";
      readonly selectorSchema: string;
      readonly eventSchema: string;
    }
  | {
      readonly kind: "claim";
      readonly selectorSchema: string;
      readonly claimSchema: string;
    };

export type RecordEvidenceFilterKeyV1 =
  | {
      readonly kind: "event-filter";
      readonly filterSchema: string;
      readonly eventSchema: string;
    }
  | {
      readonly kind: "claim-filter";
      readonly filterSchema: string;
      readonly claimSchema: string;
    };

export interface RecordEvidenceSelectorCodecKeyV1 {
  readonly kind: "selector-codec";
  readonly selectorSchema: string;
}

export interface RecordEvidenceRedactionPolicyKeyV1 {
  readonly kind: "redaction-policy";
  readonly policy: RedactionPolicyIdV1;
}

export type RecordEvidenceCapabilityKeyV1 =
  | RecordEvidenceRepresentationKeyV1
  | RecordEvidenceFilterKeyV1
  | RecordEvidenceSelectorCodecKeyV1
  | RecordEvidenceRedactionPolicyKeyV1;

export type RecordEvidenceCapabilityOperation =
  | "validate-selector"
  | "select-object"
  | "select-event"
  | "select-claim"
  | "plan-event-filter"
  | "evaluate-event-filter"
  | "plan-claim-filter"
  | "evaluate-claim-filter"
  | "confirm-same-logical-root"
  | "classify-transformation"
  | "measure-transformation"
  | "apply-redaction-policy";

export interface RecordEvidenceCapabilityFailure {
  readonly code: "record-evidence-capability-failed";
  readonly key: RecordEvidenceCapabilityKeyV1;
  readonly operation: RecordEvidenceCapabilityOperation;
  readonly issue: "threw" | "invalid-result";
  readonly cause: unknown | null;
  readonly retryable: false;
}

/** A callback threw or returned a value outside its exact Result protocol. */
export class RecordEvidenceCapabilityError extends Error {
  readonly failure: RecordEvidenceCapabilityFailure;

  constructor(failure: RecordEvidenceCapabilityFailure) {
    super("Record evidence capability invocation failed", {
      cause: failure.cause === null ? undefined : failure.cause,
    });
    this.name = "RecordEvidenceCapabilityError";
    this.failure = Object.freeze(failure);
  }
}

export type RecordEvidenceRegistryDefinitionKindV1 =
  | "registry"
  | "representation"
  | "filter"
  | "selector-codec"
  | "object-representation"
  | "event-representation"
  | "claim-representation"
  | "event-filter"
  | "claim-filter"
  | "redaction-policy";

export interface RecordEvidenceInvalidDefinitionFailureV1 {
  readonly code: "record-evidence-registry-invalid-definition";
  readonly definitionKind: RecordEvidenceRegistryDefinitionKindV1;
  readonly index: number | null;
  readonly key?: RecordEvidenceCapabilityKeyV1;
  readonly cause: null;
}

export interface RecordEvidenceDuplicateKeyFailureV1 {
  readonly code: "record-evidence-registry-duplicate-key";
  readonly definitionKind: RecordEvidenceRegistryDefinitionKindV1;
  readonly index: number;
  readonly key: RecordEvidenceCapabilityKeyV1;
  readonly cause: null;
}

export type RecordEvidenceRegistryDefinitionFailureV1 =
  | RecordEvidenceInvalidDefinitionFailureV1
  | RecordEvidenceDuplicateKeyFailureV1;

/** Synchronous malformed-definition failure; consumers branch on failure, never message text. */
export class RecordEvidenceRegistryDefinitionError extends Error {
  readonly failure: RecordEvidenceRegistryDefinitionFailureV1;

  constructor(failure: RecordEvidenceRegistryDefinitionFailureV1) {
    super("Record evidence registry definition is invalid");
    this.name = "RecordEvidenceRegistryDefinitionError";
    this.failure = Object.freeze(failure);
  }
}

export interface RecordEvidenceSelectorValidationValidResultV1 {
  readonly kind: "valid";
}

export interface RecordEvidenceSelectorValidationInvalidResultV1 {
  readonly kind: "invalid";
}

export type RecordEvidenceSelectorValidationResultV1 =
  | RecordEvidenceSelectorValidationValidResultV1
  | RecordEvidenceSelectorValidationInvalidResultV1;

export interface RecordEvidenceSelectedResultV1 {
  readonly kind: "selected";
  readonly value: JsonValue;
}

export interface RecordEvidenceNotSelectedResultV1 {
  readonly kind: "not-selected";
}

export interface RecordEvidenceUnsupportedResultV1 {
  readonly kind: "unsupported";
}

export type RecordEvidenceSelectionResultV1 =
  | RecordEvidenceSelectedResultV1
  | RecordEvidenceNotSelectedResultV1
  | RecordEvidenceUnsupportedResultV1;

export interface RecordEvidenceSameLogicalRootResultV1 {
  readonly kind: "same";
}

export interface RecordEvidenceDifferentLogicalRootResultV1 {
  readonly kind: "different";
}

export type RecordEvidenceLogicalRootResultV1 =
  | RecordEvidenceSameLogicalRootResultV1
  | RecordEvidenceDifferentLogicalRootResultV1
  | RecordEvidenceUnsupportedResultV1;

export interface RecordEvidenceTransformationNoneResultV1 {
  readonly kind: "none";
  readonly value: JsonValue;
}

export interface RecordEvidenceTransformationLimitedResultV1 {
  readonly kind: "limited";
  readonly value: JsonValue;
}

export interface RecordEvidenceTransformationUnavailableResultV1 {
  readonly kind: "unavailable";
}

export type RecordEvidenceTransformationClassificationResultV1 =
  | RecordEvidenceTransformationNoneResultV1
  | RecordEvidenceTransformationLimitedResultV1
  | RecordEvidenceTransformationUnavailableResultV1
  | RecordEvidenceUnsupportedResultV1;

export interface RecordEvidenceTransformationMeasuredResultV1 {
  readonly kind: "measured";
  readonly bytes: number;
}

export type RecordEvidenceTransformationMeasurementResultV1 =
  | RecordEvidenceTransformationMeasuredResultV1
  | RecordEvidenceUnsupportedResultV1;

export interface RecordEvidenceRedactionSuccessResultV1 {
  readonly kind: "success";
  readonly value: JsonValue;
}

export type RecordEvidenceRedactionApplyResultV1 =
  | RecordEvidenceRedactionSuccessResultV1
  | RecordEvidenceUnsupportedResultV1;

export interface RecordEvidenceEnvelopeOnlyFilterPlanV1 {
  readonly kind: "envelope-only";
}

export interface RecordEvidenceBodyDependentFilterPlanV1 {
  readonly kind: "body-dependent";
  readonly dependencies: readonly [VersionedSelector, ...VersionedSelector[]];
  readonly outputSelector?: VersionedSelector;
}

export type RecordEvidenceFilterPlanResultV1 =
  | RecordEvidenceEnvelopeOnlyFilterPlanV1
  | RecordEvidenceBodyDependentFilterPlanV1;

export interface RecordEvidenceFilterMatchResultV1 {
  readonly kind: "match";
}

export interface RecordEvidenceFilterNoMatchResultV1 {
  readonly kind: "no-match";
}

export type RecordEvidenceFilterEvaluationResultV1 =
  | RecordEvidenceFilterMatchResultV1
  | RecordEvidenceFilterNoMatchResultV1;

export interface RecordEvidenceObjectSelectionInputV1 {
  /** The invocation boundary makes this an owned copy before it reaches the callback. */
  readonly payload: Uint8Array;
  readonly selector?: VersionedSelector;
}

export interface RecordEvidenceEventSelectionInputV1 {
  readonly body: JsonValue;
  readonly selector: VersionedSelector;
}

export interface RecordEvidenceClaimSelectionInputV1 {
  readonly value: JsonValue;
  readonly selector: VersionedSelector;
}

export interface RecordEvidenceLogicalRootInputV1 {
  readonly selector: VersionedSelector;
  readonly inner: JsonValue;
  readonly outer: JsonValue;
}

export interface RecordEvidenceTransformationClassificationInputV1 {
  readonly transformation: EvidenceTransformationV1;
  readonly value: JsonValue;
}

export interface RecordEvidenceTransformationMeasurementInputV1 {
  readonly selector: VersionedSelector;
  readonly value: JsonValue;
}

export interface RecordEvidenceEventEnvelopeViewV1 {
  readonly format: "niceeval.observation";
  readonly id: string;
  readonly name: string;
  readonly schema: string;
  readonly stream: {
    readonly id: string;
    readonly sequence: number;
  };
  readonly scope:
    | {
        readonly kind: "run";
        readonly runId: string;
        readonly experimentId: string;
      }
    | {
        readonly kind: "attempt";
        readonly runId: string;
        readonly experimentId: string;
        readonly attemptId: string;
        readonly evalId: string;
        readonly agentSessionId?: string;
        readonly turnId?: string;
      };
  readonly time: {
    readonly observedAt: string;
    readonly monotonicOffsetNs: string;
    readonly occurredAt?: string;
  };
  readonly source: {
    readonly component: string;
    readonly version?: string;
    readonly adapter?: string;
    readonly mapperVersion?: string;
  };
  readonly correlation?: {
    readonly parentEventId?: string;
    readonly traceId?: string;
    readonly spanId?: string;
  };
}

export interface RecordEvidenceClaimEnvelopeViewV1 {
  readonly id: string;
  readonly kind: string;
  readonly schema: string;
  readonly evaluator: {
    readonly namespace: string;
    readonly name: string;
    readonly version: string;
    readonly model?: string;
  };
  readonly producedAt: string;
}

export interface RecordEvidenceEventFilterEvaluationInputV1 {
  readonly filter: JsonValue;
  readonly envelope: RecordEvidenceEventEnvelopeViewV1;
  readonly dependencies: readonly JsonValue[];
}

export interface RecordEvidenceClaimFilterEvaluationInputV1 {
  readonly filter: JsonValue;
  readonly envelope: RecordEvidenceClaimEnvelopeViewV1;
  readonly dependencies: readonly JsonValue[];
}

export interface RecordEvidenceSelectorCodecDefinitionInputV1 {
  readonly selectorSchema: string;
  readonly validate: (value: JsonValue) => RecordEvidenceSelectorValidationResultV1;
}

interface RecordEvidenceRepresentationSharedDefinitionInputV1 {
  readonly confirmSameLogicalRoot: (
    input: RecordEvidenceLogicalRootInputV1,
  ) => RecordEvidenceLogicalRootResultV1;
  readonly classifyTransformation: (
    input: RecordEvidenceTransformationClassificationInputV1,
  ) => RecordEvidenceTransformationClassificationResultV1;
  readonly measureTransformation: (
    input: RecordEvidenceTransformationMeasurementInputV1,
  ) => RecordEvidenceTransformationMeasurementResultV1;
}

export interface RecordEvidenceObjectRepresentationDefinitionInputV1
  extends RecordEvidenceRepresentationSharedDefinitionInputV1 {
  readonly selectorSchema: string;
  readonly mediaType: string;
  readonly select: (
    input: RecordEvidenceObjectSelectionInputV1,
  ) => RecordEvidenceSelectionResultV1;
}

export interface RecordEvidenceEventRepresentationDefinitionInputV1
  extends RecordEvidenceRepresentationSharedDefinitionInputV1 {
  readonly selectorSchema: string;
  readonly eventSchema: string;
  readonly select: (
    input: RecordEvidenceEventSelectionInputV1,
  ) => RecordEvidenceSelectionResultV1;
}

export interface RecordEvidenceClaimRepresentationDefinitionInputV1
  extends RecordEvidenceRepresentationSharedDefinitionInputV1 {
  readonly selectorSchema: string;
  readonly claimSchema: string;
  readonly select: (
    input: RecordEvidenceClaimSelectionInputV1,
  ) => RecordEvidenceSelectionResultV1;
}

export interface RecordEvidenceEventFilterDefinitionInputV1 {
  readonly filterSchema: string;
  readonly eventSchema: string;
  readonly plan: (filter: JsonValue) => RecordEvidenceFilterPlanResultV1;
  readonly evaluate: (
    input: RecordEvidenceEventFilterEvaluationInputV1,
  ) => RecordEvidenceFilterEvaluationResultV1;
}

export interface RecordEvidenceClaimFilterDefinitionInputV1 {
  readonly filterSchema: string;
  readonly claimSchema: string;
  readonly plan: (filter: JsonValue) => RecordEvidenceFilterPlanResultV1;
  readonly evaluate: (
    input: RecordEvidenceClaimFilterEvaluationInputV1,
  ) => RecordEvidenceFilterEvaluationResultV1;
}

export interface RecordEvidenceRedactionPolicyDefinitionInputV1 {
  readonly policy: RedactionPolicyIdV1;
  readonly apply: (
    value: JsonValue,
    selector: VersionedSelector,
  ) => RecordEvidenceRedactionApplyResultV1;
}

export class RecordEvidenceSelectorCodecDefinitionV1 {
  readonly key: RecordEvidenceSelectorCodecKeyV1;
  #opaque = undefined;

  private constructor(key: RecordEvidenceSelectorCodecKeyV1) {
    this.key = freezeSelectorCodecKey(key.selectorSchema);
    Object.freeze(this);
  }

  static create(key: RecordEvidenceSelectorCodecKeyV1): RecordEvidenceSelectorCodecDefinitionV1 {
    return new RecordEvidenceSelectorCodecDefinitionV1(key);
  }
}

export class RecordEvidenceObjectRepresentationDefinitionV1 {
  readonly key: Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "object" }>;
  #opaque = undefined;

  private constructor(key: Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "object" }>) {
    this.key = freezeObjectRepresentationKey(key.selectorSchema, key.mediaType);
    Object.freeze(this);
  }

  static create(
    key: Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "object" }>,
  ): RecordEvidenceObjectRepresentationDefinitionV1 {
    return new RecordEvidenceObjectRepresentationDefinitionV1(key);
  }
}

export class RecordEvidenceEventRepresentationDefinitionV1 {
  readonly key: Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "event" }>;
  #opaque = undefined;

  private constructor(key: Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "event" }>) {
    this.key = freezeEventRepresentationKey(key.selectorSchema, key.eventSchema);
    Object.freeze(this);
  }

  static create(
    key: Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "event" }>,
  ): RecordEvidenceEventRepresentationDefinitionV1 {
    return new RecordEvidenceEventRepresentationDefinitionV1(key);
  }
}

export class RecordEvidenceClaimRepresentationDefinitionV1 {
  readonly key: Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "claim" }>;
  #opaque = undefined;

  private constructor(key: Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "claim" }>) {
    this.key = freezeClaimRepresentationKey(key.selectorSchema, key.claimSchema);
    Object.freeze(this);
  }

  static create(
    key: Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "claim" }>,
  ): RecordEvidenceClaimRepresentationDefinitionV1 {
    return new RecordEvidenceClaimRepresentationDefinitionV1(key);
  }
}

export type RecordEvidenceRepresentationDefinitionV1 =
  | RecordEvidenceObjectRepresentationDefinitionV1
  | RecordEvidenceEventRepresentationDefinitionV1
  | RecordEvidenceClaimRepresentationDefinitionV1;

export class RecordEvidenceEventFilterDefinitionV1 {
  readonly key: Extract<RecordEvidenceFilterKeyV1, { readonly kind: "event-filter" }>;
  #opaque = undefined;

  private constructor(key: Extract<RecordEvidenceFilterKeyV1, { readonly kind: "event-filter" }>) {
    this.key = freezeEventFilterKey(key.filterSchema, key.eventSchema);
    Object.freeze(this);
  }

  static create(
    key: Extract<RecordEvidenceFilterKeyV1, { readonly kind: "event-filter" }>,
  ): RecordEvidenceEventFilterDefinitionV1 {
    return new RecordEvidenceEventFilterDefinitionV1(key);
  }
}

export class RecordEvidenceClaimFilterDefinitionV1 {
  readonly key: Extract<RecordEvidenceFilterKeyV1, { readonly kind: "claim-filter" }>;
  #opaque = undefined;

  private constructor(key: Extract<RecordEvidenceFilterKeyV1, { readonly kind: "claim-filter" }>) {
    this.key = freezeClaimFilterKey(key.filterSchema, key.claimSchema);
    Object.freeze(this);
  }

  static create(
    key: Extract<RecordEvidenceFilterKeyV1, { readonly kind: "claim-filter" }>,
  ): RecordEvidenceClaimFilterDefinitionV1 {
    return new RecordEvidenceClaimFilterDefinitionV1(key);
  }
}

export type RecordEvidenceFilterDefinitionV1 =
  | RecordEvidenceEventFilterDefinitionV1
  | RecordEvidenceClaimFilterDefinitionV1;

export class RecordEvidenceRedactionPolicyDefinitionV1 {
  readonly key: RecordEvidenceRedactionPolicyKeyV1;
  #opaque = undefined;

  private constructor(key: RecordEvidenceRedactionPolicyKeyV1) {
    this.key = freezeRedactionPolicyKey(key.policy);
    Object.freeze(this);
  }

  static create(key: RecordEvidenceRedactionPolicyKeyV1): RecordEvidenceRedactionPolicyDefinitionV1 {
    return new RecordEvidenceRedactionPolicyDefinitionV1(key);
  }
}

interface SelectorCodecSpec {
  readonly validate: (value: JsonValue) => RecordEvidenceSelectorValidationResultV1;
}

interface RepresentationSharedSpec {
  readonly confirmSameLogicalRoot: (
    input: RecordEvidenceLogicalRootInputV1,
  ) => RecordEvidenceLogicalRootResultV1;
  readonly classifyTransformation: (
    input: RecordEvidenceTransformationClassificationInputV1,
  ) => RecordEvidenceTransformationClassificationResultV1;
  readonly measureTransformation: (
    input: RecordEvidenceTransformationMeasurementInputV1,
  ) => RecordEvidenceTransformationMeasurementResultV1;
}

interface ObjectRepresentationSpec extends RepresentationSharedSpec {
  readonly select: (
    input: RecordEvidenceObjectSelectionInputV1,
  ) => RecordEvidenceSelectionResultV1;
}

interface EventRepresentationSpec extends RepresentationSharedSpec {
  readonly select: (
    input: RecordEvidenceEventSelectionInputV1,
  ) => RecordEvidenceSelectionResultV1;
}

interface ClaimRepresentationSpec extends RepresentationSharedSpec {
  readonly select: (
    input: RecordEvidenceClaimSelectionInputV1,
  ) => RecordEvidenceSelectionResultV1;
}

interface EventFilterSpec {
  readonly plan: (filter: JsonValue) => RecordEvidenceFilterPlanResultV1;
  readonly evaluate: (
    input: RecordEvidenceEventFilterEvaluationInputV1,
  ) => RecordEvidenceFilterEvaluationResultV1;
}

interface ClaimFilterSpec {
  readonly plan: (filter: JsonValue) => RecordEvidenceFilterPlanResultV1;
  readonly evaluate: (
    input: RecordEvidenceClaimFilterEvaluationInputV1,
  ) => RecordEvidenceFilterEvaluationResultV1;
}

interface RedactionPolicySpec {
  readonly apply: (
    value: JsonValue,
    selector: VersionedSelector,
  ) => RecordEvidenceRedactionApplyResultV1;
}

const selectorCodecSpecs = new WeakMap<object, SelectorCodecSpec>();
const objectRepresentationSpecs = new WeakMap<object, ObjectRepresentationSpec>();
const eventRepresentationSpecs = new WeakMap<object, EventRepresentationSpec>();
const claimRepresentationSpecs = new WeakMap<object, ClaimRepresentationSpec>();
const eventFilterSpecs = new WeakMap<object, EventFilterSpec>();
const claimFilterSpecs = new WeakMap<object, ClaimFilterSpec>();
const redactionPolicySpecs = new WeakMap<object, RedactionPolicySpec>();

export function isRecordEvidenceSelectorCodecDefinitionV1(
  value: unknown,
): value is RecordEvidenceSelectorCodecDefinitionV1 {
  return isObject(value) && selectorCodecSpecs.has(value);
}

export function isRecordEvidenceObjectRepresentationDefinitionV1(
  value: unknown,
): value is RecordEvidenceObjectRepresentationDefinitionV1 {
  return isObject(value) && objectRepresentationSpecs.has(value);
}

export function isRecordEvidenceEventRepresentationDefinitionV1(
  value: unknown,
): value is RecordEvidenceEventRepresentationDefinitionV1 {
  return isObject(value) && eventRepresentationSpecs.has(value);
}

export function isRecordEvidenceClaimRepresentationDefinitionV1(
  value: unknown,
): value is RecordEvidenceClaimRepresentationDefinitionV1 {
  return isObject(value) && claimRepresentationSpecs.has(value);
}

export function isRecordEvidenceEventFilterDefinitionV1(
  value: unknown,
): value is RecordEvidenceEventFilterDefinitionV1 {
  return isObject(value) && eventFilterSpecs.has(value);
}

export function isRecordEvidenceClaimFilterDefinitionV1(
  value: unknown,
): value is RecordEvidenceClaimFilterDefinitionV1 {
  return isObject(value) && claimFilterSpecs.has(value);
}

export function isRecordEvidenceRedactionPolicyDefinitionV1(
  value: unknown,
): value is RecordEvidenceRedactionPolicyDefinitionV1 {
  return isObject(value) && redactionPolicySpecs.has(value);
}

export function defineRecordEvidenceSelectorCodecV1(
  input: RecordEvidenceSelectorCodecDefinitionInputV1,
): RecordEvidenceSelectorCodecDefinitionV1 {
  try {
    if (!isSelectorCodecDefinitionInputV1(input)) {
      throwInvalidDefinition("selector-codec", null);
    }
    return makeSelectorCodecDefinition(input.selectorSchema, input.validate);
  } catch (cause) {
    rethrowDefinitionFailure(cause, "selector-codec", null);
  }
}

export function defineRecordEvidenceObjectRepresentationV1(
  input: RecordEvidenceObjectRepresentationDefinitionInputV1,
): RecordEvidenceObjectRepresentationDefinitionV1 {
  try {
    if (!isObjectRepresentationDefinitionInputV1(input)) {
      throwInvalidDefinition("object-representation", null);
    }
    return makeObjectRepresentationDefinition(
      input.selectorSchema,
      input.mediaType,
      input.select,
      input.confirmSameLogicalRoot,
      input.classifyTransformation,
      input.measureTransformation,
    );
  } catch (cause) {
    rethrowDefinitionFailure(cause, "object-representation", null);
  }
}

export function defineRecordEvidenceEventRepresentationV1(
  input: RecordEvidenceEventRepresentationDefinitionInputV1,
): RecordEvidenceEventRepresentationDefinitionV1 {
  try {
    if (!isEventRepresentationDefinitionInputV1(input)) {
      throwInvalidDefinition("event-representation", null);
    }
    return makeEventRepresentationDefinition(
      input.selectorSchema,
      input.eventSchema,
      input.select,
      input.confirmSameLogicalRoot,
      input.classifyTransformation,
      input.measureTransformation,
    );
  } catch (cause) {
    rethrowDefinitionFailure(cause, "event-representation", null);
  }
}

export function defineRecordEvidenceClaimRepresentationV1(
  input: RecordEvidenceClaimRepresentationDefinitionInputV1,
): RecordEvidenceClaimRepresentationDefinitionV1 {
  try {
    if (!isClaimRepresentationDefinitionInputV1(input)) {
      throwInvalidDefinition("claim-representation", null);
    }
    return makeClaimRepresentationDefinition(
      input.selectorSchema,
      input.claimSchema,
      input.select,
      input.confirmSameLogicalRoot,
      input.classifyTransformation,
      input.measureTransformation,
    );
  } catch (cause) {
    rethrowDefinitionFailure(cause, "claim-representation", null);
  }
}

export function defineRecordEvidenceEventFilterV1(
  input: RecordEvidenceEventFilterDefinitionInputV1,
): RecordEvidenceEventFilterDefinitionV1 {
  try {
    if (!isEventFilterDefinitionInputV1(input)) {
      throwInvalidDefinition("event-filter", null);
    }
    return makeEventFilterDefinition(
      input.filterSchema,
      input.eventSchema,
      input.plan,
      input.evaluate,
    );
  } catch (cause) {
    rethrowDefinitionFailure(cause, "event-filter", null);
  }
}

export function defineRecordEvidenceClaimFilterV1(
  input: RecordEvidenceClaimFilterDefinitionInputV1,
): RecordEvidenceClaimFilterDefinitionV1 {
  try {
    if (!isClaimFilterDefinitionInputV1(input)) {
      throwInvalidDefinition("claim-filter", null);
    }
    return makeClaimFilterDefinition(
      input.filterSchema,
      input.claimSchema,
      input.plan,
      input.evaluate,
    );
  } catch (cause) {
    rethrowDefinitionFailure(cause, "claim-filter", null);
  }
}

export function defineRecordEvidenceRedactionPolicyV1(
  input: RecordEvidenceRedactionPolicyDefinitionInputV1,
): RecordEvidenceRedactionPolicyDefinitionV1 {
  try {
    if (!isRedactionPolicyDefinitionInputV1(input)) {
      throwInvalidDefinition("redaction-policy", null);
    }
    return makeRedactionPolicyDefinition(input.policy, input.apply);
  } catch (cause) {
    rethrowDefinitionFailure(cause, "redaction-policy", null);
  }
}

export interface RecordEvidenceRegistryDefinitionV1 {
  readonly selectorCodecs: readonly RecordEvidenceSelectorCodecDefinitionV1[];
  readonly representations: readonly RecordEvidenceRepresentationDefinitionV1[];
  readonly filters: readonly RecordEvidenceFilterDefinitionV1[];
  readonly redactionPolicies: readonly RecordEvidenceRedactionPolicyDefinitionV1[];
}

interface RecordEvidenceRegistryContents {
  readonly selectorCodecs: Map<string, RecordEvidenceSelectorCodecDefinitionV1>;
  readonly objectRepresentations: Map<
    string,
    RecordEvidenceObjectRepresentationDefinitionV1
  >;
  readonly eventRepresentations: Map<
    string,
    RecordEvidenceEventRepresentationDefinitionV1
  >;
  readonly claimRepresentations: Map<
    string,
    RecordEvidenceClaimRepresentationDefinitionV1
  >;
  readonly eventFilters: Map<string, RecordEvidenceEventFilterDefinitionV1>;
  readonly claimFilters: Map<string, RecordEvidenceClaimFilterDefinitionV1>;
  readonly redactionPolicies: Map<string, RecordEvidenceRedactionPolicyDefinitionV1>;
}

export class RecordEvidenceRegistryV1 {
  readonly definition: RecordEvidenceRegistryDefinitionV1;
  #opaque = undefined;

  private constructor(definition: RecordEvidenceRegistryDefinitionV1) {
    this.definition = definition;
    Object.freeze(this);
  }

  static createSnapshot(definition: RecordEvidenceRegistryDefinitionV1): RecordEvidenceRegistryV1 {
    return new RecordEvidenceRegistryV1(definition);
  }
}

const registryContents = new WeakMap<object, RecordEvidenceRegistryContents>();

export function isRecordEvidenceRegistryV1(
  value: unknown,
): value is RecordEvidenceRegistryV1 {
  return isObject(value) && registryContents.has(value);
}

export function sameRecordEvidenceRegistryV1(
  left: unknown,
  right: unknown,
): boolean {
  return isRecordEvidenceRegistryV1(left)
    && isRecordEvidenceRegistryV1(right)
    && left === right;
}

export function createRecordEvidenceRegistryV1(
  definition: RecordEvidenceRegistryDefinitionV1,
): RecordEvidenceRegistryV1 {
  try {
    if (!isRecordEvidenceRegistryDefinitionV1(definition)) {
      throwInvalidDefinition("registry", null);
    }

    const selectorCodecs = copySelectorCodecDefinitions(definition.selectorCodecs);
    const representations = copyRepresentationDefinitions(definition.representations);
    const filters = copyFilterDefinitions(definition.filters);
    const redactionPolicies = copyRedactionPolicyDefinitions(definition.redactionPolicies);
    const snapshot = freezeRegistryDefinition(
      selectorCodecs,
      representations,
      filters,
      redactionPolicies,
    );
    const contents = registryContentsFor(snapshot);
    const registry = RecordEvidenceRegistryV1.createSnapshot(snapshot);
    registryContents.set(registry, contents);
    return registry;
  } catch (cause) {
    rethrowDefinitionFailure(cause, "registry", null);
  }
}

export function findRecordEvidenceSelectorCodecV1(
  registry: RecordEvidenceRegistryV1,
  selectorSchema: string,
): RecordEvidenceSelectorCodecDefinitionV1 | undefined {
  if (!isNonEmptyProtocolString(selectorSchema)) return undefined;
  return contentsOf(registry).selectorCodecs.get(
    capabilityIdentity(freezeSelectorCodecKey(selectorSchema)),
  );
}

export function findRecordEvidenceObjectRepresentationV1(
  registry: RecordEvidenceRegistryV1,
  selectorSchema: string,
  mediaType: string,
): RecordEvidenceObjectRepresentationDefinitionV1 | undefined {
  if (!isNonEmptyProtocolString(selectorSchema) || !isMediaType(mediaType)) {
    return undefined;
  }
  return contentsOf(registry).objectRepresentations.get(
    capabilityIdentity(freezeObjectRepresentationKey(selectorSchema, mediaType)),
  );
}

export function findRecordEvidenceEventRepresentationV1(
  registry: RecordEvidenceRegistryV1,
  selectorSchema: string,
  eventSchema: string,
): RecordEvidenceEventRepresentationDefinitionV1 | undefined {
  if (!isNonEmptyProtocolString(selectorSchema) || !isNonEmptyProtocolString(eventSchema)) {
    return undefined;
  }
  return contentsOf(registry).eventRepresentations.get(
    capabilityIdentity(freezeEventRepresentationKey(selectorSchema, eventSchema)),
  );
}

export function findRecordEvidenceClaimRepresentationV1(
  registry: RecordEvidenceRegistryV1,
  selectorSchema: string,
  claimSchema: string,
): RecordEvidenceClaimRepresentationDefinitionV1 | undefined {
  if (!isNonEmptyProtocolString(selectorSchema) || !isNonEmptyProtocolString(claimSchema)) {
    return undefined;
  }
  return contentsOf(registry).claimRepresentations.get(
    capabilityIdentity(freezeClaimRepresentationKey(selectorSchema, claimSchema)),
  );
}

export function findRecordEvidenceEventFilterV1(
  registry: RecordEvidenceRegistryV1,
  filterSchema: string,
  eventSchema: string,
): RecordEvidenceEventFilterDefinitionV1 | undefined {
  if (!isNonEmptyProtocolString(filterSchema) || !isNonEmptyProtocolString(eventSchema)) {
    return undefined;
  }
  return contentsOf(registry).eventFilters.get(
    capabilityIdentity(freezeEventFilterKey(filterSchema, eventSchema)),
  );
}

export function findRecordEvidenceClaimFilterV1(
  registry: RecordEvidenceRegistryV1,
  filterSchema: string,
  claimSchema: string,
): RecordEvidenceClaimFilterDefinitionV1 | undefined {
  if (!isNonEmptyProtocolString(filterSchema) || !isNonEmptyProtocolString(claimSchema)) {
    return undefined;
  }
  return contentsOf(registry).claimFilters.get(
    capabilityIdentity(freezeClaimFilterKey(filterSchema, claimSchema)),
  );
}

export function findRecordEvidenceRedactionPolicyV1(
  registry: RecordEvidenceRegistryV1,
  policy: RedactionPolicyIdV1,
): RecordEvidenceRedactionPolicyDefinitionV1 | undefined {
  const copiedPolicy = copyRedactionPolicyId(policy);
  if (copiedPolicy === undefined) return undefined;
  return contentsOf(registry).redactionPolicies.get(
    capabilityIdentity(freezeRedactionPolicyKey(copiedPolicy)),
  );
}

export function invokeRecordEvidenceSelectorCodecV1(
  definition: RecordEvidenceSelectorCodecDefinitionV1,
  value: JsonValue,
): RecordEvidenceSelectorValidationResultV1 {
  const spec = selectorCodecSpecOf(definition);
  const copiedValue = requireJsonValue(value);
  return invokeCapability(
    definition.key,
    "validate-selector",
    () => spec.validate(copiedValue),
    normalizeSelectorValidationResult,
  );
}

export function invokeRecordEvidenceObjectSelectionV1(
  definition: RecordEvidenceObjectRepresentationDefinitionV1,
  input: RecordEvidenceObjectSelectionInputV1,
): RecordEvidenceSelectionResultV1 {
  const spec = objectRepresentationSpecOf(definition);
  const selector = input.selector === undefined
    ? undefined
    : requireVersionedSelector(input.selector);
  const copiedInput: RecordEvidenceObjectSelectionInputV1 = Object.freeze({
    payload: copyUint8Array(input.payload),
    ...(selector === undefined ? {} : { selector }),
  });
  return invokeCapability(
    definition.key,
    "select-object",
    () => spec.select(copiedInput),
    normalizeSelectionResult,
  );
}

export function invokeRecordEvidenceEventSelectionV1(
  definition: RecordEvidenceEventRepresentationDefinitionV1,
  input: RecordEvidenceEventSelectionInputV1,
): RecordEvidenceSelectionResultV1 {
  const spec = eventRepresentationSpecOf(definition);
  const copiedInput: RecordEvidenceEventSelectionInputV1 = Object.freeze({
    body: requireJsonValue(input.body),
    selector: requireVersionedSelector(input.selector),
  });
  return invokeCapability(
    definition.key,
    "select-event",
    () => spec.select(copiedInput),
    normalizeSelectionResult,
  );
}

export function invokeRecordEvidenceClaimSelectionV1(
  definition: RecordEvidenceClaimRepresentationDefinitionV1,
  input: RecordEvidenceClaimSelectionInputV1,
): RecordEvidenceSelectionResultV1 {
  const spec = claimRepresentationSpecOf(definition);
  const copiedInput: RecordEvidenceClaimSelectionInputV1 = Object.freeze({
    value: requireJsonValue(input.value),
    selector: requireVersionedSelector(input.selector),
  });
  return invokeCapability(
    definition.key,
    "select-claim",
    () => spec.select(copiedInput),
    normalizeSelectionResult,
  );
}

export function invokeRecordEvidenceSameLogicalRootV1(
  definition: RecordEvidenceRepresentationDefinitionV1,
  input: RecordEvidenceLogicalRootInputV1,
): RecordEvidenceLogicalRootResultV1 {
  const spec = representationSharedSpecOf(definition);
  const copiedInput: RecordEvidenceLogicalRootInputV1 = Object.freeze({
    selector: requireVersionedSelector(input.selector),
    inner: requireJsonValue(input.inner),
    outer: requireJsonValue(input.outer),
  });
  return invokeCapability(
    definition.key,
    "confirm-same-logical-root",
    () => spec.confirmSameLogicalRoot(copiedInput),
    normalizeLogicalRootResult,
  );
}

export function invokeRecordEvidenceTransformationClassificationV1(
  definition: RecordEvidenceRepresentationDefinitionV1,
  input: RecordEvidenceTransformationClassificationInputV1,
): RecordEvidenceTransformationClassificationResultV1 {
  const spec = representationSharedSpecOf(definition);
  const copiedInput: RecordEvidenceTransformationClassificationInputV1 = Object.freeze({
    transformation: requireEvidenceTransformation(input.transformation),
    value: requireJsonValue(input.value),
  });
  return invokeCapability(
    definition.key,
    "classify-transformation",
    () => spec.classifyTransformation(copiedInput),
    normalizeTransformationClassificationResult,
  );
}

export function invokeRecordEvidenceTransformationMeasurementV1(
  definition: RecordEvidenceRepresentationDefinitionV1,
  input: RecordEvidenceTransformationMeasurementInputV1,
): RecordEvidenceTransformationMeasurementResultV1 {
  const spec = representationSharedSpecOf(definition);
  const copiedInput: RecordEvidenceTransformationMeasurementInputV1 = Object.freeze({
    selector: requireVersionedSelector(input.selector),
    value: requireJsonValue(input.value),
  });
  return invokeCapability(
    definition.key,
    "measure-transformation",
    () => spec.measureTransformation(copiedInput),
    normalizeTransformationMeasurementResult,
  );
}

export function invokeRecordEvidenceEventFilterPlanV1(
  definition: RecordEvidenceEventFilterDefinitionV1,
  filter: JsonValue,
): RecordEvidenceFilterPlanResultV1 {
  const spec = eventFilterSpecOf(definition);
  const copiedFilter = requireJsonValue(filter);
  return invokeCapability(
    definition.key,
    "plan-event-filter",
    () => spec.plan(copiedFilter),
    normalizeFilterPlanResult,
  );
}

export function invokeRecordEvidenceClaimFilterPlanV1(
  definition: RecordEvidenceClaimFilterDefinitionV1,
  filter: JsonValue,
): RecordEvidenceFilterPlanResultV1 {
  const spec = claimFilterSpecOf(definition);
  const copiedFilter = requireJsonValue(filter);
  return invokeCapability(
    definition.key,
    "plan-claim-filter",
    () => spec.plan(copiedFilter),
    normalizeFilterPlanResult,
  );
}

export function invokeRecordEvidenceEventFilterEvaluationV1(
  definition: RecordEvidenceEventFilterDefinitionV1,
  input: RecordEvidenceEventFilterEvaluationInputV1,
): RecordEvidenceFilterEvaluationResultV1 {
  const spec = eventFilterSpecOf(definition);
  const copiedInput: RecordEvidenceEventFilterEvaluationInputV1 = Object.freeze({
    filter: requireJsonValue(input.filter),
    envelope: copyEventEnvelope(input.envelope),
    dependencies: copyJsonValueList(input.dependencies),
  });
  return invokeCapability(
    definition.key,
    "evaluate-event-filter",
    () => spec.evaluate(copiedInput),
    normalizeFilterEvaluationResult,
  );
}

export function invokeRecordEvidenceClaimFilterEvaluationV1(
  definition: RecordEvidenceClaimFilterDefinitionV1,
  input: RecordEvidenceClaimFilterEvaluationInputV1,
): RecordEvidenceFilterEvaluationResultV1 {
  const spec = claimFilterSpecOf(definition);
  const copiedInput: RecordEvidenceClaimFilterEvaluationInputV1 = Object.freeze({
    filter: requireJsonValue(input.filter),
    envelope: copyClaimEnvelope(input.envelope),
    dependencies: copyJsonValueList(input.dependencies),
  });
  return invokeCapability(
    definition.key,
    "evaluate-claim-filter",
    () => spec.evaluate(copiedInput),
    normalizeFilterEvaluationResult,
  );
}

export class RecordEvidenceRedactionPolicyHandleV1 {
  readonly key: RecordEvidenceRedactionPolicyKeyV1;
  #opaque = undefined;

  private constructor(key: RecordEvidenceRedactionPolicyKeyV1) {
    this.key = freezeRedactionPolicyKey(key.policy);
    Object.freeze(this);
  }

  static create(key: RecordEvidenceRedactionPolicyKeyV1): RecordEvidenceRedactionPolicyHandleV1 {
    return new RecordEvidenceRedactionPolicyHandleV1(key);
  }
}

interface RedactionPolicyHandleContents {
  readonly registry: RecordEvidenceRegistryV1;
  readonly definition: RecordEvidenceRedactionPolicyDefinitionV1;
}

const redactionPolicyHandles = new WeakMap<object, RedactionPolicyHandleContents>();

export function issueRecordEvidenceRedactionPolicyHandleV1(
  registry: RecordEvidenceRegistryV1,
  policy: RedactionPolicyIdV1,
): RecordEvidenceRedactionPolicyHandleV1 | undefined {
  const definition = findRecordEvidenceRedactionPolicyV1(registry, policy);
  if (definition === undefined) return undefined;
  const handle = RecordEvidenceRedactionPolicyHandleV1.create(definition.key);
  redactionPolicyHandles.set(handle, Object.freeze({ registry, definition }));
  return handle;
}

/** True only for a genuine handle issued by this exact registry instance. */
export function isRecordEvidenceRedactionPolicyHandleV1(
  registry: RecordEvidenceRegistryV1,
  value: unknown,
): value is RecordEvidenceRedactionPolicyHandleV1 {
  if (!isRecordEvidenceRegistryV1(registry) || !isObject(value)) return false;
  const contents = redactionPolicyHandles.get(value);
  return contents !== undefined && contents.registry === registry;
}

export function invokeRecordEvidenceRedactionPolicyV1(
  registry: RecordEvidenceRegistryV1,
  handle: RecordEvidenceRedactionPolicyHandleV1,
  value: JsonValue,
  selector: VersionedSelector,
): RecordEvidenceRedactionApplyResultV1 {
  const contents = redactionPolicyHandles.get(handle);
  if (contents === undefined || contents.registry !== registry) {
    throw new TypeError("Record evidence redaction policy handle is not issued by this registry");
  }
  const spec = redactionPolicySpecOf(contents.definition);
  const copiedValue = requireJsonValue(value);
  const copiedSelector = requireVersionedSelector(selector);
  return invokeCapability(
    contents.definition.key,
    "apply-redaction-policy",
    () => spec.apply(copiedValue, copiedSelector),
    normalizeRedactionApplyResult,
  );
}

function makeSelectorCodecDefinition(
  selectorSchema: string,
  validate: (value: JsonValue) => RecordEvidenceSelectorValidationResultV1,
): RecordEvidenceSelectorCodecDefinitionV1 {
  const definition = RecordEvidenceSelectorCodecDefinitionV1.create(
    freezeSelectorCodecKey(selectorSchema),
  );
  selectorCodecSpecs.set(definition, Object.freeze({ validate }));
  return definition;
}

function makeObjectRepresentationDefinition(
  selectorSchema: string,
  mediaType: string,
  select: (input: RecordEvidenceObjectSelectionInputV1) => RecordEvidenceSelectionResultV1,
  confirmSameLogicalRoot: (
    input: RecordEvidenceLogicalRootInputV1,
  ) => RecordEvidenceLogicalRootResultV1,
  classifyTransformation: (
    input: RecordEvidenceTransformationClassificationInputV1,
  ) => RecordEvidenceTransformationClassificationResultV1,
  measureTransformation: (
    input: RecordEvidenceTransformationMeasurementInputV1,
  ) => RecordEvidenceTransformationMeasurementResultV1,
): RecordEvidenceObjectRepresentationDefinitionV1 {
  const definition = RecordEvidenceObjectRepresentationDefinitionV1.create(
    freezeObjectRepresentationKey(selectorSchema, mediaType),
  );
  objectRepresentationSpecs.set(definition, Object.freeze({
    select,
    confirmSameLogicalRoot,
    classifyTransformation,
    measureTransformation,
  }));
  return definition;
}

function makeEventRepresentationDefinition(
  selectorSchema: string,
  eventSchema: string,
  select: (input: RecordEvidenceEventSelectionInputV1) => RecordEvidenceSelectionResultV1,
  confirmSameLogicalRoot: (
    input: RecordEvidenceLogicalRootInputV1,
  ) => RecordEvidenceLogicalRootResultV1,
  classifyTransformation: (
    input: RecordEvidenceTransformationClassificationInputV1,
  ) => RecordEvidenceTransformationClassificationResultV1,
  measureTransformation: (
    input: RecordEvidenceTransformationMeasurementInputV1,
  ) => RecordEvidenceTransformationMeasurementResultV1,
): RecordEvidenceEventRepresentationDefinitionV1 {
  const definition = RecordEvidenceEventRepresentationDefinitionV1.create(
    freezeEventRepresentationKey(selectorSchema, eventSchema),
  );
  eventRepresentationSpecs.set(definition, Object.freeze({
    select,
    confirmSameLogicalRoot,
    classifyTransformation,
    measureTransformation,
  }));
  return definition;
}

function makeClaimRepresentationDefinition(
  selectorSchema: string,
  claimSchema: string,
  select: (input: RecordEvidenceClaimSelectionInputV1) => RecordEvidenceSelectionResultV1,
  confirmSameLogicalRoot: (
    input: RecordEvidenceLogicalRootInputV1,
  ) => RecordEvidenceLogicalRootResultV1,
  classifyTransformation: (
    input: RecordEvidenceTransformationClassificationInputV1,
  ) => RecordEvidenceTransformationClassificationResultV1,
  measureTransformation: (
    input: RecordEvidenceTransformationMeasurementInputV1,
  ) => RecordEvidenceTransformationMeasurementResultV1,
): RecordEvidenceClaimRepresentationDefinitionV1 {
  const definition = RecordEvidenceClaimRepresentationDefinitionV1.create(
    freezeClaimRepresentationKey(selectorSchema, claimSchema),
  );
  claimRepresentationSpecs.set(definition, Object.freeze({
    select,
    confirmSameLogicalRoot,
    classifyTransformation,
    measureTransformation,
  }));
  return definition;
}

function makeEventFilterDefinition(
  filterSchema: string,
  eventSchema: string,
  plan: (filter: JsonValue) => RecordEvidenceFilterPlanResultV1,
  evaluate: (
    input: RecordEvidenceEventFilterEvaluationInputV1,
  ) => RecordEvidenceFilterEvaluationResultV1,
): RecordEvidenceEventFilterDefinitionV1 {
  const definition = RecordEvidenceEventFilterDefinitionV1.create(
    freezeEventFilterKey(filterSchema, eventSchema),
  );
  eventFilterSpecs.set(definition, Object.freeze({ plan, evaluate }));
  return definition;
}

function makeClaimFilterDefinition(
  filterSchema: string,
  claimSchema: string,
  plan: (filter: JsonValue) => RecordEvidenceFilterPlanResultV1,
  evaluate: (
    input: RecordEvidenceClaimFilterEvaluationInputV1,
  ) => RecordEvidenceFilterEvaluationResultV1,
): RecordEvidenceClaimFilterDefinitionV1 {
  const definition = RecordEvidenceClaimFilterDefinitionV1.create(
    freezeClaimFilterKey(filterSchema, claimSchema),
  );
  claimFilterSpecs.set(definition, Object.freeze({ plan, evaluate }));
  return definition;
}

function makeRedactionPolicyDefinition(
  policy: RedactionPolicyIdV1,
  apply: (
    value: JsonValue,
    selector: VersionedSelector,
  ) => RecordEvidenceRedactionApplyResultV1,
): RecordEvidenceRedactionPolicyDefinitionV1 {
  const copiedPolicy = requireRedactionPolicyId(policy);
  const definition = RecordEvidenceRedactionPolicyDefinitionV1.create(
    freezeRedactionPolicyKey(copiedPolicy),
  );
  redactionPolicySpecs.set(definition, Object.freeze({ apply }));
  return definition;
}

function isSelectorCodecDefinitionInputV1(
  value: unknown,
): value is RecordEvidenceSelectorCodecDefinitionInputV1 {
  const members = exactPlainRecord(value, ["selectorSchema", "validate"]);
  return members !== undefined
    && isNonEmptyProtocolString(members.get("selectorSchema"))
    && typeof members.get("validate") === "function";
}

function isObjectRepresentationDefinitionInputV1(
  value: unknown,
): value is RecordEvidenceObjectRepresentationDefinitionInputV1 {
  const members = exactPlainRecord(value, [
    "selectorSchema",
    "mediaType",
    "select",
    "confirmSameLogicalRoot",
    "classifyTransformation",
    "measureTransformation",
  ]);
  return members !== undefined
    && isNonEmptyProtocolString(members.get("selectorSchema"))
    && isMediaType(members.get("mediaType"))
    && typeof members.get("select") === "function"
    && typeof members.get("confirmSameLogicalRoot") === "function"
    && typeof members.get("classifyTransformation") === "function"
    && typeof members.get("measureTransformation") === "function";
}

function isEventRepresentationDefinitionInputV1(
  value: unknown,
): value is RecordEvidenceEventRepresentationDefinitionInputV1 {
  const members = exactPlainRecord(value, [
    "selectorSchema",
    "eventSchema",
    "select",
    "confirmSameLogicalRoot",
    "classifyTransformation",
    "measureTransformation",
  ]);
  return members !== undefined
    && isNonEmptyProtocolString(members.get("selectorSchema"))
    && isNonEmptyProtocolString(members.get("eventSchema"))
    && typeof members.get("select") === "function"
    && typeof members.get("confirmSameLogicalRoot") === "function"
    && typeof members.get("classifyTransformation") === "function"
    && typeof members.get("measureTransformation") === "function";
}

function isClaimRepresentationDefinitionInputV1(
  value: unknown,
): value is RecordEvidenceClaimRepresentationDefinitionInputV1 {
  const members = exactPlainRecord(value, [
    "selectorSchema",
    "claimSchema",
    "select",
    "confirmSameLogicalRoot",
    "classifyTransformation",
    "measureTransformation",
  ]);
  return members !== undefined
    && isNonEmptyProtocolString(members.get("selectorSchema"))
    && isNonEmptyProtocolString(members.get("claimSchema"))
    && typeof members.get("select") === "function"
    && typeof members.get("confirmSameLogicalRoot") === "function"
    && typeof members.get("classifyTransformation") === "function"
    && typeof members.get("measureTransformation") === "function";
}

function isEventFilterDefinitionInputV1(
  value: unknown,
): value is RecordEvidenceEventFilterDefinitionInputV1 {
  const members = exactPlainRecord(value, [
    "filterSchema",
    "eventSchema",
    "plan",
    "evaluate",
  ]);
  return members !== undefined
    && isNonEmptyProtocolString(members.get("filterSchema"))
    && isNonEmptyProtocolString(members.get("eventSchema"))
    && typeof members.get("plan") === "function"
    && typeof members.get("evaluate") === "function";
}

function isClaimFilterDefinitionInputV1(
  value: unknown,
): value is RecordEvidenceClaimFilterDefinitionInputV1 {
  const members = exactPlainRecord(value, [
    "filterSchema",
    "claimSchema",
    "plan",
    "evaluate",
  ]);
  return members !== undefined
    && isNonEmptyProtocolString(members.get("filterSchema"))
    && isNonEmptyProtocolString(members.get("claimSchema"))
    && typeof members.get("plan") === "function"
    && typeof members.get("evaluate") === "function";
}

function isRedactionPolicyDefinitionInputV1(
  value: unknown,
): value is RecordEvidenceRedactionPolicyDefinitionInputV1 {
  const members = exactPlainRecord(value, ["policy", "apply"]);
  return members !== undefined
    && copyRedactionPolicyId(members.get("policy")) !== undefined
    && typeof members.get("apply") === "function";
}

function isRecordEvidenceRegistryDefinitionV1(
  value: unknown,
): value is RecordEvidenceRegistryDefinitionV1 {
  const members = exactPlainRecord(value, [
    "selectorCodecs",
    "representations",
    "filters",
    "redactionPolicies",
  ]);
  return members !== undefined
    && Array.isArray(members.get("selectorCodecs"))
    && Array.isArray(members.get("representations"))
    && Array.isArray(members.get("filters"))
    && Array.isArray(members.get("redactionPolicies"));
}

function copySelectorCodecDefinitions(
  definitions: readonly RecordEvidenceSelectorCodecDefinitionV1[],
): readonly RecordEvidenceSelectorCodecDefinitionV1[] {
  const seen = new Set<string>();
  const copied: RecordEvidenceSelectorCodecDefinitionV1[] = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    if (!isRecordEvidenceSelectorCodecDefinitionV1(definition)) {
      throwInvalidDefinition("selector-codec", index);
    }
    const identity = capabilityIdentity(definition.key);
    if (seen.has(identity)) throwDuplicateKey("selector-codec", index, definition.key);
    seen.add(identity);
    const spec = selectorCodecSpecOf(definition);
    copied.push(makeSelectorCodecDefinition(definition.key.selectorSchema, spec.validate));
  }
  return Object.freeze(copied);
}

function copyRepresentationDefinitions(
  definitions: readonly RecordEvidenceRepresentationDefinitionV1[],
): readonly RecordEvidenceRepresentationDefinitionV1[] {
  const seen = new Set<string>();
  const copied: RecordEvidenceRepresentationDefinitionV1[] = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    if (
      !isRecordEvidenceObjectRepresentationDefinitionV1(definition)
      && !isRecordEvidenceEventRepresentationDefinitionV1(definition)
      && !isRecordEvidenceClaimRepresentationDefinitionV1(definition)
    ) {
      throwInvalidDefinition("representation", index);
    }
    const identity = capabilityIdentity(definition.key);
    if (seen.has(identity)) {
      throwDuplicateKey(representationDefinitionKind(definition), index, definition.key);
    }
    seen.add(identity);
    if (isRecordEvidenceObjectRepresentationDefinitionV1(definition)) {
      const spec = objectRepresentationSpecOf(definition);
      copied.push(makeObjectRepresentationDefinition(
        definition.key.selectorSchema,
        definition.key.mediaType,
        spec.select,
        spec.confirmSameLogicalRoot,
        spec.classifyTransformation,
        spec.measureTransformation,
      ));
      continue;
    }
    if (isRecordEvidenceEventRepresentationDefinitionV1(definition)) {
      const spec = eventRepresentationSpecOf(definition);
      copied.push(makeEventRepresentationDefinition(
        definition.key.selectorSchema,
        definition.key.eventSchema,
        spec.select,
        spec.confirmSameLogicalRoot,
        spec.classifyTransformation,
        spec.measureTransformation,
      ));
      continue;
    }
    const spec = claimRepresentationSpecOf(definition);
    copied.push(makeClaimRepresentationDefinition(
      definition.key.selectorSchema,
      definition.key.claimSchema,
      spec.select,
      spec.confirmSameLogicalRoot,
      spec.classifyTransformation,
      spec.measureTransformation,
    ));
  }
  return Object.freeze(copied);
}

function copyFilterDefinitions(
  definitions: readonly RecordEvidenceFilterDefinitionV1[],
): readonly RecordEvidenceFilterDefinitionV1[] {
  const seen = new Set<string>();
  const copied: RecordEvidenceFilterDefinitionV1[] = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    if (
      !isRecordEvidenceEventFilterDefinitionV1(definition)
      && !isRecordEvidenceClaimFilterDefinitionV1(definition)
    ) {
      throwInvalidDefinition("filter", index);
    }
    const identity = capabilityIdentity(definition.key);
    if (seen.has(identity)) {
      throwDuplicateKey(filterDefinitionKind(definition), index, definition.key);
    }
    seen.add(identity);
    if (isRecordEvidenceEventFilterDefinitionV1(definition)) {
      const spec = eventFilterSpecOf(definition);
      copied.push(makeEventFilterDefinition(
        definition.key.filterSchema,
        definition.key.eventSchema,
        spec.plan,
        spec.evaluate,
      ));
      continue;
    }
    const spec = claimFilterSpecOf(definition);
    copied.push(makeClaimFilterDefinition(
      definition.key.filterSchema,
      definition.key.claimSchema,
      spec.plan,
      spec.evaluate,
    ));
  }
  return Object.freeze(copied);
}

function copyRedactionPolicyDefinitions(
  definitions: readonly RecordEvidenceRedactionPolicyDefinitionV1[],
): readonly RecordEvidenceRedactionPolicyDefinitionV1[] {
  const seen = new Set<string>();
  const copied: RecordEvidenceRedactionPolicyDefinitionV1[] = [];
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = definitions[index];
    if (!isRecordEvidenceRedactionPolicyDefinitionV1(definition)) {
      throwInvalidDefinition("redaction-policy", index);
    }
    const identity = capabilityIdentity(definition.key);
    if (seen.has(identity)) throwDuplicateKey("redaction-policy", index, definition.key);
    seen.add(identity);
    const spec = redactionPolicySpecOf(definition);
    copied.push(makeRedactionPolicyDefinition(definition.key.policy, spec.apply));
  }
  return Object.freeze(copied);
}

function freezeRegistryDefinition(
  selectorCodecs: readonly RecordEvidenceSelectorCodecDefinitionV1[],
  representations: readonly RecordEvidenceRepresentationDefinitionV1[],
  filters: readonly RecordEvidenceFilterDefinitionV1[],
  redactionPolicies: readonly RecordEvidenceRedactionPolicyDefinitionV1[],
): RecordEvidenceRegistryDefinitionV1 {
  return Object.freeze({
    selectorCodecs: Object.freeze([...selectorCodecs]),
    representations: Object.freeze([...representations]),
    filters: Object.freeze([...filters]),
    redactionPolicies: Object.freeze([...redactionPolicies]),
  });
}

function registryContentsFor(
  definition: RecordEvidenceRegistryDefinitionV1,
): RecordEvidenceRegistryContents {
  const selectorCodecs = new Map<string, RecordEvidenceSelectorCodecDefinitionV1>();
  const objectRepresentations = new Map<
    string,
    RecordEvidenceObjectRepresentationDefinitionV1
  >();
  const eventRepresentations = new Map<
    string,
    RecordEvidenceEventRepresentationDefinitionV1
  >();
  const claimRepresentations = new Map<
    string,
    RecordEvidenceClaimRepresentationDefinitionV1
  >();
  const eventFilters = new Map<string, RecordEvidenceEventFilterDefinitionV1>();
  const claimFilters = new Map<string, RecordEvidenceClaimFilterDefinitionV1>();
  const redactionPolicies = new Map<string, RecordEvidenceRedactionPolicyDefinitionV1>();
  for (const definitionEntry of definition.selectorCodecs) {
    selectorCodecs.set(capabilityIdentity(definitionEntry.key), definitionEntry);
  }
  for (const definitionEntry of definition.representations) {
    const identity = capabilityIdentity(definitionEntry.key);
    if (isRecordEvidenceObjectRepresentationDefinitionV1(definitionEntry)) {
      objectRepresentations.set(identity, definitionEntry);
      continue;
    }
    if (isRecordEvidenceEventRepresentationDefinitionV1(definitionEntry)) {
      eventRepresentations.set(identity, definitionEntry);
      continue;
    }
    claimRepresentations.set(identity, definitionEntry);
  }
  for (const definitionEntry of definition.filters) {
    const identity = capabilityIdentity(definitionEntry.key);
    if (isRecordEvidenceEventFilterDefinitionV1(definitionEntry)) {
      eventFilters.set(identity, definitionEntry);
      continue;
    }
    claimFilters.set(identity, definitionEntry);
  }
  for (const definitionEntry of definition.redactionPolicies) {
    redactionPolicies.set(capabilityIdentity(definitionEntry.key), definitionEntry);
  }
  return Object.freeze({
    selectorCodecs,
    objectRepresentations,
    eventRepresentations,
    claimRepresentations,
    eventFilters,
    claimFilters,
    redactionPolicies,
  });
}

function contentsOf(registry: RecordEvidenceRegistryV1): RecordEvidenceRegistryContents {
  const contents = registryContents.get(registry);
  if (contents === undefined) {
    throw new TypeError("Record evidence registry is not runtime-branded");
  }
  return contents;
}

function selectorCodecSpecOf(
  definition: RecordEvidenceSelectorCodecDefinitionV1,
): SelectorCodecSpec {
  const spec = selectorCodecSpecs.get(definition);
  if (spec === undefined) throw new TypeError("Selector codec definition is not runtime-branded");
  return spec;
}

function objectRepresentationSpecOf(
  definition: RecordEvidenceObjectRepresentationDefinitionV1,
): ObjectRepresentationSpec {
  const spec = objectRepresentationSpecs.get(definition);
  if (spec === undefined) throw new TypeError("Object representation definition is not runtime-branded");
  return spec;
}

function eventRepresentationSpecOf(
  definition: RecordEvidenceEventRepresentationDefinitionV1,
): EventRepresentationSpec {
  const spec = eventRepresentationSpecs.get(definition);
  if (spec === undefined) throw new TypeError("Event representation definition is not runtime-branded");
  return spec;
}

function claimRepresentationSpecOf(
  definition: RecordEvidenceClaimRepresentationDefinitionV1,
): ClaimRepresentationSpec {
  const spec = claimRepresentationSpecs.get(definition);
  if (spec === undefined) throw new TypeError("Claim representation definition is not runtime-branded");
  return spec;
}

function representationSharedSpecOf(
  definition: RecordEvidenceRepresentationDefinitionV1,
): RepresentationSharedSpec {
  if (isRecordEvidenceObjectRepresentationDefinitionV1(definition)) {
    return objectRepresentationSpecOf(definition);
  }
  if (isRecordEvidenceEventRepresentationDefinitionV1(definition)) {
    return eventRepresentationSpecOf(definition);
  }
  return claimRepresentationSpecOf(definition);
}

function eventFilterSpecOf(
  definition: RecordEvidenceEventFilterDefinitionV1,
): EventFilterSpec {
  const spec = eventFilterSpecs.get(definition);
  if (spec === undefined) throw new TypeError("Event filter definition is not runtime-branded");
  return spec;
}

function claimFilterSpecOf(
  definition: RecordEvidenceClaimFilterDefinitionV1,
): ClaimFilterSpec {
  const spec = claimFilterSpecs.get(definition);
  if (spec === undefined) throw new TypeError("Claim filter definition is not runtime-branded");
  return spec;
}

function redactionPolicySpecOf(
  definition: RecordEvidenceRedactionPolicyDefinitionV1,
): RedactionPolicySpec {
  const spec = redactionPolicySpecs.get(definition);
  if (spec === undefined) throw new TypeError("Redaction policy definition is not runtime-branded");
  return spec;
}

function invokeCapability<Result>(
  key: RecordEvidenceCapabilityKeyV1,
  operation: RecordEvidenceCapabilityOperation,
  callback: () => unknown,
  normalize: (value: unknown) => Result | undefined,
): Result {
  let rawResult: unknown;
  try {
    rawResult = callback();
  } catch (cause) {
    throw capabilityFailure(key, operation, "threw", cause);
  }
  try {
    const result = normalize(rawResult);
    if (result !== undefined) return result;
  } catch {
    // A proxy/getter can fail while the Result boundary inspects it. That remains invalid-result.
  }
  throw capabilityFailure(key, operation, "invalid-result", null);
}

function capabilityFailure(
  key: RecordEvidenceCapabilityKeyV1,
  operation: RecordEvidenceCapabilityOperation,
  issue: "threw" | "invalid-result",
  cause: unknown | null,
): RecordEvidenceCapabilityError {
  return new RecordEvidenceCapabilityError(Object.freeze({
    code: "record-evidence-capability-failed",
    key: copyCapabilityKey(key),
    operation,
    issue,
    cause,
    retryable: false,
  }));
}

function normalizeSelectorValidationResult(
  value: unknown,
): RecordEvidenceSelectorValidationResultV1 | undefined {
  const members = exactPlainRecord(value, ["kind"]);
  if (members === undefined) return undefined;
  const kind = members.get("kind");
  if (kind === "valid") return Object.freeze({ kind: "valid" });
  if (kind === "invalid") return Object.freeze({ kind: "invalid" });
  return undefined;
}

function normalizeSelectionResult(
  value: unknown,
): RecordEvidenceSelectionResultV1 | undefined {
  const base = exactPlainRecord(value, ["kind"]);
  if (base !== undefined) {
    const kind = base.get("kind");
    if (kind === "not-selected") return Object.freeze({ kind: "not-selected" });
    if (kind === "unsupported") return Object.freeze({ kind: "unsupported" });
  }
  const selected = exactPlainRecord(value, ["kind", "value"]);
  if (selected === undefined || selected.get("kind") !== "selected") return undefined;
  const copiedValue = copyCanonicalJsonValue(selected.get("value"));
  return copiedValue === undefined
    ? undefined
    : Object.freeze({ kind: "selected", value: copiedValue });
}

function normalizeLogicalRootResult(
  value: unknown,
): RecordEvidenceLogicalRootResultV1 | undefined {
  const members = exactPlainRecord(value, ["kind"]);
  if (members === undefined) return undefined;
  const kind = members.get("kind");
  if (kind === "same") return Object.freeze({ kind: "same" });
  if (kind === "different") return Object.freeze({ kind: "different" });
  if (kind === "unsupported") return Object.freeze({ kind: "unsupported" });
  return undefined;
}

function normalizeTransformationClassificationResult(
  value: unknown,
): RecordEvidenceTransformationClassificationResultV1 | undefined {
  const base = exactPlainRecord(value, ["kind"]);
  if (base !== undefined) {
    const kind = base.get("kind");
    if (kind === "unavailable") return Object.freeze({ kind: "unavailable" });
    if (kind === "unsupported") return Object.freeze({ kind: "unsupported" });
  }
  const classified = exactPlainRecord(value, ["kind", "value"]);
  if (classified === undefined) return undefined;
  const kind = classified.get("kind");
  if (kind !== "none" && kind !== "limited") return undefined;
  const copiedValue = copyCanonicalJsonValue(classified.get("value"));
  return copiedValue === undefined
    ? undefined
    : Object.freeze({ kind, value: copiedValue });
}

function normalizeTransformationMeasurementResult(
  value: unknown,
): RecordEvidenceTransformationMeasurementResultV1 | undefined {
  const unsupported = exactPlainRecord(value, ["kind"]);
  if (unsupported !== undefined && unsupported.get("kind") === "unsupported") {
    return Object.freeze({ kind: "unsupported" });
  }
  const measured = exactPlainRecord(value, ["kind", "bytes"]);
  if (measured === undefined || measured.get("kind") !== "measured") return undefined;
  const bytes = measured.get("bytes");
  return isJsonSafeUnsignedInteger(bytes)
    ? Object.freeze({ kind: "measured", bytes })
    : undefined;
}

function normalizeRedactionApplyResult(
  value: unknown,
): RecordEvidenceRedactionApplyResultV1 | undefined {
  const unsupported = exactPlainRecord(value, ["kind"]);
  if (unsupported !== undefined && unsupported.get("kind") === "unsupported") {
    return Object.freeze({ kind: "unsupported" });
  }
  const success = exactPlainRecord(value, ["kind", "value"]);
  if (success === undefined || success.get("kind") !== "success") return undefined;
  const copiedValue = copyCanonicalJsonValue(success.get("value"));
  return copiedValue === undefined
    ? undefined
    : Object.freeze({ kind: "success", value: copiedValue });
}

function normalizeFilterPlanResult(
  value: unknown,
): RecordEvidenceFilterPlanResultV1 | undefined {
  const envelopeOnly = exactPlainRecord(value, ["kind"]);
  if (envelopeOnly !== undefined && envelopeOnly.get("kind") === "envelope-only") {
    return Object.freeze({ kind: "envelope-only" });
  }
  const bodyDependentWithOutputSelector = exactPlainRecord(value, [
    "kind",
    "dependencies",
    "outputSelector",
  ]);
  const withoutOutputSelector = exactPlainRecord(value, ["kind", "dependencies"]);
  const members = bodyDependentWithOutputSelector ?? withoutOutputSelector;
  if (members === undefined || members.get("kind") !== "body-dependent") return undefined;
  const dependencies = members.get("dependencies");
  if (!Array.isArray(dependencies) || dependencies.length === 0) return undefined;
  const copiedDependencies: VersionedSelector[] = [];
  for (const dependency of dependencies) {
    const copied = copyVersionedSelector(dependency);
    if (copied === undefined) return undefined;
    copiedDependencies.push(copied);
  }
  const first = copiedDependencies[0];
  if (first === undefined) return undefined;
  if (copiedDependencies.some((dependency) => dependency.schema !== first.schema)) {
    return undefined;
  }
  const frozenDependencies: readonly [VersionedSelector, ...VersionedSelector[]] = Object.freeze([
    first,
    ...copiedDependencies.slice(1),
  ]);
  if (bodyDependentWithOutputSelector === undefined) {
    return Object.freeze({ kind: "body-dependent", dependencies: frozenDependencies });
  }
  const outputSelectorValue = bodyDependentWithOutputSelector.get("outputSelector");
  if (outputSelectorValue === undefined) return undefined;
  const outputSelector = copyVersionedSelector(outputSelectorValue);
  return outputSelector === undefined
    ? undefined
    : Object.freeze({
        kind: "body-dependent",
        dependencies: frozenDependencies,
        outputSelector,
      });
}

function normalizeFilterEvaluationResult(
  value: unknown,
): RecordEvidenceFilterEvaluationResultV1 | undefined {
  const members = exactPlainRecord(value, ["kind"]);
  if (members === undefined) return undefined;
  const kind = members.get("kind");
  if (kind === "match") return Object.freeze({ kind: "match" });
  if (kind === "no-match") return Object.freeze({ kind: "no-match" });
  return undefined;
}

function copyEventEnvelope(
  input: RecordEvidenceEventEnvelopeViewV1,
): RecordEvidenceEventEnvelopeViewV1 {
  const scope: RecordEvidenceEventEnvelopeViewV1["scope"] = input.scope.kind === "run"
    ? Object.freeze({
        kind: "run",
        runId: input.scope.runId,
        experimentId: input.scope.experimentId,
      })
    : Object.freeze({
        kind: "attempt",
        runId: input.scope.runId,
        experimentId: input.scope.experimentId,
        attemptId: input.scope.attemptId,
        evalId: input.scope.evalId,
        ...(input.scope.agentSessionId === undefined
          ? {}
          : { agentSessionId: input.scope.agentSessionId }),
        ...(input.scope.turnId === undefined ? {} : { turnId: input.scope.turnId }),
      });
  const correlation = input.correlation === undefined
    ? undefined
    : Object.freeze({
        ...(input.correlation.parentEventId === undefined
          ? {}
          : { parentEventId: input.correlation.parentEventId }),
        ...(input.correlation.traceId === undefined ? {} : { traceId: input.correlation.traceId }),
        ...(input.correlation.spanId === undefined ? {} : { spanId: input.correlation.spanId }),
      });
  return Object.freeze({
    format: "niceeval.observation",
    id: input.id,
    name: input.name,
    schema: input.schema,
    stream: Object.freeze({ id: input.stream.id, sequence: input.stream.sequence }),
    scope,
    time: Object.freeze({
      observedAt: input.time.observedAt,
      monotonicOffsetNs: input.time.monotonicOffsetNs,
      ...(input.time.occurredAt === undefined ? {} : { occurredAt: input.time.occurredAt }),
    }),
    source: Object.freeze({
      component: input.source.component,
      ...(input.source.version === undefined ? {} : { version: input.source.version }),
      ...(input.source.adapter === undefined ? {} : { adapter: input.source.adapter }),
      ...(input.source.mapperVersion === undefined
        ? {}
        : { mapperVersion: input.source.mapperVersion }),
    }),
    ...(correlation === undefined ? {} : { correlation }),
  });
}

function copyClaimEnvelope(
  input: RecordEvidenceClaimEnvelopeViewV1,
): RecordEvidenceClaimEnvelopeViewV1 {
  return Object.freeze({
    id: input.id,
    kind: input.kind,
    schema: input.schema,
    evaluator: Object.freeze({
      namespace: input.evaluator.namespace,
      name: input.evaluator.name,
      version: input.evaluator.version,
      ...(input.evaluator.model === undefined ? {} : { model: input.evaluator.model }),
    }),
    producedAt: input.producedAt,
  });
}

function copyJsonValueList(values: readonly JsonValue[]): readonly JsonValue[] {
  const copied: JsonValue[] = [];
  for (const value of values) copied.push(requireJsonValue(value));
  return Object.freeze(copied);
}

function copyUint8Array(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError("Record evidence object payload must be a Uint8Array");
  }
  return new Uint8Array(value);
}

function requireJsonValue(value: unknown): JsonValue {
  const copied = copyCanonicalJsonValue(value);
  if (copied === undefined) throw new TypeError("Record evidence value must be canonical JSON");
  return copied;
}

function copyCanonicalJsonValue(value: unknown): JsonValue | undefined {
  try {
    return copyCanonicalJsonValueInner(value, new WeakSet<object>());
  } catch {
    return undefined;
  }
}

function copyCanonicalJsonValueInner(
  value: unknown,
  ancestors: WeakSet<object>,
): JsonValue | undefined {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return hasOnlyPairedSurrogates(value) ? value : undefined;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (!isObject(value)) return undefined;
  if (ancestors.has(value)) return undefined;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const names = Object.getOwnPropertyNames(value);
    if (names.length !== value.length + 1 || !names.includes("length")) return undefined;
    if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) return undefined;
    ancestors.add(value);
    try {
      const copied: JsonValue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (
          descriptor === undefined
          || descriptor.enumerable !== true
          || !("value" in descriptor)
          || descriptor.get !== undefined
          || descriptor.set !== undefined
        ) {
          return undefined;
        }
        const item = copyCanonicalJsonValueInner(descriptor.value, ancestors);
        if (item === undefined) return undefined;
        copied.push(item);
      }
      return Object.freeze(copied);
    } finally {
      ancestors.delete(value);
    }
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  if (Reflect.ownKeys(value).some((key) => typeof key === "symbol")) return undefined;
  ancestors.add(value);
  try {
    const copied: globalThis.Record<string, JsonValue> = {};
    for (const key of Object.getOwnPropertyNames(value).sort()) {
      if (!hasOnlyPairedSurrogates(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !("value" in descriptor)
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        return undefined;
      }
      const member = copyCanonicalJsonValueInner(descriptor.value, ancestors);
      if (member === undefined) return undefined;
      copied[key] = member;
    }
    return Object.freeze(copied);
  } finally {
    ancestors.delete(value);
  }
}

function copyVersionedSelector(value: unknown): VersionedSelector | undefined {
  try {
    const members = exactPlainRecord(value, ["schema", "value"]);
    if (members === undefined) return undefined;
    const schema = members.get("schema");
    const selectorValue = copyCanonicalJsonValue(members.get("value"));
    if (!isNonEmptyProtocolString(schema) || selectorValue === undefined) return undefined;
    return Object.freeze({ schema, value: selectorValue });
  } catch {
    return undefined;
  }
}

function requireVersionedSelector(value: unknown): VersionedSelector {
  const copied = copyVersionedSelector(value);
  if (copied === undefined) throw new TypeError("Record evidence selector is invalid");
  return copied;
}

function copyRedactionPolicyId(value: unknown): RedactionPolicyIdV1 | undefined {
  try {
    const members = exactPlainRecord(value, ["namespace", "name", "version"]);
    if (members === undefined) return undefined;
    const namespace = members.get("namespace");
    const name = members.get("name");
    const version = members.get("version");
    if (
      !isNonEmptyProtocolString(namespace)
      || !isNonEmptyProtocolString(name)
      || !isNonEmptyProtocolString(version)
    ) {
      return undefined;
    }
    return Object.freeze({ namespace, name, version });
  } catch {
    return undefined;
  }
}

function requireRedactionPolicyId(value: unknown): RedactionPolicyIdV1 {
  const copied = copyRedactionPolicyId(value);
  if (copied === undefined) throw new TypeError("Record evidence redaction policy ID is invalid");
  return copied;
}

function requireEvidenceTransformation(value: unknown): EvidenceTransformationV1 {
  const copied = copyEvidenceTransformation(value);
  if (copied === undefined) throw new TypeError("Record evidence transformation is invalid");
  return copied;
}

function copyEvidenceTransformation(value: unknown): EvidenceTransformationV1 | undefined {
  const redacted = exactPlainRecord(value, ["kind", "selector", "policy"]);
  if (redacted !== undefined && redacted.get("kind") === "redacted") {
    const selector = copyVersionedSelector(redacted.get("selector"));
    const policy = copyRedactionPolicyId(redacted.get("policy"));
    return selector === undefined || policy === undefined
      ? undefined
      : Object.freeze({ kind: "redacted", selector, policy });
  }
  const truncated = exactPlainRecord(value, ["kind", "selector", "inputBytes"]);
  if (truncated === undefined || truncated.get("kind") !== "truncated") return undefined;
  const selector = copyVersionedSelector(truncated.get("selector"));
  const inputBytes = truncated.get("inputBytes");
  return selector === undefined || !isJsonSafeUnsignedInteger(inputBytes)
    ? undefined
    : Object.freeze({ kind: "truncated", selector, inputBytes });
}

function exactPlainRecord(
  value: unknown,
  expected: readonly string[],
): ReadonlyMap<string, unknown> | undefined {
  try {
    if (!isObject(value) || Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== expected.length || keys.some((key) => typeof key !== "string")) {
      return undefined;
    }
    const expectedKeys = new Set(expected);
    const members = new Map<string, unknown>();
    for (const key of expected) {
      if (!expectedKeys.has(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (
        descriptor === undefined
        || descriptor.enumerable !== true
        || !("value" in descriptor)
        || descriptor.get !== undefined
        || descriptor.set !== undefined
      ) {
        return undefined;
      }
      members.set(key, descriptor.value);
    }
    if (keys.some((key) => typeof key === "string" && !expectedKeys.has(key))) {
      return undefined;
    }
    return members;
  } catch {
    return undefined;
  }
}

function freezeSelectorCodecKey(selectorSchema: string): RecordEvidenceSelectorCodecKeyV1 {
  return Object.freeze({ kind: "selector-codec", selectorSchema });
}

function freezeObjectRepresentationKey(
  selectorSchema: string,
  mediaType: string,
): Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "object" }> {
  return Object.freeze({ kind: "object", selectorSchema, mediaType });
}

function freezeEventRepresentationKey(
  selectorSchema: string,
  eventSchema: string,
): Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "event" }> {
  return Object.freeze({ kind: "event", selectorSchema, eventSchema });
}

function freezeClaimRepresentationKey(
  selectorSchema: string,
  claimSchema: string,
): Extract<RecordEvidenceRepresentationKeyV1, { readonly kind: "claim" }> {
  return Object.freeze({ kind: "claim", selectorSchema, claimSchema });
}

function freezeEventFilterKey(
  filterSchema: string,
  eventSchema: string,
): Extract<RecordEvidenceFilterKeyV1, { readonly kind: "event-filter" }> {
  return Object.freeze({ kind: "event-filter", filterSchema, eventSchema });
}

function freezeClaimFilterKey(
  filterSchema: string,
  claimSchema: string,
): Extract<RecordEvidenceFilterKeyV1, { readonly kind: "claim-filter" }> {
  return Object.freeze({ kind: "claim-filter", filterSchema, claimSchema });
}

function freezeRedactionPolicyKey(
  policy: RedactionPolicyIdV1,
): RecordEvidenceRedactionPolicyKeyV1 {
  return Object.freeze({ kind: "redaction-policy", policy: requireRedactionPolicyId(policy) });
}

function copyCapabilityKey(key: RecordEvidenceCapabilityKeyV1): RecordEvidenceCapabilityKeyV1 {
  switch (key.kind) {
    case "selector-codec":
      return freezeSelectorCodecKey(key.selectorSchema);
    case "object":
      return freezeObjectRepresentationKey(key.selectorSchema, key.mediaType);
    case "event":
      return freezeEventRepresentationKey(key.selectorSchema, key.eventSchema);
    case "claim":
      return freezeClaimRepresentationKey(key.selectorSchema, key.claimSchema);
    case "event-filter":
      return freezeEventFilterKey(key.filterSchema, key.eventSchema);
    case "claim-filter":
      return freezeClaimFilterKey(key.filterSchema, key.claimSchema);
    case "redaction-policy":
      return freezeRedactionPolicyKey(key.policy);
  }
}

function capabilityIdentity(key: RecordEvidenceCapabilityKeyV1): string {
  switch (key.kind) {
    case "selector-codec":
      return collisionSafeIdentity([key.kind, key.selectorSchema]);
    case "object":
      return collisionSafeIdentity([key.kind, key.selectorSchema, key.mediaType]);
    case "event":
      return collisionSafeIdentity([key.kind, key.selectorSchema, key.eventSchema]);
    case "claim":
      return collisionSafeIdentity([key.kind, key.selectorSchema, key.claimSchema]);
    case "event-filter":
      return collisionSafeIdentity([key.kind, key.filterSchema, key.eventSchema]);
    case "claim-filter":
      return collisionSafeIdentity([key.kind, key.filterSchema, key.claimSchema]);
    case "redaction-policy":
      return collisionSafeIdentity([
        key.kind,
        key.policy.namespace,
        key.policy.name,
        key.policy.version,
      ]);
  }
}

function collisionSafeIdentity(parts: readonly string[]): string {
  // Each UTF-16 segment is length delimited. Delimiters inside a schema or media type cannot
  // collapse two complete discriminated keys into one Map entry.
  return parts.map((part) => `${part.length}:${part}`).join("");
}

function representationDefinitionKind(
  definition: RecordEvidenceRepresentationDefinitionV1,
): RecordEvidenceRegistryDefinitionKindV1 {
  if (isRecordEvidenceObjectRepresentationDefinitionV1(definition)) {
    return "object-representation";
  }
  if (isRecordEvidenceEventRepresentationDefinitionV1(definition)) {
    return "event-representation";
  }
  return "claim-representation";
}

function filterDefinitionKind(
  definition: RecordEvidenceFilterDefinitionV1,
): RecordEvidenceRegistryDefinitionKindV1 {
  return isRecordEvidenceEventFilterDefinitionV1(definition)
    ? "event-filter"
    : "claim-filter";
}

function throwInvalidDefinition(
  definitionKind: RecordEvidenceRegistryDefinitionKindV1,
  index: number | null,
  key?: RecordEvidenceCapabilityKeyV1,
): never {
  const failure: RecordEvidenceInvalidDefinitionFailureV1 = key === undefined
    ? Object.freeze({
        code: "record-evidence-registry-invalid-definition",
        definitionKind,
        index,
        cause: null,
      })
    : Object.freeze({
        code: "record-evidence-registry-invalid-definition",
        definitionKind,
        index,
        key: copyCapabilityKey(key),
        cause: null,
      });
  throw new RecordEvidenceRegistryDefinitionError(failure);
}

function throwDuplicateKey(
  definitionKind: RecordEvidenceRegistryDefinitionKindV1,
  index: number,
  key: RecordEvidenceCapabilityKeyV1,
): never {
  throw new RecordEvidenceRegistryDefinitionError(Object.freeze({
    code: "record-evidence-registry-duplicate-key",
    definitionKind,
    index,
    key: copyCapabilityKey(key),
    cause: null,
  }));
}

function rethrowDefinitionFailure(
  cause: unknown,
  definitionKind: RecordEvidenceRegistryDefinitionKindV1,
  index: number | null,
): never {
  if (cause instanceof RecordEvidenceRegistryDefinitionError) throw cause;
  throwInvalidDefinition(definitionKind, index);
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === "object";
}

function isNonEmptyProtocolString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\u0000");
}

function isJsonSafeUnsignedInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

const MEDIA_TYPE_TOKEN = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
const MEDIA_TYPE_QUOTED = '"(?:[\\t !#-\\[\\]-~]|\\\\[\\t -~])*"';
const MEDIA_TYPE_PATTERN = new RegExp(
  `^${MEDIA_TYPE_TOKEN}/${MEDIA_TYPE_TOKEN}(?:;${MEDIA_TYPE_TOKEN}=(?:${MEDIA_TYPE_TOKEN}|${MEDIA_TYPE_QUOTED}))*$`,
);

function isMediaType(value: unknown): value is string {
  return typeof value === "string" && MEDIA_TYPE_PATTERN.test(value);
}

function hasOnlyPairedSurrogates(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return false;
  }
  return true;
}
