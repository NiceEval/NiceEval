import { Schema } from "effect";

/** A model selected for one application-defined purpose. */
export interface ModelSlotSelection {
  readonly model: string;
  readonly reasoningEffort?: string;
}

/** Frozen selection; null preserves an unspecified native default. */
export interface ResolvedModelSlot {
  readonly model: string | null;
  readonly reasoningEffort: string | null;
}
export type ResolvedModelSlots = Readonly<Record<string, ResolvedModelSlot>>;

const modelText = Schema.String.check(Schema.isPattern(/\S/u));
const slotKey = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$(?![\s\S])/u));
const selections = Schema.Record(slotKey, Schema.Struct({
  model: modelText,
  reasoningEffort: Schema.optionalKey(modelText),
})).check(Schema.makeFilter((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 64));

export const ResolvedModelSlotsSchema: Schema.Codec<ResolvedModelSlots> = Schema.Record(slotKey, Schema.Struct({
  model: Schema.NullOr(modelText),
  reasoningEffort: Schema.NullOr(modelText),
})).check(Schema.makeFilter((value) => Object.keys(value).length <= 64));

/** Only the definition boundary interprets author syntax. Downstream owners pass this value through. */
export function normalizeModelSlots(input: {
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly models?: Readonly<Record<string, ModelSlotSelection>>;
}): ResolvedModelSlots {
  if (input.models !== undefined) {
    if (input.model !== undefined || input.reasoningEffort !== undefined) {
      throw new TypeError("Experiment models cannot be combined with model or reasoningEffort.");
    }
    const decoded = Schema.decodeUnknownSync(selections, { onExcessProperty: "error" })(input.models);
    return Object.freeze(Object.fromEntries(Object.keys(decoded).sort().map((key) => {
      const value = decoded[key]!;
      return [key, Object.freeze({ model: value.model, reasoningEffort: value.reasoningEffort ?? null })];
    })));
  }
  if (input.model === undefined && input.reasoningEffort === undefined) return Object.freeze({});
  return Object.freeze({ default: Object.freeze({
    model: input.model === undefined ? null : Schema.decodeUnknownSync(modelText)(input.model),
    reasoningEffort: input.reasoningEffort === undefined ? null : Schema.decodeUnknownSync(modelText)(input.reasoningEffort),
  }) });
}
