import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @issue docs/issues/assertion-score-matrix.md
test.concurrent("作者跨实验比较判据，保留重复身份、缺项和每次 Attempt 的分值", async () => {
  await inspectionE2E.case("assertion-matrix", {}, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "assertion-matrix", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const discover = await niceeval.run(["query", "discover"]);
    expect(discover.queryDiscovery().operations.map((item) => item.id)).toContain("experiments.assertions");
    const args = ["show", "--experiment", "assertion-matrix/next", "--experiment", "assertion-matrix/base", "--experiment", "assertion-matrix/base", "--assertions"];
    const result = await niceeval.run([...args, "-o", "json"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    const { matrix } = result.querySuccess("experiments.assertions");
    expect(matrix).toMatchObject({ state: "complete", experimentIds: ["assertion-matrix/base", "assertion-matrix/next"], omitted: { evals: 0, rows: 0, columns: 0 } });
    const evaluation = only(matrix.evals, () => true, result.diagnostic());
    expect(evaluation.evalId).toBe("assertion-matrix");
    expect(evaluation.columns.map(({ experimentId, attemptOrdinal }) => [experimentId, attemptOrdinal])).toEqual([["assertion-matrix/base", 0], ["assertion-matrix/base", 1], ["assertion-matrix/next", 0]]);
    expect(evaluation.unkeyed).toEqual([1, 1, 1]);
    const changed = only(evaluation.rows, (row) => row.key === "changed");
    expect(changed.distinct).toBe(true);
    expect(changed.cells).toEqual([0, 0, 2].map((earned) => ({ state: "available", entries: [expect.objectContaining({ result: earned ? "matched" : "mismatched", contribution: { state: "earned", points: 2, earned } })] })));
    expect(only(evaluation.rows, (row) => row.key === "duplicate").cells).toEqual([0, 1, 2].map(() => ({ state: "available", entries: [expect.objectContaining({ contribution: { state: "earned", points: 1, earned: 1 } }), expect.objectContaining({ contribution: { state: "earned", points: 1, earned: 0 } })] })));
    expect(only(evaluation.rows, (row) => row.key === "only-baseline").cells[2]).toEqual({ state: "absent" });
    expect(only(evaluation.rows, (row) => row.label === "Label identity").distinct).toBe(false);
    const shown = await niceeval.run(args);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("* Changed criterion");
    expect(shown.stdout).toContain("2/2");
    for (const column of evaluation.columns) expect(shown.stdout).toContain(column.locator);
    const filtered = await niceeval.run([...args, "--eval", "other", "--json"]);
    expect(filtered.querySuccess("experiments.assertions").matrix.evals).toEqual([]);
    const missing = await niceeval.run([...args, "--experiment", "does-not-exist", "--json"]);
    expect(missing.exitCode).not.toBe(0);
    for (const flags of [["--run", "invalid", "--assertions"], ["--eval", "assertion-matrix"], [...args.slice(1), "--full"]]) {
      const invalid = await niceeval.run(["show", ...flags]);
      expect(invalid.exitCode, invalid.diagnostic()).not.toBe(0);
    }
  });
});
