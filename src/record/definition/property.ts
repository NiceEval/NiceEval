import type { Schema } from "effect";

const recordPropertyTypeId: unique symbol = Symbol("@niceeval/record/RecordProperty");

/** A stable internal token; `id`, TS field, and durable key deliberately differ. */
export interface RecordProperty<
  out Id extends string = string,
  out DurableKey extends string = string,
  out ValueSchema extends Schema.Schema.AnyNoContext = Schema.Schema.AnyNoContext,
> {
  readonly id: Id;
  readonly durableKey: DurableKey;
  readonly schema: ValueSchema;
  readonly [recordPropertyTypeId]: () => void;
}

export type AnyRecordProperty = RecordProperty<
  string,
  string,
  Schema.Schema.AnyNoContext
>;

export type RecordPropertyValue<Property extends AnyRecordProperty> =
  Property extends RecordProperty<string, string, infer ValueSchema>
    ? Schema.Schema.Type<ValueSchema>
    : never;

export function defineRecordProperty<
  const Id extends string,
  const DurableKey extends string,
  const ValueSchema extends Schema.Schema.AnyNoContext,
>(input: {
  readonly id: Id;
  readonly durableKey: DurableKey;
  readonly schema: ValueSchema;
}): RecordProperty<Id, DurableKey, ValueSchema> {
  if (input.id.length === 0 || input.durableKey.length === 0) {
    throw new TypeError("Record property id and durableKey must both be non-empty");
  }
  return Object.freeze({
    id: input.id,
    durableKey: input.durableKey,
    schema: input.schema,
    [recordPropertyTypeId]: () => undefined,
  }) as RecordProperty<Id, DurableKey, ValueSchema>;
}

export function isRecordProperty(value: unknown): value is AnyRecordProperty {
  return typeof value === "object" && value !== null && recordPropertyTypeId in value;
}
