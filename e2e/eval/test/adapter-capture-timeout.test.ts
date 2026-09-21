// rerun: pnpm e2e test --repo eval -- --run test/adapter-capture-timeout.test.ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defined, only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E as adapterCaptureE2E } from "./context.ts";

test.concurrent("cleanup 总预算耗尽后拒绝迟到采集并保留已得分和成功附件 [necase_A8MF18FNMHPRDD81]", async () => {
  await adapterCaptureE2E.case("adapter-capture-timeout", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const completed = await niceeval.run(["exp", "adapter-capture/timeout", "--rerun", "all", "--json"], { timeoutMs: 90_000 });
    expect(completed.exitCode, completed.diagnostic()).toBe(1);
    expect(completed.expReceipt().completion).toBe("completed");
    expect(await readFile(join(projectRoot, "capture-late.txt"), "utf8")).toBe("usage-rejected\nattachment-rejected\n");
    const runId = only(completed.expReceipt().createdRunIds, () => true, completed.diagnostic());
    const request = join(projectRoot, "capture-query.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "run.overview", runId } }));
    const run = await niceeval.run(["query", "run", "--request", request]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const overview = run.querySuccess("run.overview").runOverview;
    expect(overview.state).toBe("completed");
    const member = only(overview.members, () => true, run.diagnostic());
    expect(member).toMatchObject({ state: "executed", verdict: "errored", outcome: "errored", score: { earned: 7 } });
    const locator = defined(member.locator, "cleanup timeout must publish an errored Attempt");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.get", locator } }));
    const attempt = await niceeval.run(["query", "run", "--request", request]);
    const inspectedAttempt = attempt.querySuccess("attempt.get").attempt;
    expect(inspectedAttempt).toMatchObject({
      core: { outcome: "errored" }, verdict: "errored", assertions: { state: "available" }, score: { earned: 7 },
    });
    expect(inspectedAttempt.assertions.entries).toHaveLength(1);
    expect(inspectedAttempt.assertions.entries[0]?.display.label).toBe("earned before cleanup timeout");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator } }));
    const usage = await niceeval.run(["query", "run", "--request", request]);
    expect(usage.querySuccess("attempt.usage").usage.calls).toEqual([
      expect.objectContaining({ callId: "accepted-request", inputTokens: 3, outputTokens: 2 }),
    ]);
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifacts", locator } }));
    const artifacts = await niceeval.run(["query", "run", "--request", request]);
    const collection = artifacts.querySuccess("attempt.artifacts").artifacts;
    expect(collection.state).toBe("available");
    if (collection.state !== "available") throw new Error(artifacts.diagnostic());
    expect(collection.value.artifacts).toEqual([expect.objectContaining({ label: "accepted.txt" })]);
  });
});
