// owner: docs/engineering/testing/unit/assertions.md#证明范围规范
// cases: docs/engineering/testing/unit/assertions.md

import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { pollFiber, runWithTestClock, TestClock, withRandomFixed } from "../test-support/effect-v4.ts";
import { createAssertionsRuntime } from "./runtime.ts";
import { readJudgeMaterialV2 } from "./judge-material.ts";
import {
  defineJudge, evaluateJudgeMeasurement, finalizeJudgeTransport,
  judgeDeclarationOwnsDefinition, judgeDefinitionDigest, judgeMatchOf,
  normalizeJudgeDeclaration, readJudgeResponseCapped, renderJudgeRequest,
  retainedJudgeMaterial, type JudgeExecution,
} from "./judge.ts";

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

function judgeInput(signal?: AbortSignal, timeoutMs = 5_000): JudgeExecution {
  return {
    judge: { model: "judge-model", baseUrl: "https://judge.example/v1", apiKeyEnv: TEST_KEY_ENV, timeoutMs, maxOutputTokens: 128 },
    request: renderJudgeRequest(definition(), { question: "question", answer: "answer" }),
    ...(signal === undefined ? {} : { signal }),
  };
}

function acceptedResponse(
  decision: Readonly<Record<string, unknown>> = { measurement: 0.75, rationale: "sound" },
): Response {
  return new Response(JSON.stringify({
    id: "completion-1", object: "chat.completion", created: 0, model: "judge-model",
    choices: [{ index: 0, finish_reason: "tool_calls", message: { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "record_judge_decision", arguments: JSON.stringify(decision) } }] } }],
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
  test("chunks canonical requests on UTF-8 boundaries and preserves negative-zero normalization", () => {
    const request = renderJudgeRequest(definition(), { z: `${"界".repeat(3_000)} sentinel`, a: -0 });
    const parsed = JSON.parse(request.canonicalRequest) as { messages: Array<{ content: string }> };
    expect(parsed.messages[1]?.content).toContain('"a":0');
    expect(request.retained.content.length).toBeGreaterThan(2);
    expect(request.retained.content.every((chunk) => new TextEncoder().encode(chunk).byteLength <= 4 * 1024)).toBe(true);
    expect(readJudgeMaterialV2(retainedJudgeMaterial(request), "answer-quality")).toEqual({ state: "available", request: request.canonicalRequest });
  });

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

  test("accepts shared children but rejects cycles, sparse arrays, accessors, and classes", () => {
    const shared = { value: 1 };
    expect(() => renderJudgeRequest(definition(), { left: shared, right: shared })).not.toThrow();
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => renderJudgeRequest(definition(), cyclic)).toThrow("ancestor cycle");
    expect(() => renderJudgeRequest(definition(), Array(1))).toThrow("holes");
    expect(() => renderJudgeRequest(definition(), Object.defineProperty({}, "x", { enumerable: true, get: () => 1 }))).toThrow("data properties");
    expect(() => renderJudgeRequest(definition(), new (class Material {})())).toThrow("plain");
  });

  test("normalizes non-empty declarations with exact-instance authority and canonical identity", () => {
    const alpha = definition("alpha"); const beta = definition("beta");
    const normalized = normalizeJudgeDeclaration([beta, alpha, beta]);
    expect(normalized).toEqual([alpha, beta]);
    expect(judgeDeclarationOwnsDefinition(normalized, alpha)).toBe(true);
    expect(judgeDeclarationOwnsDefinition(normalized, definition("alpha"))).toBe(false);
    expect(() => normalizeJudgeDeclaration([alpha, definition("alpha")])).toThrow("different instances");
    expect(() => normalizeJudgeDeclaration([])).toThrow("non-empty");
    expect(judgeDefinitionDigest([beta, alpha])).toBe(judgeDefinitionDigest([alpha, beta]));
    expect(judgeMatchOf(alpha.atLeast(0.7))).toMatchObject({ definition: alpha, threshold: 0.7 });
  });

  test("classifies unknown versions and rejects chunk, request, and manifest digest corruption", () => {
    const request = renderJudgeRequest(definition(), { answer: "ok" });
    expect(readJudgeMaterialV2({ manifest: { schemaVersion: 3 }, content: [] })).toEqual({ state: "unsupported", schemaVersion: 3 });
    expect(readJudgeMaterialV2({ ...request.retained, content: [...request.retained.content, "x"] })).toEqual({ state: "invalid" });
    expect(readJudgeMaterialV2({ ...request.retained, manifest: { ...request.retained.manifest, requestDigest: "0".repeat(64) } })).toEqual({ state: "invalid" });
    expect(readJudgeMaterialV2({ ...request.retained, manifest: { ...request.retained.manifest, digest: "0".repeat(64) } })).toEqual({ state: "invalid" });
  });

  test("enforces material, complete-request, and Attempt retention budgets atomically", async () => {
    expect(() => renderJudgeRequest(defineJudge({ name: "tiny", rubric: "r", maxMaterialBytes: 8 }), "123456789")).toThrow("material exceeds");
    const huge = defineJudge({ name: "huge", rubric: "r".repeat(8 * 1024), anchors: Array.from({ length: 32 }, (_, index) => ({ measurement: index / 31, description: "a".repeat(1024) })), maxMaterialBytes: 48 * 1024 });
    expect(() => renderJudgeRequest(huge, "x".repeat(48 * 1024 - 2))).toThrow("complete request");
    const runtime = createAssertionsRuntime({ evaluationKind: "score", executeStop: (effect) => Effect.runPromise(effect) });
    const request = renderJudgeRequest(definition(), "ok");
    const registration = (retainedBytes: number) => ({ criterion: { kind: "judge-measurement" as const, name: "answer-quality", scale: "unit-interval" as const }, subject: { kind: "snapshot" as const, value: retainedJudgeMaterial(request) }, retainedBytes, evaluate: () => Effect.succeed({ state: "measured" as const, value: 1 }) });
    runtime.registerMeasurement(registration(512 * 1024));
    expect(() => runtime.registerMeasurement(registration(1))).toThrow("512 KiB");
    expect((await Effect.runPromise(runtime.seal())).entries).toHaveLength(1);
  });
});

describe("Judge Effect lifecycle", () => {
  beforeEach(() => { process.env[TEST_KEY_ENV] = "test-key"; });
  afterEach(() => { delete process.env[TEST_KEY_ENV]; vi.unstubAllGlobals(); });

  test("separates rationale from attempted transport state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(acceptedResponse()));
    const input = judgeInput();
    await expect(Effect.runPromise(evaluateJudgeMeasurement(input))).resolves.toMatchObject({ state: "measured", value: 0.75, detail: { rationale: { state: "available", value: "sound" } } });
    expect(finalizeJudgeTransport(input.request)).toEqual({ transport: { state: "attempted" } });
  });

  test("rejects native decision fields outside the strict protocol", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(acceptedResponse({ measurement: 1, rationale: "correct", hiddenReasoning: "private" })));
    await expect(Effect.runPromise(evaluateJudgeMeasurement(judgeInput()))).resolves.toMatchObject({
      state: "errored",
      detail: { code: "judge-evaluator-error" },
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
      expect(yield* Fiber.join(fiber)).toMatchObject({ state: "unavailable", reason: "source-unavailable", detail: { failureDetail: "judge-call-failed", failureEvidence: expect.stringContaining("timed out after 5s") } });
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
    expect(finalizeJudgeTransport(missing.request)).toEqual({ transport: { state: "not-sent" } });
    expect(fetchMock).not.toHaveBeenCalled();

    process.env[TEST_KEY_ENV] = "test-key"; const preCancelledController = new AbortController(); preCancelledController.abort();
    const preCancelled = judgeInput(preCancelledController.signal);
    const preCancelledExit = await Effect.runPromiseExit(evaluateJudgeMeasurement(preCancelled));
    expect(Exit.isFailure(preCancelledExit) && Cause.hasInterruptsOnly(preCancelledExit.cause)).toBe(true);
    expect(finalizeJudgeTransport(preCancelled.request)).toEqual({ transport: { state: "not-sent" } });
    expect(fetchMock).not.toHaveBeenCalled();

    const controller = new AbortController(); let started = false;
    vi.stubGlobal("fetch", vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { started = true; init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true }); })));
    const cancelled = judgeInput(controller.signal);
    const exit = await Effect.runPromise(Effect.gen(function* () { const fiber = yield* Effect.forkChild(evaluateJudgeMeasurement(cancelled)); while (!started) yield* Effect.yieldNow; controller.abort(); return yield* Fiber.await(fiber); }));
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    expect(finalizeJudgeTransport(cancelled.request)).toEqual({ transport: { state: "attempted" } });
  });

  test("caps response bytes before JSON decoding", async () => {
    await expect(readJudgeResponseCapped(new Response("x".repeat(33)), 32).then((response) => response.text())).rejects.toThrow("byte cap");
  });
});
