// owner: docs/engineering/testing/e2e/cli.md#cli-no-eval-feedback
// rerun: pnpm e2e --repo cli -- --run test/no-eval-feedback.test.ts

import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test("Experiment 命中但 Eval 前缀零命中时以用法错误给出下一步", async () => {
  await cliE2E.case("no-eval-feedback", async ({ commands: { niceeval } }) => {
    const receipt = await niceeval.run(["exp", "normal", "totally-bogus-eval-prefix-zzz", "--dry"]);

    expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
    expect(receipt.stdout).toBe("");
    expect(receipt.stderr).toMatch(/No eval matched prefix/);
    expect(receipt.stderr).toMatch(/niceeval exp/);
  });
});
