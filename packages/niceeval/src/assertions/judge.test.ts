// owner: docs/engineering/testing/unit/assertions.md#证明范围规范
// cases: docs/engineering/testing/unit/assertions.md

import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { pollFiber, runWithTestClock, TestClock, withRandomFixed } from "../test-support/effect-v4.ts";
import {
  defineJudge,
  readJudgeResponseCapped,
} from "./judge.ts";

import { defineScoreMatch, managedScoreMatchOf, type ScoreMatchContext } from "./match.ts";
import { prepareManagedScoreMatch } from "./score-match-gateway.ts";
import { readScoreMatchAudit } from "./score-match-audit.ts";
import { OpenAIProvider, resolveJudgeProvider } from "../judge/provider.ts";

const TEST_KEY_ENV = "NICEEVAL_JUDGE_TEST_KEY";

function definition(name = "answer-quality") {
  return defineJudge({
    name,
    rubric: "Decide whether the candidate follows the requested intent.",
    anchors: [
      { measurement: 0, description: "Does not follow the intent." },
      { measurement: 0.5, description: "Follows only part of the intent." },
      { measurement: 1, description: "Fully follows the intent." },
    ],
    maxMaterialBytes: 48 * 1024,
  });
}

function judgeInput(signal?: AbortSignal, timeoutMs = 5_000) {
  const match = definition();
  return prepareManagedScoreMatch({
    match, options: managedScoreMatchOf(match)!,
    material: { question: "question", answer: "answer" },
    judge: testJudge(timeoutMs),
    ...(signal === undefined ? {} : { signal }),
  });
}
function testJudge(timeoutMs = 5_000) {
  return resolveJudgeProvider(OpenAIProvider({ model: "judge-model", baseUrl: "https://judge.example/v1", apiKeyEnv: TEST_KEY_ENV, timeoutMs, maxOutputTokens: 128 }));
}
const evaluateJudgeMeasurement = (input: ReturnType<typeof judgeInput>) => input.evaluate();
function transportOf(input: ReturnType<typeof judgeInput>) {
  const material = input.terminalEvidence()[0]!;
  if (material.kind !== "snapshot") throw new Error("Audit is not a snapshot");
  const decoded = readScoreMatchAudit(material.value);
  if (decoded.state !== "available") throw new Error("Audit is not available");
  return { transport: { state: decoded.audit.calls.some((call) => call.state === "admitted" && call.attempts.length > 0) ? "attempted" : "not-sent" } };
}

function acceptedResponse(
  decision: Readonly<Record<string, unknown>> = { measurement: 0.75, rationale: "sound" },
): Response {
  return new Response(JSON.stringify({
    id: "completion-1", object: "chat.completion", created: 0, model: "judge-model",
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "record_score_match", arguments: JSON.stringify(decision) } }] } }],
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}

function transientResponse(retryAfter?: string): Response {
  return new Response(JSON.stringify({ error: { message: "busy", type: "server_error" } }), {
    status: 503,
    headers: { "Content-Type": "application/json", ...(retryAfter === undefined ? {} : { "Retry-After": retryAfter }) },
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
      if (Array.from(yield* TestClock.sleeps()).includes(instant)) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`timed out waiting for clock sleep at ${instant}`));
  });
}

describe("Judge pure boundaries", () => {
  test("rejects definition shape and anchor boundary violations", () => {
    expect(() => defineJudge({ name: "x", rubric: "r", extra: true } as never)).toThrow("unknown option");
    expect(() => defineJudge({ name: " \t", rubric: "r" })).toThrow("non-empty");
    expect(() => defineJudge(Object.defineProperty({ name: "x", rubric: "r" }, "anchors", { get: () => [] }) as never)).toThrow("data property");
    let customMapCalled = false;
    const anchors = [
      { measurement: 0, description: "no" },
      { measurement: 1, description: "yes" },
    ];
    Object.defineProperty(anchors, "map", { value: () => { customMapCalled = true; return []; } });
    expect(() => defineJudge({ name: "x", rubric: "r", anchors })).toThrow("custom properties");
    expect(customMapCalled).toBe(false);
    const accessorAnchors = [
      { measurement: 0, description: "no" },
      { measurement: 1, description: "yes" },
    ];
    Object.defineProperty(accessorAnchors, "0", { get: () => ({ measurement: 0, description: "no" }) });
    expect(() => defineJudge({ name: "x", rubric: "r", anchors: accessorAnchors })).toThrow("data property");
    expect(() => defineJudge({ name: "x", rubric: "r", anchors: [{ measurement: 0, description: "no" }, { measurement: 0, description: "same" }] })).toThrow("strictly increasing");
    expect(() => defineJudge({ name: "x", rubric: "r", anchors: [{ measurement: 0.1, description: "no" }, { measurement: 1, description: "yes" }] })).toThrow("include 0 and 1");
    expect(() => defineJudge({ name: "x", rubric: "r", maxMaterialBytes: 48 * 1024 + 1 })).toThrow("at most");
  });

});

describe("Judge Effect lifecycle", () => {
  beforeEach(() => { process.env[TEST_KEY_ENV] = "test-key"; });
  afterEach(() => { delete process.env[TEST_KEY_ENV]; vi.unstubAllGlobals(); });

  test("separates rationale from attempted transport state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(acceptedResponse()));
    const input = judgeInput();
    await expect(Effect.runPromise(evaluateJudgeMeasurement(input))).resolves.toMatchObject({ state: "measured", value: 0.75, detail: { rationale: { state: "available", value: "sound" } } });
    expect(transportOf(input)).toEqual({ transport: { state: "attempted" } });
  });

  test("rejects native decision fields outside the strict protocol", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(acceptedResponse({ measurement: 1, rationale: "correct", hiddenReasoning: "private" })));
    await expect(Effect.runPromise(evaluateJudgeMeasurement(judgeInput()))).resolves.toMatchObject({
      state: "errored",
      detail: { code: "score-match-invalid-response" },
    });
  });

  test("timeout stays pending before its boundary, then interrupts the provider request", async () => {
    let providerAborted = false;
    const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal == null) throw new Error("Judge fetch did not receive an AbortSignal");
      signal.addEventListener("abort", () => { providerAborted = true; reject(signal.reason ?? new DOMException("Aborted", "AbortError")); }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    await runWithTestClock(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(evaluateJudgeMeasurement(judgeInput(undefined, 5_000)));
      yield* waitUntil(() => fetchMock.mock.calls.length === 1, "the provider request");
      yield* TestClock.adjust(4_999);
      expect(Option.isNone(yield* pollFiber(fiber))).toBe(true);
      expect(providerAborted).toBe(false);
      yield* TestClock.adjust(1);
      expect(yield* Fiber.join(fiber)).toMatchObject({ state: "unavailable", reason: "source-unavailable", detail: { failureDetail: "judge-call-failed", failureEvidence: expect.stringContaining("timed out") } });
      expect(providerAborted).toBe(true);
    }));
  });

  test("randomized retry starts only at its backoff boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(transientResponse()).mockResolvedValueOnce(acceptedResponse());
    vi.stubGlobal("fetch", fetchMock);
    await runWithTestClock(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(evaluateJudgeMeasurement(judgeInput()).pipe(withRandomFixed([0.5])));
      yield* waitForSleep(500);
      yield* TestClock.adjust(499);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(Option.isNone(yield* pollFiber(fiber))).toBe(true);
      yield* TestClock.adjust(1);
      yield* waitUntil(() => fetchMock.mock.calls.length === 2, "the retry request");
      expect(yield* Fiber.join(fiber)).toMatchObject({ state: "measured", value: 0.75 });
    }));
  });

  test("HTTP-date Retry-After uses the Effect clock and gates retry", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(transientResponse("Thu, 01 Jan 1970 00:00:02 GMT")).mockResolvedValueOnce(acceptedResponse());
    vi.stubGlobal("fetch", fetchMock);
    await runWithTestClock(Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(evaluateJudgeMeasurement(judgeInput()));
      yield* waitForSleep(2_000);
      yield* TestClock.adjust(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      yield* TestClock.adjust(1);
      yield* waitUntil(() => fetchMock.mock.calls.length === 2, "the Retry-After request");
      expect(yield* Fiber.join(fiber)).toMatchObject({ state: "measured", value: 0.75 });
    }));
  });

  test("missing configuration is not-sent while cancellation after fetch remains attempted Interrupt", async () => {
    delete process.env[TEST_KEY_ENV]; const missing = judgeInput(); const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await Effect.runPromise(evaluateJudgeMeasurement(missing));
    expect(transportOf(missing)).toEqual({ transport: { state: "not-sent" } });
    expect(fetchMock).not.toHaveBeenCalled();

    process.env[TEST_KEY_ENV] = "test-key"; const preCancelledController = new AbortController(); preCancelledController.abort();
    const preCancelled = judgeInput(preCancelledController.signal);
    const preCancelledExit = await Effect.runPromiseExit(evaluateJudgeMeasurement(preCancelled));
    expect(Exit.isFailure(preCancelledExit) && Cause.hasInterruptsOnly(preCancelledExit.cause)).toBe(true);
    expect(transportOf(preCancelled)).toEqual({ transport: { state: "not-sent" } });
    expect(fetchMock).not.toHaveBeenCalled();

    const controller = new AbortController(); let started = false;
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { started = true; init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); })));
    const cancelled = judgeInput(controller.signal);
    const exit = await Effect.runPromise(Effect.gen(function* () { const fiber = yield* Effect.forkChild(evaluateJudgeMeasurement(cancelled)); while (!started) yield* Effect.yieldNow; controller.abort(); return yield* Fiber.await(fiber); }));
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(transportOf(cancelled)).toEqual({ transport: { state: "attempted" } });
  });

  test("exhausted call budget stays unavailable after catch and retains the not-sent rejection", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(acceptedResponse()));
    vi.stubGlobal("fetch", fetchMock);
    const match = defineScoreMatch({
      name: "bounded", version: "1", config: {}, llm: { maxCalls: 1 },
      score: (_value: unknown, context) => Effect.gen(function* () {
        const step = { rubric: "quality", anchors: [{ measurement: 0, description: "no" }, { measurement: 1, description: "yes" }], material: null };
        yield* context.llm.score(step);
        return yield* context.llm.score(step).pipe(Effect.as(1), Effect.catch(() => Effect.succeed(1)));
      }),
    });
    const registration = prepareManagedScoreMatch({
      match, options: managedScoreMatchOf(match)!, material: null,
      judge: testJudge(),
    });
    expect(await Effect.runPromise(registration.evaluate())).toMatchObject({ state: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const evidence = registration.terminalEvidence()[0]!;
    if (evidence.kind !== "snapshot") throw new Error("Missing audit");
    const decoded = readScoreMatchAudit(evidence.value);
    expect(decoded.state).toBe("available");
    if (decoded.state !== "available") throw new Error("Invalid audit");
    expect(decoded.audit.calls).toHaveLength(2);
    expect(decoded.audit.calls[1]).toMatchObject({ state: "rejected", transport: "not-sent", failure: { code: "score-match-call-budget" } });
  });

  test("returning with a pending call cancels it before sealing and closes escaped context", async () => {
    let started = false;
    let aborted = false;
    let escaped: ScoreMatchContext | undefined;
    const fetchMock = vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      started = true;
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const match = defineScoreMatch({
      name: "pending", version: "1", config: {}, llm: {},
      score: (_value: unknown, context) => Effect.gen(function* () {
        escaped = context;
        yield* Effect.forkChild(context.llm.classify({ rubric: "quality", choices: ["yes", "no"], material: null }));
        yield* waitUntil(() => started, "pending model call");
        return 1;
      }),
    });
    const registration = prepareManagedScoreMatch({
      match, options: managedScoreMatchOf(match)!, material: null,
      judge: testJudge(),
    });
    expect(await Effect.runPromise(registration.evaluate())).toMatchObject({ state: "errored", detail: { code: "score-match-pending-call" } });
    expect(aborted).toBe(true);
    const before = JSON.stringify(registration.terminalEvidence());
    const exit = await Effect.runPromiseExit(escaped!.llm.classify({ rubric: "late", choices: ["yes", "no"], material: null }));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(registration.terminalEvidence())).toBe(before);
  });

  test("explicitly interrupting a model step cannot turn an incomplete evaluation into full credit", async () => {
    let started = false;
    vi.stubGlobal("fetch", vi.fn((_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      started = true;
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const match = defineScoreMatch({
      name: "interrupted-step", version: "1", config: {}, llm: {},
      score: (_value: unknown, context) => Effect.gen(function* () {
        const step = yield* Effect.forkChild(context.llm.classify({ rubric: "quality", choices: ["yes", "no"], material: null }));
        yield* waitUntil(() => started, "interruptible model step");
        yield* Fiber.interrupt(step);
        return 1;
      }),
    });
    const registration = prepareManagedScoreMatch({
      match, options: managedScoreMatchOf(match)!, material: null,
      judge: testJudge(),
    });
    expect(await Effect.runPromise(registration.evaluate())).toMatchObject({ state: "unavailable", detail: { failureDetail: "score-match-incomplete-step" } });
    const evidence = registration.terminalEvidence()[0]!;
    if (evidence.kind !== "snapshot") throw new Error("Missing audit");
    expect(readScoreMatchAudit(evidence.value)).toMatchObject({ state: "available", audit: { result: { state: "unavailable" } } });
  });

  test("caps response bytes before JSON decoding", async () => {
    await expect(readJudgeResponseCapped(new Response("x".repeat(33)), 32).then((response) => response.text())).rejects.toThrow("byte cap");
  });
});
