import type { Usage } from "../../../o11y/types.ts";
import { MAX_CONVERSATION_TURNS, MAX_USAGE_OBSERVATIONS } from "../../../record/family/source-receipt/limits.ts";
import {
  makeCanonicalDecimal,
  makeCurrencyCode,
  makeNonNegativeSafeInteger,
  makeSafeIdentifier,
  type NonNegativeSafeInteger,
  type SafeIdentifier,
  type TurnId,
  type UsageObservationId,
} from "../../../record/family/source-receipt/model.ts";
import type { UsageObservation } from "../model.ts";
import {
  mintRuntimeEntity,
  runtimeState,
  type RunnerAttemptObservabilityRuntime,
  type RunnerAttemptObservabilityRuntimeState,
} from "./state.ts";

function usageNonNegativeInteger(value: unknown): NonNegativeSafeInteger | undefined {
  return typeof value === "number" ? makeNonNegativeSafeInteger(value) : undefined;
}

function canonicalDecimalFromNumber(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return undefined;
  const source = String(value);
  const plain = source.includes("e") || source.includes("E")
    ? expandExponentialDecimal(source)
    : source;
  if (plain === undefined) return undefined;
  const normalized = plain.includes(".")
    ? plain.replace(/0+$/u, "").replace(/\.$/u, "")
    : plain;
  return makeCanonicalDecimal(normalized);
}

function expandExponentialDecimal(value: string): string | undefined {
  const match = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/u.exec(value);
  if (match === null) return undefined;
  const integer = match[1] ?? "";
  const fraction = match[2] ?? "";
  const exponent = Number(match[3]);
  if (!Number.isSafeInteger(exponent)) return undefined;
  const digits = `${integer}${fraction}`.replace(/^0+/u, "") || "0";
  if (digits === "0") return "0";
  const decimalIndex = integer.length + exponent;
  if (decimalIndex <= 0) return `0.${"0".repeat(-decimalIndex)}${digits}`;
  if (decimalIndex >= digits.length) return `${digits}${"0".repeat(decimalIndex - digits.length)}`;
  return `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function appendUsageObservation(
  runtime: RunnerAttemptObservabilityRuntimeState,
  turnId: TurnId,
  create: (usageObservationId: UsageObservationId, provider: SafeIdentifier) => UsageObservation,
): void {
  const capturedTurn = runtime.conversationTurns.find((turn) => turn.turnId === turnId);
  if (capturedTurn === undefined) {
    runtime.usageLimitations.addCaptureFailed("usage-capture", "usage-observation");
    return;
  }
  const usageCount = runtime.conversationTurns.reduce((count, turn) => count + turn.usage.length, 0);
  if (usageCount >= MAX_USAGE_OBSERVATIONS) {
    runtime.usageLimitations.addCap("usage-observation", usageCount);
    return;
  }
  const provider = makeSafeIdentifier(runtime.providerName);
  if (provider === undefined) {
    runtime.usageLimitations.addUnsupported("usage-observation");
    return;
  }
  const usageObservationId = mintRuntimeEntity(runtime, "usage-observation");
  if (usageObservationId === undefined) return;
  capturedTurn.usage.push(create(usageObservationId, provider));
}

/**
 * Captures only the exact Usage passed by SessionManager's terminal onTurn
 * callback. It never looks at an Attempt aggregate or derives a request from
 * a token count.
 */
export function captureRunnerTurnUsage(
  runtimeHandle: RunnerAttemptObservabilityRuntime,
  turnId: TurnId,
  usage: Usage,
): void {
  const runtime = runtimeState(runtimeHandle);
  if (runtime === undefined || runtime.failure !== undefined || runtime.snapshot !== undefined) return;
  if (
    runtime.conversationTurns.length >= MAX_CONVERSATION_TURNS &&
    !runtime.conversationTurns.some((turn) => turn.turnId === turnId)
  ) {
    const usageCount = runtime.conversationTurns.reduce((count, turn) => count + turn.usage.length, 0);
    runtime.usageLimitations.addCap("usage-observation", usageCount);
    return;
  }
  const tokenBuckets: readonly [keyof Pick<
    Usage,
    "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens" | "reasoningTokens"
  >, Extract<UsageObservation, { readonly kind: "token-bucket" }>["bucket"]][] = [
    ["inputTokens", "input"],
    ["outputTokens", "output"],
    ["cacheReadTokens", "cache-read"],
    ["cacheCreationTokens", "cache-write"],
    ["reasoningTokens", "reasoning"],
  ];
  for (const [field, bucket] of tokenBuckets) {
    const raw = usage[field];
    if (raw === undefined) continue;
    const tokens = usageNonNegativeInteger(raw);
    if (tokens === undefined) {
      runtime.usageLimitations.addUnsupported("usage-observation");
      continue;
    }
    appendUsageObservation(runtime, turnId, (usageObservationId, provider) => Object.freeze({
      usageObservationId,
      provider,
      kind: "token-bucket" as const,
      bucket,
      tokens,
      refs: Object.freeze([]),
    }));
  }
  if (usage.requests !== undefined) {
    const requests = usageNonNegativeInteger(usage.requests);
    if (requests === undefined) {
      runtime.usageLimitations.addUnsupported("usage-observation");
    } else {
      for (let request = 0; request < requests; request += 1) {
        appendUsageObservation(runtime, turnId, (usageObservationId, provider) => Object.freeze({
          usageObservationId,
          provider,
          kind: "request" as const,
          requestKind: "model" as const,
          refs: Object.freeze([]),
        }));
        const usageCount = runtime.conversationTurns.reduce((count, turn) => count + turn.usage.length, 0);
        if (usageCount >= MAX_USAGE_OBSERVATIONS) break;
      }
    }
  }
  if (usage.costUSD !== undefined) {
    const amount = canonicalDecimalFromNumber(usage.costUSD);
    if (amount === undefined) {
      runtime.usageLimitations.addUnsupported("usage-observation");
    } else {
      const currency = makeCurrencyCode("USD");
      if (currency === undefined) throw new Error("USD must be a CurrencyCode");
      appendUsageObservation(runtime, turnId, (usageObservationId, provider) => Object.freeze({
        usageObservationId,
        provider,
        kind: "provider-cost" as const,
        amount,
        currency,
        refs: Object.freeze([]),
      }));
    }
  }
}
