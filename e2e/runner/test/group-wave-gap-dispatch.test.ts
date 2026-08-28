// owner: docs/engineering/testing/e2e/runner.md#runner-group-wave-gap-dispatch
// rerun: pnpm e2e test --repo runner -- --run test/group-wave-gap-dispatch.test.ts
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

test("空闲 Group lane 不等待慢 lane 的下一槽位即可继续派发", async () => {
  await runnerE2E.case("group-wave-gap-dispatch", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "group-wave-gap", "--json"], { timeoutMs: 120_000 });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    const evals = result.expEvents()
      .filter((event) => event.event === "eval");
    expect(evals).toHaveLength(9);
    expect(evals.map((event) => event.verdict)).toEqual(Array(9).fill("passed"));
  });
});
