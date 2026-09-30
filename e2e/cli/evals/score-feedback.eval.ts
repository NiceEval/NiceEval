import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";

export default {
  zero: defineScoreEval({
    description: "完整零分也是有效评分，不表示目标达成",
    test(t) { t.score(0).label("zero earned"); },
  }),
  gated: defineScoreEval({
    description: "完整评分遇到 failed gate 仍为失败",
    test(t) {
      t.score(2).label("earned before gate");
      t.check("actual", equals("expected")).gate().label("required gate");
    },
  }),
  partial: defineScoreEval({
    description: "执行错误后的分数下界不是有效评分",
    test(t) {
      t.score(3).label("earned before error");
      throw new Error("score-feedback partial execution");
    },
  }),
};
