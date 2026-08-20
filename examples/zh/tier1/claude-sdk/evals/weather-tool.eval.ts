import { defineEval } from "niceeval";
import { jsonMatch, pattern, toolMatch } from "niceeval/expect";

// 这条 eval 验证 agent 遇到实时天气问题时会调 get_weather,而不是直接编一个答案。
// 工具名是 MCP 命名空间下的真实名字 mcp__demo-tools__get_weather(不是裸的 get_weather),
// 见 agents/claude-sdk.ts 头注释。
export default defineEval({
  judge: true,
  description: "测试 agent 在天气问题中正确调用 get_weather 并基于结果作答",

  async test(t) {
    const turn = await t.send("北京今天天气怎么样?");
    await turn.succeeded().orStop();

    await t.group("调用 get_weather 且城市正确", () => {
      t.calledTool(toolMatch("mcp__demo-tools__get_weather", { input: jsonMatch({ city: "北京" }) }));
      t.check(turn.message, pattern(/°C|气温|天气|晴|多云|雨|阴/));
    });

    turn.judge.autoevals
      .closedQA("助手是否给出了具体的天气数据(温度或天气状况),而不是拒绝回答或含糊其辞?")
      .gate(0.7);
  },
});
