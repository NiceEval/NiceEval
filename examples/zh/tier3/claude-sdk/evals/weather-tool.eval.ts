import { defineEval } from "niceeval";

// 这条 eval 验证 agent 遇到实时天气问题时会调 get_weather,而不是直接编一个答案。
// 工具名是 MCP 命名空间下的真实名字 mcp__demo-tools__get_weather(不是裸的 get_weather),
// 见 agents/claude-sdk.ts 头注释。
export default defineEval({
  description: "测试 agent 在天气问题中正确调用 get_weather 并基于结果作答",

  async test(t) {
    const turn = await t.send("北京今天天气怎么样?");
    await turn.succeeded().stopOnFailure();

    await t.group("调用 get_weather 且城市正确", () => {
      t.calledTool("mcp__demo-tools__get_weather", { input: { city: "北京" } });
      t.messageIncludes(/°C|气温|天气|晴|多云|雨|阴/);
    });

    t.judge.autoevals
      .closedQA("助手是否给出了具体的天气数据(温度或天气状况),而不是拒绝回答或含糊其辞?")
      .atLeast(0.7);
  },
});
