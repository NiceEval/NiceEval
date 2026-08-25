import { defineEval } from "niceeval";
import {
  atMost,
  commandMatch,
  count,
  eventMatch,
  exactly,
  includes,
  inOrder,
  isTrue,
  jsonMatch,
  matching,
  or,
  referencesAnyPath,
  toolMatch,
} from "niceeval/expect";

export default defineEval({
  description: "同一套确定性工具证据在 turn、session 与 t scope 的边界一致",
  async test(t) {
    const main = t.newSession();
    const mainTurn = await main.send("assertion/scopes-main");
    await mainTurn.succeeded().orStop();
    const branch = t.newSession();
    const branchTurn = await branch.send("assertion/scopes-branch");
    await branchTurn.succeeded().orStop();
    const idle = t.newSession();
    const branchOrder = [
      toolMatch("scope_branch_tool"),
      toolMatch("scope_branch_tool"),
    ] as const;
    await t.group("turn scope", () => {
      mainTurn.calledTool(
        toolMatch("scope_main_tool", {
          input: jsonMatch({ session: "main", token: "scope-main-input" }),
          output: jsonMatch({ marker: "scope-main-output" }),
          status: "completed",
        }),
        { count: 1 },
      );
      mainTurn.notCalledTool("scope_branch_tool");
      mainTurn.calledTool("scope_main_tool");
      mainTurn.noFailedActions();
      mainTurn.notEvent(eventMatch("message", { text: includes("never-event-marker") }));
      mainTurn.maxToolCalls(20_000).label("turn maxToolCalls");
      mainTurn.check(mainTurn.toolCalls, count(atMost(20_000))).label("turn explicit count");
      t.check(mainTurn.toolCalls, count(atMost(20_000))).label("cut from subject");
    });
    await t.group("session scope", () => {
      branch.calledTool(
        toolMatch("scope_branch_tool", {
          input: jsonMatch({ session: "branch", token: "scope-branch-input" }),
          output: jsonMatch({ marker: "scope-branch-output" }),
          status: "completed",
        }),
      );
      branch.notCalledTool("scope_main_tool")
        .optional()
        .label("partial source absence remains unavailable");
      branch.calledTool("scope_branch_tool", { count: 1 })
        .optional()
        .label("partial source exact count remains unavailable");
      branchTurn.calledTool("scope_branch_tool", { count: { atLeast: 1 } })
        .label("turn calledTool");
      branchTurn.check(
        branchTurn.toolCalls,
        matching(toolMatch("scope_branch_tool"), { atLeast: 1 }),
      ).label("turn explicit matching");
      branch.noFailedActions().optional();
      branch.notEvent(eventMatch("message", { text: includes("never-event-marker") }));
      branch.check(branch.toolCalls, count(atMost(100)))
        .optional()
        .label("partial source count remains unavailable");
      idle.usedNoTools().label("unused session usedNoTools");
      idle.check(
        idle.toolCalls,
        matching(toolMatch({}), exactly(0)),
      ).label("unused session explicit matching zero");
    });
    await t.group("attempt scope", () => {
      t.calledTool(toolMatch("scope_main_tool", { status: "completed" }), {
        count: 1,
      }).optional();
      t.calledTool(toolMatch("scope_branch_tool", { status: "completed" }), {
        count: 1,
      }).optional();
      t.notCalledTool(
        toolMatch("never_called", {
          input: jsonMatch({ token: "not-present" }),
          status: "completed",
        }),
      ).optional();
      t.noFailedActions().optional();
      t.notEvent(eventMatch("message", { text: includes("never-event-marker") }));
      t.calledTool(or(
        commandMatch("niceeval", { argsStart: ["init"] }),
        toolMatch("shell", { input: referencesAnyPath(["node_modules/niceeval/INDEX.md"]) }),
      ));
      t.calledTool(or(
        commandMatch("niceeval", { argsStart: ["exp"], excludes: ["--dry", "--help"] }),
        toolMatch("shell", { input: referencesAnyPath(["niceeval.config.ts", "experiments"]) }),
      ));
      t.calledTool(or(
        commandMatch("niceeval", { argsStart: ["show"] }),
        toolMatch("shell", { input: referencesAnyPath([".niceeval", "run.json"]) }),
      ));
      t.maxToolCalls(20_000)
        .optional()
        .label("attempt maxToolCalls");
      t.check(t.toolCalls, count(atMost(20_000)))
        .optional()
        .label("attempt explicit count");
      t.check([1, 2, 3], count(atMost(3))).label("author array count");
      t.check([...mainTurn.toolCalls], count(atMost(20_000))).label("spread count still works");
      let spreadMatchingRejected = false;
      try {
        t.check(
          [...mainTurn.toolCalls],
          matching(toolMatch("scope_main_tool"), exactly(1)),
        );
      } catch {
        spreadMatchingRejected = true;
      }
      t.check(spreadMatchingRejected, isTrue()).label("spread matching rejected");
      let spreadInOrderRejected = false;
      try {
        t.check([...mainTurn.toolCalls], inOrder(branchOrder));
      } catch {
        spreadInOrderRejected = true;
      }
      t.check(spreadInOrderRejected, isTrue()).label("spread inOrder rejected");
      let rootInOrderRejected = false;
      try {
        t.check(t.toolCalls, inOrder(branchOrder));
      } catch {
        rootInOrderRejected = true;
      }
      t.check(rootInOrderRejected, isTrue()).label("root inOrder rejected");
    });
    await t.group("session order", async () => {
      const laterTurn = await branch.send("assertion/scopes-branch");
      await laterTurn.succeeded().orStop();
      branch.check(branch.toolCalls, inOrder(branchOrder)).label("session explicit inOrder");
      branch.toolOrder(branchOrder).label("session toolOrder");
    });
  },
});
