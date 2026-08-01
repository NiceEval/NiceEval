import type { JsonValue } from "../shared/types.ts";
import type { SandboxCommandTarget } from "../sandbox/commands.ts";

/** @internal Definition 的来源证明；不从任何公共入口导出。 */
export const EXPERIMENT_STATE_DEFINITION = Symbol("niceeval.experiment-state-definition");

export type StateDigest =
  | { readonly _tag: "Unavailable" }
  | { readonly _tag: "Sha256"; readonly value: string };

export interface StateCheckpoint {
  readonly identity: JsonValue;
  /** 稳定内容摘要；外部 store 无法提供稳定摘要时显式声明 Unavailable。 */
  readonly digest: StateDigest;
  readonly facts: Readonly<globalThis.Record<string, JsonValue>>;
}

export interface ExperimentStateContext {
  readonly phase: "load" | "save";
  readonly experimentId: string;
  readonly windowId: string;
  readonly sandbox: SandboxCommandTarget;
  readonly signal: AbortSignal;
  progress(input: { readonly message: string }): void;
  diagnostic(input: { readonly code: string; readonly message: string }): void;
  fact(key: string, value: string | number | boolean): void;
}

export type StateConsistency =
  | { readonly mode: "pinned"; readonly revision: string }
  | { readonly mode: "rolling" };

export type StateSavePolicy = "after-load" | "attempt-succeeded";

export interface ExperimentStateInput {
  readonly identity: JsonValue;
  readonly consistency: StateConsistency;
  readonly saveOn: StateSavePolicy;
  load(ctx: ExperimentStateContext): Promise<StateCheckpoint>;
  save(ctx: ExperimentStateContext): Promise<StateCheckpoint>;
}

export interface ExperimentStateDefinition {
  readonly identity: JsonValue;
  readonly consistency: StateConsistency;
  readonly saveOn: StateSavePolicy;
  readonly load: ExperimentStateInput["load"];
  readonly save: ExperimentStateInput["save"];
  readonly [EXPERIMENT_STATE_DEFINITION]: true;
}

export interface ExperimentStateProjection {
  readonly identity: JsonValue;
  readonly consistency: StateConsistency;
  readonly saveOn: StateSavePolicy;
}

export type StateTransferActivity =
  | { readonly outcome: "succeeded"; readonly checkpoint: StateCheckpoint; readonly durationMs: number }
  | { readonly outcome: "failed"; readonly code: string; readonly message: string; readonly durationMs: number }
  | { readonly outcome: "skipped"; readonly reason: "save-policy" | "load-failed"; readonly durationMs: 0 }
  | {
      readonly outcome: "unavailable";
      readonly reason: "sandbox-lost" | "provider-unreachable" | "deadline-exceeded" | "interrupted";
      readonly durationMs: number;
    };

export interface StateWindowRecord {
  readonly windowId: string;
  readonly experimentId: string;
  readonly consistency: StateConsistency;
  readonly load: StateTransferActivity;
  readonly save: StateTransferActivity;
}
