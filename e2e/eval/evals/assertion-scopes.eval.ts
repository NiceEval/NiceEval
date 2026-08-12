import { defineEval } from "niceeval";
import { eventMatch, satisfies, toolMatch } from "niceeval/expect";
export default defineEval({
  description: "同一套确定性工具证据在 turn、session 与 t scope 的边界一致",
  async test(t) {
    const mainTurn = await t.send("assertion/scopes-main");
    await mainTurn.succeeded().orStop();
    const branch = t.newSession();
    const branchTurn = await branch.send("assertion/scopes-branch");
    await branchTurn.succeeded().orStop();
    await t.group("turn scope", () => {
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
        }),
        { count: 1 },
      );
      t.check(
        mainTurn.events,
        satisfies<typeof mainTurn.events>("scope main tool output", (events) =>
          events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.kind === "tool" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              event.output.marker === "scope-main-output",
          ),
        ),
      );
      mainTurn.notCalledTool(toolMatch("scope_branch_tool"));
      mainTurn.calledTool(toolMatch("scope_main_tool"));
      mainTurn.maxToolCalls(1);
      mainTurn.noFailedActions();
      mainTurn.eventOrder([
        eventMatch("operation.started"),
        eventMatch("operation.finished"),
        eventMatch("message"),
      ]);
    });
    await t.group("session scope", () => {
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
        }),
        { count: 1 },
      );
      t.check(
        branch.events,
        satisfies<typeof branch.events>("scope branch tool output", (events) =>
          events.some(
            (event) =>
              event.type === "operation.finished" &&
              event.kind === "tool" &&
              typeof event.output === "object" &&
              event.output !== null &&
              !Array.isArray(event.output) &&
              event.output.marker === "scope-branch-output",
          ),
        ),
      );
      branch.notCalledTool(toolMatch("scope_main_tool"));
      branch.maxTokens(5);
      branch.maxCost(0);
      branch.eventsSatisfy(
        "branch session 只有一笔真实工具调用",
        (events) =>
          Object.isFrozen(events) &&
          events.every(
            (event) =>
              Object.isFrozen(event) && Object.isFrozen(event.position),
          ) &&
          events.filter((event) => event.type === "operation.started")
            .length === 1,
      );
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
          input: satisfies('"never_called" input', (input) =>
            typeof input === "string"
              ? /not-present/.test(input)
              : /not-present/.test(JSON.stringify(input) ?? ""),
          ),
          status: "completed",
        }),
      );
      t.maxToolCalls(2);
      t.noFailedActions();
      t.event(eventMatch("operation.started"), { count: 2 });
      t.event(eventMatch("operation.finished"), { count: 2 });
    });
  },
});
