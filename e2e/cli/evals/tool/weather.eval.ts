import { defineEval } from "niceeval";

// normal 实验的正例之一:一次确定性工具调用往返(get_weather),验证公开 tool call/result
// 事件而不只是文本。与 greet/hello 分处不同 id 前缀,供 scripts/verify.ts 断言 eval id 前缀确实收窄了
// 实际运行集合。
export default defineEval({
  description: "tool/weather:确定性 Agent 一次工具调用(get_weather),验证 calledTool 走通",
  async test(t) {
    const turn = await t.send(
      "What is the weather like in Brooklyn right now? You must call the get_weather tool to check, do not guess.",
    );
    await turn.succeeded().stopOnFailure();
    turn.calledTool("get_weather", { input: { city: /Brooklyn/i } });
  },
});
