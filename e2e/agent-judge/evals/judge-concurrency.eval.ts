import { defineScoreEval } from "niceeval";
import { defineAgentJudge, defineJudge } from "niceeval/expect";

export default defineScoreEval({
  async test(t) {
    await t.send("Write evidence.");
    for (let index = 0; index < 4; index++) {
      t.judge(
        `ordinary-${index}`,
        defineJudge({
          rubric: `ordinary-${index}`,
          anchors: [
            { measurement: 0, description: "Absent" },
            { measurement: 1, description: "Present" },
          ],
        }),
      )
        .score(1)
        .label(`ordinary-${index}`);
    }
    if (process.env.NICEEVAL_E2E_CONCURRENT_AGENT !== undefined) {
      for (const name of ["alpha", "beta", "boundary", "gamma", "delta"]) {
        const review = t.agentJudge(
          defineAgentJudge({
            concurrent: name !== "boundary",
            timeoutMs:
              process.env.NICEEVAL_E2E_CONCURRENT_AGENT === "timeout" && name === "alpha"
                ? 500
                : process.env.NICEEVAL_E2E_CONCURRENT_AGENT === "queue"
                  ? 1500
                  : 20000,
          }),
          { name },
        );
        review.judge(`${name}-first`).score(1).label(`${name}-first`);
        review.judge(`${name}-second`).score(1).label(`${name}-second`);
      }
    }
  },
});
