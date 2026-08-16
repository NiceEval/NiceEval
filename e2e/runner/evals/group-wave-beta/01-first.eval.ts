import { defineEval } from "niceeval";

export default defineEval({
  description: "beta first",
  async test(t) {
    await t.send("beta first");
  },
});
