import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { Result, Schema } from "effect";

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
const NonNegativeIntegerSchema = Schema.Number.pipe(
  Schema.check(Schema.makeFilter(
    (value) => Number.isInteger(value) && value >= 0,
  )),
);

export const InvocationReceiptSchema = Schema.Struct({
  invocationId: Schema.String,
  runIds: Schema.Array(Schema.String),
  startedAt: Schema.String,
  completedAt: Schema.optional(Schema.String),
  completion: Schema.Literals(["completed", "interrupted", "failed"]),
});

export type InvocationReceipt = Schema.Schema.Type<typeof InvocationReceiptSchema>;

/** The sole terminal envelope in a `niceeval exp --json` stream. */
export const ExpReceiptEventSchema = Schema.Struct({
  type: Schema.Literal("receipt"),
  receipt: InvocationReceiptSchema,
});

export type ExpReceiptEvent = Schema.Schema.Type<typeof ExpReceiptEventSchema>;

/** The stream identity line emitted first by `niceeval exp --json`. */
export const ExpStartEventSchema = Schema.Struct({
  format: Schema.Literal("niceeval.exp"),
  schemaVersion: NonNegativeIntegerSchema,
  event: Schema.Literal("start"),
  total: NonNegativeIntegerSchema,
  configs: NonNegativeIntegerSchema,
  concurrency: NonNegativeIntegerSchema,
  experimentConcurrency: Schema.optional(Schema.Record(Schema.String, NonNegativeIntegerSchema)),
  reused: NonNegativeIntegerSchema,
});

export type ExpStartEvent = Schema.Schema.Type<typeof ExpStartEventSchema>;

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

const ExpEvalBaseSchema = Schema.Struct({
  event: Schema.Literal("eval"),
  locator: Schema.String,
  evalId: Schema.String,
  experimentId: Schema.String,
  verdict: Schema.Literals(["passed", "failed", "errored", "skipped"]),
  attempts: NonNegativeIntegerSchema,
});

export const ExpEvalEventSchema = Schema.Union([
  ExpEvalBaseSchema.pipe(Schema.fieldsAssign({
    passed: NonNegativeIntegerSchema,
    planned: Schema.optional(Schema.Never),
    unstarted: Schema.optional(Schema.Never),
    reason: Schema.optional(Schema.Never),
  })),
  ExpEvalBaseSchema.pipe(Schema.fieldsAssign({
    passed: Schema.optional(Schema.Never),
    planned: NonNegativeIntegerSchema,
    unstarted: NonNegativeIntegerSchema,
    reason: Schema.Literal("early_exit"),
  })),
]);

export type ExpEvalEvent = Schema.Schema.Type<typeof ExpEvalEventSchema>;

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

function isExpStartEvent(value: unknown): value is ExpStartEvent {
  return Result.isSuccess(Schema.decodeUnknownResult(ExpStartEventSchema)(value));
}

function isExpEvalEvent(value: unknown): value is ExpEvalEvent {
  return Result.isSuccess(Schema.decodeUnknownResult(ExpEvalEventSchema, {
    errors: "all",
    onExcessProperty: "error",
  })(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReceiptEvent(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (value as { type?: unknown }).type === "receipt";
}

function isExpReceiptEvent(value: unknown): value is ExpReceiptEvent {
  return Result.isSuccess(Schema.decodeUnknownResult(ExpReceiptEventSchema)(value));
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
