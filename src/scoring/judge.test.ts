// cases: docs/engineering/unit-tests/scoring/cases.md
// judge 解析与请求材料的单测:端点/凭据/模型解析结果必须进入真实请求,低分过不了 .gate()。
// fixture judge client = 截获 globalThis.fetch(autoevals 底层 openai client 走全局 fetch),
// 不起 HTTP server、不 spawn CLI。契约见 docs/feature/scoring/library/judge.md 与
// docs-site/zh/explanation/judge.mdx 的解析优先级表;用例登记在
// docs/engineering/unit-tests/scoring/cases.md 的 Judge 分区。

import { afterEach, describe, expect, it, vi } from "vitest";
import { AssertionCollector } from "./collector.ts";
import { buildJudge } from "./judge.ts";
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
  it("NICEEVAL_JUDGE_BASE/KEY 落在请求 URL 与 Bearer 头;config model 压过 NICEEVAL_JUDGE_MODEL;score 0 过不了 .gate(0.7)", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_BASE", "http://judge.fixture.internal/v1");
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    vi.stubEnv("NICEEVAL_JUDGE_MODEL", "env-model");
    const captured = stubJudgeFetch();

    const { collector, ns } = judgeWith({ model: "config-model" });
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

  it("config 缺席时回落到 NICEEVAL_JUDGE_MODEL", async () => {
    vi.stubEnv("NICEEVAL_JUDGE_KEY", "fixture-key");
    vi.stubEnv("NICEEVAL_JUDGE_MODEL", "env-model");
    const captured = stubJudgeFetch();

    const { collector, ns } = judgeWith(undefined);
    ns.autoevals.closedQA("是否切题?");
    await collector.finalize(ctx());

    expect(captured[0]!.body.model).toBe("env-model");
  });
});
