import { equals } from "niceeval/expect";
import { artifactAdapter } from "../adapters/artifacts.ts";

export default artifactAdapter.defineEval({
  async test(t) {
    t.check(await t.produce(), equals(true)).label("same labels retain distinct artifact identities");
  },
});
