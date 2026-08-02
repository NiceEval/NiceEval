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
  | "state.reuse-requires-serial"
  | "state.reuse-requires-after-load";

export class StatePlanningError extends Data.TaggedError("StatePlanningError")<{
  readonly code: StatePlanningCode;
  readonly message: string;
}> {}

export const STATELESS: PlannedExperimentState = Object.freeze({ _tag: "Stateless" });

export type StateDeclaration =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Declared"; readonly definition: ExperimentStateDefinition };

export type StateSandboxMode =
  | { readonly _tag: "Fresh" }
  | { readonly _tag: "Reuse" };

export type StateConcurrencyLimit =
  | { readonly _tag: "Unbounded" }
  | { readonly _tag: "Limited"; readonly value: number };

export const STATE_ABSENT: StateDeclaration = Object.freeze({ _tag: "Absent" });
export const STATE_FRESH: StateSandboxMode = Object.freeze({ _tag: "Fresh" });
export const STATE_REUSE: StateSandboxMode = Object.freeze({ _tag: "Reuse" });
export const STATE_CONCURRENCY_UNBOUNDED: StateConcurrencyLimit = Object.freeze({ _tag: "Unbounded" });

/**
 * 领域 ADT 只接收已验证的 Definition；调用者若持有外部动态值，必须先经过
 * decodeStateDeclaration()，不能把 unknown 带入规划阶段。
 */
export function declaredState(definition: ExperimentStateDefinition): StateDeclaration {
  return Object.freeze({ _tag: "Declared", definition });
}

/** 外部动态 State 值进入规划层的唯一解码边界。 */
export function decodeStateDeclaration(
  definition: unknown,
): Effect.Effect<StateDeclaration, StatePlanningError> {
  if (!isExperimentStateDefinition(definition)) {
    return Effect.fail(new StatePlanningError({
      code: "state.invalid-definition",
      message: "state.invalid-definition: Experiment state must be created by defineExperimentState().",
    }));
  }
  return Effect.succeed(declaredState(definition));
}

export function limitedStateConcurrency(value: number): StateConcurrencyLimit {
  return Object.freeze({ _tag: "Limited", value });
}

export interface PlanExperimentStateInput {
  readonly state: StateDeclaration;
  readonly agent: Agent;
  readonly sandbox: StateSandboxMode;
  readonly concurrency: StateConcurrencyLimit;
}

export function planExperimentState(
  input: PlanExperimentStateInput,
): Effect.Effect<PlannedExperimentState, StatePlanningError> {
  if (input.state._tag === "Absent") return Effect.succeed(STATELESS);
  const definition = input.state.definition;
  if (input.agent.kind !== "sandbox") {
    return Effect.fail(new StatePlanningError({
      code: "state.requires-sandbox-agent",
      message: "state.requires-sandbox-agent: Experiment State needs a Sandbox Agent because its callbacks operate on the selected Sandbox.",
    }));
  }
  if (
    definition.consistency.mode === "rolling" &&
    (input.concurrency._tag !== "Limited" || input.concurrency.value !== 1)
  ) {
    return Effect.fail(new StatePlanningError({
      code: "state.rolling-requires-serial",
      message: "state.rolling-requires-serial: Rolling State requires maxConcurrency: 1.",
    }));
  }
  if (
    input.sandbox._tag === "Reuse" &&
    (input.concurrency._tag !== "Limited" || input.concurrency.value !== 1)
  ) {
    return Effect.fail(new StatePlanningError({
      code: "state.reuse-requires-serial",
      message:
        "state.reuse-requires-serial: State with sandboxReuse requires maxConcurrency: 1 so every physical window " +
        "has one ordered load/save sequence and can close before its final author cleanup.",
    }));
  }
  if (input.sandbox._tag === "Reuse" && definition.saveOn !== "after-load") {
    return Effect.fail(new StatePlanningError({
      code: "state.reuse-requires-after-load",
      message: "state.reuse-requires-after-load: Reused State windows require saveOn: \"after-load\".",
    }));
  }
  const cadence = input.sandbox._tag === "Reuse" ? "window" as const : "attempt" as const;
  if (definition.consistency.mode === "pinned") {
    return Effect.succeed(Object.freeze({
      _tag: "Pinned" as const,
      definition,
      revision: definition.consistency.revision,
      cadence,
    }));
  }
  return Effect.succeed(Object.freeze({
    _tag: "Rolling" as const,
    definition,
    cadence,
    cohortKey: JSON.stringify(definition.identity),
  }));
}

/** factory / CLI 的同步规划边界；保留 StatePlanningError 本体，不泄漏 Effect FiberFailure 包装。 */
export function planExperimentStateOrThrow(input: PlanExperimentStateInput): PlannedExperimentState {
  const result = Effect.runSync(Effect.either(planExperimentState(input)));
  if (Either.isLeft(result)) throw result.left;
  return result.right;
}
