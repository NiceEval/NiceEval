import { defineEval } from "niceeval";
import { closedQA, type JudgeMaterial } from "niceeval/expect";

export default defineEval({
  description: "配置 Judge 后，一次质量检查发布一个可读的 measurement artifact",
  judge: true,
  async test(t) {
    const turn = await t.send("assertion/judge");
    await turn.succeeded().orStop();
    const material: JudgeMaterial = { input: turn.input, output: turn.message };
    turn.check(material, closedQA("回复是否含确定性 marker？").atLeast(1))
      .gate()
      .label("Judge marker");
  },
});
