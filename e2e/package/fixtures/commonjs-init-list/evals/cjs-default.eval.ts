import { defineEval } from "niceeval";
import { isTrue } from "niceeval/expect";

export default defineEval({
  description: "default CommonJS package consumer",
  async test(t) {
    t.assert(t.check(true, isTrue("installed package subpath is loadable")));
  },
});
