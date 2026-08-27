// owner: docs/engineering/testing/e2e/plugins.md#eval-plugin-lifecycle

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
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
    ]);
    expect(events.filter((event) => event.kind === "eval.plugin.setup").map((event) => [event.attempt, event.marker])).toEqual([
      [0, "default"], [0, "owner-a"], [0, "owner-b"],
      [1, "default"], [1, "owner-a"], [1, "owner-b"],
    ]);
    expect(events.filter((event) => event.kind === "eval.plugin.teardown").map((event) => [event.attempt, event.marker])).toEqual([
      [0, "owner-b"], [0, "owner-a"], [0, "default"],
      [1, "owner-b"], [1, "owner-a"], [1, "default"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => [event.marker, event.declaredMarker])).toEqual([
      ["owner-a", "owner-a"],
      ["owner-b", "owner-b"],
      ["owner-a", "owner-a"],
      ["owner-b", "owner-b"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.after").map((event) => [event.marker, event.ownerKind, event.ownerId])).toEqual([
      ["owner-b", "eval", "eval-plugin/owner"],
      ["owner-a", "eval", "eval-plugin/owner"],
      ["owner-b", "eval", "eval-plugin/owner"],
      ["owner-a", "eval", "eval-plugin/owner"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.after").map((event) => event.physicalId)).toEqual(
      events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => event.physicalId),
    );
    expect(new Set(events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => event.physicalId)).size).toBe(2);
  });
});
