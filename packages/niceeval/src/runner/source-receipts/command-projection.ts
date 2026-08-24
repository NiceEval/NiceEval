import { createHash } from "node:crypto";

import { Either, Schema } from "effect";

import { redactSensitiveText } from "../../sandbox/redaction.ts";
import type { CommandOptions } from "../../sandbox/types.ts";
import type { LifecyclePhase } from "../types.ts";
import { CanonicalProjectRelativePathSchema } from "../../record/codec/identifiers.ts";
import {
  MAX_COMMAND_ARGUMENT_BYTES,
  MAX_COMMAND_ARGUMENTS,
  MAX_COMMAND_EXECUTABLE_BYTES,
  MAX_COMMAND_PROJECT_RELATIVE_PATH_BYTES,
  MAX_COMMAND_SHELL_BYTES,
  MAX_COMMAND_STREAM_BYTES,
} from "../../record/family/source-receipt/limits.ts";
import {
  makeBoundedSafeText,
  type CommandId,
  type SafeText,
} from "../../record/family/source-receipt/model.ts";
import type { CommandProjectionRuntime } from "./projection-runtime.ts";
import { retainSafeText } from "./projection-text.ts";
import type { CommandManifest, StagedCommandStream } from "./types.ts";
import { requiredNonNegative } from "./support.ts";

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

function commandSafeText(input: {
  readonly commandId: CommandId;
  readonly value: string;
  readonly maximumBytes: number;
  readonly target: "command-manifest" | "command-stdout" | "command-stderr";
  readonly runtime: CommandProjectionRuntime;
}): SafeText {
  const redacted = redactSensitiveText(input.value, input.runtime.sensitiveValues);
  if (redacted !== input.value) input.runtime.commandLimitations.addRedacted(input.target);
  const retained = retainSafeText(redacted, input.maximumBytes);
  if (retained === undefined) {
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
  runtime: CommandProjectionRuntime,
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
    const decoded = Schema.decodeUnknownEither(CanonicalProjectRelativePathSchema)(redacted);
    if (Either.isRight(decoded)) {
      return Object.freeze({ kind: "project-relative" as const, path: decoded.right });
    }
  }
  runtime.commandLimitations.addRedacted("command-manifest");
  return Object.freeze({ kind: "redacted" as const });
}

export function commandManifest(
  command: {
    readonly commandId: CommandId;
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
    arguments_.push(commandSafeText({
      commandId: command.commandId,
      value: raw,
      maximumBytes: MAX_COMMAND_ARGUMENT_BYTES,
      target: "command-manifest",
      runtime,
    }));
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

export function emptyCommandStream(): StagedCommandStream {
  const text = makeBoundedSafeText("", MAX_COMMAND_STREAM_BYTES);
  if (text === undefined) throw new Error("An empty command stream must be SafeText");
  return Object.freeze({
    text,
    retainedBytes: requiredNonNegative(0),
    totalSafeUtf8Bytes: requiredNonNegative(0),
    sha256: createHash("sha256").update(new Uint8Array()).digest("hex"),
  });
}

export function commandStream(input: {
  readonly commandId: CommandId;
  readonly stream: "stdout" | "stderr";
  readonly value: string;
  readonly runtime: CommandProjectionRuntime;
}): StagedCommandStream {
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
  return Object.freeze({
    text: retained.text,
    retainedBytes: retained.retainedBytes,
    totalSafeUtf8Bytes,
    sha256: createHash("sha256").update(new TextEncoder().encode(retained.text)).digest("hex"),
  });
}
