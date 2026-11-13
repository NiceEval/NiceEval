import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
test.concurrent("并发 Attempt 共享一次 staged 准备，上传不各自持有整份 payload 字节", async () => {
  await runnerE2E.case("staged-payload", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "staged-payload", "--rerun", "all", "--json"], { timeoutMs: 180_000 });
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(only(result.expEvalEvents(), () => true)).toMatchObject({ evalId: "staged-payload", verdict: "passed", attempts: 4, passed: 4 });
    expect(result.expReceipt().completion).toBe("completed");
  });
});
