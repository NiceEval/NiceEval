// owner: docs/roadmap/plugins/README.md#v1-owner-matrix

import { withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { lifecycleEvents, niceeval, projectCopy } from "./helpers.ts";

interface ExpPlanDocument {
  readonly format: "niceeval.exp-plan";
  readonly total: number;
  readonly reused: number;
}

test("Eval Group Plugin 标识整组，Eval resource 共享物理生命周期但逐成员准备", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const stableEnv = { ...process.env, PLUGIN_GROUP_VARIANT: "stable" };
    const run = await niceeval.run(["exp", "group-plugin", "--rerun", "all", "--json"], {
      cwd: root,
      env: stableEnv,
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
      "resource.prepare",
      "agent.send",
      "resource.release",
    ]);
    expect(events[0]).toMatchObject({ markers: ["01-first", "02-second"] });
    expect(events.filter((event) => event.kind === "resource.prepare").map((event) => event.evalId)).toEqual([
      "group-plugin/01-first",
      "group-plugin/02-second",
    ]);
    expect(events.filter((event) => event.kind === "agent.send").map((event) => event.evalGroupId)).toEqual([
      "group-plugin",
      "group-plugin",
    ]);

    const same = await niceeval.run(["exp", "group-plugin", "--dry", "--json"], {
      cwd: root,
      env: stableEnv,
    });
    expect(same.exitCode, same.diagnostic()).toBe(0);
    expect(same.json<ExpPlanDocument>()).toMatchObject({
      format: "niceeval.exp-plan",
      total: 2,
      reused: 2,
    });

    const changed = await niceeval.run(["exp", "group-plugin", "--dry", "--json"], {
      cwd: root,
      env: { ...process.env, PLUGIN_GROUP_VARIANT: "changed" },
    });
    expect(changed.exitCode, changed.diagnostic()).toBe(0);
    expect(changed.json<ExpPlanDocument>()).toMatchObject({
      format: "niceeval.exp-plan",
      total: 2,
      reused: 0,
    });
  });
});
