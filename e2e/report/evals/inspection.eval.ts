import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";

export default defineEval({
  description: "inspection: 生成稳定的 passed Attempt 与 Evidence",
  test(t) {
    t.check("inspection-fixture", equals("inspection-fixture"));
  },
});
