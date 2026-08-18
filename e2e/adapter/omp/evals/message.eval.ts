import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export const OMP_MARKER = "NICEEVAL-OMP-ADAPTER-E2E-817";

export default defineEval({
  description: "OMP 完成一轮消息并保留可区分输出",
  async test(t) {
    const turn = await t.send(`只回答这一段文本：${OMP_MARKER}`);
    await turn.succeeded().orStop();
    t.check(turn.message, includes(OMP_MARKER));
  },
});
