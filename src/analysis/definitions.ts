import { Effect } from "effect";
import {
  logicalSlotMembersForSample,
  readPublishedInput,
} from "../sample/capability.ts";
import {
  publishedAnalysisInputBindings,
  type PublishedAnalysisInputBinding,
} from "./bindings.ts";
import type {
  AnalysisRun,
  SampleClosedError,
  AttemptEvidenceIdentity,
  EvalId,
  ExecutionIdentityDigest,
  ExperimentId,
  MeasureFormat,
  MetricBasis,
  PopulationIdentity,
  ProducerIdentity,
  RunId,
  Sample,
  SampleInputObservation,
  SlotId,
} from "./contracts.ts";
import type { MembershipAction } from "../record/model/core.ts";

export type DimensionValue = string | number | boolean | null;

export interface LogicalSlot {
  /** Exact occurrence identity in one selected Run. */
  readonly runId: RunId;
  /**
   * The selected Run's closed Core projection. It carries configuration
   * dimensions without exposing a Record reader or reopening selection.
   */
  readonly run: AnalysisRun;
  readonly slotId: SlotId;
  /** Derived Sample identity from the Run that owns this occurrence. */
  readonly experimentId: ExperimentId;
  /** Logical alignment identity, retained from the durable planned Slot. */
  readonly evalId: EvalId;
  readonly attemptOrdinal: number;
  /** Used only to narrow an already aligned logical Slot. */
  readonly executionIdentityDigest: ExecutionIdentityDigest;
  readonly state: "included" | "not-recorded" | "core-invalid";
  /** Exact Core Member action, or null when no Member document was recorded. */
  readonly action: MembershipAction | null;
  readonly relation?: "origin" | "reference";
  /** Closed evidence identity; selected Record refs never leave the Sample binding. */
  readonly attempt?: AttemptEvidenceIdentity;
}

// These brands are module-local runtime symbols. The interfaces use them for
// nominal typing while the constructors use them as actual computed keys; a
// `declare` symbol would erase the value and fail when this module is loaded.
const populationMembersTypeId: unique symbol = Symbol("niceeval.analysis.PopulationMembers");
const analysisInputTypeId: unique symbol = Symbol("niceeval.analysis.AnalysisInput");
const populationTypeId: unique symbol = Symbol("niceeval.analysis.Population");
const dimensionTypeId: unique symbol = Symbol("niceeval.analysis.Dimension");
const relationTypeId: unique symbol = Symbol("niceeval.analysis.Relation");
const measureTypeId: unique symbol = Symbol("niceeval.analysis.Measure");
const withinAttemptReductionTypeId: unique symbol = Symbol("niceeval.analysis.WithinAttemptReduction");
const withinSlotReductionTypeId: unique symbol = Symbol("niceeval.analysis.WithinSlotReduction");
const acrossSlotsReductionTypeId: unique symbol = Symbol("niceeval.analysis.AcrossSlotsReduction");
const denominatorTypeId: unique symbol = Symbol("niceeval.analysis.Denominator");
const missingPolicyTypeId: unique symbol = Symbol("niceeval.analysis.MissingPolicy");
const evidencePolicyTypeId: unique symbol = Symbol("niceeval.analysis.EvidencePolicy");
const producerPolicyTypeId: unique symbol = Symbol("niceeval.analysis.ProducerPolicy");

/** A NiceEval-published, exhaustive membership rule. There is no public maker. */
export interface PopulationMembers<Member> {
  readonly kind: "population-members";
  readonly id: string;
  readonly [populationMembersTypeId]: (_: Member) => Member;
}

/** A NiceEval-published read-only Record projection. There is no public maker. */
export interface AnalysisInput<Member, Input> {
  readonly kind: "analysis-input";
  readonly id: string;
  readonly population: Population<Member>;
  readonly [analysisInputTypeId]: (_: Input) => Input;
}

export interface Population<Member> {
  readonly kind: "population";
  readonly id: string;
  readonly members: PopulationMembers<Member>;
  readonly [populationTypeId]: (_: Member) => Member;
}

export interface Dimension<Member, Value extends DimensionValue> {
  readonly kind: "dimension";
  readonly id: string;
  readonly population: Population<Member>;
  readonly [dimensionTypeId]: (_: Value) => Value;
}

export type RelationTarget<To> = To;

export interface Relation<From, To> {
  readonly kind: "relation";
  readonly id: string;
  readonly from: Population<From>;
  readonly to: Population<To>;
  readonly cardinality: "one-to-one" | "many-to-one";
  readonly [relationTypeId]: (_: To) => To;
}

export interface WithinAttemptReduction<Input, Value> {
  readonly kind: "within-attempt-reduction";
  readonly [withinAttemptReductionTypeId]: (_: Value) => Value;
  readonly __input?: Input;
}

export interface WithinSlotReduction<Input, Value> {
  readonly kind: "within-slot-reduction";
  readonly [withinSlotReductionTypeId]: (_: Value) => Value;
  readonly __input?: Input;
}

export interface AcrossSlotsReduction<Input, Value> {
  readonly kind: "across-slots-reduction";
  readonly [acrossSlotsReductionTypeId]: (_: Value) => Value;
  readonly __input?: Input;
}

export interface Denominator<Member> {
  readonly kind: "denominator";
  readonly [denominatorTypeId]: (_: Member) => Member;
}

export interface MissingPolicy {
  readonly kind: "missing-policy";
  readonly [missingPolicyTypeId]: true;
}

export interface EvidencePolicy {
  readonly kind: "evidence-policy";
  readonly [evidencePolicyTypeId]: true;
}

export interface ProducerPolicy {
  readonly kind: "producer-policy";
  readonly [producerPolicyTypeId]: true;
}

export interface Measure<Member, Value> {
  readonly kind: "measure";
  readonly id: string;
  readonly population: Population<Member>;
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
  readonly [measureTypeId]: (_: Value) => Value;
}

export interface MeasureOptions<Member, Input, AttemptValue, SlotValue, Value> {
  readonly id: string;
  readonly population: Population<Member>;
  readonly input: AnalysisInput<Member, Input>;
  readonly withinAttempt: WithinAttemptReduction<Input, AttemptValue>;
  readonly withinSlot: WithinSlotReduction<AttemptValue, SlotValue>;
  readonly acrossSlots: AcrossSlotsReduction<SlotValue, Value>;
  readonly denominator: Denominator<Member>;
  readonly missing: MissingPolicy;
  readonly evidence: EvidencePolicy;
  readonly producers?: ProducerPolicy;
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
}

export interface AnalysisDefinitionError extends Error {
  readonly code: "analysis-definition-invalid";
}

type PopulationMembersState<Member> = {
  readonly enumerate: (
    sample: Sample,
  ) => Effect.Effect<readonly Member[], SampleClosedError>;
  readonly key: (member: Member) => string;
};

type AnalysisInputState<Member, Input> = {
  readonly read: (
    sample: Sample,
    member: Member,
  ) => Effect.Effect<SampleInputObservation<Input>, SampleClosedError>;
};

type DimensionState<Member, Value extends DimensionValue> = {
  readonly value: (member: Member) => Value;
};

type RelationState<From, To> = {
  readonly match: (member: From) => RelationTarget<To> | null;
};

export type ReductionKind = "one-value" | "sum" | "latest-completed-attempt" | "mean" | "ratio";

type ReductionState = {
  readonly kind: ReductionKind;
};

type DenominatorState<Member> = {
  readonly members: (values: readonly Member[]) => readonly Member[];
  readonly basis: MetricBasis;
};

type MeasureState<Member, Input, AttemptValue, SlotValue, Value> = {
  readonly input: AnalysisInput<Member, Input>;
  readonly withinAttempt: WithinAttemptReduction<Input, AttemptValue>;
  readonly withinSlot: WithinSlotReduction<AttemptValue, SlotValue>;
  readonly acrossSlots: AcrossSlotsReduction<SlotValue, Value>;
  readonly denominator: Denominator<Member>;
  readonly missing: MissingPolicy;
  readonly evidence: EvidencePolicy;
  readonly producers?: ProducerPolicy;
};

const populationMembersStates = new WeakMap<object, PopulationMembersState<unknown>>();
const populationStates = new WeakMap<object, PopulationIdentity>();
const inputStates = new WeakMap<object, AnalysisInputState<unknown, unknown>>();
const dimensionStates = new WeakMap<object, DimensionState<unknown, DimensionValue>>();
const relationStates = new WeakMap<object, RelationState<unknown, unknown>>();
const reductionStates = new WeakMap<object, ReductionState>();
const denominatorStates = new WeakMap<object, DenominatorState<unknown>>();
const missingPolicies = new WeakSet<object>();
const evidencePolicies = new WeakSet<object>();
const producerPolicies = new WeakSet<object>();
const measureStates = new WeakMap<object, MeasureState<unknown, unknown, unknown, unknown, unknown>>();
const relations: Relation<unknown, unknown>[] = [];

/** @internal Host/catalog-only constructor; intentionally not re-exported by index. */
export function createPopulationMembers<Member>(input: {
  readonly id: string;
  readonly enumerate: (
    sample: Sample,
  ) => Effect.Effect<readonly Member[], SampleClosedError>;
  readonly key: (member: Member) => string;
}): PopulationMembers<Member> {
  requireIdentifier(input.id, "PopulationMembers id");
  if (typeof input.enumerate !== "function" || typeof input.key !== "function") {
    throw definitionError("PopulationMembers must provide enumerate and key functions");
  }
  const members: PopulationMembers<Member> = Object.freeze({
    kind: "population-members",
    id: input.id,
    [populationMembersTypeId]: (member: Member) => member,
  });
  populationMembersStates.set(
    members,
    Object.freeze({ enumerate: input.enumerate, key: input.key }) as PopulationMembersState<unknown>,
  );
  return members;
}

export function definePopulation<Member>(options: {
  readonly id: string;
  readonly members: PopulationMembers<Member>;
}): Population<Member> {
  requireIdentifier(options.id, "Population id");
  populationMembersState(options.members);
  const population: Population<Member> = Object.freeze({
    kind: "population",
    id: options.id,
    members: options.members,
    [populationTypeId]: (member: Member) => member,
  });
  populationStates.set(population, Object.freeze({ kind: "population", id: options.id }));
  return population;
}

export function defineDimension<Member, Value extends DimensionValue>(options: {
  readonly id: string;
  readonly population: Population<Member>;
  readonly value: (member: Member) => Value;
}): Dimension<Member, Value> {
  requireIdentifier(options.id, "Dimension id");
  populationIdentity(options.population);
  if (typeof options.value !== "function") {
    throw definitionError("Dimension value must be a function");
  }
  const dimension: Dimension<Member, Value> = Object.freeze({
    kind: "dimension",
    id: options.id,
    population: options.population,
    [dimensionTypeId]: (value: Value) => value,
  });
  dimensionStates.set(
    dimension,
    Object.freeze({ value: options.value }) as DimensionState<unknown, DimensionValue>,
  );
  return dimension;
}

export function defineRelation<From, To>(options: {
  readonly id: string;
  readonly from: Population<From>;
  readonly to: Population<To>;
  readonly cardinality: "one-to-one" | "many-to-one";
  readonly match: (member: From) => RelationTarget<To> | null;
}): Relation<From, To> {
  requireIdentifier(options.id, "Relation id");
  populationIdentity(options.from);
  populationIdentity(options.to);
  if ((options.from as object) === (options.to as object)) {
    throw definitionError("Relation must connect two distinct Populations");
  }
  if (options.cardinality !== "one-to-one" && options.cardinality !== "many-to-one") {
    throw definitionError("Relation cardinality is not recognized");
  }
  if (typeof options.match !== "function") {
    throw definitionError("Relation match must be a function");
  }
  const relation: Relation<From, To> = Object.freeze({
    kind: "relation",
    id: options.id,
    from: options.from,
    to: options.to,
    cardinality: options.cardinality,
    [relationTypeId]: (target: To) => target,
  });
  relationStates.set(
    relation,
    Object.freeze({ match: options.match }) as RelationState<unknown, unknown>,
  );
  relations.push(relation as Relation<unknown, unknown>);
  return relation;
}

export function defineMeasure<Member, Input, AttemptValue, SlotValue, Value>(
  options: MeasureOptions<Member, Input, AttemptValue, SlotValue, Value>,
): Measure<Member, Value> {
  requireIdentifier(options.id, "Measure id");
  populationIdentity(options.population);
  if (options.input.population.members !== options.population.members) {
    throw definitionError("Measure input must use the Population's published member rule");
  }
  analysisInputState(options.input);
  reductionState(options.withinAttempt);
  reductionState(options.withinSlot);
  reductionState(options.acrossSlots);
  denominatorState(options.denominator);
  if (!missingPolicies.has(options.missing)) throw definitionError("Unknown MissingPolicy");
  if (!evidencePolicies.has(options.evidence)) throw definitionError("Unknown EvidencePolicy");
  if (options.producers !== undefined && !producerPolicies.has(options.producers)) {
    throw definitionError("Unknown ProducerPolicy");
  }
  if (options.better !== undefined && !["higher", "lower", "neutral"].includes(options.better)) {
    throw definitionError("Measure better must be higher, lower, or neutral");
  }
  const measure: Measure<Member, Value> = Object.freeze({
    kind: "measure",
    id: options.id,
    population: options.population,
    ...(options.unit === undefined ? {} : { unit: options.unit }),
    ...(options.format === undefined ? {} : { format: options.format }),
    ...(options.better === undefined ? {} : { better: options.better }),
    [measureTypeId]: (value: Value) => value,
  });
  measureStates.set(
    measure,
    Object.freeze({
      input: options.input,
      withinAttempt: options.withinAttempt,
      withinSlot: options.withinSlot,
      acrossSlots: options.acrossSlots,
      denominator: options.denominator,
      missing: options.missing,
      evidence: options.evidence,
      ...(options.producers === undefined ? {} : { producers: options.producers }),
    }) as MeasureState<unknown, unknown, unknown, unknown, unknown>,
  );
  return measure;
}

export function oneValue<Value>(): WithinAttemptReduction<Value, Value> {
  return reduction<WithinAttemptReduction<Value, Value>>("within-attempt-reduction", "one-value");
}

export function sum(): WithinAttemptReduction<number, number> {
  return reduction<WithinAttemptReduction<number, number>>("within-attempt-reduction", "sum");
}

export function latestCompletedAttempt<Value>(): WithinSlotReduction<Value, Value> {
  return reduction<WithinSlotReduction<Value, Value>>("within-slot-reduction", "latest-completed-attempt");
}

export function mean(): AcrossSlotsReduction<number, number> {
  return reduction<AcrossSlotsReduction<number, number>>("across-slots-reduction", "mean");
}

/** Sums numeric values across the fixed logical-Slot denominator. */
export function sumAcrossSlots(): AcrossSlotsReduction<number, number> {
  return reduction<AcrossSlotsReduction<number, number>>("across-slots-reduction", "sum");
}

export function ratio(): AcrossSlotsReduction<boolean, number> {
  return reduction<AcrossSlotsReduction<boolean, number>>("across-slots-reduction", "ratio");
}

export function allLogicalSlots<Member = LogicalSlot>(): Denominator<Member> {
  const denominator: Denominator<Member> = Object.freeze({
    kind: "denominator",
    [denominatorTypeId]: (member: Member) => member,
  });
  denominatorStates.set(
    denominator,
    Object.freeze({ members: (values: readonly unknown[]) => values, basis: "slot" }),
  );
  return denominator;
}

const partialPolicy: MissingPolicy = Object.freeze({
  kind: "missing-policy",
  [missingPolicyTypeId]: true as const,
});
missingPolicies.add(partialPolicy);

export function partial(): MissingPolicy {
  return partialPolicy;
}

const retainingEvidencePolicy: EvidencePolicy = Object.freeze({
  kind: "evidence-policy",
  [evidencePolicyTypeId]: true as const,
});
evidencePolicies.add(retainingEvidencePolicy);

export function retainContributingEvidence(): EvidencePolicy {
  return retainingEvidencePolicy;
}

const sameProducerPolicy: ProducerPolicy = Object.freeze({
  kind: "producer-policy",
  [producerPolicyTypeId]: true as const,
});
producerPolicies.add(sameProducerPolicy);

export function requireSameProducer(): ProducerPolicy {
  return sameProducerPolicy;
}

/** NiceEval v1 catalog membership. It is exhaustive over currently selected slots. */
export const logicalSlotMembers = createPopulationMembers<LogicalSlot>({
  id: "niceeval.logical-slot-members",
  enumerate: logicalSlotMembersForSample,
  key: (slot) => `${slot.runId}\u0000${slot.slotId}`,
});

const logicalSlotsCatalog = definePopulation({
  id: "niceeval.logical-slots",
  members: logicalSlotMembers,
});

/** The catalog population is useful to built-in inputs; applications may define their own id. */
export const logicalSlots: Population<LogicalSlot> = logicalSlotsCatalog;

function createPublishedInput<
  Input,
  Payload,
  Family extends import("./bindings.ts").FixedFamilyBinding<
    import("./bindings.ts").FixedFamilyOwnerRequirement,
    Payload,
    any
  >,
>(input: PublishedAnalysisInputBinding<Input, Payload, Family>): AnalysisInput<LogicalSlot, Input> {
  const descriptor: AnalysisInput<LogicalSlot, Input> = Object.freeze({
    kind: "analysis-input",
    id: input.id,
    population: logicalSlotsCatalog,
    [analysisInputTypeId]: (value: Input) => value,
  });
  inputStates.set(
    descriptor,
    Object.freeze({
      read: (sample: Sample, member: unknown) =>
        readPublishedInput(sample, input, member as LogicalSlot) as Effect.Effect<
          SampleInputObservation<Input>,
          SampleClosedError
        >,
    }),
  );
  return descriptor;
}

export const attemptPassed = createPublishedInput(publishedAnalysisInputBindings.attemptPassed);

export const attemptLatencyMs = createPublishedInput(publishedAnalysisInputBindings.attemptLatencyMs);

/** Recorded input plus output tokens for one selected logical Slot. */
export const attemptTokens = createPublishedInput(
  publishedAnalysisInputBindings.attemptTokens,
);

export const attemptToolFailure = createPublishedInput(publishedAnalysisInputBindings.attemptToolFailure);

/**
 * @internal A published specialized Measure whose execution is owned by a
 * dedicated Analysis evaluator rather than the generic input/reduction path.
 */
export function createOpaqueMeasure<Member, Value>(input: {
  readonly id: string;
  readonly population: Population<Member>;
  readonly unit?: string;
  readonly format?: MeasureFormat;
  readonly better?: "higher" | "lower" | "neutral";
}): Measure<Member, Value> {
  requireIdentifier(input.id, "Measure id");
  populationIdentity(input.population);
  if (input.better !== undefined && !["higher", "lower", "neutral"].includes(input.better)) {
    throw definitionError("Measure better must be higher, lower, or neutral");
  }
  return Object.freeze({
    kind: "measure" as const,
    id: input.id,
    population: input.population,
    ...(input.unit === undefined ? {} : { unit: input.unit }),
    ...(input.format === undefined ? {} : { format: input.format }),
    ...(input.better === undefined ? {} : { better: input.better }),
    [measureTypeId]: (value: Value) => value,
  });
}

/** @internal Query executor accessors. None is re-exported by niceeval/analysis. */
export function populationMembersState<Member>(
  value: PopulationMembers<Member>,
): PopulationMembersState<Member> {
  const state = populationMembersStates.get(value);
  if (state === undefined) throw definitionError("Unknown PopulationMembers");
  return state as PopulationMembersState<Member>;
}

export function populationIdentity<Member>(value: Population<Member>): PopulationIdentity {
  const identity = populationStates.get(value);
  if (identity === undefined) throw definitionError("Unknown Population");
  return identity;
}

export function analysisInputState<Member, Input>(
  value: AnalysisInput<Member, Input>,
): AnalysisInputState<Member, Input> {
  const state = inputStates.get(value);
  if (state === undefined) throw definitionError("Unknown AnalysisInput");
  return state as AnalysisInputState<Member, Input>;
}

export function dimensionState<Member, Value extends DimensionValue>(
  value: Dimension<Member, Value>,
): DimensionState<Member, Value> {
  const state = dimensionStates.get(value);
  if (state === undefined) throw definitionError("Unknown Dimension");
  return state as DimensionState<Member, Value>;
}

export function relationState<From, To>(
  value: Relation<From, To>,
): RelationState<From, To> {
  const state = relationStates.get(value);
  if (state === undefined) throw definitionError("Unknown Relation");
  return state as RelationState<From, To>;
}

export function registeredRelations(): readonly Relation<unknown, unknown>[] {
  return Object.freeze([...relations]);
}

export function reductionState(value: object): ReductionState {
  const state = reductionStates.get(value);
  if (state === undefined) throw definitionError("Unknown reduction");
  return state;
}

export function denominatorState<Member>(value: Denominator<Member>): DenominatorState<Member> {
  const state = denominatorStates.get(value);
  if (state === undefined) throw definitionError("Unknown Denominator");
  return state as DenominatorState<Member>;
}

export function measureState<Member, Input, AttemptValue, SlotValue, Value>(
  value: Measure<Member, Value>,
): MeasureState<Member, Input, AttemptValue, SlotValue, Value> {
  const state = measureStates.get(value);
  if (state === undefined) throw definitionError("Unknown Measure");
  return state as MeasureState<Member, Input, AttemptValue, SlotValue, Value>;
}

export function producerPolicyIsRequired(value: ProducerPolicy | undefined): boolean {
  return value !== undefined && producerPolicies.has(value);
}

function reduction<Descriptor extends { readonly kind: string }>(
  kind: Descriptor["kind"],
  reductionKind: ReductionKind,
): Descriptor {
  const descriptor = Object.freeze({ kind }) as Descriptor;
  reductionStates.set(descriptor, Object.freeze({ kind: reductionKind }));
  return descriptor;
}

function requireIdentifier(value: string, name: string): void {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw definitionError(`${name} must be a non-empty trimmed string`);
  }
}

function definitionError(message: string): AnalysisDefinitionError {
  const error = new Error(message) as AnalysisDefinitionError;
  Object.defineProperty(error, "code", {
    value: "analysis-definition-invalid" as const,
    enumerable: true,
  });
  return error;
}

export function producerIdentity(id: string): ProducerIdentity {
  requireIdentifier(id, "Producer id");
  return Object.freeze({ id });
}
