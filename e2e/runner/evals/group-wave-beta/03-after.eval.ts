import { defineEval } from "niceeval";

export default defineEval({
  description: "beta after slow lane gap",
  async test(t) {
    await t.send("beta after");
  },
});
