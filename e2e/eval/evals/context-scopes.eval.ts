import { defineEval } from "niceeval";
import {
  equals,
  excludes,
  includes,
  eventMatch,
  toolMatch,
} from "niceeval/expect";

export default defineEval({
  description: "主会话、多轮与 newSession 的真实事件、usage 与输出边界彼此隔离",
  async test(t) {
    const main = t.newSession();
    const mainFirst = await main.send("context/main-first");
    await t.require(mainFirst.succeeded());
    const mainSecond = await main.send("context/main-second");
    await t.require(mainSecond.succeeded());

    const branch = t.newSession();
    const branchTurn = await branch.send("context/branch");
    await t.require(branchTurn.succeeded());

    await t.group("turn 输出只属于本轮", () => {
      t.check(
        mainFirst.data,
        equals({ fixture: "context-main-first", ok: true }),
      );
      t.check(
        mainSecond.data,
        equals({ fixture: "context-main-second", ok: true }),
      );
      t.check(branchTurn.data, equals({ fixture: "context-branch", ok: true }));
      t.check(mainFirst.message, includes("context-main-first"));
      t.check(mainSecond.message, includes("context-main-second"));
      t.check(branchTurn.message, includes("context-branch-only"));
      t.check(mainFirst.maxTokens(5));
      t.check(branchTurn.maxCost(0));
    });

    await t.group("session 只聚合自己的事件", () => {
      t.check(main.succeeded());
      t.check(
        main.event(
          eventMatch("message", {
            role: "assistant",
            text: includes("context-main-first"),
          }),
        ),
      );
      t.check(
        main.event(
          eventMatch("message", {
            role: "assistant",
            text: includes("context-main-second"),
          }),
        ),
      );
      t.check(main.notCalledTool(toolMatch("context_branch")));
      t.check(
        main.calledTool(toolMatch("context_main", { status: "completed" }), {
          count: 2,
        }),
      );
      t.check(
        main.toolOrder([toolMatch("context_main"), toolMatch("context_main")]),
      );
      t.check(
        main.eventOrder([
          eventMatch("operation.started"),
          eventMatch("operation.finished"),
          eventMatch("message", {
            role: "assistant",
            text: includes("context-main-first"),
          }),
          eventMatch("operation.started"),
          eventMatch("operation.finished"),
          eventMatch("message", {
            role: "assistant",
            text: includes("context-main-second"),
          }),
        ]),
      );
      t.check(main.reply, includes("context-main-second"));

      t.check(branch.succeeded());
      t.check(
        branch.event(
          eventMatch("message", {
            role: "assistant",
            text: includes("context-branch-only"),
          }),
        ),
      );
      t.check(branch.notCalledTool(toolMatch("context_main")));
      t.check(
        branch.calledTool(
          toolMatch("context_branch", { status: "completed" }),
          { count: 1 },
        ),
      );
      t.check(branch.reply, excludes("context-main"));
    });

    await t.group("t scope 聚合所有 session", () => {
      t.check(t.succeeded());
      t.check(
        t.calledTool(toolMatch("context_main", { status: "completed" }), {
          count: 2,
        }),
      );
      t.check(
        t.calledTool(toolMatch("context_branch", { status: "completed" }), {
          count: 1,
        }),
      );
      t.check(t.maxToolCalls(3));
      t.check(t.maxTokens(15));
      t.check(t.maxCost(0));
      t.check(t.event(eventMatch("message"), { count: 6 }));
      t.check(
        t.event(eventMatch("message", { role: "assistant" }), { count: 3 }),
      );
      t.check(branchTurn.data, equals({ fixture: "context-branch", ok: true }));
    });
  },
});
