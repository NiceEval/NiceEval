import { defineEval } from "niceeval";
import { eventMatch, satisfies, toolMatch } from "niceeval/expect";

export default defineEval({
  description: "同一套确定性工具证据在 turn、session 与 t scope 的边界一致",
  async test(t) {
    const mainTurn = await t.send("assertion/scopes-main");
    await t.require(mainTurn.succeeded());
    const branch = t.newSession();
    const branchTurn = await branch.send("assertion/scopes-branch");
    await t.require(branchTurn.succeeded());

    await t.group("turn scope", () => {
      t.assert(
        mainTurn.event(
          eventMatch("operation.finished", {
            tool: toolMatch("scope_main_tool", {
              input: satisfies(
                "scope main tool input",
                (input) =>
                  typeof input === "object" &&
                  input !== null &&
                  !Array.isArray(input) &&
                  input.session === "main" &&
                  input.token === "scope-main-input",
              ),
              status: "completed",
            }),
            output: satisfies("scope main tool output", (output) =>
              typeof output === "object" &&
              output !== null &&
              !Array.isArray(output) &&
              output.marker === "scope-main-output",
            ),
          }),
          { count: 1 },
        ),
      );
      t.assert(mainTurn.notCalledTool(toolMatch("scope_branch_tool")));
      t.assert(mainTurn.calledTool(toolMatch("scope_main_tool")));
      t.assert(mainTurn.maxToolCalls(1));
      t.assert(mainTurn.noFailedActions());
      t.assert(
        mainTurn.eventOrder([
          eventMatch("operation.started"),
          eventMatch("operation.finished"),
          eventMatch("message"),
        ]),
      );
    });

    await t.group("session scope", () => {
      t.assert(
        branch.event(
          eventMatch("operation.finished", {
            tool: toolMatch("scope_branch_tool", {
              input: satisfies(
                "scope branch tool input",
                (input) =>
                  typeof input === "object" &&
                  input !== null &&
                  !Array.isArray(input) &&
                  input.session === "branch" &&
                  input.token === "scope-branch-input",
              ),
              status: "completed",
            }),
            output: satisfies("scope branch tool output", (output) =>
              typeof output === "object" &&
              output !== null &&
              !Array.isArray(output) &&
              output.marker === "scope-branch-output",
            ),
          }),
          { count: 1 },
        ),
      );
      t.assert(branch.notCalledTool(toolMatch("scope_main_tool")));
      t.assert(branch.maxTokens(5));
      t.assert(branch.maxCost(0));
      t.assert(
        branch.eventsSatisfy("branch session 只有一笔真实工具调用", (events) =>
          events.filter((event) => event.type === "operation.started").length === 1,
        ),
      );
    });

    await t.group("attempt scope", () => {
      t.assert(
        t.calledTool(toolMatch("scope_main_tool", { status: "completed" }), {
          count: 1,
        }),
      );
      t.assert(
        t.calledTool(toolMatch("scope_branch_tool", { status: "completed" }), {
          count: 1,
        }),
      );
      t.assert(
        t.notCalledTool(
          toolMatch("never_called", {
            input: satisfies('"never_called" input', (input) =>
              typeof input === "string"
                ? /not-present/.test(input)
                : /not-present/.test(JSON.stringify(input) ?? ""),
            ),
            status: "completed",
          }),
        ),
      );
      t.assert(
        t.toolOrder([
          toolMatch("scope_main_tool"),
          toolMatch("scope_branch_tool"),
        ]),
      );
      t.assert(t.maxToolCalls(2));
      t.assert(t.noFailedActions());
      t.assert(t.event(eventMatch("operation.started"), { count: 2 }));
      t.assert(t.event(eventMatch("operation.finished"), { count: 2 }));
      t.assert(
        t.eventOrder([
          eventMatch("operation.started"),
          eventMatch("operation.finished"),
          eventMatch("message"),
        ]),
      );
    });
  },
});
