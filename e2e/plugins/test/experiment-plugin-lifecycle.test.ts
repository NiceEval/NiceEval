// owner: docs/roadmap/plugins/library.md#experiment-lifecycle

import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { e2e, lifecycleEvents } from "./helpers.ts";

test("Experiment Plugin 生命周期只包围一次整场实验", async () => {
  await e2e.case("experiment-owner-lifecycle", async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "experiment-plugin", "--rerun", "all", "--json"], {
      timeoutMs: 180_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
    const evalEvents = run.ndjson<ExpEvent>().filter(
      (event): event is ExpEvalEvent => "event" in event && event.event === "eval",
    );
    expect(evalEvents.map((event) => event.verdict), run.diagnostic()).toEqual(["passed", "passed"]);

    const events = lifecycleEvents(paths.projectRoot);
    expect(events.map((event) => event.kind)).toEqual([
      "experiment.author.setup",
      "experiment.plugin.setup",
      "agent.send",
      "agent.send",
      "experiment.plugin.teardown",
      "experiment.author.teardown",
    ]);
    expect(events.filter((event) => event.kind === "agent.send").map((event) => event.evalId)).toEqual([
      "experiment-plugin/01-first",
      "experiment-plugin/02-second",
    ]);
  });
});
