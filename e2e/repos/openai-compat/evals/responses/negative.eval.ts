// Eval 闭环第 3 行(docs/engineering/e2e-ci/adapters/openai-compat.md):
// Responses 的 output 数组记录本轮全部决定,notCalledTool 反例可信且通过。
// 只有 Responses 路径有这条 Eval——Chat Completions 的协议契约不承诺完整性,
// 本仓库不为它设负断言 Eval(见 agents/chat-completions.ts 与适配器文档)。

import { defineEval } from "niceeval";

export default defineEval({
  description: "Responses 的 output 记录完整决策过程,notCalledTool 反例可信",

  async test(t) {
    const turn = await t.send("Reply with exactly: Hello there. Do not call any tools.");
    turn.expectOk();

    await t.group("没有调用 get_weather(可信负断言)", () => {
      turn.notCalledTool("get_weather");
    });

    await t.group("output_text 变成 message", () => {
      turn.messageIncludes(/hello there/i);
    });
  },
});
