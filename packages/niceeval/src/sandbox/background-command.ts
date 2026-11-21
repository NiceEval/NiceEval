import { successfulCommandResult } from "./operations.ts";
import { commandDisplay, commandSensitiveValues } from "./redaction.ts";
import type { BackgroundCommand, BackgroundCommandOperations, CommandOptions, CommandResult } from "./types.ts";

const retirementRequests = new WeakSet<AbortSignal>();

export function markCommandInstanceRetired(signal: AbortSignal | undefined): void {
  if (signal !== undefined) retirementRequests.add(signal);
}

export function commandRetiredInstance(signal: AbortSignal): boolean {
  return retirementRequests.has(signal);
}

/** The provider could confirm neither command termination nor instance retirement. */
export class SandboxCommandTerminationError extends Error {
  override readonly name = "SandboxCommandTerminationError";
}

export async function retireCommandInstance(signal: AbortSignal | undefined, stop: () => Promise<void>): Promise<void> {
  markCommandInstanceRetired(signal);
  try {
    await stop();
  } catch (cause) {
    throw new SandboxCommandTerminationError("Sandbox command termination could not be confirmed", { cause });
  }
}

export async function waitForCommand<T>(result: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return result;
  signal.throwIfAborted();
  let abort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([result, interrupted]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

export function dispatchBackgroundCommand(input: {
  readonly command: string;
  readonly options: CommandOptions | undefined;
  readonly run: (options: CommandOptions) => Promise<CommandResult>;
  readonly attemptSignal?: AbortSignal;
  readonly onChecked?: () => void;
  readonly onSettled?: () => void;
}): BackgroundCommand {
  const killController = new AbortController();
  const killReason = new DOMException("Sandbox command cancelled", "AbortError");
  const signal = AbortSignal.any([
    killController.signal,
    ...(input.options?.signal === undefined ? [] : [input.options.signal]),
    ...(input.attemptSignal === undefined ? [] : [input.attemptSignal]),
  ]);
  let settled = false;
  // Retain a fulfilled outcome even when the caller never waits on this handle.
  const outcome = (async () => {
    try {
      const result = await input.run({ ...input.options, signal });
      signal.throwIfAborted();
      return { status: "exited" as const, result };
    } catch (error) {
      return {
        status: "failed" as const,
        error: killController.signal.aborted && !(error instanceof SandboxCommandTerminationError) ? killReason : error,
      };
    } finally {
      settled = true;
      input.onSettled?.();
    }
  })();
  const wait: BackgroundCommand["wait"] = async (options) => {
    const terminal = await waitForCommand(outcome, options?.signal);
    if (terminal.status === "failed") throw terminal.error;
    return terminal.result;
  };
  return {
    command: input.command,
    get settled() {
      return settled;
    },
    wait,
    async waitOrThrow(options) {
      options?.signal?.throwIfAborted();
      input.onChecked?.();
      return successfulCommandResult(await wait(options), commandSensitiveValues(input.options));
    },
    async kill() {
      if (settled && !killController.signal.aborted) return;
      killController.abort(killReason);
      const terminal = await outcome;
      if (terminal.status === "failed" && terminal.error instanceof SandboxCommandTerminationError)
        throw terminal.error;
    },
  };
}

export function backgroundCommandOperations(
  commands: Pick<import("./types.ts").Sandbox, "runCommand" | "runShell">,
): BackgroundCommandOperations {
  const start = (
    command: string,
    args: readonly string[] | undefined,
    options: CommandOptions | undefined,
    run: (options: CommandOptions) => Promise<CommandResult>,
  ) =>
    dispatchBackgroundCommand({
      command: commandDisplay(command, args, commandSensitiveValues(options)),
      options,
      run,
    });
  return {
    async startCommand(command, args, options) {
      return start(command, args, options, (opts) => commands.runCommand(command, args, opts));
    },
    async startShell(script, options) {
      return start(script, undefined, options, (opts) => commands.runShell(script, opts));
    },
  };
}
