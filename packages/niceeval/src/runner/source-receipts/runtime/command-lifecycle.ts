import type { LifecyclePhase } from "../../types.ts";
import {
  recordRegisteredCommandResult,
  registerCommandCapture,
  registeredCommandId,
} from "../capture-identity.ts";
import {
  MAX_COMMANDS,
} from "../../../record/family/source-receipt/limits.ts";
import {
  commandManifest,
  commandStream,
  emptyCommandStream,
} from "../event-projection.ts";
import {
  producerCommandRegistrationInvalid,
  producerEntityIdInvalid,
  requiredPositive,
} from "../support.ts";
import { sourceSegmentId } from "./receipt-helpers.ts";
import {
  commandHandleState,
  makeCommandHandle,
  markRuntimeFailure,
  mintRuntimeCommand,
  runtimeState,
  type CapturedCommandResult,
  type CapturedCommandRuntime,
  type RunnerAttemptObservabilityRuntime,
  type RunnerAttemptObservabilityRuntimeState,
  type RunnerCommandCaptureHandle,
} from "./state.ts";

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
  if (runtime.failure !== undefined || runtime.snapshot !== undefined) return undefined;
  if (runtime.commands.length >= MAX_COMMANDS) {
    runtime.commandLimitations.addCap("command-manifest", runtime.commands.length);
    return undefined;
  }
  const minted = mintRuntimeCommand(runtime);
  if (minted === undefined) return undefined;
  const { commandId } = minted;
  const segmentId = sourceSegmentId();
  if (segmentId === undefined) {
    markRuntimeFailure(runtime, producerEntityIdInvalid("command"));
    return undefined;
  }
  const registered = registerCommandCapture(runtime.capture, minted.entity);
  if (registered === undefined || registeredCommandId(registered) !== commandId) {
    markRuntimeFailure(runtime, producerCommandRegistrationInvalid());
    return undefined;
  }
  const manifest = commandManifest({
    commandId,
    phase: input.phase,
    invocationKind: input.invocationKind,
    command: input.command,
    args: input.args,
    options: input.options,
  }, runtime);
  const command: CapturedCommandRuntime = {
    segmentId,
    commandId,
    registered,
    sequence: requiredPositive(runtime.commands.length + 1),
    manifest,
  };
  runtime.commands.push(command);
  return makeCommandHandle(runtime, command);
}

function acceptRegisteredCommandResult(state: {
  readonly runtime: RunnerAttemptObservabilityRuntimeState;
  readonly command: CapturedCommandRuntime;
}): boolean {
  if (state.runtime.snapshot !== undefined) return false;
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

export function recordTerminalCommandResult(
  state: {
    readonly runtime: RunnerAttemptObservabilityRuntimeState;
    readonly command: CapturedCommandRuntime;
  },
  outcome: Exclude<CapturedCommandResult["outcome"], { readonly kind: "exited" }>,
): void {
  if (!acceptRegisteredCommandResult(state)) return;
  state.command.result = Object.freeze({
    outcome: Object.freeze(outcome),
    stdout: emptyCommandStream(),
    stderr: emptyCommandStream(),
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
      stdout: emptyCommandStream(),
      stderr: emptyCommandStream(),
    });
    return;
  }
  const stdout = typeof input.stdout === "string" ? input.stdout : "";
  const stderr = typeof input.stderr === "string" ? input.stderr : "";
  if (typeof input.stdout !== "string") state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stdout");
  if (typeof input.stderr !== "string") state.runtime.commandLimitations.addCaptureFailed("command-capture", "command-stderr");
  state.command.result = Object.freeze({
    outcome: Object.freeze({ kind: "exited" as const, exitCode: input.exitCode }),
    stdout: commandStream({
      commandId: state.command.commandId,
      stream: "stdout",
      value: stdout,
      runtime: state.runtime,
    }),
    stderr: commandStream({
      commandId: state.command.commandId,
      stream: "stderr",
      value: stderr,
      runtime: state.runtime,
    }),
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
