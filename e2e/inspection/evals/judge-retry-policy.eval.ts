import { Effect } from "effect";
import { defineJudge, defineScoreMatch } from "niceeval/expect";
import { judgeUsageApplication } from "../adapters/judge-usage.ts";

const ordinary = defineJudge({
  rubric: "Evaluate whether the supplied answer is correct.",
  anchors: [
    { measurement: 0, description: "Incorrect" },
    { measurement: 1, description: "Correct" },
  ],
});
const managed = defineScoreMatch<string>({
  name: "retry-policy-score",
  version: "1",
  config: {},
  llm: {},
  score: (answer, ctx) =>
    Effect.map(
      ctx.llm.score({
        rubric: "Evaluate correctness",
        material: { answer },
        anchors: [
          { measurement: 0, description: "Incorrect" },
          { measurement: 1, description: "Correct" },
        ],
      }),
      (result) => result.measurement,
    ),
});
export default judgeUsageApplication.defineEval({
  test(t) {
    t.check("Paris", process.env.NICEEVAL_E2E_RETRY_MATCH === "managed" ? managed : ordinary)
      .gate(1)
      .label("Retry policy");
  },
});
