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
    await mainFirst.succeeded().orStop();
    const mainSecond = await main.send("context/main-second");
    await mainSecond.succeeded().orStop();

    const branch = t.newSession();
    const branchTurn = await branch.send("context/branch");
    await branchTurn.succeeded().orStop();

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
      mainFirst.maxTokens(5);
      branchTurn.maxCost(0);
    });

    await t.group("session 只聚合自己的事件", () => {
      main.succeeded();
      main.event(
        eventMatch("message", {
          role: "assistant",
          text: includes("context-main-first"),
        }),
      );
      main.event(
        eventMatch("message", {
          role: "assistant",
          text: includes("context-main-second"),
        }),
      );
      main.notCalledTool(toolMatch("context_branch"));
      main.check(main.toolCalls, toolMatch("context_main", { status: "completed" }).exactly(2));
      main.toolOrder([toolMatch("context_main"), toolMatch("context_main")]);
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
      ]);
      t.check(main.reply, includes("context-main-second"));

      branch.succeeded();
      branch.event(
        eventMatch("message", {
          role: "assistant",
          text: includes("context-branch-only"),
        }),
      );
      branch.notCalledTool(toolMatch("context_main"));
      branch.check(branch.toolCalls, toolMatch("context_branch", { status: "completed" }).exactly(1));
      t.check(branch.reply, excludes("context-main"));
    });

    await t.group("t scope 聚合所有 session", () => {
      t.succeeded();
      t.check(t.toolCalls, toolMatch("context_main", { status: "completed" }).exactly(2));
      t.check(t.toolCalls, toolMatch("context_branch", { status: "completed" }).exactly(1));
      t.maxToolCalls(3);
      t.maxTokens(15);
      t.maxCost(0);
      t.check(t.eventOccurrences, eventMatch("message").exactly(6));
      t.check(t.eventOccurrences, eventMatch("message", { role: "assistant" }).exactly(3));
      t.check(branchTurn.data, equals({ fixture: "context-branch", ok: true }));
    });
  },
});
