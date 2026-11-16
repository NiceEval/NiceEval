import { strictEqual } from "node:assert";
import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    strictEqual((await t.sandbox.runShell("test -f /tmp/install-repaired")).exitCode, 0);
  },
});
