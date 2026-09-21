import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "Read a conversation longer than one generic execution page",
  async test(t) {
    for (let index = 0; index < 20; index += 1) {
      const turn = await t.send(`Conversation step ${index}`);
      await turn.succeeded().orStop();
    }
    t.check(true, equals(true)).gate();
  },
});
