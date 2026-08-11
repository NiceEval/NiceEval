import { defineEval } from "niceeval";

export default defineEval({
  description: "observe Group A state after the reset boundary",
  async test(t) {
    const turn = await t.send("run Group A second member");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("group-a:second-complete");
  },
});
