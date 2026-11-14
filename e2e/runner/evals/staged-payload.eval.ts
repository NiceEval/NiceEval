import { strictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    const expected = createHash("sha256");
    const chunk = Buffer.alloc(64 * 1024, 97);
    for (let index = 0; index < 768; index++) expected.update(chunk);
    const actual = await t.sandbox.runShellOrThrow("sha256sum /tmp/staged-payload.bin");
    strictEqual(actual.stdout.split(" ")[0], expected.digest("hex"));
  },
});
