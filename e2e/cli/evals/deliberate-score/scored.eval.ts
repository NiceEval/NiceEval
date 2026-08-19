import { defineScoreEval } from "niceeval";

/** Deterministic score-kind result for the CLI Human completion contract. */
export default defineScoreEval({
  description: "deliberate-score:固定得到 2 分",
  test(t) {
    t.score(2).label("deterministic CLI score");
  },
});
