// cases: docs/engineering/testing/unit/record.md
// 「Usage、facts 与失败命令证据落盘」桶恒互斥归一:Chat Completions / Responses 两种形状的
// cached_tokens 都是输入总量的子集,落 inputTokens 前扣掉;缺 cached 明细时总量原样保留。
// bug: memory/estimatecost-openai-inclusive-cache-double-billed.md

import { describe, expect, it } from "vitest";

import { defineAgent } from "../define.ts";
import {
  chatCompletionEvidenceCoverage,
  responsesEvidenceCoverage,
  turnFromChatCompletion,
  turnFromResponses,
} from "./index.ts";

describe("openai-compat evidence coverage", () => {
  it("Chat 与 Responses 对负 action 断言的可信度不同，且六通道闭合", () => {
    expect(Object.keys(chatCompletionEvidenceCoverage).sort()).toEqual(["actions", "data", "events", "messages", "status", "usage"]);
    expect(chatCompletionEvidenceCoverage.actions.status).toBe("partial");
    expect(responsesEvidenceCoverage.actions.status).toBe("complete");
    expect(Object.isFrozen(chatCompletionEvidenceCoverage)).toBe(true);
    expect(Object.isFrozen(responsesEvidenceCoverage)).toBe(true);
  });

  it("adapter 入口导出的常量可直接用于 defineAgent", () => {
    const agent = defineAgent({
      name: "chat-completions",
      evidenceCoverage: chatCompletionEvidenceCoverage,
      async send() {
        return turnFromChatCompletion({ choices: [{ message: { content: "ok" } }] });
      },
    });
    expect(agent.evidenceCoverage).toBe(chatCompletionEvidenceCoverage);
  });

  it("单轮缺 usage 时从协议默认 complete 据实降级", () => {
    const chat = turnFromChatCompletion({ choices: [{ message: { content: "ok" } }] });
    const responses = turnFromResponses({ output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }] });
    expect(chat.evidenceCoverage?.usage?.status).toBe("unavailable");
    expect(responses.evidenceCoverage?.usage?.status).toBe("unavailable");
  });
});

describe("openai-compat usage 归一(OpenAI 口径)", () => {
  it("Chat Completions:prompt_tokens 扣掉 prompt_tokens_details.cached_tokens", () => {
    const turn = turnFromChatCompletion({
      choices: [{ message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 1000, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 900 } },
    });
    expect(turn.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 900, outputTokens: 20 });
  });

  it("Responses:input_tokens 扣掉 input_tokens_details.cached_tokens", () => {
    const turn = turnFromResponses({
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] }],
      usage: { input_tokens: 500, output_tokens: 10, input_tokens_details: { cached_tokens: 200 } },
    });
    expect(turn.usage).toMatchObject({ inputTokens: 300, cacheReadTokens: 200, outputTokens: 10 });
  });

  it("缺 cached 明细时输入总量原样保留,不虚构扣减,cache 桶省略", () => {
    const turn = turnFromChatCompletion({
      choices: [{ message: { role: "assistant", content: "ok" } }],
      usage: { prompt_tokens: 1000, completion_tokens: 20 },
    });
    expect(turn.usage?.inputTokens).toBe(1000);
    expect(turn.usage?.cacheReadTokens).toBeUndefined();
  });
});
