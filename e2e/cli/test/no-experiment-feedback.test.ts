// owner: docs/engineering/testing/e2e/cli.md#cli-no-experiment-feedback
// rerun: pnpm e2e test --repo cli -- --run test/no-experiment-feedback.test.ts

import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test("未命中 Experiment 时以用法错误给出下一步", async () => {
  await cliE2E.case("no-experiment-feedback", async ({ commands: { niceeval } }) => {
    const receipt = await niceeval.run(["exp", "totally-bogus-selector-zzz", "--dry"]);

    expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
    expect(receipt.stdout).toBe("");
    expect(receipt.stderr).toMatch(/No experiment matched/);
    expect(receipt.stderr).toMatch(/Run `niceeval exp/);
  });
});
