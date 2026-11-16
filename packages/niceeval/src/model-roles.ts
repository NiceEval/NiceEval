import * as Schema from "effect/Schema";

/** A model selected for one application-defined purpose. */
export interface ModelRoleSelection {
  readonly model: string;
  readonly reasoningEffort?: string | undefined;
}

/** Frozen callback selection; undefined preserves an unspecified native default. */
export interface ResolvedModelRole {
  readonly model: string | undefined;
  readonly reasoningEffort: string | undefined;
}
/** Provides readonly application model selections indexed by role; these are application models rather than Judge Provider settings. */
export type ResolvedModelRoles = Readonly<Record<string, ResolvedModelRole>>;

/** JSON and identity boundary: both nullable fields are always present. */
export interface ModelRoleWire {
  readonly model: string | null;
  readonly reasoningEffort: string | null;
}
export type ModelRolesWire = Readonly<Record<string, ModelRoleWire>>;

/** Preserve role insertion order and explicit nulls in historical identity material. */
export function modelRolesToWire(models: ResolvedModelRoles): ModelRolesWire {
  return Object.fromEntries(
    Object.entries(models).map(([role, value]) => [
      role,
      { model: value.model ?? null, reasoningEffort: value.reasoningEffort ?? null },
    ]),
  );
}

/** Decode trusted JSON selections only when entering an internal consumer. */
export function modelRolesFromWire(models: ModelRolesWire): ResolvedModelRoles {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(models).map(([role, value]) => [
        role,
        Object.freeze({ model: value.model ?? undefined, reasoningEffort: value.reasoningEffort ?? undefined }),
      ]),
    ),
  );
}

const modelText = Schema.String.check(Schema.isPattern(/\S/u));
const roleKey = Schema.String.check(Schema.isPattern(/^[A-Za-z][A-Za-z0-9_-]{0,63}$(?![\s\S])/u));
const selections = Schema.Record(
  roleKey,
  Schema.Struct({
    model: modelText,
    reasoningEffort: Schema.optional(modelText),
  }),
).check(Schema.makeFilter((value) => Object.keys(value).length > 0 && Object.keys(value).length <= 64));

export interface ModelRequirements<Keys extends string = string> {
  readonly models: Readonly<Record<Keys, ModelRoleSelection>>;
}

/** Share immutable model purposes without binding an Eval to one Experiment. */
export function defineModelRoles<const Keys extends string>(
  input: Readonly<Record<Keys, ModelRoleSelection>>,
): Readonly<Record<Keys, ModelRoleSelection>> {
  const decoded = Schema.decodeUnknownSync(selections, { onExcessProperty: "error" })(input);
  return Object.freeze(
    Object.fromEntries(
      Object.keys(decoded)
        .sort()
        .map((key) => [key, Object.freeze({ ...decoded[key]! })]),
    ),
  ) as Readonly<Record<Keys, ModelRoleSelection>>;
}

export function normalizeModelRequirements(value: unknown): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const decoded = Schema.decodeUnknownSync(Schema.Struct({ models: selections }), { onExcessProperty: "error" })(value);
  return Object.keys(decoded.models).sort();
}

export function assertRequiredModelRoles(
  required: readonly string[] | undefined,
  models: ResolvedModelRoles | undefined,
  subject: string,
): void {
  const missing = required?.filter((key) => !Object.hasOwn(models ?? {}, key)) ?? [];
  if (missing.length > 0) throw new TypeError(`${subject} requires undeclared model roles: ${missing.join(", ")}.`);
}

export const ModelRolesWireSchema: Schema.Codec<ModelRolesWire> = Schema.Record(
  roleKey,
  Schema.Struct({
    model: Schema.NullOr(modelText),
    reasoningEffort: Schema.NullOr(modelText),
  }),
).check(Schema.makeFilter((value) => Object.keys(value).length <= 64));

/** Only the definition boundary interprets author syntax. Downstream owners pass this value through. */
export function normalizeModelRoles(input: {
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
  readonly models?: Readonly<Record<string, ModelRoleSelection>> | undefined;
}): ResolvedModelRoles {
  if (input.models !== undefined) {
    if (input.model !== undefined || input.reasoningEffort !== undefined) {
      throw new TypeError("Experiment models cannot be combined with model or reasoningEffort.");
    }
    const decoded = Schema.decodeUnknownSync(selections, { onExcessProperty: "error" })(input.models);
    return Object.freeze(
      Object.fromEntries(
        Object.keys(decoded)
          .sort()
          .map((key) => {
            const value = decoded[key]!;
            return [key, Object.freeze({ model: value.model, reasoningEffort: value.reasoningEffort })];
          }),
      ),
    );
  }
  if (input.model === undefined && input.reasoningEffort === undefined) return Object.freeze({});
  return Object.freeze({
    default: Object.freeze({
      model: input.model === undefined ? undefined : Schema.decodeUnknownSync(modelText)(input.model),
      reasoningEffort:
        input.reasoningEffort === undefined ? undefined : Schema.decodeUnknownSync(modelText)(input.reasoningEffort),
    }),
  });
}
