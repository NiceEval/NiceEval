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

/** `niceeval exp --json` 最后一行的公开原始事件。 */
export interface ExpResultEvent {
  event: "result";
  status: "passed" | "failed" | "incomplete" | "interrupted";
  passed: number;
  failed: number;
  errored: number;
  reused?: number;
  unstarted?: number;
  completion: "complete" | "incomplete" | "interrupted";
  snapshots: string[];
  junit?: string;
}

interface ExpStartEvent {
  format: "niceeval.exp";
  schemaVersion: number;
  event: "start";
  total: number;
  configs: number;
  concurrency: number;
  experimentConcurrency?: Readonly<Record<string, number>>;
  reused: number;
}

interface ExpProgressEvent {
  event: "progress";
  elapsedMs: number;
  total: number;
  reused: number;
  running: number;
  elsewhere: number;
  queued: number;
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
}

interface ExpFailureEvent {
  event: "failure";
  locator: string;
  evalId: string;
  experimentId: string;
  severity: "gate" | "soft";
  assertion: string;
  matcher?: string;
  expected?: unknown;
  received?: unknown;
}

interface ExpErrorEvent {
  event: "error";
  locator: string;
  evalId: string;
  experimentId: string;
  phase: string;
  reason: string;
}

export type ExpEvalEvent = {
  event: "eval";
  locator: string;
  evalId: string;
  experimentId: string;
  verdict: "passed" | "failed" | "errored" | "skipped";
  attempts: number;
} & (
  | { passed: number; planned?: never; unstarted?: never; reason?: never }
  | { passed?: never; planned: number; unstarted: number; reason: "early_exit" }
);

interface ExpKeptEvent {
  event: "kept";
  locator: string;
  evalId: string;
  attempt: number;
  verdict: "passed" | "failed" | "errored";
  provider: string;
  sandboxId: string;
  enter: string;
}

interface ExpWarningEvent {
  event: "warning";
  code: string;
  level: "warning" | "error";
  message: string;
  phase?: string;
  experimentId?: string;
  evalId?: string;
}

interface ExpBudgetExhaustedEvent {
  event: "budget_exhausted";
  experimentId: string;
  spent: number;
  unstarted: number;
}

interface ExpReporterErrorEvent {
  event: "reporter_error";
  reporter: string;
  required: boolean;
  message: string;
}

interface ExpInterruptedEvent {
  event: "interrupted";
}

interface ExpJudgePrecheckEvent {
  event: "judge_precheck";
  status: "started" | "done" | "failed";
  durationMs?: number;
}

interface ExpExperimentHookEvent {
  event: "experiment_setup" | "experiment_teardown";
  experimentId: string;
  status: "started" | "done" | "failed";
  durationMs?: number;
}

interface ExpLockWaitEvent {
  event: "lock_wait";
  experimentId: string;
  evalId: string;
  status: "started" | "resolved";
  holderPid?: number;
  holderHost?: string;
  resolution?: "carried" | "dispatched";
  waitedMs?: number;
}

/** `niceeval exp --json` 的公开原始事件联合；Testkit 不改变字段或判定。 */
export type ExpEvent =
  | ExpStartEvent
  | ExpProgressEvent
  | ExpFailureEvent
  | ExpErrorEvent
  | ExpEvalEvent
  | ExpKeptEvent
  | ExpWarningEvent
  | ExpBudgetExhaustedEvent
  | ExpReporterErrorEvent
  | ExpInterruptedEvent
  | ExpJudgePrecheckEvent
  | ExpExperimentHookEvent
  | ExpLockWaitEvent
  | ExpResultEvent;

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

  /** 严格读取 `niceeval exp --json`，原样返回末尾的公开 `result` 事件。 */
  expResult(): ExpResultEvent {
    const events = this.ndjson<unknown>();
    const first = events[0];
    if (
      !isRecord(first) ||
      first.event !== "start" ||
      first.format !== "niceeval.exp" ||
      !isNonNegativeInteger(first.schemaVersion)
    ) {
      throw new Error(
        `expResult(): stdout does not start with a niceeval.exp start event\n\n${this.diagnostic()}`,
      );
    }

    const result = events.at(-1);
    if (!isExpResultEvent(result)) {
      throw new Error(
        `expResult(): stdout does not end with a valid niceeval.exp result event\n\n${this.diagnostic()}`,
      );
    }
    return result;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isExpResultEvent(value: unknown): value is ExpResultEvent {
  if (!isRecord(value)) return false;
  if (value.event !== "result") return false;
  if (!(["passed", "failed", "incomplete", "interrupted"] as const).includes(value.status as never)) return false;
  if (!isNonNegativeInteger(value.passed)) return false;
  if (!isNonNegativeInteger(value.failed)) return false;
  if (!isNonNegativeInteger(value.errored)) return false;
  if (value.reused !== undefined && !isNonNegativeInteger(value.reused)) return false;
  if (value.unstarted !== undefined && !isNonNegativeInteger(value.unstarted)) return false;
  if (!(["complete", "incomplete", "interrupted"] as const).includes(value.completion as never)) return false;
  if (!Array.isArray(value.snapshots) || !value.snapshots.every((item) => typeof item === "string")) return false;
  if (value.junit !== undefined && typeof value.junit !== "string") return false;
  return true;
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
