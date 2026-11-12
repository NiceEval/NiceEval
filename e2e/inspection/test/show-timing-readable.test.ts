import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { inspectionE2E } from "./support.ts";

// @feature docs/feature/inspection/README.md
// @issue docs/issues/show-timing-identifiers-truncated.md
test.concurrent("管道时间线保留完整标识并单列失败活动", async () => {
  await inspectionE2E.case("show-timing-readable", async ({ commands: { niceeval } }) => {
    const run = await niceeval.run(["exp", "timing-failure", "--rerun", "all", "--json"]);
    expect(run.exitCode, run.diagnostic()).toBe(1);
    const event = only(run.expEvalEvents(), (item) => item.evalId === "inspection", run.diagnostic());
    const read = await niceeval.run(["query", "run", "--request-json", JSON.stringify({ protocol: "niceeval.query/v3", operation: { kind: "attempt.timing", locator: event.locator } })]);
    expect(read.exitCode, read.diagnostic()).toBe(0);
    expect(read.querySuccess("attempt.timing").timing.activities).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: "failed" })]));
    const shown = await niceeval.run(["show", event.locator, "--timing"]);
    expect(shown.exitCode, shown.diagnostic()).toBe(0);
    expect(shown.stdout, shown.diagnostic()).not.toContain("…");
    expect(shown.stdout).toContain("Failed activities");
    expect(shown.stdout.slice(shown.stdout.indexOf("Failed activities"))).toMatch(/Phase\s+sandbox\./u);
    expect(shown.stdout).toContain("sandbox.prepare");
  });
});
