import { defineEval } from "niceeval";

export default defineEval({
  description: "reuse one Docker sandbox, then remain in flight until SIGINT",
  async test(t) {
    const turn = await t.send("wait for interrupt");
    t.assert(turn.succeeded());
  },
});
