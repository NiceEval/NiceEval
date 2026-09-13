// owner: docs/engineering/testing/unit/assertions.md#证明范围规范
// cases: docs/engineering/testing/unit/assertions.md

import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { pollFiber, runWithTestClock, TestClock, withRandomFixed } from "../test-support/effect-v4.ts";
import { defineJudge, evaluateJudgeMeasurement, judge, judgeDefinitionOwnsCheck, readJudgeResponseCapped, renderJudgeCheck, turnJudgeMaterial } from "./judge.ts";
import { defineEval } from "../define.ts";
import type { JudgeRecipeExecution } from "./judge.ts";

const TEST_KEY_ENV = "NICEEVAL_JUDGE_TEST_KEY";

function judgeInput(
  timeoutMs: number,
  signal?: AbortSignal,
): JudgeRecipeExecution {
  const definition = defineJudge({
    recipes: [{
      identity: "niceeval.test.runtime/v1",
      slots: [
        { name: "task", role: "task", accepts: ["turn-input"], maxBytes: 1024 },
        { name: "reply", role: "candidate", accepts: ["turn-reply"], maxBytes: 1024 },
        { name: "criterion", role: "definition-reference", accepts: ["reference-text"], maxBytes: 1024 },
      ],
      rubric: "Decide whether the candidate satisfies the criterion.",
      anchors: [{ measurement: 0, description: "no" }, { measurement: 1, description: "yes" }],
      maxRenderedBytes: 4096,
    }],
    material: { criterion: judge.referenceText({ name: "criterion", text: "The answer is correct" }) },
  });
  const turn = turnJudgeMaterial("question", "answer");
  const check = judge.check({ recipe: definition.recipes[0]!, material: { task: turn.input, reply: turn.reply, criterion: definition.material.criterion } });
  return {
    judge: {
      model: "judge-model",
      baseUrl: "https://judge.example/v1",
      apiKeyEnv: TEST_KEY_ENV,
      timeoutMs,
      maxOutputTokens: 128,
    },
    request: renderJudgeCheck(check),
    ...(signal === undefined ? {} : { signal }),
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
    const delivered = (result as unknown as { readonly detail?: { readonly detail?: { readonly state: string; readonly value?: string } } }).detail?.detail;
    if (result.state !== "measured" || delivered?.state !== "available" || delivered.value === undefined) {
      throw new Error("expected the successful invocation to retain its delivered manifest");
    }
    const materialManifest = JSON.parse(delivered.value);
    expect(materialManifest.materialBindingManifest).toMatchObject({
      schemaVersion: 1,
      recipeIdentity: "niceeval.test.runtime/v1",
      renderingProtocol: "niceeval.llm-judge-render/v1",
      renderedBytes: expect.any(Number),
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
    expect(request.messages[1].content).toBe('{"slots":[{"name":"task","role":"task","text":"question"},{"name":"reply","role":"candidate","text":"answer"},{"name":"criterion","role":"definition-reference","text":"The answer is correct"}]}');
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

describe("Judge recipe V1 declaration", () => {
  const recipe = {
    identity: "niceeval.test.answer-quality/v1",
    slots: [
      { name: "task", role: "task", accepts: ["turn-input"], maxBytes: 1024 },
      { name: "reply", role: "candidate", accepts: ["turn-reply"], maxBytes: 1024 },
      { name: "criterion", role: "definition-reference", accepts: ["reference-text"], maxBytes: 1024 },
    ],
    rubric: "Score answer quality.",
    anchors: [{ measurement: 0, description: "wrong" }, { measurement: 1, description: "right" }],
    maxRenderedBytes: 2048,
  } as const;

  test("binds only definition-owned reference text with the exact named slots", () => {
    const judging = defineJudge({
      recipes: [recipe],
      material: { criterion: judge.referenceText({ name: "criterion", text: "be correct" }) },
    });
    const turn = turnJudgeMaterial("question", "answer");
    expect(judge.check({ recipe: judging.recipes[0]!, material: {
      task: turn.input, reply: turn.reply, criterion: judging.material.criterion,
    } })).toMatchObject({ recipe: { identity: recipe.identity } });
    expect(() => judge.check({ recipe: judging.recipes[0]!, material: {
      task: { kind: "turn-input" } as never,
      reply: { kind: "turn-reply" } as never,
      criterion: judging.material.criterion,
    } })).toThrow("wrong kind or owner");
    expect(() => judge.check({ recipe: judging.recipes[0]!, material: {
      task: judging.material.criterion, reply: judging.material.criterion, criterion: judging.material.criterion,
    } })).toThrow("wrong kind or owner");
  });

  test("rejects a definition reference or execution view owned by another declaration or Turn", () => {
    const one = defineJudge({ recipes: [recipe], material: { criterion: judge.referenceText({ name: "one", text: "one" }) } });
    const two = defineJudge({ recipes: [recipe], material: { criterion: judge.referenceText({ name: "two", text: "two" }) } });
    const first = turnJudgeMaterial("first task", "first reply");
    const second = turnJudgeMaterial("second task", "second reply");
    expect(() => judge.check({ recipe: one.recipes[0]!, material: {
      task: first.input, reply: first.reply, criterion: two.material.criterion,
    } })).toThrow("wrong kind or owner");
    expect(() => judge.check({ recipe: one.recipes[0]!, material: {
      task: first.input, reply: second.reply, criterion: one.material.criterion,
    } })).toThrow("one Turn");
  });

  test("does not execute a Check under another Eval declaration", () => {
    const one = defineJudge({ recipes: [recipe], material: { criterion: judge.referenceText({ name: "one", text: "one" }) } });
    const two = defineJudge({ recipes: [recipe], material: { criterion: judge.referenceText({ name: "two", text: "two" }) } });
    const turn = turnJudgeMaterial("task", "reply");
    const check = judge.check({ recipe: one.recipes[0]!, material: {
      task: turn.input, reply: turn.reply, criterion: one.material.criterion,
    } });
    expect(judgeDefinitionOwnsCheck(one, check)).toBe(true);
    expect(judgeDefinitionOwnsCheck(two, check)).toBe(false);
  });

  test("scopes identity digest conflicts to one definition, not the process", () => {
    const changed = { ...recipe, rubric: "different rubric" };
    expect(() => defineJudge({
      recipes: [recipe, changed],
      material: { criterion: judge.referenceText({ name: "criterion", text: "same" }) },
    })).toThrow("identity digest conflict");
    expect(() => defineJudge({
      recipes: [changed],
      material: { criterion: judge.referenceText({ name: "criterion", text: "same" }) },
    })).not.toThrow();
  });

  test("rejects a recipe whose anchors omit a decision endpoint", () => {
    expect(() => defineJudge({
      recipes: [{ ...recipe, identity: "niceeval.test.invalid-anchor/v1", anchors: [{ measurement: 0, description: "wrong" }] }],
      material: { criterion: judge.referenceText({ name: "criterion", text: "be correct" }) },
    })).toThrow("include 0 and 1");
  });

  test("closes the Eval capability to defineJudge output before discovery", () => {
    expect(() => defineEval({ judge: { recipes: [], material: {} } as never, test: () => undefined })).toThrow(
      "defineEval() judge must be a value returned by defineJudge()",
    );
  });
});

describe("Judge transport boundary", () => {
  test("rejects a response at the byte boundary before decoding", async () => {
    const response = new Response("x".repeat(33), { status: 200 });
    await expect(readJudgeResponseCapped(response, 32).then((bounded) => bounded.text())).rejects.toThrow("byte cap");
  });
});
