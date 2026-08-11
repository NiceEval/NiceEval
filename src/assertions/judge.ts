// Native LLM-as-Judge Fact producer.  A Judge recipe only creates one lazy
// ScoreFact; assert/require/score decide how that Fact is consumed.

import { ClosedQA, Factuality, Summary } from "autoevals";
import OpenAI from "openai";

import {
  type ScoreFactDefinition,
  type ScoreFactEvaluation,
} from "./collector.ts";
import { summaryText } from "./display.ts";
import type { JudgeMaterial, ResolvedJudgeConfig, ScoreFact } from "./types.ts";
import type { JudgeNamespace, TurnJudgeNamespace } from "../context/types.ts";
import { getEnv } from "../util.ts";

const JUDGE_MAX_ATTEMPTS = 3;
const JUDGE_RETRY_BASE_DELAY_MS = 1_000;
const PROBE_TIMEOUT_MS = 20_000;
const PROBE_MAX_ATTEMPTS = 2;

export interface JudgeDeps {
  /** Undefined means the Eval never declared Judge capability. */
  readonly judge: ResolvedJudgeConfig | undefined;
  readonly signal?: AbortSignal;
  readonly createScoreFact: (definition: ScoreFactDefinition<"now">) => ScoreFact<"now">;
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly random?: () => number;
}

type Recipe = "closedQA" | "factuality" | "summarizes";
type AutoevalResult = { score?: number | null; metadata?: Record<string, unknown> };

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

function defaultJudgeSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("aborted"));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function formatSeconds(ms: number): string {
  const seconds = ms / 1000;
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

function checkSummary(kind: Recipe, reference: string): string {
  const flat = reference.replace(/\s+/g, " ").trim();
  const short = flat.length > 80 ? `${flat.slice(0, 80)}…` : flat;
  return `${kind}(${JSON.stringify(short)})`;
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

function assertMaterial(material: JudgeMaterial): JudgeMaterial {
  if (typeof material !== "object" || material === null || typeof material.input !== "string" || typeof material.output !== "string") {
    throw new TypeError("t.judge requires material { input: string, output: string }");
  }
  return Object.freeze({ input: material.input, output: material.output });
}

function evidenceFor(material: JudgeMaterial): string {
  return JSON.stringify({ input: summaryText(material.input), output: summaryText(material.output) });
}

function missingConfiguration(resolved: ResolvedJudgeConfig): ScoreFactEvaluation | undefined {
  if (!resolved.model) return unavailable("judge-model-unresolved");
  if (!getEnv(resolved.apiKeyEnv)) return unavailable(`judge-key-unresolved (${resolved.apiKeyEnv} unset)`);
  return undefined;
}

/**
 * A precheck only tests a configured, credentialed endpoint.  Missing model or
 * key remains a normal zero-network unavailable Fact when an author consumes it.
 */
export async function probeJudge(judge: ResolvedJudgeConfig, signal?: AbortSignal): Promise<string | undefined> {
  const apiKey = getEnv(judge.apiKeyEnv);
  if (!judge.model || !apiKey) return undefined;
  const endpoint = judge.baseUrl.replace(/\/$/, "");
  for (let attempt = 1; attempt <= PROBE_MAX_ATTEMPTS; attempt++) {
    const timeoutSignal = AbortSignal.timeout(PROBE_TIMEOUT_MS);
    const probeSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const response = await fetch(`${endpoint}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: judge.model, messages: [{ role: "user", content: "Reply with the single word: ok" }] }),
        signal: probeSignal,
      });
      if (response.ok) return undefined;
      const body = await response.text().catch(() => "");
      if (isTransientJudgeStatus(response.status) && attempt < PROBE_MAX_ATTEMPTS) {
        const delay = retryAfterMs(response.headers);
        if (delay !== undefined) await defaultJudgeSleep(delay, probeSignal);
        continue;
      }
      return `Judge precheck failed for ${endpoint} (${judge.model}): HTTP ${response.status} ${body.slice(0, 300)}`;
    } catch (error) {
      if (signal?.aborted || attempt === PROBE_MAX_ATTEMPTS) {
        if (error instanceof Error && error.name === "TimeoutError") {
          return `Judge precheck timed out for ${endpoint} (${judge.model}) after ${PROBE_TIMEOUT_MS / 1000}s`;
        }
        return `Judge precheck failed for ${endpoint} (${judge.model}): ${errorSummary(error)}`;
      }
    }
  }
  return undefined;
}

function unavailableForCall(model: string, timeoutMs: number, attempts: number, retried: boolean, interrupted = false): ScoreFactEvaluation {
  return unavailable(
    "judge-call-failed",
    interrupted
      ? `model=${model} · interrupted · retry=no · attempts=${attempts}`
      : `model=${model} · timed out after ${formatSeconds(timeoutMs)} · retry=${retried ? "yes" : "no"} · attempts=${attempts}`,
  );
}

function unavailable(reason: string, evidence?: string): ScoreFactEvaluation {
  return { outcome: "unavailable", reason, ...(evidence === undefined ? {} : { evidence }) };
}

function evaluatorError(code: string, message: string): ScoreFactEvaluation {
  return { outcome: "errored", error: { class: "evaluator", code, message } };
}

function createRecipe(deps: JudgeDeps, recipe: Recipe, reference: string, material: JudgeMaterial): ScoreFact<"now"> {
  const resolved = deps.judge;
  if (resolved === undefined) {
    throw new Error("Judge Fact requires defineEval({ judge: true }) or defineScoreEval({ judge: true })");
  }
  if (typeof reference !== "string" || reference.trim() === "") {
    throw new TypeError("Judge recipe reference must be a non-empty string");
  }
  const frozenMaterial = assertMaterial(material);
  const check = checkSummary(recipe, reference);
  return deps.createScoreFact({
    name: `judge:${check}`,
    phase: "now",
    judge: { check },
    evaluate: async (): Promise<ScoreFactEvaluation> => {
      const missing = missingConfiguration(resolved);
      if (missing !== undefined) return missing;
      const model = resolved.model!;
      const apiKey = getEnv(resolved.apiKeyEnv)!;
      const budget = new AbortController();
      const deadlineAt = Date.now() + resolved.timeoutMs;
      let timedOut = false;
      let attempts = 0;
      let retried = false;
      const timer = setTimeout(() => {
        timedOut = true;
        budget.abort();
      }, resolved.timeoutMs);
      const callSignal = deps.signal ? AbortSignal.any([deps.signal, budget.signal]) : budget.signal;
      try {
        for (let attempt = 0; attempt < JUDGE_MAX_ATTEMPTS; attempt++) {
          if (Date.now() >= deadlineAt || budget.signal.aborted) return unavailableForCall(model, resolved.timeoutMs, attempts, retried);
          attempts = attempt + 1;
          try {
            const client = bridgeAutoevalClient(judgeClient(apiKey, resolved.baseUrl, callSignal));
            const call = Promise.resolve(
              recipe === "closedQA"
                ? ClosedQA({ input: frozenMaterial.input, output: frozenMaterial.output, criteria: reference, model, ...client })
                : recipe === "factuality"
                  ? Factuality({ input: frozenMaterial.input, output: frozenMaterial.output, expected: reference, model, ...client })
                  : Summary({ input: frozenMaterial.input, output: frozenMaterial.output, expected: reference, model, ...client }),
            );
            call.catch(() => {});
            const result = await Promise.race([
              call,
              new Promise<never>((_, reject) => budget.signal.addEventListener("abort", () => reject(new Error("judge call exceeded its budget")), { once: true })),
            ]) as AutoevalResult;
            if (typeof result?.score !== "number" || !Number.isFinite(result.score) || result.score < 0 || result.score > 1) {
              return evaluatorError("judge-invalid-response", "Judge returned no finite score in [0, 1]");
            }
            const rationale = result.metadata?.rationale;
            return {
              outcome: "scored",
              normalizedScore: result.score,
              evidence: evidenceFor(frozenMaterial),
              ...(typeof rationale === "string" && rationale.trim() !== "" ? { explanation: summaryText(rationale) } : {}),
            };
          } catch (error) {
            if (timedOut || deps.signal?.aborted) return unavailableForCall(model, resolved.timeoutMs, attempts, retried, !timedOut);
            if (!isTransportFailure(error)) return evaluatorError("judge-evaluator-error", errorSummary(error));
            if (!isTransientJudgeFailure(error) || attempt + 1 >= JUDGE_MAX_ATTEMPTS) {
              return unavailable("judge-call-failed", judgeFailureEvidence(error, model, attempts, retried));
            }
            const remaining = deadlineAt - Date.now();
            if (remaining <= 0) return unavailableForCall(model, resolved.timeoutMs, attempts, retried);
            const retryAfter = retryAfterMs(objectField(error, "headers"));
            const delay = Math.min(retryAfter ?? (deps.random ?? Math.random)() * JUDGE_RETRY_BASE_DELAY_MS * 2 ** attempt, remaining);
            retried = true;
            try {
              await (deps.sleep ?? defaultJudgeSleep)(delay, budget.signal);
            } catch {
              return unavailableForCall(model, resolved.timeoutMs, attempts, true, !budget.signal.aborted);
            }
          }
        }
      } finally {
        clearTimeout(timer);
      }
      return evaluatorError("judge-evaluator-error", "Judge evaluator ended without a result");
    },
  });
}

export function buildJudge(deps: JudgeDeps): JudgeNamespace {
  return {
    autoevals: {
      closedQA: (question, material) => createRecipe(deps, "closedQA", question, material),
      factuality: (expected, material) => createRecipe(deps, "factuality", expected, material),
      summarizes: (source, material) => createRecipe(deps, "summarizes", source, material),
    },
  };
}

export function buildTurnJudge(deps: JudgeDeps, material: JudgeMaterial): TurnJudgeNamespace {
  const frozenMaterial = assertMaterial(material);
  return {
    autoevals: {
      closedQA: (question) => createRecipe(deps, "closedQA", question, frozenMaterial),
      factuality: (expected) => createRecipe(deps, "factuality", expected, frozenMaterial),
      summarizes: (source) => createRecipe(deps, "summarizes", source, frozenMaterial),
    },
  };
}
