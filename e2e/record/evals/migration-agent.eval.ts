import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  async test(t) {
    const turn = await t.send("current");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("agent:current"))
      .label("migration-agent-assertion-application-agentId");
  },
});
