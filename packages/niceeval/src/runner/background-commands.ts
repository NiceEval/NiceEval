import {
  commandRetiredInstance,
  dispatchBackgroundCommand,
  SandboxCommandTerminationError,
  waitForCommand,
} from "../sandbox/background-command.ts";
import type { BackgroundCommand, CommandOptions, CommandResult } from "../sandbox/types.ts";

/** One registry per Attempt, shared by the Eval and Sandbox Agent views. */
export class AttemptBackgroundCommands {
  private readonly active = new Set<BackgroundCommand>();
  private readonly instanceStopped = new AbortController();
  private closed = false;
  private retirementRequired = false;
  started = false;

  start(input: {
    readonly command: string;
    readonly options: CommandOptions | undefined;
    readonly attemptSignal: AbortSignal;
    readonly onChecked: () => void;
    readonly diagnosticSensitiveValues: () => readonly string[];
    readonly run: (options: CommandOptions & { readonly signal: AbortSignal }) => Promise<CommandResult>;
  }): BackgroundCommand {
    if (this.closed) throw new Error("Attempt has closed admission for background Sandbox commands");
    this.started = true;
    const handle = dispatchBackgroundCommand({
      ...input,
      run: async (options) => {
        const signal = options.signal!;
        try {
          return await input.run({ ...options, signal });
        } catch (error) {
          this.retirementRequired ||= error instanceof SandboxCommandTerminationError;
          throw error;
        } finally {
          this.retirementRequired ||= commandRetiredInstance(signal);
        }
      },
      onSettled: () => this.active.delete(handle),
    });
    if (!handle.settled) this.active.add(handle);
    return handle;
  }

  /** Keep the provider settlement unless its instance had to be retired independently. */
  async observe<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    const result = await waitForCommand(operation(), this.instanceStopped.signal);
    signal.throwIfAborted();
    return result;
  }

  async drain(): Promise<boolean> {
    this.closed = true;
    const results = await Promise.allSettled([...this.active].map((command) => command.kill()));
    return this.retirementRequired || results.some((result) => result.status === "rejected");
  }

  async completeRetirement(failure?: unknown): Promise<void> {
    this.instanceStopped.abort(
      failure === undefined
        ? new DOMException("Sandbox command cancelled because its instance was retired", "AbortError")
        : new SandboxCommandTerminationError("Sandbox command termination could not be confirmed", { cause: failure }),
    );
    await this.drain();
  }
}
