import { defineEval } from "niceeval";
import {
  atMost,
  commandMatch,
  eventMatch,
  includes,
  inOrder,
  isTrue,
  jsonMatch,
  or,
  referencesAnyPath,
  toolMatch,
} from "niceeval/expect";

function authoringRejected(run: () => void): boolean {
  try {
    run();
    return false;
  } catch {
    return true;
  }
}

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
      mainTurn.check(
        mainTurn.toolCalls,
        toolMatch("scope_main_tool", {
          input: jsonMatch({ session: "main", token: "scope-main-input" }),
          output: jsonMatch({ marker: "scope-main-output" }),
          status: "completed",
        }).exactly(1),
      );
      mainTurn.notCalledTool("scope_branch_tool");
      mainTurn.calledTool("scope_main_tool").label("turn calledTool bare");
      mainTurn.noFailedActions();
      mainTurn.notEvent(eventMatch("message", { text: includes("never-event-marker") }));
      mainTurn.maxToolCalls(20_000).label("turn maxToolCalls");
      mainTurn.check(mainTurn.toolCalls, atMost(20_000)).label("turn explicit cardinality");
      t.check(mainTurn.toolCalls, atMost(20_000)).label("cut from subject");
      mainTurn.check(mainTurn.toolCalls, toolMatch("scope_main_tool"))
        .label("turn bare toolMatch");
      mainTurn.check(mainTurn.toolCalls, toolMatch("scope_main_tool").exactly(1))
        .label("turn occurrence exactly");
      mainTurn.check(mainTurn.toolCalls, toolMatch("scope_main_tool").atMost(1))
        .label("turn occurrence atMost");
      mainTurn.check(mainTurn.toolCalls, toolMatch("scope_main_tool").lessThan(2))
        .label("turn occurrence lessThan");
      mainTurn.check(mainTurn.toolCalls, toolMatch("scope_main_tool").greaterThan(0))
        .label("turn occurrence greaterThan");
    });
    await t.group("session scope", () => {
      branch.calledTool(
        toolMatch("scope_branch_tool", {
          input: jsonMatch({ session: "branch", token: "scope-branch-input" }),
          output: jsonMatch({ marker: "scope-branch-output" }),
          status: "completed",
        }),
      );
      branch.check(branch.toolCalls, toolMatch("scope_branch_tool").atLeast(1))
        .label("partial source lower bound can match");
      branch.notCalledTool("scope_main_tool")
        .optional()
        .label("partial source absence remains unavailable");
      branch.check(branch.toolCalls, toolMatch("scope_branch_tool").exactly(1))
        .optional()
        .label("partial source exact count remains unavailable");
      branchTurn.check(branchTurn.toolCalls, toolMatch("scope_branch_tool").atLeast(1))
        .label("turn calledTool");
      branchTurn.check(
        branchTurn.toolCalls,
        toolMatch("scope_branch_tool").atLeast(1),
      ).label("turn explicit occurrence");
      branch.noFailedActions().optional();
      branch.notEvent(eventMatch("message", { text: includes("never-event-marker") }));
      branch.check(branch.toolCalls, atMost(100))
        .optional()
        .label("partial source cardinality remains unavailable");
      branch.check(branch.toolCalls, toolMatch("scope_branch_tool").atMost(1))
        .optional()
        .label("partial source occurrence upper bound remains unavailable");
      idle.usedNoTools().label("unused session usedNoTools");
      idle.check(
        idle.toolCalls,
        toolMatch({}).exactly(0),
      ).label("unused session explicit occurrence zero");
    });
    await t.group("attempt scope", () => {
      t.check(t.toolCalls, toolMatch("scope_main_tool", { status: "completed" }).exactly(1)).optional();
      t.check(t.toolCalls, toolMatch("scope_branch_tool", { status: "completed" }).exactly(1)).optional();
      t.notCalledTool(
        toolMatch("never_called", {
          input: jsonMatch({ token: "not-present" }),
          status: "completed",
        }),
      ).optional();
      t.noFailedActions().optional();
      t.notEvent(eventMatch("message", { text: includes("never-event-marker") }));
      const initCommand = or(
        commandMatch("niceeval", { argsStart: ["init"] }),
        toolMatch("shell", { input: referencesAnyPath(["node_modules/niceeval/INDEX.md"]) }),
      );
      t.calledTool(initCommand).label("attempt calledTool composite");
      t.check(t.toolCalls, initCommand.atLeast(1))
        .label("attempt explicit composite occurrence");
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
      t.check(t.toolCalls, atMost(20_000))
        .optional()
        .label("attempt explicit cardinality");
      t.check([1, 2, 3], atMost(3)).label("author array cardinality");
      t.check([...mainTurn.toolCalls], atMost(20_000)).label("spread cardinality still works");
      t.check(
        authoringRejected(() => {
          t.check([...mainTurn.toolCalls], toolMatch("scope_main_tool").exactly(1));
        }),
        isTrue(),
      ).label("spread occurrence rejected");
      t.check(
        authoringRejected(() => {
          t.check([...mainTurn.toolCalls], inOrder(branchOrder));
        }),
        isTrue(),
      ).label("spread inOrder rejected");
      t.check(
        authoringRejected(() => {
          t.check(t.toolCalls, inOrder(branchOrder));
        }),
        isTrue(),
      ).label("root inOrder rejected");
      t.check(
        authoringRejected(() => {
          inOrder([
            toolMatch("scope_main_tool").exactly(1) as never,
            toolMatch("scope_main_tool"),
          ]);
        }),
        isTrue(),
      ).label("quantified inOrder step rejected");
    });
    await t.group("session order", async () => {
      const laterTurn = await branch.send("assertion/scopes-branch");
      await laterTurn.succeeded().orStop();
      branch.check(branch.toolCalls, inOrder(branchOrder)).label("session explicit inOrder");
      branch.toolOrder(branchOrder).label("session toolOrder");
    });
  },
});
