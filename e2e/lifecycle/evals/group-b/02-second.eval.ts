import { defineEval } from "niceeval";

export default defineEval({
  description: "observe Group B state after the reset boundary",
  async test(t) {
    const turn = await t.send("run Group B second member");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("group-b:second-complete");
  },
});
