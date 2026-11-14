import { defineEval } from "niceeval";
export default defineEval({
  async test(t) {
    for (const [pattern, options] of [
      ["text", undefined],
      [/x/, null],
      [/x/, { content: "invalid" }],
      [/x/, { unknown: true }],
    ] as const) {
      let rejected = false;
      try {
        t.sandbox.inDiff(pattern as never, options as never);
      } catch (error) {
        rejected = error instanceof TypeError;
      }
      if (!rejected) throw new Error("Expected inDiff construction TypeError");
    }
    await t.sandbox.writeText("fixture/content.txt", "unchanged-context-token\nremoved-content-token\n");
    await t.sandbox.runShellOrThrow("rm -f fixture/path-token.txt");
    await t.send("change");
    t.sandbox.inDiff(/added-content-token/g, { content: "added" }).label("added witness");
    t.sandbox.inDiff(/removed-content-token/y, { content: "removed" }).label("removed witness");
    t.sandbox.inDiff(/path-token/).label("path witness");
    t.sandbox
      .inDiff(/removed-content-token/, { content: "added" })
      .label("unselected side")
      .optional();
    t.sandbox
      .inDiff(/unchanged-context-token/)
      .label("unchanged context")
      .optional();
    t.sandbox
      .inDiff(/absent-content-token/)
      .label("no witness")
      .optional();
    t.sandbox.notInDiff(/absent-content-token/).label("legacy absence");
  },
});
