import { defineEval } from "niceeval";

export default defineEval({
  description: "beta next",
  async test(t) {
    await t.send("beta next");
  },
});
