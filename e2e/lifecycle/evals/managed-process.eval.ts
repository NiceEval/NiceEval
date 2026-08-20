import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "managed process transport preserves bytes and bounded lifecycle",
  async test(t) {
    const turn = await t.send("exercise managed process transport");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("managed-process-contract-ok"));
  },
});
