import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export const DEEPSEEK_HARNESS_MARKER = "NICEEVAL-DEEPSEEK-HARNESS-E2E-817";

export default defineEval({
  description: "DeepSeek Harness 完成一轮消息并保留可区分输出",
  async test(t) {
    const turn = await t.send(`只回答这一段文本：${DEEPSEEK_HARNESS_MARKER}`);
    await turn.succeeded().orStop();
    t.check(turn.message, includes(DEEPSEEK_HARNESS_MARKER));
  },
});
