import { defineEval } from "niceeval";

export default defineEval({
  description: "usage 逐轮到位",
  async test(t) {
    const turn = await t.send("用一句话回答:1+1等于几?不要调用任何工具。");
    await turn.succeeded().stopOnFailure();
    turn.maxTokens(50_000);
  },
});
