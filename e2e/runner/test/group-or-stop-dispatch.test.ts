// owner: docs/engineering/testing/e2e/runner.md#runner-group-or-stop-dispatch
// rerun: pnpm e2e --repo runner -- --run test/group-or-stop-dispatch.test.ts
// regression: memory/group-or-stop-dispatch-starvation.md
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

test("orStop 只结束当前 Eval，三个 Group lane 仍可并行派发", async () => {
  await runnerE2E.case("group-or-stop-dispatch", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "group-stop", "--json"], { timeoutMs: 120_000 });
    expect(result.exitCode, result.diagnostic()).toBe(1);
    const evals = result.ndjson<{ event: string; evalId?: string; verdict?: string }>()
      .filter((event) => event.event === "eval");
    expect(evals).toEqual(expect.arrayContaining([
      expect.objectContaining({ evalId: "group-stop-alpha/next", verdict: "passed" }),
      expect.objectContaining({ evalId: "group-stop-beta/next", verdict: "passed" }),
      expect.objectContaining({ evalId: "group-stop-gamma/hold", verdict: "passed" }),
    ]));
  });
});
