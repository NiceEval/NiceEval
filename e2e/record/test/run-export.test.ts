import { rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createE2EContext } from "@niceeval/testkit";
import { decodeRunDocument } from "niceeval/run";
import { expect, test } from "vitest";

const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(), prefix: "niceeval-e2e-export-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")] },
});

// @feature docs/feature/run/README.md
test.concurrent("子集导出独立保留引用的 Attempt 与证据，并排除无关历史", async () => {
  await e2e.case("run-export-independent", async ({ paths, commands: { niceeval } }) => {
    const first = await niceeval.run(["exp", "migration-agent", "--rerun", "all", "--json"]);
    expect(first.exitCode, first.diagnostic()).toBe(0);
    const origin = first.expReceipt().createdRunIds[0]!;
    const second = await niceeval.run(["exp", "migration-agent", "--json"]);
    expect(second.exitCode, second.diagnostic()).toBe(0);
    const selected = second.expReceipt().createdRunIds[0]!;
    const unrelated = await niceeval.run(["exp", "migration-custom", "--rerun", "all", "--json"]);
    expect(unrelated.exitCode, unrelated.diagnostic()).toBe(0);
    const unrelatedId = unrelated.expReceipt().createdRunIds[0]!;
    const request = join(paths.projectRoot, "selected.query.json");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "run.get", runId: selected } }));
    const before = await niceeval.run(["query", "run", "--request", request]);
    expect(before.exitCode, before.diagnostic()).toBe(0);
    const expected = before.querySuccess("run.get");
    expect(expected.run.members).toEqual([expect.objectContaining({ action: "carried", attempt: expect.objectContaining({ originRunId: origin }) })]);
    const publication = expected.run.plannedAttempts[0]!.publication;
    if (publication.state !== "published") throw new Error("Expected a carried publication");
    const traceRequest = join(paths.projectRoot, "trace.query.json");
    await writeFile(traceRequest, JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.trace", locator: publication.attemptLocator } }));
    const traceBefore = await niceeval.run(["query", "run", "--request", traceRequest]);
    expect(traceBefore.exitCode, traceBefore.diagnostic()).toBe(0);
    const expectedTrace = traceBefore.querySuccess("attempt.trace").trace;
    const file = join(paths.projectRoot, "subset.sqlite");
    const exported = await niceeval.run(["run", "export", "--run", selected, "--run", selected, "--out", file, "--json"]);
    expect(exported.exitCode, exported.diagnostic()).toBe(0);
    const decoded = decodeRunDocument(exported.json<unknown>());
    expect(decoded.success, decoded.success ? "" : decoded.reason).toBe(true);
    if (!decoded.success) throw new Error(decoded.reason);
    expect(decoded.value).toMatchObject({ operation: "run.export", outcome: "exported", runIds: [selected] });
    // Remove the source from discovery: only the delivered file can satisfy reads.
    await rename(join(paths.projectRoot, ".niceeval"), join(paths.projectRoot, "source-unavailable"));
    const offline = await niceeval.run(["query", "run", "--record", file, "--request", request]);
    expect(offline.exitCode, offline.diagnostic()).toBe(0);
    expect(offline.querySuccess("run.get").run).toEqual(expected.run);
    const traceOffline = await niceeval.run(["query", "run", "--record", file, "--request", traceRequest]);
    expect(traceOffline.exitCode, traceOffline.diagnostic()).toBe(0);
    expect(traceOffline.querySuccess("attempt.trace").trace).toEqual(expectedTrace);
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "run.get", runId: unrelatedId } }));
    const excluded = await niceeval.run(["query", "run", "--record", file, "--request", request]);
    expect(excluded.exitCode, excluded.diagnostic()).not.toBe(0);
    expect(excluded.queryFailure().failure.code).toBe("inspection-selection-missing");
    await writeFile(request, JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "run.get", runId: origin } }));
    const dependency = await niceeval.run(["query", "run", "--record", file, "--request", request]);
    expect(dependency.exitCode, dependency.diagnostic()).toBe(0);
    expect(dependency.querySuccess("run.get").run.denominator).toEqual({ expected: 1, published: 1, missing: 0 });
  });
});
