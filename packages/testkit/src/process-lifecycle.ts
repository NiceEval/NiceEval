import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { PassThrough } from "node:stream";
import { ProcessReceipt, ProcessStartError } from "./process.js";
import type { Argv } from "./process.js";

export const DEFAULT_GRACE_MS = 2000;

const PROCESS_GROUP_POLL_MS = 25;

function linuxProcessGroupHasLiveMembers(groupId: number): boolean | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      let stat: string;
      try {
        stat = readFileSync(`/proc/${entry.name}/stat`, "utf8");
      } catch (error) {
        if (errorCode(error) === "ENOENT") continue;
        return undefined;
      }
      const match = /^\d+ \(.*\) (\S) \d+ (-?\d+) /.exec(stat);
      if (match === null) return undefined;
      if (Number(match[2]) === groupId && match[1] !== "Z" && match[1] !== "X") {
        return true;
      }
    }
    return false;
  } catch {
    return undefined;
  }
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

export interface StartOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  processGroup?: boolean;
  timeoutMs?: number;
  graceMs?: number;
}

export class ProcessHandle {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  readonly done: Promise<ProcessReceipt>;

  private readonly argv: Argv;
  private readonly cwd: string;
  private readonly processGroup: boolean;
  private readonly graceMs: number;
  private readonly child: ChildProcess;
  private readonly startedAt: number;
  private readonly stdoutChunks: Buffer[];
  private readonly stderrChunks: Buffer[];
  private disposed = false;
  private terminated = false;
  private settled = false;
  private timedOut = false;
  private timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  private termination: Promise<void> | undefined;

  constructor(argv: Argv, options: StartOptions, child: ChildProcess) {
    this.argv = argv;
    this.cwd = options.cwd ?? process.cwd();
    this.processGroup = options.processGroup === true;
    this.graceMs = options.graceMs ?? DEFAULT_GRACE_MS;
    this.child = child;
    this.pid = child.pid;
    this.startedAt = Date.now();
    this.stdoutChunks = [];
    this.stderrChunks = [];

    const stdoutTee = child.stdout === null ? null : new PassThrough();
    const stderrTee = child.stderr === null ? null : new PassThrough();
    child.stdout?.on("data", (chunk: Buffer) => {
      this.stdoutChunks.push(chunk);
      stdoutTee?.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrChunks.push(chunk);
      stderrTee?.write(chunk);
    });
    this.stdout = stdoutTee;
    this.stderr = stderrTee;

    this.done = new Promise<ProcessReceipt>((resolve, reject) => {
      child.on("error", (cause) => {
        if (this.settled) {
          return;
        }
        this.settled = true;
        if (this.timeoutTimer !== undefined) clearTimeout(this.timeoutTimer);
        stdoutTee?.end();
        stderrTee?.end();
        reject(new ProcessStartError(argv, this.cwd, cause));
      });
      child.on("close", (code, signal) => {
        if (this.settled) {
          return;
        }
        this.settled = true;
        if (this.timeoutTimer !== undefined) clearTimeout(this.timeoutTimer);
        stdoutTee?.end();
        stderrTee?.end();
        resolve(
          new ProcessReceipt({
            argv,
            cwd: this.cwd,
            exitCode: code,
            signal,
            stdout: Buffer.concat(this.stdoutChunks).toString("utf8"),
            stderr: Buffer.concat(this.stderrChunks).toString("utf8"),
            durationMs: Date.now() - this.startedAt,
            timedOut: this.timedOut,
          }),
        );
      });
    });

    if (options.timeoutMs !== undefined) {
      this.timeoutTimer = setTimeout(() => {
        if (this.settled || this.terminated) {
          return;
        }
        this.timedOut = true;
        // startProcess is an escape hatch whose caller must still dispose the
        // handle. Keep a failed group cleanup on `termination` for dispose()
        // to surface instead of creating an unhandled rejection here.
        void this.terminate().catch(() => {});
      }, options.timeoutMs);
    }
  }

  /** @internal raw buffered output since spawn; used by waitForOutput-style helpers */
  get bufferedStdout(): string {
    return Buffer.concat(this.stdoutChunks).toString("utf8");
  }

  /** @internal raw buffered output since spawn; used by waitForOutput-style helpers */
  get bufferedStderr(): string {
    return Buffer.concat(this.stderrChunks).toString("utf8");
  }

  /** @internal true once the receipt promise has settled */
  get settledExit(): boolean {
    return this.settled;
  }

  signal(signal: NodeJS.Signals): boolean {
    const pid = this.child.pid;
    if (pid === undefined) {
      return false;
    }
    try {
      return this.child.kill(signal);
    } catch {
      return false;
    }
  }

  private sendTermination(signal: NodeJS.Signals): void {
    const pid = this.child.pid;
    if (pid === undefined) {
      return;
    }
    try {
      if (this.processGroup) {
        process.kill(-pid, signal);
      } else {
        this.child.kill(signal);
      }
    } catch {
      // group or root already gone: nothing left to terminate
    }
  }

  private ownedGroupExists(): boolean {
    if (!this.processGroup || this.pid === undefined) {
      return false;
    }
    // A zombie has already exited and cannot retain ports, files, or compute.
    // Container PID 1 may reap it late (or never), while kill(-pgid, 0) keeps
    // reporting that historical group as present. On Linux, inspect /proc so
    // cleanup waits only for members that can still run; retain the portable,
    // conservative signal probe everywhere else.
    const hasLiveLinuxMember = linuxProcessGroupHasLiveMembers(this.pid);
    if (hasLiveLinuxMember !== undefined) return hasLiveLinuxMember;
    try {
      process.kill(-this.pid, 0);
      return true;
    } catch (error) {
      if (errorCode(error) === "ESRCH") return false;
      if (errorCode(error) === "EPERM") return true;
      throw error;
    }
  }

  private async waitForOwnedGroupExit(timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (this.ownedGroupExists()) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) return false;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, Math.min(PROCESS_GROUP_POLL_MS, remaining));
      });
    }
    return true;
  }

  private async terminateOwnedGroup(): Promise<void> {
    if (!this.ownedGroupExists()) {
      await this.done;
      return;
    }

    this.sendTermination("SIGTERM");
    if (!(await this.waitForOwnedGroupExit(this.graceMs))) {
      this.sendTermination("SIGKILL");
      if (!(await this.waitForOwnedGroupExit(this.graceMs))) {
        throw new Error(
          `process group ${this.pid} still exists after SIGTERM and SIGKILL`,
        );
      }
    }
    await this.done;
  }

  private terminate(): Promise<void> {
    if (this.termination !== undefined) return this.termination;
    this.terminated = true;
    if (this.processGroup) {
      this.termination = this.terminateOwnedGroup();
      return this.termination;
    }
    this.sendTermination("SIGTERM");
    this.termination = new Promise<void>((resolve) => {
      const settle = () => {
        clearTimeout(timeout);
        resolve();
      };
      const timeout = setTimeout(() => {
        this.sendTermination("SIGKILL");
        void this.done.then(settle, settle);
      }, this.graceMs);
      void this.done.then(settle, settle);
    });
    return this.termination;
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.child.pid === undefined) {
      throw new ProcessStartError(
        this.argv,
        this.cwd,
        new Error("process never started; cannot dispose it"),
      );
    }
    if (this.settled && !this.processGroup) {
      return;
    }
    await this.terminate();
  }
}

export function startProcess(argv: Argv, options: StartOptions = {}): ProcessHandle {
  if (options.processGroup === true && process.platform === "win32") {
    throw new Error(
      "processGroup: true requires POSIX process-group signals and is unsupported on win32",
    );
  }
  const child = spawn(argv[0], argv.slice(1), {
    cwd: options.cwd ?? process.cwd(),
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    stdio: ["ignore", "pipe", "pipe"],
    detached: options.processGroup === true,
  });
  return new ProcessHandle(argv, options, child);
}

/** Wait for output without losing bytes written before the waiter subscribed. */
export function waitForOutput(
  handle: ProcessHandle,
  stream: "stdout" | "stderr",
  pattern: RegExp,
  options: { timeoutMs: number; label: string },
): Promise<string> {
  const readable = handle[stream];
  if (readable === null) {
    return Promise.reject(new Error(`${options.label}: ${stream} is not piped`));
  }

  const read = () => stream === "stdout" ? handle.bufferedStdout : handle.bufferedStderr;
  const matches = (text: string) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  };

  return new Promise<string>((resolve, reject) => {
    let finished = false;
    const finish = (outcome: { value: string } | { error: unknown }) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      readable.off("data", onData);
      if ("value" in outcome) resolve(outcome.value);
      else reject(outcome.error);
    };
    const inspect = () => {
      const text = read();
      if (matches(text)) finish({ value: text });
    };
    const onData = () => inspect();
    const timer = setTimeout(() => {
      finish({
        error: new Error(
          `${options.label}: timed out after ${options.timeoutMs}ms waiting for ${pattern}; ${stream}=${JSON.stringify(read())}`,
        ),
      });
    }, options.timeoutMs);

    readable.on("data", onData);
    inspect();
    void handle.done.then(
      (receipt) => {
        inspect();
        if (!finished) {
          finish({
            error: new Error(
              `${options.label}: process exited before producing ${pattern}\n\n${receipt.diagnostic()}`,
            ),
          });
        }
      },
      (error: unknown) => finish({ error }),
    );
  });
}

export async function withProcess<T>(
  argv: Argv,
  options: StartOptions,
  body: (process: ProcessHandle) => Promise<T>,
): Promise<T> {
  const handle = startProcess(argv, options);
  // dispose() 通过 pid 同步判定"从未启动"并抛 ProcessStartError；
  // 同一个失败的 done 不能被 withProcess 丢弃后成为 unhandled rejection。
  void handle.done.catch(() => {});
  let bodyFailed = false;
  let bodyError: unknown;
  let bodyValue: T | undefined;
  try {
    bodyValue = await body(handle);
  } catch (error) {
    bodyFailed = true;
    bodyError = error;
  }

  let cleanupError: unknown;
  try {
    await handle.dispose();
  } catch (error) {
    cleanupError = error;
  }

  if (bodyFailed && cleanupError !== undefined) {
    const aggregate = new AggregateError(
      [bodyError, cleanupError],
      "withProcess: body and cleanup both failed",
    );
    aggregate.cause = bodyError;
    throw aggregate;
  }
  if (cleanupError !== undefined) {
    throw cleanupError;
  }
  if (bodyFailed) {
    throw bodyError;
  }
  return bodyValue as T;
}
