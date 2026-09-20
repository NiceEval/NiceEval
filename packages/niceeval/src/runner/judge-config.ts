import { Predicate } from "effect";
import type { JudgeConfig, ResolvedJudgeConfig } from "../types.ts";
import { assertionRuntimeLimits } from "../assertions/limits.ts";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_API_KEY_ENV = "NICEEVAL_JUDGE_KEY";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_024;

/**
 * Resolve Judge Runtime once per Eval × Experiment pair. Undefined fields
 * inherit independently; the frozen result is shared by identity and execution.
 */
export function normalizeJudgeConfig(value: unknown, label: string): JudgeConfig {
  if (!Predicate.isObject(value) || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const allowed = ["model", "baseUrl", "apiKeyEnv", "timeoutMs", "maxOutputTokens"] as const;
  const captured: Partial<Record<(typeof allowed)[number], unknown>> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key as (typeof allowed)[number])) {
      throw new TypeError(`${label} has unknown option ${String(key)}`);
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    captured[key as (typeof allowed)[number]] = descriptor.value;
  }
  const boundedText = (key: "model" | "baseUrl" | "apiKeyEnv", maximumBytes: number): string | undefined => {
    const candidate = captured[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "string" || candidate.trim() === "" || new TextEncoder().encode(candidate).byteLength > maximumBytes || /\p{Cc}/u.test(candidate)) {
      throw new TypeError(`${label}.${key} must be non-empty, control-free, and at most ${maximumBytes} UTF-8 bytes`);
    }
    return candidate;
  };
  const positiveInteger = (key: "timeoutMs" | "maxOutputTokens", maximum: number): number | undefined => {
    const candidate = captured[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate <= 0 || candidate > maximum) {
      throw new TypeError(`${label}.${key} must be a positive safe integer at most ${maximum}`);
    }
    return candidate;
  };
  const model = boundedText("model", assertionRuntimeLimits.stringBytes);
  const baseUrl = boundedText("baseUrl", assertionRuntimeLimits.stringBytes);
  if (baseUrl !== undefined) {
    let parsed: URL;
    try { parsed = new URL(baseUrl); } catch { throw new TypeError(`${label}.baseUrl must be an absolute http(s) URL`); }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new TypeError(`${label}.baseUrl must be an absolute http(s) URL`);
    }
  }
  const apiKeyEnv = boundedText("apiKeyEnv", assertionRuntimeLimits.stringBytes);
  if (apiKeyEnv !== undefined && !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(apiKeyEnv)) {
    throw new TypeError(`${label}.apiKeyEnv must be an environment variable name`);
  }
  const timeoutMs = positiveInteger("timeoutMs", Number.MAX_SAFE_INTEGER);
  const maxOutputTokens = positiveInteger("maxOutputTokens", Number.MAX_SAFE_INTEGER);
  return Object.freeze({
    ...(model === undefined ? {} : { model }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  });
}

export function resolveJudge(
  experimentJudge: JudgeConfig | undefined,
  evalJudge: JudgeConfig | undefined,
  configJudge: JudgeConfig | undefined,
): ResolvedJudgeConfig {
  const maxOutputTokens = experimentJudge?.maxOutputTokens ?? evalJudge?.maxOutputTokens ?? configJudge?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  return Object.freeze({
    ...(experimentJudge?.model ?? evalJudge?.model ?? configJudge?.model) === undefined
      ? {}
      : { model: experimentJudge?.model ?? evalJudge?.model ?? configJudge?.model },
    baseUrl: experimentJudge?.baseUrl ?? evalJudge?.baseUrl ?? configJudge?.baseUrl ?? DEFAULT_BASE_URL,
    apiKeyEnv: experimentJudge?.apiKeyEnv ?? evalJudge?.apiKeyEnv ?? configJudge?.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    timeoutMs: experimentJudge?.timeoutMs ?? evalJudge?.timeoutMs ?? configJudge?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxOutputTokens,
  });
}
