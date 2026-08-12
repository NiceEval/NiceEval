// Native LLM-as-Judge evaluator. The Assert-first path keeps provider I/O,
// timeout, retry, and interruption inside the owning Effect.

import { ClosedQA, Factuality, Summary } from "autoevals";
import { Effect } from "effect";
import OpenAI from "openai";

import { summaryText } from "./display.ts";
import type { MeasurementAssertionEvaluation } from "./api.ts";
import type { JudgeMaterial, ResolvedJudgeConfig } from "./types.ts";
import { getEnv } from "../util.ts";

const JUDGE_MAX_ATTEMPTS = 3;
const JUDGE_RETRY_BASE_DELAY_MS = 1_000;
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_MAX_ATTEMPTS = 2;

export type JudgeRecipe = "closedQA" | "factuality" | "summarizes";
type AutoevalResult = { score?: number | null; metadata?: Record<string, unknown> };

type JudgeMeasurementResult =
  | {
      readonly state: "measured";
      readonly value: number;
      readonly evidence?: string;
      readonly explanation?: string;
    }
  | {
      readonly state: "unavailable";
      readonly reason: "source-unavailable";
      readonly detail: string;
      readonly evidence?: string;
    }
  | {
      readonly state: "errored";
      readonly code: string;
      readonly message: string;
    };

function errorSummary(error: unknown): string {
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

function judgeCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; current !== undefined && depth < 5; depth++) {
    const code = objectField(current, "code");
    if (typeof code === "string" && code !== "") return code;
    const nestedCode = objectField(objectField(current, "error"), "code");
    if (typeof nestedCode === "string" && nestedCode !== "") return nestedCode;
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

function retryAfterMs(headers: unknown): number | undefined {
  const raw = headerValue(headers, "retry-after")?.trim();
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
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
    if (typeof code === "string" && /^(?:ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT|ERR_TLS)/i.test(code)) return true;
    if (/fetch failed|socket hang up|connection (?:reset|closed|refused)|network error|other side closed|timed? out|timeout|\b(?:ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT)\b/i.test(errorSummary(current))) {
      return true;
    }
    current = objectField(current, "cause");
  }
  return false;
}

function isTransportFailure(error: unknown): boolean {
  return judgeStatus(error) !== undefined || isConnectionFailure(error);
}

function isTransientJudgeFailure(error: unknown): boolean {
  const status = judgeStatus(error);
  return isTransientJudgeStatus(status) || (status === undefined && isConnectionFailure(error));
}

interface JudgeProviderFailure {
  readonly _tag: "JudgeProviderFailure";
  readonly error: unknown;
}

interface JudgeProbeTimeout {
  readonly _tag: "JudgeProbeTimeout";
}

type JudgeProbeFailure = JudgeProviderFailure | JudgeProbeTimeout;

/**
 * An author-facing AbortSignal is external to this fiber. It must interrupt
 * the owning Effect instead of being reclassified as a Judge result.
 */
function interruptWhenAborted(signal: AbortSignal): Effect.Effect<never> {
  return Effect.async<never>((resume) => {
    const interrupted = () => resume(Effect.interrupt);
    if (signal.aborted) {
      interrupted();
      return;
    }
    signal.addEventListener("abort", interrupted, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", interrupted));
  });
}

function interruptibleByCaller<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  signal: AbortSignal | undefined,
): Effect.Effect<A, E, R> {
  return signal === undefined ? effect : Effect.raceFirst(effect, interruptWhenAborted(signal));
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

function judgeFailureEvidence(error: unknown, model: string, attempts: number, retried: boolean): string {
  const parts = [`model=${model}`];
  const status = judgeStatus(error);
  const code = judgeCode(error);
  if (status !== undefined) parts.push(`HTTP ${status}`);
  if (code !== undefined) parts.push(`code=${code}`);
  parts.push(errorSummary(error));
  parts.push(retried ? `retry=yes · attempts=${attempts}` : "retry=no");
  if (attempts >= JUDGE_MAX_ATTEMPTS) parts.push("retries exhausted");
  return parts.join(" · ");
}

function judgeClient(apiKey: string, baseURL: string, signal?: AbortSignal): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL,
    maxRetries: 0,
    fetch: signal
      ? (input, init) => fetch(input, {
          ...init,
          signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
        })
      : undefined,
  });
}

type AutoevalOpenAIClient = NonNullable<Parameters<typeof ClosedQA>[0]["client"]>;

function bridgeAutoevalClient(client: OpenAI): { readonly client: AutoevalOpenAIClient } {
  // @ts-expect-error autoevals and this package resolve equivalent OpenAI SDKs through distinct peer contexts.
  return { client };
}

export function freezeJudgeMaterial(material: JudgeMaterial): JudgeMaterial {
  if (typeof material !== "object" || material === null || typeof material.input !== "string" || typeof material.output !== "string") {
    throw new TypeError("t.judge requires material { input: string, output: string }");
  }
  return Object.freeze({ input: material.input, output: material.output });
}

function evidenceFor(material: JudgeMaterial): string {
  return JSON.stringify({ input: summaryText(material.input), output: summaryText(material.output) });
}

function missingConfiguration(resolved: ResolvedJudgeConfig): JudgeMeasurementResult | undefined {
  if (!resolved.model) return unavailable("judge-model-unresolved");
  if (!getEnv(resolved.apiKeyEnv)) return unavailable(`judge-key-unresolved (${resolved.apiKeyEnv} unset)`);
  return undefined;
}

const retryProbe = Symbol("retry-judge-probe");

function probeAttempt(
  judge: ResolvedJudgeConfig,
  apiKey: string,
  endpoint: string,
  attempt: number,
  callerSignal: AbortSignal | undefined,
): Effect.Effect<string | undefined | typeof retryProbe, JudgeProbeFailure> {
  const probe = Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: async (effectSignal) => {
        // This is the probe's sole Promise adapter boundary. The Effect fiber
        // owns provider cancellation; caller aborts interrupt that fiber first.
        const response = await fetch(`${endpoint}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: judge.model, messages: [{ role: "user", content: "Reply with the single word: ok" }] }),
          signal: effectSignal,
        });
        return {
          response,
          body: response.ok ? "" : await response.text().catch(() => ""),
        };
      },
      catch: (error): JudgeProviderFailure => ({ _tag: "JudgeProviderFailure", error }),
    });
    if (response.response.ok) return undefined;

    if (isTransientJudgeStatus(response.response.status) && attempt < PROBE_MAX_ATTEMPTS) {
      const delay = retryAfterMs(response.response.headers);
      if (delay !== undefined) yield* Effect.sleep(delay);
      return retryProbe;
    }
    return `Judge precheck failed for ${endpoint} (${judge.model}): HTTP ${response.response.status} ${response.body.slice(0, 300)}`;
  }).pipe(
    Effect.timeoutFail({
      duration: PROBE_TIMEOUT_MS,
      onTimeout: (): JudgeProbeTimeout => ({ _tag: "JudgeProbeTimeout" }),
    }),
  );
  return interruptibleByCaller(probe, callerSignal);
}

function probeFailureMessage(
  failure: JudgeProbeFailure,
  judge: ResolvedJudgeConfig,
  endpoint: string,
): string {
  if (failure._tag === "JudgeProbeTimeout") {
    return `Judge precheck timed out for ${endpoint} (${judge.model}) after ${PROBE_TIMEOUT_MS / 1000}s`;
  }
  return `Judge precheck failed for ${endpoint} (${judge.model}): ${errorSummary(failure.error)}`;
}

/**
 * A precheck only tests a configured, credentialed endpoint.  Missing model or
 * key remains a normal zero-network unavailable Fact when an author consumes it.
 */
export function probeJudgeEffect(
  judge: ResolvedJudgeConfig,
  signal?: AbortSignal,
): Effect.Effect<string | undefined> {
  return Effect.suspend(() => {
    const apiKey = getEnv(judge.apiKeyEnv);
    if (!judge.model || !apiKey) return Effect.succeed(undefined);
    const endpoint = judge.baseUrl.replace(/\/$/, "");
    const probe = (attempt: number): Effect.Effect<string | undefined> =>
      probeAttempt(judge, apiKey, endpoint, attempt, signal).pipe(
        Effect.flatMap((result) =>
          result === retryProbe
            ? probe(attempt + 1)
            : Effect.succeed(result)),
        Effect.catchAll((failure) =>
          attempt === PROBE_MAX_ATTEMPTS
            ? Effect.succeed(probeFailureMessage(failure, judge, endpoint))
            : probe(attempt + 1)),
      );
    return probe(1);
  });
}

function unavailableForCall(model: string, timeoutMs: number, attempts: number, retried: boolean): JudgeMeasurementResult {
  return unavailable(
    "judge-call-failed",
    `model=${model} · timed out after ${formatSeconds(timeoutMs)} · retry=${retried ? "yes" : "no"} · attempts=${attempts}`,
  );
}

function unavailable(detail: string, evidence?: string): JudgeMeasurementResult {
  return {
    state: "unavailable",
    reason: "source-unavailable",
    detail,
    ...(evidence === undefined ? {} : { evidence }),
  };
}

function evaluatorError(code: string, message: string): JudgeMeasurementResult {
  return { state: "errored", code, message };
}

/** Throws synchronously at the author callsite when the Eval did not opt in. */
export function assertJudgeCapability(
  judge: ResolvedJudgeConfig | undefined,
): asserts judge is ResolvedJudgeConfig {
  if (judge === undefined) {
    throw new Error("Judge Assertion requires defineEval({ judge: true }) or defineScoreEval({ judge: true })");
  }
}

export interface JudgeRecipeExecution {
  readonly judge: ResolvedJudgeConfig;
  readonly recipe: JudgeRecipe;
  readonly reference: string;
  readonly material: JudgeMaterial;
  readonly signal?: AbortSignal;
  readonly random?: () => number;
}

function evaluateAutoeval(
  input: JudgeRecipeExecution,
  material: JudgeMaterial,
  apiKey: string,
  model: string,
): Effect.Effect<AutoevalResult, JudgeProviderFailure> {
  const provider = Effect.tryPromise({
    try: (effectSignal) => {
      const client = bridgeAutoevalClient(judgeClient(
        apiKey,
        input.judge.baseUrl,
        effectSignal,
      ));
      return Promise.resolve(
        input.recipe === "closedQA"
          ? ClosedQA({ input: material.input, output: material.output, criteria: input.reference, model, ...client })
          : input.recipe === "factuality"
            ? Factuality({ input: material.input, output: material.output, expected: input.reference, model, ...client })
            : Summary({ input: material.input, output: material.output, expected: input.reference, model, ...client }),
      );
    },
    catch: (error): JudgeProviderFailure => ({ _tag: "JudgeProviderFailure", error }),
  });
  return provider;
}

function judgeSleep(delayMs: number): Effect.Effect<void> {
  return Effect.sleep(delayMs);
}

/**
 * The real Judge invocation. Provider I/O is adapted once, then retry,
 * timeout, interruption, and delay remain inside the owning Effect.
 */
function evaluateJudgeRecipe(
  input: JudgeRecipeExecution,
): Effect.Effect<JudgeMeasurementResult> {
  const evaluation = Effect.suspend(() => {
    const { judge: resolved } = input;
    const frozenMaterial = freezeJudgeMaterial(input.material);
    const missing = missingConfiguration(resolved);
    if (missing !== undefined) return Effect.succeed(missing);
    const model = resolved.model!;
    const apiKey = getEnv(resolved.apiKeyEnv)!;
    let attempts = 0;
    let retried = false;

    const evaluate = (attempt: number): Effect.Effect<JudgeMeasurementResult> =>
      Effect.sync(() => {
        attempts = attempt + 1;
      }).pipe(
        Effect.zipRight(
          evaluateAutoeval(input, frozenMaterial, apiKey, model).pipe(
            Effect.flatMap((result): Effect.Effect<JudgeMeasurementResult> => {
              if (typeof result.score !== "number" || !Number.isFinite(result.score) || result.score < 0 || result.score > 1) {
                return Effect.succeed(evaluatorError("judge-invalid-response", "Judge returned no finite score in [0, 1]"));
              }
              const rationale = result.metadata?.rationale;
              return Effect.succeed({
                state: "measured" as const,
                value: result.score,
                evidence: evidenceFor(frozenMaterial),
                ...(typeof rationale === "string" && rationale.trim() !== "" ? { explanation: summaryText(rationale) } : {}),
              });
            }),
            Effect.catchAll((failure: JudgeProviderFailure): Effect.Effect<JudgeMeasurementResult> => {
              const error = failure.error;
              if (!isTransportFailure(error)) return Effect.succeed(evaluatorError("judge-evaluator-error", errorSummary(error)));
              if (!isTransientJudgeFailure(error) || attempt + 1 >= JUDGE_MAX_ATTEMPTS) {
                return Effect.succeed(unavailable("judge-call-failed", judgeFailureEvidence(error, model, attempts, retried)));
              }
              const retryAfter = retryAfterMs(objectField(error, "headers"));
              const delay = retryAfter ?? (input.random ?? Math.random)() * JUDGE_RETRY_BASE_DELAY_MS * 2 ** attempt;
              retried = true;
              return judgeSleep(delay).pipe(
                Effect.zipRight(evaluate(attempt + 1)),
              );
            }),
          ),
        ),
      );

    return evaluate(0).pipe(
      Effect.timeoutTo({
        duration: resolved.timeoutMs,
        onSuccess: (evaluation) => evaluation,
        onTimeout: () => unavailableForCall(model, resolved.timeoutMs, attempts, retried),
      }),
    );
  });
  return interruptibleByCaller(evaluation, input.signal);
}

/** Assert-first bridge: one provider Promise adaptation in the Attempt Effect. */
export function evaluateJudgeMeasurement(
  input: JudgeRecipeExecution,
): Effect.Effect<MeasurementAssertionEvaluation, never, never> {
  return evaluateJudgeRecipe(input);
}
