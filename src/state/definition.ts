import { Data, Effect, Either, Schema } from "effect";
import type { JsonValue } from "../shared/types.ts";
import {
  EXPERIMENT_STATE_DEFINITION,
  type ExperimentStateDefinition,
  type ExperimentStateInput,
  type ExperimentStateProjection,
} from "./types.ts";

type DecodedJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly DecodedJsonValue[]
  | { readonly [key: string]: DecodedJsonValue };

const StateJsonValue: Schema.Schema<DecodedJsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.String,
    Schema.JsonNumber,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(StateJsonValue),
    Schema.Record({ key: Schema.String, value: StateJsonValue }),
  ),
);

export class ExperimentStateDefinitionError extends Data.TaggedError("ExperimentStateDefinitionError")<{
  readonly code:
    | "state.identity-not-json"
    | "state.identity-incomplete"
    | "state.pinned-revision-missing"
    | "state.consistency-invalid"
    | "state.save-policy-invalid"
    | "state.callback-invalid";
  readonly message: string;
}> {}

const DEFINITIONS = new WeakSet<object>();

/** @internal Schema 的 readonly decode 形状转成公共 JsonValue；唯一动态边界已由 Schema 验证。 */
export function stateJsonValueOf(decoded: DecodedJsonValue): JsonValue {
  if (Array.isArray(decoded)) return decoded.map(stateJsonValueOf);
  if (typeof decoded === "object" && decoded !== null) {
    return Object.fromEntries(Object.entries(decoded).map(([key, value]) => [key, stateJsonValueOf(value)]));
  }
  return decoded as string | number | boolean | null;
}

function decodeIdentity(identity: unknown): Effect.Effect<JsonValue, ExperimentStateDefinitionError> {
  return Schema.decodeUnknown(StateJsonValue)(identity).pipe(
    Effect.mapError(() => new ExperimentStateDefinitionError({
      code: "state.identity-not-json",
      message: "state.identity-not-json: State identity must be a finite JSON value without undefined, functions, symbols, class instances, or cycles.",
    })),
    Effect.flatMap((decoded) => {
      if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded)) {
        return Effect.fail(new ExperimentStateDefinitionError({
          code: "state.identity-incomplete",
          message: "state.identity-incomplete: State identity must be an object with non-empty store and cohort strings and a non-negative integer schema.",
        }));
      }
      const store = decoded.store;
      const cohort = decoded.cohort;
      const schema = decoded.schema;
      if (
        typeof store !== "string" || store.trim() === "" ||
        typeof cohort !== "string" || cohort.trim() === "" ||
        typeof schema !== "number" || !Number.isInteger(schema) || schema < 0
      ) {
        return Effect.fail(new ExperimentStateDefinitionError({
          code: "state.identity-incomplete",
          message: "state.identity-incomplete: State identity must be an object with non-empty store and cohort strings and a non-negative integer schema.",
        }));
      }
      return Effect.succeed(stateJsonValueOf(decoded));
    }),
  );
}

function decodeIdentityOrThrow(identity: JsonValue): JsonValue {
  try {
    const result = Effect.runSync(Effect.either(decodeIdentity(identity)));
    if (Either.isLeft(result)) throw result.left;
    return result.right;
  } catch (error) {
    if (error instanceof ExperimentStateDefinitionError) throw error;
    // Effect Schema 对循环对象可能以 decoder defect 终止；公共动态边界仍收束成同一个领域错误。
    throw new ExperimentStateDefinitionError({
      code: "state.identity-not-json",
      message: "state.identity-not-json: State identity must be a finite JSON value without undefined, functions, symbols, class instances, or cycles.",
    });
  }
}

/** @internal Schema decode 后的 JSON 值在进入 Definition / Record 前统一深冻结。 */
export function freezeStateJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    const frozen = value.map(freezeStateJson);
    Object.freeze(frozen);
    return frozen;
  }
  if (typeof value === "object" && value !== null) {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeStateJson(item)])));
  }
  return value;
}

export function defineExperimentState(input: ExperimentStateInput): ExperimentStateDefinition {
  const identity = freezeStateJson(decodeIdentityOrThrow(input.identity));
  if (input.consistency.mode !== "pinned" && input.consistency.mode !== "rolling") {
    throw new ExperimentStateDefinitionError({
      code: "state.consistency-invalid",
      message: "state.consistency-invalid: State consistency must be exactly pinned or rolling.",
    });
  }
  if (input.consistency.mode === "pinned" && input.consistency.revision.trim() === "") {
    throw new ExperimentStateDefinitionError({
      code: "state.pinned-revision-missing",
      message: "state.pinned-revision-missing: Pinned State requires a non-empty external revision.",
    });
  }
  if (input.saveOn !== "after-load" && input.saveOn !== "attempt-succeeded") {
    throw new ExperimentStateDefinitionError({
      code: "state.save-policy-invalid",
      message: "state.save-policy-invalid: State saveOn must be exactly after-load or attempt-succeeded.",
    });
  }
  if (typeof input.load !== "function" || typeof input.save !== "function") {
    throw new ExperimentStateDefinitionError({
      code: "state.callback-invalid",
      message: "state.callback-invalid: State load and save must both be Promise callbacks.",
    });
  }
  const consistency = Object.freeze({ ...input.consistency });
  const definition: ExperimentStateDefinition = {
    identity,
    consistency,
    saveOn: input.saveOn,
    load: input.load,
    save: input.save,
    [EXPERIMENT_STATE_DEFINITION]: true,
  };
  Object.freeze(definition);
  DEFINITIONS.add(definition);
  return definition;
}

export function isExperimentStateDefinition(value: unknown): value is ExperimentStateDefinition {
  return typeof value === "object" && value !== null && DEFINITIONS.has(value);
}

export function experimentStateProjection(definition: ExperimentStateDefinition): ExperimentStateProjection {
  return Object.freeze({
    identity: definition.identity,
    consistency: definition.consistency,
    saveOn: definition.saveOn,
  });
}

export const StateCheckpointSchema = Schema.Struct({
  identity: StateJsonValue,
  digest: Schema.optional(Schema.NonEmptyString),
  facts: Schema.Record({ key: Schema.String, value: StateJsonValue }),
});
