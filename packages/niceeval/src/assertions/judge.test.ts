// owner: docs/engineering/testing/unit/assertions.md#证明范围规范
// cases: docs/engineering/testing/unit/assertions.md

import { Cause, Effect, Exit, Fiber, Option, TestClock, TestContext } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { evaluateJudgeMeasurement } from "./judge.ts";
import type { JudgeRecipeExecution } from "./judge.ts";

const TEST_KEY_ENV = "NICEEVAL_JUDGE_TEST_KEY";

function judgeInput(timeoutMs: number, signal?: AbortSignal): JudgeRecipeExecution {
  return {
    judge: {
      model: "judge-model",
      baseUrl: "https://judge.example/v1",
      apiKeyEnv: TEST_KEY_ENV,
      timeoutMs,
    },
    recipe: "closedQA",
    reference: "The answer is correct",
    material: { input: "question", output: "answer" },
    ...(signal === undefined ? {} : { signal }),
  };
}

function acceptedResponse(): Response {
  return new Response(JSON.stringify({
    id: "completion-1",
    object: "chat.completion",
    created: 0,
    model: "judge-model",
    choices: [{
      index: 0,
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{
          id: "call-1",
          type: "function",
          function: {
            name: "select_choice",
            arguments: JSON.stringify({ choice: "Y", reasons: "correct" }),
          },
        }],
      },
    }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function transientResponse(retryAfter?: string): Response {
  return new Response(JSON.stringify({ error: { message: "busy", type: "server_error" } }), {
    status: 503,
    headers: {
      "Content-Type": "application/json",
      ...(retryAfter === undefined ? {} : { "Retry-After": retryAfter }),
    },
  });
}

function waitUntil(predicate: () => boolean, description: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      if (predicate()) return;
      yield* Effect.yieldNow();
    }
    return yield* Effect.dieMessage(`timed out waiting for ${description}`);
  });
}

function waitForSleep(instant: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      const sleeps = yield* TestClock.sleeps();
      if (Array.from(sleeps).includes(instant)) return;
      yield* Effect.yieldNow();
    }
    return yield* Effect.dieMessage(`timed out waiting for clock sleep at ${instant}`);
  });
}

function runTestClock<A>(effect: Effect.Effect<A, never, never>): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(TestContext.TestContext)));
}

describe("Judge virtual-time lifecycle", () => {
  beforeEach(() => {
    process.env[TEST_KEY_ENV] = "test-key";
  });

  afterEach(() => {
    delete process.env[TEST_KEY_ENV];
    vi.unstubAllGlobals();
  });

  test("timeout stays pending before its boundary, then interrupts the provider request", async () => {
    let providerAborted = false;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal == null) throw new Error("Judge fetch did not receive an AbortSignal");
        signal.addEventListener("abort", () => {
          providerAborted = true;
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }));
    vi.stubGlobal("fetch", fetchMock);

    await runTestClock(Effect.gen(function* () {
      const fiber = yield* Effect.fork(evaluateJudgeMeasurement(judgeInput(5_000)));
      yield* waitUntil(() => fetchMock.mock.calls.length === 1, "the provider request");

      yield* TestClock.adjust(4_999);
      expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);
      expect(providerAborted).toBe(false);

      yield* TestClock.adjust(1);
      const result = yield* Fiber.join(fiber);
      expect(result).toMatchObject({
        state: "unavailable",
        reason: "source-unavailable",
        detail: {
          failureDetail: "judge-call-failed",
          failureEvidence: expect.stringContaining("timed out after 5s"),
        },
      });
      expect(providerAborted).toBe(true);
    }));
  });

  test("randomized retry starts only when its backoff boundary arrives", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(transientResponse())
      .mockResolvedValueOnce(acceptedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await runTestClock(Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        evaluateJudgeMeasurement(judgeInput(5_000)).pipe(Effect.withRandomFixed([0.5])),
      );
      yield* waitForSleep(500);

      yield* TestClock.adjust(499);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(Option.isNone(yield* Fiber.poll(fiber))).toBe(true);

      yield* TestClock.adjust(1);
      yield* waitUntil(() => fetchMock.mock.calls.length === 2, "the retry request");
      expect(yield* Fiber.join(fiber)).toMatchObject({ state: "measured", value: 1 });
    }));
  });

  test("HTTP-date Retry-After is measured from the Effect clock and gates the retry", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(transientResponse("Thu, 01 Jan 1970 00:00:02 GMT"))
      .mockResolvedValueOnce(acceptedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await runTestClock(Effect.gen(function* () {
      const fiber = yield* Effect.fork(evaluateJudgeMeasurement(judgeInput(5_000)));
      yield* waitForSleep(2_000);

      yield* TestClock.adjust(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      yield* TestClock.adjust(1);
      yield* waitUntil(() => fetchMock.mock.calls.length === 2, "the Retry-After request");
      expect(yield* Fiber.join(fiber)).toMatchObject({ state: "measured", value: 1 });
    }));
  });

  test("caller cancellation interrupts the provider instead of becoming a Judge result", async () => {
    const controller = new AbortController();
    let providerAborted = false;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal == null) throw new Error("Judge fetch did not receive an AbortSignal");
        signal.addEventListener("abort", () => {
          providerAborted = true;
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        }, { once: true });
      }));
    vi.stubGlobal("fetch", fetchMock);

    await runTestClock(Effect.gen(function* () {
      const fiber = yield* Effect.fork(evaluateJudgeMeasurement(judgeInput(5_000, controller.signal)));
      yield* waitUntil(() => fetchMock.mock.calls.length === 1, "the cancellable provider request");
      controller.abort();

      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.isInterruptedOnly(exit.cause)).toBe(true);
      expect(providerAborted).toBe(true);
    }));
  });
});
