import { Cause, Data, Effect, Option, Schema } from "effect";
import { ExperimentFatalError } from "../shared/failure-class.ts";
import type { SandboxCommandTarget } from "../sandbox/commands.ts";
import { freezeStateJson, StateCheckpointSchema, stateJsonValueOf } from "./definition.ts";
import type { PlannedExperimentState } from "./plan.ts";
import type {
  ExperimentStateContext,
  StateCheckpoint,
  StateTransferActivity,
  StateWindowRecord,
} from "./types.ts";

export type ExternalStateCause =
  | { readonly _tag: "NoExternalCause" }
  | {
      readonly _tag: "ExternalCause";
      readonly name: string;
      readonly code: string;
      readonly message: string;
    };

type StateLoadFailureKind = "callback" | "invalid-checkpoint" | "revision-mismatch" | "unavailable";
type StateSaveFailureKind = "callback" | "invalid-checkpoint" | "unavailable";

export class StateLoadFailure extends Data.TaggedError("StateLoadFailure")<{
  readonly phase: "state.load";
  readonly kind: StateLoadFailureKind;
  readonly code: string;
  readonly message: string;
  readonly cause: ExternalStateCause;
}> {}

export class StateSaveFailure extends Data.TaggedError("StateSaveFailure")<{
  readonly phase: "state.save";
  readonly kind: StateSaveFailureKind;
  readonly code: string;
  readonly message: string;
  readonly cause: ExternalStateCause;
}> {}

export type StateFailure = StateLoadFailure | StateSaveFailure;

function normalizeExternalCause(value: unknown): ExternalStateCause {
  if (typeof value !== "object" || value === null) {
    return { _tag: "ExternalCause", name: "ThrownValue", code: "", message: String(value) };
  }
  const candidate = value as { name?: unknown; code?: unknown; message?: unknown };
  return {
    _tag: "ExternalCause",
    name: typeof candidate.name === "string" ? candidate.name : value.constructor?.name ?? "Error",
    code: typeof candidate.code === "string" ? candidate.code : "",
    message: typeof candidate.message === "string" ? candidate.message : String(value),
  };
}

function loadCheckpointEffect(value: unknown): Effect.Effect<StateCheckpoint, StateLoadFailure> {
  return Schema.decodeUnknown(StateCheckpointSchema)(value).pipe(
    Effect.map((decoded) => Object.freeze({
      identity: freezeStateJson(stateJsonValueOf(decoded.identity)),
      ...(decoded.digest !== undefined ? { digest: decoded.digest } : {}),
      facts: Object.freeze(Object.fromEntries(
        Object.entries(decoded.facts).map(([key, value]) => [key, freezeStateJson(stateJsonValueOf(value))]),
      )),
    })),
    Effect.mapError(() => new StateLoadFailure({
      phase: "state.load",
      kind: "invalid-checkpoint",
      code: "state.load.invalid-checkpoint",
      message: "state.load.invalid-checkpoint: load() must return a JSON checkpoint with identity and facts.",
      cause: { _tag: "NoExternalCause" },
    })),
  );
}

function saveCheckpointEffect(value: unknown): Effect.Effect<StateCheckpoint, StateSaveFailure> {
  return Schema.decodeUnknown(StateCheckpointSchema)(value).pipe(
    Effect.map((decoded) => Object.freeze({
      identity: freezeStateJson(stateJsonValueOf(decoded.identity)),
      ...(decoded.digest !== undefined ? { digest: decoded.digest } : {}),
      facts: Object.freeze(Object.fromEntries(
        Object.entries(decoded.facts).map(([key, value]) => [key, freezeStateJson(stateJsonValueOf(value))]),
      )),
    })),
    Effect.mapError(() => new StateSaveFailure({
      phase: "state.save",
      kind: "invalid-checkpoint",
      code: "state.save.invalid-checkpoint",
      message: "state.save.invalid-checkpoint: save() must return a JSON checkpoint with identity and facts.",
      cause: { _tag: "NoExternalCause" },
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
  readonly signal: AbortSignal;
  progress(input: { readonly message: string }): void;
  diagnostic(input: { readonly code: string; readonly message: string }): void;
  fact(key: string, value: string | number | boolean): void;
}

function stateContext(
  phase: "load" | "save",
  experimentId: string,
  windowId: string,
  environment: StateRuntimeEnvironment,
): ExperimentStateContext {
  return Object.freeze({
    phase,
    experimentId,
    windowId,
    sandbox: environment.sandbox,
    signal: environment.signal,
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
  const callback = Effect.tryPromise({
    try: () => plan.definition.load(stateContext("load", experimentId, windowId, environment)),
    catch: (cause) => {
      const normalized = normalizeExternalCause(cause);
      return new StateLoadFailure({
        phase: "state.load",
        kind: "callback",
        code: "state.load.callback",
        message: `state.load.callback: ${normalized._tag === "ExternalCause" ? normalized.message : "State load failed"}`,
        cause: normalized,
      });
    },
  });
  return callback.pipe(
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
        cause: { _tag: "NoExternalCause" },
      }));
    }),
  );
}

export function saveExperimentState(
  plan: Exclude<PlannedExperimentState, { readonly _tag: "Stateless" }>,
  experimentId: string,
  windowId: string,
  environment: StateRuntimeEnvironment,
): Effect.Effect<StateCheckpoint, StateSaveFailure> {
  return Effect.tryPromise({
    try: () => plan.definition.save(stateContext("save", experimentId, windowId, environment)),
    catch: (cause) => {
      const normalized = normalizeExternalCause(cause);
      return new StateSaveFailure({
        phase: "state.save",
        kind: "callback",
        code: "state.save.callback",
        message: `state.save.callback: ${normalized._tag === "ExternalCause" ? normalized.message : "State save failed"}`,
        cause: normalized,
      });
    },
  }).pipe(Effect.flatMap(saveCheckpointEffect));
}

function failureFromCause<E>(cause: Cause.Cause<E>): E {
  const failure = Cause.failureOption(cause);
  if (Option.isSome(failure)) return failure.value;
  throw Cause.squash(cause);
}

type WindowStatus =
  | { readonly _tag: "Pending" }
  | { readonly _tag: "Loaded"; readonly activity: StateTransferActivity }
  | { readonly _tag: "LoadFailed"; readonly activity: StateTransferActivity; readonly failure: StateLoadFailure }
  | { readonly _tag: "Finalized"; readonly record: StateWindowRecord };

export type StateWindowSnapshot =
  | { readonly _tag: "Open"; readonly load: "pending" | "succeeded" | "failed" }
  | { readonly _tag: "Finalized"; readonly record: StateWindowRecord };

export class ExperimentStateWindow {
  private status: WindowStatus = { _tag: "Pending" };

  constructor(
    readonly plan: Exclude<PlannedExperimentState, { readonly _tag: "Stateless" }>,
    readonly experimentId: string,
    readonly windowId: string,
  ) {}

  /** lifecycle 用这个判定是否真的产生 state.load phase；reuse window 中间 Attempt 不伪造阶段。 */
  needsLoad(): boolean {
    return this.status._tag === "Pending";
  }

  async load(environment: StateRuntimeEnvironment): Promise<void> {
    if (this.status._tag === "Loaded") return;
    if (this.status._tag === "Finalized") throw new Error(`State window ${this.windowId} is already finalized.`);
    if (this.status._tag === "LoadFailed") {
      throw new ExperimentStateSequenceError(this.status.activity, this.status.failure);
    }
    const startedAt = Date.now();
    const exit = await Effect.runPromiseExit(loadExperimentState(this.plan, this.experimentId, this.windowId, environment));
    if (exit._tag === "Success") {
      this.status = {
        _tag: "Loaded",
        activity: { outcome: "succeeded", checkpoint: exit.value, durationMs: Date.now() - startedAt },
      };
      return;
    }
    const failure = failureFromCause(exit.cause);
    const activity: StateTransferActivity = {
      outcome: "failed",
      code: failure.code,
      message: failure.message,
      durationMs: Date.now() - startedAt,
    };
    this.status = { _tag: "LoadFailed", activity, failure };
    throw new ExperimentStateSequenceError(activity, failure);
  }

  async finalize(
    environment: StateRuntimeEnvironment,
    policy: { readonly attemptPassed: boolean; readonly agentTeardownSucceeded: boolean },
  ): Promise<StateWindowRecord> {
    if (this.status._tag === "Finalized") return this.status.record;
    const consistency = this.plan.definition.consistency;
    if (this.status._tag === "Pending" || this.status._tag === "LoadFailed") {
      const load = this.status._tag === "LoadFailed"
        ? this.status.activity
        : { outcome: "failed" as const, code: "state.load.unavailable", message: "State window was finalized before load.", durationMs: 0 };
      const record: StateWindowRecord = {
        windowId: this.windowId,
        experimentId: this.experimentId,
        consistency,
        load,
        save: { outcome: "skipped", reason: "load-failed", durationMs: 0 },
      };
      this.status = { _tag: "Finalized", record };
      return record;
    }
    const loaded = this.status.activity;
    if (
      this.plan.definition.saveOn === "attempt-succeeded" &&
      (!policy.attemptPassed || !policy.agentTeardownSucceeded)
    ) {
      const record: StateWindowRecord = {
        windowId: this.windowId,
        experimentId: this.experimentId,
        consistency,
        load: loaded,
        save: { outcome: "skipped", reason: "save-policy", durationMs: 0 },
      };
      this.status = { _tag: "Finalized", record };
      return record;
    }
    const startedAt = Date.now();
    const exit = await Effect.runPromiseExit(saveExperimentState(this.plan, this.experimentId, this.windowId, environment));
    if (exit._tag === "Success") {
      const record: StateWindowRecord = {
        windowId: this.windowId,
        experimentId: this.experimentId,
        consistency,
        load: loaded,
        save: { outcome: "succeeded", checkpoint: exit.value, durationMs: Date.now() - startedAt },
      };
      this.status = { _tag: "Finalized", record };
      return record;
    }
    const failure = failureFromCause(exit.cause);
    const record: StateWindowRecord = {
      windowId: this.windowId,
      experimentId: this.experimentId,
      consistency,
      load: loaded,
      save: {
        outcome: "failed",
        code: failure.code,
        message: failure.message,
        durationMs: Date.now() - startedAt,
      },
    };
    this.status = { _tag: "Finalized", record };
    throw new ExperimentStateSequenceError(record.save, failure);
  }

  snapshot(): StateWindowSnapshot {
    switch (this.status._tag) {
      case "Pending":
        return { _tag: "Open", load: "pending" };
      case "Loaded":
        return { _tag: "Open", load: "succeeded" };
      case "LoadFailed":
        return { _tag: "Open", load: "failed" };
      case "Finalized":
        return { _tag: "Finalized", record: this.status.record };
    }
  }
}

export class ExperimentStateSequenceError extends ExperimentFatalError {
  readonly stateActivity: StateTransferActivity;
  readonly stateFailure: StateFailure;

  constructor(activity: StateTransferActivity, failure: StateFailure) {
    super(activity.outcome === "failed" ? activity.message : "Experiment State sequence failed.", {
      cause: failure,
    });
    this.name = "ExperimentStateSequenceError";
    this.stateActivity = activity;
    this.stateFailure = failure;
  }
}
