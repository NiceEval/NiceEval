import { defineEval } from "niceeval";

export default defineEval({
  description: "create Group B state before the reset boundary",
  async test(t) {
    const turn = await t.send("run Group B first member");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("group-b:first-complete");
  },
});
