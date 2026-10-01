import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("捕获未配置用途引用仍使 Attempt errored 并保留已接纳调用", async () => {
  await evalE2E.case("model-slot-invalid", async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "model-slots", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const selected = only(run.expEvalEvents(), (entry) => entry.evalId === "model-slot-selection", run.diagnostic());
    expect(selected.verdict).toBe("passed");
    const event = only(run.expEvalEvents(), (entry) => entry.evalId === "model-slot-invalid", run.diagnostic());
    expect(event.verdict).toBe("errored");
    const request = join(paths.projectRoot, "invalid.request.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator: event.locator } }));
    const read = await niceeval.run(["query", "run", "--request", request]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    expect(read.querySuccess("attempt.usage").usage).toMatchObject({
      state: "partial",
      calls: [{ callId: "accepted", modelSlot: "planner", provider: null, model: "fixture/actual" }],
      configuredModels: { state: "available", bindings: [
        { modelSlot: "planner", model: "fixture/shared", reasoningEffort: "high", recordedCalls: 1 },
        { modelSlot: "reviewer", model: "fixture/shared", reasoningEffort: null, recordedCalls: 0 },
        { modelSlot: "unused", model: "fixture/unused", reasoningEffort: null, recordedCalls: 0 },
      ] },
    });
  });
});
