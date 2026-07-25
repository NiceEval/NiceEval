// cases: docs/engineering/testing/unit/record.md
// 「Usage、facts 与失败命令证据落盘」桶恒互斥归一:bub tape 的 usage 是 Chat Completions
// 形状,prompt_tokens_details.cached_tokens 是 prompt_tokens 子集,聚合前扣减;
// 同对象的 cost 是实测计费,照常累进 costUSD。
// bug: memory/estimatecost-openai-inclusive-cache-double-billed.md

import { describe, expect, it } from "vitest";

import { parseBubTranscript } from "./bub.ts";

describe("parseBubTranscript usage 归一(OpenAI 口径)", () => {
  it("cached_tokens 从 prompt_tokens 里扣出,cost 累进实测 costUSD", () => {
    const line = JSON.stringify({
      kind: "event",
      payload: {
        name: "run",
        data: {
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 900 },
            cost: 0.05,
          },
        },
      },
    });
    const parsed = parseBubTranscript(line);
    expect(parsed.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 900, outputTokens: 20, costUSD: 0.05 });
  });
});
