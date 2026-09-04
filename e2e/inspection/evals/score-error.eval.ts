import { defineScoreEval } from "niceeval";

export default defineScoreEval({
  description: "score-error: 签入确定性 Score execution error",
  test(t) {
    t.score(1).label("partial score before deterministic error");
    throw new Error("deterministic score error");
  },
});
