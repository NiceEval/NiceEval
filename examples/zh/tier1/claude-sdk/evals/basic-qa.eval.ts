import { defineEval } from "niceeval";

// 这条 eval 验证 agent 能正常问答、不瞎调工具,顺带冒烟 usage 有没有从 result 消息的
// usage/total_cost_usd 正确映射进 Turn.usage。
export default defineEval({
  description: "测试 agent 能正常问答且不瞎调工具",

  async test(t) {
    const turn = await t.send("用一句话介绍一下你自己,这轮不用查天气也不用算数。");
    await turn.succeeded().stopOnFailure();

    await t.group("正常收发、没有多余工具调用", () => {
      t.succeeded();
      t.usedNoTools();
    });

    t.maxTokens(20_000);

    t.judge.autoevals.closedQA("助手是否用一两句话正常介绍了自己,而不是报错或答非所问?").gate(0.6);
  },
});
