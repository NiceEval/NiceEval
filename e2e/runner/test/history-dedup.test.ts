// owner: docs/engineering/testing/e2e/runner.md#runner-history-dedup
// rerun: pnpm e2e --repo runner -- --run test/history-dedup.test.ts
import { join, resolve } from "node:path";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ExpEvent {
  event: string;
  total?: number;
  reused?: number;
  locator?: string;
  evalId?: string;
  verdict?: string;
  attempts?: number;
  passed?: number;
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
    const firstEval = only(first.ndjson<ExpEvent>(), (event) => event.event === "eval", first.diagnostic());
    expect(firstEval).toMatchObject({
      event: "eval",
      evalId: "suite/stable",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    const firstLocator = firstEval.locator!;
    expect(firstLocator).toMatch(/^@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

    const forced = await niceeval.run(["exp", "history", "--rerun", "all", "--json"], { cwd: root });
    expect(forced.exitCode, forced.diagnostic()).toBe(0);
    const forcedEval = only(forced.ndjson<ExpEvent>(), (event) => event.event === "eval", forced.diagnostic());
    expect(forcedEval).toMatchObject({
      event: "eval",
      evalId: "suite/stable",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    const forcedLocator = forcedEval.locator!;
    expect(forcedLocator).not.toBe(firstLocator);

    const carried = await niceeval.run(["exp", "history", "--json"], { cwd: root });
    expect(carried.exitCode, carried.diagnostic()).toBe(0);
    const carriedEvents = carried.ndjson<ExpEvent>();
    const carriedStart = only(carriedEvents, (event) => event.event === "start", carried.diagnostic());
    expect(carriedStart).toMatchObject({ event: "start", total: 1, reused: 1 });
    const carriedEval = only(carriedEvents, (event) => event.event === "eval", carried.diagnostic());
    expect(carriedEval).toMatchObject({
      event: "eval",
      evalId: "suite/stable",
      verdict: "passed",
      attempts: 1,
      passed: 1,
    });
    expect(carried.expReceipt()).toMatchObject({ completion: "completed" });

    const afterCarry = await niceeval.run(["show", "suite/stable", "--history"], { cwd: root });
    expect(afterCarry.exitCode, afterCarry.diagnostic()).toBe(0);
    expect(locators(afterCarry.stdout)).toEqual([firstLocator, forcedLocator].sort());
  });
});
