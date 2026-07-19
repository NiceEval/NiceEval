// Eval 闭环第 1 行(docs/engineering/e2e-ci/adapters/openai-compat.md):
// Chat Completions 的 tool_calls → action.called,content → message,usage 到位。
// 一个 eval、两轮:第一轮触发工具调用(断言 action.called + usage),第二轮开新 session
// 触发纯文本回复(断言 message)——两轮合起来覆盖 fromChatCompletion 的三条零映射,不需要
// 在 Agent 里手写一个完整的工具执行循环。
//
// 不写负断言(notCalledTool):Chat Completions 的协议契约不承诺响应记录完整决策过程,
// 见仓库 agents/chat-completions.ts 与适配器文档。

import { defineEval } from "niceeval";
import { isDefined, satisfies } from "niceeval/expect";

export default defineEval({
  description: "Chat Completions 响应经 fromChatCompletion 零映射:tool_calls/content/usage",

  async test(t) {
    const weatherTurn = await t.send(
      "What's the weather in Brooklyn right now? You must call the get_weather tool to check — do not answer from memory.",
    );
    weatherTurn.expectOk();

    await t.group("tool_calls 变成 action.called", () => {
      weatherTurn.calledTool("get_weather", { input: { city: "Brooklyn" } });
    });

    await t.group("usage 到位", () => {
      t.check(weatherTurn.usage, isDefined("Chat Completions 响应带 usage"));
      t.check(
        weatherTurn.usage?.inputTokens,
        satisfies((v) => typeof v === "number" && v > 0, "inputTokens 为正数"),
      );
      t.check(
        weatherTurn.usage?.outputTokens,
        satisfies((v) => typeof v === "number" && v > 0, "outputTokens 为正数"),
      );
      // cached tokens 是 best-effort:prompt_tokens_details.cached_tokens 在冷调用上合法为 0,
      // fromChatCompletion 此时不填 cacheReadTokens(见 src/agents/openai-compat.ts),
      // 所以这里不做硬断言,只在字段存在时校验类型。
      if (weatherTurn.usage?.cacheReadTokens !== undefined) {
        t.check(
          weatherTurn.usage.cacheReadTokens,
          satisfies((v) => typeof v === "number" && v >= 0, "cacheReadTokens 存在时为非负数"),
        );
      }
    });

    // 新 session:上一轮的 assistant 消息带 tool_calls,同一 session 内下一条 user 消息必须先
    // 回答每个 tool_call_id(Chat Completions 协议要求),所以用干净的新 session 测纯文本分支。
    const plain = t.newSession();
    const plainTurn = await plain.send("Reply with exactly: Hello there. Do not call any tools.");
    plainTurn.expectOk();

    await t.group("content 变成 message", () => {
      plainTurn.messageIncludes(/hello there/i);
    });
  },
});
