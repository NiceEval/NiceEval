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
  makeAttemptObservabilityCaptureIdentityV1,
  makeRunObservabilityCaptureIdentityV1,
  mintAttemptObservabilityEntityV1,
  mintRunObservabilityEntityV1,
  recordRegisteredCommandResultV1,
  registerCommandCaptureV1,
  registeredCommandIdV1,
  sealAttemptObservabilityCaptureIdentityV1,
  sealRunObservabilityCaptureIdentityV1,
  type AttemptObservabilityCaptureIdentityV1,
  type AttemptCapturedObservabilityEntityV1,
  type RegisteredCommandCaptureV1,
  type RunObservabilityCaptureIdentityV1,
} from "./capture.ts";
import {
  type AttemptDiagnosticV1,
  type AttemptTimingIntervalV1,
  type CommandManifestV1,
  type ConversationItemV1,
  type ConversationTurnV1,
  type RunDiagnosticV1,
  type UsageObservationV1,
} from "./families.ts";
import type {
  NormalizedCommandObservationCaptureV1,
  NormalizedCommandStreamCaptureV1,
  NormalizedAttemptObservabilityCaptureV1,
  NormalizedRunObservabilityCaptureV1,
} from "./family-writers.ts";
import {
  MAX_COMMAND_ARGUMENT_BYTES_V1,
  MAX_COMMAND_ARGUMENTS_V1,
  MAX_COMMAND_EXECUTABLE_BYTES_V1,
  MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES_V1,
  MAX_COMMAND_SHELL_BYTES_V1,
  MAX_COMMAND_STREAM_BYTES_V1,
  MAX_COMMANDS_V1,
  MAX_CONVERSATION_ITEMS_V1,
  MAX_CONVERSATION_TEXT_BYTES_V1,
  MAX_CONVERSATION_TURNS_V1,
  MAX_DIAGNOSTIC_SUMMARY_BYTES_V1,
  MAX_DIAGNOSTICS_V1,
  MAX_TIMING_INTERVALS_V1,
  MAX_USAGE_OBSERVATIONS_V1,
} from "./limits.ts";
import {
  compareObservabilityTextV1,
  compareObservabilityLimitationV1,
  entityIdFromEntropyV1,
  makeBoundedSafeTextV1,
  makeCanonicalDecimalV1,
  makeCurrencyCodeV1,
  makeNonNegativeSafeIntegerV1,
  makePositiveSafeIntegerV1,
  makeSafeIdentifierV1,
  makeSourceNativeToolNameV1,
  makeStableLabelV1,
  utf8ByteLengthV1,
  type AttemptReferenceTargetV1,
  type CommandIdV1,
  type CommandReferenceTargetV1,
  type CollectionStageV1,
  type CollectionTargetV1,
  type CollectionV1,
  type DiagnosticIdV1,
  type IntervalIdV1,
  type ItemIdV1,
  type NonNegativeSafeInteger,
  type ObservabilityEntityIdForKindV1,
  type ObservabilityEntityKindV1,
  type ObservabilityLimitationV1,
  type PositiveSafeInteger,
  type RunReferenceTargetV1,
  type SafeIdentifier,
  type SafeText,
  type SourceNativeToolName,
  type StableLabel,
  type TurnIdV1,
  type CallIdV1,
  type UsageObservationIdV1,
} from "./model.ts";

/**
 * The Runner never exposes raw provider frames to the Record layer. These
 * errors therefore carry only an internal stable code and entity kind.
 */
export type RunnerObservabilityProducerErrorV1 =
  | {
      readonly code: "runner-observability-entity-id-invalid";
      readonly kind: ObservabilityEntityKindV1;
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
  kind: ObservabilityEntityKindV1,
): RunnerObservabilityProducerErrorV1 {
  return Object.freeze({
    code: "runner-observability-entity-id-invalid" as const,
    kind,
  });
}

function producerCaptureSealInvalid(
  owner: "attempt" | "run",
): RunnerObservabilityProducerErrorV1 {
  return Object.freeze({
    code: "runner-observability-capture-seal-invalid" as const,
    owner,
  });
}

function producerCaptureMissing(): RunnerObservabilityProducerErrorV1 {
  return Object.freeze({ code: "runner-observability-capture-missing" as const });
}

function producerCommandRegistrationInvalid(): RunnerObservabilityProducerErrorV1 {
  return Object.freeze({ code: "runner-observability-command-registration-invalid" as const });
}

function requiredPositive(value: number): PositiveSafeInteger {
  const positive = makePositiveSafeIntegerV1(value);
  if (positive !== undefined) return positive;
  const fallback = makePositiveSafeIntegerV1(1);
  if (fallback === undefined) throw new Error("One must be a positive safe integer");
  return fallback;
}

function requiredNonNegative(value: number): NonNegativeSafeInteger {
  const nonNegative = makeNonNegativeSafeIntegerV1(value);
  if (nonNegative !== undefined) return nonNegative;
  const fallback = makeNonNegativeSafeIntegerV1(0);
  if (fallback === undefined) throw new Error("Zero must be a non-negative safe integer");
  return fallback;
}

/** Coalesces and canonically orders the closed durable limitation union. */
class RunnerCollectionLimitationsV1 {
  private readonly captureFailed = new Map<string, {
    readonly stage: CollectionStageV1;
    readonly target: CollectionTargetV1;
  }>();
  private readonly captureInterrupted = new Map<string, {
    readonly stage: CollectionStageV1;
    readonly target: CollectionTargetV1;
  }>();
  private readonly unsupported = new Map<CollectionTargetV1, number>();
  private readonly redacted = new Map<CollectionTargetV1, number>();
  private readonly caps = new Map<CollectionTargetV1, {
    readonly retained: number;
    readonly omittedAtLeast: number;
  }>();
  private readonly textTruncations: ObservabilityLimitationV1[] = [];

  addCaptureFailed(stage: CollectionStageV1, target: CollectionTargetV1): void {
    this.captureFailed.set(`${stage}\u0000${target}`, Object.freeze({ stage, target }));
  }

  addCaptureInterrupted(stage: CollectionStageV1, target: CollectionTargetV1): void {
    this.captureInterrupted.set(`${stage}\u0000${target}`, Object.freeze({ stage, target }));
  }

  addUnsupported(target: CollectionTargetV1, omittedAtLeast = 1): void {
    this.unsupported.set(target, (this.unsupported.get(target) ?? 0) + omittedAtLeast);
  }

  addRedacted(target: CollectionTargetV1, replacements = 1): void {
    this.redacted.set(target, (this.redacted.get(target) ?? 0) + replacements);
  }

  addCap(target: CollectionTargetV1, retained: number, omittedAtLeast = 1): void {
    const current = this.caps.get(target);
    this.caps.set(target, Object.freeze({
      retained: Math.max(retained, current?.retained ?? 0),
      omittedAtLeast: (current?.omittedAtLeast ?? 0) + omittedAtLeast,
    }));
  }

  addConversationTextTruncated(
    itemId: ItemIdV1,
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
    commandId: CommandIdV1,
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
    commandId: CommandIdV1,
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
    commandId: CommandIdV1,
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

  collection(): CollectionV1 {
    const limitations: ObservabilityLimitationV1[] = [];
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
    limitations.sort(compareObservabilityLimitationV1);
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
        ObservabilityLimitationV1,
        ...ObservabilityLimitationV1[],
      ],
    });
  }
}

interface RetainedTextV1 {
  readonly text: SafeText;
  readonly retainedBytes: NonNegativeSafeInteger;
  readonly omittedBytes?: PositiveSafeInteger;
}

/** Never split a Unicode scalar or retain a non-SafeText source value. */
function retainSafeTextV1(value: string, maximumBytes: number): RetainedTextV1 | undefined {
  if (makeBoundedSafeTextV1(value, maximumBytes) !== undefined) {
    return Object.freeze({
      text: makeBoundedSafeTextV1(value, maximumBytes)!,
      retainedBytes: requiredNonNegative(utf8ByteLengthV1(value)),
    });
  }
  const totalBytes = utf8ByteLengthV1(value);
  if (totalBytes <= maximumBytes) return undefined;

  let retained = "";
  let retainedBytes = 0;
  for (const scalar of value) {
    const scalarBytes = utf8ByteLengthV1(scalar);
    if (retainedBytes + scalarBytes > maximumBytes) break;
    retained += scalar;
    retainedBytes += scalarBytes;
  }
  const safe = makeBoundedSafeTextV1(retained, maximumBytes);
  const omittedBytes = totalBytes - retainedBytes;
  if (safe === undefined || omittedBytes <= 0) return undefined;
  return Object.freeze({
    text: safe,
    retainedBytes: requiredNonNegative(retainedBytes),
    omittedBytes: requiredPositive(omittedBytes),
  });
}

function jsonSummaryV1(value: unknown): RetainedTextV1 | undefined {
  let summary: string | undefined;
  try {
    const encoded = JSON.stringify(value);
    summary = typeof encoded === "string" ? encoded : undefined;
  } catch {
    return undefined;
  }
  return summary === undefined
    ? undefined
    : retainSafeTextV1(summary, MAX_CONVERSATION_TEXT_BYTES_V1);
}

function uuidEntropyBytesV1(uuid: string): Uint8Array | undefined {
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

function attemptTargetForEntityV1<Kind extends ObservabilityEntityKindV1>(
  kind: Kind,
  id: ObservabilityEntityIdForKindV1<Kind>,
): AttemptReferenceTargetV1 {
  switch (kind) {
    case "turn":
      return Object.freeze({
        family: "niceeval.conversation/v1" as const,
        kind: "turn" as const,
        id: id as TurnIdV1,
      });
    case "item":
      return Object.freeze({
        family: "niceeval.conversation/v1" as const,
        kind: "item" as const,
        id: id as ItemIdV1,
      });
    case "call":
      return Object.freeze({
        family: "niceeval.conversation/v1" as const,
        kind: "call" as const,
        id: id as CallIdV1,
      });
    case "command":
      return Object.freeze({
        family: "niceeval.commands/v1" as const,
        kind: "command" as const,
        id: id as import("./model.ts").CommandIdV1,
      });
    case "usage-observation":
      return Object.freeze({
        family: "niceeval.usage/v1" as const,
        kind: "usage-observation" as const,
        id: id as import("./model.ts").UsageObservationIdV1,
      });
    case "interval":
      return Object.freeze({
        family: "niceeval.timing/v1" as const,
        kind: "interval" as const,
        id: id as IntervalIdV1,
      });
    case "diagnostic":
      return Object.freeze({
        family: "niceeval.diagnostics/v1" as const,
        kind: "diagnostic" as const,
        id: id as DiagnosticIdV1,
      });
  }
}

type AttemptEntityMinterV1 = <Kind extends ObservabilityEntityKindV1>(
  kind: Kind,
) => Effect.Effect<ObservabilityEntityIdForKindV1<Kind>, RunnerObservabilityProducerErrorV1>;

const runnerAttemptObservabilityRuntimeTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RunnerAttemptObservabilityRuntimeV1",
);
const runnerCommandCaptureHandleTypeId: unique symbol = Symbol(
  "@niceeval/o11y/RunnerCommandCaptureHandleV1",
);

/**
 * Opaque, Attempt-local capture authority. It deliberately has no durable
 * owner/path data and is bound to the final EvalResult only through a private
 * WeakMap below.
 */
export interface RunnerAttemptObservabilityRuntimeV1 {
  readonly [runnerAttemptObservabilityRuntimeTypeId]: () => void;
}

/** A registered command capability, usable only by Runner's timing wrapper. */
export interface RunnerCommandCaptureHandleV1 {
  readonly [runnerCommandCaptureHandleTypeId]: () => void;
}

interface CapturedCommandResultV1 {
  readonly outcome: { readonly kind: "exited"; readonly exitCode: number } | {
    readonly kind: "terminated";
    readonly reason: "timeout";
  };
  readonly stdout: string;
  readonly stderr: string;
}

interface CapturedCommandRuntimeV1 {
  readonly commandId: CommandIdV1;
  readonly registered: RegisteredCommandCaptureV1;
  readonly phase: LifecyclePhase;
  readonly invocationKind: "argv" | "shell";
  readonly command: string;
  readonly args: readonly string[] | undefined;
  readonly options: unknown;
  result?: CapturedCommandResultV1;
}

interface RunnerAttemptObservabilityRuntimeStateV1 {
  readonly capture: AttemptObservabilityCaptureIdentityV1;
  readonly providerName: string;
  readonly sensitiveValues: ReadonlySet<string>;
  readonly commands: CapturedCommandRuntimeV1[];
  readonly commandLimitations: RunnerCollectionLimitationsV1;
  readonly usage: UsageObservationV1[];
  readonly usageLimitations: RunnerCollectionLimitationsV1;
  failure?: RunnerObservabilityProducerErrorV1;
}

const runnerAttemptRuntimeStatesV1 = new WeakMap<object, RunnerAttemptObservabilityRuntimeStateV1>();
const runnerAttemptResultStatesV1 = new WeakMap<object, RunnerAttemptObservabilityRuntimeStateV1>();
const runnerCommandHandleStatesV1 = new WeakMap<object, {
  readonly runtime: RunnerAttemptObservabilityRuntimeStateV1;
  readonly command: CapturedCommandRuntimeV1;
}>();
const runnerRunDiagnosticsV1 = new WeakMap<object, readonly DiagnosticRecord[]>();

function runtimeStateV1(
  runtime: RunnerAttemptObservabilityRuntimeV1,
): RunnerAttemptObservabilityRuntimeStateV1 | undefined {
  return runnerAttemptRuntimeStatesV1.get(runtime as object);
}

function markRuntimeFailureV1(
  runtime: RunnerAttemptObservabilityRuntimeStateV1,
  failure: RunnerObservabilityProducerErrorV1,
): void {
  if (runtime.failure === undefined) runtime.failure = failure;
}

function mintRuntimeEntityV1<Kind extends ObservabilityEntityKindV1>(
  runtime: RunnerAttemptObservabilityRuntimeStateV1,
  kind: Kind,
): ObservabilityEntityIdForKindV1<Kind> | undefined {
  let uuid: string;
  try {
    uuid = randomUUID();
  } catch {
    markRuntimeFailureV1(runtime, producerEntityIdInvalid(kind));
    return undefined;
  }
  const bytes = uuidEntropyBytesV1(uuid);
  const id = bytes === undefined ? undefined : entityIdFromEntropyV1(kind, bytes);
  if (id === undefined) {
    markRuntimeFailureV1(runtime, producerEntityIdInvalid(kind));
    return undefined;
  }
  const minted = mintAttemptObservabilityEntityV1(
    runtime.capture,
    attemptTargetForEntityV1(kind, id),
  );
  if (minted === undefined) {
    markRuntimeFailureV1(runtime, producerEntityIdInvalid(kind));
    return undefined;
  }
  return id;
}

function mintRuntimeCommandV1(
  runtime: RunnerAttemptObservabilityRuntimeStateV1,
): {
  readonly commandId: CommandIdV1;
  readonly entity: AttemptCapturedObservabilityEntityV1<CommandReferenceTargetV1>;
} | undefined {
  let uuid: string;
  try {
    uuid = randomUUID();
  } catch {
    markRuntimeFailureV1(runtime, producerEntityIdInvalid("command"));
    return undefined;
  }
  const bytes = uuidEntropyBytesV1(uuid);
  const commandId = bytes === undefined ? undefined : entityIdFromEntropyV1("command", bytes);
  if (commandId === undefined) {
    markRuntimeFailureV1(runtime, producerEntityIdInvalid("command"));
    return undefined;
  }
  const entity = mintAttemptObservabilityEntityV1<CommandReferenceTargetV1>(runtime.capture, {
    family: "niceeval.commands/v1" as const,
    kind: "command" as const,
    id: commandId,
  });
  if (entity === undefined) {
    markRuntimeFailureV1(runtime, producerEntityIdInvalid("command"));
    return undefined;
  }
  return Object.freeze({ commandId, entity });
}

function makeAttemptEntityMinterV1(
  runtime: RunnerAttemptObservabilityRuntimeStateV1,
): {
  readonly mint: AttemptEntityMinterV1;
  readonly seal: () => boolean;
} {
  return Object.freeze({
    mint: <Kind extends ObservabilityEntityKindV1>(kind: Kind) =>
      Effect.suspend(() => {
        if (runtime.failure !== undefined) return Effect.fail(runtime.failure);
        const id = mintRuntimeEntityV1(runtime, kind);
        return id === undefined
          ? Effect.fail(runtime.failure ?? producerEntityIdInvalid(kind))
          : Effect.succeed(id);
      }),
    seal: () => sealAttemptObservabilityCaptureIdentityV1(runtime.capture),
  });
}

type RunObservabilityEntityKindV1 = "interval" | "diagnostic";

type RunEntityMinterV1 = <Kind extends RunObservabilityEntityKindV1>(
  kind: Kind,
) => Effect.Effect<ObservabilityEntityIdForKindV1<Kind>, RunnerObservabilityProducerErrorV1>;

function runTargetForEntityV1<Kind extends RunObservabilityEntityKindV1>(
  kind: Kind,
  id: ObservabilityEntityIdForKindV1<Kind>,
): RunReferenceTargetV1 {
  switch (kind) {
    case "interval":
      return Object.freeze({
        family: "niceeval.timing/v1" as const,
        kind: "interval" as const,
        id: id as IntervalIdV1,
      });
    case "diagnostic":
      return Object.freeze({
        family: "niceeval.diagnostics/v1" as const,
        kind: "diagnostic" as const,
        id: id as DiagnosticIdV1,
      });
  }
}

function mintRunEntityV1<Kind extends RunObservabilityEntityKindV1>(
  capture: RunObservabilityCaptureIdentityV1,
  kind: Kind,
): ObservabilityEntityIdForKindV1<Kind> | undefined {
  let uuid: string;
  try {
    uuid = randomUUID();
  } catch {
    return undefined;
  }
  const bytes = uuidEntropyBytesV1(uuid);
  const id = bytes === undefined ? undefined : entityIdFromEntropyV1(kind, bytes);
  if (id === undefined) return undefined;
  const minted = mintRunObservabilityEntityV1(capture, runTargetForEntityV1(kind, id));
  return minted === undefined ? undefined : id;
}

function makeRunEntityMinterV1(
  capture: RunObservabilityCaptureIdentityV1,
): {
  readonly mint: RunEntityMinterV1;
  readonly seal: () => boolean;
} {
  return Object.freeze({
    mint: <Kind extends RunObservabilityEntityKindV1>(kind: Kind) =>
      Effect.suspend(() => {
        const id = mintRunEntityV1(capture, kind);
        return id === undefined
          ? Effect.fail(producerEntityIdInvalid(kind))
          : Effect.succeed(id);
      }),
    seal: () => sealRunObservabilityCaptureIdentityV1(capture),
  });
}

/** Creates one private capture for a real Runner Attempt. */
export function createRunnerAttemptObservabilityRuntimeV1(input: {
  readonly providerName: string;
  readonly sensitiveValues: ReadonlySet<string>;
}): RunnerAttemptObservabilityRuntimeV1 {
  const runtime = Object.freeze({
    [runnerAttemptObservabilityRuntimeTypeId]: () => undefined,
  }) as RunnerAttemptObservabilityRuntimeV1;
  runnerAttemptRuntimeStatesV1.set(runtime, {
    capture: makeAttemptObservabilityCaptureIdentityV1(),
    providerName: input.providerName,
    sensitiveValues: input.sensitiveValues,
    commands: [],
    commandLimitations: new RunnerCollectionLimitationsV1(),
    usage: [],
    usageLimitations: new RunnerCollectionLimitationsV1(),
  });
  return runtime;
}

/**
 * Associates the exact final EvalResult object with its Attempt-local
 * capture. Result shape stays public-contract-neutral; Record later looks up
 * this identity rather than reading an added field.
 */
export function bindRunnerAttemptObservabilityCaptureV1(
  result: EvalResult,
  runtime: RunnerAttemptObservabilityRuntimeV1,
): void {
  const state = runtimeStateV1(runtime);
  if (state === undefined) return;
  const existing = runnerAttemptResultStatesV1.get(result);
  if (existing !== undefined && existing !== state) {
    markRuntimeFailureV1(state, producerCaptureSealInvalid("attempt"));
    return;
  }
  runnerAttemptResultStatesV1.set(result, state);
}

/**
 * Associates only the settled diagnostics that belong to this exact Run. The
 * invocation-wide timing recorder is intentionally not bound here: its facts
 * have no safe per-experiment owner attribution when an invocation has more
 * than one Run.
 */
export function bindRunnerRunObservabilityDiagnosticsV1(input: {
  readonly run: AgentRun;
  readonly diagnostics: readonly DiagnosticRecord[];
}): void {
  runnerRunDiagnosticsV1.set(input.run, Object.freeze([...input.diagnostics]));
}

function commandManifestPhaseV1(
  phase: LifecyclePhase,
): CommandManifestV1["phase"] | undefined {
  switch (phase) {
    case "sandbox.create":
    case "workspace.baseline":
    case "agent.setup":
    case "telemetry.configure":
      return "attempt.setup";
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
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
      return "attempt.teardown";
    case "assertions.evaluate":
    case "judge.precheck":
    case "experiment.setup":
    case "experiment.teardown":
    case "sandbox.queue":
    case "workspace.diff":
    case "telemetry.collect":
      return undefined;
  }
}

/** Registers the manifest authority before the wrapped Sandbox call starts. */
export function captureRunnerCommandStartV1(input: {
  readonly runtime: RunnerAttemptObservabilityRuntimeV1;
  readonly phase: LifecyclePhase;
  readonly invocationKind: "argv" | "shell";
  readonly command: string;
  readonly args?: readonly string[];
  readonly options?: unknown;
}): RunnerCommandCaptureHandleV1 | undefined {
  const runtime = runtimeStateV1(input.runtime);
  if (runtime === undefined) return undefined;
  if (runtime.failure !== undefined) return undefined;
  if (runtime.commands.length >= MAX_COMMANDS_V1) {
    runtime.commandLimitations.addCap("command-manifest", runtime.commands.length);
    return undefined;
  }
  const minted = mintRuntimeCommandV1(runtime);
  if (minted === undefined) return undefined;
  const { commandId } = minted;
  const registered = registerCommandCaptureV1(runtime.capture, minted.entity);
  if (registered === undefined || registeredCommandIdV1(registered) !== commandId) {
    markRuntimeFailureV1(runtime, producerCommandRegistrationInvalid());
    return undefined;
  }
  const command: CapturedCommandRuntimeV1 = {
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
  }) as RunnerCommandCaptureHandleV1;
  runnerCommandHandleStatesV1.set(handle, Object.freeze({ runtime, command }));
  return handle;
}

function commandHandleStateV1(
  handle: RunnerCommandCaptureHandleV1 | undefined,
): { readonly runtime: RunnerAttemptObservabilityRuntimeStateV1; readonly command: CapturedCommandRuntimeV1 } | undefined {
  return handle === undefined ? undefined : runnerCommandHandleStatesV1.get(handle as object);
}

/** Records a real returned/CommandExitError result against its prior manifest. */
export function captureRunnerCommandResultV1(input: {
  readonly handle: RunnerCommandCaptureHandleV1 | undefined;
  readonly exitCode: number;
  readonly stdout: unknown;
  readonly stderr: unknown;
}): void {
  const state = commandHandleStateV1(input.handle);
  if (state === undefined) return;
  const registration = recordRegisteredCommandResultV1(state.runtime.capture, state.command.registered);
  if (registration.state !== "recorded") {
    markRuntimeFailureV1(state.runtime, producerCommandRegistrationInvalid());
    return;
  }
  if (!Number.isSafeInteger(input.exitCode) || input.exitCode < -2_147_483_648 || input.exitCode > 2_147_483_647) {
    state.runtime.commandLimitations.addUnsupported("command-manifest");
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
export function captureRunnerCommandTimeoutV1(
  handle: RunnerCommandCaptureHandleV1 | undefined,
): void {
  const state = commandHandleStateV1(handle);
  if (state === undefined) return;
  const registration = recordRegisteredCommandResultV1(state.runtime.capture, state.command.registered);
  if (registration.state !== "recorded") {
    markRuntimeFailureV1(state.runtime, producerCommandRegistrationInvalid());
    return;
  }
  state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stdout");
  state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stderr");
  state.command.result = Object.freeze({
    outcome: Object.freeze({ kind: "terminated" as const, reason: "timeout" as const }),
    stdout: "",
    stderr: "",
  });
}

/** External interruption has no invented command result. */
export function captureRunnerCommandInterruptedV1(
  handle: RunnerCommandCaptureHandleV1 | undefined,
): void {
  const state = commandHandleStateV1(handle);
  if (state === undefined) return;
  state.runtime.commandLimitations.addCaptureInterrupted("command-capture", "command-manifest");
}

/** A non-terminal transport/spawn failure has no fabricated command outcome. */
export function captureRunnerCommandCaptureFailedV1(
  handle: RunnerCommandCaptureHandleV1 | undefined,
): void {
  const state = commandHandleStateV1(handle);
  if (state === undefined) return;
  state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-manifest");
}

function usageNonNegativeIntegerV1(value: unknown): NonNegativeSafeInteger | undefined {
  return typeof value === "number" ? makeNonNegativeSafeIntegerV1(value) : undefined;
}

function canonicalDecimalFromNumberV1(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const source = String(value);
  const plain = source.includes("e") || source.includes("E")
    ? expandExponentialDecimalV1(source)
    : source;
  if (plain === undefined) return undefined;
  const normalized = plain.includes(".")
    ? plain.replace(/0+$/u, "").replace(/\.$/u, "")
    : plain;
  return makeCanonicalDecimalV1(normalized);
}

function expandExponentialDecimalV1(value: string): string | undefined {
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

function appendUsageObservationV1(
  runtime: RunnerAttemptObservabilityRuntimeStateV1,
  create: (usageObservationId: UsageObservationIdV1, provider: SafeIdentifier) => UsageObservationV1,
): void {
  if (runtime.usage.length >= MAX_USAGE_OBSERVATIONS_V1) {
    runtime.usageLimitations.addCap("usage-observation", runtime.usage.length);
    return;
  }
  const provider = makeSafeIdentifierV1(runtime.providerName);
  if (provider === undefined) {
    runtime.usageLimitations.addUnsupported("usage-observation");
    return;
  }
  const usageObservationId = mintRuntimeEntityV1(runtime, "usage-observation");
  if (usageObservationId === undefined) return;
  runtime.usage.push(create(usageObservationId, provider));
}

/**
 * Captures only the exact Usage passed by SessionManager's terminal onTurn
 * callback. It never looks at an Attempt aggregate or derives a request from
 * a token count.
 */
export function captureRunnerTurnUsageV1(
  runtimeHandle: RunnerAttemptObservabilityRuntimeV1,
  usage: Usage,
): void {
  const runtime = runtimeStateV1(runtimeHandle);
  if (runtime === undefined || runtime.failure !== undefined) return;
  const tokenBuckets: readonly [keyof Pick<
    Usage,
    "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens" | "reasoningTokens"
  >, Extract<UsageObservationV1, { readonly kind: "token-bucket" }>["bucket"]][] = [
    ["inputTokens", "input"],
    ["outputTokens", "output"],
    ["cacheReadTokens", "cache-read"],
    ["cacheCreationTokens", "cache-write"],
    ["reasoningTokens", "reasoning"],
  ];
  for (const [field, bucket] of tokenBuckets) {
    const raw = usage[field];
    if (raw === undefined) continue;
    const tokens = usageNonNegativeIntegerV1(raw);
    if (tokens === undefined) {
      runtime.usageLimitations.addUnsupported("usage-observation");
      continue;
    }
    appendUsageObservationV1(runtime, (usageObservationId, provider) => Object.freeze({
      usageObservationId,
      provider,
      kind: "token-bucket" as const,
      bucket,
      tokens,
      refs: Object.freeze([]),
    }));
  }
  if (usage.requests !== undefined) {
    const requests = usageNonNegativeIntegerV1(usage.requests);
    if (requests === undefined) {
      runtime.usageLimitations.addUnsupported("usage-observation");
    } else {
      for (let request = 0; request < requests; request += 1) {
        appendUsageObservationV1(runtime, (usageObservationId, provider) => Object.freeze({
          usageObservationId,
          provider,
          kind: "request" as const,
          requestKind: "model" as const,
          refs: Object.freeze([]),
        }));
        if (runtime.usage.length >= MAX_USAGE_OBSERVATIONS_V1) break;
      }
    }
  }
  if (usage.costUSD !== undefined) {
    const amount = canonicalDecimalFromNumberV1(usage.costUSD);
    if (amount === undefined) {
      runtime.usageLimitations.addUnsupported("usage-observation");
    } else {
      const currency = makeCurrencyCodeV1("USD");
      if (currency === undefined) throw new Error("USD must be a CurrencyCode");
      appendUsageObservationV1(runtime, (usageObservationId, provider) => Object.freeze({
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

function attemptConversationOutcomeV1(
  result: EvalResult,
  sealed: SealedAttemptAssertions,
): ConversationTurnV1["outcome"] {
  if (sealed.evaluation.explicitlySkipped) return "cancelled";
  return result.error === undefined && sealed.evaluation.execution === "completed"
    ? "completed"
    : "failed";
}

function standardEventUnavailableV1(
  result: EvalResult,
  limitations: RunnerCollectionLimitationsV1,
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

function safeIdentifierV1(value: string): SafeIdentifier | undefined {
  return makeSafeIdentifierV1(value);
}

function sourceNativeToolNameV1(value: string): SourceNativeToolName | undefined {
  return makeSourceNativeToolNameV1(value);
}

function stableLabelV1(value: string): StableLabel | undefined {
  return makeStableLabelV1(value);
}

function eventCannotBePersistedV1(
  event: { readonly redacted?: readonly string[]; readonly truncated?: readonly unknown[] },
  limitations: RunnerCollectionLimitationsV1,
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

function hasConversationCapacityV1(input: {
  readonly itemCount: number;
  readonly hasTurn: boolean;
  readonly limitations: RunnerCollectionLimitationsV1;
}): boolean {
  if (input.itemCount >= MAX_CONVERSATION_ITEMS_V1) {
    input.limitations.addCap("conversation-item", input.itemCount);
    return false;
  }
  if (!input.hasTurn && input.itemCount >= MAX_CONVERSATION_TURNS_V1) {
    input.limitations.addCap("conversation-item", input.itemCount);
    return false;
  }
  return true;
}

function appendConversationTextLimitationV1(
  item: ConversationItemV1 | undefined,
  text: RetainedTextV1,
  limitations: RunnerCollectionLimitationsV1,
): void {
  if (item !== undefined && text.omittedBytes !== undefined) {
    limitations.addConversationTextTruncated(
      item.itemId,
      text.retainedBytes,
      text.omittedBytes,
    );
  }
}

function normalizeConversationV1(input: {
  readonly result: EvalResult;
  readonly sealed: SealedAttemptAssertions;
  readonly mint: AttemptEntityMinterV1;
  readonly runtime: RunnerAttemptObservabilityRuntimeStateV1;
}): Effect.Effect<NormalizedAttemptObservabilityCaptureV1["conversation"], RunnerObservabilityProducerErrorV1> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitationsV1();
    if (standardEventUnavailableV1(input.result, limitations)) {
      return Object.freeze({ collection: limitations.collection(), turns: Object.freeze([]), items: Object.freeze([]) });
    }

    const items: ConversationItemV1[] = [];
    let turnId: TurnIdV1 | undefined;
    const openTools = new Map<string, { readonly callId: CallIdV1; readonly turnId: TurnIdV1 }>();
    const openSubagents = new Map<string, { readonly label: SafeIdentifier }>();

    const ensureTurn = (): Effect.Effect<TurnIdV1 | undefined, RunnerObservabilityProducerErrorV1> => {
      if (turnId !== undefined) return Effect.succeed(turnId);
      if (!hasConversationCapacityV1({
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
        readonly itemId: ItemIdV1;
        readonly turnId: TurnIdV1;
        readonly sequence: PositiveSafeInteger;
      }) => ConversationItemV1,
    ): Effect.Effect<ConversationItemV1 | undefined, RunnerObservabilityProducerErrorV1> => {
      if (!hasConversationCapacityV1({
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
      if (eventCannotBePersistedV1(event, limitations)) continue;
      switch (event.type) {
        case "message": {
          const text = retainSafeTextV1(event.text, MAX_CONVERSATION_TEXT_BYTES_V1);
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
          appendConversationTextLimitationV1(item, text, limitations);
          break;
        }
        case "operation.started": {
          if (event.operation.kind === "tool") {
            // Conversation is the source-native execution record. Canonical
            // ToolName is useful to runtime assertions, but must never replace
            // or rescue the provider's real identity in durable evidence.
            const tool = sourceNativeToolNameV1(event.operation.name);
            const summary = jsonSummaryV1(event.operation.input);
            if (tool === undefined || summary === undefined) {
              limitations.addUnsupported("conversation-item");
              continue;
            }
            if (!hasConversationCapacityV1({
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
            appendConversationTextLimitationV1(item, summary, limitations);
            break;
          }

          const label = safeIdentifierV1(event.operation.name);
          if (label === undefined) {
            limitations.addUnsupported("conversation-item");
            continue;
          }
          const item = yield* appendItem((ids) => Object.freeze({
            ...ids,
            kind: "subagent" as const,
            state: "started" as const,
            label,
            summary: makeBoundedSafeTextV1("Subagent started.", MAX_CONVERSATION_TEXT_BYTES_V1)!,
            refs: Object.freeze([]),
          }));
          if (item !== undefined) openSubagents.set(event.operationId, Object.freeze({ label }));
          break;
        }
        case "operation.finished": {
          if (event.kind === "tool") {
            const open = openTools.get(event.operationId);
            const summary = event.output === undefined ? undefined : jsonSummaryV1(event.output);
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
            appendConversationTextLimitationV1(item, summary, limitations);
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
            summary: makeBoundedSafeTextV1(
              event.status === "completed" ? "Subagent completed." : "Subagent failed.",
              MAX_CONVERSATION_TEXT_BYTES_V1,
            )!,
            refs: Object.freeze([]),
          }));
          if (item !== undefined) openSubagents.delete(event.operationId);
          break;
        }
        case "skill.loaded": {
          const skill = safeIdentifierV1(event.skill);
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
            ? (event.request.input === undefined ? undefined : jsonSummaryV1(event.request.input))
            : retainSafeTextV1(source, MAX_CONVERSATION_TEXT_BYTES_V1);
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
          appendConversationTextLimitationV1(item, summary, limitations);
          // StreamEvent has no corresponding response event, so null cannot
          // claim a complete request/response capture.
          limitations.addCaptureFailed("adapter", "conversation-item");
          break;
        }
        case "context.injected": {
          const source = event.source;
          const summary = retainSafeTextV1(event.text, MAX_CONVERSATION_TEXT_BYTES_V1);
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
          appendConversationTextLimitationV1(item, summary, limitations);
          break;
        }
        case "error": {
          const redacted = redactSensitiveText(event.message, input.runtime.sensitiveValues);
          if (redacted !== event.message) limitations.addRedacted("conversation-text");
          const summary = retainSafeTextV1(redacted, MAX_CONVERSATION_TEXT_BYTES_V1);
          if (summary === undefined) {
            limitations.addUnsupported("conversation-item");
            continue;
          }
          const item = yield* appendItem((ids) => Object.freeze({
            ...ids,
            kind: "conversation-error" as const,
            code: makeSafeIdentifierV1("stream-error")!,
            summary: summary.text,
            refs: Object.freeze([]),
          }));
          appendConversationTextLimitationV1(item, summary, limitations);
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
    const turns: readonly ConversationTurnV1[] = turnId === undefined
      ? Object.freeze([])
      : Object.freeze([Object.freeze({
          turnId,
          sequence: requiredPositive(1),
          outcome: attemptConversationOutcomeV1(input.result, input.sealed),
          refs: Object.freeze([]),
        })]);
    return Object.freeze({
      collection: limitations.collection(),
      turns,
      items: Object.freeze([...items]),
    });
  });
}

function commandSafeTextV1(input: {
  readonly commandId: CommandIdV1;
  readonly value: string;
  readonly maximumBytes: number;
  readonly target: "command-manifest" | "command-stdout" | "command-stderr";
  readonly runtime: RunnerAttemptObservabilityRuntimeStateV1;
}): SafeText | undefined {
  const redacted = redactSensitiveText(input.value, input.runtime.sensitiveValues);
  if (redacted !== input.value) input.runtime.commandLimitations.addRedacted(input.target);
  const retained = retainSafeTextV1(redacted, input.maximumBytes);
  if (retained === undefined) {
    input.runtime.commandLimitations.addUnsupported("command-manifest");
    return undefined;
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

function isProjectRelativeCommandPathV1(value: string): boolean {
  return (
    makeBoundedSafeTextV1(value, MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES_V1) !== undefined &&
    value.length > 0 &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.includes(":") &&
    value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
  );
}

function commandWorkingDirectoryV1(
  options: unknown,
  runtime: RunnerAttemptObservabilityRuntimeStateV1,
): CommandManifestV1["workingDirectory"] {
  const candidate = options as Partial<Pick<CommandOptions, "cwd">> | undefined;
  const cwd = candidate?.cwd;
  if (cwd === undefined || cwd === ".") return Object.freeze({ kind: "sandbox-default" as const });
  if (typeof cwd !== "string") {
    runtime.commandLimitations.addUnsupported("command-manifest");
    return Object.freeze({ kind: "redacted" as const });
  }
  const redacted = redactSensitiveText(cwd, runtime.sensitiveValues);
  if (redacted !== cwd) runtime.commandLimitations.addRedacted("command-manifest");
  if (isProjectRelativeCommandPathV1(redacted)) {
    return Object.freeze({ kind: "project-relative" as const, path: redacted });
  }
  // Absolute, dot-segment and otherwise unsafe cwd values are deliberately
  // not normalized into an apparently portable path.
  runtime.commandLimitations.addRedacted("command-manifest");
  return Object.freeze({ kind: "redacted" as const });
}

function commandManifestV1(
  command: CapturedCommandRuntimeV1,
  runtime: RunnerAttemptObservabilityRuntimeStateV1,
): CommandManifestV1 | undefined {
  const phase = commandManifestPhaseV1(command.phase);
  if (phase === undefined) {
    runtime.commandLimitations.addUnsupported("command-manifest");
    return undefined;
  }
  const workingDirectory = commandWorkingDirectoryV1(command.options, runtime);
  if (command.invocationKind === "shell") {
    const script = commandSafeTextV1({
      commandId: command.commandId,
      value: command.command,
      maximumBytes: MAX_COMMAND_SHELL_BYTES_V1,
      target: "command-manifest",
      runtime,
    });
    return script === undefined
      ? undefined
      : Object.freeze({
          phase,
          invocation: Object.freeze({ kind: "shell" as const, command: script }),
          workingDirectory,
        });
  }
  if ((command.args?.length ?? 0) > MAX_COMMAND_ARGUMENTS_V1) {
    runtime.commandLimitations.addUnsupported("command-manifest");
    return undefined;
  }
  const executable = commandSafeTextV1({
    commandId: command.commandId,
    value: command.command,
    maximumBytes: MAX_COMMAND_EXECUTABLE_BYTES_V1,
    target: "command-manifest",
    runtime,
  });
  if (executable === undefined) return undefined;
  const arguments_: SafeText[] = [];
  for (const raw of command.args ?? []) {
    const argument = commandSafeTextV1({
      commandId: command.commandId,
      value: raw,
      maximumBytes: MAX_COMMAND_ARGUMENT_BYTES_V1,
      target: "command-manifest",
      runtime,
    });
    if (argument === undefined) return undefined;
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

function stripUnsafeCommandControlsV1(value: string): { readonly text: string; readonly count: number } {
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

function emptyCommandStreamV1(): NormalizedCommandStreamCaptureV1 {
  const text = makeBoundedSafeTextV1("", MAX_COMMAND_STREAM_BYTES_V1);
  if (text === undefined) throw new Error("An empty command stream must be SafeText");
  return Object.freeze({ text, totalSafeUtf8Bytes: requiredNonNegative(0) });
}

function commandStreamV1(input: {
  readonly commandId: CommandIdV1;
  readonly stream: "stdout" | "stderr";
  readonly value: string;
  readonly runtime: RunnerAttemptObservabilityRuntimeStateV1;
}): NormalizedCommandStreamCaptureV1 {
  const target = input.stream === "stdout" ? "command-stdout" as const : "command-stderr" as const;
  const redacted = redactSensitiveText(input.value, input.runtime.sensitiveValues);
  if (redacted !== input.value) input.runtime.commandLimitations.addRedacted(target);
  const stripped = stripUnsafeCommandControlsV1(redacted);
  if (stripped.count > 0) {
    input.runtime.commandLimitations.addUnsafeCommandControlStripped(
      input.commandId,
      input.stream,
      stripped.count,
    );
  }
  const retained = retainSafeTextV1(stripped.text, MAX_COMMAND_STREAM_BYTES_V1);
  if (retained === undefined) {
    input.runtime.commandLimitations.addCaptureFailed("command-capture", target);
    return emptyCommandStreamV1();
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

function normalizeCommandsV1(
  runtime: RunnerAttemptObservabilityRuntimeStateV1,
): NormalizedAttemptObservabilityCaptureV1["commands"] {
  const commands: NormalizedCommandObservationCaptureV1[] = [];
  for (const captured of runtime.commands) {
    if (captured.result === undefined) {
      runtime.commandLimitations.addCaptureFailed("command-capture", "command-manifest");
      continue;
    }
    const manifest = commandManifestV1(captured, runtime);
    if (manifest === undefined) continue;
    const stdout = commandStreamV1({
      commandId: captured.commandId,
      stream: "stdout",
      value: captured.result.stdout,
      runtime,
    });
    const stderr = commandStreamV1({
      commandId: captured.commandId,
      stream: "stderr",
      value: captured.result.stderr,
      runtime,
    });
    commands.push(Object.freeze({
      commandId: captured.commandId,
      manifest,
      result: Object.freeze({ outcome: captured.result.outcome, stdout, stderr }),
      refs: Object.freeze([]),
    }));
  }
  return Object.freeze({
    collection: runtime.commandLimitations.collection(),
    commands: Object.freeze(
      [...commands].sort((left, right) => compareObservabilityTextV1(left.commandId, right.commandId)),
    ),
  });
}

function normalizeUsageV1(input: {
  readonly result: EvalResult;
  readonly runtime: RunnerAttemptObservabilityRuntimeStateV1;
}): NormalizedAttemptObservabilityCaptureV1["usage"] {
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
        compareObservabilityTextV1(left.usageObservationId, right.usageObservationId),
      ),
    ),
  });
}

function attemptTimingProjectionV1(
  phase: LifecyclePhase,
): { readonly phase: AttemptTimingIntervalV1["phase"]; readonly label: StableLabel } | undefined {
  const label = stableLabelV1(phase);
  if (label === undefined) return undefined;
  switch (phase) {
    case "sandbox.create":
    case "workspace.baseline":
    case "agent.setup":
    case "telemetry.configure":
      return Object.freeze({ phase: "attempt.setup" as const, label });
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
    case "sandbox.prepare.experiment":
      return Object.freeze({ phase: "sandbox.prepare" as const, label });
    case "agent.ensure":
      return Object.freeze({ phase: "agent.ensure" as const, label });
    case "eval.run":
      return Object.freeze({ phase: "eval.run" as const, label });
    case "assertions.evaluate":
      return Object.freeze({ phase: "assertion.evaluate" as const, label });
    case "agent.teardown":
    case "sandbox.cleanup":
    case "sandbox.suspend":
    case "sandbox.stop":
      return Object.freeze({ phase: "attempt.teardown" as const, label });
    case "judge.precheck":
    case "experiment.setup":
    case "experiment.teardown":
    case "sandbox.queue":
    case "agent.run":
    case "workspace.diff":
    case "telemetry.collect":
      return undefined;
  }
}

function validPhaseDurationV1(value: PhaseTiming): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeIntegerV1(value.durationMs);
}

function timingActivityProjectionV1(
  activity: TimingActivity,
): { readonly phase: AttemptTimingIntervalV1["phase"]; readonly label: StableLabel } | undefined {
  const label = stableLabelV1(activity.label);
  if (label === undefined) return undefined;
  switch (activity.key) {
    case "agent.turn":
      return Object.freeze({ phase: "agent.send" as const, label });
    case "sandbox.command":
      return Object.freeze({ phase: "sandbox.command" as const, label });
    case "sandbox.prepare":
      return Object.freeze({ phase: "sandbox.prepare" as const, label });
    default:
      return undefined;
  }
}

function validTimingActivityStartV1(activity: TimingActivity): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeIntegerV1(activity.startOffsetMs);
}

function validTimingActivityDurationV1(activity: TimingActivity): NonNegativeSafeInteger | undefined {
  return makeNonNegativeSafeIntegerV1(activity.durationMs);
}

function timingSpanContainsV1(input: {
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

function normalizeAttemptTimingV1(input: {
  readonly result: EvalResult;
  readonly mint: AttemptEntityMinterV1;
}): Effect.Effect<NormalizedAttemptObservabilityCaptureV1["timing"], RunnerObservabilityProducerErrorV1> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitationsV1();
    const phases = input.result.phases;
    if (phases === undefined) {
      limitations.addCaptureFailed("timing-capture", "timing-interval");
      return Object.freeze({ collection: limitations.collection(), intervals: Object.freeze([]) });
    }

    const intervals: AttemptTimingIntervalV1[] = [];
    const appendActivities = (
      activities: readonly TimingActivity[] | undefined,
      parent: {
        readonly intervalId: IntervalIdV1;
        readonly startOffsetMs: NonNegativeSafeInteger;
        readonly durationMs: NonNegativeSafeInteger;
      } | undefined,
      ancestors: ReadonlySet<TimingActivity>,
    ): Effect.Effect<void, RunnerObservabilityProducerErrorV1> => Effect.gen(function* () {
      for (const activity of activities ?? []) {
        if (ancestors.has(activity)) {
          limitations.addUnsupported("timing-interval");
          continue;
        }
        const projection = timingActivityProjectionV1(activity);
        const startOffsetMs = validTimingActivityStartV1(activity);
        const durationMs = validTimingActivityDurationV1(activity);
        if (projection === undefined || startOffsetMs === undefined || durationMs === undefined) {
          limitations.addUnsupported("timing-interval");
          continue;
        }
        if (intervals.length >= MAX_TIMING_INTERVALS_V1) {
          limitations.addCap("timing-interval", intervals.length);
          continue;
        }
        const intervalId = yield* input.mint("interval");
        const parentIntervalId = parent === undefined
          ? null
          : timingSpanContainsV1({
              parentStartOffsetMs: parent.startOffsetMs,
              parentDurationMs: parent.durationMs,
              childStartOffsetMs: startOffsetMs,
              childDurationMs: durationMs,
            })
            ? parent.intervalId
            : null;
        if (parent !== undefined && parentIntervalId === null) {
          // Phase and child offsets are independently rounded at the Runner
          // boundary. When their measured ranges do not prove containment,
          // retain the factual child as a root rather than inventing a tree.
          limitations.addUnsupported("timing-interval");
        }
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
          Object.freeze({ intervalId, startOffsetMs, durationMs }),
          nextAncestors,
        );
      }
    });
    let offset: NonNegativeSafeInteger | undefined = requiredNonNegative(0);
    for (const source of phases) {
      const duration = validPhaseDurationV1(source);
      const projection = attemptTimingProjectionV1(source.name);
      if (duration === undefined || projection === undefined || offset === undefined) {
        limitations.addUnsupported("timing-interval");
      } else if (intervals.length >= MAX_TIMING_INTERVALS_V1) {
        limitations.addCap("timing-interval", intervals.length);
      } else {
        const intervalId = yield* input.mint("interval");
        intervals.push(Object.freeze({
          intervalId,
          phase: projection.phase,
          label: projection.label,
          startOffsetMs: offset,
          durationMs: duration,
          parentIntervalId: null,
          outcome: source.failed ? "failed" as const : "completed" as const,
          refs: Object.freeze([]),
        }));
        yield* appendActivities(
          source.children,
          Object.freeze({ intervalId, startOffsetMs: offset, durationMs: duration }),
          new Set(),
        );
      }
      if (duration === undefined || offset === undefined) {
        offset = undefined;
      } else {
        offset = makeNonNegativeSafeIntegerV1(offset + duration);
      }
    }
    return Object.freeze({
      collection: limitations.collection(),
      // The durable timing family canonically orders by opaque entity id; the
      // offsets retain the Runner's actual lifecycle order.
      intervals: Object.freeze(
        [...intervals].sort((left, right) =>
          compareObservabilityTextV1(left.intervalId, right.intervalId),
        ),
      ),
    });
  });
}

function attemptDiagnosticPhaseV1(
  origin: TimingOrigin | undefined,
): AttemptDiagnosticV1["phase"] {
  if (origin === undefined || origin.scope !== "attempt") return "collection";
  switch (origin.phase) {
    case "sandbox.create":
    case "workspace.baseline":
    case "agent.setup":
    case "telemetry.configure":
      return "attempt.setup";
    case "sandbox.prepare":
    case "sandbox.prepare.eval":
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

function normalizeAttemptDiagnosticsV1(input: {
  readonly result: EvalResult;
  readonly mint: AttemptEntityMinterV1;
}): Effect.Effect<NormalizedAttemptObservabilityCaptureV1["diagnostics"], RunnerObservabilityProducerErrorV1> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitationsV1();
    const diagnostics: AttemptDiagnosticV1[] = [];
    const append = (
      value: {
        readonly code: string;
        readonly detail: string;
        readonly kind: AttemptDiagnosticV1["kind"];
        readonly origin?: DiagnosticRecord["origin"];
      },
    ): Effect.Effect<void, RunnerObservabilityProducerErrorV1> => {
      const code = makeSafeIdentifierV1(value.code);
      if (code === undefined) {
        limitations.addUnsupported("diagnostic");
        return Effect.void;
      }
      const retainedSummary = makeBoundedSafeTextV1(
        value.detail,
        MAX_DIAGNOSTIC_SUMMARY_BYTES_V1,
      );
      if (retainedSummary === undefined) {
        limitations.addUnsupported("diagnostic");
      }
      if (diagnostics.length >= MAX_DIAGNOSTICS_V1) {
        limitations.addCap("diagnostic", diagnostics.length);
        return Effect.void;
      }
      return Effect.map(input.mint("diagnostic"), (diagnosticId) => {
        diagnostics.push(Object.freeze({
          diagnosticId: diagnosticId as DiagnosticIdV1,
          kind: value.kind,
          code,
          phase: attemptDiagnosticPhaseV1(value.origin),
          // The result's one-line detail is already Runner-redacted. Causes,
          // stacks, paths, and arbitrary context remain outside this durable
          // family. An unsafe or oversized detail is deliberately replaced by
          // a generic bounded summary and represented as partial coverage.
          summary: retainedSummary ?? makeBoundedSafeTextV1(
            value.kind === "execution-error"
              ? "Runner recorded an execution error."
              : "Runner recorded an advisory diagnostic.",
            MAX_DIAGNOSTIC_SUMMARY_BYTES_V1,
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
          compareObservabilityTextV1(left.diagnosticId, right.diagnosticId),
        ),
      ),
    });
  });
}

function runDiagnosticPhaseV1(
  origin: TimingOrigin | undefined,
): RunDiagnosticV1["phase"] {
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

function normalizeRunDiagnosticsV1(input: {
  readonly diagnostics: readonly DiagnosticRecord[] | undefined;
  readonly mint: RunEntityMinterV1;
}): Effect.Effect<NormalizedRunObservabilityCaptureV1["diagnostics"], RunnerObservabilityProducerErrorV1> {
  return Effect.gen(function* () {
    const limitations = new RunnerCollectionLimitationsV1();
    if (input.diagnostics === undefined) {
      limitations.addCaptureFailed("run-teardown", "diagnostic");
      return Object.freeze({ collection: limitations.collection(), diagnostics: Object.freeze([]) });
    }

    const diagnostics: RunDiagnosticV1[] = [];
    for (const source of input.diagnostics) {
      const code = makeSafeIdentifierV1(source.code);
      if (code === undefined) {
        limitations.addUnsupported("diagnostic");
        continue;
      }
      const summary = makeBoundedSafeTextV1(source.detail, MAX_DIAGNOSTIC_SUMMARY_BYTES_V1);
      if (summary === undefined) limitations.addUnsupported("diagnostic");
      if (diagnostics.length >= MAX_DIAGNOSTICS_V1) {
        limitations.addCap("diagnostic", diagnostics.length);
        continue;
      }
      const diagnosticId = yield* input.mint("diagnostic");
      diagnostics.push(Object.freeze({
        diagnosticId: diagnosticId as DiagnosticIdV1,
        kind: source.level === "error" ? "execution-error" as const : "advisory" as const,
        code,
        phase: runDiagnosticPhaseV1(source.origin),
        summary: summary ?? makeBoundedSafeTextV1(
          source.level === "error"
            ? "Runner recorded an execution error."
            : "Runner recorded an advisory diagnostic.",
          MAX_DIAGNOSTIC_SUMMARY_BYTES_V1,
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
          compareObservabilityTextV1(left.diagnosticId, right.diagnosticId),
        ),
      ),
    });
  });
}

/**
 * Normalizes only facts already sealed by Runner. It never reads legacy
 * result.json, raw transcript/provider data, Report/Sample data, or paths.
 */
export function createRunnerAttemptObservabilityCaptureV1(input: {
  readonly result: EvalResult;
  readonly sealed: SealedAttemptAssertions;
}): Effect.Effect<
  NormalizedAttemptObservabilityCaptureV1,
  RunnerObservabilityProducerErrorV1
> {
  return Effect.gen(function* () {
    const runtime = runnerAttemptResultStatesV1.get(input.result);
    if (runtime === undefined) return yield* Effect.fail(producerCaptureMissing());
    if (runtime.failure !== undefined) return yield* Effect.fail(runtime.failure);
    const minter = makeAttemptEntityMinterV1(runtime);
    const commands = normalizeCommandsV1(runtime);
    const usage = normalizeUsageV1({ result: input.result, runtime });
    const conversation = yield* normalizeConversationV1({
      result: input.result,
      sealed: input.sealed,
      mint: minter.mint,
      runtime,
    });
    const timing = yield* normalizeAttemptTimingV1({ result: input.result, mint: minter.mint });
    const diagnostics = yield* normalizeAttemptDiagnosticsV1({ result: input.result, mint: minter.mint });
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
export function createRunnerRunObservabilityCaptureV1(input: {
  readonly run: AgentRun;
}): Effect.Effect<NormalizedRunObservabilityCaptureV1, RunnerObservabilityProducerErrorV1> {
  return Effect.gen(function* () {
    const capture = makeRunObservabilityCaptureIdentityV1();
    const minter = makeRunEntityMinterV1(capture);
    const timingLimitations = new RunnerCollectionLimitationsV1();
    timingLimitations.addCaptureFailed("run-teardown", "timing-interval");
    const diagnostics = yield* normalizeRunDiagnosticsV1({
      diagnostics: runnerRunDiagnosticsV1.get(input.run),
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
