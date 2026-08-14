// owner: docs/roadmap/plugins/README.md#v1-owner-matrix

import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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
}

interface DebugPlanDocument {
  readonly commandPlan: {
    readonly experiments: readonly {
      readonly lanes: readonly {
        readonly beforeSlots?: readonly DebugPlanStep[];
        readonly afterSlots?: readonly DebugPlanStep[];
        readonly physicalLifecycleTemplate?: {
          readonly enter: readonly DebugPlanStep[];
          readonly exit: readonly DebugPlanStep[];
        };
        readonly slots: readonly {
          readonly evalId: string;
          readonly steps: readonly DebugPlanStep[];
        }[];
      }[];
    }[];
  };
}

interface DebugPlanStep {
  readonly phase: string;
  readonly owner?: {
    readonly kind: string;
    readonly id: string;
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

    const commands = await niceeval.run(["debug", "group-plugin", "group-plugin/01-first", "--json"], {
      env: { ...process.env, PLUGIN_GROUP_VARIANT: "changed" },
    });
    expect(commands.exitCode, commands.diagnostic()).toBe(0);
    const debugPlan = commands.json<DebugPlanDocument>();
    const lane = debugPlan.commandPlan.experiments[0]!.lanes[0]!;
    expect(lane.beforeSlots!.map((step) => step.phase)).toEqual([
      "plugin.lifecycle.setup",
      "plugin.lifecycle.setup",
    ]);
    const physicalSetups = lane.physicalLifecycleTemplate!.enter.filter(
      (step) => step.phase === "plugin.lifecycle.setup",
    );
    expect(physicalSetups.map((step) => step.owner)).toEqual([
      { kind: "eval-group", id: "group-plugin" },
      { kind: "eval-group", id: "group-plugin" },
    ]);
    expect(lane.slots).toHaveLength(1);
    expect(lane.slots[0]!.evalId).toBe("group-plugin/01-first");
    const evalPluginSetups = lane.slots[0]!.steps.filter(
      (step) => step.phase === "plugin.lifecycle.setup",
    );
    expect(evalPluginSetups.map((step) => step.owner)).toEqual([
      { kind: "eval", id: "group-plugin/01-first" },
    ]);
    const physicalTeardowns = lane.physicalLifecycleTemplate!.exit.filter(
      (step) => step.phase === "plugin.lifecycle.teardown",
    );
    expect(physicalTeardowns.map((step) => step.owner)).toEqual([
      { kind: "eval-group", id: "group-plugin" },
      { kind: "eval-group", id: "group-plugin" },
    ]);
    expect(lane.afterSlots!.map((step) => step.phase)).toEqual([
      "plugin.lifecycle.teardown",
      "plugin.lifecycle.teardown",
    ]);

    for (const member of ["01-first", "02-second"]) {
      const evalPath = join(paths.projectRoot, "evals", "group-plugin", `${member}.eval.ts`);
      const original = await readFile(evalPath, "utf8");
      const withImport = original.replace(
        'import { evalOnlyLifecycle } from "../../plugins/lifecycle.ts";',
        'import { evalOnlyLifecycle, lifecycle } from "../../plugins/lifecycle.ts";',
      );
      const withPhysicalLifecycle = withImport.replace(
        `plugins: [evalOnlyLifecycle({ marker: "${member}" })],`,
        `plugins: [evalOnlyLifecycle({ marker: "${member}" }), lifecycle({ marker: "same-physical" })],`,
      );
      expect(withPhysicalLifecycle, `fixture mutation for ${member}`).not.toBe(original);
      await writeFile(evalPath, withPhysicalLifecycle, "utf8");
    }

    const incompatible = await niceeval.run(["exp", "group-plugin", "--dry", "--json"], {
      env: stableEnv,
    });
    expect(incompatible.exitCode, incompatible.diagnostic()).toBe(1);
    expect(incompatible.stderr, incompatible.diagnostic()).toContain('Eval "group-plugin/01-first"');
    expect(incompatible.stderr, incompatible.diagnostic()).toContain('Eval "group-plugin/02-second"');
    expect(incompatible.stderr, incompatible.diagnostic()).toContain("different physical lifecycle");
    expect(incompatible.stderr, incompatible.diagnostic()).toContain("No Sandbox was created");
  });
});
