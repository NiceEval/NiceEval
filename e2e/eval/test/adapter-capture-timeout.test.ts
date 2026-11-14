// rerun: pnpm e2e test --repo eval -- --run test/adapter-capture-timeout.test.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defined, only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E as adapterCaptureE2E } from "./context.ts";

// @feature docs/feature/run/README.md
test.concurrent("cleanup 总预算耗尽后拒绝迟到采集并保留已得分和成功附件", async () => {
  await adapterCaptureE2E.case("adapter-capture-timeout", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const completed = await niceeval.run(["exp", "adapter-capture/timeout", "--rerun", "all", "--json"], { timeoutMs: 90_000 });
    expect(completed.exitCode, completed.diagnostic()).toBe(1);
    expect(completed.expReceipt().completion).toBe("completed");
    expect(await readFile(join(projectRoot, "capture-stream-late.txt"), "utf8")).toBe("rejected");
    expect(await readFile(join(projectRoot, "capture-late.txt"), "utf8")).toBe("usage-rejected\nattachment-rejected\ntrace-rejected\n");
    const runId = only(completed.expReceipt().createdRunIds, () => true, completed.diagnostic());

    const run = await niceeval.run(["show", `run:${runId}`, "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const overview = run.inspectionSuccess("run.get").run;
    expect(overview.value.state).toBe("completed");
    const member = only(overview.plannedAttempts, () => true, run.diagnostic());
    expect(member).toMatchObject({ state: "executed", verdict: "errored", outcome: "errored", score: { value: 7 } });
    const locator = defined(member.publication.state === "published" ? member.publication.attemptLocator : null, "cleanup timeout must publish an errored Attempt");

    const attempt = await niceeval.run(["show", locator, "--json"]);
    const inspectedAttempt = attempt.inspectionSuccess("attempt.get").attempt;
    expect(inspectedAttempt).toMatchObject({
      core: { outcome: "errored" }, verdict: "errored", assertions: { state: "available" }, score: { earned: 7 },
    });
    expect(inspectedAttempt.assertions.entries).toHaveLength(1);
    expect(inspectedAttempt.assertions.entries[0]?.display.label).toBe("earned before cleanup timeout");

    const usage = await niceeval.run(["show", locator, "usage", "--json"]);
    expect(usage.inspectionSuccess("attempt.usage").usage.calls).toEqual([
      expect.objectContaining({ callId: "accepted-request", inputTokens: 3, outputTokens: 2 }),
    ]);

    const trace = await niceeval.run(["show", locator, "execution", "--json"]);
    expect(trace.exitCode, trace.diagnostic()).toBe(0);
    const execution = trace.inspectionSuccess("attempt.trace").trace.execution;
    expect(execution.events).toEqual([expect.objectContaining({ summary: "Trace accepted before cleanup" })]);
    expect(execution.traces).toEqual([expect.objectContaining({ sourceTraceId: "before-timeout" })]);

    const artifacts = await niceeval.run(["show", locator, "artifacts", "--json"]);
    const collection = artifacts.inspectionSuccess("attempt.artifacts").artifacts;
    expect(collection.state).toBe("available");
    if (collection.state !== "available") throw new Error(artifacts.diagnostic());
    expect(collection.value.artifacts).toEqual([expect.objectContaining({ label: "accepted.txt" })]);
  });
});
