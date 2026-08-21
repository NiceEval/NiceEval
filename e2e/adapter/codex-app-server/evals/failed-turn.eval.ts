import { defineEval } from "niceeval";

export default defineEval({
  description: "failed Turn 的原生原因进入 scope assertion 失败摘要",
  async test(t) {
    const turn = await t.send("return the deterministic failed turn");
    turn.succeeded();
  },
});
