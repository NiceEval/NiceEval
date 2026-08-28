// owner: docs/engineering/testing/e2e/runner.md#runner-history-dedup
// regression: memory/multi-open-residual-window-closed-by-narrow-read.md
// rerun: pnpm e2e test --repo runner -- --run test/history-dedup.test.ts
import { only, pollUntil, withTempDir } from "@niceeval/testkit";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runnerE2E, writeInspectionRequest } from "./context.ts";

interface ExpEvent {
  event: string;
  total?: number;
  reused?: number;
  locator?: string;
  evalId?: string;
  verdict?: string;
  attempts?: number;
  passed?: number;
}

interface DryTarget {
  experimentId: string;
  evalId: string;
  slots: Array<{ state: "reused" | "gap" }>;
  readbacks: Array<{
    source: { attemptId: string; locator: string };
    verdict: string | { state: string; value?: string };
  }>;
}

interface DryPlan {
  total: number;
  reused: number;
  matrix: DryTarget[];
}

interface TimingDocument {
  readonly operation: "attempt.timing";
  readonly issues: readonly unknown[];
  readonly timing: {
    readonly state: "complete" | "partial" | "not-recorded" | "invalid";
    readonly activities: readonly {
      readonly activityId: string;
      readonly parentActivityId: string | null;
      readonly phase: string;
      readonly outcome: string;
    }[];
  };
}

test("强制重跑追加 identity，carry run 不在 history 复制旧 attempt", async () => {
  await runnerE2E.case(
    "history-dedup",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      const root = paths.projectRoot;
    const first = await niceeval.run(["exp", "history", "--rerun", "all", "--json"]);
    expect(first.exitCode, first.diagnostic()).toBe(0);
    const firstEval = only(first.ndjson<ExpEvent>(), (event) => event.event === "eval", first.diagnostic());
    expect(firstEval).toMatchObject({
      event: "eval",
      evalId: "suite/stable",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    const firstLocator = firstEval.locator!;
    expect(firstLocator).toMatch(/^@1[0-9A-HJKMNP-TV-Z]{12}$/);

    const forced = await niceeval.run(["exp", "history", "--rerun", "all", "--json"]);
    expect(forced.exitCode, forced.diagnostic()).toBe(0);
    const forcedEval = only(forced.ndjson<ExpEvent>(), (event) => event.event === "eval", forced.diagnostic());
    expect(forcedEval).toMatchObject({
      event: "eval",
      evalId: "suite/stable",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    const forcedLocator = forcedEval.locator!;
    expect(forcedLocator).not.toBe(firstLocator);

    const currentDry = await niceeval.run(["exp", "history", "--dry", "--json"]);
    expect(currentDry.exitCode, currentDry.diagnostic()).toBe(0);
    const currentPlan = currentDry.json<DryPlan>();
    expect(currentPlan).toMatchObject({ total: 1, reused: 1 });
    const currentTarget = currentPlan.matrix.find((row) => row.evalId === "suite/stable");
    expect(currentTarget).toBeDefined();
    expect(currentTarget!.slots.map((slot) => slot.state)).toEqual(["reused"]);
    expect(currentTarget!.readbacks).toHaveLength(1);
    expect(currentTarget!.readbacks[0]!.source.locator).toBe(forcedLocator);
    expect(currentTarget!.readbacks[0]!.verdict).toBe("passed");

    const carried = await niceeval.run(["exp", "history", "--json"]);
    expect(carried.exitCode, carried.diagnostic()).toBe(0);
    const carriedEvents = carried.ndjson<ExpEvent>();
    const carriedStart = only(carriedEvents, (event) => event.event === "start", carried.diagnostic());
    expect(carriedStart).toMatchObject({ event: "start", total: 1, reused: 1 });
    const carriedReceipt = carried.expReceipt();
    expect(carriedReceipt).toMatchObject({ completion: "completed" });
    expect(carriedReceipt.createdRunIds).toHaveLength(1);

    const snapshot = join(root, "history.record-snapshot.sqlite");
    const exported = await niceeval.run(["record", "snapshot", "--output", snapshot]);
    expect(exported.exitCode, exported.diagnostic()).toBe(0);
    const listRequest = await writeInspectionRequest(root, "history-runs", { kind: "run.list" });
    const listed = await niceeval.run(["query", "run", "--record", snapshot, "--request", listRequest]);
    expect(listed.exitCode, listed.diagnostic()).toBe(0);
    const listDocument = listed.json<{ readonly operation: string; readonly runs: unknown }>();
    expect(listDocument.operation).toBe("run.list");
    const listedRuns = JSON.stringify(listDocument.runs);
    expect(listedRuns).toContain(first.expReceipt().createdRunIds[0]!);
    expect(listedRuns).toContain(forced.expReceipt().createdRunIds[0]!);
    expect(listedRuns).toContain(carriedReceipt.createdRunIds[0]!);

    const traceRequest = await writeInspectionRequest(root, "forced-attempt-trace", {
      kind: "attempt.trace", locator: forcedLocator,
    });
    const trace = await niceeval.run(["query", "run", "--record", snapshot, "--request", traceRequest]);
    expect(trace.exitCode, trace.diagnostic()).toBe(0);
    const traceDocument = trace.json<{ readonly operation: string; readonly issues: readonly unknown[]; readonly trace: unknown }>();
    expect(traceDocument).toMatchObject({ operation: "attempt.trace", issues: [] });
    const traceFacts = JSON.stringify(traceDocument.trace);
    expect(traceFacts).toContain("runner-fixture-ok");

    const timingRequest = await writeInspectionRequest(root, "forced-attempt-timing", {
      kind: "attempt.timing", locator: forcedLocator,
    });
    const timing = await niceeval.run(["query", "run", "--record", snapshot, "--request", timingRequest]);
    expect(timing.exitCode, timing.diagnostic()).toBe(0);
    const timingDocument = timing.json<TimingDocument>();
    expect(timingDocument).toMatchObject({ operation: "attempt.timing", issues: [], timing: { state: "complete" } });
    const evalRun = only(timingDocument.timing.activities, (activity) => activity.phase === "eval.run", timing.diagnostic());
    const agentSend = only(timingDocument.timing.activities, (activity) => activity.phase === "agent.send", timing.diagnostic());
    expect(evalRun).toMatchObject({ parentActivityId: null, outcome: "completed" });
    expect(agentSend).toMatchObject({ parentActivityId: evalRun.activityId, outcome: "completed" });
    },
  );
});

test("两次同时运行同一实验时，后开始的那次不重复跑已经完成的题目", async () => {
  await runnerE2E.case(
    "history-dedup-concurrent",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval }, paths }) => {
      await withTempDir("niceeval-runner-concurrent-", async (barrierRoot) => {
        const first = niceeval.start(["exp", "concurrent", "--json"], {
          env: { NICEEVAL_CONCURRENCY_BARRIER: barrierRoot, NICEEVAL_CONCURRENCY_ROLE: "A" },
          timeoutMs: 60_000,
        });
        await pollUntil(
          async () => {
            try {
              await access(join(barrierRoot, "first-run-started-alpha"));
              return true;
            } catch {
              return undefined;
            }
          },
          { timeoutMs: 30_000, intervalMs: 10, label: "first run starts the eval" },
        );

        const second = niceeval.start(["exp", "concurrent", "--json"], {
          env: { NICEEVAL_CONCURRENCY_BARRIER: barrierRoot, NICEEVAL_CONCURRENCY_ROLE: "B" },
          timeoutMs: 60_000,
        });
        const secondState = await pollUntil(
          async () => {
            if (/"event":"lock_wait".*"status":"started"/.test(second.bufferedStdout)) return "waited";
            try {
              await access(join(barrierRoot, "second-run-started-alpha"));
              return "ran-again";
            } catch {
              return undefined;
            }
          },
          { timeoutMs: 30_000, intervalMs: 10, label: "second run either waits or starts the same eval again" },
        );
        expect(secondState).toBe("waited");
        await writeFile(join(barrierRoot, "release-first-run"), "");

        const [firstResult, secondResult] = await Promise.all([first.done, second.done]);
        expect(firstResult.exitCode, firstResult.diagnostic()).toBe(0);
        expect(secondResult.exitCode, secondResult.diagnostic()).toBe(0);
        const firstRunId = only(firstResult.expReceipt().createdRunIds, () => true, firstResult.diagnostic());
        const secondRunId = only(secondResult.expReceipt().createdRunIds, () => true, secondResult.diagnostic());

        await expect(access(join(barrierRoot, "second-run-started-alpha"))).rejects.toThrow();
        const snapshot = join(paths.projectRoot, "concurrent.record-snapshot.sqlite");
        const exported = await niceeval.run(["record", "snapshot", "--output", snapshot]);
        expect(exported.exitCode, exported.diagnostic()).toBe(0);
        const request = await writeInspectionRequest(paths.projectRoot, "concurrent-second-run", {
          kind: "run.get", runId: secondRunId,
        });
        const secondRun = await niceeval.run(["query", "run", "--record", snapshot, "--request", request]);
        expect(secondRun.exitCode, secondRun.diagnostic()).toBe(0);
        const document = secondRun.json<{ readonly operation: string; readonly issues: readonly unknown[]; readonly run: unknown }>();
        expect(document).toMatchObject({ operation: "run.get", issues: [] });
        expect(JSON.stringify(document.run)).toContain(firstRunId);
      });
    },
  );
});
