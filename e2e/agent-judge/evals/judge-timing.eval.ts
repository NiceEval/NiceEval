import { defineScoreEval } from "niceeval";
import { defineAgentJudge, defineJudge } from "niceeval/expect";

export default defineScoreEval({
  async test(t) {
    await t.send("Write application evidence.");
    t.judge(
      "application evidence",
      defineJudge({
        rubric: "Check evidence",
        anchors: [
          { measurement: 0, description: "Absent" },
          { measurement: 1, description: "Present" },
        ],
      }),
    )
      .score(1)
      .label("Ordinary review");
    const review = t.agentJudge(defineAgentJudge({ timeoutMs: 20000 }), { fact: "application.txt" });
    review.judge("First timing question").score(1).label("First timing review");
    review.judge("Second timing question").score(1).label("Second timing review");
  },
});
