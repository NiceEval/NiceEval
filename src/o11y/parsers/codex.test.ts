// cases: docs/engineering/testing/unit/record.md
// 「Usage、facts 与失败命令证据落盘」桶恒互斥归一:codex transcript 的 cached_input_tokens
// 是 input_tokens 子集,聚合前逐请求扣减。
// bug: memory/estimatecost-openai-inclusive-cache-double-billed.md

import { describe, expect, it } from "vitest";

import { parseCodexTranscript } from "./codex.ts";

describe("parseCodexTranscript usage 归一(OpenAI 口径)", () => {
  it("cached_input_tokens 从 input_tokens 里扣出,cache 单独成桶", () => {
    const raw = [
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1000, cached_input_tokens: 900, output_tokens: 50 } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 2000, cached_input_tokens: 1700, output_tokens: 30 } }),
    ].join("\n");
    const parsed = parseCodexTranscript(raw);
    expect(parsed.usage).toMatchObject({ inputTokens: 400, cacheReadTokens: 2600, outputTokens: 80, requests: 2 });
  });
});
