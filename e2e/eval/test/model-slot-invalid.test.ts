

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("捕获未配置用途引用仍使 Attempt errored 并保留已接纳调用", async () => {
  await evalE2E.case("model-role-invalid", async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "model-roles", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const selected = only(run.expEvalEvents(), (entry) => entry.evalId === "model-role-selection", run.diagnostic());
    expect(selected.verdict).toBe("passed");
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "model-role-invalid", run.diagnostic());
    expect(event.verdict).toBe("errored");

    const read = await niceeval.run(["show", event.locator, "usage", "--json"]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    expect(read.inspectionSuccess("attempt.usage").usage).toMatchObject({
      state: "partial",
      calls: [{ callId: "accepted", modelRole: "planner", provider: null, model: "fixture/actual" }],
      configuredModels: { state: "available", bindings: [
        { modelRole: "planner", model: "fixture/shared", reasoningEffort: "high", recordedCalls: 1 },
        { modelRole: "reviewer", model: "fixture/shared", reasoningEffort: null, recordedCalls: 0 },
        { modelRole: "unused", model: "fixture/unused", reasoningEffort: null, recordedCalls: 0 },
      ] },
    });
  });
});
