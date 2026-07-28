// cases: docs/engineering/testing/unit/scoring.md
// judge 解析与请求材料的单测:端点/凭据/模型解析结果必须进入真实请求,低分过不了 .gate()。
// fixture judge client = 截获 globalThis.fetch(autoevals 底层 openai client 走全局 fetch),
// 不起 HTTP server、不 spawn CLI。契约见 docs/feature/judge/library.md 与
// docs-site/zh/explanation/judge.mdx 的解析优先级表;用例登记在
// docs/engineering/testing/unit/scoring.md 的 Judge 分区。

import { afterEach, describe, expect, it, vi } from "vitest";
import { AssertionCollector } from "./collector.ts";
import { buildJudge, probeJudge } from "./judge.ts";
import { computeVerdict } from "./verdict.ts";
import { resolveAgentCoverage, completeCoverage } from "./coverage.ts";
import { emptyDiffData } from "./diff.ts";
import { deriveRunFacts } from "../o11y/derive.ts";
import type { JudgeConfig, ScoringContext } from "../types.ts";

function ctx(): ScoringContext {
  return {
    events: [],
    facts: deriveRunFacts([]),
    diff: emptyDiffData(),
    scripts: {},
    usage: { inputTokens: 0, outputTokens: 0 },
    status: "completed",
    coverage: resolveAgentCoverage(completeCoverage),
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

function judgeWith(judge: JudgeConfig | undefined) {
  const collector = new AssertionCollector();
  const ns = buildJudge({
    record: (spec) => collector.record(spec),
    judge,
    getOutput: () => "很抱歉,我目前使用的模型不支持图像输入,无法查看你发送的图片。",
    getInput: () => "这张图片里有什么?主要是什么颜色?",
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

  it("传输失败最多探测两次，HTTP 响应失败不重试", async () => {
    withKey();
    const transport = vi.fn(async (): Promise<Response> => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", transport);
    await probeJudge(judge);
    expect(transport).toHaveBeenCalledTimes(2);

    const http = vi.fn(async (): Promise<Response> => new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", http);
    await probeJudge(judge);
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe("judge 调用失败保留 unavailable", () => {
  const judge: JudgeConfig = { model: "fixture-model", baseUrl: "http://judge.fixture.internal/v1" };

  async function expectUnavailable(
    fetchImpl: () => Promise<Response>,
    evidence: RegExp,
  ): Promise<void> {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    const fetchMock = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetchMock);

    const required = judgeWith(judge);
    required.ns.autoevals.closedQA("是否切题?").gate(0.8);
    const [requiredResult] = await required.collector.finalize(ctx());
    expect(requiredResult).toMatchObject({ outcome: "unavailable", reason: "judge-call-failed" });
    expect(requiredResult?.outcome === "unavailable" && requiredResult.evidence).toMatch(evidence);
    expect(computeVerdict({ assertions: [requiredResult!] })).toBe("errored");

    const optional = judgeWith(judge);
    optional.ns.autoevals.closedQA("是否切题?").optional();
    const [optionalResult] = await optional.collector.finalize(ctx());
    expect(optionalResult).toMatchObject({ outcome: "unavailable", reason: "judge-call-failed", optional: true });
    expect(computeVerdict({ assertions: [optionalResult!] })).toBe("passed");

    // 每条实际判分请求恰好一次；不能由 SDK 在失败后自动重放并重复收费。
    expect(fetchMock).toHaveBeenCalledTimes(2);
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
    await expectUnavailable(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }), /Cannot read properties/);
  });
});
