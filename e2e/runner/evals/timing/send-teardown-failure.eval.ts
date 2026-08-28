import { defineEval } from "niceeval";

export default defineEval({
  description: "send failure remains primary when teardown also fails",
  async test(t) {
    await t.send("send fails");
  },
});
