import { defineEval } from "niceeval";

export default defineEval({
  description: "create Group A state before the reset boundary",
  async test(t) {
    const turn = await t.send("run Group A first member");
    await turn.succeeded().stopOnFailure();
    t.messageIncludes("group-a:first-complete");
  },
});
