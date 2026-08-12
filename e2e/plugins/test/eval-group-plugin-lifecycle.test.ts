// owner: docs/roadmap/plugins/README.md#v1-owner-matrix

import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { e2e, lifecycleEvents } from "./helpers.ts";

interface ExpPlanDocument {
  readonly format: "niceeval.current-reuse-plan/v1";
  readonly total: number;
  readonly reused: number;
  readonly plugins: readonly {
    readonly owner: string;
    readonly name: string;
    readonly contributions: readonly string[];
  }[];
  readonly resources: readonly {
    readonly demands: readonly { readonly scope: string }[];
  }[];
  readonly commandPlan?: {
    readonly experiments: readonly {
      readonly lanes: readonly {
        readonly physicalLifecycleTemplate?: {
          readonly enter: readonly { readonly phase: string }[];
          readonly exit: readonly { readonly phase: string }[];
        };
        readonly slots: readonly { readonly steps: readonly { readonly phase: string }[] }[];
      }[];
    }[];
  };
}

test("Eval Group Plugin 标识整组，Eval resource 共享物理生命周期但逐成员准备", async () => {
  await e2e.case("group-owner-lifecycle", async ({ paths, commands: { niceeval } }) => {
    const stableEnv = { ...process.env, PLUGIN_GROUP_VARIANT: "stable" };
    const run = await niceeval.run(["exp", "group-plugin", "--rerun", "all", "--json"], {
      env: stableEnv,
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
      "resource.materialize",
      "resource.prepare",
      "resource.prepare",
      "agent.send",
      "resource.prepare",
      "resource.prepare",
      "agent.send",
      "resource.release",
    ]);
    expect(events[0]).toMatchObject({ markers: ["group", "01-first", "02-second"] });
    expect(events.filter((event) => event.kind === "resource.prepare").map((event) => event.evalId)).toEqual([
      "group-plugin/01-first",
      "group-plugin/01-first",
      "group-plugin/02-second",
      "group-plugin/02-second",
    ]);
    expect(events.filter((event) => event.kind === "agent.send")).toHaveLength(2);

    const same = await niceeval.run(["exp", "group-plugin", "--dry", "--json"], {
      env: stableEnv,
    });
    expect(same.exitCode, same.diagnostic()).toBe(0);
    expect(same.json<ExpPlanDocument>()).toMatchObject({
      format: "niceeval.current-reuse-plan/v1",
      total: 2,
      reused: 2,
    });

    const changed = await niceeval.run(["exp", "group-plugin", "--dry", "--json"], {
      env: { ...process.env, PLUGIN_GROUP_VARIANT: "changed" },
    });
    expect(changed.exitCode, changed.diagnostic()).toBe(0);
    const changedPlan = changed.json<ExpPlanDocument>();
    expect(changedPlan).toMatchObject({
      format: "niceeval.current-reuse-plan/v1",
      total: 2,
      reused: 0,
    });
    expect(changedPlan.plugins).toContainEqual(expect.objectContaining({
      owner: "group",
      name: "e2e.group-lifecycle",
      contributions: ["identity", "sandbox-commands", "sandbox-resource"],
    }));
    expect(changedPlan.resources).toHaveLength(1);
    expect(changedPlan.resources[0]!.demands.map((demand) => demand.scope)).toEqual(["group", "eval", "eval"]);

    const commands = await niceeval.run(["exp", "group-plugin", "--dry", "--commands", "--json"], {
      env: { ...process.env, PLUGIN_GROUP_VARIANT: "changed" },
    });
    expect(commands.exitCode, commands.diagnostic()).toBe(0);
    const commandPlan = commands.json<ExpPlanDocument>().commandPlan!;
    const lane = commandPlan.experiments[0]!.lanes[0]!;
    expect(lane.physicalLifecycleTemplate!.enter.map((step) => step.phase)).toContain("plugin.resource.materialize");
    expect(lane.slots[0]!.steps.map((step) => step.phase)).toContain("plugin.resource.prepare");
    expect(lane.physicalLifecycleTemplate!.exit.map((step) => step.phase)).toContain("plugin.resource.release");
  });
});
