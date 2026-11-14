import { rename } from "node:fs/promises";
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

    const before = await niceeval.run(["show", `run:${selected}`, "--json"]);
    expect(before.exitCode, before.diagnostic()).toBe(0);
    const expected = before.inspectionSuccess("run.get");
    expect(expected.run.members).toEqual([expect.objectContaining({ action: "carried", attempt: expect.objectContaining({ originRunId: origin }) })]);
    const publication = expected.run.plannedAttempts[0]!.publication;
    if (publication.state !== "published") throw new Error("Expected a carried publication");

    const traceBefore = await niceeval.run(["show", publication.attemptLocator, "execution", "--json"]);
    expect(traceBefore.exitCode, traceBefore.diagnostic()).toBe(0);
    const expectedTrace = traceBefore.inspectionSuccess("attempt.trace").trace;
    const file = join(paths.projectRoot, "subset.sqlite");
    const exported = await niceeval.run(["run", "export", "--run", selected, "--run", selected, "--out", file, "--json"]);
    expect(exported.exitCode, exported.diagnostic()).toBe(0);
    const decoded = decodeRunDocument(exported.json<unknown>());
    expect(decoded.success, decoded.success ? "" : decoded.reason).toBe(true);
    if (!decoded.success) throw new Error(decoded.reason);
    expect(decoded.value).toMatchObject({ operation: "run.export", outcome: "exported", runIds: [selected] });
    // Remove the source from discovery: only the delivered file can satisfy reads.
    await rename(join(paths.projectRoot, ".niceeval"), join(paths.projectRoot, "source-unavailable"));
    const offline = await niceeval.run(["show", `run:${selected}`, "--record", file, "--json"]);
    expect(offline.exitCode, offline.diagnostic()).toBe(0);
    expect(offline.inspectionSuccess("run.get").run).toEqual(expected.run);
    const traceOffline = await niceeval.run(["show", publication.attemptLocator, "execution", "--record", file, "--json"]);
    expect(traceOffline.exitCode, traceOffline.diagnostic()).toBe(0);
    expect(traceOffline.inspectionSuccess("attempt.trace").trace).toEqual(expectedTrace);

    const excluded = await niceeval.run(["show", `run:${unrelatedId}`, "--record", file, "--json"]);
    expect(excluded.exitCode, excluded.diagnostic()).not.toBe(0);
    expect(excluded.inspectionFailure().failure.code).toBe("inspection-selection-missing");

    const dependency = await niceeval.run(["show", `run:${origin}`, "--record", file, "--json"]);
    expect(dependency.exitCode, dependency.diagnostic()).toBe(0);
    expect(dependency.inspectionSuccess("run.get").run.denominator).toEqual({ expected: 1, published: 1, missing: 0 });
  });
});
