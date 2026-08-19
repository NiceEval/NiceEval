// Runner-local ownership for external commands.
//
// Every long-running command the root E2E runner starts runs in a detached
// process group on supported hosts. That lets the runner terminate the group
// it owns, rather than only the immediate shell/pnpm child. This module does
// not install process-wide signal handlers: the root CLI is the sole owner of
// that policy and forwards cancellation through this supervisor.

import { spawn, type ChildProcess } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";

export type OwnedProcessOutput = "capture" | "inherit";
export type OwnedTermination = "timeout" | "cancelled";

export interface OwnedProcessOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** Capture both streams for a receipt, or let them stream directly to the terminal. */
  output: OwnedProcessOutput;
  /** In capture mode, also mirror chunks to the root process streams. Defaults to true. */
  stream?: boolean;
  /** A per-command deadline. Timeout sends TERM, waits for grace, then KILLs the owned group. */
  timeoutMs?: number;
  /** Stops a command that has already started and prevents a new one from starting. */
  abortSignal?: AbortSignal;
  /** Prefix each streamed line without changing captured stdout/stderr. */
  streamPrefix?: string;
}

export interface OwnedProcessResult {
  command: readonly string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  cancelled: boolean;
  stdout: string;
  stderr: string;
  /** Spawn failure, if no process could be started. Never contains environment values. */
  error?: string;
  /** True only when this runner created a detached POSIX process group. */
  processGroupOwned: boolean;
  /**
   * Post-`close` process-group evidence. A command leader exiting is not
   * enough: a stdio-detached background child can still keep the owned group
   * alive. The runner never probes or signals a group it did not create.
   */
  groupCleanup: OwnedProcessGroupCleanup;
}

export interface OwnedProcessGroupCleanup {
  /** True only for the detached POSIX group created for this command. */
  owned: boolean;
  /** Whether the runner successfully performed the post-close presence check. */
  checked: boolean;
  /** Whether that owned group still existed after the command leader closed. */
  aliveAfterLeaderClose: boolean | null;
  /** Original process-group id, recorded only for an owned group. */
  groupId?: number;
  /** Signals successfully sent only to the owned negative-pid group. */
  signalsSent: readonly NodeJS.Signals[];
  /** True only when the runner confirmed that the owned group disappeared. */
  gone: boolean | null;
  detail: string;
}

interface LinuxProcessGroupMembers {
  readonly live: readonly number[];
  readonly zombies: readonly number[];
}

function linuxProcessGroupMembers(groupId: number): LinuxProcessGroupMembers | undefined {
  if (process.platform !== "linux") return undefined;
  try {
    const live: number[] = [];
    const zombies: number[] = [];
    for (const entry of readdirSync("/proc", { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^\d+$/u.test(entry.name)) continue;
      let stat: string;
      try {
        stat = readFileSync(`/proc/${entry.name}/stat`, "utf8");
      } catch {
        continue;
      }
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd < 0) continue;
      const fields = stat.slice(commandEnd + 1).trimStart().split(/\s+/u);
      const state = fields[0];
      const processGroup = Number(fields[2]);
      if (!Number.isInteger(processGroup) || processGroup !== groupId) continue;
      const pid = Number(entry.name);
      if (state === "Z" || state === "X") zombies.push(pid);
      else live.push(pid);
    }
    return { live, zombies };
  } catch {
    return undefined;
  }
}

function noOwnedGroupCleanup(detail: string): OwnedProcessGroupCleanup {
  return {
    owned: false,
    checked: false,
    aliveAfterLeaderClose: null,
    signalsSent: [],
    gone: null,
    detail,
  };
}

/** A successful command must also leave no process in a group the runner owns. */
export function hasConfirmedOwnedGroupCleanup(result: Pick<OwnedProcessResult, "processGroupOwned" | "groupCleanup">): boolean {
  return !result.processGroupOwned || result.groupCleanup.gone === true;
}

/**
 * A process outcome is successful only when it reached a normal exit before
 * its deadline and left no owned group behind. In particular, a command that
 * handles TERM and exits zero after its timeout is still a timeout failure.
 */
export function hasSuccessfulOwnedProcessResult(
  result: Pick<
    OwnedProcessResult,
    "exitCode" | "signal" | "timedOut" | "cancelled" | "error" | "processGroupOwned" | "groupCleanup"
  >,
): boolean {
  return (
    result.exitCode === 0 &&
    result.signal === null &&
    !result.timedOut &&
    !result.cancelled &&
    result.error === undefined &&
    hasConfirmedOwnedGroupCleanup(result)
  );
}

export class E2EExecutionCancelledError extends Error {
  constructor(message = "e2e execution cancelled before a new stage could start") {
    super(message);
    this.name = "E2EExecutionCancelledError";
  }
}

export function signalFromAbort(abortSignal: AbortSignal | undefined): NodeJS.Signals {
  const reason = abortSignal?.reason;
  return reason === "SIGINT" || reason === "SIGTERM" ? reason : "SIGTERM";
}

export interface E2EExecutionControl {
  supervisor: OwnedProcessSupervisor;
  abortSignal: AbortSignal;
}

export function createUnmanagedExecutionControl(): E2EExecutionControl {
  return {
    supervisor: new OwnedProcessSupervisor(),
    abortSignal: new AbortController().signal,
  };
}

export function isExecutionCancelled(control: E2EExecutionControl | undefined): boolean {
  return control?.abortSignal.aborted === true || control?.supervisor.stoppingSignal !== undefined;
}

export function throwIfExecutionCancelled(control: E2EExecutionControl | undefined): void {
  if (isExecutionCancelled(control)) throw new E2EExecutionCancelledError();
}

class ActiveOwnedProcess {
  readonly closed: Promise<OwnedProcessResult>;

  private resolveClosed!: (result: OwnedProcessResult) => void;
  private stdout = "";
  private stderr = "";
  private error: string | undefined;
  private termination: OwnedTermination | undefined;
  private killTimer: NodeJS.Timeout | undefined;
  private terminationDeadline: number | undefined;
  private settled = false;
  private readonly groupId: number | undefined;
  private groupChecked = false;
  private groupAliveAfterLeaderClose: boolean | null = null;
  private groupGone: boolean | null = null;
  private groupCleanupDetail: string;
  private readonly groupSignalsSent: NodeJS.Signals[] = [];
  private killAttempted = false;
  private stdoutAtLineStart = true;
  private stderrAtLineStart = true;

  constructor(
    private readonly child: ChildProcess,
    private readonly command: readonly string[],
    private readonly output: OwnedProcessOutput,
    private readonly stream: boolean,
    private readonly graceMs: number,
    private readonly processGroupOwned: boolean,
    private readonly streamPrefix?: string,
  ) {
    const pid = child.pid;
    // `detached: true` creates a new POSIX session/process group whose id is
    // the direct child's pid. Keep that pid private to this object: it came
    // from our own spawn call, is never caller supplied, and cannot equal the
    // runner process. We never signal any other group.
    this.groupId = processGroupOwned && pid !== undefined && pid > 0 && pid !== process.pid ? pid : undefined;
    this.groupCleanupDetail = processGroupOwned
      ? this.groupId === undefined
        ? "owned process group could not be identified from the spawned child pid"
        : `awaiting command leader close for owned process group ${this.groupId}`
      : "no detached POSIX process group was created on this host";
    this.closed = new Promise<OwnedProcessResult>((resolve) => {
      this.resolveClosed = resolve;
    });

    if (output === "capture") {
      child.stdout?.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        this.stdout += text;
        if (stream) process.stdout.write(this.prefixedChunk(text, "stdout"));
      });
      child.stderr?.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        this.stderr += text;
        if (stream) process.stderr.write(this.prefixedChunk(text, "stderr"));
      });
    }

    child.once("error", (error) => {
      this.error = error.message;
    });
    // `close`, rather than `exit`, means stdio is closed and capture is complete.
    child.once("close", (exitCode, signal) => {
      // `close`, rather than `exit`, means the leader's stdio capture is
      // complete. It does not prove its detached process group is empty, so
      // finish only after the owned-group postcondition below.
      void this.finishAfterLeaderClose(exitCode, signal);
    });
  }

  private prefixedChunk(text: string, channel: "stdout" | "stderr"): string {
    if (this.streamPrefix === undefined || text.length === 0) return text;
    const atLineStart = channel === "stdout" ? this.stdoutAtLineStart : this.stderrAtLineStart;
    const prefix = `[${this.streamPrefix}] `;
    const transformed = `${atLineStart ? prefix : ""}${text.replace(/\n(?!$)/g, `\n${prefix}`)}`;
    if (channel === "stdout") this.stdoutAtLineStart = text.endsWith("\n");
    else this.stderrAtLineStart = text.endsWith("\n");
    return transformed;
  }

  requestTermination(signal: NodeJS.Signals, cause: OwnedTermination): void {
    if (this.settled) return;
    // An operator cancellation is more specific than a timeout that happened
    // just before it, so it wins the final structured status.
    if (this.termination !== "cancelled") this.termination = cause;
    this.sendSignal(signal);
    if (this.killTimer === undefined) {
      this.terminationDeadline = Date.now() + this.graceMs;
      this.killTimer = setTimeout(() => this.forceKill(), this.graceMs);
      this.killTimer.unref();
    }
  }

  forceKill(): void {
    if (this.settled) return;
    if (this.killAttempted) return;
    this.killAttempted = true;
    this.sendSignal("SIGKILL");
  }

  private sendSignal(signal: NodeJS.Signals): boolean {
    try {
      if (this.processGroupOwned && this.groupId !== undefined) {
        // A detached POSIX child is the leader of a process group whose id is
        // its pid. Negative pid targets only the group created by this spawn.
        process.kill(-this.groupId, signal);
        this.groupSignalsSent.push(signal);
      } else {
        return this.child.kill(signal);
      }
      return true;
    } catch {
      // The group may already be gone. The close listener remains the single
      // source of completion and drains all still-open stdio.
      return false;
    }
  }

  private groupPresence(): "alive" | "zombie-only" | "gone" | "unknown" {
    if (!this.processGroupOwned || this.groupId === undefined) return "unknown";
    try {
      // Signal 0 is a presence/permission probe. It targets only the negative
      // pid of the detached group created by this object; no caller-supplied
      // or ambient process id is ever used here.
      process.kill(-this.groupId, 0);
      const members = linuxProcessGroupMembers(this.groupId);
      return members !== undefined && members.live.length === 0 && members.zombies.length > 0
        ? "zombie-only"
        : "alive";
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH" ? "gone" : "unknown";
    }
  }

  private async waitForGroupGone(timeoutMs: number): Promise<"alive" | "zombie-only" | "gone" | "unknown"> {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (true) {
      const presence = this.groupPresence();
      if (presence !== "alive") return presence;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return "alive";
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, remaining)));
    }
  }

  private markGroupGone(detail: string): void {
    this.groupGone = true;
    this.groupCleanupDetail = detail;
  }

  private markGroupUnconfirmed(detail: string): void {
    this.groupGone = false;
    this.groupCleanupDetail = detail;
  }

  /**
   * Enforce the owned-group postcondition after the direct command has closed.
   * A normal leader exit gets TERM → grace → KILL. For a signal/timeout path
   * the original signal has already been forwarded, so we honour its existing
   * grace window before the KILL escalation.
   */
  private async ensureOwnedGroupGoneAfterLeaderClose(): Promise<void> {
    if (!this.processGroupOwned) return;
    if (this.groupId === undefined) {
      this.markGroupUnconfirmed("owned process group has no safe child-pid identity to inspect");
      return;
    }

    const initial = this.groupPresence();
    this.groupChecked = true;
    if (initial === "zombie-only") {
      this.groupAliveAfterLeaderClose = false;
      this.markGroupGone(`owned process group ${this.groupId} had only non-running zombie members after command leader close`);
      return;
    }
    if (initial === "gone") {
      this.groupAliveAfterLeaderClose = false;
      this.markGroupGone(`owned process group ${this.groupId} was absent after command leader close`);
      return;
    }
    if (initial === "unknown") {
      this.markGroupUnconfirmed(`could not verify whether owned process group ${this.groupId} remained after leader close`);
      return;
    }

    this.groupAliveAfterLeaderClose = true;
    if (this.termination === undefined) {
      this.sendSignal("SIGTERM");
      const afterTerm = await this.waitForGroupGone(this.graceMs);
      if (afterTerm === "zombie-only") {
        this.markGroupGone(`owned process group ${this.groupId} had only non-running zombie members after TERM`);
        return;
      }
      if (afterTerm === "gone") {
        this.markGroupGone(`owned process group ${this.groupId} remained after leader close and exited after TERM`);
        return;
      }
      if (afterTerm === "unknown") {
        this.markGroupUnconfirmed(`could not verify owned process group ${this.groupId} after TERM grace`);
        return;
      }
    } else {
      // A root SIGINT/SIGTERM (or timeout TERM) was already delivered while
      // the leader was active. Wait out that same bounded grace rather than
      // changing a SIGINT cancellation into an immediate unrelated TERM.
      const remaining = Math.max(0, (this.terminationDeadline ?? Date.now()) - Date.now());
      const afterInitialSignal = await this.waitForGroupGone(remaining);
      if (afterInitialSignal === "zombie-only") {
        this.markGroupGone(`owned process group ${this.groupId} had only non-running zombie members after the existing signal grace period`);
        return;
      }
      if (afterInitialSignal === "gone") {
        this.markGroupGone(`owned process group ${this.groupId} exited during the existing signal grace period`);
        return;
      }
      if (afterInitialSignal === "unknown") {
        this.markGroupUnconfirmed(`could not verify owned process group ${this.groupId} after signal grace`);
        return;
      }
    }

    // This is either normal-exit TERM escalation or the end of a previously
    // forwarded cancellation/timeout grace. `forceKill` still targets exactly
    // this object's negative group id and is idempotent.
    this.forceKill();
    const afterKill = await this.waitForGroupGone(this.graceMs);
    if (afterKill === "zombie-only") {
      this.markGroupGone(`owned process group ${this.groupId} had only non-running zombie members after KILL; host init retains reaping responsibility`);
      return;
    }
    if (afterKill === "gone") {
      this.markGroupGone(`owned process group ${this.groupId} required KILL after leader close`);
      return;
    }
    if (afterKill === "unknown") {
      this.markGroupUnconfirmed(`could not verify owned process group ${this.groupId} after KILL`);
      return;
    }
    this.markGroupUnconfirmed(`owned process group ${this.groupId} remained after TERM/grace/KILL cleanup`);
  }

  private groupCleanup(): OwnedProcessGroupCleanup {
    if (!this.processGroupOwned) return noOwnedGroupCleanup(this.groupCleanupDetail);
    return {
      owned: true,
      checked: this.groupChecked,
      aliveAfterLeaderClose: this.groupAliveAfterLeaderClose,
      ...(this.groupId === undefined ? {} : { groupId: this.groupId }),
      signalsSent: [...this.groupSignalsSent],
      gone: this.groupGone,
      detail: this.groupCleanupDetail,
    };
  }

  private async finishAfterLeaderClose(exitCode: number | null, signal: NodeJS.Signals | null): Promise<void> {
    try {
      await this.ensureOwnedGroupGoneAfterLeaderClose();
    } catch (error) {
      this.markGroupUnconfirmed(
        `owned process-group cleanup threw: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.finish(exitCode, signal);
  }

  private finish(exitCode: number | null, signal: NodeJS.Signals | null): void {
    if (this.settled) return;
    this.settled = true;
    if (this.killTimer !== undefined) clearTimeout(this.killTimer);
    this.resolveClosed({
      command: this.command,
      exitCode,
      signal,
      timedOut: this.termination === "timeout",
      cancelled: this.termination === "cancelled",
      stdout: this.stdout,
      stderr: this.stderr,
      ...(this.error === undefined ? {} : { error: this.error }),
      processGroupOwned: this.processGroupOwned,
      groupCleanup: this.groupCleanup(),
    });
  }
}

/**
 * Owns exactly the process groups started through it. It intentionally makes
 * no claim about containers, sandbox sessions, or processes a scenario starts
 * in a new session; those remain the scenario owner's receipt responsibility.
 */
export class OwnedProcessSupervisor {
  private readonly active = new Set<ActiveOwnedProcess>();
  private stoppedBy: NodeJS.Signals | undefined;

  constructor(private readonly graceMs = 5_000) {}

  get stoppingSignal(): NodeJS.Signals | undefined {
    return this.stoppedBy;
  }

  get activeCount(): number {
    return this.active.size;
  }

  async run(command: readonly string[], options: OwnedProcessOptions): Promise<OwnedProcessResult> {
    if (command.length === 0 || command[0] === undefined) {
      throw new Error("owned process command must contain an executable");
    }

    const cancellation = this.stoppedBy ?? (options.abortSignal?.aborted ? signalFromAbort(options.abortSignal) : undefined);
    if (cancellation !== undefined) {
      return {
        command,
        exitCode: null,
        signal: cancellation,
        timedOut: false,
        cancelled: true,
        stdout: "",
        stderr: "",
        processGroupOwned: false,
        groupCleanup: noOwnedGroupCleanup("command did not start because runner cancellation was already requested"),
      };
    }

    const processGroupOwned = process.platform !== "win32";
    let child: ChildProcess;
    try {
      child = spawn(command[0], command.slice(1), {
        cwd: options.cwd,
        env: options.env,
        detached: processGroupOwned,
        stdio: options.output === "capture" ? ["ignore", "pipe", "pipe"] : "inherit",
      });
    } catch (error) {
      return {
        command,
        exitCode: null,
        signal: null,
        timedOut: false,
        cancelled: false,
        stdout: "",
        stderr: "",
        error: error instanceof Error ? error.message : String(error),
        processGroupOwned: false,
        groupCleanup: noOwnedGroupCleanup("command could not be spawned"),
      };
    }

    const active = new ActiveOwnedProcess(
      child,
      command,
      options.output,
      options.stream ?? true,
      this.graceMs,
      processGroupOwned,
      options.streamPrefix,
    );
    this.active.add(active);

    let timeout: NodeJS.Timeout | undefined;
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      timeout = setTimeout(() => active.requestTermination("SIGTERM", "timeout"), options.timeoutMs);
      timeout.unref();
    }

    const abort = () => active.requestTermination(signalFromAbort(options.abortSignal), "cancelled");
    options.abortSignal?.addEventListener("abort", abort, { once: true });
    if (this.stoppedBy !== undefined || options.abortSignal?.aborted) {
      active.requestTermination(this.stoppedBy ?? signalFromAbort(options.abortSignal), "cancelled");
    }

    try {
      return await active.closed;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      options.abortSignal?.removeEventListener("abort", abort);
      this.active.delete(active);
    }
  }

  /** First root signal: no future command starts, active groups get that signal then grace → KILL. */
  async stop(signal: NodeJS.Signals): Promise<void> {
    if (this.stoppedBy === undefined) this.stoppedBy = signal;
    for (const active of this.active) active.requestTermination(signal, "cancelled");
    await this.waitForIdle();
  }

  /** Second root signal: immediately KILL active owned groups, then still await close. */
  async forceKill(): Promise<void> {
    for (const active of this.active) active.forceKill();
    await this.waitForIdle();
  }

  async waitForIdle(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.all([...this.active].map((active) => active.closed));
    }
  }
}
