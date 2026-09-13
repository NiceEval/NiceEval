import { equals } from "niceeval/expect";
import { customCreateFailure } from "../fixtures/custom-applications.ts";

export default customCreateFailure.defineEval({
  description: "create 部分失败仍关闭已登记资源",
  async test(t) {
    // create() always fails first; reaching this callback would be a product bug.
    t.check("unexpected", equals("never-reached")).label("create 失败后不执行 Eval");
  },
});
