// cases: docs/engineering/testing/unit/assertions.md
import { describe, expect, it } from "vitest";
import { Schema } from "effect";
import type { Usage } from "../types.ts";
import type { AdapterUsageCall, ReadableAdapterUsageAttachment } from "../record/family/adapter-usage/schema.ts";
import { CanonicalDecimalSchema, CurrencyCodeSchema } from "../record/family/source-receipt/codec.ts";
import { createAdapterCallPriceReceipts } from "./adapter-call-price.ts";
import { projectAdapterEvalUsage, projectAgentEvalUsage, type AgentUsageContribution } from "./eval-usage.ts";

function contribution(usage: (Usage & { inputTotalTokens?: number }) | null, fields: Partial<AgentUsageContribution> = {}): AgentUsageContribution {
  return {
    sessionScopeId: "session-a", turnId: "turn-a", sendAttempt: 0,
    state: "terminal", outcome: "completed", model: "provider/model", usage,
    coverage: { status: "complete" }, ...fields,
  };
}
function call(fields: Partial<AdapterUsageCall> = {}): AdapterUsageCall {
  return {
    callId: "call-a", retryOf: null, modelSlot: null, provider: "provider", model: "provider/model", status: "succeeded",
    inputTokens: 10, inputTotalTokens: null, cacheReadTokens: 3, cacheWriteTokens: 2, outputTokens: 5,
    route: { transportProvider: null, endpointId: null }, cost: null, ...fields,
  };
}
function adapter(calls: readonly AdapterUsageCall[]): ReadableAdapterUsageAttachment {
  return { collection: { state: "complete", limitations: [] }, calls, priceReceipts: [] };
}
function reportedCost(amount: string, currency: string): NonNullable<AdapterUsageCall["cost"]> {
  return {
    amount: Schema.decodeUnknownSync(CanonicalDecimalSchema)(amount),
    currency: Schema.decodeUnknownSync(CurrencyCodeSchema)(currency),
    source: { kind: "reported", id: "invoice" },
  };
}

describe("Official usage evidence and decimal arithmetic", () => {
  it("uses an independent input total or the three exclusive buckets without counting reasoning again", () => {
    const withTotal = contribution({ inputTokens: 10, inputTotalTokens: 15, outputTokens: 5, reasoningTokens: 4 });
    const buckets = contribution({ inputTokens: 10, cacheReadTokens: 3, cacheCreationTokens: 2, outputTokens: 5, reasoningTokens: 4 });
    const agent = projectAgentEvalUsage({ contributions: [withTotal, buckets], scope: "turn" });
    expect(agent.inputTotalTokens).toMatchObject({ state: "exact", value: 30 });
    expect(agent.totalTokens).toMatchObject({ state: "exact", value: 40 });
    const application = projectAdapterEvalUsage(adapter([call(), call({ callId: "call-b", inputTotalTokens: 15, cacheReadTokens: null, cacheWriteTokens: null })]));
    expect(application.inputTotalTokens).toMatchObject({ state: "exact", value: 30 });
    expect(application.totalTokens).toMatchObject({ state: "exact", value: 40 });
  });

  it("retains missing, pending and partial evidence as bounds while preserving failed and retry contributions", () => {
    const failed = contribution({ inputTokens: 10, outputTokens: 5 }, { outcome: "failed" });
    const partial = contribution({ inputTokens: 2, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }, {
      sendAttempt: 1, coverage: { status: "partial", reason: "provider-limited" },
    });
    const pending = contribution(null, { sendAttempt: 2, state: "pending", outcome: null });
    const agent = projectAgentEvalUsage({ contributions: [failed, partial, pending], scope: "turn" });
    expect(agent.inputTokens).toMatchObject({ state: "lower-bound", value: 12 });
    expect(agent.inputTotalTokens).toMatchObject({ state: "lower-bound", value: 12 });
    expect(agent.totalTokens).toMatchObject({ state: "lower-bound", value: 18 });
    expect(agent.costs.totalContributions).toBe(3);
    const application = projectAdapterEvalUsage(adapter([call({ cacheWriteTokens: null })]));
    expect(application.inputTotalTokens).toMatchObject({ state: "lower-bound", value: 13 });
    expect(application.totalTokens).toMatchObject({ state: "lower-bound", value: 18 });
  });

  it("distinguishes observed zero from absence and rejects invalid or overflowing tokens", () => {
    expect(projectAgentEvalUsage({ contributions: [], scope: "attempt" }).totalTokens.state).toBe("unavailable");
    expect(projectAgentEvalUsage({ contributions: [contribution({})], scope: "attempt" }).inputTokens.state).toBe("unavailable");
    expect(projectAgentEvalUsage({ contributions: [contribution({ inputTokens: 0 })], scope: "attempt" }).inputTokens)
      .toMatchObject({ state: "exact", value: 0 });
    expect(projectAgentEvalUsage({ contributions: [contribution({ inputTokens: -1 })], scope: "attempt" }).inputTokens)
      .toMatchObject({ state: "unavailable", reason: "usage-invalid-token-value" });
    expect(projectAdapterEvalUsage(adapter([call({ inputTokens: -1 })])).inputTotalTokens)
      .toMatchObject({ state: "unavailable", reason: "usage-invalid-token-value" });
    expect(projectAgentEvalUsage({ contributions: [contribution({ inputTokens: Number.MAX_SAFE_INTEGER }), contribution({ inputTokens: 1 })], scope: "attempt" }).inputTokens)
      .toMatchObject({ state: "unavailable", reason: "usage-exceeds-safe-integer" });
  });

  it("normalizes each reported amount before summing and gives reported zero priority", () => {
    const usage = projectAgentEvalUsage({
      contributions: [contribution({ costUSD: 0.1 }), contribution({ costUSD: 0.2 }), contribution({ costUSD: 1e-7 }), contribution({ costUSD: 0, inputTokens: 100 })],
      scope: "attempt", pricing: { "provider/model": { inputPerMTok: 99, outputPerMTok: 99 } },
    });
    expect(usage.costs).toEqual({ state: "complete", totalContributions: 4, values: [{
      currency: "USD", value: "0.3000001", source: "reported", coveredContributions: 4,
      reportedContributions: 4, estimatedContributions: 0,
    }] });
  });

  it("estimates only explicit exact or provider wildcard prices and preserves unknown cache buckets", () => {
    const known = contribution({ inputTokens: 3, outputTokens: 7, cacheReadTokens: 2, cacheCreationTokens: 0 });
    const pricing = {
      "provider/model": { inputPerMTok: 0.1, outputPerMTok: 0.2, cacheReadPerMTok: 0.05 },
      "provider/*": { inputPerMTok: 100, outputPerMTok: 100, cacheReadPerMTok: 100 },
    };
    const exact = projectAgentEvalUsage({ contributions: [known], scope: "session", pricing });
    expect(exact.costs).toMatchObject({ state: "complete", values: [{ value: "0.0000018", coveredContributions: 1, estimatedContributions: 1 }] });
    const wildcard = projectAgentEvalUsage({ contributions: [contribution(known.usage, { model: "provider/other" })], scope: "session", pricing });
    expect(wildcard.costs.values[0]?.value).toBe("0.0012");
    const partial = projectAgentEvalUsage({ contributions: [contribution({ inputTokens: 3, outputTokens: 7 })], scope: "session", pricing });
    expect(partial.costs).toMatchObject({ state: "partial", values: [{ value: "0.0000017", coveredContributions: 0 }] });
    const missingRate = projectAgentEvalUsage({ contributions: [known], scope: "session", pricing: { "provider/model": { inputPerMTok: 0.1, outputPerMTok: 0.2 } } });
    expect(missingRate.costs).toMatchObject({ state: "partial", values: [{ value: "0.0000017" }] });
    expect(projectAgentEvalUsage({ contributions: [known], scope: "session" }).costs.state).toBe("unavailable");
  });

  it("keeps partial coverage and pending contributions from completing known costs", () => {
    const usage = projectAgentEvalUsage({ contributions: [
      contribution({ costUSD: 0 }, { coverage: { status: "partial", reason: "missing-internal-send" } }),
      contribution(null, { state: "pending", outcome: null }),
    ], scope: "attempt" });
    expect(usage.costs).toMatchObject({ state: "partial", totalContributions: 2,
      values: [{ value: "0", coveredContributions: 0, reportedContributions: 1 }] });
  });

  it("reuses Adapter receipts and keeps per-currency contribution metadata", () => {
    const calls = [
      call({ cost: reportedCost("0", "USD") }),
      call({ callId: "call-b", cost: reportedCost("0.25", "EUR") }),
      call({ callId: "call-c" }),
    ];
    const usage = projectAdapterEvalUsage({ ...adapter(calls), priceReceipts: createAdapterCallPriceReceipts(calls, {
      "provider/model": { inputPerMTok: 1, outputPerMTok: 2, cacheReadPerMTok: 3, cacheWritePerMTok: 4 },
    }) });
    expect(usage.costs).toEqual({ state: "complete", totalContributions: 3, values: [
      { currency: "EUR", value: "0.25", source: "reported", coveredContributions: 1, reportedContributions: 1, estimatedContributions: 0 },
      { currency: "USD", value: "0.000037", source: "mixed", coveredContributions: 2, reportedContributions: 1, estimatedContributions: 1 },
    ] });
  });

  it("freezes nested projected values and does not retain mutable source amounts", () => {
    const source = { inputTokens: 10, costUSD: 0.1 };
    const usage = projectAgentEvalUsage({ contributions: [contribution(source)], scope: "turn" });
    source.inputTokens = 20;
    source.costUSD = 0.2;
    expect(usage.inputTokens).toMatchObject({ value: 10 });
    expect(usage.costs.values[0]?.value).toBe("0.1");
    for (const value of [usage, usage.inputTokens, usage.inputTokens.provenance, usage.costs, usage.costs.values, usage.costs.values[0]]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });
});
