// owner: docs/feature/plugins/library.md#eval-lifecycle

import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { e2e, lifecycleEvents } from "./helpers.ts";

test("多个 Eval Plugin 与 Sandbox Plugin 按 fresh Attempt 和物理实例运行", async () => {
  await e2e.case("eval-owner-lifecycle", async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "eval-plugin", "--rerun", "all", "--json"], {
      timeoutMs: 180_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
    const evalEvents = run.ndjson<ExpEvent>().filter(
      (event): event is ExpEvalEvent => "event" in event && event.event === "eval",
    );
    expect(evalEvents, run.diagnostic()).toHaveLength(1);
    expect(evalEvents[0]).toMatchObject({ verdict: "passed", attempts: 2, passed: 2 });

    const events = lifecycleEvents(paths.projectRoot);
    expect(events.map((event) => event.kind)).toEqual([
      "sandbox.plugin.setup",
      "sandbox.plugin.setup",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "sandbox.plugin.teardown",
      "sandbox.plugin.teardown",
      "sandbox.plugin.setup",
      "sandbox.plugin.setup",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "sandbox.plugin.teardown",
      "sandbox.plugin.teardown",
    ]);
    expect(events.filter((event) => event.kind === "eval.plugin.setup").map((event) => [event.attempt, event.marker])).toEqual([
      [0, "default"], [0, "owner-a"], [0, "owner-b"],
      [1, "default"], [1, "owner-a"], [1, "owner-b"],
    ]);
    expect(events.filter((event) => event.kind === "eval.plugin.teardown").map((event) => [event.attempt, event.marker])).toEqual([
      [0, "owner-b"], [0, "owner-a"], [0, "default"],
      [1, "owner-b"], [1, "owner-a"], [1, "default"],
    ]);
  });
});
