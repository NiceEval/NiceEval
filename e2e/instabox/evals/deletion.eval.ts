import { defineEval } from "niceeval";

export default defineEval({
  description: "Finish only after the remote Machine is deleted",
  async test(t) {
    await t.sandbox.runCommandOrThrow("true");
  },
});
