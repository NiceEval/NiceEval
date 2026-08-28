// owner: docs/engineering/testing/e2e/plugins.md#experiment-plugin-lifecycle

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
    const evalEvents = run.expEvents().filter(
      (event): event is ExpEvalEvent => "event" in event && event.event === "eval",
    );
    expect(evalEvents.map((event) => event.verdict), run.diagnostic()).toEqual(["passed", "passed"]);

    const events = lifecycleEvents(paths.projectRoot);
    expect(events.map((event) => event.kind)).toEqual([
      "experiment.author.setup",
      "experiment.plugin.setup",
      "experiment.plugin.setup",
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "agent.send",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "agent.send",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
      "experiment.plugin.teardown",
      "experiment.plugin.teardown",
      "experiment.author.teardown",
    ]);
    expect(events.filter((event) => event.kind === "experiment.plugin.setup").map((event) => event.marker)).toEqual(["experiment-a", "experiment-b"]);
    expect(events.filter((event) => event.kind === "experiment.plugin.teardown").map((event) => event.marker)).toEqual(["experiment-b", "experiment-a"]);
    expect(events.filter((event) => event.kind === "agent.send").map((event) => event.evalId)).toEqual([
      "experiment-plugin/01-first",
      "experiment-plugin/02-second",
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => [event.marker, event.declaredMarker])).toEqual([
      ["experiment-a", "experiment-a"],
      ["experiment-b", "experiment-b"],
      ["experiment-a", "experiment-a"],
      ["experiment-b", "experiment-b"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.after").map((event) => [event.marker, event.ownerKind, event.ownerId])).toEqual([
      ["experiment-b", "experiment", "experiment-plugin"],
      ["experiment-a", "experiment", "experiment-plugin"],
      ["experiment-b", "experiment", "experiment-plugin"],
      ["experiment-a", "experiment", "experiment-plugin"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.after").map((event) => event.physicalId)).toEqual(
      events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => event.physicalId),
    );
    expect(new Set(events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => event.physicalId)).size).toBe(2);
  });
});
