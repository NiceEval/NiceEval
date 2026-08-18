import { defineEval } from "niceeval";
import { jsonMatch, toolMatch } from "niceeval/expect";

// 这条 eval 验证 agent 遇到实时天气问题时调 get_weather,而不是直接编一个答案。
// get_weather 不是 gated 工具,它的 operation.started/operation.finished 完全来自 LangSmith span
// 派生,adapter 没有为它写一行帧映射(帧映射只补了 gated 的 calculate,见 agents/langgraph.ts)。
export default defineEval({
  judge: true,
  description: "测试 agent 在天气问题中正确调用 get_weather 并基于结果作答",

  async test(t) {
    const turn = await t.send("北京今天天气怎么样?");
    await turn.succeeded().orStop();

    await t.group("调用 get_weather 且城市正确", () => {
      t.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "北京" }) }));
      t.messageIncludes(/°C|气温|天气|晴|多云|雨|阴/);
    });

    turn.judge.autoevals
      .closedQA("助手是否给出了具体的天气数据(温度或天气状况),而不是拒绝回答或含糊其辞?")
      .gate(0.7);
  },
});
