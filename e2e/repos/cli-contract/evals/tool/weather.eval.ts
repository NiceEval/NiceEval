import { defineEval } from "niceeval";

// normal 实验的正例之一:一次真实工具调用往返(get_weather),换回真实 tool_calls 而不只是
// 文本。与 greet/hello 分处不同 id 前缀,供 scripts/verify.ts 断言 eval id 前缀选择确实收窄了
// 实际运行集合。
export default defineEval({
  description: "tool/weather:真实 DeepSeek 网关一次工具调用(get_weather),验证 calledTool 走通",
  async test(t) {
    const turn = await t.send(
      "What is the weather like in Brooklyn right now? You must call the get_weather tool to check, do not guess.",
    );
    turn.expectOk();
    turn.calledTool("get_weather", { input: { city: /Brooklyn/i } });
  },
});
