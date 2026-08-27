// owner: docs/engineering/testing/e2e/eval.md#eval-active-progress-redaction
import { defineEval } from "niceeval";
import { isTrue } from "niceeval/expect";

const C0_SECRET = "active-secret-c0";
const C1_SECRET = "active-secret-c1";
const MULTIBYTE_GRAPHEME = "🧑🏽‍💻";

export default defineEval({
  description: "ACTIVE detail 移除 C0/C1 后仍脱敏已知 secret",
  async test(t) {
    const registered = await t.sandbox.runCommand("true", [], {
      sensitiveValues: [C0_SECRET, C1_SECRET],
    });
    t.check(registered.exitCode === 0, isTrue("sensitive-value registration command completed"));
    t.progress({
      message: `tool: active-se\u0001cret-c0 active-se\u009d0;ignored\u009ccret-c1 ${MULTIBYTE_GRAPHEME.repeat(40)}`,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
  },
});
