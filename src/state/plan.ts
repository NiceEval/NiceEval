import { Data, Effect, Either } from "effect";
import type { Agent } from "../agents/types.ts";
import type { ExperimentStateDefinition } from "./types.ts";
import { isExperimentStateDefinition } from "./definition.ts";

export type PlannedExperimentState =
  | { readonly _tag: "Stateless" }
  | {
      readonly _tag: "Pinned";
      readonly definition: ExperimentStateDefinition;
      readonly revision: string;
      readonly cadence: "attempt" | "window";
    }
  | {
      readonly _tag: "Rolling";
      readonly definition: ExperimentStateDefinition;
      readonly cadence: "attempt" | "window";
      readonly cohortKey: string;
    };

export type StatePlanningCode =
  | "state.invalid-definition"
  | "state.requires-sandbox-agent"
  | "state.rolling-requires-serial"
  | "state.reuse-requires-after-load";

export class StatePlanningError extends Data.TaggedError("StatePlanningError")<{
  readonly code: StatePlanningCode;
  readonly message: string;
}> {}

export const STATELESS: PlannedExperimentState = Object.freeze({ _tag: "Stateless" });

export interface PlanExperimentStateInput {
  readonly state: ExperimentStateDefinition | undefined;
  readonly agent: Agent;
  readonly sandboxReuse: boolean;
  readonly maxConcurrency: number | undefined;
}

export function planExperimentState(
  input: PlanExperimentStateInput,
): Effect.Effect<PlannedExperimentState, StatePlanningError> {
  if (input.state === undefined) return Effect.succeed(STATELESS);
  if (!isExperimentStateDefinition(input.state)) {
    return Effect.fail(new StatePlanningError({
      code: "state.invalid-definition",
      message: "state.invalid-definition: Experiment state must be created by defineExperimentState().",
    }));
  }
  if (input.agent.kind !== "sandbox") {
    return Effect.fail(new StatePlanningError({
      code: "state.requires-sandbox-agent",
      message: "state.requires-sandbox-agent: Experiment State needs a Sandbox Agent because its callbacks operate on the selected Sandbox.",
    }));
  }
  if (input.state.consistency.mode === "rolling" && input.maxConcurrency !== 1) {
    return Effect.fail(new StatePlanningError({
      code: "state.rolling-requires-serial",
      message: "state.rolling-requires-serial: Rolling State requires maxConcurrency: 1.",
    }));
  }
  if (input.sandboxReuse && input.state.saveOn !== "after-load") {
    return Effect.fail(new StatePlanningError({
      code: "state.reuse-requires-after-load",
      message: "state.reuse-requires-after-load: Reused State windows require saveOn: \"after-load\".",
    }));
  }
  const cadence = input.sandboxReuse ? "window" as const : "attempt" as const;
  if (input.state.consistency.mode === "pinned") {
    return Effect.succeed(Object.freeze({
      _tag: "Pinned" as const,
      definition: input.state,
      revision: input.state.consistency.revision,
      cadence,
    }));
  }
  return Effect.succeed(Object.freeze({
    _tag: "Rolling" as const,
    definition: input.state,
    cadence,
    cohortKey: JSON.stringify(input.state.identity),
  }));
}

/** factory / CLI 的同步规划边界；保留 StatePlanningError 本体，不泄漏 Effect FiberFailure 包装。 */
export function planExperimentStateOrThrow(input: PlanExperimentStateInput): PlannedExperimentState {
  const result = Effect.runSync(Effect.either(planExperimentState(input)));
  if (Either.isLeft(result)) throw result.left;
  return result.right;
}
