import { defineEval } from "niceeval";
import { commandSucceeded, includes, referencesAnyPath, toolMatch } from "niceeval/expect";

// Deterministically failing assertion: the public read face must keep failed distinct
// from errored and JUnit must fold it as <failure>.
export default defineEval({
  description: "deliberate-fail:确定性失败断言",

  async test(t) {
    const turn = await t.send("produce a deterministic forbidden tool call");
    turn.succeeded().label("Turn completed");
    turn.notCalledTool(
      toolMatch("write_file", { input: referencesAnyPath(["report-notes.txt", "evals", "agents"]) }),
    ).label("No private source access");
    turn.notCalledTool(
      toolMatch("write_file", {
        input: referencesAnyPath([
          "package.json",
          "AGENTS.md",
          "CLAUDE.md",
          "INIT.md",
          "node_modules/niceeval",
        ]),
      }),
    ).label("No project guidance access");
    t.check("actual fixture value", includes("expected fixture value"))
      .label("Expected fixture value");
    t.check({
      command: "fixture command",
      exitCode: 0,
      stderr: `${"repeated fixture output ".repeat(32)}LONG_CHECK_SOURCE_TAIL`,
      stdout: "",
    }, commandSucceeded()).label("Long command result");
  },
});
