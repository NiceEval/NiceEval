// owner: docs/engineering/testing/e2e/cli.md#cli-no-eval-feedback
// rerun: pnpm e2e --repo cli -- --run test/no-eval-feedback.test.ts

import { join, resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-no-eval-",
  omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("Experiment 命中但 Eval 前缀零命中时以用法错误给出下一步", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const receipt = await niceeval.run(
      ["exp", "normal", "totally-bogus-eval-prefix-zzz", "--dry"],
      { cwd: root },
    );

    expect(receipt.exitCode, receipt.diagnostic()).not.toBe(0);
    expect(receipt.stdout).toBe("");
    expect(receipt.stderr).toMatch(/No eval matched prefix/);
    expect(receipt.stderr).toMatch(/niceeval exp/);
  });
});
