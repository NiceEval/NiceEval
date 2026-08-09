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
      t.assert(
        t.check(
          mainFirst.data,
          equals({ fixture: "context-main-first", ok: true }),
        ),
      );
      t.assert(
        t.check(
          mainSecond.data,
          equals({ fixture: "context-main-second", ok: true }),
        ),
      );
      t.assert(
        t.check(
          branchTurn.data,
          equals({ fixture: "context-branch", ok: true }),
        ),
      );
      t.assert(t.check(mainFirst.message, includes("context-main-first")));
      t.assert(t.check(mainSecond.message, includes("context-main-second")));
      t.assert(t.check(branchTurn.message, includes("context-branch-only")));
      t.assert(mainFirst.maxTokens(5));
      t.assert(branchTurn.maxCost(0));
    });

    await t.group("session 只聚合自己的事件", () => {
      t.assert(main.succeeded());
      t.assert(
        main.event(
          eventMatch("message", {
            role: "assistant",
            text: includes("context-main-first"),
          }),
        ),
      );
      t.assert(
        main.event(
          eventMatch("message", {
            role: "assistant",
            text: includes("context-main-second"),
          }),
        ),
      );
      t.assert(main.notCalledTool(toolMatch("context_branch")));
      t.assert(
        main.calledTool(toolMatch("context_main", { status: "completed" }), {
          count: 2,
        }),
      );
      t.assert(t.check(main.reply, includes("context-main-second")));

      t.assert(branch.succeeded());
      t.assert(
        branch.event(
          eventMatch("message", {
            role: "assistant",
            text: includes("context-branch-only"),
          }),
        ),
      );
      t.assert(branch.notCalledTool(toolMatch("context_main")));
      t.assert(
        branch.calledTool(
          toolMatch("context_branch", { status: "completed" }),
          { count: 1 },
        ),
      );
      t.assert(t.check(branch.reply, excludes("context-main")));
    });

    await t.group("t scope 聚合所有 session", () => {
      t.assert(t.succeeded());
      t.assert(
        t.calledTool(toolMatch("context_main", { status: "completed" }), {
          count: 2,
        }),
      );
      t.assert(
        t.calledTool(toolMatch("context_branch", { status: "completed" }), {
          count: 1,
        }),
      );
      t.assert(t.maxToolCalls(3));
      t.assert(t.maxTokens(15));
      t.assert(t.maxCost(0));
      t.assert(t.event(eventMatch("message"), { count: 6 }));
      t.assert(
        t.eventOrder([
          eventMatch("operation.started"),
          eventMatch("operation.finished"),
          eventMatch("message"),
        ]),
      );
      t.assert(
        t.event(eventMatch("message", { role: "assistant" }), { count: 3 }),
      );
      t.assert(
        t.check(
          branchTurn.data,
          equals({ fixture: "context-branch", ok: true }),
        ),
      );
    });
  },
});
