import { defineEval } from "niceeval";
import { commandSucceeded, excludes, includes, isTrue } from "niceeval/expect";

export default defineEval({
  description: "确定性 Sandbox Agent 的真实 diff、文件与 shell 证据由公开断言判定",
  async test(t) {
    await t.sandbox.writeText("fixture/changed.txt", "before-agent-change\n");
    await t.sandbox.writeText("fixture/delete-me.txt", "delete-me\n");
    t.check(await t.sandbox.pathExists("fixture/delete-me.txt"), isTrue("seeded deletion fixture"));

    const turn = await t.send("assertion/sandbox");
    await turn.succeeded().gate().stopOnFailure();

    await t.group("Sandbox 结果断言", async () => {
      turn.calledTool("workspace_edit", { status: "completed", count: 1 });
      t.sandbox.fileChanged("fixture/changed.txt");
      t.sandbox.fileChanged("fixture/created.txt");
      t.sandbox.fileDeleted("fixture/delete-me.txt");
      t.sandbox.notInDiff(/forbidden-diff-token/);
      t.sandbox.noFailedShellCommands();
      t.check(t.sandbox.file("fixture/changed.txt"), includes("after-agent-change"));
      t.check(t.sandbox.file("fixture/changed.txt"), excludes("before-agent-change"));
      t.check(t.sandbox.file("fixture/created.txt"), includes("created-by-agent"));
      const probe = await t.sandbox.runShell("test -f fixture/changed.txt && test ! -e fixture/delete-me.txt");
      t.check(probe, commandSucceeded());
    });
  },
});
