
import { pollUntil, type ExpEvalEvent } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { e2e, lifecycleEvents } from "./helpers.ts";

test("多个 Eval Plugin 与 Sandbox Plugin 按 fresh Attempt 和物理实例运行 [necase_VB3ZSYTQH0EBWQSA]", async () => {
  await e2e.case("eval-owner-lifecycle", async ({ paths, commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "eval-plugin", "--rerun", "all", "--json"], {
      timeoutMs: 180_000,
    });
    expect(run.exitCode, run.diagnostic()).toBe(0);
    expect(run.expReceipt().completion, run.diagnostic()).toBe("completed");
    const evalEvents = run.expEvents().filter(
      (event): event is ExpEvalEvent => "event" in event && event.event === "eval",
    );
    expect(evalEvents, run.diagnostic()).toHaveLength(1);
    expect(evalEvents[0]).toMatchObject({ verdict: "passed", attempts: 2, passed: 2 });

    const events = lifecycleEvents(paths.projectRoot);
    expect(events.map((event) => event.kind)).toEqual([
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
      "sandbox.plugin.before",
      "sandbox.plugin.before",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "eval.plugin.setup",
      "agent.send",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "eval.plugin.teardown",
      "sandbox.plugin.after",
      "sandbox.plugin.after",
    ]);
    expect(events.filter((event) => event.kind === "eval.plugin.setup").map((event) => [event.attempt, event.marker])).toEqual([
      [0, "default"], [0, "owner-a"], [0, "owner-b"],
      [1, "default"], [1, "owner-a"], [1, "owner-b"],
    ]);
    expect(events.filter((event) => event.kind === "eval.plugin.teardown").map((event) => [event.attempt, event.marker])).toEqual([
      [0, "owner-b"], [0, "owner-a"], [0, "default"],
      [1, "owner-b"], [1, "owner-a"], [1, "default"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => [event.marker, event.declaredMarker])).toEqual([
      ["owner-a", "owner-a"],
      ["owner-b", "owner-b"],
      ["owner-a", "owner-a"],
      ["owner-b", "owner-b"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.after").map((event) => [event.marker, event.ownerKind, event.ownerId])).toEqual([
      ["owner-b", "eval", "eval-plugin/owner"],
      ["owner-a", "eval", "eval-plugin/owner"],
      ["owner-b", "eval", "eval-plugin/owner"],
      ["owner-a", "eval", "eval-plugin/owner"],
    ]);
    expect(events.filter((event) => event.kind === "sandbox.plugin.after").map((event) => event.physicalId)).toEqual(
      events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => event.physicalId),
    );
    expect(new Set(events.filter((event) => event.kind === "sandbox.plugin.before").map((event) => event.physicalId)).size).toBe(2);
  });
});

test.concurrent("SIGINT 后已激活 Eval Plugin teardown 使用独立 signal 恰好一次并保留中断结果 [necase_KVESCV3S1ZDJ5TYR]", async () => {
  await e2e.case("eval-plugin-interrupt-teardown", async ({ paths, commands: { niceeval } }) => {
    const run = niceeval.start(["exp", "eval-plugin-interrupt", "--rerun", "all", "--json"], {
      // Two individually valid 20s callbacks must retain their full ordered cleanup.
      timeoutMs: 75_000,
      graceMs: 2_000,
    });
    const setup = await pollUntil(
      async () => {
        try {
          return lifecycleEvents(paths.projectRoot).find((event) => event.kind === "eval.plugin.interrupt.setup");
        } catch {
          return undefined;
        }
      },
      { timeoutMs: 10_000, intervalMs: 25, label: "Eval Plugin managed resource setup" },
    );
    expect(setup.signalAborted).toBe(false);
    expect(typeof setup.resourcePid).toBe("number");
    expect(() => process.kill(setup.resourcePid as number, 0)).not.toThrow();
    await pollUntil(
      async () => lifecycleEvents(paths.projectRoot).some((event) => event.kind === "eval.plugin.interrupt.test.started") || undefined,
      { timeoutMs: 10_000, intervalMs: 25, label: "Eval Plugin author test to remain active" },
    );

    expect(run.signal("SIGINT")).toBe(true);
    const interrupted = await run.done;
    expect(interrupted.exitCode, interrupted.diagnostic()).toBe(130);
    expect(interrupted.expReceipt(), interrupted.diagnostic()).toMatchObject({
      completion: "interrupted",
      createdRunIds: [expect.any(String)],
    });

    const events = lifecycleEvents(paths.projectRoot);
    const pluginTeardownStarted = events.filter((event) => event.kind === "eval.plugin.interrupt.teardown.started");
    const pluginTeardownCompleted = events.filter((event) => event.kind === "eval.plugin.interrupt.teardown.completed");
    expect(pluginTeardownStarted, "the activated Eval Plugin teardown must start exactly once").toHaveLength(1);
    expect(pluginTeardownCompleted, "the activated Eval Plugin teardown must complete exactly once").toHaveLength(1);
    expect(pluginTeardownStarted).toEqual([expect.objectContaining({ signalAborted: false })]);
    const agentTeardownStarted = events.filter((event) => event.kind === "direct.agent.teardown.started");
    const agentTeardownCompleted = events.filter((event) => event.kind === "direct.agent.teardown.completed");
    expect(agentTeardownStarted, "the activated Direct Agent teardown must start exactly once").toHaveLength(1);
    expect(agentTeardownCompleted, "the activated Direct Agent teardown must complete exactly once").toHaveLength(1);
    expect(events.map((event) => event.kind)).toEqual([
      "eval.plugin.interrupt.setup",
      "direct.agent.setup",
      "direct.agent.send",
      "eval.plugin.interrupt.test.started",
      "eval.plugin.interrupt.test.aborted",
      "direct.agent.teardown.started",
      "direct.agent.teardown.completed",
      "eval.plugin.interrupt.teardown.started",
      "eval.plugin.interrupt.teardown.completed",
    ]);
    const managedPids = events
      .filter((event) => event.kind === "eval.plugin.interrupt.setup" || event.kind === "direct.agent.setup")
      .map((event) => event.resourcePid);
    expect(managedPids).toHaveLength(2);
    for (const pid of managedPids) {
      expect(typeof pid).toBe("number");
      expect(() => process.kill(pid as number, 0)).toThrow();
    }
  });
});

test.concurrent("Attempt timeout 后 Direct Agent teardown 使用独立 signal 恰好一次并保留原始结果 [necase_8XVYC6XMEE941YZ5]", async () => {
  await e2e.case("direct-agent-timeout-teardown", async ({ paths, commands: { niceeval } }) => {
    const run = niceeval.start(["exp", "direct-agent-timeout", "--rerun", "all", "--json"], {
      timeoutMs: 30_000,
      graceMs: 2_000,
    });
    const result = await run.done;
    expect(result.exitCode, result.diagnostic()).toBe(1);
    expect(result.expReceipt(), result.diagnostic()).toMatchObject({ completion: "completed" });
    expect(result.expEvalEvents(), result.diagnostic()).toEqual([
      expect.objectContaining({
        experimentId: "direct-agent-timeout",
        evalId: "attempt-interruption/direct-agent-timeout",
        verdict: "errored",
        attempts: 1,
      }),
    ]);

    const events = lifecycleEvents(paths.projectRoot);
    const teardownStarted = events.filter((event) => event.kind === "direct.agent.teardown.started");
    const teardownCompleted = events.filter((event) => event.kind === "direct.agent.teardown.completed");
    expect(teardownStarted, "the activated Direct Agent teardown must start exactly once").toHaveLength(1);
    expect(teardownCompleted, "the activated Direct Agent teardown must complete exactly once").toHaveLength(1);
    expect(teardownStarted).toEqual([expect.objectContaining({ signalAborted: false })]);
    expect(events.map((event) => event.kind)).toEqual([
      "direct.agent.setup",
      "direct.agent.send",
      "direct.agent.test.started",
      "direct.agent.test.aborted",
      "direct.agent.teardown.started",
      "direct.agent.teardown.completed",
    ]);
    const setup = events.find((event) => event.kind === "direct.agent.setup");
    expect(setup).toBeDefined();
    expect(setup?.signalAborted).toBe(false);
    expect(typeof setup?.resourcePid).toBe("number");
    expect(() => process.kill(setup?.resourcePid as number, 0)).toThrow();
  });
});
