// feature: docs/engineering/testing/e2e/README.md
import { join, resolve } from "node:path";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ResultEvent {
  event: string;
  reused?: number;
  passed?: number;
  failed?: number;
  completion?: string;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-runner-history-",
  omitTopLevel: [".niceeval", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

function locators(stdout: string): string[] {
  return [...new Set(stdout.match(/@[a-zA-Z0-9._:-]+/g) ?? [])].sort();
}

test("强制重跑追加 identity，carry run 不在 history 复制旧 attempt", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const first = await niceeval.run(["exp", "history", "--rerun", "all", "--json"], { cwd: root });
    expect(first.exitCode, first.diagnostic()).toBe(0);

    const baseline = await niceeval.run(["show", "suite/stable", "--history"], { cwd: root });
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    const firstLocators = locators(baseline.stdout);
    expect(firstLocators).toHaveLength(1);
    expect(baseline.stdout).toMatch(/passed/i);

    const forced = await niceeval.run(["exp", "history", "--rerun", "all", "--json"], { cwd: root });
    expect(forced.exitCode, forced.diagnostic()).toBe(0);
    const afterForce = await niceeval.run(["show", "suite/stable", "--history"], { cwd: root });
    expect(afterForce.exitCode, afterForce.diagnostic()).toBe(0);
    const forcedLocators = locators(afterForce.stdout);
    expect(forcedLocators).toHaveLength(2);
    expect(forcedLocators).toContain(firstLocators[0]);

    const carried = await niceeval.run(["exp", "history", "--json"], { cwd: root });
    expect(carried.exitCode, carried.diagnostic()).toBe(0);
    const result = only(
      carried.ndjson<ResultEvent>(),
      (event) => event.event === "result",
      carried.diagnostic(),
    );
    expect(result).toMatchObject({
      event: "result",
      reused: 1,
      passed: 1,
      failed: 0,
      completion: "complete",
    });

    const afterCarry = await niceeval.run(["show", "suite/stable", "--history"], { cwd: root });
    expect(afterCarry.exitCode, afterCarry.diagnostic()).toBe(0);
    expect(locators(afterCarry.stdout)).toEqual(forcedLocators);
  });
});
