import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineScoreEval({
  description: "overview-secondary: 固定第二个计分 Eval，验证 Overview 跨题总分",
  async test(t) {
    await t.send("produce secondary overview evidence");
    t.check("secondary", equals("secondary"))
      .score(2)
      .label("Secondary score contribution");
  },
});
