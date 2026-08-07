import { defineEval } from "niceeval";

export default defineEval({
  description: "remain in flight until SIGINT",
  async test(t) {
    await t.send("wait for interrupt");
  },
});
