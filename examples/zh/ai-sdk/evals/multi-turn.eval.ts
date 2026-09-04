import { defineEval, defineJudge, judge } from "niceeval";
import { includes, jsonMatch, toolMatch } from "niceeval/expect";

const judging = defineJudge({
  recipes: [judge.recipes.closedQA],
  material: { criterion: judge.referenceText({ name: "criterion", text: "回复是否给出了北京的具体天气信息(温度或天气状况)？" }) },
});

// 这条 eval 验证同一个 session 里连续发消息时，agent 能保持会话并在需要时调用工具。
//
// 第一轮是纯文本算术，检查上一轮回复会被 t.reply 正确暴露出来。
// 第二轮切到实时天气，检查同一会话里的后续问题仍能触发 get_weather。
export default defineEval({
  judge: judging,
  description: "测试 agent 在多轮对话中保持会话并按需调用工具的能力",

  async test(t) {
    const first = await t.send("1+1=?");
    await first.succeeded().orStop();
    t.check(first.message, includes("2"));

    const second = await t.send("北京今天天气怎么样？");
    t.calledTool(toolMatch("get_weather", { input: jsonMatch({ city: "北京" }) }));
    t.check(second.message, includes("北京"));

    // 「是否调了天气工具」由上面的 t.calledTool 确定性把关；Judge 只读取显式提供的对话材料，
    // 不要求它验证工具使用。
    second
      .check(judge.check({
        recipe: judging.recipes[0],
        material: { task: second.material.input, reply: second.material.reply, criterion: judging.material.criterion },
      }), judge.llm().atLeast(0.8))
      .gate();
  },
});
