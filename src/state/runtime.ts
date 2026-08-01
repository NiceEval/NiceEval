import { Clock, Data, Effect, Option, Ref, Schema } from "effect";
import type { SandboxCommandTarget } from "../sandbox/commands.ts";
import { freezeStateJson, StateCheckpointSchema, stateJsonValueOf } from "./definition.ts";
import type { PlannedExperimentState } from "./plan.ts";
import type {
  ExperimentStateContext,
  StateCheckpoint,
  StateTransferActivity,
  StateWindowRecord,
} from "./types.ts";

export type ExternalErrorCode =
  | { readonly _tag: "CodeAbsent" }
  | { readonly _tag: "Code"; readonly value: string };

export type ExternalErrorStack =
  | { readonly _tag: "StackAbsent" }
  | { readonly _tag: "Stack"; readonly value: string };

export interface ExternalStateCause {
  readonly _tag: "ExternalCause";
  readonly name: string;
  readonly code: ExternalErrorCode;
  readonly message: string;
  readonly stack: ExternalErrorStack;
}

export type StateFailureEvidence =
  | { readonly _tag: "External"; readonly cause: ExternalStateCause }
  | { readonly _tag: "ContractViolation"; readonly expected: string; readonly actual: string }
  | {
      readonly _tag: "TransferUnavailable";
      readonly reason: "sandbox-lost" | "provider-unreachable" | "deadline-exceeded";
    };

type StateLoadFailureKind = "callback" | "invalid-checkpoint" | "revision-mismatch" | "unavailable";
type StateSaveFailureKind = "callback" | "invalid-checkpoint" | "unavailable";

export class StateLoadFailure extends Data.TaggedError("StateLoadFailure")<{
  readonly phase: "state.load";
  readonly kind: StateLoadFailureKind;
  readonly code: string;
  readonly message: string;
  readonly evidence: StateFailureEvidence;
}> {}

export class StateSaveFailure extends Data.TaggedError("StateSaveFailure")<{
  readonly phase: "state.save";
  readonly kind: StateSaveFailureKind;
  readonly code: string;
  readonly message: string;
  readonly evidence: StateFailureEvidence;
}> {}

export type StateFailure = StateLoadFailure | StateSaveFailure;

function externalErrorCode(value: unknown): ExternalErrorCode {
  return typeof value === "string" && value.trim() !== ""
    ? { _tag: "Code", value }
    : { _tag: "CodeAbsent" };
}

function externalErrorStack(value: unknown): ExternalErrorStack {
  return typeof value === "string" && value !== ""
    ? { _tag: "Stack", value }
    : { _tag: "StackAbsent" };
}

/** Promise throwable 在这一瞬间被消费；unknown 从不进入 State ADT。 */
function normalizeExternalCause(value: unknown): ExternalStateCause {
  if (typeof value !== "object" || value === null) {
    return {
      _tag: "ExternalCause",
      name: "ThrownValue",
      code: { _tag: "CodeAbsent" },
      message: String(value),
      stack: { _tag: "StackAbsent" },
    };
  }
  const candidate = value as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown };
  const constructorName = Object.getPrototypeOf(value)?.constructor?.name;
  return {
    _tag: "ExternalCause",
    name: typeof candidate.name === "string" && candidate.name !== ""
      ? candidate.name
      : typeof constructorName === "string" && constructorName !== "" ? constructorName : "Error",
    code: externalErrorCode(candidate.code),
    message: typeof candidate.message === "string" ? candidate.message : String(value),
    stack: externalErrorStack(candidate.stack),
  };
}

function decodedCheckpoint(value: Schema.Schema.Type<typeof StateCheckpointSchema>): StateCheckpoint {
  return Object.freeze({
    identity: freezeStateJson(stateJsonValueOf(value.identity)),
    digest: Object.freeze(value.digest),
    facts: Object.freeze(Object.fromEntries(
      Object.entries(value.facts).map(([key, item]) => [key, freezeStateJson(stateJsonValueOf(item))]),
    )),
  });
}

function loadCheckpointEffect(value: unknown): Effect.Effect<StateCheckpoint, StateLoadFailure> {
  return Schema.decodeUnknown(StateCheckpointSchema)(value).pipe(
    Effect.map(decodedCheckpoint),
    Effect.mapError((parseError) => new StateLoadFailure({
      phase: "state.load",
      kind: "invalid-checkpoint",
      code: "state.load.invalid-checkpoint",
      message: "state.load.invalid-checkpoint: load() must return a checkpoint with JSON identity, explicit digest, and JSON facts.",
      evidence: {
        _tag: "ContractViolation",
        expected: "StateCheckpoint with JSON identity, explicit digest ADT, and JSON facts",
        actual: String(parseError),
      },
    })),
  );
}

function saveCheckpointEffect(value: unknown): Effect.Effect<StateCheckpoint, StateSaveFailure> {
  return Schema.decodeUnknown(StateCheckpointSchema)(value).pipe(
    Effect.map(decodedCheckpoint),
    Effect.mapError((parseError) => new StateSaveFailure({
      phase: "state.save",
      kind: "invalid-checkpoint",
      code: "state.save.invalid-checkpoint",
      message: "state.save.invalid-checkpoint: save() must return a checkpoint with JSON identity, explicit digest, and JSON facts.",
      evidence: {
        _tag: "ContractViolation",
        expected: "StateCheckpoint with JSON identity, explicit digest ADT, and JSON facts",
        actual: String(parseError),
      },
    })),
  );
}

function checkpointRevision(identity: StateCheckpoint["identity"]): Option.Option<string> {
  if (typeof identity === "string") return Option.some(identity);
  if (typeof identity !== "object" || identity === null || Array.isArray(identity)) return Option.none();
  return typeof identity.revision === "string" ? Option.some(identity.revision) : Option.none();
}

export interface StateRuntimeEnvironment {
  readonly sandbox: SandboxCommandTarget;
  progress(input: { readonly message: string }): void;
  diagnostic(input: { readonly code: string; readonly message: string }): void;
  fact(key: string, value: string | number | boolean): void;
}

export interface BoundedStateFinalizer {
  readonly _tag: "Bounded";
  readonly timeoutMs: number;
}

function stateContext(
  phase: "load" | "save",
  experimentId: string,
  windowId: string,
  environment: StateRuntimeEnvironment,
  signal: AbortSignal,
): ExperimentStateContext {
  return Object.freeze({
    phase,
    experimentId,
    windowId,
    sandbox: environment.sandbox,
    signal,
    progress: environment.progress,
    diagnostic: environment.diagnostic,
    fact: environment.fact,
  });
}

export function loadExperimentState(
  plan: Exclude<PlannedExperimentState, { readonly _tag: "Stateless" }>,
  experimentId: string,
  windowId: string,
  environment: StateRuntimeEnvironment,
): Effect.Effect<StateCheckpoint, StateLoadFailure> {
  return Effect.tryPromise({
    try: (signal) => plan.definition.load(stateContext("load", experimentId, windowId, environment, signal)),
    catch: (throwable) => {
      const cause = normalizeExternalCause(throwable);
      return new StateLoadFailure({
        phase: "state.load",
        kind: "callback",
        code: "state.load.callback",
        message: `state.load.callback: ${cause.message}`,
        evidence: { _tag: "External", cause },
      });
    },
  }).pipe(
    Effect.flatMap(loadCheckpointEffect),
    Effect.flatMap((checkpoint) => {
      if (plan._tag !== "Pinned") return Effect.succeed(checkpoint);
      const actual = checkpointRevision(checkpoint.identity);
      if (Option.isSome(actual) && actual.value === plan.revision) return Effect.succeed(checkpoint);
      return Effect.fail(new StateLoadFailure({
        phase: "state.load",
        kind: "revision-mismatch",
        code: "state.pinned-revision-mismatch",
        message:
          `state.pinned-revision-mismatch: expected revision ${JSON.stringify(plan.revision)}, ` +
          `but load() returned identity ${JSON.stringify(checkpoint.identity)}.`,
        evidence: {
          _tag: "ContractViolation",
          expected: `checkpoint revision ${JSON.stringify(plan.revision)}`,
          actual: JSON.stringify(checkpoint.identity),
        },
      }));
    }),
  );
}

export function saveExperimentState(
  plan: Exclude<PlannedExperimentState, { readonly _tag: "Stateless" }>,
  experimentId: string,
  windowId: string,
  environment: StateRuntimeEnvironment,
  finalizer: BoundedStateFinalizer,
): Effect.Effect<StateCheckpoint, StateSaveFailure> {
  const callback = Effect.tryPromise({
    // tryPromise 为这条 Effect fiber 创建新 signal；不复用已经 abort 的 load / Attempt signal。
    try: (signal) => plan.definition.save(stateContext("save", experimentId, windowId, environment, signal)),
    catch: (throwable) => {
      const cause = normalizeExternalCause(throwable);
      return new StateSaveFailure({
        phase: "state.save",
        kind: "callback",
        code: "state.save.callback",
        message: `state.save.callback: ${cause.message}`,
        evidence: { _tag: "External", cause },
      });
    },
  }).pipe(Effect.flatMap(saveCheckpointEffect));

  return callback.pipe(Effect.timeoutFail({
    duration: finalizer.timeoutMs,
    onTimeout: () => new StateSaveFailure({
      phase: "state.save",
      kind: "unavailable",
      code: "state.save.deadline-exceeded",
      message: `state.save.deadline-exceeded: State save exceeded its ${finalizer.timeoutMs}ms finalizer budget.`,
      evidence: { _tag: "TransferUnavailable", reason: "deadline-exceeded" },
    }),
  }));
}

function activityForFailure(failure: StateFailure, durationMs: number): StateTransferActivity {
  if (
    failure.kind === "unavailable" && failure.evidence._tag === "TransferUnavailable"
  ) {
    return { outcome: "unavailable", reason: failure.evidence.reason, durationMs };
  }
  return { outcome: "failed", code: failure.code, message: failure.message, durationMs };
}

type WindowStatus =
  | { readonly _tag: "Pending" }
  | { readonly _tag: "Loading" }
  | { readonly _tag: "LoadInterrupted" }
  | { readonly _tag: "Loaded"; readonly activity: StateTransferActivity }
  | { readonly _tag: "LoadFailed"; readonly activity: StateTransferActivity; readonly failure: StateLoadFailure }
  | { readonly _tag: "Finalizing"; readonly load: StateTransferActivity }
  | { readonly _tag: "Finalized"; readonly record: StateWindowRecord };

export type StateWindowSnapshot =
  | { readonly _tag: "Open"; readonly stage: "pending" | "loading" | "load-interrupted" | "loaded" | "load-failed" | "finalizing" }
  | { readonly _tag: "Finalized"; readonly record: StateWindowRecord };

export type StateLoadTransition =
  | { readonly _tag: "Loaded"; readonly activity: StateTransferActivity }
  | { readonly _tag: "AlreadyLoaded"; readonly activity: StateTransferActivity };

export type AttemptCompletion =
  | { readonly _tag: "Succeeded" }
  | { readonly _tag: "VerdictNotPassed"; readonly verdict: "failed" | "errored" | "skipped" }
  | {
      readonly _tag: "AgentTeardownFailed";
      readonly verdict: "passed" | "failed" | "errored" | "skipped";
    };

export interface StateWindowFinalizerInput {
  readonly completion: AttemptCompletion;
  readonly budget: BoundedStateFinalizer;
}

export class StateWindowTransitionFailure extends Data.TaggedError("StateWindowTransitionFailure")<{
  readonly operation: "load" | "finalize";
  readonly state: WindowStatus["_tag"];
  readonly message: string;
}> {}

export class ExperimentStateSequenceFailure extends Data.TaggedError("ExperimentStateSequenceFailure")<{
  readonly activity: StateTransferActivity;
  readonly failure: StateFailure;
}> {
  /** State 序列失去已知 head 后，剩余 attempt 不能继续从未知状态派发。 */
  readonly class = Object.freeze({ retryable: false as const, scope: "experiment" as const });
}

type LoadDecision =
  | { readonly _tag: "Start" }
  | { readonly _tag: "Existing"; readonly activity: StateTransferActivity }
  | { readonly _tag: "PriorFailure"; readonly activity: StateTransferActivity; readonly failure: StateLoadFailure }
  | { readonly _tag: "InvalidTransition"; readonly state: WindowStatus["_tag"] };

type FinalizeDecision =
  | { readonly _tag: "FinalizeWithoutSave"; readonly load: StateTransferActivity }
  | { readonly _tag: "FinalizeLoaded"; readonly load: StateTransferActivity }
  | { readonly _tag: "Existing"; readonly record: StateWindowRecord }
  | { readonly _tag: "InvalidTransition"; readonly state: WindowStatus["_tag"] };

export class ExperimentStateWindow {
  private constructor(
    readonly plan: Exclude<PlannedExperimentState, { readonly _tag: "Stateless" }>,
    readonly experimentId: string,
    readonly windowId: string,
    private readonly status: Ref.Ref<WindowStatus>,
  ) {}

  static make(
    plan: Exclude<PlannedExperimentState, { readonly _tag: "Stateless" }>,
    experimentId: string,
    windowId: string,
  ): Effect.Effect<ExperimentStateWindow> {
    return Ref.make<WindowStatus>({ _tag: "Pending" }).pipe(
      Effect.map((status) => new ExperimentStateWindow(plan, experimentId, windowId, status)),
    );
  }

  needsLoad(): Effect.Effect<boolean> {
    return Ref.get(this.status).pipe(Effect.map((status) => status._tag === "Pending"));
  }

  load(
    environment: StateRuntimeEnvironment,
  ): Effect.Effect<StateLoadTransition, ExperimentStateSequenceFailure | StateWindowTransitionFailure> {
    return Effect.gen(this, function* () {
      const decision = yield* Ref.modify(this.status, (status): readonly [LoadDecision, WindowStatus] => {
        switch (status._tag) {
          case "Pending":
            return [{ _tag: "Start" }, { _tag: "Loading" }];
          case "Loaded":
            return [{ _tag: "Existing", activity: status.activity }, status];
          case "LoadFailed":
            return [{ _tag: "PriorFailure", activity: status.activity, failure: status.failure }, status];
          default:
            return [{ _tag: "InvalidTransition", state: status._tag }, status];
        }
      });
      if (decision._tag === "Existing") return { _tag: "AlreadyLoaded", activity: decision.activity } as const;
      if (decision._tag === "PriorFailure") {
        return yield* new ExperimentStateSequenceFailure({
          activity: decision.activity,
          failure: decision.failure,
        });
      }
      if (decision._tag === "InvalidTransition") {
        return yield* new StateWindowTransitionFailure({
          operation: "load",
          state: decision.state,
          message: `State window ${this.windowId} cannot load while ${decision.state}.`,
        });
      }

      const startedAt = yield* Clock.currentTimeMillis;
      const transition = loadExperimentState(this.plan, this.experimentId, this.windowId, environment).pipe(
        Effect.flatMap((checkpoint) => Effect.gen(this, function* () {
          const durationMs = Math.max(0, (yield* Clock.currentTimeMillis) - startedAt);
          const activity: StateTransferActivity = { outcome: "succeeded", checkpoint, durationMs };
          yield* Ref.set(this.status, { _tag: "Loaded", activity });
          return { _tag: "Loaded", activity } as const;
        })),
        Effect.catchAll((failure) => Effect.gen(this, function* () {
          const durationMs = Math.max(0, (yield* Clock.currentTimeMillis) - startedAt);
          const activity = activityForFailure(failure, durationMs);
          yield* Ref.set(this.status, { _tag: "LoadFailed", activity, failure });
          return yield* new ExperimentStateSequenceFailure({ activity, failure });
        })),
        Effect.onInterrupt(() => Ref.set(this.status, { _tag: "LoadInterrupted" })),
      );
      return yield* transition;
    });
  }

  finalize(
    environment: StateRuntimeEnvironment,
    input: StateWindowFinalizerInput,
  ): Effect.Effect<StateWindowRecord, ExperimentStateSequenceFailure | StateWindowTransitionFailure> {
    return Effect.gen(this, function* () {
      const decision = yield* Ref.modify(this.status, (status): readonly [FinalizeDecision, WindowStatus] => {
        switch (status._tag) {
          case "Pending": {
            const load: StateTransferActivity = {
              outcome: "unavailable",
              reason: "interrupted",
              durationMs: 0,
            };
            return [{ _tag: "FinalizeWithoutSave", load }, { _tag: "Finalizing", load }];
          }
          case "LoadInterrupted": {
            const load: StateTransferActivity = {
              outcome: "unavailable",
              reason: "interrupted",
              durationMs: 0,
            };
            return [{ _tag: "FinalizeWithoutSave", load }, { _tag: "Finalizing", load }];
          }
          case "LoadFailed":
            return [{ _tag: "FinalizeWithoutSave", load: status.activity }, { _tag: "Finalizing", load: status.activity }];
          case "Loaded":
            return [{ _tag: "FinalizeLoaded", load: status.activity }, { _tag: "Finalizing", load: status.activity }];
          case "Finalized":
            return [{ _tag: "Existing", record: status.record }, status];
          default:
            return [{ _tag: "InvalidTransition", state: status._tag }, status];
        }
      });
      if (decision._tag === "Existing") return decision.record;
      if (decision._tag === "InvalidTransition") {
        return yield* new StateWindowTransitionFailure({
          operation: "finalize",
          state: decision.state,
          message: `State window ${this.windowId} cannot finalize while ${decision.state}.`,
        });
      }

      const consistency = this.plan.definition.consistency;
      if (decision._tag === "FinalizeWithoutSave") {
        const record: StateWindowRecord = {
          windowId: this.windowId,
          experimentId: this.experimentId,
          consistency,
          load: decision.load,
          save: { outcome: "skipped", reason: "load-failed", durationMs: 0 },
        };
        yield* Ref.set(this.status, { _tag: "Finalized", record });
        return record;
      }
      if (
        this.plan.definition.saveOn === "attempt-succeeded" &&
        input.completion._tag !== "Succeeded"
      ) {
        const record: StateWindowRecord = {
          windowId: this.windowId,
          experimentId: this.experimentId,
          consistency,
          load: decision.load,
          save: { outcome: "skipped", reason: "save-policy", durationMs: 0 },
        };
        yield* Ref.set(this.status, { _tag: "Finalized", record });
        return record;
      }

      const startedAt = yield* Clock.currentTimeMillis;
      const transition = saveExperimentState(
        this.plan,
        this.experimentId,
        this.windowId,
        environment,
        input.budget,
      ).pipe(
        Effect.flatMap((checkpoint) => Effect.gen(this, function* () {
          const durationMs = Math.max(0, (yield* Clock.currentTimeMillis) - startedAt);
          const record: StateWindowRecord = {
            windowId: this.windowId,
            experimentId: this.experimentId,
            consistency,
            load: decision.load,
            save: { outcome: "succeeded", checkpoint, durationMs },
          };
          yield* Ref.set(this.status, { _tag: "Finalized", record });
          return record;
        })),
        Effect.catchAll((failure) => Effect.gen(this, function* () {
          const durationMs = Math.max(0, (yield* Clock.currentTimeMillis) - startedAt);
          const save = activityForFailure(failure, durationMs);
          const record: StateWindowRecord = {
            windowId: this.windowId,
            experimentId: this.experimentId,
            consistency,
            load: decision.load,
            save,
          };
          yield* Ref.set(this.status, { _tag: "Finalized", record });
          return yield* new ExperimentStateSequenceFailure({ activity: save, failure });
        })),
        Effect.onInterrupt(() => Ref.set(this.status, {
          _tag: "Finalized",
          record: {
            windowId: this.windowId,
            experimentId: this.experimentId,
            consistency,
            load: decision.load,
            save: {
              outcome: "unavailable",
              reason: "interrupted",
              durationMs: 0,
            },
          },
        })),
      );
      return yield* transition;
    });
  }

  snapshot(): Effect.Effect<StateWindowSnapshot> {
    return Ref.get(this.status).pipe(Effect.map((status): StateWindowSnapshot => {
      switch (status._tag) {
        case "Pending": return { _tag: "Open", stage: "pending" };
        case "Loading": return { _tag: "Open", stage: "loading" };
        case "LoadInterrupted": return { _tag: "Open", stage: "load-interrupted" };
        case "Loaded": return { _tag: "Open", stage: "loaded" };
        case "LoadFailed": return { _tag: "Open", stage: "load-failed" };
        case "Finalizing": return { _tag: "Open", stage: "finalizing" };
        case "Finalized": return { _tag: "Finalized", record: status.record };
      }
    }));
  }
}
