import { defineScoreEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineScoreEval({
  description: "overview-scale: generate a benchmark-sized set of closed Assertion evidence",
  async test(t) {
    await t.send("produce deterministic inspection evidence");
    await t.group(`overview-scale-${"evidence".repeat(28)}`, async () => {
      for (let index = 0; index < 80; index += 1) {
        t.check(`overview-scale-${index}`, equals(`overview-scale-${index}`))
          .label(`Overview scale assertion ${index}`);
      }
    });
  },
});
