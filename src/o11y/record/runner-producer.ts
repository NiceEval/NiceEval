import { randomUUID } from "node:crypto";

import { Effect } from "effect";

import type { SealedAttemptAssertions } from "../../assertions/api.ts";
import { redactSensitiveText } from "../../sandbox/redaction.ts";
import type { CommandOptions } from "../../sandbox/types.ts";
import type {
  AgentRun,
  DiagnosticRecord,
  EvalResult,
  LifecyclePhase,
  PhaseTiming,
  TimingActivity,
  TimingOrigin,
} from "../../runner/types.ts";
import type { Usage } from "../types.ts";
import {
  makeAttemptObservabilityCaptureIdentity,
  makeRunObservabilityCaptureIdentity,
  mintAttemptObservabilityEntity,
  mintRunObservabilityEntity,
  recordRegisteredCommandResult,
  registerCommandCapture,
  registeredCommandId,
  sealAttemptObservabilityCaptureIdentity,
  sealRunObservabilityCaptureIdentity,
  type AttemptObservabilityCaptureIdentity,
  type AttemptCapturedObservabilityEntity,
  type RegisteredCommandCapture,
  type RunObservabilityCaptureIdentity,
} from "./capture.ts";
import {
  type AttemptDiagnostic,
  type AttemptTimingInterval,
  type CommandManifest,
  type ConversationItem,
  type ConversationTurn,
  type RunDiagnostic,
  type UsageObservation,
} from "./families.ts";
import type {
  NormalizedCommandObservationCapture,
  NormalizedCommandStreamCapture,
  NormalizedAttemptObservabilityCapture,
  NormalizedRunObservabilityCapture,
} from "./family-writers.ts";
import {
  MAX_COMMAND_ARGUMENT_BYTES,
  MAX_COMMAND_ARGUMENTS,
  MAX_COMMAND_EXECUTABLE_BYTES,
  MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES,
  MAX_COMMAND_SHELL_BYTES,
  MAX_COMMAND_STREAM_BYTES,
  MAX_COMMANDS,
  MAX_CONVERSATION_ITEMS,
  MAX_CONVERSATION_TEXT_BYTES,
  MAX_CONVERSATION_TURNS,
  MAX_DIAGNOSTIC_SUMMARY_BYTES,
  MAX_DIAGNOSTICS,
  MAX_TIMING_INTERVALS,
  MAX_USAGE_OBSERVATIONS,
} from "./limits.ts";
import {
  compareObservabilityText,
  compareObservabilityLimitation,
  entityIdFromEntropy,
  makeBoundedSafeText,
  makeCanonicalDecimal,
  makeCurrencyCode,
  makeNonNegativeSafeInteger,
  makePositiveSafeInteger,
  makeSafeIdentifier,
  makeSourceNativeToolName,
  makeStableLabel,
  utf8ByteLength,
  type AttemptReferenceTarget,
  type CommandId,
  type CommandReferenceTarget,
  type CollectionStage,
  type CollectionTarget,
  type Collection,
  type DiagnosticId,
  type IntervalId,
  type ItemId,
  type NonNegativeSafeInteger,
  type ObservabilityEntityIdForKind,
  type ObservabilityEntityKind,
  type ObservabilityLimitation,
  type PositiveSafeInteger,
  type RunReferenceTarget,
  type SafeIdentifier,
  type SafeText,
  type SourceNativeToolName,
  type StableLabel,
  type TurnId,
  type CallId,
  type UsageObservationId,
} from "./model.ts";

/**
 * The Runner never exposes raw provider frames to the Record layer. These
 * errors therefore carry only an internal stable code and entity kind.
 */
export type RunnerObservabilityProducerError =
  | {
      readonly code: "runner-observability-entity-id-invalid";
      readonly kind: ObservabilityEntityKind;
    }
  | {
      readonly code: "runner-observability-capture-seal-invalid";
      readonly owner: "attempt" | "run";
    }
  | {
      readonly code: "runner-observability-capture-missing";
    }
  | {
      readonly code: "runner-observability-command-registration-invalid";
    };

function producerEntityIdInvalid(
  kind: ObservabilityEntityKind,
): RunnerObservabilityProducerError {
  return Object.freeze({
    code: "runner-observability-entity-id-invalid" as const,
    kind,
  });
}

function producerCaptureSealInvalid(
  owner: "attempt" | "run",
): RunnerObservabilityProducerError {
  return Object.freeze({
    code: "runner-observability-capture-seal-invalid" as const,
    owner,
  });
}

function producerCaptureMissing(): RunnerObservabilityProducerError {
  return Object.freeze({ code: "runner-observability-capture-missing" as const });
}

function producerCommandRegistrationInvalid(): RunnerObservabilityProducerError {
  return Object.freeze({ code: "runner-observability-command-registration-invalid" as const });
}

function requiredPositive(value: number): PositiveSafeInteger {
  const positive = makePositiveSafeInteger(value);
  if (positive !== undefined) return positive;
  const fallback = makePositiveSafeInteger(1);
  if (fallback === undefined) throw new Error("One must be a positive safe integer");
  return fallback;
}

function requiredNonNegative(value: number): NonNegativeSafeInteger {
  const nonNegative = makeNonNegativeSafeInteger(value);
  if (nonNegative !== undefined) return nonNegative;
  const fallback = makeNonNegativeSafeInteger(0);
  if (fallback === undefined) throw new Error("Zero must be a non-negative safe integer");
  return fallback;
}

/** Coalesces and canonically orders the closed durable limitation union. */
class RunnerCollectionLimitations {
  private readonly captureFailed = new Map<string, {
    readonly stage: CollectionStage;
    readonly target: CollectionTarget;
  }>();
  private readonly captureInterrupted = new Map<string, {
    readonly stage: CollectionStage;
    readonly target: CollectionTarget;
  }>();
  private readonly unsupported = new Map<CollectionTarget, number>();
  private readonly redacted = new Map<CollectionTarget, number>();
  private readonly caps = new Map<CollectionTarget, {
    readonly retained: number;
    readonly omittedAtLeast: number;
  }>();
  private readonly textTruncations: ObservabilityLimitation[] = [];

  addCaptureFailed(stage: CollectionStage, target: CollectionTarget): void {
    this.captureFailed.set(`${stage}\u0000${target}`, Object.freeze({ stage, target }));
  }

  addCaptureInterrupted(stage: CollectionStage, target: CollectionTarget): void {
    this.captureInterrupted.set(`${stage}\u0000${target}`, Object.freeze({ stage, target }));
  }

  addUnsupported(target: CollectionTarget, omittedAtLeast = 1): void {
    this.unsupported.set(target, (this.unsupported.get(target) ?? 0) + omittedAtLeast);
  }

  addRedacted(target: CollectionTarget, replacements = 1): void {
    this.redacted.set(target, (this.redacted.get(target) ?? 0) + replacements);
  }

  addCap(target: CollectionTarget, retained: number, omittedAtLeast = 1): void {
    const current = this.caps.get(target);
    this.caps.set(target, Object.freeze({
      retained: Math.max(retained, current?.retained ?? 0),
      omittedAtLeast: (current?.omittedAtLeast ?? 0) + omittedAtLeast,
    }));
  }

  addConversationTextTruncated(
    itemId: ItemId,
    retainedBytes: NonNegativeSafeInteger,
    omittedBytes: PositiveSafeInteger,
  ): void {
    this.textTruncations.push(Object.freeze({
      code: "text-truncated" as const,
      target: "conversation-text" as const,
      itemId,
      retainedBytes,
      omittedBytes,
    }));
  }

  addCommandManifestTextTruncated(
    commandId: CommandId,
    retainedBytes: NonNegativeSafeInteger,
    omittedBytes: PositiveSafeInteger,
  ): void {
    this.textTruncations.push(Object.freeze({
      code: "text-truncated" as const,
      target: "command-manifest" as const,
      commandId,
      retainedBytes,
      omittedBytes,
    }));
  }

  addCommandStreamTruncated(
    commandId: CommandId,
    stream: "stdout" | "stderr",
    retainedBytes: NonNegativeSafeInteger,
    omittedBytes: PositiveSafeInteger,
  ): void {
    this.textTruncations.push(Object.freeze({
      code: "stream-truncated" as const,
      commandId,
      stream,
      retainedBytes,
      omittedBytes,
    }));
  }

  addUnsafeCommandControlStripped(
    commandId: CommandId,
    stream: "stdout" | "stderr",
    strippedCount: number,
  ): void {
    this.textTruncations.push(Object.freeze({
      code: "unsafe-control-stripped" as const,
      commandId,
      stream,
      strippedCount: requiredPositive(strippedCount),
    }));
  }

  collection(): Collection {
    const limitations: ObservabilityLimitation[] = [];
    for (const { stage, target } of this.captureFailed.values()) {
      limitations.push(Object.freeze({
        code: "capture-failed" as const,
        stage,
        target,
      }));
    }
    for (const { stage, target } of this.captureInterrupted.values()) {
      limitations.push(Object.freeze({
        code: "capture-interrupted" as const,
        stage,
        target,
      }));
    }
    for (const [target, omittedAtLeast] of this.unsupported) {
      limitations.push(Object.freeze({
        code: "unsupported-input" as const,
        target,
        omittedAtLeast: requiredPositive(omittedAtLeast),
      }));
    }
    for (const [target, replacements] of this.redacted) {
      limitations.push(Object.freeze({
        code: "redacted" as const,
        target,
        replacementCount: requiredPositive(replacements),
      }));
    }
    for (const [target, cap] of this.caps) {
      limitations.push(Object.freeze({
        code: "collection-cap-reached" as const,
        target,
        retained: requiredNonNegative(cap.retained),
        omittedAtLeast: requiredPositive(cap.omittedAtLeast),
      }));
    }
    limitations.push(...this.textTruncations);
    limitations.sort(compareObservabilityLimitation);
    if (limitations.length === 0) {
      return Object.freeze({
        state: "complete" as const,
        limitations: Object.freeze([]) as readonly [],
      });
    }
    const [first, ...rest] = limitations;
    if (first === undefined) throw new Error("A non-empty limitation list needs a first entry");
    return Object.freeze({
      state: "partial" as const,
      limitations: Object.freeze([first, ...rest]) as readonly [
        ObservabilityLimitation,
        ...ObservabilityLimitation[],
      ],
    });
  }
}

interface RetainedText {
  readonly text: SafeText;
  readonly retainedBytes: NonNegativeSafeInteger;
  readonly omittedBytes?: PositiveSafeInteger;
}

/** Never split a Unicode scalar or retain a non-SafeText source value. */
function retainSafeText(value: string, maximumBytes: number): RetainedText | undefined {
  if (makeBoundedSafeText(value, maximumBytes) !== undefined) {
    return Object.freeze({
      text: makeBoundedSafeText(value, maximumBytes)!,
      retainedBytes: requiredNonNegative(utf8ByteLength(value)),
    });
  }
  const totalBytes = utf8ByteLength(value);
  if (totalBytes <= maximumBytes) return undefined;

  let retained = "";
  let retainedBytes = 0;
  for (const scalar of value) {
    const scalarBytes = utf8ByteLength(scalar);
    if (retainedBytes + scalarBytes > maximumBytes) break;
    retained += scalar;
    retainedBytes += scalarBytes;
  }
  const safe = makeBoundedSafeText(retained, maximumBytes);
  const omittedBytes = totalBytes - retainedBytes;
  if (safe === undefined || omittedBytes <= 0) return undefined;
  return Object.freeze({
    text: safe,
    retainedBytes: requiredNonNegative(retainedBytes),
    omittedBytes: requiredPositive(omittedBytes),
  });
}

function jsonSummary(value: unknown): RetainedText | undefined {
  let summary: string | undefined;
  try {
    const encoded = JSON.stringify(value);
    summary = typeof encoded === "string" ? encoded : undefined;
  } catch {
    return undefined;
  }
  return summary === undefined
    ? undefined
    : retainSafeText(summary, MAX_CONVERSATION_TEXT_BYTES);
}

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
        family: "niceeval.observability" as const,
        kind: "turn" as const,
        id: id as TurnId,
      });
    case "item":
      return Object.freeze({
        family: "niceeval.observability" as const,
        kind: "item" as const,
        id: id as ItemId,
      });
    case "call":
      return Object.freeze({
        family: "niceeval.observability" as const,
        kind: "call" as const,
        id: id as CallId,
      });
    case "command":
      return Object.freeze({
        family: "niceeval.observability" as const,
        kind: "command" as const,
        id: id as import("./model.ts").CommandId,
      });
    case "usage-observation":
      return Object.freeze({
        family: "niceeval.observability" as const,
        kind: "usage-observation" as const,
        id: id as import("./model.ts").UsageObservationId,
      });
    case "interval":
      return Object.freeze({
        family: "niceeval.observability" as const,
        kind: "interval" as const,
        id: id as IntervalId,
      });
    case "diagnostic":
      return Object.freeze({
        family: "niceeval.observability" as const,
        kind: "diagnostic" as const,
        id: id as DiagnosticId,
      });
  }
}

type AttemptEntityMinter = <Kind extends ObservabilityEntityKind>(
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

interface CapturedCommandResult {
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
  readonly stdout: string;
  readonly stderr: string;
}

interface CapturedCommandRuntime {
  readonly commandId: CommandId;
  readonly registered: RegisteredCommandCapture;
  readonly phase: LifecyclePhase;
  readonly invocationKind: "argv" | "shell";
  readonly command: string;
  readonly args: readonly string[] | undefined;
  readonly options: unknown;
  result?: CapturedCommandResult;
}

interface RunnerAttemptObservabilityRuntimeState {
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
  readonly usage: UsageObservation[];
  readonly usageLimitations: RunnerCollectionLimitations;
  failure?: RunnerObservabilityProducerError;
}

const runnerAttemptRuntimeStates = new WeakMap<object, RunnerAttemptObservabilityRuntimeState>();
const runnerAttemptResultStates = new WeakMap<object, RunnerAttemptObservabilityRuntimeState>();
const runnerCommandHandleStates = new WeakMap<object, {
  readonly runtime: RunnerAttemptObservabilityRuntimeState;
  readonly command: CapturedCommandRuntime;
}>();
const runnerRunDiagnostics = new WeakMap<object, readonly DiagnosticRecord[]>();

function runtimeState(
  runtime: RunnerAttemptObservabilityRuntime,
): RunnerAttemptObservabilityRuntimeState | undefined {
  return runnerAttemptRuntimeStates.get(runtime as object);
}

function markRuntimeFailure(
  runtime: RunnerAttemptObservabilityRuntimeState,
  failure: RunnerObservabilityProducerError,
): void {
  if (runtime.failure === undefined) runtime.failure = failure;
}

function mintRuntimeEntity<Kind extends ObservabilityEntityKind>(
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

function mintRuntimeCommand(
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
    family: "niceeval.observability" as const,
    kind: "command" as const,
    id: commandId,
  });
  if (entity === undefined) {
    markRuntimeFailure(runtime, producerEntityIdInvalid("command"));
    return undefined;
  }
  return Object.freeze({ commandId, entity });
}

function makeAttemptEntityMinter(
  runtime: RunnerAttemptObservabilityRuntimeState,
): {
  readonly mint: AttemptEntityMinter;
  readonly seal: () => boolean;
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
    seal: () => sealAttemptObservabilityCaptureIdentity(runtime.capture),
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
        family: "niceeval.observability" as const,
        kind: "interval" as const,
        id: id as IntervalId,
      });
    case "diagnostic":
      return Object.freeze({
        family: "niceeval.observability" as const,
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

function makeRunEntityMinter(
  capture: RunObservabilityCaptureIdentity,
): {
  readonly mint: RunEntityMinter;
  readonly seal: () => boolean;
} {
  return Object.freeze({
    mint: <Kind extends RunObservabilityEntityKind>(kind: Kind) =>
      Effect.suspend(() => {
        const id = mintRunEntity(capture, kind);
        return id === undefined
          ? Effect.fail(producerEntityIdInvalid(kind))
          : Effect.succeed(id);
      }),
    seal: () => sealRunObservabilityCaptureIdentity(capture),
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
    usage: [],
    usageLimitations: new RunnerCollectionLimitations(),
  });
  return runtime;
}

/**
 * Associates the exact final EvalResult object with its Attempt-local
 * capture. Result shape stays public-contract-neutral; Record later looks up
 * this identity rather than reading an added field.
 */
export function bindRunnerAttemptObservabilityCapture(
  result: EvalResult,
  runtime: RunnerAttemptObservabilityRuntime,
): void {
  const state = runtimeState(runtime);
  if (state === undefined) return;
  const existing = runnerAttemptResultStates.get(result);
  if (existing !== undefined && existing !== state) {
    markRuntimeFailure(state, producerCaptureSealInvalid("attempt"));
    return;
  }
  runnerAttemptResultStates.set(result, state);
}

/**
 * Associates only the settled diagnostics that belong to this exact Run. The
 * invocation-wide timing recorder is intentionally not bound here: its facts
 * have no safe per-experiment owner attribution when an invocation has more
 * than one Run.
 */
export function bindRunnerRunObservabilityDiagnostics(input: {
  readonly run: AgentRun;
  readonly diagnostics: readonly DiagnosticRecord[];
}): void {
  runnerRunDiagnostics.set(input.run, Object.freeze([...input.diagnostics]));
}

function commandManifestPhase(
  phase: LifecyclePhase,
): CommandManifest["phase"] {
  switch (phase) {
    case "sandbox.create":
    case "workspace.baseline":
    case "agent.setup":
    case "telemetry.configure":
      return "attempt.setup";
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
    case "sandbox.prepare.group":
    case "sandbox.prepare.experiment":
      return "sandbox.prepare";
    case "agent.ensure":
      return "agent.ensure";
    case "eval.run":
      return "eval.run";
    case "agent.run":
      return "sandbox.command";
    case "agent.teardown":
    case "sandbox.cleanup":
    case "sandbox.suspend":
    case "sandbox.stop":
    case "experiment.teardown":
    case "workspace.diff":
    case "telemetry.collect":
      return "attempt.teardown";
    case "assertions.evaluate":
    case "judge.precheck":
      return "eval.run";
    case "experiment.setup":
    case "sandbox.queue":
      return "attempt.setup";
  }
}

/** Registers the manifest authority before the wrapped Sandbox call starts. */
export function captureRunnerCommandStart(input: {
  readonly runtime: RunnerAttemptObservabilityRuntime;
  readonly phase: LifecyclePhase;
  readonly invocationKind: "argv" | "shell";
  readonly command: string;
  readonly args?: readonly string[];
  readonly options?: unknown;
}): RunnerCommandCaptureHandle | undefined {
  const runtime = runtimeState(input.runtime);
  if (runtime === undefined) return undefined;
  if (runtime.failure !== undefined) return undefined;
  if (runtime.commands.length >= MAX_COMMANDS) {
    runtime.commandLimitations.addCap("command-manifest", runtime.commands.length);
    return undefined;
  }
  const minted = mintRuntimeCommand(runtime);
  if (minted === undefined) return undefined;
  const { commandId } = minted;
  const registered = registerCommandCapture(runtime.capture, minted.entity);
  if (registered === undefined || registeredCommandId(registered) !== commandId) {
    markRuntimeFailure(runtime, producerCommandRegistrationInvalid());
    return undefined;
  }
  const command: CapturedCommandRuntime = {
    commandId,
    registered,
    phase: input.phase,
    invocationKind: input.invocationKind,
    command: input.command,
    args: input.args === undefined ? undefined : [...input.args],
    options: input.options,
  };
  runtime.commands.push(command);
  const handle = Object.freeze({
    [runnerCommandCaptureHandleTypeId]: () => undefined,
  }) as RunnerCommandCaptureHandle;
  runnerCommandHandleStates.set(handle, Object.freeze({ runtime, command }));
  return handle;
}

function commandHandleState(
  handle: RunnerCommandCaptureHandle | undefined,
): { readonly runtime: RunnerAttemptObservabilityRuntimeState; readonly command: CapturedCommandRuntime } | undefined {
  return handle === undefined ? undefined : runnerCommandHandleStates.get(handle as object);
}

function acceptRegisteredCommandResult(state: {
  readonly runtime: RunnerAttemptObservabilityRuntimeState;
  readonly command: CapturedCommandRuntime;
}): boolean {
  const registration = recordRegisteredCommandResult(
    state.runtime.capture,
    state.command.registered,
  );
  if (registration.state !== "recorded") {
    markRuntimeFailure(state.runtime, producerCommandRegistrationInvalid());
    return false;
  }
  return true;
}

function recordTerminalCommandResult(
  state: {
    readonly runtime: RunnerAttemptObservabilityRuntimeState;
    readonly command: CapturedCommandRuntime;
  },
  outcome: Exclude<CapturedCommandResult["outcome"], { readonly kind: "exited" }>,
): void {
  if (!acceptRegisteredCommandResult(state)) return;
  state.command.result = Object.freeze({
    outcome: Object.freeze(outcome),
    stdout: "",
    stderr: "",
  });
}

/** Records a real returned/CommandExitError result against its prior manifest. */
export function captureRunnerCommandResult(input: {
  readonly handle: RunnerCommandCaptureHandle | undefined;
  readonly exitCode: number;
  readonly stdout: unknown;
  readonly stderr: unknown;
}): void {
  const state = commandHandleState(input.handle);
  if (state === undefined) return;
  if (!acceptRegisteredCommandResult(state)) return;
  if (!Number.isSafeInteger(input.exitCode) || input.exitCode < -2_147_483_648 || input.exitCode > 2_147_483_647) {
    // A provider value without a valid command result is not a normal exit.
    // Keep the registered manifest with its explicit transport terminal fact.
    state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-manifest");
    state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stdout");
    state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stderr");
    state.command.result = Object.freeze({
      outcome: Object.freeze({ kind: "terminated" as const, reason: "transport-lost" as const }),
      stdout: "",
      stderr: "",
    });
    return;
  }
  const stdout = typeof input.stdout === "string" ? input.stdout : "";
  const stderr = typeof input.stderr === "string" ? input.stderr : "";
  if (typeof input.stdout !== "string") state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stdout");
  if (typeof input.stderr !== "string") state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stderr");
  state.command.result = Object.freeze({
    outcome: Object.freeze({ kind: "exited" as const, exitCode: input.exitCode }),
    stdout,
    stderr,
  });
}

/** A command timeout is a real terminal fact, unlike external interruption. */
export function captureRunnerCommandTimeout(
  handle: RunnerCommandCaptureHandle | undefined,
): void {
  const state = commandHandleState(handle);
  if (state === undefined) return;
  state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stdout");
  state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stderr");
  recordTerminalCommandResult(state, Object.freeze({
    kind: "terminated" as const,
    reason: "timeout" as const,
  }));
}

/** A command call interrupted after registration is durably terminal/cancelled. */
export function captureRunnerCommandInterrupted(
  handle: RunnerCommandCaptureHandle | undefined,
): void {
  const state = commandHandleState(handle);
  if (state === undefined) return;
  state.runtime.commandLimitations.addCaptureInterrupted("command-capture", "command-manifest");
  state.runtime.commandLimitations.addCaptureInterrupted("command-capture", "command-stdout");
  state.runtime.commandLimitations.addCaptureInterrupted("command-capture", "command-stderr");
  recordTerminalCommandResult(state, Object.freeze({
    kind: "terminated" as const,
    reason: "cancelled" as const,
  }));
}

/** Retains a registered command when the provider cannot return a normal result. */
export function captureRunnerCommandCaptureFailed(
  handle: RunnerCommandCaptureHandle | undefined,
  reason: "transport-lost" | "spawn-failed" = "transport-lost",
): void {
  const state = commandHandleState(handle);
  if (state === undefined) return;
  state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-manifest");
  state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stdout");
  state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stderr");
  recordTerminalCommandResult(
    state,
    reason === "spawn-failed"
      ? Object.freeze({ kind: "not-started" as const, reason: "spawn-failed" as const })
      : Object.freeze({ kind: "terminated" as const, reason: "transport-lost" as const }),
  );
}

function usageNonNegativeInteger(value: unknown): NonNegativeSafeInteger | undefined {
  return typeof value === "number" ? makeNonNegativeSafeInteger(value) : undefined;
}

function canonicalDecimalFromNumber(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const source = String(value);
  const plain = source.includes("e") || source.includes("E")
    ? expandExponentialDecimal(source)
    : source;
  if (plain === undefined) return undefined;
  const normalized = plain.includes(".")
    ? plain.replace(/0+$/u, "").replace(/\.$/u, "")
    : plain;
  return makeCanonicalDecimal(normalized);
}

function expandExponentialDecimal(value: string): string | undefined {
  const match = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/u.exec(value);
  if (match === null) return undefined;
  const integer = match[1] ?? "";
  const fraction = match[2] ?? "";
  const exponent = Number(match[3]);
  if (!Number.isSafeInteger(exponent)) return undefined;
  const digits = `${integer}${fraction}`.replace(/^0+/u, "") || "0";
  if (digits === "0") return "0";
  const decimalIndex = integer.length + exponent;
  if (decimalIndex <= 0) return `0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function appendUsageObservation(
  runtime: RunnerAttemptObservabilityRuntimeState,
  create: (usageObservationId: UsageObservationId, provider: SafeIdentifier) => UsageObservation,
): void {
  if (runtime.usage.length >= MAX_USAGE_OBSERVATIONS) {
    runtime.usageLimitations.addCap("usage-observation", runtime.usage.length);
    return;
  }
  const provider = makeSafeIdentifier(runtime.providerName);
  if (provider === undefined) {
    runtime.usageLimitations.addUnsupported("usage-observation");
    return;
  }
  const usageObservationId = mintRuntimeEntity(runtime, "usage-observation");
  if (usageObservationId === undefined) return;
  runtime.usage.push(create(usageObservationId, provider));
}

/**
 * Captures only the exact Usage passed by SessionManager's terminal onTurn
 * callback. It never looks at an Attempt aggregate or derives a request from
 * a token count.
 */
export function captureRunnerTurnUsage(
  runtimeHandle: RunnerAttemptObservabilityRuntime,
  usage: Usage,
): void {
  const runtime = runtimeState(runtimeHandle);
  if (runtime === undefined || runtime.failure !== undefined) return;
  const tokenBuckets: readonly [keyof Pick<
    Usage,
    "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens" | "reasoningTokens"
  >, Extract<UsageObservation, { readonly kind: "token-bucket" }>["bucket"]][] = [
    ["inputTokens", "input"],
    ["outputTokens", "output"],
    ["cacheReadTokens", "cache-read"],
    ["cacheCreationTokens", "cache-write"],
    ["reasoningTokens", "reasoning"],
  ];
  for (const [field, bucket] of tokenBuckets) {
    const raw = usage[field];
    if (raw === undefined) continue;
    const tokens = usageNonNegativeInteger(raw);
    if (tokens === undefined) {
      runtime.usageLimitations.addUnsupported("usage-observation");
      continue;
    }
    appendUsageObservation(runtime, (usageObservationId, provider) => Object.freeze({
      usageObservationId,
      provider,
      kind: "token-bucket" as const,
      bucket,
      tokens,
      refs: Object.freeze([]),
    }));
  }
  if (usage.requests !== undefined) {
    const requests = usageNonNegativeInteger(usage.requests);
    if (requests === undefined) {
      runtime.usageLimitations.addUnsupported("usage-observation");
    } else {
      for (let request = 0; request < requests; request += 1) {
        appendUsageObservation(runtime, (usageObservationId, provider) => Object.freeze({
          usageObservationId,
          provider,
          kind: "request" as const,
          requestKind: "model" as const,
          refs: Object.freeze([]),
        }));
        if (runtime.usage.length >= MAX_USAGE_OBSERVATIONS) break;
      }
    }
  }
  if (usage.costUSD !== undefined) {
    const amount = canonicalDecimalFromNumber(usage.costUSD);
    if (amount === undefined) {
      runtime.usageLimitations.addUnsupported("usage-observation");
    } else {
      const currency = makeCurrencyCode("USD");
      if (currency === undefined) throw new Error("USD must be a CurrencyCode");
      appendUsageObservation(runtime, (usageObservationId, provider) => Object.freeze({
        usageObservationId,
        provider,
        kind: "provider-cost" as const,
        amount,
        currency,
        refs: Object.freeze([]),
      }));
    }
  }
}

function attemptConversationOutcome(
  result: EvalResult,
  sealed: SealedAttemptAssertions,
): ConversationTurn["outcome"] {
  if (sealed.evaluation.explicitlySkipped) return "cancelled";
  return result.error === undefined && sealed.evaluation.execution === "completed"
    ? "completed"
    : "failed";
}

function standardEventUnavailable(
  result: EvalResult,
  limitations: RunnerCollectionLimitations,
): boolean {
  if (result.events === undefined) {
    limitations.addCaptureFailed("adapter", "conversation-item");
    return true;
  }
  if (result.evidenceCoverage.events.status !== "complete") {
    limitations.addCaptureFailed("adapter", "conversation-item");
  }
  return false;
}

function safeIdentifier(value: string): SafeIdentifier | undefined {
  return makeSafeIdentifier(value);
}

function sourceNativeToolName(value: string): SourceNativeToolName | undefined {
  return makeSourceNativeToolName(value);
}

function stableLabel(value: string): StableLabel | undefined {
  return makeStableLabel(value);
}

function eventCannotBePersisted(
  event: { readonly redacted?: readonly string[]; readonly truncated?: readonly unknown[] },
  limitations: RunnerCollectionLimitations,
): boolean {
  if ((event.redacted?.length ?? 0) > 0) {
    limitations.addRedacted("conversation-item", event.redacted!.length);
    return true;
  }
  if ((event.truncated?.length ?? 0) > 0) {
    limitations.addUnsupported("conversation-item");
    return true;
  }
  return false;
}

function hasConversationCapacity(input: {
  readonly itemCount: number;
  readonly hasTurn: boolean;
  readonly limitations: RunnerCollectionLimitations;
}): boolean {
  if (input.itemCount >= MAX_CONVERSATION_ITEMS) {
    input.limitations.addCap("conversation-item", input.itemCount);
    return false;
  }
  if (!input.hasTurn && input.itemCount >= MAX_CONVERSATION_TURNS) {
    input.limitations.addCap("conversation-item", input.itemCount);
    return false;
  }
  return true;
}

function appendConversationTextLimitation(
  item: ConversationItem | undefined,
  text: RetainedText,
  limitations: RunnerCollectionLimitations,
): void {
  if (item !== undefined && text.omittedBytes !== undefined) {
    limitations.addConversationTextTruncated(
      item.itemId,
      text.retainedBytes,
      text.omittedBytes,
    );
  }
}

function normalizeConversation(input: {
  readonly result: EvalResult;
  readonly sealed: SealedAttemptAssertions;
  readonly mint: AttemptEntityMinter;
  readonly runtime: RunnerAttemptObservabilityRuntimeState;
}): Effect.Effect<NormalizedAttemptObservabilityCapture["conversation"], RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitations();
    if (standardEventUnavailable(input.result, limitations)) {
      return Object.freeze({ collection: limitations.collection(), turns: Object.freeze([]), items: Object.freeze([]) });
    }

    const items: ConversationItem[] = [];
    let turnId: TurnId | undefined;
    const openTools = new Map<string, { readonly callId: CallId; readonly turnId: TurnId }>();
    const openSubagents = new Map<string, { readonly label: SafeIdentifier }>();

    const ensureTurn = (): Effect.Effect<TurnId | undefined, RunnerObservabilityProducerError> => {
      if (turnId !== undefined) return Effect.succeed(turnId);
      if (!hasConversationCapacity({
        itemCount: items.length,
        hasTurn: false,
        limitations,
      })) {
        return Effect.succeed(undefined);
      }
      return Effect.map(input.mint("turn"), (id) => {
        turnId = id;
        return id;
      });
    };

    const appendItem = (
      create: (ids: {
        readonly itemId: ItemId;
        readonly turnId: TurnId;
        readonly sequence: PositiveSafeInteger;
      }) => ConversationItem,
    ): Effect.Effect<ConversationItem | undefined, RunnerObservabilityProducerError> => {
      if (!hasConversationCapacity({
        itemCount: items.length,
        hasTurn: turnId !== undefined,
        limitations,
      })) {
        return Effect.succeed(undefined);
      }
      return Effect.gen(function* () {
        const currentTurn = yield* ensureTurn();
        if (currentTurn === undefined) return undefined;
        const itemId = yield* input.mint("item");
        const item = create(Object.freeze({
          itemId,
          turnId: currentTurn,
          sequence: requiredPositive(items.length + 1),
        }));
        items.push(item);
        return item;
      });
    };

    for (const event of input.result.events ?? []) {
      if (eventCannotBePersisted(event, limitations)) continue;
      switch (event.type) {
        case "message": {
          const text = retainSafeText(event.text, MAX_CONVERSATION_TEXT_BYTES);
          if (text === undefined) {
            limitations.addUnsupported("conversation-item");
            continue;
          }
          const item = yield* appendItem((ids) => Object.freeze({
            ...ids,
            kind: "message" as const,
            role: event.role,
            text: text.text,
            refs: Object.freeze([]),
          }));
          appendConversationTextLimitation(item, text, limitations);
          break;
        }
        case "operation.started": {
          if (event.operation.kind === "tool") {
            // Conversation is the source-native execution record. Canonical
            // ToolName is useful to runtime assertions, but must never replace
            // or rescue the provider's real identity in durable evidence.
            const tool = sourceNativeToolName(event.operation.name);
            const summary = jsonSummary(event.operation.input);
            if (tool === undefined || summary === undefined) {
              limitations.addUnsupported("conversation-item");
              continue;
            }
            if (!hasConversationCapacity({
              itemCount: items.length,
              hasTurn: turnId !== undefined,
              limitations,
            })) continue;
            const callId = yield* input.mint("call");
            const item = yield* appendItem((ids) => Object.freeze({
              ...ids,
              kind: "tool-call" as const,
              callId,
              tool,
              inputSummary: summary.text,
              refs: Object.freeze([]),
            }));
            if (item !== undefined) {
              openTools.set(event.operationId, Object.freeze({ callId, turnId: item.turnId }));
            }
            appendConversationTextLimitation(item, summary, limitations);
            break;
          }

          const label = safeIdentifier(event.operation.name);
          if (label === undefined) {
            limitations.addUnsupported("conversation-item");
            continue;
          }
          const item = yield* appendItem((ids) => Object.freeze({
            ...ids,
            kind: "subagent" as const,
            state: "started" as const,
            label,
            summary: makeBoundedSafeText("Subagent started.", MAX_CONVERSATION_TEXT_BYTES)!,
            refs: Object.freeze([]),
          }));
          if (item !== undefined) openSubagents.set(event.operationId, Object.freeze({ label }));
          break;
        }
        case "operation.finished": {
          if (event.kind === "tool") {
            const open = openTools.get(event.operationId);
            const summary = event.output === undefined ? undefined : jsonSummary(event.output);
            if (open === undefined || summary === undefined) {
              limitations.addUnsupported("conversation-item");
              continue;
            }
            const item = yield* appendItem((ids) => Object.freeze({
              ...ids,
              turnId: open.turnId,
              kind: "tool-result" as const,
              callId: open.callId,
              outcome: event.status,
              outputSummary: summary.text,
              refs: Object.freeze([]),
            }));
            if (item !== undefined) openTools.delete(event.operationId);
            appendConversationTextLimitation(item, summary, limitations);
            break;
          }

          const open = openSubagents.get(event.operationId);
          if (open === undefined) {
            limitations.addUnsupported("conversation-item");
            continue;
          }
          const item = yield* appendItem((ids) => Object.freeze({
            ...ids,
            kind: "subagent" as const,
            state: event.status,
            label: open.label,
            summary: makeBoundedSafeText(
              event.status === "completed" ? "Subagent completed." : "Subagent failed.",
              MAX_CONVERSATION_TEXT_BYTES,
            )!,
            refs: Object.freeze([]),
          }));
          if (item !== undefined) openSubagents.delete(event.operationId);
          break;
        }
        case "skill.loaded": {
          const skill = safeIdentifier(event.skill);
          if (skill === undefined) {
            limitations.addUnsupported("conversation-item");
            continue;
          }
          yield* appendItem((ids) => Object.freeze({
            ...ids,
            kind: "skill-load" as const,
            skill,
            outcome: "loaded" as const,
            refs: Object.freeze([]),
          }));
          break;
        }
        case "input.requested": {
          const source = event.request.prompt ?? event.request.display;
          const summary = source === undefined
            ? (event.request.input === undefined ? undefined : jsonSummary(event.request.input))
            : retainSafeText(source, MAX_CONVERSATION_TEXT_BYTES);
          if (summary === undefined) {
            limitations.addUnsupported("conversation-item");
            continue;
          }
          const item = yield* appendItem((ids) => Object.freeze({
            ...ids,
            kind: "input-request" as const,
            state: "requested" as const,
            promptSummary: summary.text,
            responseSummary: null,
            refs: Object.freeze([]),
          }));
          appendConversationTextLimitation(item, summary, limitations);
          // StreamEvent has no corresponding response event, so null cannot
          // claim a complete request/response capture.
          limitations.addCaptureFailed("adapter", "conversation-item");
          break;
        }
        case "context.injected": {
          const source = event.source;
          const summary = retainSafeText(event.text, MAX_CONVERSATION_TEXT_BYTES);
          if (
            summary === undefined ||
            (source !== "system" && source !== "memory" && source !== "skill" && source !== "user")
          ) {
            limitations.addUnsupported("conversation-item");
            continue;
          }
          const item = yield* appendItem((ids) => Object.freeze({
            ...ids,
            kind: "context-injection" as const,
            source,
            summary: summary.text,
            refs: Object.freeze([]),
          }));
          appendConversationTextLimitation(item, summary, limitations);
          break;
        }
        case "error": {
          const redacted = redactSensitiveText(event.message, input.runtime.sensitiveValues);
          if (redacted !== event.message) limitations.addRedacted("conversation-text");
          const summary = retainSafeText(redacted, MAX_CONVERSATION_TEXT_BYTES);
          if (summary === undefined) {
            limitations.addUnsupported("conversation-item");
            continue;
          }
          const item = yield* appendItem((ids) => Object.freeze({
            ...ids,
            kind: "conversation-error" as const,
            code: makeSafeIdentifier("stream-error")!,
            summary: summary.text,
            refs: Object.freeze([]),
          }));
          appendConversationTextLimitation(item, summary, limitations);
          break;
        }
        // Thinking can contain hidden reasoning, and compaction has no safe
        // item count in StreamEvent. Both are deliberately retained only as
        // structured partial coverage, never as invented summaries.
        case "thinking":
        case "compaction":
          limitations.addUnsupported("conversation-item");
          break;
      }
    }

    if (openTools.size > 0 || openSubagents.size > 0) {
      limitations.addUnsupported("conversation-item", openTools.size + openSubagents.size);
    }
    const turns: readonly ConversationTurn[] = turnId === undefined
      ? Object.freeze([])
      : Object.freeze([Object.freeze({
          turnId,
          sequence: requiredPositive(1),
          outcome: attemptConversationOutcome(input.result, input.sealed),
          refs: Object.freeze([]),
        })]);
    return Object.freeze({
      collection: limitations.collection(),
      turns,
      items: Object.freeze([...items]),
    });
  });
}

function commandSafeText(input: {
  readonly commandId: CommandId;
  readonly value: string;
  readonly maximumBytes: number;
  readonly target: "command-manifest" | "command-stdout" | "command-stderr";
  readonly runtime: RunnerAttemptObservabilityRuntimeState;
}): SafeText {
  const redacted = redactSensitiveText(input.value, input.runtime.sensitiveValues);
  if (redacted !== input.value) input.runtime.commandLimitations.addRedacted(input.target);
  const retained = retainSafeText(redacted, input.maximumBytes);
  if (retained === undefined) {
    // A registered command must retain its manifest even when a provider text
    // field cannot be represented safely. The partial collection records the
    // replacement rather than dropping the command.
    input.runtime.commandLimitations.addCaptureFailed("command-capture", input.target);
    const replacement = makeBoundedSafeText("[unavailable]", input.maximumBytes);
    if (replacement === undefined) {
      throw new Error("The fixed unavailable command marker must be SafeText");
    }
    return replacement;
  }
  if (retained.omittedBytes !== undefined) {
    input.runtime.commandLimitations.addCommandManifestTextTruncated(
      input.commandId,
      retained.retainedBytes,
      retained.omittedBytes,
    );
  }
  return retained.text;
}

function isProjectRelativeCommandPath(value: string): boolean {
  return (
    makeBoundedSafeText(value, MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES) !== undefined &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes(":") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function commandWorkingDirectory(
  options: unknown,
  runtime: RunnerAttemptObservabilityRuntimeState,
): CommandManifest["workingDirectory"] {
  const candidate = options as Partial<Pick<CommandOptions, "cwd">> | undefined;
  const cwd = candidate?.cwd;
  if (cwd === undefined || cwd === ".") return Object.freeze({ kind: "sandbox-default" as const });
  if (typeof cwd !== "string") {
    runtime.commandLimitations.addUnsupported("command-manifest");
    return Object.freeze({ kind: "redacted" as const });
  }
  const redacted = redactSensitiveText(cwd, runtime.sensitiveValues);
  if (redacted !== cwd) runtime.commandLimitations.addRedacted("command-manifest");
  if (isProjectRelativeCommandPath(redacted)) {
    return Object.freeze({ kind: "project-relative" as const, path: redacted });
  }
  // Absolute, dot-segment and otherwise unsafe cwd values are deliberately
  // not normalized into an apparently portable path.
  runtime.commandLimitations.addRedacted("command-manifest");
  return Object.freeze({ kind: "redacted" as const });
}

function commandManifest(
  command: CapturedCommandRuntime,
  runtime: RunnerAttemptObservabilityRuntimeState,
): CommandManifest {
  const phase = commandManifestPhase(command.phase);
  const workingDirectory = commandWorkingDirectory(command.options, runtime);
  if (command.invocationKind === "shell") {
    const script = commandSafeText({
      commandId: command.commandId,
      value: command.command,
      maximumBytes: MAX_COMMAND_SHELL_BYTES,
      target: "command-manifest",
      runtime,
    });
    return Object.freeze({
      phase,
      invocation: Object.freeze({ kind: "shell" as const, command: script }),
      workingDirectory,
    });
  }
  const sourceArguments = command.args ?? [];
  if (sourceArguments.length > MAX_COMMAND_ARGUMENTS) {
    runtime.commandLimitations.addUnsupported("command-manifest");
  }
  const executable = commandSafeText({
    commandId: command.commandId,
    value: command.command,
    maximumBytes: MAX_COMMAND_EXECUTABLE_BYTES,
    target: "command-manifest",
    runtime,
  });
  const arguments_: SafeText[] = [];
  for (const raw of sourceArguments.slice(0, MAX_COMMAND_ARGUMENTS)) {
    const argument = commandSafeText({
      commandId: command.commandId,
      value: raw,
      maximumBytes: MAX_COMMAND_ARGUMENT_BYTES,
      target: "command-manifest",
      runtime,
    });
    arguments_.push(argument);
  }
  return Object.freeze({
    phase,
    invocation: Object.freeze({
      kind: "argv" as const,
      executable,
      arguments: Object.freeze([...arguments_]),
    }),
    workingDirectory,
  });
}

function stripUnsafeCommandControls(value: string): { readonly text: string; readonly count: number } {
  let text = "";
  let count = 0;
  for (const scalar of value) {
    const code = scalar.codePointAt(0);
    if (
      code !== undefined &&
      ((code >= 0 && code <= 0x1f && code !== 0x0a) || (code >= 0x7f && code <= 0x9f))
    ) {
      count += 1;
      continue;
    }
    text += scalar;
  }
  return Object.freeze({ text, count });
}

function emptyCommandStream(): NormalizedCommandStreamCapture {
  const text = makeBoundedSafeText("", MAX_COMMAND_STREAM_BYTES);
  if (text === undefined) throw new Error("An empty command stream must be SafeText");
  return Object.freeze({ text, totalSafeUtf8Bytes: requiredNonNegative(0) });
}

function commandStream(input: {
  readonly commandId: CommandId;
  readonly stream: "stdout" | "stderr";
  readonly value: string;
  readonly runtime: RunnerAttemptObservabilityRuntimeState;
}): NormalizedCommandStreamCapture {
  const target = input.stream === "stdout" ? "command-stdout" as const : "command-stderr" as const;
  const redacted = redactSensitiveText(input.value, input.runtime.sensitiveValues);
  if (redacted !== input.value) input.runtime.commandLimitations.addRedacted(target);
  const stripped = stripUnsafeCommandControls(redacted);
  if (stripped.count > 0) {
    input.runtime.commandLimitations.addUnsafeCommandControlStripped(
      input.commandId,
      input.stream,
      stripped.count,
    );
  }
  const retained = retainSafeText(stripped.text, MAX_COMMAND_STREAM_BYTES);
  if (retained === undefined) {
    input.runtime.commandLimitations.addCaptureFailed("command-capture", target);
    return emptyCommandStream();
  }
  if (retained.omittedBytes !== undefined) {
    input.runtime.commandLimitations.addCommandStreamTruncated(
      input.commandId,
      input.stream,
      retained.retainedBytes,
      retained.omittedBytes,
    );
  }
  const totalSafeUtf8Bytes = retained.omittedBytes === undefined
    ? retained.retainedBytes
    : requiredNonNegative(retained.retainedBytes + retained.omittedBytes);
  return Object.freeze({ text: retained.text, totalSafeUtf8Bytes });
}

function normalizeCommands(
  runtime: RunnerAttemptObservabilityRuntimeState,
): NormalizedAttemptObservabilityCapture["commands"] {
  const commands: NormalizedCommandObservationCapture[] = [];
  for (const captured of runtime.commands) {
    if (captured.result === undefined) {
      // The manifest was registered before the sandbox call. If its normal
      // result never arrived, retain it with the only accurate fallback: the
      // transport did not provide a terminal command result.
      runtime.commandLimitations.addCaptureFailed("command-capture", "command-manifest");
      runtime.commandLimitations.addCaptureFailed("command-capture", "command-stdout");
      runtime.commandLimitations.addCaptureFailed("command-capture", "command-stderr");
      recordTerminalCommandResult(
        Object.freeze({ runtime, command: captured }),
        Object.freeze({ kind: "terminated" as const, reason: "transport-lost" as const }),
      );
    }
    const result = captured.result;
    if (result === undefined) {
      markRuntimeFailure(runtime, producerCommandRegistrationInvalid());
      continue;
    }
    const manifest = commandManifest(captured, runtime);
    const stdout = commandStream({
      commandId: captured.commandId,
      stream: "stdout",
      value: result.stdout,
      runtime,
    });
    const stderr = commandStream({
      commandId: captured.commandId,
      stream: "stderr",
      value: result.stderr,
      runtime,
    });
    commands.push(Object.freeze({
      commandId: captured.commandId,
      manifest,
      result: Object.freeze({ outcome: result.outcome, stdout, stderr }),
      refs: Object.freeze([]),
    }));
  }
  return Object.freeze({
    collection: runtime.commandLimitations.collection(),
    commands: Object.freeze(
      [...commands].sort((left, right) => compareObservabilityText(left.commandId, right.commandId)),
    ),
  });
}

function normalizeUsage(input: {
  readonly result: EvalResult;
  readonly runtime: RunnerAttemptObservabilityRuntimeState;
}): NormalizedAttemptObservabilityCapture["usage"] {
  // EvalResult.usage remains an aggregate for legacy consumers. Only records
  // captured from actual Session onTurn values above enter this family.
  if (input.result.evidenceCoverage.usage.status !== "complete") {
    input.runtime.usageLimitations.addCaptureFailed("usage-capture", "usage-observation");
  }
  if (input.result.retryAttempts?.some((attempt) => attempt.usage !== undefined) === true) {
    // Retry attempts carry real Usage, but Session's terminal onTurn callback
    // did not expose a separate turn for them. Do not reconstruct them from
    // the aggregate; state the missing atomic capture instead.
    input.runtime.usageLimitations.addCaptureFailed("usage-capture", "usage-observation");
  }
  return Object.freeze({
    collection: input.runtime.usageLimitations.collection(),
    observations: Object.freeze(
      [...input.runtime.usage].sort((left, right) =>
        compareObservabilityText(left.usageObservationId, right.usageObservationId),
      ),
    ),
  });
}

type AttemptTimingProjection =
  | {
      readonly kind: "attempt";
      readonly phase: AttemptTimingInterval["phase"];
      readonly label: StableLabel;
    }
  | { readonly kind: "outside-attempt-domain" }
  | { readonly kind: "unsupported" };

function attemptTimingProjection(phase: string): AttemptTimingProjection {
  const label = stableLabel(phase);
  if (label === undefined) return Object.freeze({ kind: "unsupported" as const });
  switch (phase) {
    case "sandbox.create":
    case "workspace.baseline":
    case "agent.setup":
    case "telemetry.configure":
    case "sandbox.queue":
      return Object.freeze({ kind: "attempt" as const, phase: "attempt.setup" as const, label });
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
    case "sandbox.prepare.group":
    case "sandbox.prepare.experiment":
      return Object.freeze({ kind: "attempt" as const, phase: "sandbox.prepare" as const, label });
    case "agent.ensure":
      return Object.freeze({ kind: "attempt" as const, phase: "agent.ensure" as const, label });
    case "eval.run":
      return Object.freeze({ kind: "attempt" as const, phase: "eval.run" as const, label });
    case "assertions.evaluate":
      return Object.freeze({ kind: "attempt" as const, phase: "assertion.evaluate" as const, label });
    case "agent.teardown":
    case "sandbox.cleanup":
    case "sandbox.suspend":
    case "sandbox.stop":
    case "workspace.diff":
    case "telemetry.collect":
      return Object.freeze({ kind: "attempt" as const, phase: "attempt.teardown" as const, label });
    case "judge.precheck":
    case "experiment.setup":
    case "experiment.teardown":
    case "agent.run":
      return Object.freeze({ kind: "outside-attempt-domain" as const });
    default:
      return Object.freeze({ kind: "unsupported" as const });
  }
}

function validPhaseDuration(value: PhaseTiming): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeInteger(value.durationMs);
}

function timingActivityProjection(
  activity: TimingActivity,
): { readonly phase: AttemptTimingInterval["phase"]; readonly label: StableLabel } | undefined {
  const phase = (() => {
    switch (activity.key) {
    case "agent.turn":
      return "agent.send" as const;
    case "sandbox.command":
      return "sandbox.command" as const;
    case "sandbox.prepare":
      return "sandbox.prepare" as const;
    case "workspace.diff.export":
      return "attempt.teardown" as const;
    default:
      return undefined;
    }
  })();
  if (phase === undefined) return undefined;
  // Runner's activity label is human-facing and can contain spaces or other
  // SafeText punctuation. v1 persists only StableLabel, so standard activities
  // retain a stable key when their display label cannot cross that boundary.
  const label = stableLabel(activity.label) ?? stableLabel(activity.key);
  if (label === undefined) return undefined;
  return Object.freeze({ phase, label });
}

function validTimingActivityStart(activity: TimingActivity): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeInteger(activity.startOffsetMs);
}

function validTimingActivityDuration(activity: TimingActivity): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeInteger(activity.durationMs);
}

function timingSpanContains(input: {
  readonly parentStartOffsetMs: NonNegativeSafeInteger;
  readonly parentDurationMs: NonNegativeSafeInteger;
  readonly childStartOffsetMs: NonNegativeSafeInteger;
  readonly childDurationMs: NonNegativeSafeInteger;
}): boolean {
  const parentEnd = input.parentStartOffsetMs + input.parentDurationMs;
  const childEnd = input.childStartOffsetMs + input.childDurationMs;
  return (
    Number.isSafeInteger(parentEnd) &&
    Number.isSafeInteger(childEnd) &&
    input.parentStartOffsetMs <= input.childStartOffsetMs &&
    childEnd <= parentEnd
  );
}

function normalizeAttemptTiming(input: {
  readonly result: EvalResult;
  readonly mint: AttemptEntityMinter;
}): Effect.Effect<NormalizedAttemptObservabilityCapture["timing"], RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitations();
    const phases = input.result.phases;
    if (phases === undefined) {
      limitations.addCaptureFailed("timing-capture", "timing-interval");
      return Object.freeze({ collection: limitations.collection(), intervals: Object.freeze([]) });
    }

    const intervals: AttemptTimingInterval[] = [];
    const appendActivities = (
      activities: readonly TimingActivity[] | undefined,
      parent: {
        readonly intervalId: IntervalId;
        readonly startOffsetMs: NonNegativeSafeInteger;
        /** Offset in the Runner's unfiltered phase clock. */
        readonly sourceStartOffsetMs: NonNegativeSafeInteger;
        readonly durationMs: NonNegativeSafeInteger;
      } | undefined,
      ancestors: ReadonlySet<TimingActivity>,
    ): Effect.Effect<void, RunnerObservabilityProducerError> => Effect.gen(function* () {
      for (const activity of activities ?? []) {
        if (ancestors.has(activity)) {
          limitations.addUnsupported("timing-interval");
          continue;
        }
        const projection = timingActivityProjection(activity);
        const sourceStartOffsetMs = validTimingActivityStart(activity);
        const durationMs = validTimingActivityDuration(activity);
        const relativeStartOffsetMs = parent === undefined || sourceStartOffsetMs === undefined
          ? sourceStartOffsetMs
          : makeNonNegativeSafeInteger(sourceStartOffsetMs - parent.sourceStartOffsetMs);
        const translatedStartOffsetMs = parent === undefined || relativeStartOffsetMs === undefined
          ? relativeStartOffsetMs
          : makeNonNegativeSafeInteger(parent.startOffsetMs + relativeStartOffsetMs);
        // A known activity with safe source-clock values remains a fact even
        // when this parent-relative conversion cannot be proven. Persist its
        // original interval as a root rather than turning a missing causal
        // edge into an unsupported-input limitation.
        const startOffsetMs = translatedStartOffsetMs ?? sourceStartOffsetMs;
        if (
          projection === undefined
          || sourceStartOffsetMs === undefined
          || startOffsetMs === undefined
          || durationMs === undefined
        ) {
          limitations.addUnsupported("timing-interval");
          continue;
        }
        if (intervals.length >= MAX_TIMING_INTERVALS) {
          limitations.addCap("timing-interval", intervals.length);
          continue;
        }
        const intervalId = yield* input.mint("interval");
        const parentIntervalId = parent === undefined || translatedStartOffsetMs === undefined
          ? null
          : timingSpanContains({
              parentStartOffsetMs: parent.startOffsetMs,
              parentDurationMs: parent.durationMs,
              childStartOffsetMs: startOffsetMs,
              childDurationMs: durationMs,
            })
            ? parent.intervalId
            : null;
        intervals.push(Object.freeze({
          intervalId,
          phase: projection.phase,
          label: projection.label,
          startOffsetMs,
          durationMs,
          parentIntervalId,
          outcome: activity.failed ? "failed" as const : "completed" as const,
          refs: Object.freeze([]),
        }));
        const nextAncestors = new Set(ancestors);
        nextAncestors.add(activity);
        yield* appendActivities(
          activity.children,
          Object.freeze({
            intervalId,
            startOffsetMs,
            sourceStartOffsetMs,
            durationMs,
          }),
          nextAncestors,
        );
      }
    });
    // `phases` also carries a few known Run-owned anchors for first-dispatched
    // work. Keep their raw clock for child translation, but do not let them
    // create gaps in the Attempt execution-duration clock.
    let sourceOffset: NonNegativeSafeInteger | undefined = requiredNonNegative(0);
    let attemptOffset: NonNegativeSafeInteger | undefined = requiredNonNegative(0);
    for (const source of phases) {
      const duration = validPhaseDuration(source);
      const projection = attemptTimingProjection(source.name);
      if (
        duration === undefined
        || projection.kind === "unsupported"
        || sourceOffset === undefined
        || attemptOffset === undefined
      ) {
        limitations.addUnsupported("timing-interval");
      } else if (projection.kind === "attempt" && intervals.length >= MAX_TIMING_INTERVALS) {
        limitations.addCap("timing-interval", intervals.length);
      } else if (projection.kind === "attempt") {
        const intervalId = yield* input.mint("interval");
        intervals.push(Object.freeze({
          intervalId,
          phase: projection.phase,
          label: projection.label,
          startOffsetMs: attemptOffset,
          durationMs: duration,
          parentIntervalId: null,
          outcome: source.failed ? "failed" as const : "completed" as const,
          refs: Object.freeze([]),
        }));
        yield* appendActivities(
          source.children,
          Object.freeze({
            intervalId,
            startOffsetMs: attemptOffset,
            sourceStartOffsetMs: sourceOffset,
            durationMs: duration,
          }),
          new Set(),
        );
      }
      if (duration === undefined || sourceOffset === undefined || attemptOffset === undefined) {
        sourceOffset = undefined;
        attemptOffset = undefined;
      } else {
        sourceOffset = makeNonNegativeSafeInteger(sourceOffset + duration);
        if (projection.kind !== "outside-attempt-domain") {
          attemptOffset = makeNonNegativeSafeInteger(attemptOffset + duration);
        }
      }
    }
    return Object.freeze({
      collection: limitations.collection(),
      // The durable timing family canonically orders by opaque entity id; the
      // offsets retain the Runner's actual lifecycle order.
      intervals: Object.freeze(
        [...intervals].sort((left, right) =>
          compareObservabilityText(left.intervalId, right.intervalId),
        ),
      ),
    });
  });
}

function attemptDiagnosticPhase(
  origin: TimingOrigin | undefined,
): AttemptDiagnostic["phase"] {
  if (origin === undefined || origin.scope !== "attempt") return "collection";
  switch (origin.phase) {
    case "sandbox.create":
    case "workspace.baseline":
    case "agent.setup":
    case "telemetry.configure":
      return "attempt.setup";
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
    case "sandbox.prepare.group":
    case "sandbox.prepare.experiment":
      return "sandbox.prepare";
    case "agent.ensure":
      return "agent.ensure";
    case "eval.run":
      return "eval.run";
    case "agent.run":
      return "agent.send";
    case "assertions.evaluate":
      return "assertion.evaluate";
    case "agent.teardown":
    case "sandbox.cleanup":
    case "sandbox.suspend":
    case "sandbox.stop":
      return "attempt.teardown";
    case "judge.precheck":
    case "experiment.setup":
    case "experiment.teardown":
    case "sandbox.queue":
    case "workspace.diff":
    case "telemetry.collect":
      return "collection";
  }
}

function normalizeAttemptDiagnostics(input: {
  readonly result: EvalResult;
  readonly mint: AttemptEntityMinter;
}): Effect.Effect<NormalizedAttemptObservabilityCapture["diagnostics"], RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitations();
    const diagnostics: AttemptDiagnostic[] = [];
    const append = (
      value: {
        readonly code: string;
        readonly detail: string;
        readonly kind: AttemptDiagnostic["kind"];
        readonly origin?: DiagnosticRecord["origin"];
      },
    ): Effect.Effect<void, RunnerObservabilityProducerError> => {
      const code = makeSafeIdentifier(value.code);
      if (code === undefined) {
        limitations.addUnsupported("diagnostic");
        return Effect.void;
      }
      const retainedSummary = makeBoundedSafeText(
        value.detail,
        MAX_DIAGNOSTIC_SUMMARY_BYTES,
      );
      if (retainedSummary === undefined) {
        limitations.addUnsupported("diagnostic");
      }
      if (diagnostics.length >= MAX_DIAGNOSTICS) {
        limitations.addCap("diagnostic", diagnostics.length);
        return Effect.void;
      }
      return Effect.map(input.mint("diagnostic"), (diagnosticId) => {
        diagnostics.push(Object.freeze({
          diagnosticId: diagnosticId as DiagnosticId,
          kind: value.kind,
          code,
          phase: attemptDiagnosticPhase(value.origin),
          // The result's one-line detail is already Runner-redacted. Causes,
          // stacks, paths, and arbitrary context remain outside this durable
          // family. An unsafe or oversized detail is deliberately replaced by
          // a generic bounded summary and represented as partial coverage.
          summary: retainedSummary ?? makeBoundedSafeText(
            value.kind === "execution-error"
              ? "Runner recorded an execution error."
              : "Runner recorded an advisory diagnostic.",
            MAX_DIAGNOSTIC_SUMMARY_BYTES,
          )!,
          causes: Object.freeze([]),
          context: Object.freeze([]),
          redaction: Object.freeze({ state: "none" as const }),
          sourceFrame: null,
          refs: Object.freeze([]),
        }));
      });
    };

    if (input.result.error !== undefined) {
      yield* append(Object.freeze({
        code: input.result.error.code,
        detail: input.result.error.message,
        kind: "execution-error" as const,
        origin: input.result.error.origin,
      }));
    }
    for (const diagnostic of input.result.diagnostics ?? []) {
      yield* append(Object.freeze({
        code: diagnostic.code,
        detail: diagnostic.detail,
        kind: diagnostic.level === "error" ? "execution-error" as const : "advisory" as const,
        ...(diagnostic.origin === undefined ? {} : { origin: diagnostic.origin }),
      }));
    }
    return Object.freeze({
      collection: limitations.collection(),
      diagnostics: Object.freeze(
        [...diagnostics].sort((left, right) =>
          compareObservabilityText(left.diagnosticId, right.diagnosticId),
        ),
      ),
    });
  });
}

function runDiagnosticPhase(
  origin: TimingOrigin | undefined,
): RunDiagnostic["phase"] {
  // Runner's existing experiment diagnostic accumulator predates the
  // owner-local Attachment and represents its lifecycle anchor as an Attempt
  // origin. Its phase is still a real Run fact; no timing-node or provider
  // attribute is inferred here.
  switch (origin?.scope === "attempt" ? origin.phase : undefined) {
    case "judge.precheck":
    case "experiment.setup":
      return "run.setup";
    case "sandbox.queue":
      return "run.dispatch";
    case "experiment.teardown":
      return "run.teardown";
    default:
      return "collection";
  }
}

function normalizeRunDiagnostics(input: {
  readonly diagnostics: readonly DiagnosticRecord[] | undefined;
  readonly mint: RunEntityMinter;
}): Effect.Effect<NormalizedRunObservabilityCapture["diagnostics"], RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitations();
    if (input.diagnostics === undefined) {
      limitations.addCaptureFailed("run-teardown", "diagnostic");
      return Object.freeze({ collection: limitations.collection(), diagnostics: Object.freeze([]) });
    }

    const diagnostics: RunDiagnostic[] = [];
    for (const source of input.diagnostics) {
      const code = makeSafeIdentifier(source.code);
      if (code === undefined) {
        limitations.addUnsupported("diagnostic");
        continue;
      }
      const summary = makeBoundedSafeText(source.detail, MAX_DIAGNOSTIC_SUMMARY_BYTES);
      if (summary === undefined) limitations.addUnsupported("diagnostic");
      if (diagnostics.length >= MAX_DIAGNOSTICS) {
        limitations.addCap("diagnostic", diagnostics.length);
        continue;
      }
      const diagnosticId = yield* input.mint("diagnostic");
      diagnostics.push(Object.freeze({
        diagnosticId: diagnosticId as DiagnosticId,
        kind: source.level === "error" ? "execution-error" as const : "advisory" as const,
        code,
        phase: runDiagnosticPhase(source.origin),
        summary: summary ?? makeBoundedSafeText(
          source.level === "error"
            ? "Runner recorded an execution error."
            : "Runner recorded an advisory diagnostic.",
          MAX_DIAGNOSTIC_SUMMARY_BYTES,
        )!,
        causes: Object.freeze([]),
        context: Object.freeze([]),
        redaction: Object.freeze({ state: "none" as const }),
        sourceFrame: null,
        refs: Object.freeze([]),
      }));
    }
    return Object.freeze({
      collection: limitations.collection(),
      diagnostics: Object.freeze(
        [...diagnostics].sort((left, right) =>
          compareObservabilityText(left.diagnosticId, right.diagnosticId),
        ),
      ),
    });
  });
}

/**
 * Normalizes only facts already sealed by Runner. It never reads legacy
 * result.json, raw transcript/provider data, Report/Sample data, or paths.
 */
export function createRunnerAttemptObservabilityCapture(input: {
  readonly result: EvalResult;
  readonly sealed: SealedAttemptAssertions;
}): Effect.Effect<
  NormalizedAttemptObservabilityCapture,
  RunnerObservabilityProducerError
> {
  return Effect.gen(function* () {
    const runtime = runnerAttemptResultStates.get(input.result);
    if (runtime === undefined) return yield* Effect.fail(producerCaptureMissing());
    if (runtime.failure !== undefined) return yield* Effect.fail(runtime.failure);
    const minter = makeAttemptEntityMinter(runtime);
    const commands = normalizeCommands(runtime);
    const usage = normalizeUsage({ result: input.result, runtime });
    const conversation = yield* normalizeConversation({
      result: input.result,
      sealed: input.sealed,
      mint: minter.mint,
      runtime,
    });
    const timing = yield* normalizeAttemptTiming({ result: input.result, mint: minter.mint });
    const diagnostics = yield* normalizeAttemptDiagnostics({ result: input.result, mint: minter.mint });
    if (runtime.failure !== undefined) return yield* Effect.fail(runtime.failure);
    if (!minter.seal()) return yield* Effect.fail(producerCaptureSealInvalid("attempt"));
    return Object.freeze({
      conversation,
      commands,
      usage,
      timing,
      diagnostics,
    });
  });
}

/**
 * The generic Record adapter receives only per-experiment facts that Runner
 * can safely attribute to one Run. Invocation-wide timing remains partial:
 * its single clock cannot be copied into every Run without inventing owner
 * attribution. Settled Run diagnostics are bound by run.ts immediately before
 * this same publish boundary.
 */
export function createRunnerRunObservabilityCapture(input: {
  readonly run: AgentRun;
}): Effect.Effect<NormalizedRunObservabilityCapture, RunnerObservabilityProducerError> {
  return Effect.gen(function* () {
    const capture = makeRunObservabilityCaptureIdentity();
    const minter = makeRunEntityMinter(capture);
    const timingLimitations = new RunnerCollectionLimitations();
    timingLimitations.addCaptureFailed("run-teardown", "timing-interval");
    const diagnostics = yield* normalizeRunDiagnostics({
      diagnostics: runnerRunDiagnostics.get(input.run),
      mint: minter.mint,
    });
    if (!minter.seal()) return yield* Effect.fail(producerCaptureSealInvalid("run"));
    return Object.freeze({
      timing: Object.freeze({
        collection: timingLimitations.collection(),
        intervals: Object.freeze([]),
      }),
      diagnostics,
    });
  });
}
