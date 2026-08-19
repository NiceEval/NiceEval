import { defineEval } from "niceeval";
import { jsonMatch, pattern, toolMatch } from "niceeval/expect";

// 这条 eval 验证 agent 遇到实时天气问题时会走工具，而不是直接编一个答案。
//
// 关键检查有两层：先确认调用 get_weather 且 city 参数是北京，再确认最终回复确实使用了工具结果。
// Judge 断言是必需判据；缺少 NICEEVAL_JUDGE_KEY 时它会 unavailable，并让 Attempt errored。
export default defineEval({
  judge: true,
  description: "测试 agent 在实时天气问题中正确调用工具并基于结果作答的能力",

  async test(t) {
    const turn = await t.send("北京今天天气怎么样？");
    await turn.succeeded().orStop();

    await t.group("调用 get_weather 且城市正确", () => {
      t.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "北京" }) }));
      // 回复里要出现天气信息的可见证据，避免“调了工具但没有回答用户”的情况也通过。
      t.check(turn.message, pattern(/°C|气温|天气|晴|多云|雨/));
    });

    // 「是否走了工具」由上面的 t.calledTool 确定性把关;judge 只看对话文本、看不到工具调用,
    // criteria 只评回复本身的质量。
    turn.judge.autoevals
      .closedQA("助手是否给出了具体的天气数据(温度或天气状况)，而不是拒绝回答或含糊其辞？")
      .gate(0.7);
  },
});
