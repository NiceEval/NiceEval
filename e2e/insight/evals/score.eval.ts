import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";

// Deterministic Score-kind result: Report owners use it to distinguish score
// evidence from pass verdicts without calling a provider.
export default defineScoreEval({
  description: "score:签入确定性计分结果",
  test(t) {
    t.score(7).label("deterministic report score");
    t.check("actual", equals("expected"))
      .score(1)
      .label("deterministic missed score item");
  },
});
