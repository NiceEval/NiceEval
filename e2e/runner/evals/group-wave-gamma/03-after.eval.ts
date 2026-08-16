import { defineEval } from "niceeval";

export default defineEval({
  description: "gamma after holder",
  async test(t) {
    await t.send("gamma after");
  },
});
