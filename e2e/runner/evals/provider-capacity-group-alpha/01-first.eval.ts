import { defineEval } from "niceeval";

export default defineEval({
  description: "first member of the reusable capacity lane",
  async test(t) {
    await t.send("alpha first");
  },
});
