import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { Result, Schema } from "effect";
import {
  decodeInspectionDocument,
  narrowInspectionExplanation,
  narrowInspectionSuccess,
  type QueryDiscoveryDocument,
  type QueryDocument,
  type QueryExplanationDocumentFor,
  type QueryFailureDocument,
  type QueryOperationId,
  type QuerySuccessDocumentFor,
} from "./query-protocol.js";

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
  createdRunIds: Schema.Array(Schema.String),
  publicationCutoff: Schema.String,
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

const ExpProgressEventSchema = Schema.Struct({
  event: Schema.Literal("progress"), elapsedMs: NonNegativeIntegerSchema,
  total: NonNegativeIntegerSchema, reused: NonNegativeIntegerSchema,
  running: NonNegativeIntegerSchema, elsewhere: NonNegativeIntegerSchema,
  queued: NonNegativeIntegerSchema, passed: NonNegativeIntegerSchema,
  failed: NonNegativeIntegerSchema, errored: NonNegativeIntegerSchema,
  skipped: NonNegativeIntegerSchema,
});

const ExpFailureEventSchema = Schema.Struct({
  event: Schema.Literal("failure"), locator: Schema.String, evalId: Schema.String,
  experimentId: Schema.String, verdict: Schema.Literals(["failed", "errored"]),
  fact: Schema.String, matcher: Schema.optional(Schema.String),
  expected: Schema.optional(Schema.Unknown), received: Schema.optional(Schema.Unknown),
});

export const ExpErrorEventSchema = Schema.Struct({
  event: Schema.Literal("error"), locator: Schema.String, evalId: Schema.String,
  experimentId: Schema.String, phase: Schema.String, reason: Schema.String,
});
export type ExpErrorEvent = Schema.Schema.Type<typeof ExpErrorEventSchema>;

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

const ExpKeptEventSchema = Schema.Struct({ event: Schema.Literal("kept"), locator: Schema.String, evalId: Schema.String, attempt: NonNegativeIntegerSchema, verdict: Schema.Literals(["passed", "failed", "errored"]), provider: Schema.String, sandboxId: Schema.String, enter: Schema.String });
const ExpNoticeEventSchema = Schema.Struct({ event: Schema.Literal("notice"), code: Schema.String, level: Schema.Literal("info"), message: Schema.String, phase: Schema.optional(Schema.String), experimentId: Schema.optional(Schema.String), evalId: Schema.optional(Schema.String), resource: Schema.optional(Schema.Literal("case-lock")), previousPid: Schema.optional(NonNegativeIntegerSchema), previousHost: Schema.optional(Schema.String) });
const ExpWarningEventSchema = Schema.Struct({ event: Schema.Literal("warning"), code: Schema.String, level: Schema.Literals(["warning", "error"]), message: Schema.String, phase: Schema.optional(Schema.String), experimentId: Schema.optional(Schema.String), evalId: Schema.optional(Schema.String), planned: Schema.optional(NonNegativeIntegerSchema), errored: Schema.optional(NonNegativeIntegerSchema) });
const ExpBudgetExhaustedEventSchema = Schema.Struct({ event: Schema.Literal("budget_exhausted"), experimentId: Schema.String, spent: NonNegativeIntegerSchema, unstarted: NonNegativeIntegerSchema });
const ExpReporterErrorEventSchema = Schema.Struct({ event: Schema.Literal("reporter_error"), reporter: Schema.String, required: Schema.Boolean, message: Schema.String });
const ExpInterruptedEventSchema = Schema.Struct({ event: Schema.Literal("interrupted") });
const ExpJudgePrecheckEventSchema = Schema.Struct({ event: Schema.Literal("judge_precheck"), status: Schema.Literals(["started", "done", "failed"]), durationMs: Schema.optional(NonNegativeIntegerSchema) });
const ExpExperimentHookEventSchema = Schema.Struct({ event: Schema.Literals(["experiment_setup", "experiment_teardown"]), experimentId: Schema.String, status: Schema.Literals(["started", "done", "failed"]), durationMs: Schema.optional(NonNegativeIntegerSchema) });
const ExpLockWaitEventSchema = Schema.Struct({ event: Schema.Literal("lock_wait"), experimentId: Schema.String, evalId: Schema.String, status: Schema.Literals(["started", "resolved"]), holderPid: Schema.optional(NonNegativeIntegerSchema), holderHost: Schema.optional(Schema.String), resolution: Schema.optional(Schema.Literals(["carried", "dispatched"])), waitedMs: Schema.optional(NonNegativeIntegerSchema) });

/** `niceeval exp --json` 的公开原始事件联合；Testkit 不改变字段或判定。 */
export const ExpEventSchema = Schema.Union([
  ExpStartEventSchema, ExpProgressEventSchema, ExpFailureEventSchema,
  ExpErrorEventSchema, ExpEvalEventSchema, ExpKeptEventSchema,
  ExpNoticeEventSchema, ExpWarningEventSchema, ExpBudgetExhaustedEventSchema,
  ExpReporterErrorEventSchema, ExpInterruptedEventSchema,
  ExpJudgePrecheckEventSchema, ExpExperimentHookEventSchema,
  ExpLockWaitEventSchema, ExpReceiptEventSchema,
]);
export type ExpEvent = Schema.Schema.Type<typeof ExpEventSchema>;

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
    return this.expEvents().filter((event): event is ExpEvalEvent =>
      "event" in event && event.event === "eval"
    );
  }

  /** Strictly decode public execution-error events from `niceeval exp --json`. */
  expErrorEvents(): ExpErrorEvent[] {
    return this.expEvents().filter((event): event is ExpErrorEvent =>
      "event" in event && event.event === "error"
    );
  }

  /** Strictly decode every public event in `niceeval exp --json`. */
  expEvents(): ExpEvent[] {
    const events = this.ndjson<unknown>();
    const decoded: ExpEvent[] = [];
    for (const event of events) {
      const result = decodeSchema(ExpEventSchema, event);
      if (Result.isFailure(result)) {
        throw new Error(
          `expEvents(): stdout contains an invalid niceeval.exp event: ${String(result.failure)}\n\n${this.diagnostic()}`,
        );
      }
      decoded.push(result.success);
    }
    return decoded;
  }

  /** Strictly decode `niceeval query discover`. */
  queryDiscovery(): QueryDiscoveryDocument {
    const document = this.queryDocument("queryDiscovery");
    if (document.outcome !== "discovery") this.queryMismatch("queryDiscovery", "discovery", document);
    return document;
  }

  /** Strictly decode a `niceeval query` failure envelope. */
  queryFailure(): QueryFailureDocument {
    const document = this.queryDocument("queryFailure");
    if (document.outcome !== "failure") this.queryMismatch("queryFailure", "failure", document);
    return document;
  }

  querySuccess<Kind extends QueryOperationId>(operation: Kind): QuerySuccessDocumentFor<Kind> {
    const narrowed = narrowInspectionSuccess(this.queryDocument("querySuccess"), operation);
    if (!narrowed.success) throw new Error(`querySuccess(): ${narrowed.reason}\n\n${this.diagnostic()}`);
    return narrowed.value;
  }

  queryExplanation<Kind extends QueryOperationId>(operation: Kind): QueryExplanationDocumentFor<Kind> {
    const narrowed = narrowInspectionExplanation(this.queryDocument("queryExplanation"), operation);
    if (!narrowed.success) throw new Error(`queryExplanation(): ${narrowed.reason}\n\n${this.diagnostic()}`);
    return narrowed.value;
  }

  overview(): QuerySuccessDocumentFor<"overview.get"> { return this.querySuccess("overview.get"); }
  experiment(): QuerySuccessDocumentFor<"experiment.get"> { return this.querySuccess("experiment.get"); }
  runsList(): QuerySuccessDocumentFor<"runs.list"> { return this.querySuccess("runs.list"); }
  run(): QuerySuccessDocumentFor<"run.get"> { return this.querySuccess("run.get"); }
  runSummary(): QuerySuccessDocumentFor<"run.summary"> { return this.querySuccess("run.summary"); }
  runOverview(): QuerySuccessDocumentFor<"run.overview"> { return this.querySuccess("run.overview"); }
  attempt(): QuerySuccessDocumentFor<"attempt.get"> { return this.querySuccess("attempt.get"); }
  attemptAssertionDetail(): QuerySuccessDocumentFor<"attempt.assertion.detail"> { return this.querySuccess("attempt.assertion.detail"); }
  attemptSources(): QuerySuccessDocumentFor<"attempt.sources"> { return this.querySuccess("attempt.sources"); }

  /** Strictly decode a successful `niceeval query` attempt.trace document. */
  attemptTrace(): QuerySuccessDocumentFor<"attempt.trace"> { return this.querySuccess("attempt.trace"); }

  attemptTraceDetail(): QuerySuccessDocumentFor<"attempt.trace.detail"> { return this.querySuccess("attempt.trace.detail"); }

  /** Strictly decode a successful `niceeval query` attempt.timing document. */
  attemptTiming(): QuerySuccessDocumentFor<"attempt.timing"> { return this.querySuccess("attempt.timing"); }

  attemptUsage(): QuerySuccessDocumentFor<"attempt.usage"> { return this.querySuccess("attempt.usage"); }
  attemptDiff(): QuerySuccessDocumentFor<"attempt.diff"> { return this.querySuccess("attempt.diff"); }
  attemptArtifacts(): QuerySuccessDocumentFor<"attempt.artifacts"> { return this.querySuccess("attempt.artifacts"); }
  runsCompare(): QuerySuccessDocumentFor<"runs.compare"> { return this.querySuccess("runs.compare"); }

  private queryDocument(api: string): QueryDocument {
    const decoded = decodeInspectionDocument(this.json<unknown>());
    if (!decoded.success) throw new Error(`${api}(): stdout is not a valid niceeval.query/v1 document: ${decoded.reason}\n\n${this.diagnostic()}`);
    return decoded.value;
  }

  private queryMismatch(api: string, expected: string, document: QueryDocument): never {
    throw new Error(`${api}(): expected ${expected}, received ${document.outcome}\n\n${this.diagnostic()}`);
  }
}

function decodeSchema<A>(schema: Schema.Codec<A, unknown, never>, input: unknown): Result.Result<A, unknown> {
  try {
    return Result.succeed(Schema.decodeUnknownSync(schema, { errors: "all", onExcessProperty: "error" })(input));
  } catch (cause) {
    return Result.fail(cause);
  }
}

function isExpStartEvent(value: unknown): value is ExpStartEvent {
  return Result.isSuccess(Schema.decodeUnknownResult(ExpStartEventSchema)(value));
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
