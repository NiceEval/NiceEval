import { defineEval } from "niceeval";
import { includes } from "niceeval/expect";

export default defineEval({
  async test(t) {
    const turn = await t.send("predecessor");
    await turn.succeeded().orStop();
    t.check(turn.message, includes("agent:predecessor"))
      .label("migration-agent-assertion-application-agentId");
  },
});
