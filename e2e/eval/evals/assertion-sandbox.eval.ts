import { defineEval } from "niceeval";
import {
  commandSucceeded,
  includes,
  isTrue,
  toolMatch,
} from "niceeval/expect";

export default defineEval({
  description:
    "确定性 Sandbox Agent 的真实 diff、文件与 shell 证据由公开断言判定",
  async test(t) {
    await t.sandbox.writeText("fixture/changed.txt", "before-agent-change\n");
    await t.sandbox.writeText("fixture/delete-me.txt", "delete-me\n");
    t.check(
      await t.sandbox.pathExists("fixture/delete-me.txt"),
      isTrue("seeded deletion fixture"),
    );

    const turn = await t.send("assertion/sandbox");
    turn.succeeded().label("Sandbox Agent completed");

    await t.group("Sandbox 结果断言", async () => {
      turn.check(
        turn.toolCalls,
        toolMatch("workspace_edit", { status: "completed" }).exactly(1),
      );
      t.sandbox.changedPaths([
        "fixture/changed.txt",
        "fixture/created.txt",
        "fixture/delete-me.txt",
      ]).label("exact agent-attributed endpoint paths");
      t.sandbox.fileChanged("fixture/changed.txt", {
        status: "modified",
        before: includes("before-agent-change"),
        after: includes("after-agent-change"),
      }).label("modified endpoint pair belongs to one send window");
      t.sandbox.fileChanged("fixture/created.txt", {
        status: "added",
        after: includes("created-by-agent"),
      });
      t.sandbox.fileDeleted("fixture/delete-me.txt");
      t.sandbox.notInDiff(/forbidden-diff-token/, { content: "both" });
      const probe = await t.sandbox.runShell(
        "test -f fixture/changed.txt && test ! -e fixture/delete-me.txt",
      );
      t.check(probe, commandSucceeded());
    });
  },
});
