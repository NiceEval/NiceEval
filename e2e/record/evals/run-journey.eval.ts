import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  description: "publish one Attempt before the next slot is interrupted",
  async test(t) {
    const turn = await t.send("publish this Attempt");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("run-journey-attempt-published"));
    if (turn.message.includes("niceeval-unpublished-attempt-canary-")) {
      const endpoint = process.env.NICEEVAL_RUN_JOURNEY_ENDPOINT;
      if (endpoint === undefined) throw new Error("Run Journey Eval requires its backend endpoint");
      const response = await fetch(`${endpoint}/assertion/1`, { method: "POST", signal: t.signal });
      if (!response.ok) throw new Error(`Run Journey assertion barrier returned HTTP ${response.status}`);
    }
  },
});
