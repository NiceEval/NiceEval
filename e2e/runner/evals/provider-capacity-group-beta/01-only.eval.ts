import { defineEval } from "niceeval";

export default defineEval({
  description: "new group starts after the completed reusable lane releases capacity",
  async test(t) {
    await t.send("beta only");
  },
});
