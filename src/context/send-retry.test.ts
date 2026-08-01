// cases: docs/engineering/testing/unit/eval.md

import { describe, expect, it, vi } from "vitest";
import { makeSendFailure } from "./send-failures.ts";
import {
  ATTEMPT_MAX_RETRIES,
  SEND_MAX_ATTEMPTS,
  createAttemptRetryBudget,
  sendWithTurnRetry,
  type SendRetryDeps,
} from "./send-retry.ts";

function deps(overrides: Partial<SendRetryDeps> = {}): SendRetryDeps {
  return {
    budget: createAttemptRetryBudget(),
    signal: new AbortController().signal,
    random: () => 0,
    sleep: async () => {},
    ...overrides,
  };
}

describe("sendWithTurnRetry · SendFailure acceptance gate", () => {
  it("returns completed, waiting, and failed Turn values without classification or retry", async () => {
    for (const status of ["completed", "waiting", "failed"] as const) {
      const classifier = vi.fn(() => ({ retryable: true as const, reason: "should-not-run" }));
      const call = vi.fn(async () => ({ events: [], status }));
      await expect(sendWithTurnRetry(call, deps({ classifier }))).resolves.toEqual({ events: [], status });
      expect(call).toHaveBeenCalledTimes(1);
      expect(classifier).not.toHaveBeenCalled();
    }
  });

  it("retries only rejected failures and records every absorbed physical attempt", async () => {
    const failure = makeSendFailure({
      acceptance: "rejected",
      message: "structured overload",
      cause: { status: 429 },
      events: [{ type: "error", message: "admission rejected" }],
      usage: { inputTokens: 3 },
      process: { exitCode: 75, stderr: "busy" },
    });
    const call = vi.fn()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce({ events: [], status: "completed" });
    const retries: unknown[] = [];

    await expect(sendWithTurnRetry(call, deps({ onRetryAttempt: (attempt) => retries.push(attempt) })))
      .resolves.toEqual({ events: [], status: "completed" });

    expect(call).toHaveBeenCalledTimes(2);
    expect(retries).toMatchObject([{
      sendAttempt: 0,
      failure: { acceptance: "rejected", usage: { inputTokens: 3 } },
      classification: { retryable: true, reason: "rate_limit" },
    }]);
  });

  it.each(["started", "unknown"] as const)("does not retry acceptance=%s even when a classifier says retryable", async (acceptance) => {
    const failure = makeSendFailure({ acceptance, message: "ACME_QUEUE_FULL" });
    const call = vi.fn(async () => Promise.reject(failure));
    await expect(sendWithTurnRetry(call, deps({ classifier: () => ({ retryable: true, reason: "acme" }) })))
      .rejects.toBe(failure);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("normalizes a generic adapter throw to an unknown SendFailure", async () => {
    const cause = Object.assign(new Error("socket reset after request"), { code: "ECONNRESET" });
    await expect(sendWithTurnRetry(() => Promise.reject(cause), deps())).rejects.toMatchObject({
      type: "agent-send-failed",
      acceptance: "unknown",
      message: "socket reset after request",
      cause,
    });
  });

  it("enforces the four-attempt send cap and appends the exhaustion reason", async () => {
    const call = vi.fn(async () => Promise.reject(makeSendFailure({
      acceptance: "rejected",
      message: "busy",
      cause: { code: "RATE_LIMITED" },
    })));
    await expect(sendWithTurnRetry(call, deps())).rejects.toMatchObject({
      type: "agent-send-failed",
      acceptance: "rejected",
      message: expect.stringMatching(/busy.*rate_limit/s),
    });
    expect(call).toHaveBeenCalledTimes(SEND_MAX_ATTEMPTS);
  });

  it("shares the eight-retry attempt budget and releases the global slot during backoff", async () => {
    const budget = { remaining: 1 };
    const order: string[] = [];
    const slot = {
      release: async () => { order.push("release"); },
      reacquire: async () => { order.push("reacquire"); },
    };
    const failure = () => makeSendFailure({ acceptance: "rejected", message: "429", cause: { status: 429 } });
    const first = vi.fn().mockRejectedValueOnce(failure()).mockResolvedValueOnce("ok");
    await expect(sendWithTurnRetry(first, deps({ budget, slot, sleep: async () => { order.push("sleep"); } })))
      .resolves.toBe("ok");
    expect(order).toEqual(["release", "sleep", "reacquire"]);

    await expect(sendWithTurnRetry(() => Promise.reject(failure()), deps({ budget })))
      .rejects.toMatchObject({ message: expect.stringMatching(new RegExp(String(ATTEMPT_MAX_RETRIES))) });
  });
});
