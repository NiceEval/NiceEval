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

/** The invocation-level hand-off emitted by `niceeval exp --json`. */
export interface InvocationReceipt {
  readonly invocationId: string;
  readonly runIds: readonly string[];
  readonly startedAt: string;
  readonly completedAt?: string;
  readonly completion: "completed" | "interrupted" | "failed";
}

/** The sole terminal envelope in a `niceeval exp --json` stream. */
export interface ExpReceiptEvent {
  readonly type: "receipt";
  readonly receipt: InvocationReceipt;
}

/** The stream identity line emitted first by `niceeval exp --json`. */
export interface ExpStartEvent {
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
  planned?: number;
  errored?: number;
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
  | ExpReceiptEvent;

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

  /**
   * Strictly read `niceeval exp --json` and return its only terminal
   * InvocationReceipt. It does not infer any Eval outcome from the stream.
   */
  expReceipt(): InvocationReceipt {
    const events = this.ndjson<unknown>();
    const first = events[0];
    if (!isExpStartEvent(first)) {
      throw new Error(
        `expReceipt(): stdout does not start with a valid niceeval.exp start event\n\n${this.diagnostic()}`,
      );
    }

    const receiptIndexes = events.flatMap((event, index) =>
      isReceiptEvent(event) ? [index] : [],
    );
    if (
      receiptIndexes.length !== 1 ||
      receiptIndexes[0] !== events.length - 1
    ) {
      throw new Error(
        `expReceipt(): stdout must contain exactly one receipt event as its final line\n\n${this.diagnostic()}`,
      );
    }

    const terminal = events.at(-1);
    if (!isExpReceiptEvent(terminal)) {
      throw new Error(
        `expReceipt(): stdout does not end with a valid InvocationReceipt\n\n${this.diagnostic()}`,
      );
    }
    return terminal.receipt;
  }

  /** Strictly decode the public Eval conclusion events from `niceeval exp --json`. */
  expEvalEvents(): ExpEvalEvent[] {
    const events = this.ndjson<unknown>();
    const evalEvents: ExpEvalEvent[] = [];
    for (const event of events) {
      if (!isRecord(event) || event.event !== "eval") continue;
      if (!isExpEvalEvent(event)) {
        throw new Error(
          `expEvalEvents(): stdout contains an invalid Eval event\n\n${this.diagnostic()}`,
        );
      }
      evalEvents.push(event);
    }
    return evalEvents;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isNonNegativeIntegerRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isNonNegativeInteger);
}

function isExpStartEvent(value: unknown): value is ExpStartEvent {
  if (!isRecord(value)) return false;
  if (value.format !== "niceeval.exp" || value.event !== "start") return false;
  if (!isNonNegativeInteger(value.schemaVersion)) return false;
  if (!isNonNegativeInteger(value.total)) return false;
  if (!isNonNegativeInteger(value.configs)) return false;
  if (!isNonNegativeInteger(value.concurrency)) return false;
  if (!isNonNegativeInteger(value.reused)) return false;
  if (
    value.experimentConcurrency !== undefined &&
    !isNonNegativeIntegerRecord(value.experimentConcurrency)
  ) return false;
  return true;
}

function isExpEvalEvent(value: unknown): value is ExpEvalEvent {
  if (!isRecord(value) || value.event !== "eval") return false;
  if (typeof value.locator !== "string") return false;
  if (typeof value.evalId !== "string" || typeof value.experimentId !== "string") return false;
  if (!isNonNegativeInteger(value.attempts)) return false;
  if (
    value.verdict !== "passed" &&
    value.verdict !== "failed" &&
    value.verdict !== "errored" &&
    value.verdict !== "skipped"
  ) return false;
  if (value.reason === "early_exit") {
    return isNonNegativeInteger(value.planned) && isNonNegativeInteger(value.unstarted);
  }
  return isNonNegativeInteger(value.passed);
}

function isReceiptEvent(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.type === "receipt";
}

function isExpReceiptEvent(value: unknown): value is ExpReceiptEvent {
  return isReceiptEvent(value) && isInvocationReceipt(value.receipt);
}

function isInvocationReceipt(value: unknown): value is InvocationReceipt {
  if (!isRecord(value)) return false;
  if (typeof value.invocationId !== "string") return false;
  if (!Array.isArray(value.runIds) || !value.runIds.every((runId) => typeof runId === "string")) return false;
  if (typeof value.startedAt !== "string") return false;
  if (value.completedAt !== undefined && typeof value.completedAt !== "string") return false;
  return (
    value.completion === "completed" ||
    value.completion === "interrupted" ||
    value.completion === "failed"
  );
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
