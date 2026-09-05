import { defineEval, defineJudge, judge } from "niceeval";

const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: {
    criterion: judge.referenceText({ name: "criterion", text: "助手是否用一两句话正常介绍了自己,而不是报错或答非所问?" }),
  },
});

// 这条 eval 验证 agent 能正常问答且不瞎调工具。断言依据全部来自 UI Message Stream 协议帧
// (uiMessageStreamAgent 直构);协议帧里没有 usage,所以这里不做用量断言(OTel span 只进瀑布图)。
export default defineEval({
  judge: judging,
  description: "测试 agent 能正常问答且不瞎调工具",

  async test(t) {
    const turn = await t.send("用一句话介绍一下你自己,这轮不用查天气也不用算数。");
    await turn.succeeded().orStop();

    await t.group("正常收发、没有多余工具调用", () => {
      t.succeeded();
      t.usedNoTools();
    });

    const check = judge.check({
      recipe: judging.recipes[0],
      material: { task: turn.material.input, reply: turn.material.reply, criterion: judging.material.criterion },
    });
    turn.check(check, judge.llm().atLeast(0.6)).gate();
  },
});
