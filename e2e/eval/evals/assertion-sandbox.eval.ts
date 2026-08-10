import { defineEval } from "niceeval";
import {
  commandSucceeded,
  excludes,
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
    await t.require(turn.succeeded());

    await t.group("Sandbox 结果断言", async () => {
      t.check(
        turn.calledTool(toolMatch("workspace_edit", { status: "completed" }), {
          count: 1,
        }),
      );
      t.check(t.sandbox.fileChanged("fixture/changed.txt"));
      t.check(t.sandbox.fileChanged("fixture/created.txt"));
      t.check(t.sandbox.fileDeleted("fixture/delete-me.txt"));
      t.check(t.sandbox.notInDiff(/forbidden-diff-token/));
      t.check(t.sandbox.noFailedShellCommands());
      t.check(
        t.sandbox.file("fixture/changed.txt"),
        includes("after-agent-change"),
      );
      t.check(
        t.sandbox.file("fixture/changed.txt"),
        excludes("before-agent-change"),
      );
      t.check(
        t.sandbox.file("fixture/created.txt"),
        includes("created-by-agent"),
      );
      const probe = await t.sandbox.runShell(
        "test -f fixture/changed.txt && test ! -e fixture/delete-me.txt",
      );
      t.check(probe, commandSucceeded());
    });
  },
});
