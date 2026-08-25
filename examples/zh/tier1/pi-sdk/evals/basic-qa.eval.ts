import { defineEval } from "niceeval";
import { closedQA } from "niceeval/expect";

// 这条 eval 验证 agent 能正常问答、不瞎调工具,顺带冒烟 usage 有没有正确从
// message_end 的 AssistantMessage.usage 累加进 Turn.usage。
export default defineEval({
  judge: true,
  description: "测试 agent 能正常问答且不瞎调工具",

  async test(t) {
    const turn = await t.send("用一句话介绍一下你自己,这轮不用查天气也不用算数。");
    await turn.succeeded().orStop();

    await t.group("正常收发、没有多余工具调用", () => {
      t.succeeded();
      t.usedNoTools();
    });

    // usage 冒烟:拿不到就应该是 0,不该抛错;上限给得宽松,只为证明数字不是编的。
    t.maxTokens(20_000);

    turn.check(
      { input: turn.input, output: turn.message },
      closedQA("助手是否用一两句话正常介绍了自己,而不是报错或答非所问?").atLeast(0.6),
    ).gate();
  },
});
