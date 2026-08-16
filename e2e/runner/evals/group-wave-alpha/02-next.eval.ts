import { defineEval } from "niceeval";

export default defineEval({
  description: "alpha next",
  async test(t) {
    await t.send("alpha next");
  },
});
