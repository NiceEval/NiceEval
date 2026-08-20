import { defineEval } from "niceeval";
import {
  commandMatch,
  eventMatch,
  includes,
  jsonMatch,
  or,
  referencesAnyPath,
  toolMatch,
} from "niceeval/expect";
export default defineEval({
  description: "同一套确定性工具证据在 turn、session 与 t scope 的边界一致",
  async test(t) {
    const mainTurn = await t.send("assertion/scopes-main");
    await mainTurn.succeeded().orStop();
    const branch = t.newSession();
    const branchTurn = await branch.send("assertion/scopes-branch");
    await branchTurn.succeeded().orStop();
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
    });
    await t.group("session scope", () => {
      branch.calledTool(
        toolMatch("scope_branch_tool", {
          input: jsonMatch({ session: "branch", token: "scope-branch-input" }),
          output: jsonMatch({ marker: "scope-branch-output" }),
          status: "completed",
        }),
      );
      branch.notCalledTool("scope_main_tool");
      branch.calledTool("scope_branch_tool", { count: { atLeast: 1 } });
      branch.noFailedActions();
      branch.notEvent(eventMatch("message", { text: includes("never-event-marker") }));
    });
    await t.group("attempt scope", () => {
      t.calledTool(toolMatch("scope_main_tool", { status: "completed" }), {
        count: 1,
      });
      t.calledTool(toolMatch("scope_branch_tool", { status: "completed" }), {
        count: 1,
      });
      t.notCalledTool(
        toolMatch("never_called", {
          input: jsonMatch({ token: "not-present" }),
          status: "completed",
        }),
      );
      t.noFailedActions();
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
    });
  },
});
