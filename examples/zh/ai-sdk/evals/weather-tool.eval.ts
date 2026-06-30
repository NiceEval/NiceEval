import { defineEval } from "fasteval";

// 评测：问天气会调用 get_weather（参数城市正确），并基于工具结果作答。
//
// 考的是「问什么 → 调对什么工具」+ 不凭空编造实时信息。
// judge 断言没配 judge key 时会自动跳过,不必手动 gate。
export default defineEval({
  description: "AI 助手：问天气调用 get_weather",

  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    turn.expectOk();

    await t.group("调用 get_weather 且城市正确", () => {
      t.calledTool("get_weather", { input: { city: "北京" } });
      t.messageIncludes(/°C|气温|天气|晴|多云|雨/);
    });

    t.judge.agent("助手是否基于工具返回的天气数据作答，而不是凭空编造温度？").atLeast(0.7);
  },
});
