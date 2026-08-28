// owner: docs/engineering/testing/e2e/plugins.md#eval-group-plugin-lifecycle

import type { ExpEvalEvent, ExpEvent } from "@niceeval/testkit";
import { expect, test } from "vitest";
import {
  e2e,
  lifecycleEvents,
  typecheckInstalledPluginConsumer,
  validateDynamicPluginConsumer,
} from "./helpers.ts";

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
    const evalEvents = run.expEvents().filter(
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

  });
});
