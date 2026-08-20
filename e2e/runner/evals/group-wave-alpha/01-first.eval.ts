import { defineEval } from "niceeval";

export default defineEval({
  description: "alpha first",
  async test(t) {
    await t.send("alpha first");
  },
});
