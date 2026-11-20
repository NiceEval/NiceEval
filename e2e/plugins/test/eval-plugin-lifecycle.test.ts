import { pollUntil } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { e2e, lifecycleEvents } from "./helpers.ts";
// @feature docs/feature/plugins/README.md
// @regression memory/attempt-cleanup-join-truncates-serial-callbacks.md
// @regression memory/attempt-interruption-closes-teardown-bridge.md

test.concurrent("SIGINT 后已激活 Eval Plugin teardown 使用独立 signal 恰好一次并保留中断结果", async () => {
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
      async () =>
        lifecycleEvents(paths.projectRoot).some((event) => event.kind === "eval.plugin.interrupt.test.started") ||
        undefined,
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

// @feature docs/feature/sandbox/README.md
// @regression memory/attempt-interruption-closes-teardown-bridge.md

test.concurrent("Attempt timeout 后 Direct Agent teardown 使用独立 signal 恰好一次并保留原始结果", async () => {
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
