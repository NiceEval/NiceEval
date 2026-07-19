import { defineEval } from "niceeval";

// 工具调用协议行为:tools channel 的 started/finished 按 tool call ID 配对进入标准事件流
// (get_weather 经真实 LangGraph ToolNode 执行,见 agents/langgraph.ts 头注释)。
// 反例:calculate 这轮挂载但没被调用,notCalledTool 断言证明「没调用」在事件流上真的看得出来,
// 不是从最终文本猜的。eventOrder 顺带验证 action.called 先于 action.result 落地
// (对应 docs/engineering/e2e-ci/adapters/langgraph.md「事件顺序与生命周期」一行)。
export default defineEval({
  description: "工具调用:get_weather 经 tools channel started/finished 配对,calculate 本轮未挂载调用",

  async test(t) {
    const turn = await t.send("北京今天天气怎么样?");
    turn.expectOk();

    await t.group("调用 get_weather 且城市正确", () => {
      t.calledTool("get_weather", { input: { city: "北京" }, status: "completed" });
      t.notCalledTool("calculate");
      t.eventOrder(["action.called", "action.result"]);
    });

    t.messageIncludes(/°C|气温|天气|晴|多云|雨|阴/);
  },
});
