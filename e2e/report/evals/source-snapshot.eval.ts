import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
import { checkImportedSnapshot } from "./source-snapshot/assertions.ts";

const ENTRY_SNAPSHOT = "ENTRY_SNAPSHOT_BEFORE";

export default defineEval({
  description: "source-snapshot: entry and imported assertion must freeze at runtime",

  async test(t) {
    t.check(ENTRY_SNAPSHOT, equals(ENTRY_SNAPSHOT));
    checkImportedSnapshot(t);
  },
});
