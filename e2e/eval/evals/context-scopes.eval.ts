import { defineEval } from "niceeval";
import { equals, excludes, includes } from "niceeval/expect";

export default defineEval({
  description: "主会话、多轮与 newSession 的真实事件、usage 与输出边界彼此隔离",
  async test(t) {
    const main = t.newSession();
    const mainFirst = await main.send("context/main-first");
    await mainFirst.succeeded().gate().stopOnFailure();
    const mainSecond = await main.send("context/main-second");
    await mainSecond.succeeded().gate().stopOnFailure();

    const branch = t.newSession();
    const branchTurn = await branch.send("context/branch");
    await branchTurn.succeeded().gate().stopOnFailure();

    await t.group("turn 输出只属于本轮", () => {
      mainFirst.outputEquals({ fixture: "context-main-first", ok: true });
      mainSecond.outputEquals({ fixture: "context-main-second", ok: true });
      branchTurn.outputEquals({ fixture: "context-branch", ok: true });
      mainFirst.messageIncludes("context-main-first");
      mainSecond.messageIncludes("context-main-second");
      branchTurn.messageIncludes("context-branch-only");
      mainFirst.maxTokens(5);
      branchTurn.maxCost(0);
    });

    await t.group("session 只聚合自己的事件", () => {
      main.succeeded();
      main.messageIncludes("context-main-first");
      main.messageIncludes("context-main-second");
      main.notCalledTool("context_branch");
      main.calledTool("context_main", { count: 2, status: "completed" });
      t.check(main.reply, includes("context-main-second"));

      branch.succeeded();
      branch.messageIncludes("context-branch-only");
      branch.notCalledTool("context_main");
      branch.calledTool("context_branch", { count: 1, status: "completed" });
      t.check(branch.reply, excludes("context-main"));
    });

    await t.group("t scope 聚合所有 session", () => {
      t.succeeded();
      t.calledTool("context_main", { count: 2, status: "completed" });
      t.calledTool("context_branch", { count: 1, status: "completed" });
      t.maxToolCalls(3);
      t.maxTokens(15);
      t.maxCost(0);
      t.event("message", { count: 6 });
      t.eventOrder(["operation.started", "operation.finished", "message"]);
      t.eventsSatisfy("三条 session 输出都进入 attempt 聚合", (events) =>
        events.filter((event) => event.type === "message" && event.role === "assistant").length === 3,
      );
      t.check(branchTurn.data, equals({ fixture: "context-branch", ok: true }));
    });
  },
});
