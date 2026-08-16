import { defineEval } from "niceeval";

export default defineEval({
  description: "gamma slow holder",
  async test(t) {
    await t.send("gamma first");
  },
});
