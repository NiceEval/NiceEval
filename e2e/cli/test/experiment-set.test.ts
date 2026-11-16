import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeExpPlanDocument } from "niceeval/experiment/host";
import { cliE2E } from "./context.ts";

// @feature docs/feature/experiments/cli/README.md
// @regression memory/experiment-exact-set-missing.md
test.concurrent("精确选择离散实验并在同一次 Invocation 共享全局并发", async () => {
  await cliE2E.case("experiment-set", async ({ commands: { niceeval }, paths }) => {
    await mkdir(join(paths.projectRoot, "experiments/harness/deep"), { recursive: true });
    await mkdir(join(paths.projectRoot, "experiments/install"), { recursive: true });
    await writeFile(join(paths.projectRoot, "experiments/harness/one.ts"), 'export { default } from "../normal.ts";\n');
    await writeFile(
      join(paths.projectRoot, "experiments/harness/deep/two.ts"),
      'export { default } from "../../normal.ts";\n',
    );
    await writeFile(
      join(paths.projectRoot, "experiments/install/three.ts"),
      'export { default } from "../normal.ts";\n',
    );
    await writeFile(
      join(paths.projectRoot, "experiments/broken.ts"),
      'throw new Error("unselected file evaluated");\n',
    );
    const directory = await niceeval.run([
      "exp",
      "--experiment",
      "harness/",
      "--experiment",
      "install/",
      "--experiment",
      "harness/one",
      "greet",
      "--dry",
      "--json",
    ]);
    expect(directory.exitCode, directory.diagnostic()).toBe(0);
    expect(
      decodeExpPlanDocument(directory.json())
        .matrix.map(({ experimentId, evalId }) => [experimentId, evalId])
        .sort(),
    ).toEqual([
      ["harness/deep/two", "greet/hello"],
      ["harness/one", "greet/hello"],
      ["install/three", "greet/hello"],
    ]);
    const result = await niceeval.run([
      "exp",
      "--experiment",
      "normal",
      "--experiment",
      "deliberate-fail",
      "--experiment",
      "normal",
      "--max-concurrency",
      "1",
      "--rerun",
      "all",
      "--json",
    ]);
    expect(result.exitCode, result.diagnostic()).toBe(1);
    for (const event of result.expEvents()) {
      expect(event).not.toHaveProperty("protocol");
      expect(event).not.toHaveProperty("format");
      expect(event).not.toHaveProperty("schemaVersion");
    }
    expect(result.expReceipt().createdRunIds).toHaveLength(2);
    expect(only(result.expEvents(), (event) => event.event === "start")).toMatchObject({ configs: 2, concurrency: 1 });
    expect([...new Set(result.expEvalEvents().map((event) => event.experimentId))].sort()).toEqual([
      "deliberate-fail",
      "normal",
    ]);
    expect(result.expEvalEvents()).toHaveLength(3);
    expect(
      result
        .expEvalEvents()
        .filter((event) => event.experimentId === "normal")
        .map((event) => event.verdict),
    ).toEqual(["passed", "passed"]);

    const unknown = await niceeval.run(["exp", "--experiment", "normal", "--experiment", "norm", "--dry", "--json"]);
    expect(unknown.exitCode, unknown.diagnostic()).not.toBe(0);
    expect(unknown.stderr).toContain("norm");
    expect(unknown.stdout).toBe("");
    for (const value of ["harness/", "harness/one", "harness/deep/two", "install/", "install/three", "normal"]) {
      expect(unknown.stderr).toContain(value);
    }
    const missingDirectory = await niceeval.run([
      "exp",
      "--experiment",
      "harness/",
      "--experiment",
      "missing/",
      "--dry",
      "--json",
    ]);
    expect(missingDirectory.exitCode, missingDirectory.diagnostic()).not.toBe(0);
    expect(missingDirectory.stderr).toContain("No experiment matched: missing/");
    expect(missingDirectory.stdout).toBe("");
  });
});
