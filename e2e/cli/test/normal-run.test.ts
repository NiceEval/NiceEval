// owner: docs/engineering/testing/e2e/cli.md#cli-normal-run
// rerun: pnpm e2e --repo cli -- --run test/normal-run.test.ts

import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-normal-",
  omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

test("正常 Experiment 以人读追加流和成功 JUnit 完成", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    mkdirSync(join(root, "junit"), { recursive: true });

    const receipt = await niceeval.run(
      ["exp", "normal", "--rerun", "all", "--junit", "junit/normal.xml"],
      { cwd: root },
    );

    expect(receipt.exitCode, receipt.diagnostic()).toBe(0);
    expect(receipt.stderr).toBe("");
    expect(receipt.stdout).not.toMatch(/[\x1b\x08]/);
    expect(receipt.stdout).toMatch(/PASSED/);
    const junit = readFileSync(join(root, "junit", "normal.xml"), "utf8");
    expect(junit).not.toContain("<failure");
    expect(junit).not.toContain("<error");
  });
});
