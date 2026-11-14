import { join, resolve } from "node:path";
import { createE2EContext } from "@niceeval/testkit";
import { decodeRunDocument } from "niceeval/run";
import { Effect, Result } from "effect";
import { runHost } from "niceeval/run/host";
import { expect, test } from "vitest";

const e2e = createE2EContext({
  repoId: "record",
  project: {
    from: process.cwd(),
    prefix: "niceeval-e2e-run-list-",
    omitTopLevel: [".e2e-artifacts", ".niceeval", "node_modules", "test"],
    links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
  },
  commands: { niceeval: [join(process.cwd(), "node_modules", ".bin", "niceeval")] },
});

// @use-case docs/feature/run/use-case/应用中列出运行.md
test.concurrent("列表按新到旧过滤运行，并说明截断数量", async () => {
  await e2e.case("run-list-filters", async ({ paths, commands: { niceeval } }) => {
    const empty = await niceeval.run(["run", "list", "--state", "completed", "--limit", "1", "--json"]);
    expect(empty.exitCode, empty.diagnostic()).toBe(0);
    expect(Object.keys(empty.runListDocument()).sort()).toEqual(["omitted", "operation", "runs"]);
    expect(empty.runListDocument()).toMatchObject({ runs: [], omitted: 0 });
    const ids: string[] = [];
    for (const experiment of ["run-list/agent", "migration-custom", "run-list/agent"]) {
      const result = await niceeval.run(["exp", experiment, "--rerun", "all", "--json"]);
      expect(result.exitCode, result.diagnostic()).toBe(0);
      ids.push(result.expReceipt().createdRunIds[0]!);
    }
    const all = await niceeval.run(["run", "list", "--json"]);
    expect(all.exitCode, all.diagnostic()).toBe(0);
    const listed = all.runListDocument();
    expect(listed.runs.map((run) => run.runId)).toEqual([...ids].reverse());
    expect(listed).toMatchObject({ omitted: 0 });
    expect(listed.runs.every((run) => !("owner" in run))).toBe(true);
    const selected = await niceeval.run([
      "run",
      "list",
      "--state",
      "failed",
      "--state",
      "completed",
      "--experiment",
      "run-list",
      "--limit",
      "1",
      "--json",
    ]);
    expect(selected.exitCode, selected.diagnostic()).toBe(0);
    expect(selected.runListDocument()).toMatchObject({ runs: [{ runId: ids[2] }], omitted: 1 });
    expect(selected.runListDocument().runs).toHaveLength(1);
    const human = await niceeval.run(["run", "list", "--experiment", "run-list", "--limit", "1"]);
    expect(human.exitCode, human.diagnostic()).toBe(0);
    expect(human.stdout).toContain("1 Runs omitted");
    const invocation = listed.runs[0]!.invocationId;
    const exact = await niceeval.run(["run", "list", "--invocation", invocation, "--state", "completed", "--json"]);
    expect(exact.exitCode, exact.diagnostic()).toBe(0);
    expect(exact.runListDocument().runs.map((run) => run.runId)).toEqual([ids[2]]);
    const wrong = await niceeval.run(["run", "list", "--invocation", invocation.slice(0, -1), "--json"]);
    expect(wrong.exitCode, wrong.diagnostic()).toBe(0);
    expect(wrong.runListDocument().runs).toEqual([]);
    const library = await Effect.runPromise(
      runHost.list({ cwd: paths.projectRoot, states: ["completed"], experimentIdPrefix: "run-list", limit: 1 }),
    );
    expect(library).toMatchObject({ runs: [{ runId: ids[2] }], omitted: 1 });
    expect(library.runs).toHaveLength(1);
    expect(
      decodeRunDocument({ protocol: "niceeval.run/v1", operation: "run.list", runs: [], omitted: 0 }).success,
    ).toBe(false);
    const legacyToken = Buffer.from(
      JSON.stringify(["niceeval.run-continuation/v1", "old-store", 0, ids[0], null]),
    ).toString("base64url");
    const refused = await Effect.runPromise(
      Effect.result(runHost.list({ cwd: paths.projectRoot, continuation: legacyToken })),
    );
    expect(Result.isFailure(refused)).toBe(true);
    if (Result.isFailure(refused)) {
      expect(refused.failure).toMatchObject({ code: "run-continuation-invalid" });
      expect(refused.failure.message).toContain("restart run.list without continuation");
    }
    for (const args of [
      ["--limit", "0"],
      ["--limit", "1.5"],
      ["--state", "sleeping"],
    ]) {
      const invalid = await niceeval.run(["run", "list", ...args, "--json"]);
      expect(invalid.exitCode, invalid.diagnostic()).not.toBe(0);
    }
  });
});
