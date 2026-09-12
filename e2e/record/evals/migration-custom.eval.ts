import { equals } from "niceeval/expect";
import { migrationCustom } from "../adapters/migration-custom.ts";

export default migrationCustom.defineEval({
  test(t) {
    t.check(t.value(), equals("custom:current"))
      .label("migration-custom-assertion-application-agentId");
  },
});
