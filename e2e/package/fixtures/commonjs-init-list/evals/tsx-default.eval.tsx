import { defineEval } from "niceeval";
import { isTrue } from "niceeval/expect";

const identity = <T,>(value: T): T => value;

export default identity(defineEval({
  description: "TSX package consumer",
  async test(t) {
    t.check(true, isTrue("installed package TSX entry is loadable"));
  },
}));
