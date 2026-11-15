import { defineEval } from "niceeval";

export default defineEval({
  async test(t) {
    for (let index = 0; index < 140; index++) await t.sandbox.runCommand("printf", [`timing-${index}`]);
  },
});
