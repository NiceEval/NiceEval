// owner: docs/feature/plugins/README.md#v1-owner-matrix

import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { e2e, lifecycleEvents } from "./helpers.ts";

interface ExpPlanDocument {
  readonly format: "niceeval.current-reuse-plan/v1";
  readonly total: number;
  readonly reused: number;
  readonly plugins: readonly {
    readonly scope: string;
    readonly name: string;
    readonly contributions: readonly string[];
  }[];
  readonly commandPlan?: {
    readonly experiments: readonly {
      readonly lanes: readonly {
        readonly beforeSlots?: readonly { readonly phase: string }[];
        readonly afterSlots?: readonly { readonly phase: string }[];
        readonly physicalLifecycleTemplate?: {
          readonly enter: readonly { readonly phase: string }[];
          readonly exit: readonly { readonly phase: string }[];
        };
        readonly slots: readonly { readonly steps: readonly { readonly phase: string }[] }[];
      }[];
    }[];
  };
}

test("Eval Group、Sandbox 与 Eval Plugin 各自遵守共享实例的生命周期", async () => {
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
      "group.plugin.setup",
      "group.plugin.setup",
      "sandbox.plugin.setup",
      "sandbox.plugin.setup",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "sandbox.plugin.teardown",
      "sandbox.plugin.teardown",
      "group.plugin.teardown",
      "group.plugin.teardown",
    ]);
    expect(events.filter((event) => event.kind === "group.plugin.setup").map((event) => event.marker)).toEqual(["stable", "second"]);
    expect(events.filter((event) => event.kind === "group.plugin.teardown").map((event) => event.marker)).toEqual(["second", "stable"]);
    expect(new Set(events.filter((event) => event.kind === "sandbox.plugin.setup").map((event) => event.physicalId)).size).toBe(1);
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
      scope: "group",
      name: "e2e.lifecycle",
      contributions: ["lifecycle"],
    }));

    const commands = await niceeval.run(["exp", "group-plugin", "--dry", "--commands", "--json"], {
      env: { ...process.env, PLUGIN_GROUP_VARIANT: "changed" },
    });
    expect(commands.exitCode, commands.diagnostic()).toBe(0);
    const lane = commands.json<ExpPlanDocument>().commandPlan!.experiments[0]!.lanes[0]!;
    expect(lane.beforeSlots!.map((step) => step.phase)).toEqual([
      "plugin.lifecycle.setup",
      "plugin.lifecycle.setup",
    ]);
    expect(lane.physicalLifecycleTemplate!.enter.map((step) => step.phase)).toContain("plugin.lifecycle.setup");
    expect(lane.slots[0]!.steps.map((step) => step.phase)).toContain("plugin.lifecycle.setup");
    expect(lane.physicalLifecycleTemplate!.exit.map((step) => step.phase)).toContain("plugin.lifecycle.teardown");
    expect(lane.afterSlots!.map((step) => step.phase)).toEqual([
      "plugin.lifecycle.teardown",
      "plugin.lifecycle.teardown",
    ]);
  });
});
