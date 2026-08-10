import { defineEval } from "niceeval";

export default defineEval({
  description: "同一套确定性工具证据在 turn、session 与 t scope 的边界一致",
  async test(t) {
    const mainTurn = await t.send("assertion/scopes-main");
    await mainTurn.succeeded().gate().stopOnFailure();
    const branch = t.newSession();
    const branchTurn = await branch.send("assertion/scopes-branch");
    await branchTurn.succeeded().gate().stopOnFailure();

    await t.group("turn scope", () => {
      mainTurn.calledTool("scope_main_tool", {
        input: { session: "main", token: "scope-main-input" },
        output: { marker: "scope-main-output" },
        status: "completed",
        count: 1,
      });
      mainTurn.notCalledTool("scope_branch_tool");
      mainTurn.toolOrder(["scope_main_tool"]);
      mainTurn.maxToolCalls(1);
      mainTurn.noFailedActions();
      mainTurn.eventOrder(["operation.started", "operation.finished", "message"]);
    });

    await t.group("session scope", () => {
      branch.calledTool("scope_branch_tool", {
        input: { session: "branch", token: "scope-branch-input" },
        output: { marker: "scope-branch-output" },
        status: "completed",
        count: 1,
      });
      branch.notCalledTool("scope_main_tool");
      branch.maxTokens(5);
      branch.maxCost(0);
      branch.eventsSatisfy("branch session 只有一笔真实工具调用", (events) =>
        events.filter((event) => event.type === "operation.started").length === 1,
      );
    });

    await t.group("attempt scope", () => {
      t.calledTool("scope_main_tool", { count: 1, status: "completed" });
      t.calledTool("scope_branch_tool", { count: (count) => count === 1, status: "completed" });
      t.notCalledTool("never_called", { input: /not-present/, status: "completed" });
      t.toolOrder(["scope_main_tool", "scope_branch_tool"]);
      t.maxToolCalls(2);
      t.noFailedActions();
      t.event("operation.started", { count: 2 });
      t.event("operation.finished", { count: 2 });
      t.eventOrder(["operation.started", "operation.finished", "message"]);
    });
  },
});
