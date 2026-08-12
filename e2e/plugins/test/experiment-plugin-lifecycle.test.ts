// owner: docs/roadmap/plugins/library.md#experiment-lifecycle

import { withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { lifecycleEvents, niceeval, projectCopy } from "./helpers.ts";

test("Experiment Plugin 生命周期只包围一次整场实验", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const run = await niceeval.run(["exp", "experiment-plugin", "--rerun", "all", "--json"], {
      cwd: root,
      timeoutMs: 180_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expResult()).toMatchObject({
      event: "result",
      status: "passed",
      completion: "complete",
      passed: 2,
      failed: 0,
      errored: 0,
    });

    const events = lifecycleEvents(root);
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
