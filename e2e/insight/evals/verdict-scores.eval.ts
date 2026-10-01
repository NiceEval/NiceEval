import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";

const failed = defineScoreEval({
  description: "Complete earned score survives a failed quality gate",
  test(t) {
    t.score(0.61, { weight: 100 }).label("Complete negotiation score");
    t.check("actual", equals("expected")).gate().label("Failed quality gate");
  },
});

const zero = defineScoreEval({
  description: "Complete zero score survives a failed quality gate",
  test(t) {
    t.score(0, { weight: 200 }).label("Complete combat zero score");
    t.check("actual", equals("expected")).gate().label("Failed quality gate");
  },
});

const partial = defineScoreEval({
  description: "Known contribution remains partial when another score source is unavailable",
  test(t) {
    t.score(9).label("Known partial contribution");
    t.score({ state: "unavailable", reason: "fixture-score-source-missing" }, { weight: 20 })
      .label("Unavailable remaining contribution");
  },
});

const unavailable = defineScoreEval({
  description: "Unavailable score source does not manufacture zero",
  test(t) {
    t.score({ state: "unavailable", reason: "fixture-score-source-missing" }, { weight: 20 })
      .label("Unavailable contribution");
  },
});

export default { failed, zero, partial, unavailable };
