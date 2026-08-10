import { defineEval } from "niceeval";
import { equals } from "niceeval/expect";
import { checkImportedSnapshot } from "./source-snapshot/assertions.ts";

const ENTRY_SNAPSHOT = "ENTRY_SNAPSHOT_BEFORE";

export default defineEval({
  description: "source-snapshot:入口与被导入断言模块都必须在运行时冻结",

  async test(t) {
    t.check(ENTRY_SNAPSHOT, equals(ENTRY_SNAPSHOT));
    checkImportedSnapshot(t);
  },
});
