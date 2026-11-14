import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

// @feature docs/feature/experiments/README.md
// @regression memory/experiment-exact-set-missing.md
test.concurrent("精确选择离散实验并在同一次 Invocation 共享全局并发", async () => {
  await cliE2E.case("experiment-set", async ({ commands: { niceeval } }) => {
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
  });
});
