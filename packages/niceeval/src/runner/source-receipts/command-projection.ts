import { createHash } from "node:crypto";

import { Result, Schema } from "effect";

import { redactSensitiveText } from "../../sandbox/redaction.ts";
import type { CommandOptions } from "../../sandbox/types.ts";
import type { LifecyclePhase } from "../types.ts";
import { SandboxCommandWorkingDirectoryPathSchema } from "../../record/family/sandbox-commands/definition.ts";
import { makeSafeText, type CommandId, type SafeText } from "../../record/family/source-receipt/model.ts";
import type { CommandProjectionRuntime } from "./projection-runtime.ts";
import type { CommandManifest, StagedCommandStream } from "./types.ts";
import { requiredNonNegative } from "./support.ts";

function commandManifestPhase(phase: LifecyclePhase): CommandManifest["phase"] {
  switch (phase) {
    case "attempt.setup":
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
    case "agent.install":
      return "agent.install";
    case "eval.run":
      return "eval.run";
    case "agent.run":
      return "sandbox.command";
    case "agent.teardown":
    case "attempt.teardown":
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

function commandSafeText(value: string, runtime: CommandProjectionRuntime): SafeText {
  const redacted = redactSensitiveText(value, runtime.sensitiveValues);
  if (redacted !== value) runtime.commandLimitations.addRedacted("command-manifest");
  const retained = makeSafeText(redacted);
  if (retained === undefined) {
    runtime.commandLimitations.addCaptureFailed("command-capture", "command-manifest");
    const replacement = makeSafeText("[unavailable]");
    if (replacement === undefined) {
      throw new Error("The fixed unavailable command marker must be SafeText");
    }
    return replacement;
  }
  return retained;
}

function commandWorkingDirectory(
  options: unknown,
  runtime: CommandProjectionRuntime,
): CommandManifest["workingDirectory"] {
  const candidate = options as Partial<Pick<CommandOptions, "cwd">> | undefined;
  const cwd = candidate?.cwd;
  if (cwd === undefined || cwd === ".") return { kind: "sandbox-default" as const };
  if (typeof cwd !== "string") {
    runtime.commandLimitations.addUnsupported("command-manifest");
    return { kind: "redacted" as const };
  }
  const redacted = redactSensitiveText(cwd, runtime.sensitiveValues);
  if (redacted !== cwd) runtime.commandLimitations.addRedacted("command-manifest");
  if (!redacted.includes(":") && makeSafeText(redacted) !== undefined) {
    const decoded = Schema.decodeUnknownResult(SandboxCommandWorkingDirectoryPathSchema)(redacted);
    if (Result.isSuccess(decoded)) {
      return { kind: "project-relative" as const, path: decoded.success };
    }
  }
  runtime.commandLimitations.addRedacted("command-manifest");
  return { kind: "redacted" as const };
}

export function commandManifest(
  command: {
    readonly phase: LifecyclePhase;
    readonly invocationKind: "argv" | "shell";
    readonly command: string;
    readonly args: readonly string[] | undefined;
    readonly options: unknown;
  },
  runtime: CommandProjectionRuntime,
): CommandManifest {
  const phase = commandManifestPhase(command.phase);
  const workingDirectory = commandWorkingDirectory(command.options, runtime);
  if (command.invocationKind === "shell") {
    const script = commandSafeText(command.command, runtime);
    return {
      phase,
      invocation: { kind: "shell" as const, command: script },
      workingDirectory,
    };
  }
  const executable = commandSafeText(command.command, runtime);
  const arguments_ = (command.args ?? []).map((argument) => commandSafeText(argument, runtime));
  return {
    phase,
    invocation: {
      kind: "argv" as const,
      executable,
      arguments: arguments_,
    },
    workingDirectory,
  };
}

function stripUnsafeCommandControls(value: string): { readonly text: string; readonly count: number } {
  let text = "";
  let count = 0;
  for (const scalar of value) {
    const code = scalar.codePointAt(0);
    if (code !== undefined && ((code >= 0 && code <= 0x1f && code !== 0x0a) || (code >= 0x7f && code <= 0x9f))) {
      count += 1;
      continue;
    }
    text += scalar;
  }
  return { text, count };
}

export function emptyCommandStream(): StagedCommandStream {
  const text = makeSafeText("");
  if (text === undefined) throw new Error("An empty command stream must be SafeText");
  return {
    text,
    retainedBytes: requiredNonNegative(0),
    totalSafeUtf8Bytes: requiredNonNegative(0),
    sha256: createHash("sha256").update(new Uint8Array()).digest("hex"),
  };
}

export function commandStream(input: {
  readonly commandId: CommandId;
  readonly stream: "stdout" | "stderr";
  readonly value: string;
  readonly runtime: CommandProjectionRuntime;
}): StagedCommandStream {
  const target = input.stream === "stdout" ? ("command-stdout" as const) : ("command-stderr" as const);
  const redacted = redactSensitiveText(input.value, input.runtime.sensitiveValues);
  if (redacted !== input.value) input.runtime.commandLimitations.addRedacted(target);
  const stripped = stripUnsafeCommandControls(redacted);
  if (stripped.count > 0) {
    input.runtime.commandLimitations.addUnsafeCommandControlStripped(input.commandId, input.stream, stripped.count);
  }
  const text = makeSafeText(stripped.text);
  if (text === undefined) {
    input.runtime.commandLimitations.addCaptureFailed("command-capture", target);
    return emptyCommandStream();
  }
  const bytes = new TextEncoder().encode(text);
  const byteLength = requiredNonNegative(bytes.byteLength);
  return {
    text,
    retainedBytes: byteLength,
    totalSafeUtf8Bytes: byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}
