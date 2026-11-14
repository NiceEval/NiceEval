import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @issue docs/issues/assertion-score-matrix.md
test.concurrent("作者跨实验比较判据，保留重复身份、缺项和每次 Attempt 的分值", async () => {
  await inspectionE2E.case("assertion-matrix", {}, async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "assertion-matrix", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const args = ["show", `exp:${"assertion-matrix/next"}`, `exp:${"assertion-matrix/base"}`, `exp:${"assertion-matrix/base"}`, "assertions"];
    const result = await niceeval.run([...args, "-o", "json"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    const { matrix } = result.inspectionSuccess("experiments.assertions");
    expect(matrix).toMatchObject({ state: "complete", experimentIds: ["assertion-matrix/base", "assertion-matrix/next"], omitted: { evals: 0, rows: 0, columns: 0 } });
    const evaluation = only(matrix.evals, () => true, result.diagnostic());
    expect(evaluation.evalId).toBe("assertion-matrix");
    expect(evaluation.columns.map(({ experimentId, attemptOrdinal }) => [experimentId, attemptOrdinal])).toEqual([["assertion-matrix/base", 0], ["assertion-matrix/base", 1], ["assertion-matrix/next", 0]]);
    expect(evaluation.unlabeled).toEqual([1, 1, 1]);
    expect(evaluation.rows.every((row) => !("key" in row))).toBe(true);
    expect(evaluation.rows.filter((row) => row.label === "Label identity")).toHaveLength(2);
    const changed = only(evaluation.rows, (row) => row.label === "Changed criterion");
    expect(changed.distinct).toBe(true);
    expect(changed.cells).toEqual([0, 0, 2].map((earned) => ({ state: "available", entries: [expect.objectContaining({ result: earned ? "matched" : "mismatched", contribution: { state: "earned", points: 2, earned } })] })));
    expect(only(evaluation.rows, (row) => row.label === "Duplicate criterion").cells).toEqual([0, 1, 2].map(() => ({ state: "available", entries: [expect.objectContaining({ contribution: { state: "earned", points: 1, earned: 1 } }), expect.objectContaining({ contribution: { state: "earned", points: 1, earned: 0 } })] })));
    expect(only(evaluation.rows, (row) => row.label === "Only baseline").cells[2]).toEqual({ state: "absent" });
    expect(only(evaluation.rows, (row) => row.label === "Label identity" && row.groupPath.length === 0).distinct).toBe(false);
    const shown = await niceeval.run(args);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout).toContain("* Changed criterion");
    expect(shown.stdout).toContain("2/2");
    for (const column of evaluation.columns) expect(shown.stdout).toContain(column.locator);
    const filtered = await niceeval.run([...args, "--eval", "other", "--json"]);
    expect(filtered.inspectionSuccess("experiments.assertions").matrix.evals).toEqual([]);
    const missing = await niceeval.run([...args, "--experiment", "does-not-exist", "--json"]);
    expect(missing.exitCode).not.toBe(0);
    for (const flags of [["--run", "invalid", "--assertions"], ["--eval", "assertion-matrix"], [...args.slice(1), "--full"]]) {
      const invalid = await niceeval.run(["show", ...flags]);
      expect(invalid.exitCode, invalid.diagnostic()).not.toBe(0);
    }
  });
});

// @feature docs/feature/inspection/README.md
test.concurrent("大型判据矩阵保留可读的部分结果并报告省略数量", async () => {
  await inspectionE2E.case("assertion-matrix-bounds", {}, async ({ commands: { niceeval }, paths }) => {
    const file = join(paths.projectRoot, "evals", "assertion-matrix.eval.ts");
    await writeFile(file, (await readFile(file, "utf8")).replace("test(t) {", 'test(t) { for (let index = 0; index < 550; index++) t.check(true, equals(true)).label(`${t.flags.variant ?? "base"}-bulk-${index}`);'));
    const run = await niceeval.run(["exp", "assertion-matrix", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(0);
    const shown = await niceeval.run(["show", `exp:${"assertion-matrix/base"}`, `exp:${"assertion-matrix/next"}`, "--json", "assertions"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    const { matrix } = shown.inspectionSuccess("experiments.assertions");
    expect(matrix.state).toBe("partial");
    expect(matrix.omitted.rows).toBeGreaterThan(0);
    expect(matrix.evals.flatMap((evaluation) => evaluation.rows).length).toBeLessThanOrEqual(1000);
    expect(new TextEncoder().encode(JSON.stringify(matrix.evals)).length).toBeLessThanOrEqual(450000);
    expect(matrix.evals[0]!.rows.length).toBeGreaterThan(0);
  });
});
