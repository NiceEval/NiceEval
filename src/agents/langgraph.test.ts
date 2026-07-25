// cases: docs/engineering/testing/unit/record.md
// 「Usage、facts 与失败命令证据落盘」桶恒互斥归一:LangChain usage_metadata 的 input_tokens
// 是含缓存读写的输入总量,落桶前扣掉 input_token_details 的 cache_read / cache_creation。
// bug: memory/estimatecost-openai-inclusive-cache-double-billed.md

import { describe, expect, it } from "vitest";

import { fromLangGraphEvents } from "./langgraph.ts";

describe("fromLangGraphEvents usage 归一(含明细口径)", () => {
  it("cache_read 与 cache_creation 都从 input_tokens 里扣出", () => {
    const stream = fromLangGraphEvents();
    stream.add({
      channel: "messages",
      event: "finish",
      data: {
        message: {
          role: "assistant",
          content: "ok",
          usage_metadata: {
            input_tokens: 1000,
            output_tokens: 20,
            input_token_details: { cache_read: 800, cache_creation: 100 },
          },
        },
      },
    });
    expect(stream.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 800, cacheCreationTokens: 100, outputTokens: 20 });
  });
});
