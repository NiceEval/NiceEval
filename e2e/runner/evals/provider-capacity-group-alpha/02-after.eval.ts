import { defineEval } from "niceeval";

export default defineEval({
  description: "existing reusable lane continues while another group waits for capacity",
  async test(t) {
    await t.send("alpha after");
  },
});
