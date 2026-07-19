// 协议行为:pi-agent-core 的 tool_execution_start/end 经 fromPiAgentEvents 归一进标准事件流,
// call 与 result 按 toolCallId 配对成立;未触发的工具走 notCalledTool 反例断言。
import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "get_weather 工具执行正确归一(call/result 配对、入参保真);未触发的工具不出现",
  async test(t) {
    const turn = await t.send("北京今天天气怎么样?调用工具查询,不要自己编造数据。");
    turn.succeeded();

    turn.calledTool("get_weather", { input: { city: /北京/ }, count: 1, status: "completed" });
    turn.notCalledTool("calculate");
    turn.notCalledTool("send_alert");

    t.check(t.reply, includes(/°C|气温|天气|晴|多云|雷阵雨|阴/));
  },
});
