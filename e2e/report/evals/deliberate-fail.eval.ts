import { defineEval } from "niceeval";
import { includes, referencesAnyPath, toolMatch } from "niceeval/expect";

// Deterministically failing assertion: the public read face must keep failed distinct
// from errored and JUnit must fold it as <failure>.
export default defineEval({
  description: "deliberate-fail:确定性失败断言",

  async test(t) {
    const turn = await t.send("produce a deterministic forbidden tool call");
    turn.succeeded().label("Turn completed");
    turn.notCalledTool(
      toolMatch({ input: referencesAnyPath(["report-notes.txt", "evals", "agents"]) }),
    ).label("No private source access");
    t.check("actual fixture value", includes("expected fixture value"))
      .label("Expected fixture value");
  },
});
