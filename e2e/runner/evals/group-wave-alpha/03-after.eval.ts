import { defineEval } from "niceeval";

export default defineEval({
  description: "alpha after slow lane gap",
  async test(t) {
    await t.send("alpha after");
  },
});
