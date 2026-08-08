import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "large show --json payload with an independent tail sentinel",
  async test(t) {
    for (let index = 0; index < 5_000; index += 1) {
      const expected = index === 4_999 ? "tail-sentinel" : `expected-${index}`;
      t.check(`actual-${index}`, equals(expected));
    }
  },
});
