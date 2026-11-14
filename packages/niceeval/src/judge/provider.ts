import { Predicate } from "effect";

const judgeProviderBrand: unique symbol = Symbol("niceeval.judge.provider");

/** An opaque, frozen Judge capability created by a provider factory; plain objects, spread copies and deserialized JSON cannot substitute for it. */
export interface JudgeProvider {
  readonly [judgeProviderBrand]: true;
}

/** Overrides either the model string or the complete Provider; a string preserves the selected Provider's endpoint, credentials and limits. */
export type JudgeSelection = string | JudgeProvider;

/** Selects an inline key or one environment variable, never both; environment credentials are resolved only when a request is needed. */
export type JudgeCredentials =
  | { readonly apiKey?: never; readonly apiKeyEnv?: string }
  | { readonly apiKey: string; readonly apiKeyEnv?: never };

/** Selects the Judge model, endpoint and bounded execution settings; timeoutMs is in milliseconds and maxResponseBytes caps bytes before JSON parsing. */
export interface JudgeProviderSettings {
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly headers?: Readonly<Record<string, string>>;
}

/** Configures a managed Chat Completions Judge; image support requires explicit opt-in and a model that supports images and forced tool output. */
export type ChatJudgeProviderOptions = JudgeProviderSettings & JudgeCredentials & {
  readonly maxOutputTokens?: number;
  /** Context tokens for pi coding-agent sessions; omitted values use the built-in model catalog. */
  readonly contextWindow?: number;
  readonly supportsImages?: boolean;
};

/** Configures TypeSafe System One credentials and execution limits; maxOutputTokens is not supported by this protocol. */
export type TypesafeProviderOptions = JudgeProviderSettings & JudgeCredentials;

/** Describes the selected Judge protocol and execution settings without secret key values; credential selectors identify a source rather than exposing credentials. */
export interface JudgeProviderIdentity {
  readonly provider: "openai" | "vercel" | "openrouter" | "typesafe";
  readonly model: string;
  readonly baseUrl: string;
  readonly credential:
    | { readonly kind: "inline" }
    | { readonly kind: "environment"; readonly name: string };
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  readonly supportsImages?: boolean;
  readonly contextWindow?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly protocol:
    | { readonly kind: "chat-completions"; readonly revision: 1; readonly maxOutputTokens: number }
    | { readonly kind: "typesafe-system-one"; readonly revision: 1 };
}

interface ProviderPrivate {
  readonly identity: JudgeProviderIdentity;
  readonly credential: () => string | undefined;
}

const providerPrivate = new WeakMap<object, ProviderPrivate>();
const resolvedPrivate = new WeakMap<object, ProviderPrivate>();
const utf8 = new TextEncoder();

const defaults = {
  openai: { baseUrl: "https://api.openai.com/v1", apiKeyEnv: "OPENAI_API_KEY" },
  vercel: { baseUrl: "https://ai-gateway.vercel.sh/v1", apiKeyEnv: "AI_GATEWAY_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
  typesafe: { baseUrl: "https://api.typesafe.ai/v1", apiKeyEnv: "TYPESAFE_API_KEY" },
} as const;

function exactOptions(value: unknown, label: string, allowed: readonly string[]): Readonly<Record<string, unknown>> {
  if (!Predicate.isObject(value) || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const captured: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.includes(key)) throw new TypeError(`${label} has unknown option ${String(key)}`);
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    captured[key] = descriptor.value;
  }
  return Object.freeze(captured);
}

function boundedText(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.trim() === "" || utf8.encode(value).byteLength > maximumBytes || /\p{Cc}/u.test(value)) {
    throw new TypeError(`${label} must be non-empty, control-free, and at most ${maximumBytes} UTF-8 bytes`);
  }
  return value;
}

function positiveInteger(value: unknown, fallback: number, label: string, maximum: number): number {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate <= 0 || candidate > maximum) {
    throw new TypeError(`${label} must be a positive safe integer at most ${maximum}`);
  }
  return candidate;
}

function normalizedBaseUrl(value: unknown, fallback: string, label: string): string {
  const candidate = value === undefined ? fallback : boundedText(value, label, 8 * 1024);
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new TypeError(`${label} must be an absolute http(s) URL without userinfo, query, or fragment`);
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw new TypeError(`${label} must be an absolute http(s) URL without userinfo, query, or fragment`);
  }
  const pathname = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${pathname}`;
}

function environmentName(value: unknown, fallback: string, label: string): string {
  const candidate = value === undefined ? fallback : boundedText(value, label, 8 * 1024);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(candidate)) throw new TypeError(`${label} must be an environment variable name`);
  return candidate;
}

function normalizeHeaders(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!Predicate.isObject(value) || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const headers: Record<string, string> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError(`${label} keys must be strings`);
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      throw new TypeError(`${label}.${key} must be an enumerable data property`);
    }
    const val = descriptor.value;
    if (key.trim() === "" || /\p{Cc}/u.test(key)) {
      throw new TypeError(`${label} keys must be non-empty and control-free`);
    }
    if (typeof val !== "string" || val.trim() === "" || /\p{Cc}/u.test(val)) {
      throw new TypeError(`${label}.${key} must be a non-empty and control-free string`);
    }
    headers[key] = val;
  }
  return headers;
}

function freezeIdentity(identity: JudgeProviderIdentity): JudgeProviderIdentity {
  return Object.freeze({
    ...identity,
    credential: Object.freeze({ ...identity.credential }),
    protocol: Object.freeze({ ...identity.protocol }),
    ...(identity.headers !== undefined ? { headers: Object.freeze({ ...identity.headers }) } : {}),
  });
}

function createProvider(
  provider: JudgeProviderIdentity["provider"],
  raw: unknown,
  protocolKind: "chat-completions" | "typesafe-system-one",
): JudgeProvider {
  const label = `${provider === "typesafe" ? "Typesafe" : provider === "openai" ? "OpenAI" : provider === "openrouter" ? "OpenRouter" : "Vercel"}Provider() options`;
  const allowed = protocolKind === "chat-completions"
    ? ["model", "baseUrl", "apiKey", "apiKeyEnv", "timeoutMs", "maxResponseBytes", "maxOutputTokens", "contextWindow", "supportsImages", "headers"]
    : ["model", "baseUrl", "apiKey", "apiKeyEnv", "timeoutMs", "maxResponseBytes", "headers"];
  const input = exactOptions(raw, label, allowed);
  const model = boundedText(input.model, `${label}.model`, 8 * 1024);
  const baseUrl = normalizedBaseUrl(input.baseUrl, defaults[provider].baseUrl, `${label}.baseUrl`);
  const timeoutMs = positiveInteger(input.timeoutMs, 180_000, `${label}.timeoutMs`, Number.MAX_SAFE_INTEGER);
  const maxResponseBytes = positiveInteger(input.maxResponseBytes, 16_384, `${label}.maxResponseBytes`, 256 * 1024);
  if (input.supportsImages !== undefined && typeof input.supportsImages !== "boolean") throw new TypeError(`${label}.supportsImages must be boolean`);
  if (input.apiKey !== undefined && input.apiKeyEnv !== undefined) throw new TypeError(`${label}.apiKey and apiKeyEnv are mutually exclusive`);

  const parsedHeaders = normalizeHeaders(input.headers, `${label}.headers`);
  const effectiveHeaders: Record<string, string> = { ...(parsedHeaders ?? {}) };
  const cfId = process.env.CF_ACCESS_CLIENT_ID;
  const cfSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (cfId && cfSecret) {
    const hasClientId = Object.keys(effectiveHeaders).some((k) => k.toLowerCase() === "cf-access-client-id");
    const hasClientSecret = Object.keys(effectiveHeaders).some((k) => k.toLowerCase() === "cf-access-client-secret");
    if (!hasClientId) effectiveHeaders["CF-Access-Client-Id"] = cfId;
    if (!hasClientSecret) effectiveHeaders["CF-Access-Client-Secret"] = cfSecret;
  }
  const headers = Object.keys(effectiveHeaders).length > 0 ? Object.freeze(effectiveHeaders) : undefined;

  let credential: JudgeProviderIdentity["credential"];
  let resolveCredential: () => string | undefined;
  if (input.apiKey !== undefined) {
    if (typeof input.apiKey !== "string" || input.apiKey.length === 0) throw new TypeError(`${label}.apiKey must be a non-empty string`);
    const apiKey = input.apiKey;
    credential = Object.freeze({ kind: "inline" as const });
    resolveCredential = () => apiKey;
  } else {
    const name = environmentName(input.apiKeyEnv, defaults[provider].apiKeyEnv, `${label}.apiKeyEnv`);
    credential = Object.freeze({ kind: "environment" as const, name });
    resolveCredential = () => process.env[name];
  }

  const protocol = protocolKind === "chat-completions"
    ? Object.freeze({
        kind: "chat-completions" as const,
        revision: 1 as const,
        maxOutputTokens: positiveInteger(input.maxOutputTokens, 1_024, `${label}.maxOutputTokens`, Number.MAX_SAFE_INTEGER),
      })
    : Object.freeze({ kind: "typesafe-system-one" as const, revision: 1 as const });
  const identity = freezeIdentity({
    provider,
    model,
    baseUrl,
    credential,
    timeoutMs,
    maxResponseBytes,
    protocol,
    ...(headers !== undefined ? { headers } : {}),
    ...(input.contextWindow === undefined ? {} : { contextWindow: positiveInteger(input.contextWindow, 1, `${label}.contextWindow`, Number.MAX_SAFE_INTEGER) }),
    ...(input.supportsImages === true ? { supportsImages: true } : {}),
  });
  const value = Object.create(null) as Record<PropertyKey, unknown>;
  Object.defineProperty(value, judgeProviderBrand, { value: true, enumerable: false, writable: false, configurable: false });
  const frozen = Object.freeze(value) as unknown as JudgeProvider;
  providerPrivate.set(frozen, Object.freeze({ identity, credential: resolveCredential }));
  return frozen;
}

/** Constructs a managed OpenAI Chat Completions Judge without making a request. Credentials default to OPENAI_API_KEY and are read at call time. */
export function OpenAIProvider(options: ChatJudgeProviderOptions): JudgeProvider {
  return createProvider("openai", options, "chat-completions");
}

/** Constructs a Judge using Vercel AI Gateway without making a request. This selects the Gateway protocol, not a Vercel Sandbox or an AI SDK model object. */
export function VercelProvider(options: ChatJudgeProviderOptions): JudgeProvider {
  return createProvider("vercel", options, "chat-completions");
}

/** Constructs a managed OpenRouter Judge without making a request. Credentials default to OPENROUTER_API_KEY; model availability is checked by actual calls. */
export function OpenRouterProvider(options: ChatJudgeProviderOptions): JudgeProvider {
  return createProvider("openrouter", options, "chat-completions");
}

/** Constructs a TypeSafe System One Judge without making a request. Extraction and more than ten scoring anchors are unavailable rather than emulated. */
export function TypesafeProvider(options: TypesafeProviderOptions): JudgeProvider {
  return createProvider("typesafe", options, "typesafe-system-one");
}

/** @internal Nominal runtime guard; structurally similar objects are not Providers. */
export function isJudgeProvider(value: unknown): value is JudgeProvider {
  return Predicate.isObject(value) && providerPrivate.has(value);
}

/** @internal Creates the credential-free execution projection while retaining the private credential resolver. */
export function resolveJudgeProvider(provider: JudgeProvider, model?: string): JudgeProviderIdentity {
  const data = providerPrivate.get(provider as object);
  if (data === undefined) throw new TypeError("Judge Provider must be created by niceeval/judge");
  const resolved = freezeIdentity({
    ...data.identity,
    ...(model === undefined ? {} : { model: boundedText(model, "Judge model override", 8 * 1024) }),
  });
  resolvedPrivate.set(resolved, data);
  return resolved;
}

/** @internal Resolves a credential only immediately before an admitted network call. */
export function resolveJudgeCredential(identity: JudgeProviderIdentity): string | undefined {
  return resolvedPrivate.get(identity as object)?.credential();
}
