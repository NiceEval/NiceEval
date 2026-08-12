// owner: docs/roadmap/plugins/library.md#sandbox-resource

import { withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { lifecycleEvents, niceeval, projectCopy } from "./helpers.ts";

test("Eval Plugin resource 随每个 fresh Attempt 获取、准备并释放", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const run = await niceeval.run(["exp", "eval-plugin", "--rerun", "all", "--json"], {
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
