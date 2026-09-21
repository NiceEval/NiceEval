// rerun: pnpm e2e test --repo eval -- --run test/adapter-capture-interrupt.test.ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defined, only, pollUntil } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E as adapterCaptureE2E } from "./context.ts";

test.concurrent("SIGINT 排空共享 finish 的尾部采集并在 Run 终态前发布 errored Attempt [necase_0GXNKG5JBPHFTZ15]", async () => {
  await adapterCaptureE2E.case("adapter-capture-interrupt", async ({ paths: { projectRoot }, commands: { niceeval } }) => {
    const process = niceeval.start(["exp", "adapter-capture/interrupt", "--rerun", "all", "--json"], { timeoutMs: 90_000 });
    const waitFor = (file: string, content: string) => Promise.race([
      pollUntil(async () => {
        const text = await readFile(join(projectRoot, file), "utf8").catch(() => "");
        return text === content ? true : undefined;
      }, { timeoutMs: 20_000, intervalMs: 20, label: file }),
      process.done.then((receipt) => { throw new Error(`exited before ${file}\n${receipt.diagnostic()}`); }),
    ]);
    await waitFor("capture-ready.txt", "ready");
    expect(process.signal("SIGINT")).toBe(true);
    await waitFor("capture-finish.txt", "start\n");
    await writeFile(join(projectRoot, "capture-release.txt"), "release");
    const interrupted = await process.done;
    expect(interrupted.exitCode, interrupted.diagnostic()).toBe(130);
    expect(interrupted.expReceipt().completion).toBe("interrupted");
    expect(await readFile(join(projectRoot, "capture-created.txt"), "utf8")).toBe("0\n");
    expect(await readFile(join(projectRoot, "capture-finish.txt"), "utf8")).toBe("start\ndone\n");

    const runId = only(interrupted.expReceipt().createdRunIds, () => true, interrupted.diagnostic());
    const request = join(projectRoot, "capture-query.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "run.overview", runId } }));
    const run = await niceeval.run(["query", "run", "--request", request]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const overview = run.querySuccess("run.overview").runOverview;
    expect(overview.state).toBe("interrupted");
    expect(overview.denominator).toEqual({ expected: 2, observed: 1 });
    const member = only(overview.members, (entry) => entry.locator !== null, run.diagnostic());
    expect(member).toMatchObject({ state: "executed", verdict: "errored", outcome: "errored", score: { earned: 7 } });
    const locator = defined(member.locator, "cancelled Attempt must be published");

    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.get", locator } }));
    const attempt = await niceeval.run(["query", "run", "--request", request]);
    const inspectedAttempt = attempt.querySuccess("attempt.get").attempt;
    expect(inspectedAttempt).toMatchObject({
      core: { outcome: "errored" }, verdict: "errored", assertions: { state: "available" }, score: { earned: 7 },
    });
    expect(inspectedAttempt.assertions.entries).toHaveLength(1);
    expect(inspectedAttempt.assertions.entries[0]?.display.label).toBe("earned before cancellation");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.usage", locator } }));
    const usage = await niceeval.run(["query", "run", "--request", request]);
    expect(usage.querySuccess("attempt.usage").usage.calls).toEqual([
      expect.objectContaining({ callId: "cancelled-request", status: "cancelled", inputTokens: 13, outputTokens: 5 }),
    ]);
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.trace", locator } }));
    const trace = await niceeval.run(["query", "run", "--request", request]);
    expect(trace.exitCode, trace.diagnostic()).toBe(0);
    const execution = trace.querySuccess("attempt.trace").trace.execution;
    expect(execution.traces).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceTraceId: "cancelled-complete", collection: { state: "complete", limitations: [] }, scopes: [] }),
      expect.objectContaining({ sourceTraceId: "missing-checkpoint", collection: { state: "partial", limitations: [expect.objectContaining({ code: "checkpoint-missing" })] }, scopes: [] }),
    ]));
    expect(execution.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ summary: "Cancellation observed; capture complete" }),
      expect.objectContaining({ summary: "Verified cancellation tail" }),
    ]));
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifacts", locator } }));
    const artifacts = await niceeval.run(["query", "run", "--request", request]);
    const collection = artifacts.querySuccess("attempt.artifacts").artifacts;
    expect(collection.state).toBe("available");
    if (collection.state !== "available") throw new Error(artifacts.diagnostic());
    const artifact = only(collection.value.artifacts, () => true, artifacts.diagnostic());
    expect(artifact.label).toBe("tail.txt");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v1", operation: { kind: "attempt.artifact", locator, artifactId: artifact.artifactId } }));
    const bytes = await niceeval.run(["query", "run", "--request", request]);
    expect(bytes.querySuccess("attempt.artifact").artifact).toMatchObject({
      state: "available", base64: Buffer.from("cancelled-tail").toString("base64"), nextOffset: null,
    });
  });
});
