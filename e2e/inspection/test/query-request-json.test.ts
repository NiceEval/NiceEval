import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
test.concurrent("machine caller addresses Runs and explains the same read without a request document", async () => {
  await inspectionE2E.case("inspection-address", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["show", "runs", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(result.inspectionSuccess("run.list").operation).toBe("run.list");
    const explanation = await niceeval.run(["show", "runs", "--explain", "--json"]);
    expect(explanation.exitCode, explanation.diagnostic()).toBe(0);
    expect(explanation.inspectionExplanation("run.list").outcome).toBe("explanation");
    const removed = await niceeval.run(["query", "discover"]);
    expect(removed.exitCode, removed.diagnostic()).not.toBe(0);
  });
});
