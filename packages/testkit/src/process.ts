import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

export type Argv = readonly [string, ...string[]];

export interface RunProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface DiagnosticTruncation {
  stdout: boolean;
  stderr: boolean;
}

export const DIAGNOSTIC_LIMIT = 4096;

const TERM_GRACE_MS = 2000;

export class ProcessStartError extends Error {
  readonly argv: Argv;
  readonly cwd: string;
  override readonly cause: unknown;

  constructor(argv: Argv, cwd: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Failed to start process ${JSON.stringify([...argv])} in ${cwd}: ${reason}`,
      { cause },
    );
    this.name = "ProcessStartError";
    this.argv = argv;
    this.cwd = cwd;
    this.cause = cause;
  }
}

export class ProcessReceipt {
  readonly argv: Argv;
  readonly cwd: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly diagnosticTruncation: DiagnosticTruncation;

  constructor(fields: {
    argv: Argv;
    cwd: string;
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  }) {
    this.argv = fields.argv;
    this.cwd = fields.cwd;
    this.exitCode = fields.exitCode;
    this.signal = fields.signal;
    this.stdout = fields.stdout;
    this.stderr = fields.stderr;
    this.durationMs = fields.durationMs;
    this.timedOut = fields.timedOut;
    this.diagnosticTruncation = {
      stdout: fields.stdout.length > DIAGNOSTIC_LIMIT,
      stderr: fields.stderr.length > DIAGNOSTIC_LIMIT,
    };
  }

  diagnostic(): string {
    const lines = [
      `$ ${this.argv.join(" ")}  (cwd: ${this.cwd})`,
      `exit: ${this.exitCode}  signal: ${this.signal}  timedOut: ${this.timedOut}  duration: ${this.durationMs}ms`,
      "--- stdout ---",
      truncateForDisplay(this.stdout, "stdout"),
      "--- stderr ---",
      truncateForDisplay(this.stderr, "stderr"),
    ];
    return lines.join("\n");
  }

  json<T = unknown>(): T {
    const text = this.stdout;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new Error(
        `json(): stdout is not a single complete JSON document (line ${lineOfFirstContent(text)}): ${reasonOf(cause)}\n\n${this.diagnostic()}`,
        { cause },
      );
    }
  }

  ndjson<T = unknown>(): T[] {
    const text = this.stdout;
    if (text.length === 0) {
      throw new Error(`ndjson(): stdout is empty\n\n${this.diagnostic()}`);
    }
    if (!text.endsWith("\n")) {
      throw new Error(`ndjson(): stdout must end with a trailing newline\n\n${this.diagnostic()}`);
    }
    const lines = text.split("\n");
    lines.pop();
    const out: T[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      const lineNo = i + 1;
      if (line.length === 0) {
        throw new Error(
          `ndjson(): blank line at line ${lineNo}; whitespace noise is not accepted\n\n${this.diagnostic()}`,
        );
      }
      try {
        out.push(JSON.parse(line) as T);
      } catch (cause) {
        throw new Error(
          `ndjson(): malformed JSON at line ${lineNo}: ${reasonOf(cause)}\n\n${this.diagnostic()}`,
          { cause },
        );
      }
    }
    return out;
  }
}

function truncateForDisplay(text: string, stream: "stdout" | "stderr"): string {
  if (text.length <= DIAGNOSTIC_LIMIT) {
    return text;
  }
  const omitted = text.length - DIAGNOSTIC_LIMIT;
  return `${text.slice(0, DIAGNOSTIC_LIMIT)}\n… <${stream} truncated: ${omitted} bytes omitted>`;
}

function lineOfFirstContent(text: string): number {
  const match = /^\n*/.exec(text);
  return (match?.[0].length ?? 0) + 1;
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function mergedEnv(env?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return env === undefined ? process.env : { ...process.env, ...env };
}

function isClosed(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function killWithEscalation(child: ChildProcess, graceMs: number): void {
  if (isClosed(child)) {
    return;
  }
  child.kill("SIGTERM");
  const escalation = setTimeout(() => {
    if (!isClosed(child)) {
      child.kill("SIGKILL");
    }
  }, graceMs);
  escalation.unref();
}

export async function runProcess(
  argv: Argv,
  options: RunProcessOptions = {},
): Promise<ProcessReceipt> {
  const cwd = options.cwd ?? process.cwd();
  const timeoutMs = options.timeoutMs;
  const startedAt = Date.now();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  const child = spawn(argv[0], argv.slice(1), {
    cwd,
    env: mergedEnv(options.env),
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

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolve(
        new ProcessReceipt({
          argv,
          cwd,
          exitCode,
          signal,
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
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
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      reject(new ProcessStartError(argv, cwd, cause));
    });
    child.on("close", (code, signal) => {
      finish(code, signal);
    });

    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        killWithEscalation(child, TERM_GRACE_MS);
      }, timeoutMs);
    }
  });
}

export function command(prefix: Argv) {
  return {
    run(
      args: readonly string[],
      options?: RunProcessOptions,
    ): Promise<ProcessReceipt> {
      const argv = [...prefix, ...args] as Argv;
      return runProcess(argv, options);
    },
  };
}
