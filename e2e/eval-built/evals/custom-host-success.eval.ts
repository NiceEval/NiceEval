import { equals } from "niceeval/expect";
import { customHostSuccess } from "../fixtures/custom-applications.ts";

export default customHostSuccess.defineEval({
  async test(t) {
    await t.enterTest();
    t.check("host-ready", equals("host-ready"));
  },
});
