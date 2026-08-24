// owner: docs/feature/plugins/README.md#v1-owner-matrix

import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { expect, test } from "vitest";
import {
  e2e,
  lifecycleEvents,
  typecheckInstalledPluginConsumer,
  validateDynamicPluginConsumer,
} from "./helpers.ts";

interface ExpPlanDocument {
  readonly format: "niceeval.current-reuse-plan/v1";
  readonly total: number;
  readonly reused: number;
  readonly plugins: readonly {
    readonly scope: string;
    readonly name: string;
    readonly instanceKey: string;
    readonly behaviorRevision: string;
    readonly contributions: readonly string[];
    readonly sandbox?: {
      readonly present: true;
      readonly declaration: unknown;
    };
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
  readonly truth: string;
  readonly owner?: {
    readonly kind: string;
    readonly id: string;
  };
  readonly action?: {
    readonly id: string;
  };
}

test("Eval Group、Sandbox 与 Eval Plugin 各自遵守共享实例的生命周期", async () => {
  await e2e.case("group-owner-lifecycle", async ({ paths, commands: { niceeval } }) => {
    const typecheck = await typecheckInstalledPluginConsumer(paths.projectRoot);
    expect(typecheck.exitCode, typecheck.diagnostic()).toBe(0);

    const dynamic = await validateDynamicPluginConsumer(paths.projectRoot);
    expect(dynamic.exitCode, dynamic.diagnostic()).toBe(0);
    expect(dynamic.json()).toEqual({
      sandboxOnlyCreated: true,
      emptyRejected: true,
      hostOwnersNotWidened: true,
      templateRejected: true,
      unbrandedRejected: true,
    });

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
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
      "group.plugin.teardown",
      "group.plugin.teardown",
    ]);
    expect(events.filter((event) => event.kind === "group.plugin.setup").map((event) => event.marker)).toEqual(["first", "second"]);
    expect(events.filter((event) => event.kind === "group.plugin.teardown").map((event) => event.marker)).toEqual(["second", "first"]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => [event.marker, event.declaredMarker])).toEqual([
      ["stable", "stable"], ["first", "first"], ["second", "second"],
      ["stable", "stable"], ["first", "first"], ["second", "second"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.after").map((event) => [event.marker, event.ownerKind, event.ownerId])).toEqual([
      ["second", "eval-group", "group-plugin"],
      ["first", "eval-group", "group-plugin"],
      ["stable", "eval-group", "group-plugin"],
      ["second", "eval-group", "group-plugin"],
      ["first", "eval-group", "group-plugin"],
      ["stable", "eval-group", "group-plugin"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.after").map((event) => event.physicalId)).toEqual(
      events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => event.physicalId),
    );
    expect(new Set(events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => event.physicalId)).size).toBe(1);
    expect(events.filter((event) => event.kind === "agent.send")).toHaveLength(2);

    const same = await niceeval.run(["exp", "group-plugin", "--dry", "--json"], {
      env: stableEnv,
    });
    expect(same.exitCode, same.diagnostic()).toBe(0);
    const samePlan = same.json<ExpPlanDocument>();
    expect(samePlan).toMatchObject({
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
    const stableToolchain = samePlan.plugins.find((plugin) => plugin.name === "e2e.sandbox-only-toolchain");
    const changedToolchain = changedPlan.plugins.find((plugin) => plugin.name === "e2e.sandbox-only-toolchain");
    expect(stableToolchain).toEqual(expect.objectContaining({
      scope: "group",
      name: "e2e.sandbox-only-toolchain",
      instanceKey: "default",
      behaviorRevision: "1",
      contributions: ["sandbox"],
      sandbox: expect.objectContaining({ present: true }),
    }));
    expect(changedToolchain).toEqual(expect.objectContaining({
      scope: "group",
      name: "e2e.sandbox-only-toolchain",
      instanceKey: "default",
      behaviorRevision: "1",
      contributions: ["sandbox"],
      sandbox: expect.objectContaining({ present: true }),
    }));
    expect(changedToolchain!.sandbox!.declaration).not.toEqual(stableToolchain!.sandbox!.declaration);
    expect(changedPlan.plugins).toContainEqual(expect.objectContaining({
      scope: "group",
      name: "e2e.lifecycle",
      contributions: ["lifecycle", "sandbox"],
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
    expect(physicalSetups).toEqual([]);
    expect(lane.slots).toHaveLength(1);
    expect(lane.slots[0]!.evalId).toBe("group-plugin/01-first");
    const sandboxBefore = lane.slots[0]!.steps.filter(
      (step) => step.phase === "sandbox.before" && step.owner?.kind === "eval-group",
    );
    expect(sandboxBefore).toHaveLength(6);
    expect(sandboxBefore.filter((step) => step.truth === "exact").map((step) => step.action?.id)).toEqual([
      "e2e.plugin.toolchain.marker",
      "e2e.plugin.lifecycle.first.marker",
      "e2e.plugin.lifecycle.second.marker",
    ]);
    expect(sandboxBefore.map((step) => step.owner)).toEqual(Array.from(
      { length: 6 },
      () => ({ kind: "eval-group", id: "group-plugin" }),
    ));
    const evalPluginSetups = lane.slots[0]!.steps.filter(
      (step) => step.phase === "plugin.lifecycle.setup",
    );
    expect(evalPluginSetups.map((step) => step.owner)).toEqual([
      { kind: "eval", id: "group-plugin/01-first" },
    ]);
    const physicalTeardowns = lane.physicalLifecycleTemplate!.exit.filter(
      (step) => step.phase === "plugin.lifecycle.teardown",
    );
    expect(physicalTeardowns).toEqual([]);
    const sandboxAfter = lane.slots[0]!.steps.filter(
      (step) => step.phase === "sandbox.after" && step.owner?.kind === "eval-group",
    );
    expect(sandboxAfter).toHaveLength(4);
    expect(lane.afterSlots!.map((step) => step.phase)).toEqual([
      "plugin.lifecycle.teardown",
      "plugin.lifecycle.teardown",
    ]);

  });
});
