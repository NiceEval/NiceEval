// cases: docs/engineering/testing/unit/record.md
// 「Usage、facts 与失败命令证据落盘」桶恒互斥归一:codex(OpenAI 口径,cached ⊂ input)扣减、
// Anthropic / pi(互斥口径)如实转发。fixture 数值刻意让「扣与不扣」结果可区分。
// bug: memory/estimatecost-openai-inclusive-cache-double-billed.md

import { describe, expect, it } from "vitest";

import { createClaudeSdkEventStream, createCodexThreadEventStream, createPiAgentEventStream } from "./sdk-streams.ts";

describe("createCodexThreadEventStream usage 归一(OpenAI 口径)", () => {
  it("cached_input_tokens 是 input_tokens 子集:落 inputTokens 前扣掉,cache 单独成桶", () => {
    const stream = createCodexThreadEventStream();
    stream.add({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 50 } });
    expect(stream.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 900, outputTokens: 50, requests: 1 });
  });

  it("逐轮累加在扣减之后进行,总量仍互斥", () => {
    const stream = createCodexThreadEventStream();
    stream.add({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 50 } });
    stream.add({ type: "turn.completed", usage: { input_tokens: 2000, cached_input_tokens: 1700, output_tokens: 30 } });
    expect(stream.usage).toMatchObject({ inputTokens: 400, cacheReadTokens: 2600, outputTokens: 80, requests: 2 });
  });

  it("协议报出 cached > input 的病态数据时扣减夹底到 0,不产生负 token", () => {
    const stream = createCodexThreadEventStream();
    stream.add({ type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 200, output_tokens: 1 } });
    expect(stream.usage?.inputTokens).toBe(0);
    expect(stream.usage?.cacheReadTokens).toBe(200);
  });
});

describe("createClaudeSdkEventStream usage 转发(Anthropic 互斥口径)", () => {
  it("input_tokens 原生不含 cache read:如实转发,不做扣减", () => {
    const stream = createClaudeSdkEventStream();
    stream.add({
      type: "result",
      usage: { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 900, cache_creation_input_tokens: 50 },
    });
    expect(stream.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 5,
      cacheReadTokens: 900,
      cacheCreationTokens: 50,
    });
  });
});

describe("createPiAgentEventStream usage 转发(pi 互斥口径)", () => {
  it("input 原生不含 cacheRead/cacheWrite:如实转发,cost.total 累进实测 costUSD", () => {
    const stream = createPiAgentEventStream();
    stream.add({
      type: "message_end",
      message: {
        role: "assistant",
        content: [],
        usage: { input: 100, output: 5, cacheRead: 900, cacheWrite: 50, cost: { total: 0.42 } },
      },
    });
    expect(stream.usage).toMatchObject({
      inputTokens: 100,
      cacheReadTokens: 900,
      cacheCreationTokens: 50,
      costUSD: 0.42,
    });
  });
});
