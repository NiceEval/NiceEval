// runPty — run a product argv on a real Linux PTY and return its receipt.
//
// Transport: util-linux `script` (spawned detached in its own process group,
// with -q -f -e, typescript log sent to /dev/null). The product argv is
// rebuilt verbatim inside the session through POSIX shell quoting, so the
// product keeps its exact argv (nothing is retyped by a human). When
// `columns`/`rows` are requested, the session first runs `stty cols N rows M`
// against the real PTY (setting the actual kernel winsize — an env-only
// COLUMNS/LINES does not affect the PTY), guarded by `|| exit 201`, then
// `exec`s the product argv: if stty fails the product never runs.
// COLUMNS/LINES are also exported for applications that read them, but the
// winsize is authoritative.
//
// Preflight (before the product ever starts):
//   - `script --version` must succeed and identify util-linux script.
//   - When a window size is requested, `stty` must be executable on PATH.
//   Any of these failing throws PtyUnavailableError with an actionable message.
//
// Timeout: the transport runs in its own process group; on timeout runPty
// SIGTERMs the product's PTY session group (the transport's child) and the
// transport group, then SIGKILLs both after a grace period. The receipt then
// reports timedOut with a null exit code — never a fake clean pass.
//
// Boundaries:
//   - Linux only. Missing/unusable `script`/`stty` is an actionable
//     PtyUnavailableError, and the product is never executed.
//   - NO_COLOR is never set by runPty — the child decides its own color policy
//     and ANSI escape sequences are preserved byte-for-byte. An
//     `options.env` entry with value `undefined` genuinely removes that
//     variable from the child (no filtering, no parent-value backfill).
//   - The PTY line discipline converts the child's \n into \r\n; runPty
//     normalizes CRLF back to LF and otherwise leaves output untouched.
//   - PTY transport has a single output stream: the child's stdout and stderr
//     both arrive on the pty and are collected into the receipt's stdout.
//   - The exit code comes from `script -e` (the child's own exit status),
//     except on timeout where it is null.

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { accessSync, constants, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProcessReceipt, type Argv } from "./process.js";

export interface RunPtyOptions {
  /** Real PTY window width (kernel winsize), set via `stty cols` inside the session. */
  columns?: number;
  /** Real PTY window height (kernel winsize), set via `stty rows` inside the session. */
  rows?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const TERM_GRACE_MS = 2000;
const PROBE_TIMEOUT_MS = 5000;
/** Sentinel exit the session shell emits when `stty` fails — never a product exit. */
const STTY_FAILURE_EXIT = 201;

/** Missing/unusable util-linux `script` or coreutils `stty` — actionable, not a mystery. */
export class PtyUnavailableError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(reason);
    this.name = "PtyUnavailableError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function shellQuote(segment: string): string {
  return `'${segment.replace(/'/g, `'\\''`)}'`;
}

function assertWindowSize(value: number | undefined, label: "columns" | "rows"): void {
  if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
    throw new TypeError(
      `runPty: ${label} must be a positive integer, got ${JSON.stringify(value)}`,
    );
  }
}

function windowSizeSessionPrefix(
  columns: number | undefined,
  rows: number | undefined,
): string | undefined {
  const settings: string[] = [];
  if (columns !== undefined) settings.push(`cols ${columns}`);
  if (rows !== undefined) settings.push(`rows ${rows}`);
  return settings.length === 0
    ? undefined
    : `stty ${settings.join(" ")} || exit ${STTY_FAILURE_EXIT}; `;
}

function buildEnv(
  env: NodeJS.ProcessEnv | undefined,
  columns: number | undefined,
  rows: number | undefined,
): NodeJS.ProcessEnv {
  // `undefined` values from options.env must survive the merge: Node's spawn
  // removes undefined-valued env keys from the child, which is how callers
  // unset inherited variables like NO_COLOR. Never filter and re-backfill.
  const merged = env === undefined ? { ...process.env } : { ...process.env, ...env };
  if (columns !== undefined) merged.COLUMNS = String(columns);
  if (rows !== undefined) merged.LINES = String(rows);
  return merged;
}

function findExecutableInPath(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const path = env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  for (const dir of path.split(":")) {
    if (dir === "") continue;
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not in this PATH entry — keep looking
    }
  }
  return undefined;
}

type ProbeResult = { ok: true; output: string } | { ok: false; error: unknown };

async function probeVersion(command: string, cwd: string, env: NodeJS.ProcessEnv): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    const chunks: Buffer[] = [];
    const child = spawn(command, ["--version"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: ProbeResult): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.on("error", (error) => finish({ ok: false, error }));
    child.on("close", (code) => {
      const output = Buffer.concat(chunks).toString("utf8");
      if (code === 0) {
        finish({ ok: true, output });
        return;
      }
      finish({
        ok: false,
        error: new Error(`\`${command} --version\` exited with code ${code}: ${output.trim()}`),
      });
    });
    timer = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
        finish({ ok: false, error: new Error(`\`${command} --version\` did not answer within ${PROBE_TIMEOUT_MS}ms`) });
      }
    }, PROBE_TIMEOUT_MS);
    timer.unref();
  });
}

/**
 * PIDs of `parentPid`'s direct children (Linux /proc scan). The product runs
 * in its own PTY session whose leader is the transport's direct child, so
 * this is how runPty finds the product's session group to kill on timeout.
 */
function findChildPids(parentPid: number): number[] {
  const pids: number[] = [];
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch {
    return pids;
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(join("/proc", entry, "stat"), "utf8");
      const endOfComm = stat.lastIndexOf(")");
      const fields = stat.slice(endOfComm + 2).split(" ");
      if (Number(fields[1]) === parentPid) pids.push(Number(entry));
    } catch {
      // process vanished between readdir and read
    }
  }
  return pids;
}

function killGroupOrPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // group and process already gone
    }
  }
}

/** Terminate the product's PTY session group plus the detached transport group. */
function terminateTransportTree(child: ChildProcess, signal: NodeJS.Signals): void {
  const transportPid = child.pid;
  if (transportPid === undefined) return;
  for (const childPid of findChildPids(transportPid)) {
    killGroupOrPid(childPid, signal);
  }
  killGroupOrPid(transportPid, signal);
}

function isClosed(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function normalizePtyLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * Run `argv` on a real PTY and resolve a receipt with the collected output.
 *
 * @throws PtyUnavailableError when util-linux `script` or (for window sizes)
 *         coreutils `stty` is missing/unusable — the product never runs.
 * @throws TypeError when `columns`/`rows` are not positive integers.
 */
export async function runPty(
  argv: Argv,
  options: RunPtyOptions = {},
): Promise<ProcessReceipt> {
  assertWindowSize(options.columns, "columns");
  assertWindowSize(options.rows, "rows");

  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs;
  const env = buildEnv(options.env, options.columns, options.rows);
  const wantsWindowSize = options.columns !== undefined || options.rows !== undefined;

  // Transport preflight — fail actionably before the product ever starts.
  const scriptProbe = await probeVersion("script", cwd, env);
  if (!scriptProbe.ok) {
    throw new PtyUnavailableError(
      `runPty transport unavailable: could not run \`script --version\` (${reasonOf(scriptProbe.error)}) — runPty requires util-linux script (flags -q -f -e) on Linux. Install util-linux (e.g. apt-get install util-linux / dnf install util-linux) or run on a Linux host with script(1).`,
      scriptProbe.error,
    );
  }
  if (!scriptProbe.output.includes("util-linux")) {
    throw new PtyUnavailableError(
      `runPty transport unavailable: \`script\` resolved on PATH but is not util-linux script (version output: ${scriptProbe.output.trim()}) — runPty requires util-linux script semantics. Install util-linux or fix PATH.`,
    );
  }
  if (wantsWindowSize && findExecutableInPath("stty", env) === undefined) {
    throw new PtyUnavailableError(
      `runPty transport unavailable: \`stty\` not found on PATH but columns/rows were requested — runPty sets the real PTY winsize via stty. Install coreutils (e.g. apt-get install coreutils / dnf install coreutils) or drop columns/rows.`,
    );
  }

  const sessionCommand = `${windowSizeSessionPrefix(options.columns, options.rows) ?? ""}exec ${argv.map(shellQuote).join(" ")}`;
  const startedAt = Date.now();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const child = spawn("script", ["-q", "-f", "-e", "-c", sessionCommand, "/dev/null"], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  child.stdout?.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  return await new Promise<ProcessReceipt>((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let escalation: ReturnType<typeof setTimeout> | undefined;

    const clearTimers = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      if (escalation !== undefined) clearTimeout(escalation);
    };

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();

      if (!timedOut && exitCode === STTY_FAILURE_EXIT) {
        const sessionOutput = normalizePtyLineEndings(Buffer.concat(stdoutChunks).toString("utf8")).trim();
        reject(
          new PtyUnavailableError(
            `runPty transport unavailable: stty failed inside the PTY session (session exited ${STTY_FAILURE_EXIT})${sessionOutput.length > 0 ? ` — session output: ${sessionOutput}` : ""}. Fix the stty/coreutils installation or drop columns/rows.`,
          ),
        );
        return;
      }

      resolve(
        new ProcessReceipt({
          argv,
          cwd,
          exitCode: timedOut ? null : exitCode,
          signal,
          stdout: normalizePtyLineEndings(Buffer.concat(stdoutChunks).toString("utf8")),
          stderr: normalizePtyLineEndings(Buffer.concat(stderrChunks).toString("utf8")),
          durationMs: Date.now() - startedAt,
          timedOut,
        }),
      );
    };

    child.on("error", (cause) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimers();
      reject(
        new PtyUnavailableError(
          `runPty transport unavailable: could not start \`script\` (${reasonOf(cause)}) — runPty requires util-linux script on Linux. Install util-linux (e.g. apt-get install util-linux / dnf install util-linux) or run on a Linux host with script(1).`,
          cause,
        ),
      );
    });
    child.on("close", (code, signal) => {
      finish(code, signal);
    });

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        if (isClosed(child)) {
          return;
        }
        timedOut = true;
        terminateTransportTree(child, "SIGTERM");
        escalation = setTimeout(() => {
          if (!isClosed(child)) {
            terminateTransportTree(child, "SIGKILL");
          }
        }, TERM_GRACE_MS);
        escalation.unref();
      }, timeoutMs);
    }
  });
}
