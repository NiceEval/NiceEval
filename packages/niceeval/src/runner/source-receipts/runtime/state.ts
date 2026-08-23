import { randomUUID } from "node:crypto";

import { Effect } from "effect";

import type { ResolvedEvidenceCoverage } from "../../../assertions/coverage.ts";
import type { AgentRun, EvalResult } from "../../types.ts";
import {
  makeAttemptObservabilityCaptureIdentity,
  mintAttemptObservabilityEntity,
  mintRunObservabilityEntity,
  type AttemptObservabilityCaptureIdentity,
  type AttemptCapturedObservabilityEntity,
  type RegisteredCommandCapture,
  type RunObservabilityCaptureIdentity,
} from "../capture-identity.ts";
import type {
  CommandManifest,
  ConversationItem,
  ConversationTurn,
  UsageObservation,
} from "../model.ts";
import type {
  RunnerAttemptSourceReceiptsCapture,
  RunnerRunSourceReceiptsCapture,
  StagedCommandStream,
} from "../types.ts";
import {
  RunnerCollectionLimitations,
  producerEntityIdInvalid,
  type RunnerObservabilityProducerError,
} from "../support.ts";
import type { EventProjectionRuntime } from "../event-projection.ts";
import {
  entityIdFromEntropy,
  type AttemptReferenceTarget,
  type CallId,
  type CommandId,
  type CommandReferenceTarget,
  type DiagnosticId,
  type IntervalId,
  type ItemId,
  type ObservabilityEntityIdForKind,
  type ObservabilityEntityKind,
  type PositiveSafeInteger,
  type RunReferenceTarget,
  type SafeIdentifier,
  type TurnId,
  type UsageObservationId,
} from "../../../record/family/source-receipt/model.ts";

function uuidEntropyBytes(uuid: string): Uint8Array | undefined {
  const hex = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/iu.test(hex)) return undefined;
  const bytes = new Uint8Array(16);
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isInteger(byte)) return undefined;
    bytes[index] = byte;
  }
  return bytes;
}

function attemptTargetForEntity<Kind extends ObservabilityEntityKind>(
  kind: Kind,
  id: ObservabilityEntityIdForKind<Kind>,
): AttemptReferenceTarget {
  switch (kind) {
    case "turn":
      return Object.freeze({
        family: "niceeval.agent-turns" as const,
        kind: "turn" as const,
        id: id as TurnId,
      });
    case "item":
      return Object.freeze({
        family: "niceeval.agent-turns" as const,
        kind: "item" as const,
        id: id as ItemId,
      });
    case "call":
      return Object.freeze({
        family: "niceeval.agent-turns" as const,
        kind: "call" as const,
        id: id as CallId,
      });
    case "command":
      return Object.freeze({
        family: "niceeval.sandbox-commands" as const,
        kind: "command" as const,
        id: id as CommandId,
      });
    case "usage-observation":
      return Object.freeze({
        family: "niceeval.agent-turns" as const,
        kind: "usage-observation" as const,
        id: id as UsageObservationId,
      });
    case "interval":
      return Object.freeze({
        family: "niceeval.runner-activities" as const,
        kind: "interval" as const,
        id: id as IntervalId,
      });
    case "diagnostic":
      return Object.freeze({
        family: "niceeval.runner-diagnostics" as const,
        kind: "diagnostic" as const,
        id: id as DiagnosticId,
      });
  }
}

export type AttemptEntityMinter = <Kind extends ObservabilityEntityKind>(
  kind: Kind,
) => Effect.Effect<ObservabilityEntityIdForKind<Kind>, RunnerObservabilityProducerError>;

const runnerAttemptObservabilityRuntimeTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RunnerAttemptObservabilityRuntime",
);
const runnerCommandCaptureHandleTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RunnerCommandCaptureHandle",
);

/**
 * Opaque, Attempt-local capture authority. It deliberately has no durable
 * owner/path data and is bound to the final EvalResult only through a private
 * WeakMap below.
 */
export interface RunnerAttemptObservabilityRuntime {
  readonly [runnerAttemptObservabilityRuntimeTypeId]: () => void;
}

/** A registered command capability, usable only by Runner's timing wrapper. */
export interface RunnerCommandCaptureHandle {
  readonly [runnerCommandCaptureHandleTypeId]: () => void;
}

export interface CapturedCommandResult {
  readonly outcome:
    | { readonly kind: "exited"; readonly exitCode: number }
    | {
        readonly kind: "terminated";
        readonly reason: "timeout" | "cancelled" | "transport-lost";
      }
    | {
        readonly kind: "not-started";
        readonly reason: "spawn-failed" | "cancelled-before-start";
      };
  readonly stdout: StagedCommandStream;
  readonly stderr: StagedCommandStream;
}

export interface CapturedCommandRuntime {
  readonly segmentId: SafeIdentifier;
  readonly commandId: CommandId;
  readonly registered: RegisteredCommandCapture;
  readonly sequence: PositiveSafeInteger;
  readonly manifest: CommandManifest;
  result?: CapturedCommandResult;
}

export interface RunnerAttemptObservabilityRuntimeState {
  readonly capture: AttemptObservabilityCaptureIdentity;
  readonly providerName: string;
  readonly sensitiveValues: ReadonlySet<string>;
  /**
   * Entity IDs retain UUID entropy, but their leading bytes are monotonic
   * within one Attempt. Conversation items are serialized in causal sequence
   * and the fixed schema also requires canonical identity order, so purely
   * random item IDs would make valid captures fail nondeterministically.
   */
  nextEntityOrdinal: number;
  readonly commands: CapturedCommandRuntime[];
  readonly commandLimitations: RunnerCollectionLimitations;
  readonly usageLimitations: RunnerCollectionLimitations;
  /** One receipt slot is allocated at each physical SessionManager send start. */
  readonly conversationTurns: CapturedConversationTurn[];
  readonly conversationLimitations: RunnerCollectionLimitations;
  snapshot?: RunnerAttemptSourceReceiptsCapture;
  failure?: RunnerObservabilityProducerError;
}

export interface CapturedConversationTurn {
  readonly turnId: TurnId;
  readonly segmentId: SafeIdentifier;
  readonly sequence: PositiveSafeInteger;
  readonly items: ConversationItem[];
  readonly usage: UsageObservation[];
  outcome?: ConversationTurn["outcome"];
  adapterStatus?: "completed" | "failed" | "waiting";
  evidenceCoverage?: ResolvedEvidenceCoverage;
}

interface RunCaptureState {
  readonly capture: RunObservabilityCaptureIdentity;
  readonly snapshot: RunnerRunSourceReceiptsCapture;
}

const runnerAttemptRuntimeStates = new WeakMap<object, RunnerAttemptObservabilityRuntimeState>();
const runnerAttemptResultStates = new WeakMap<object, RunnerAttemptObservabilityRuntimeState>();
const runnerCommandHandleStates = new WeakMap<object, {
  readonly runtime: RunnerAttemptObservabilityRuntimeState;
  readonly command: CapturedCommandRuntime;
}>();
const runnerRunCaptures = new WeakMap<object, RunCaptureState>();

export function runtimeState(
  runtime: RunnerAttemptObservabilityRuntime,
): RunnerAttemptObservabilityRuntimeState | undefined {
  return runnerAttemptRuntimeStates.get(runtime as object);
}

export function resultRuntimeState(
  result: EvalResult,
): RunnerAttemptObservabilityRuntimeState | undefined {
  return runnerAttemptResultStates.get(result);
}

export function resultRuntimeStateConflicts(
  result: EvalResult,
  state: RunnerAttemptObservabilityRuntimeState,
): boolean {
  const existing = runnerAttemptResultStates.get(result);
  return existing !== undefined && existing !== state;
}

export function storeResultRuntimeState(
  result: EvalResult,
  state: RunnerAttemptObservabilityRuntimeState,
): void {
  runnerAttemptResultStates.set(result, state);
}

export function storeRunCapture(
  run: AgentRun,
  state: RunCaptureState,
): void {
  runnerRunCaptures.set(run, state);
}

export function runCapture(run: AgentRun): RunCaptureState | undefined {
  return runnerRunCaptures.get(run);
}

export function commandHandleState(
  handle: RunnerCommandCaptureHandle | undefined,
): { readonly runtime: RunnerAttemptObservabilityRuntimeState; readonly command: CapturedCommandRuntime } | undefined {
  return handle === undefined ? undefined : runnerCommandHandleStates.get(handle as object);
}

export function makeCommandHandle(
  runtime: RunnerAttemptObservabilityRuntimeState,
  command: CapturedCommandRuntime,
): RunnerCommandCaptureHandle {
  const handle = Object.freeze({
    [runnerCommandCaptureHandleTypeId]: () => undefined,
  }) as RunnerCommandCaptureHandle;
  runnerCommandHandleStates.set(handle, Object.freeze({ runtime, command }));
  return handle;
}

export function markRuntimeFailure(
  runtime: RunnerAttemptObservabilityRuntimeState,
  failure: RunnerObservabilityProducerError,
): void {
  if (runtime.failure === undefined) runtime.failure = failure;
}

/**
 * The durable entity suffix remains mostly UUID entropy while a bounded
 * big-endian ordinal makes creation order lexicographic order. Every v1
 * Attempt collector has much smaller caps than this counter's range.
 */
function orderedRuntimeEntityEntropy(
  runtime: RunnerAttemptObservabilityRuntimeState,
  uuid: string,
): Uint8Array | undefined {
  const bytes = uuidEntropyBytes(uuid);
  const ordinal = runtime.nextEntityOrdinal + 1;
  if (
    bytes === undefined
    || !Number.isSafeInteger(ordinal)
    || ordinal > 0xffff_ffff
  ) return undefined;
  runtime.nextEntityOrdinal = ordinal;
  bytes[0] = (ordinal >>> 24) & 0xff;
  bytes[1] = (ordinal >>> 16) & 0xff;
  bytes[2] = (ordinal >>> 8) & 0xff;
  bytes[3] = ordinal & 0xff;
  return bytes;
}

export function mintRuntimeEntity<Kind extends ObservabilityEntityKind>(
  runtime: RunnerAttemptObservabilityRuntimeState,
  kind: Kind,
): ObservabilityEntityIdForKind<Kind> | undefined {
  let uuid: string;
  try {
    uuid = randomUUID();
  } catch {
    markRuntimeFailure(runtime, producerEntityIdInvalid(kind));
    return undefined;
  }
  const bytes = orderedRuntimeEntityEntropy(runtime, uuid);
  const id = bytes === undefined ? undefined : entityIdFromEntropy(kind, bytes);
  if (id === undefined) {
    markRuntimeFailure(runtime, producerEntityIdInvalid(kind));
    return undefined;
  }
  const minted = mintAttemptObservabilityEntity(
    runtime.capture,
    attemptTargetForEntity(kind, id),
  );
  if (minted === undefined) {
    markRuntimeFailure(runtime, producerEntityIdInvalid(kind));
    return undefined;
  }
  return id;
}

export function registerRuntimeEntity<Kind extends ObservabilityEntityKind>(
  runtime: RunnerAttemptObservabilityRuntimeState,
  kind: Kind,
  id: ObservabilityEntityIdForKind<Kind>,
): boolean {
  const registered = mintAttemptObservabilityEntity(
    runtime.capture,
    attemptTargetForEntity(kind, id),
  );
  if (registered !== undefined) return true;
  markRuntimeFailure(runtime, producerEntityIdInvalid(kind));
  return false;
}

export function eventProjectionRuntime(
  runtime: RunnerAttemptObservabilityRuntimeState,
): EventProjectionRuntime {
  return Object.freeze({
    providerName: runtime.providerName,
    sensitiveValues: runtime.sensitiveValues,
    commandLimitations: runtime.commandLimitations,
    conversationTurns: runtime.conversationTurns,
    conversationLimitations: runtime.conversationLimitations,
    mintEntity: <Kind extends "call" | "item">(kind: Kind) =>
      mintRuntimeEntity(runtime, kind),
  });
}

export function mintRuntimeCommand(
  runtime: RunnerAttemptObservabilityRuntimeState,
): {
  readonly commandId: CommandId;
  readonly entity: AttemptCapturedObservabilityEntity<CommandReferenceTarget>;
} | undefined {
  let uuid: string;
  try {
    uuid = randomUUID();
  } catch {
    markRuntimeFailure(runtime, producerEntityIdInvalid("command"));
    return undefined;
  }
  const bytes = orderedRuntimeEntityEntropy(runtime, uuid);
  const commandId = bytes === undefined ? undefined : entityIdFromEntropy("command", bytes);
  if (commandId === undefined) {
    markRuntimeFailure(runtime, producerEntityIdInvalid("command"));
    return undefined;
  }
  const entity = mintAttemptObservabilityEntity<CommandReferenceTarget>(runtime.capture, {
    family: "niceeval.sandbox-commands" as const,
    kind: "command" as const,
    id: commandId,
  });
  if (entity === undefined) {
    markRuntimeFailure(runtime, producerEntityIdInvalid("command"));
    return undefined;
  }
  return Object.freeze({ commandId, entity });
}

export function makeAttemptEntityMinter(
  runtime: RunnerAttemptObservabilityRuntimeState,
): {
  readonly mint: AttemptEntityMinter;
} {
  return Object.freeze({
    mint: <Kind extends ObservabilityEntityKind>(kind: Kind) =>
      Effect.suspend(() => {
        if (runtime.failure !== undefined) return Effect.fail(runtime.failure);
        const id = mintRuntimeEntity(runtime, kind);
        return id === undefined
          ? Effect.fail(runtime.failure ?? producerEntityIdInvalid(kind))
          : Effect.succeed(id);
      }),
  });
}

type RunObservabilityEntityKind = "interval" | "diagnostic";

type RunEntityMinter = <Kind extends RunObservabilityEntityKind>(
  kind: Kind,
) => Effect.Effect<ObservabilityEntityIdForKind<Kind>, RunnerObservabilityProducerError>;

function runTargetForEntity<Kind extends RunObservabilityEntityKind>(
  kind: Kind,
  id: ObservabilityEntityIdForKind<Kind>,
): RunReferenceTarget {
  switch (kind) {
    case "interval":
      return Object.freeze({
        family: "niceeval.runner-activities" as const,
        kind: "interval" as const,
        id: id as IntervalId,
      });
    case "diagnostic":
      return Object.freeze({
        family: "niceeval.runner-diagnostics" as const,
        kind: "diagnostic" as const,
        id: id as DiagnosticId,
      });
  }
}

function mintRunEntity<Kind extends RunObservabilityEntityKind>(
  capture: RunObservabilityCaptureIdentity,
  kind: Kind,
): ObservabilityEntityIdForKind<Kind> | undefined {
  let uuid: string;
  try {
    uuid = randomUUID();
  } catch {
    return undefined;
  }
  const bytes = uuidEntropyBytes(uuid);
  const id = bytes === undefined ? undefined : entityIdFromEntropy(kind, bytes);
  if (id === undefined) return undefined;
  const minted = mintRunObservabilityEntity(capture, runTargetForEntity(kind, id));
  return minted === undefined ? undefined : id;
}

export function makeRunEntityMinter(
  capture: RunObservabilityCaptureIdentity,
): {
  readonly mint: RunEntityMinter;
} {
  return Object.freeze({
    mint: <Kind extends RunObservabilityEntityKind>(kind: Kind) =>
      Effect.suspend(() => {
        const id = mintRunEntity(capture, kind);
        return id === undefined
          ? Effect.fail(producerEntityIdInvalid(kind))
          : Effect.succeed(id);
      }),
  });
}

/** Creates one private capture for a real Runner Attempt. */
export function createRunnerAttemptObservabilityRuntime(input: {
  readonly providerName: string;
  readonly sensitiveValues: ReadonlySet<string>;
}): RunnerAttemptObservabilityRuntime {
  const runtime = Object.freeze({
    [runnerAttemptObservabilityRuntimeTypeId]: () => undefined,
  }) as RunnerAttemptObservabilityRuntime;
  runnerAttemptRuntimeStates.set(runtime, {
    capture: makeAttemptObservabilityCaptureIdentity(),
    providerName: input.providerName,
    sensitiveValues: input.sensitiveValues,
    nextEntityOrdinal: 0,
    commands: [],
    commandLimitations: new RunnerCollectionLimitations(),
    usageLimitations: new RunnerCollectionLimitations(),
    conversationTurns: [],
    conversationLimitations: new RunnerCollectionLimitations(),
  });
  return runtime;
}
