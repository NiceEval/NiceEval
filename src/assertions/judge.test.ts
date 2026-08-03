// cases: docs/engineering/testing/unit/assertions.md
// judge 解析与请求材料的单测:端点/凭据/模型解析结果必须进入真实请求,低分过不了 .gate()。
// fixture judge client = 截获 globalThis.fetch(autoevals 底层 openai client 走全局 fetch),
// 不起 HTTP server、不 spawn CLI。契约见 docs/feature/judge/library.md 与
// docs-site/zh/explanation/judge.mdx 的解析优先级表;用例登记在
// docs/engineering/testing/unit/assertions.md 的 Judge 分区。
// 覆盖声明：Judge transport 的瞬时/永久分类、Retry-After、最多 3 次物理调用、总 timeout 预算、
// precheck 的 20s 独立预算与瞬时 HTTP 重试都在本文件验证；不测试真实付费模型。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssertionCollector } from "./collector.ts";
import { buildJudge, probeJudge, type JudgeDeps } from "./judge.ts";
import { computeVerdict } from "../shared/verdict.ts";
import { completeEvidenceCoverage } from "./coverage.ts";
import { emptyDiffData } from "./diff.ts";
import { deriveRunFacts } from "../o11y/derive.ts";
import { resolveJudge } from "../runner/attempt.ts";
import type { AssertionResult, JudgeConfig, AssertionEvaluationContext } from "../types.ts";

function ctx(): AssertionEvaluationContext {
  return {
    events: [],
    facts: deriveRunFacts([]),
    diff: emptyDiffData(),
    scripts: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed",
    evidenceCoverage: completeEvidenceCoverage,
    readFile: async () => undefined,
  };
}

interface CapturedRequest {
  url: string;
  authorization: string | null;
  body: { model?: string; messages?: Array<{ role: string; content: string }> };
}

/** 截获全局 fetch:记录请求,回一个 ClosedQA 选 "N"(score 0)的 chat completion。 */
function stubJudgeFetch(): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = input instanceof Request ? input.url : String(input);
    const headers = new Headers(input instanceof Request && !init?.headers ? input.headers : init?.headers);
    const rawBody = init?.body ?? (input instanceof Request ? await input.text() : undefined);
    captured.push({
      url,
      authorization: headers.get("authorization"),
      body: typeof rawBody === "string" ? JSON.parse(rawBody) : {},
    });
    const payload = {
      id: "chatcmpl-fixture",
      object: "chat.completion",
      created: 0,
      model: "fixture",
      choices: [
        {
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "select_choice",
                  arguments: JSON.stringify({ choice: "N", reasons: "拒绝识图,答非所问" }),
                },
              },
            ],
          },
        },
      ],
    };
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  });
  return captured;
}

function judgeWith(judge: JudgeConfig | undefined, retry: Pick<JudgeDeps, "sleep" | "random"> = {}) {
  const collector = new AssertionCollector();
  const ns = buildJudge({
    record: (spec) => collector.record(spec),
    judge,
    getOutput: () => "很抱歉,我目前使用的模型不支持图像输入,无法查看你发送的图片。",
    getInput: () => "这张图片里有什么?主要是什么颜色?",
    ...retry,
  });
  return { collector, ns };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("judge 端点/凭据/模型解析进入真实请求", () => {
  it("config 的 baseUrl 与 NICEEVAL_JUDGE_KEY 落在请求 URL 与 Bearer 头;score 0 过不了 .gate(0.7)", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    const captured = stubJudgeFetch();

    const { collector, ns } = judgeWith({ model: "config-model", baseUrl: "http://judge.fixture.internal/v1" });
    ns.autoevals.closedQA("助手是否描述了这张图片的内容,而不是答非所问?").gate(0.7);
    const [result] = await collector.finalize(ctx());

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe("http://judge.fixture.internal/v1/chat/completions");
    expect(captured[0]!.authorization).toBe("Bearer fixture-key");
    expect(captured[0]!.body.model).toBe("config-model");
    // 请求材料:被评的 output 与 rubric 都要真的送到裁判面前。
    const material = JSON.stringify(captured[0]!.body.messages ?? []);
    expect(material).toContain("不支持图像输入");
    expect(material).toContain("助手是否描述了这张图片的内容");

    // 裁判给 0 分,.gate(0.7) 是硬要求:该条 failed,折叠后整个 attempt failed(与 --strict 无关)。
    expect(result).toMatchObject({ severity: "gate", threshold: 0.7, outcome: "failed", score: 0 });
    expect(computeVerdict({ assertions: [result!] })).toBe("failed");
  });

  it("单次 { model } 压过 judge config", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    const captured = stubJudgeFetch();

    const { collector, ns } = judgeWith({ model: "config-model" });
    ns.autoevals.closedQA("是否切题?", { model: "call-model" });
    await collector.finalize(ctx());

    expect(captured[0]!.body.model).toBe("call-model");
  });

  // 配置是模型的唯一来源:环境里摆着旧的 NICEEVAL_JUDGE_MODEL / OPENAI_API_KEY /
  // OPENAI_BASE_URL 也一概不看——既不当模型用,也不拿来当 key、当端点。
  it("config 缺席时不回落到任何环境变量,记 model-unresolved", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    vi.stubEnv("NICEEVAL_JUDGE_MODEL", "env-model");
    const captured = stubJudgeFetch();

    const { collector, ns } = judgeWith(undefined);
    ns.autoevals.closedQA("是否切题?");
    const [result] = await collector.finalize(ctx());

    expect(captured).toHaveLength(0);
    expect(result).toMatchObject({ outcome: "unavailable" });
    expect((result as { reason?: string }).reason).toContain("judge-model-unresolved");
  });

  it("端点与 key 都不从 OPENAI_* / CODEX_* 借:没有 judge 自己的 key 就记 key-unresolved", async () => {
    vi.stubEnv("OPENAI_API_KEY", "app-key");
    vi.stubEnv("OPENAI_BASE_URL", "http://app.fixture.internal/v1");
    vi.stubEnv("CODEX_API_KEY", "codex-key");
    vi.stubEnv("CODEX_BASE_URL", "http://codex.fixture.internal/v1");
    const captured = stubJudgeFetch();

    const { collector, ns } = judgeWith({ model: "config-model" });
    ns.autoevals.closedQA("是否切题?");
    const [result] = await collector.finalize(ctx());

    expect(captured).toHaveLength(0);
    expect(result).toMatchObject({ outcome: "unavailable" });
    expect((result as { reason?: string }).reason).toContain("judge-key-unresolved");
  });

  it("judge.apiKeyEnv 指定的变量名决定读哪个 key", async () => {
    vi.stubEnv("MY_GATEWAY_KEY", "gateway-key");
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "default-key");
    const captured = stubJudgeFetch();

    const { collector, ns } = judgeWith({ model: "config-model", apiKeyEnv: "MY_GATEWAY_KEY" });
    ns.autoevals.closedQA("是否切题?");
    await collector.finalize(ctx());

    expect(captured[0]!.authorization).toBe("Bearer gateway-key");
  });

  it("judge.apiKeyEnv 指向缺失变量时不回退 NICEEVAL_JUDGE_KEY,记录 key-unresolved", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "default-key");
    const captured = stubJudgeFetch();

    const { collector, ns } = judgeWith({ model: "config-model", apiKeyEnv: "MISSING_GATEWAY_KEY" });
    ns.autoevals.closedQA("是否切题?");
    const [result] = await collector.finalize(ctx());

    expect(captured).toHaveLength(0);
    expect(result).toMatchObject({ outcome: "unavailable" });
    expect((result as { reason?: string }).reason).toContain("judge-key-unresolved (MISSING_GATEWAY_KEY unset)");
  });

  it("没配 baseUrl 时打官方端点", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    const captured = stubJudgeFetch();

    const { collector, ns } = judgeWith({ model: "config-model" });
    ns.autoevals.closedQA("是否切题?");
    await collector.finalize(ctx());

    expect(captured[0]!.url).toBe("https://api.openai.com/v1/chat/completions");
  });
});

// probeJudge(派发前的可达性预检)的错误分类:网关「接受连接但不回」是它自己一类,要报
// 可行动的「无响应」而不是一句通用 aborted;其它探测失败仍走通用 probeFailed。有 key/model
// 才会真正发探测,所以这里都给上 key。契约见 docs/feature/experiments/cli.md「judge 预检的显示」。
describe("probeJudge 探测的错误分类", () => {
  const judge: JudgeConfig = { model: "gpt-5.6-luna", baseUrl: "http://judge.fixture.internal/v1" };
  // key 从环境解析(见 resolveJudge);有 model + key 才会真正发探测请求。
  const withKey = (): void => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
  };

  it("端点接受连接却不回时,超时(TimeoutError)报可行动的「无响应」错误,不是通用失败", async () => {
    withKey();
    // fetch 因 AbortSignal.timeout 触发而 reject:reason 是 name 为 TimeoutError 的错误。
    vi.stubGlobal("fetch", async (): Promise<Response> => {
      throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    });
    const err = await probeJudge(judge);
    expect(err).toBeDefined();
    // 「无响应」这条要能指路到 baseUrl / 网关,而不是把 abort 原样甩给用户。
    expect(err).toMatch(/20s|responded|无响应|不回/);
    expect(err).toContain("gpt-5.6-luna");
  });

  it("非超时的探测失败仍走通用 probeFailed(带原始错误),不误报成超时", async () => {
    withKey();
    vi.stubGlobal("fetch", async (): Promise<Response> => {
      throw new Error("ECONNREFUSED");
    });
    const err = await probeJudge(judge);
    expect(err).toBeDefined();
    expect(err).toContain("ECONNREFUSED");
    expect(err).not.toMatch(/20s|timed out|超时/);
  });

  it("端点正常(2xx)时探测通过,返回 undefined", async () => {
    withKey();
    vi.stubGlobal("fetch", async (): Promise<Response> => new Response("{}", { status: 200 }));
    expect(await probeJudge(judge)).toBeUndefined();
  });

  // cases: docs/engineering/testing/unit/experiments-runner.md「探测预算逐次独立」
  // 契约见 docs/feature/judge/library.md「派发前预检」:每次探测各自拥有完整的 20 秒预算。
  // 超时预算若建在重试循环外,第一次超时把它耗尽后第二次拿着已 abort 的 signal 0ms 即败——
  // 重试形同虚设,而重试存在的理由正是把瞬时抖动与真不可用分开。
  it("两次探测各拿一份独立的超时预算:第一次超时后第二次仍以完整预算真实发出", async () => {
    withKey();
    const signals: (AbortSignal | undefined)[] = [];
    const abortedWhenCalled: boolean[] = [];
    const probe = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }): Promise<Response> => {
      signals.push(init?.signal);
      abortedWhenCalled.push(init?.signal?.aborted ?? false);
      if (signals.length === 1) throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", probe);

    // 第二次探测拿到 200 ⇒ 预检通过:第一次超时没有连坐第二次。
    expect(await probeJudge(judge)).toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(2);
    // 区分力所在:预算建在循环外时两次拿到的是同一个 signal 实例。
    expect(signals[0]).not.toBe(signals[1]);
    expect(abortedWhenCalled).toEqual([false, false]);
  });

  it("外层 Ctrl+C signal 仍与每次尝试各自的超时预算合流(两次都不是裸的外层 signal)", async () => {
    withKey();
    const outer = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    const probe = vi.fn(async (_url: unknown, init?: { signal?: AbortSignal }): Promise<Response> => {
      signals.push(init?.signal);
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", probe);

    await probeJudge(judge, outer.signal);
    expect(probe).toHaveBeenCalledTimes(2);
    expect(signals[0]).not.toBe(signals[1]);
    expect(signals[0]).not.toBe(outer.signal);
    expect(signals[1]).not.toBe(outer.signal);
  });

  it("传输失败与瞬时 HTTP 响应最多探测两次，永久 HTTP 错误立即失败", async () => {
    withKey();
    const transport = vi.fn(async (): Promise<Response> => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", transport);
    await probeJudge(judge);
    expect(transport).toHaveBeenCalledTimes(2);

    const http = vi.fn()
      .mockResolvedValueOnce(new Response("bad gateway", { status: 502 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", http);
    expect(await probeJudge(judge)).toBeUndefined();
    expect(http).toHaveBeenCalledTimes(2);

    const permanent = vi.fn(async (): Promise<Response> => new Response("bad request", { status: 400 }));
    vi.stubGlobal("fetch", permanent);
    await probeJudge(judge);
    expect(permanent).toHaveBeenCalledTimes(1);
  });
});

describe("judge 调用失败保留 unavailable", () => {
  const judge: JudgeConfig = { model: "fixture-model", baseUrl: "http://judge.fixture.internal/v1" };

  async function expectUnavailable(
    fetchImpl: () => Promise<Response>,
    evidence: RegExp,
    expectedCalls = 6,
  ): Promise<void> {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetchMock);

    const retry = { sleep: async (_ms: number, _signal: AbortSignal): Promise<void> => {}, random: () => 0 };
    const required = judgeWith(judge, retry);
    required.ns.autoevals.closedQA("是否切题?").gate(0.8);
    const [requiredResult] = await required.collector.finalize(ctx());
    expect(requiredResult).toMatchObject({ outcome: "unavailable", reason: "judge-call-failed" });
    expect(requiredResult?.outcome === "unavailable" && requiredResult.evidence).toMatch(evidence);
    expect(computeVerdict({ assertions: [requiredResult!] })).toBe("errored");

    const optional = judgeWith(judge, retry);
    optional.ns.autoevals.closedQA("是否切题?").optional();
    const [optionalResult] = await optional.collector.finalize(ctx());
    expect(optionalResult).toMatchObject({ outcome: "unavailable", reason: "judge-call-failed", optional: true });
    expect(computeVerdict({ assertions: [optionalResult!] })).toBe("passed");

    // 每条判分请求按错误分类得到固定物理尝试数，SDK 不隐藏重放。
    expect(fetchMock).toHaveBeenCalledTimes(expectedCalls);
  }

  it("HTTP 非 2xx 不伪装成 0 分", async () => {
    await expectUnavailable(async () => new Response("gateway down", { status: 502 }), /HTTP 502/);
  });

  it("连接中断不伪装成 0 分", async () => {
    await expectUnavailable(async () => {
      throw new TypeError("socket hang up");
    }, /Connection error/);
  });

  it("调用超时不伪装成 0 分", async () => {
    await expectUnavailable(async () => {
      throw Object.assign(new Error("request timed out"), { name: "TimeoutError" });
    }, /Request timed out/);
  });

  it("2xx 但响应协议不符或取不出分数不伪装成 0 分", async () => {
    await expectUnavailable(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }), /Cannot read properties/, 2);
  });

  it("429/capacity 按 Retry-After 显式重试一次后拿到分数", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    let calls = 0;
    const fetchMock = vi.fn(async (): Promise<Response> => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ error: { code: "model_capacity", message: "busy" } }), {
          status: 429,
          headers: { "retry-after": "0" },
        });
      }
      return new Response(JSON.stringify({
        id: "chatcmpl-fixture",
        object: "chat.completion",
        created: 0,
        model: "fixture",
        choices: [{
          index: 0,
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: { name: "select_choice", arguments: JSON.stringify({ choice: "Y" }) },
            }],
          },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const sleep = vi.fn(async (_ms: number, _signal: AbortSignal): Promise<void> => {});
    const { collector, ns } = judgeWith({ model: "fixture-model", baseUrl: "http://judge.fixture.internal/v1" }, {
      sleep,
      random: () => 0,
    });
    ns.autoevals.closedQA("是否切题?");
    const [result] = await collector.finalize(ctx());

    expect(result).toMatchObject({ outcome: "passed", score: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(0, expect.any(AbortSignal));
  });

  it("403/SUBSCRIPTION_NOT_FOUND 是永久错误，不重试且 evidence 带模型、状态、code", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    const fetchMock = vi.fn(async (): Promise<Response> => new Response(JSON.stringify({
      error: { code: "SUBSCRIPTION_NOT_FOUND", message: "subscription missing" },
    }), { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const { collector, ns } = judgeWith({ model: "fixture-model", baseUrl: "http://judge.fixture.internal/v1" });
    ns.autoevals.closedQA("是否切题?").gate(0.8);
    const [result] = await collector.finalize(ctx());

    expect(result).toMatchObject({ outcome: "unavailable", reason: "judge-call-failed" });
    expect(result?.outcome === "unavailable" && result.evidence).toContain("model=fixture-model");
    expect(result?.outcome === "unavailable" && result.evidence).toContain("HTTP 403");
    expect(result?.outcome === "unavailable" && result.evidence).toContain("code=SUBSCRIPTION_NOT_FOUND");
    expect(result?.outcome === "unavailable" && result.evidence).toContain("retry=no");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

// 判分调用的时间预算(docs/feature/judge/library.md「调用预算与执行顺序」)。
// fake 时钟 + 截获 fetch:请求在 fake 时间推进到 respondAfterMs 时才回,一秒也不真等。
describe("judge 调用超时预算(judge.timeoutMs)", () => {
  const endpoint = { model: "fixture-model", baseUrl: "http://judge.fixture.internal/v1" };

  /** 延迟应答的判分网关:respondAfterMs 后回一个 ClosedQA 选 "Y"(score 1)的响应;
   *  期间被 abort 就按传输失败 reject(真实网关取消在飞请求的样子)。 */
  function stubDelayedFetch(respondAfterMs: number): void {
    vi.stubGlobal("fetch", (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => {
          const payload = {
            id: "chatcmpl-fixture",
            object: "chat.completion",
            created: 0,
            model: "fixture",
            choices: [
              {
                index: 0,
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: { name: "select_choice", arguments: JSON.stringify({ choice: "Y" }) },
                    },
                  ],
                },
              },
            ],
          };
          resolve(
            new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } }),
          );
        }, respondAfterMs);
        init?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          },
          { once: true },
        );
      });
    });
  }

  /** 起一条 judge 断言并让 fake 时钟推进 advanceMs;返回结果与「推进到一半时是否已收束」。 */
  async function scoreWithClock(
    judge: JudgeConfig,
    advanceMs: number,
  ): Promise<{ result: AssertionResult | undefined; settledEarly: boolean }> {
    const { collector, ns } = judgeWith(judge);
    ns.autoevals.closedQA("是否切题?");
    const pending = collector.finalize(ctx());
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(Math.max(0, advanceMs - 1_000));
    const settledEarly = settled;
    await vi.advanceTimersByTimeAsync(1_000);
    const [result] = await pending;
    return { result, settledEarly };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("不配 timeoutMs 时按默认 180_000 中断:记 judge-call-failed,evidence 写明超时秒数", async () => {
    stubDelayedFetch(10 * 60_000); // 网关十分钟才回,默认预算内拿不到
    const { result, settledEarly } = await scoreWithClock(endpoint, 180_000);

    expect(settledEarly, "179s 时还不该收束——默认预算是 180s,不是立刻失败").toBe(false);
    expect(result).toMatchObject({ outcome: "unavailable", reason: "judge-call-failed" });
    expect(result?.outcome === "unavailable" && result.evidence).toContain("timed out after 180s");
  });

  it("同一挂起 fixture 配了更长的 timeoutMs 就正常拿到分数", async () => {
    stubDelayedFetch(240_000); // 4 分钟:超过默认 180s,在 300s 预算内
    const { result } = await scoreWithClock({ ...endpoint, timeoutMs: 300_000 }, 240_000);

    expect(result).toMatchObject({ outcome: "passed", score: 1 });
  });

  it("同一挂起 fixture 不放宽预算时按默认中断(与上一格只差 timeoutMs)", async () => {
    stubDelayedFetch(240_000);
    const { result } = await scoreWithClock(endpoint, 180_000);

    expect(result).toMatchObject({ outcome: "unavailable", reason: "judge-call-failed" });
    expect(result?.outcome === "unavailable" && result.evidence).toContain("timed out after 180s");
  });

  // 逐字段合并与整体覆盖唯一读数不同的一格:eval 写了自己的 judge 但没写 timeoutMs 时,
  // 取的是 config 的 300s,不是默认 180s。
  it("eval 写了自己的 judge 而没写 timeoutMs 时取 config 的 timeoutMs,不落默认值", async () => {
    const configJudge: JudgeConfig = { ...endpoint, timeoutMs: 300_000 };
    const evalJudge: JudgeConfig = { model: "eval-model", baseUrl: endpoint.baseUrl };
    const resolved = resolveJudge(undefined, evalJudge, configJudge);
    expect(resolved?.timeoutMs, "timeoutMs 逐字段回落到 config").toBe(300_000);

    stubDelayedFetch(240_000); // 若错误地落回默认 180s,这次调用会在 180s 被中断
    const { result } = await scoreWithClock(resolved!, 240_000);

    expect(result).toMatchObject({ outcome: "passed", score: 1 });
  });

  it("两层都没写 timeoutMs 才落默认 180_000", async () => {
    const resolved = resolveJudge(undefined, { model: "eval-model" }, endpoint);
    expect(resolved?.timeoutMs).toBeUndefined();

    stubDelayedFetch(240_000);
    const { result } = await scoreWithClock(resolved!, 180_000);

    expect(result).toMatchObject({ outcome: "unavailable", reason: "judge-call-failed" });
    expect(result?.outcome === "unavailable" && result.evidence).toContain("timed out after 180s");
  });
});

describe("judge retry 的总 timeout 预算", () => {
  it("退避后的第二次请求继续消费同一个 timeoutMs，不按尝试重置", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    let calls = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 503 });
      return new Promise<Response>((resolve, reject) => {
        const timer = setTimeout(() => resolve(new Response("late", { status: 200 })), 200);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
        }, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const sleep = (ms: number, signal: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      }, { once: true });
    });
    const { collector, ns } = judgeWith({
      model: "fixture-model",
      baseUrl: "http://judge.fixture.internal/v1",
      timeoutMs: 100,
    }, { sleep, random: () => 0 });
    ns.autoevals.closedQA("是否切题?");
    const pending = collector.finalize(ctx());
    await vi.advanceTimersByTimeAsync(100);
    const [result] = await pending;

    expect(result).toMatchObject({ outcome: "unavailable", reason: "judge-call-failed" });
    expect(result?.outcome === "unavailable" && result.evidence).toContain("timed out after 0.1s");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

// 落盘 detail 只有「检查方式」一个含义(docs/feature/assertions/architecture.md「断言记录」,
// 判定行形态见 display.md#judge),而 live 面板的判分推进用的正是同一份文本
// (docs/feature/experiments/cli.md「Attempt 阶段」)。runner 侧接线归 attempt.test.ts。
describe("判分断言的检查方式:落盘 detail 与推进回调同源", () => {
  // fixture 的裁判回复带 reasons(autoevals 会把它读成 rationale):理由不进 detail,
  // 否则判定行标题会从 `closedQA("…")` 变成摘要 + 一整段理由。
  it("落盘 detail 恒是干净的检查方式摘要,裁判理由不混进来", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    stubJudgeFetch();

    const { collector, ns } = judgeWith({ model: "fixture-model" });
    ns.autoevals.closedQA("助手是否描述了这张图片的内容?");
    const [result] = await collector.finalize(ctx());

    expect(result?.detail).toBe('closedQA("助手是否描述了这张图片的内容?")');
    expect(result?.detail).not.toContain("拒绝识图");
    // evidence 仍是判分看的材料(被评的 output),同样不掺理由。
    const evidence = result?.outcome === "unavailable" ? undefined : result?.evidence;
    expect(evidence).toContain("不支持图像输入");
    expect(evidence).not.toContain("拒绝识图");
  });

  it("回调的 check 与落盘 detail 是同一个字符串", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    stubJudgeFetch();

    const { collector, ns } = judgeWith({ model: "fixture-model" });
    ns.autoevals.closedQA("助手是否描述了这张图片的内容?");
    const seen: Array<{ index: number; total: number; check: string }> = [];
    const [result] = await collector.finalize(ctx(), { onJudgeProgress: (p) => seen.push(p) });

    expect(seen).toEqual([{ index: 1, total: 1, check: 'closedQA("助手是否描述了这张图片的内容?")' }]);
    expect(result?.detail).toBe(seen[0]!.check);
  });
});
