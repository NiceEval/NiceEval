import { equals } from "niceeval/expect";
import { migrationCustom } from "../applications/migration-custom.ts";

export default migrationCustom.defineEval({
  test(t) {
    t.check(t.value(), equals("custom:predecessor"))
      .label("migration-custom-assertion-application-agentId");
  },
});
