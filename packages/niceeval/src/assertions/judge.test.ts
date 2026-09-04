// owner: docs/engineering/testing/unit/assertions.md#证明范围规范
// cases: docs/engineering/testing/unit/assertions.md

import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { pollFiber, runWithTestClock, TestClock, withRandomFixed } from "../test-support/effect-v4.ts";
import { evaluateJudgeMeasurement } from "./judge.ts";
import type { JudgeRecipeExecution } from "./judge.ts";

const TEST_KEY_ENV = "NICEEVAL_JUDGE_TEST_KEY";

function judgeInput(
  timeoutMs: number,
  signal?: AbortSignal,
  overrides: Partial<JudgeRecipeExecution> = {},
): JudgeRecipeExecution {
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
    ...overrides,
  };
}

function acceptedResponse(
  decision: Readonly<Record<string, unknown>> = { measurement: 1, rationale: "correct" },
): Response {
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
            name: "record_judge_decision",
            arguments: JSON.stringify(decision),
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
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`timed out waiting for ${description}`));
  });
}

function waitForSleep(instant: number): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 200; turn++) {
      const sleeps = yield* TestClock.sleeps();
      if (Array.from(sleeps).includes(instant)) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`timed out waiting for clock sleep at ${instant}`));
  });
}

function runTestClock<A>(effect: Effect.Effect<A, never, never>): Promise<A> {
  return runWithTestClock(effect);
}

describe("Judge virtual-time lifecycle", () => {
  beforeEach(() => {
    process.env[TEST_KEY_ENV] = "test-key";
  });

  test("sends the NiceEval decision protocol and decodes its bounded measurement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(acceptedResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(evaluateJudgeMeasurement(judgeInput(5_000)));

    expect(result).toMatchObject({
      state: "measured",
      value: 1,
      detail: {
        rationale: { state: "available", value: "correct" },
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request).toMatchObject({
      model: "judge-model",
      tool_choice: { type: "function", function: { name: "record_judge_decision" } },
      tools: [{
        type: "function",
        function: {
          name: "record_judge_decision",
          parameters: {
            additionalProperties: false,
            required: ["measurement", "rationale"],
          },
        },
      }],
    });
    expect(request.messages[0].content).toContain("niceeval.llm-judge-decision/v1");
    expect(request.messages[1].content).toBe(
      'Untrusted evaluation data (JSON):\n{"task":"question","candidate":"answer"}',
    );
  });

  test.each([
    ["closedQA", "The answer is correct", "satisfies the criterion"],
    ["factuality", "reference answer", "factual consistency"],
    ["summarizes", "source text", "summarizes the source text"],
  ] as const)("renders the native %s recipe", async (recipe, reference, expectedInstruction) => {
    const fetchMock = vi.fn().mockResolvedValue(acceptedResponse());
    vi.stubGlobal("fetch", fetchMock);

    await Effect.runPromise(evaluateJudgeMeasurement(judgeInput(5_000, undefined, { recipe, reference })));

    const request = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(request.messages[0].content).toContain(expectedInstruction);
    const requestText = request.messages.map((message: { readonly content: string }) => message.content).join("\n");
    expect(requestText).toContain(reference);
  });

  test("rejects a decision with fields outside the native protocol", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(acceptedResponse({
      measurement: 1,
      rationale: "correct",
      hiddenReasoning: "must not cross the protocol",
    })));

    await expect(Effect.runPromise(evaluateJudgeMeasurement(judgeInput(5_000)))).resolves.toMatchObject({
      state: "errored",
      detail: { code: "judge-evaluator-error" },
    });
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
      const fiber = yield* Effect.forkChild(evaluateJudgeMeasurement(judgeInput(5_000)));
      yield* waitUntil(() => fetchMock.mock.calls.length === 1, "the provider request");

      yield* TestClock.adjust(4_999);
      expect(Option.isNone(yield* pollFiber(fiber))).toBe(true);
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
      const fiber = yield* Effect.forkChild(
        evaluateJudgeMeasurement(judgeInput(5_000)).pipe(withRandomFixed([0.5])),
      );
      yield* waitForSleep(500);

      yield* TestClock.adjust(499);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(Option.isNone(yield* pollFiber(fiber))).toBe(true);

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
      const fiber = yield* Effect.forkChild(evaluateJudgeMeasurement(judgeInput(5_000)));
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
      const fiber = yield* Effect.forkChild(evaluateJudgeMeasurement(judgeInput(5_000, controller.signal)));
      yield* waitUntil(() => fetchMock.mock.calls.length === 1, "the cancellable provider request");
      controller.abort();

      const exit = yield* Fiber.await(fiber);
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
      expect(providerAborted).toBe(true);
    }));
  });
});
