import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readdirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import type { Argv } from "./process.js";

const DEFAULT_COLUMNS = 120;
const DEFAULT_ROWS = 40;
const DEFAULT_GRACE_MS = 2_000;
const POLL_MS = 20;
const MAX_ARGV_ITEMS = 256;
const MAX_ARGV_BYTES = 64 * 1024;

export interface PtyOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly columns?: number;
  readonly rows?: number;
  readonly timeoutMs?: number;
  readonly graceMs?: number;
}

export interface PtyCleanupState {
  readonly candidateGroup: "gone" | "terminal";
  readonly helperGroup: "gone" | "terminal";
  readonly launcherGroup: "gone" | "terminal";
}

interface PtyReceiptFields {
  readonly argv: Argv;
  readonly cwd: string;
  readonly columns: number;
  readonly rows: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly raw: string;
  readonly clean: string;
  readonly launcherStderr: string;
  readonly cleanup: PtyCleanupState;
}

export class PtyReceipt {
  readonly argv: Argv;
  readonly cwd: string;
  readonly columns: number;
  readonly rows: number;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** Exact UTF-8 terminal bytes, including ANSI sequences and carriage returns. */
  readonly raw: string;
  /** Full terminal transcript after VT removal and CRLF/CR normalization. */
  readonly clean: string;
  readonly launcherStderr: string;
  readonly cleanup: PtyCleanupState;

  constructor(fields: PtyReceiptFields) {
    this.argv = fields.argv;
    this.cwd = fields.cwd;
    this.columns = fields.columns;
    this.rows = fields.rows;
    this.exitCode = fields.exitCode;
    this.signal = fields.signal;
    this.timedOut = fields.timedOut;
    this.durationMs = fields.durationMs;
    this.raw = fields.raw;
    this.clean = fields.clean;
    this.launcherStderr = fields.launcherStderr;
    this.cleanup = fields.cleanup;
  }

  diagnostic(): string {
    return [
      `$ ${this.argv.join(" ")}  (cwd: ${this.cwd}; terminal: ${this.columns}x${this.rows})`,
      `exit: ${this.exitCode}  signal: ${this.signal}  timedOut: ${this.timedOut}  duration: ${this.durationMs}ms`,
      `cleanup: candidate=${this.cleanup.candidateGroup} helper=${this.cleanup.helperGroup} launcher=${this.cleanup.launcherGroup}`,
      "--- terminal ---",
      this.clean,
      "--- launcher stderr ---",
      this.launcherStderr,
    ].join("\n");
  }
}

export interface WaitForPtyTextOptions {
  readonly timeoutMs: number;
  /** Refuse a match that is first observed after the candidate has exited. */
  readonly whileRunning?: boolean;
  readonly label?: string;
}

export interface PtyHandle extends AsyncDisposable {
  readonly done: Promise<PtyReceipt>;
  waitForText(pattern: string | RegExp, options: WaitForPtyTextOptions): Promise<string>;
  wait(): Promise<PtyReceipt>;
  dispose(): Promise<void>;
}

interface ControlState {
  helperPid?: number;
  helperGroupId?: number;
  helperSessionId?: number;
  candidatePid?: number;
  candidateGroupId?: number;
  candidateExit?: { readonly exitCode: number | null; readonly signal: NodeJS.Signals | null };
}

type GroupTerminal = "gone" | "terminal" | "running";

function positive(value: number | undefined, fallback: number, label: string): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result <= 0) throw new Error(`${label} must be a positive integer`);
  return result;
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { readonly code?: unknown }).code)
    : undefined;
}

function processGroupState(groupId: number): GroupTerminal {
  if (process.platform !== "linux") throw new Error("PTY cleanup requires Linux /proc process identity");
  let entries: Dirent<string>[];
  try {
    entries = readdirSync("/proc", { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot inspect /proc for process group ${groupId}`, { cause: error });
  }
  let terminal = false;
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
    let stat: string;
    try {
      stat = readFileSync(`/proc/${entry.name}/stat`, "utf8");
    } catch (error) {
      const code = errorCode(error);
      if (code === "ENOENT" || code === "ESRCH") continue;
      throw new Error(`cannot inspect /proc/${entry.name}/stat`, { cause: error });
    }
    const end = stat.lastIndexOf(")");
    const fields = end < 0 ? [] : stat.slice(end + 2).trim().split(/\s+/);
    const state = fields[0];
    const memberGroup = Number(fields[2]);
    if (!Number.isSafeInteger(memberGroup) || state === undefined) {
      throw new Error(`cannot decode /proc/${entry.name}/stat`);
    }
    if (memberGroup !== groupId) continue;
    if (state !== "Z" && state !== "X" && state !== "x") return "running";
    terminal = true;
  }
  return terminal ? "terminal" : "gone";
}

function signalGroup(groupId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-groupId, signal);
  } catch (error) {
    if (errorCode(error) !== "ESRCH") throw error;
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function terminateGroup(groupId: number, graceMs: number): Promise<"gone" | "terminal"> {
  let state = processGroupState(groupId);
  if (state !== "running") return state;
  signalGroup(groupId, "SIGTERM");
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    state = processGroupState(groupId);
    if (state !== "running") return state;
    await delay(POLL_MS);
  }
  signalGroup(groupId, "SIGKILL");
  const killDeadline = Date.now() + graceMs;
  while (Date.now() < killDeadline) {
    state = processGroupState(groupId);
    if (state !== "running") return state;
    await delay(POLL_MS);
  }
  throw new Error(`process group ${groupId} remained live after SIGTERM and SIGKILL`);
}

function cleanTerminalTranscript(raw: string): string {
  // OSC, CSI, and two-byte ESC controls are deliberately removed without
  // interpreting cursor movement: this is a transcript, not a screen emulator.
  return raw
    .replace(/\u001B\][\s\S]*?(?:\u0007|\u001B\\)/g, "")
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\u001B[()#][0-9A-Za-z]/g, "")
    .replace(/\u001B[=>78]/g, "")
    .replace(/\r+\n/g, "\n")
    .replace(/\r/g, "\n");
}

function shellQuoteInternal(value: string): string {
  if (value.includes("\0")) throw new Error("PTY internal launcher coordinate contains NUL");
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function validateArgv(argv: Argv): void {
  if (argv.length > MAX_ARGV_ITEMS) throw new Error(`PTY argv exceeds ${MAX_ARGV_ITEMS} items`);
  let bytes = 0;
  for (const value of argv) {
    if (value.includes("\0")) throw new Error("PTY argv must not contain NUL");
    bytes += Buffer.byteLength(value, "utf8");
  }
  if (bytes > MAX_ARGV_BYTES) throw new Error(`PTY argv exceeds ${MAX_ARGV_BYTES} UTF-8 bytes`);
}

function procIdentity(pid: number): { readonly processGroupId: number; readonly sessionId: number } {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const end = stat.lastIndexOf(")");
  const fields = end < 0 ? [] : stat.slice(end + 2).trim().split(/\s+/);
  const processGroupId = Number(fields[2]);
  const sessionId = Number(fields[3]);
  if (!Number.isSafeInteger(processGroupId) || !Number.isSafeInteger(sessionId)) {
    throw new Error(`cannot decode process identity for ${pid}`);
  }
  return { processGroupId, sessionId };
}

function helperPath(): string {
  // Resolve the installed package, not this checkout. This is valid for both
  // ESM and CJS consumers and keeps the helper adjacent to the matching entry.
  const resolver = createRequire(join(process.cwd(), "niceeval-testkit-resolver.cjs"));
  const entry = resolver.resolve("@niceeval/testkit");
  return join(entry, "..", "pty-helper.js");
}

function asPattern(pattern: string | RegExp): (text: string) => boolean {
  if (typeof pattern === "string") return (text) => text.includes(pattern);
  return (text) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  };
}

export async function startPty(argv: Argv, options: PtyOptions = {}): Promise<PtyHandle> {
  if (process.platform !== "linux") throw new Error("startPty requires Linux");
  validateArgv(argv);
  const columns = positive(options.columns, DEFAULT_COLUMNS, "columns");
  const rows = positive(options.rows, DEFAULT_ROWS, "rows");
  const cwd = options.cwd ?? process.cwd();
  const graceMs = positive(options.graceMs, DEFAULT_GRACE_MS, "graceMs");
  const scratch = await mkdtemp(join(tmpdir(), "niceeval-pty-"));
  const socketPath = join(scratch, "control.sock");
  const control: ControlState = {};
  const rawChunks: Buffer[] = [];
  const launcherStderr: Buffer[] = [];
  let timedOut = false;
  let receiptSealed = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let disposePromise: Promise<void> | undefined;
  let resolveConfigured: (() => void) | undefined;
  let rejectConfigured: ((error: Error) => void) | undefined;
  let helperConfigured = false;
  let controlConnectionAccepted = false;
  const configured = new Promise<void>((resolve, reject) => {
    resolveConfigured = resolve;
    rejectConfigured = reject;
  });

  const server = createServer((socket) => {
    if (controlConnectionAccepted) {
      socket.destroy(new Error("PTY control accepts one helper connection"));
      rejectConfigured?.(new Error("PTY control received more than one helper connection"));
      return;
    }
    controlConnectionAccepted = true;
    let pending = "";
    socket.setEncoding("utf8");
    socket.on("error", (error) => {
      if (control.candidateGroupId === undefined) {
        rejectConfigured?.(new Error(`PTY control failed before reporting the candidate: ${error.message}`, { cause: error }));
      }
    });
    socket.on("close", () => {
      if (control.candidateGroupId === undefined) {
        rejectConfigured?.(new Error("PTY control closed before reporting the candidate"));
      }
    });
    socket.on("data", (chunk: string) => {
      pending += chunk;
      for (;;) {
        const newline = pending.indexOf("\n");
        if (newline < 0) return;
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        try {
          const message = JSON.parse(line) as Record<string, unknown>;
          if (message.type !== "status" || typeof message.phase !== "string") {
            throw new Error("PTY control expected a status frame");
          }
          switch (message.phase) {
            case "configured":
              control.helperPid = Number(message.helperPid);
              control.helperGroupId = Number(message.helperGroupId);
              control.helperSessionId = Number(message.helperSessionId);
              if (!Number.isSafeInteger(control.helperPid) || !Number.isSafeInteger(control.helperGroupId) || !Number.isSafeInteger(control.helperSessionId)) {
                throw new Error("PTY helper configured frame has invalid process identity");
              }
              const helper = procIdentity(control.helperPid);
              if (helper.processGroupId !== control.helperGroupId || helper.sessionId !== control.helperSessionId) {
                throw new Error("PTY helper configured frame did not match /proc identity");
              }
              if (Number(message.columns) !== columns || Number(message.rows) !== rows) {
                throw new Error("PTY helper configured frame did not preserve terminal dimensions");
              }
              helperConfigured = true;
              socket.write(`${JSON.stringify({ type: "init", argv })}\n`);
              break;
            case "candidate":
              control.candidatePid = Number(message.pid);
              control.candidateGroupId = Number(message.processGroupId);
              if (!helperConfigured || control.candidatePid !== control.candidateGroupId) {
                throw new Error("PTY helper reported a candidate before a valid configured state");
              }
              if (procIdentity(control.candidatePid).processGroupId !== control.candidateGroupId) {
                throw new Error("PTY helper candidate frame did not match /proc process group");
              }
              resolveConfigured?.();
              break;
            case "exit":
              control.candidateExit = {
                exitCode: typeof message.exitCode === "number" ? message.exitCode : null,
                signal: typeof message.signal === "string" ? message.signal as NodeJS.Signals : null,
              };
              break;
            case "error":
              rejectConfigured?.(new Error(`pty helper: ${String(message.message)}`));
              break;
            default:
              throw new Error(`unknown PTY helper control message ${String(message.type)}`);
          }
        } catch (error) {
          rejectConfigured?.(error instanceof Error ? error : new Error(String(error)));
        }
      }
    });
  });
  let controlCleanup: Promise<void> | undefined;
  const closeControlAndScratch = (): Promise<void> => {
    if (controlCleanup !== undefined) return controlCleanup;
    controlCleanup = (async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error === undefined ? resolve() : reject(error));
      }).catch((error: unknown) => {
        // A listener can have been closed by a concurrent launcher failure;
        // it is already safe to remove its private directory in that case.
        if (errorCode(error) !== "ERR_SERVER_NOT_RUNNING") throw error;
      });
      await rm(scratch, { recursive: true, force: true });
    })();
    return controlCleanup;
  };
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    await chmod(socketPath, 0o600);
  } catch (error) {
    await closeControlAndScratch();
    throw new Error("failed to prepare PTY control channel", { cause: error });
  }

  const startedAt = Date.now();
  const launcher = await (async () => {
    try {
      // Helper resolution and the only shell command construction are part of
      // the pre-handle boundary too: either failure must close the listener
      // before its private directory is removed.
      const launcherCommand = [process.execPath, helperPath(), socketPath, String(columns), String(rows)]
        .map(shellQuoteInternal)
        .join(" ");
      return spawn("script", ["-q", "-e", "-f", "-O", "/dev/null", "--command", launcherCommand], {
        cwd,
        env: options.env === undefined ? process.env : { ...process.env, ...options.env },
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      await closeControlAndScratch();
      throw new Error("failed to start PTY launcher", { cause: error });
    }
  })();
  let launcherFailure: Error | undefined;
  let reportLauncherFailure: ((failure: Error) => void) | undefined;
  // spawn(2) lookup failures are reported asynchronously, including when no
  // PID was assigned. Register before inspecting pid so that branch cannot
  // leave an EventEmitter error unhandled or its control socket listening.
  launcher.once("error", (error) => {
    const failure = new Error(`failed to start PTY launcher: ${error.message}`, { cause: error });
    launcherFailure = failure;
    void closeControlAndScratch().finally(() => reportLauncherFailure?.(failure));
  });
  const launcherPid = launcher.pid;
  if (launcherPid === undefined) {
    await closeControlAndScratch();
    throw launcherFailure ?? new Error("PTY launcher did not expose a PID; cleanup could not prove launcher ownership");
  }
  launcher.stdout.on("data", (chunk: Buffer) => rawChunks.push(chunk));
  launcher.stderr.on("data", (chunk: Buffer) => launcherStderr.push(chunk));

  let resolveDone: (receipt: PtyReceipt) => void;
  let rejectDone: (error: Error) => void;
  const done = new Promise<PtyReceipt>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  // startPty can fail before a caller receives the handle. Keep that early
  // rejection observable through `done` without letting Node report it as an
  // unhandled rejection during the asynchronous start handshake.
  void done.catch(() => {});

  const cleanupGroups = async (): Promise<PtyCleanupState> => {
    const candidate = control.candidateGroupId === undefined
      ? "gone"
      : await terminateGroup(control.candidateGroupId, graceMs);
    const helper = control.helperGroupId === undefined
      ? "gone"
      : await terminateGroup(control.helperGroupId, graceMs);
    const launcherState = await terminateGroup(launcherPid, graceMs);
    return { candidateGroup: candidate, helperGroup: helper, launcherGroup: launcherState };
  };

  reportLauncherFailure = (failure) => {
    rejectConfigured?.(failure);
    rejectDone(failure);
  };
  if (launcherFailure !== undefined) reportLauncherFailure(launcherFailure);
  launcher.once("close", () => {
    if (control.candidateGroupId === undefined) {
      rejectConfigured?.(new Error("PTY launcher exited before reporting the candidate"));
    }
    void (async () => {
      if (timeout !== undefined) clearTimeout(timeout);
      try {
        const cleanup = await cleanupGroups();
        const raw = Buffer.concat(rawChunks).toString("utf8");
        if (control.candidateExit === undefined) {
          throw new Error("PTY helper exited without reporting the candidate terminal state");
        }
        const receipt = new PtyReceipt({
          argv,
          cwd,
          columns,
          rows,
          exitCode: control.candidateExit.exitCode,
          signal: control.candidateExit.signal,
          timedOut,
          durationMs: Date.now() - startedAt,
          raw,
          clean: cleanTerminalTranscript(raw),
          launcherStderr: Buffer.concat(launcherStderr).toString("utf8"),
          cleanup,
        });
        await closeControlAndScratch();
        receiptSealed = true;
        resolveDone(receipt);
      } catch (error) {
        rejectDone(error instanceof Error ? error : new Error(String(error)));
      } finally {
        // If receipt construction failed, do not leave a private control
        // socket or its directory behind while surfacing that failure.
        await closeControlAndScratch().catch(() => {});
      }
    })();
  });

  const dispose = async (): Promise<void> => {
    if (disposePromise !== undefined) return await disposePromise;
    disposePromise = (async () => {
      let cleanupError: unknown;
      try {
        // A configured helper can be waiting for init even when no candidate
        // exists. Always cover the known groups in dependency order, rather
        // than waiting for helper/launcher shutdown to happen by accident.
        await cleanupGroups();
      } catch (error) {
        cleanupError = error;
      }
      try {
        await done;
      } catch (error) {
        if (cleanupError !== undefined) {
          throw new AggregateError([cleanupError, error], "PTY cleanup and receipt finalization failed", { cause: cleanupError });
        }
        throw error;
      }
      if (cleanupError !== undefined) throw cleanupError;
    })();
    return await disposePromise;
  };

  if (options.timeoutMs !== undefined) {
    timeout = setTimeout(() => {
      timedOut = true;
      void dispose().catch(() => {});
    }, options.timeoutMs);
  }

  try {
    await configured;
  } catch (error) {
    await dispose().catch(() => {});
    throw error;
  }

  return {
    done,
    wait: async () => await done,
    dispose,
    [Symbol.asyncDispose]: dispose,
    waitForText: async (pattern, waitOptions) => {
      const matches = asPattern(pattern);
      const label = waitOptions.label ?? String(pattern);
      const deadline = Date.now() + positive(waitOptions.timeoutMs, waitOptions.timeoutMs, "timeoutMs");
      try {
        for (;;) {
          const raw = Buffer.concat(rawChunks).toString("utf8");
          const clean = cleanTerminalTranscript(raw);
          if (matches(clean)) {
            // This is the linearization point for whileRunning: both the
            // candidate terminal report and receipt sealing are checked after
            // the matching buffer snapshot and before returning success.
            if (waitOptions.whileRunning === true) {
              const group = control.candidateGroupId;
              // The /proc observation is the linearization point. The helper
              // exit frame is useful evidence but may race behind a candidate
              // that has already left its process group.
              if (group === undefined || control.candidateExit !== undefined || receiptSealed || processGroupState(group) !== "running") {
                throw new Error(`PTY candidate exited before ${label} was observed while running`);
              }
            }
            return clean;
          }
          if (control.candidateExit !== undefined || receiptSealed) {
            const receipt = await done;
            throw new Error(`PTY candidate exited before ${label}\n${receipt.diagnostic()}`);
          }
          if (Date.now() >= deadline) throw new Error(`Timed out after ${waitOptions.timeoutMs}ms waiting for ${label}`);
          await delay(POLL_MS);
        }
      } catch (error) {
        await dispose().catch(() => {});
        throw error;
      }
    },
  };
}

export async function withPty<T>(
  argv: Argv,
  options: PtyOptions,
  body: (pty: PtyHandle) => Promise<T>,
): Promise<T> {
  const pty = await startPty(argv, options);
  try {
    return await body(pty);
  } finally {
    await pty.dispose();
  }
}
