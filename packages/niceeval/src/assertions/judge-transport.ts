// @concord-file
// @concord-implements docs/feature/judge/architecture.md

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const RESPONSE_BYTES_PER_TOKEN = 8;

export function errorSummary(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 300);
}

function objectField(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
}

function judgeStatus(error: unknown): number | undefined {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const status = objectField(current, "status");
    if (typeof status === "number" && Number.isInteger(status)) return status;
    const nested = objectField(current, "error");
    const nestedStatus = objectField(nested, "status");
    if (typeof nestedStatus === "number" && Number.isInteger(nestedStatus)) return nestedStatus;
    current = objectField(current, "cause");
  }
  return undefined;
}

function headerValue(headers: unknown, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  if (typeof headers !== "object" || headers === null) return undefined;
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower && typeof value === "string") return value;
  }
  return undefined;
}

export function retryAfterMs(headers: unknown, nowMs: number): number | undefined {
  const raw = headerValue(headers, "retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - nowMs) : undefined;
}

function isTransientJudgeStatus(status: number | undefined): boolean {
  return status === 408 || status === 429 || (status !== undefined && status >= 500 && status <= 599);
}

function isConnectionFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const name = objectField(current, "name");
    const code = objectField(current, "code");
    if (name === "APIUserAbortError") return false;
    if (name === "APIConnectionError" || name === "APIConnectionTimeoutError") return true;
    if (
      typeof code === "string" &&
      /^(?:ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ERR_TLS)/i.test(code)
    )
      return true;
    if (
      /fetch failed|socket hang up|connection (?:reset|closed|refused)|network error|other side closed|timed? out|timeout|\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b/i.test(
        errorSummary(current),
      )
    ) {
      return true;
    }
    current = objectField(current, "cause");
  }
  return false;
}

export function isTransportFailure(error: unknown): boolean {
  const status = judgeStatus(error);
  return error instanceof JudgePreOutputFailure || isConnectionFailure(error) || isTransientJudgeStatus(status);
}

const decodeErrorResponse = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

class JudgePreOutputFailure extends Error {
  readonly status = 200;
  readonly headers: Headers;
  readonly retryable: boolean;

  constructor(message: string, headers: Headers, retryable: boolean) {
    super(`HTTP 200: ${message}`);
    this.headers = headers;
    this.retryable = retryable;
  }
}

function hasJudgeOutput(value: unknown): boolean {
  return ["choices", "content", "text", "tool_calls", "function_call", "output", "answers"].some((key) => {
    const field = objectField(value, key);
    return Array.isArray(field) ? field.length > 0 : field != null && field !== "";
  });
}

/** Recognize error envelopes in a bounded response, including SSE returned by compatible gateways. */
function judgePreOutputError(body: string, headers: Headers): { message: string; retryable: boolean } | undefined {
  let failure: { message: string; retryable: boolean } | undefined;
  const sse = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() === "text/event-stream";
  try {
    for (const frame of sse ? body.replace(/\r\n?/gu, "\n").split("\n\n") : [body]) {
      const lines = sse ? frame.split("\n") : [];
      const data = sse
        ? lines
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).replace(/^ /u, ""))
            .join("\n")
        : frame;
      if (sse && (data === "" || data === "[DONE]")) continue;
      const value = decodeErrorResponse(data);
      if (hasJudgeOutput(value)) return undefined;
      const error = objectField(value, "error");
      const detail =
        typeof error === "object" && error !== null && !Array.isArray(error)
          ? error
          : objectField(value, "type") === "error" || lines.some((line) => /^event: ?error$/u.test(line))
            ? value
            : undefined;
      if (detail === undefined) continue;
      const message = objectField(detail, "message");
      failure = {
        message: typeof message === "string" && message.trim() !== "" ? message : "Provider returned an error",
        retryable:
          (failure?.retryable ?? true) &&
          objectField(value, "retryable") !== false &&
          objectField(detail, "retryable") !== false,
      };
    }
  } catch {
    // Malformed responses continue through the regular response validation.
    return undefined;
  }
  return failure;
}

export function isTransientJudgeFailure(error: unknown, responseBody?: string): boolean {
  if (headerValue(objectField(error, "headers"), "x-should-retry")?.trim().toLowerCase() === "false") return false;
  if (error instanceof JudgePreOutputFailure) return error.retryable;
  if (responseBody !== undefined) {
    try {
      const body = decodeErrorResponse(responseBody);
      if (objectField(body, "retryable") === false || objectField(objectField(body, "error"), "retryable") === false)
        return false;
    } catch {
      // A non-JSON error page does not override its HTTP transport status.
    }
  }
  const status = judgeStatus(error);
  return isTransientJudgeStatus(status) || (status === undefined && isConnectionFailure(error));
}

/**
 * An author-facing AbortSignal is external to this fiber. It must interrupt
 * the owning Effect instead of being reclassified as a Judge result.
 */
function interruptWhenAborted(signal: AbortSignal): Effect.Effect<never> {
  return Effect.callback<never>((resume) => {
    let completed = false;
    const interrupted = () => {
      if (completed) return;
      completed = true;
      resume(Effect.interrupt);
    };
    signal.addEventListener("abort", interrupted, { once: true });
    // Register first, then inspect state so an abort cannot fall between the
    // initial check and listener installation.
    if (signal.aborted) interrupted();
    return Effect.sync(() => {
      completed = true;
      signal.removeEventListener("abort", interrupted);
    });
  });
}

export function interruptibleByCaller<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  signal: AbortSignal | undefined,
): Effect.Effect<A, E, R> {
  if (signal === undefined) return effect;
  return Effect.suspend(() =>
    signal.aborted ? Effect.interrupt : Effect.raceFirst(effect, interruptWhenAborted(signal)),
  );
}

class JudgeResponseTooLarge extends Error {}

export function responseByteCap(maxOutputTokens: number): number {
  return Math.max(1_024, maxOutputTokens * RESPONSE_BYTES_PER_TOKEN);
}

export async function readJudgeResponseText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  usage?: import("../o11y/judge-usage.ts").JudgeUsageTransmission,
  deadlineAt = Infinity,
): Promise<string> {
  const advertised = response.headers.get("content-length");
  if (advertised !== null && Number(advertised) > maxBytes) {
    const cancellation = response.body?.cancel();
    if (cancellation !== undefined) {
      usage?.trackCleanup(cancellation, deadlineAt);
      void cancellation.catch(() => undefined);
    }
    throw new JudgeResponseTooLarge("judge response exceeds the byte cap");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  let bytes = 0;
  let complete = false;
  let rejectAbort: (reason: unknown) => void = () => undefined;
  const interrupted = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  const abort = () => rejectAbort(new DOMException("Judge request cancelled", "AbortError"));
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (next.done) {
        complete = true;
        break;
      }
      bytes += next.value.byteLength;
      if (bytes > maxBytes) throw new JudgeResponseTooLarge("judge response exceeds the byte cap");
      chunks.push(next.value);
    }
    const joined = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(joined);
  } finally {
    signal?.removeEventListener("abort", abort);
    if (complete) reader.releaseLock();
    else {
      const cancellation = reader.cancel().finally(() => reader.releaseLock());
      usage?.trackCleanup(cancellation, deadlineAt);
      void cancellation.catch(() => undefined);
    }
  }
}

function abortWait(signal: AbortSignal): { promise: Promise<never>; dispose: () => void } {
  let abort: () => void = () => undefined;
  const promise = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException("Judge request cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  return { promise, dispose: () => signal.removeEventListener("abort", abort) };
}

/** The single bounded HTTP adapter used by every managed LLM primitive. */
export async function requestScoreMatchProvider(input: {
  readonly baseUrl: string;
  readonly endpoint: "chat/completions" | "systemone";
  readonly apiKey: string;
  readonly headers: Readonly<Record<string, string>> | undefined;
  readonly body: string;
  readonly maxBytes: number;
  readonly signal: AbortSignal;
  readonly usage: import("../o11y/judge-usage.ts").JudgeUsageTransmission | undefined;
  readonly deadlineAt: number | undefined;
  readonly timing?: import("../judge/timing.ts").JudgeTimingSpan | undefined;
}): Promise<{
  readonly status: number;
  readonly headers: Headers;
  readonly body: string;
  readonly preOutputFailure: JudgePreOutputFailure | undefined;
}> {
  const deadlineAt = input.deadlineAt ?? Infinity;
  let resolveSettled: () => void = () => undefined;
  const settled = new Promise<void>((resolve) => {
    resolveSettled = resolve;
  });
  const cancel = () => {
    input.usage?.cancel();
    input.usage?.trackCleanup(settled, deadlineAt);
  };
  input.signal.addEventListener("abort", cancel, { once: true });
  const interrupted = abortWait(input.signal);
  let request: Promise<Response> | undefined;
  let received = false;
  let timingOutcome: import("../judge/timing.ts").JudgeTimingOutcome = "failed";
  try {
    request = fetch(`${input.baseUrl.replace(/\/$/u, "")}/${input.endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
        ...(input.headers ?? {}),
      },
      body: input.body,
      signal: input.signal,
    });
    const response = await Promise.race([request, interrupted.promise]);
    received = true;
    input.usage?.headers(response.status);
    const body = await readJudgeResponseText(response, input.maxBytes, input.signal, input.usage, deadlineAt);
    const reported = response.status === 200 ? judgePreOutputError(body, response.headers) : undefined;
    const preOutputFailure =
      reported === undefined
        ? undefined
        : new JudgePreOutputFailure(
            [input.apiKey, ...Object.values(input.headers ?? {})].reduce(
              (message, value) => (value ? message.replaceAll(value, "[redacted]") : message),
              reported.message,
            ),
            response.headers,
            reported.retryable,
          );
    timingOutcome = response.ok && preOutputFailure === undefined ? "completed" : "failed";
    input.usage?.body(body, timingOutcome === "completed");
    return { status: response.status, headers: response.headers, body, preOutputFailure };
  } catch (error) {
    if (input.signal.aborted) input.usage?.cancel();
    else input.usage?.fail(error instanceof JudgeResponseTooLarge ? "response-too-large" : "response-unavailable");
    if (!received && request !== undefined) {
      const cleanup = request.then(
        (response) => response.body?.cancel(),
        () => undefined,
      );
      input.usage?.trackCleanup(cleanup, deadlineAt);
      void cleanup.catch(() => undefined);
    }
    throw error;
  } finally {
    interrupted.dispose();
    input.signal.removeEventListener("abort", cancel);
    resolveSettled();
    input.timing?.end(input.signal.aborted ? "cancelled" : timingOutcome);
  }
}
