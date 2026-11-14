import * as Schema from "effect/Schema";
import type { TurnHandle } from "../context/types.ts";

/** Author-provided facts used by a simulated user. */
export interface SimulatedUserDefinition {
  readonly instructions: string;
  /** Answer generation budget; the subsequent Agent Turn uses its normal deadline. */
  readonly timeoutMs?: number;
}

/** One Attempt-local simulated user bound to an Agent Session. */
export interface SimulatedUser<Kind extends "pass" | "score" = "pass" | "score"> {
  reply(turn: TurnHandle<Kind>): Promise<TurnHandle<Kind>>;
}

const Definition = Schema.Struct({
  instructions: Schema.String.check(
    Schema.makeFilter((value) => value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 8192),
  ),
  timeoutMs: Schema.optional(
    Schema.Number.check(Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0)),
  ),
});

/** Defines and freezes the facts a simulated user may use when answering. */
export function defineSimulatedUser(definition: SimulatedUserDefinition): SimulatedUserDefinition {
  if (
    definition === null ||
    typeof definition !== "object" ||
    Array.isArray(definition) ||
    !Object.hasOwn(definition, "instructions") ||
    Reflect.ownKeys(definition).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(definition, key)!;
      return (
        typeof key !== "string" ||
        !["instructions", "timeoutMs"].includes(key) ||
        !("value" in descriptor) ||
        !descriptor.enumerable
      );
    })
  )
    throw new TypeError(
      "Invalid simulated user definition: only data properties instructions and timeoutMs are accepted.",
    );
  return Object.freeze(Schema.decodeUnknownSync(Definition, { onExcessProperty: "error" })(definition));
}

export class SimulatedUserError extends Error {
  readonly phase = "eval.run";
  readonly retryable = false;
  readonly scope = "attempt";
  constructor(
    readonly code: "simulated-user-invalid-turn" | "simulated-user-unsupported-provider" | "simulated-user-failed",
    readonly reason: string,
  ) {
    super(`${code}: ${reason}`);
    this.name = "SimulatedUserError";
  }
}
