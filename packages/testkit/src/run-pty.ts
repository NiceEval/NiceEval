// runPty — run a product argv on a real Linux PTY and return its receipt.
//
// Transport: util-linux `script` (spawned with -q -f -e, typescript log sent
// to /dev/null). The product argv is rebuilt verbatim inside the session
// through POSIX shell quoting, so the product keeps its exact argv (nothing
// is retyped by a human). When `columns`/`rows` are requested, the session
// first runs `stty cols N rows M` against the real PTY (setting the actual
// kernel winsize — an env-only COLUMNS/LINES does not affect the PTY), then
// `exec`s the product argv. COLUMNS/LINES are also exported for applications
// that read them, but the winsize is authoritative.
//
// Boundaries:
//   - Linux only. Missing `script`/`stty` is an actionable PtyUnavailableError.
//   - NO_COLOR is never set by runPty — the child decides its own color policy
//     and ANSI escape sequences are preserved byte-for-byte.
//   - The PTY line discipline converts the child's \n into \r\n; runPty
//     normalizes CRLF back to LF and otherwise leaves output untouched.
//   - PTY transport has a single output stream: the child's stdout and stderr
//     both arrive on the pty and are collected into the receipt's stdout.
//   - The exit code comes from `script -e` (the child's own exit status).

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
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

/** util-linux `script`/coreutils `stty` missing or unusable — actionable, not a mystery. */
export class PtyUnavailableError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      [
        `runPty requires util-linux \`script\` (flags -q -f -e) and coreutils \`stty\` on Linux`,
        `— could not start \`script\`: ${detail}.`,
        `Install util-linux (e.g. apt-get install -y util-linux coreutils, dnf install util-linux coreutils)`,
        `or run the test on a Linux host where script(1) is available.`,
      ].join(" "),
      { cause },
    );
    this.name = "PtyUnavailableError";
  }
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

function sttyCommand(columns: number | undefined, rows: number | undefined): string | undefined {
  const settings: string[] = [];
  if (columns !== undefined) settings.push(`cols ${columns}`);
  if (rows !== undefined) settings.push(`rows ${rows}`);
  return settings.length === 0 ? undefined : `stty ${settings.join(" ")}; `;
}

function buildEnv(
  env: NodeJS.ProcessEnv | undefined,
  columns: number | undefined,
  rows: number | undefined,
): NodeJS.ProcessEnv {
  const merged = env === undefined ? { ...process.env } : { ...process.env, ...env };
  if (columns !== undefined) merged.COLUMNS = String(columns);
  if (rows !== undefined) merged.LINES = String(rows);
  return merged;
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
 * @throws PtyUnavailableError when util-linux `script` cannot be started.
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
  const startedAt = Date.now();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  // `script` runs the command through a POSIX shell; every argv element is
  // single-quote-escaped so the shell reconstructs the exact original argv.
  const sessionCommand = `${sttyCommand(options.columns, options.rows) ?? ""}exec ${argv.map(shellQuote).join(" ")}`;
  const child = spawn("script", ["-q", "-f", "-e", "-c", sessionCommand, "/dev/null"], {
    cwd,
    env: buildEnv(options.env, options.columns, options.rows),
    stdio: ["ignore", "pipe", "pipe"],
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

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      if (escalation !== undefined) {
        clearTimeout(escalation);
      }
      resolve(
        new ProcessReceipt({
          argv,
          cwd,
          exitCode,
          signal,
          stdout: normalizePtyLineEndings(Buffer.concat(stdoutChunks).toString("utf8")),
          stderr: normalizePtyLineEndings(Buffer.concat(stderrChunks).toString("utf8")),
          durationMs: Date.now() - startedAt,
          timedOut,
          transport: "pty",
        }),
      );
    };

    child.on("error", (cause) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reject(new PtyUnavailableError(cause));
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
        child.kill("SIGTERM");
        escalation = setTimeout(() => {
          if (!isClosed(child)) {
            child.kill("SIGKILL");
          }
        }, TERM_GRACE_MS);
        escalation.unref();
      }, timeoutMs);
    }
  });
}
