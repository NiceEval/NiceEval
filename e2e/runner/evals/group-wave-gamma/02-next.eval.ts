import { defineEval } from "niceeval";

export default defineEval({
  description: "gamma next",
  async test(t) {
    await t.send("gamma next");
  },
});
