import assert from "node:assert/strict";
import { satisfies } from "niceeval/expect";
import { flagsAdapter } from "../fixtures/adapter-parse-flags.ts";

export default flagsAdapter.defineEval({
  test(t) {
    t.check(t.readLimit(), satisfies<number>("normalized limit", (value) => value === 2));
    assert.deepEqual(t.flags, { strategy: "safe", limit: 2, enabled: true });
  },
});
