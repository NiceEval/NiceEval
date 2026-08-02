// cases: docs/engineering/testing/unit/record.md
// 「Usage、facts 与失败命令证据落盘」桶恒互斥归一:AI SDK 的 inputTokens 是含缓存明细的
// 输入总量,落桶前扣掉在场的 cacheRead / cacheWrite 明细。
// bug: memory/estimatecost-openai-inclusive-cache-double-billed.md

import { describe, expect, it } from "vitest";

import { turnFromAiSdk, type AiSdkAgentOptions } from "./ai-sdk.ts";

const invalidDataCallback: AiSdkAgentOptions = {
  async generate() {
    return { text: "ok" };
  },
  // @ts-expect-error AI SDK data callback 必须在 adapter 边界返回 JsonValue。
  data: () => new Date(),
};
void invalidDataCallback;

describe("turnFromAiSdk usage 归一(含明细口径)", () => {
  it("v5 形状:cachedInputTokens 从 inputTokens 里扣出", () => {
    const turn = turnFromAiSdk({
      text: "ok",
      usage: { inputTokens: 1000, outputTokens: 20, cachedInputTokens: 900 },
    });
    expect(turn.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 900, outputTokens: 20 });
  });

  it("v7 形状:inputTokenDetails 的 cacheRead 与 cacheWrite 都从总量里扣出", () => {
    const turn = turnFromAiSdk({
      text: "ok",
      usage: { inputTokens: 1000, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 800, cacheWriteTokens: 100 } },
    });
    expect(turn.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 800, cacheCreationTokens: 100 });
  });
});
