// owner: docs/roadmap/plugins/library.md#sandbox-resource

import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { e2e, lifecycleEvents } from "./helpers.ts";

test("Eval Plugin resource 随每个 fresh Attempt 获取、准备并释放", async () => {
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
      "resource.materialize",
      "resource.prepare",
      "agent.send",
      "resource.release",
      "resource.materialize",
      "resource.prepare",
      "agent.send",
      "resource.release",
    ]);
    expect(events.filter((event) => event.kind === "resource.prepare").map((event) => event.attempt)).toEqual([0, 1]);
    expect(events.filter((event) => event.kind === "resource.materialize").map((event) => event.markers)).toEqual([
      ["owner"],
      ["owner"],
    ]);
  });
});
