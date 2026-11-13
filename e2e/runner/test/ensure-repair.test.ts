import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { runnerE2E } from "./context.ts";

// @feature docs/feature/adapters/README.md
// @issue docs/issues/codex-ensure-reuploads-when-only-link-missing.md
test.concurrent("ensure 就地修复后复检，成功时不准备或上传 staged payload", async () => {
  await runnerE2E.case("ensure-repair", {}, async ({ commands: { niceeval } }) => {
    const result = await niceeval.run(["exp", "ensure-repair", "--rerun", "all", "--json"]);
    expect(result.exitCode, result.diagnostic()).toBe(0);
    expect(only(result.expEvalEvents(), () => true)).toMatchObject({ evalId: "ensure-repair", verdict: "passed" });
    expect(result.expReceipt().completion).toBe("completed");
  });
});
