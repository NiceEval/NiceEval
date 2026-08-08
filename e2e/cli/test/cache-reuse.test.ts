// owner: docs/engineering/testing/e2e/cli.md#cli-cache-reuse
// rerun: pnpm e2e --repo cli -- --run test/cache-reuse.test.ts

import { join, resolve } from "node:path";
import { command, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";

interface ExpEvent {
  event: string;
  reused?: number;
  status?: string;
  passed?: number;
  failed?: number;
  errored?: number;
  completion?: string;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);
const projectCopy = {
  from: process.cwd(),
  prefix: "niceeval-e2e-cli-cache-",
  omitTopLevel: [".niceeval", "junit", "node_modules", "test"],
  links: [{ from: resolve("node_modules"), to: "node_modules", type: "dir" }],
} as const;

function historyAttemptCount(stdout: string): number {
  return new Set(stdout.match(/@[a-zA-Z0-9._:-]+/g) ?? []).size;
}

test("默认运行复用基线，--rerun all 只追加真实的新 attempt", async () => {
  await withProjectCopy(projectCopy, async ({ root }) => {
    const baseline = await niceeval.run(["exp", "normal", "--rerun", "all", "--json"], { cwd: root });
    expect(baseline.exitCode, baseline.diagnostic()).toBe(0);
    const baselineEvents = baseline.ndjson<ExpEvent>();
    expect(baselineEvents.at(0)).toMatchObject({ event: "start", reused: 0 });
    expect(baselineEvents.at(-1)).toMatchObject({
      event: "result",
      status: "passed",
      passed: 2,
      failed: 0,
      errored: 0,
      completion: "complete",
    });

    const baselineGreetHistory = await niceeval.run(["show", "greet/hello", "--history"], { cwd: root });
    expect(baselineGreetHistory.exitCode, baselineGreetHistory.diagnostic()).toBe(0);
    const baselineGreetAttempts = historyAttemptCount(baselineGreetHistory.stdout);
    expect(baselineGreetAttempts).toBe(1);

    const baselineToolHistory = await niceeval.run(["show", "tool/weather", "--history"], { cwd: root });
    expect(baselineToolHistory.exitCode, baselineToolHistory.diagnostic()).toBe(0);
    const baselineToolAttempts = historyAttemptCount(baselineToolHistory.stdout);
    expect(baselineToolAttempts).toBe(1);

    const reused = await niceeval.run(["exp", "normal", "--json"], { cwd: root });
    expect(reused.exitCode, reused.diagnostic()).toBe(0);
    const reusedEvents = reused.ndjson<ExpEvent>();
    expect(reusedEvents.at(0)).toMatchObject({ event: "start", reused: 2 });
    expect(reusedEvents.at(-1)).toMatchObject({
      event: "result",
      status: "passed",
      passed: 2,
      failed: 0,
      errored: 0,
      reused: 2,
      completion: "complete",
    });

    const reusedGreetHistory = await niceeval.run(["show", "greet/hello", "--history"], { cwd: root });
    expect(reusedGreetHistory.exitCode, reusedGreetHistory.diagnostic()).toBe(0);
    expect(historyAttemptCount(reusedGreetHistory.stdout)).toBe(baselineGreetAttempts);

    const reusedToolHistory = await niceeval.run(["show", "tool/weather", "--history"], { cwd: root });
    expect(reusedToolHistory.exitCode, reusedToolHistory.diagnostic()).toBe(0);
    expect(historyAttemptCount(reusedToolHistory.stdout)).toBe(baselineToolAttempts);

    const rerun = await niceeval.run(["exp", "normal", "--rerun", "all", "--json"], { cwd: root });
    expect(rerun.exitCode, rerun.diagnostic()).toBe(0);
    const rerunEvents = rerun.ndjson<ExpEvent>();
    expect(rerunEvents.at(0)).toMatchObject({ event: "start", reused: 0 });
    expect(rerunEvents.at(-1)).toMatchObject({
      event: "result",
      status: "passed",
      passed: 2,
      failed: 0,
      errored: 0,
      completion: "complete",
    });

    const rerunGreetHistory = await niceeval.run(["show", "greet/hello", "--history"], { cwd: root });
    expect(rerunGreetHistory.exitCode, rerunGreetHistory.diagnostic()).toBe(0);
    expect(historyAttemptCount(rerunGreetHistory.stdout)).toBe(baselineGreetAttempts + 1);

    const rerunToolHistory = await niceeval.run(["show", "tool/weather", "--history"], { cwd: root });
    expect(rerunToolHistory.exitCode, rerunToolHistory.diagnostic()).toBe(0);
    expect(historyAttemptCount(rerunToolHistory.stdout)).toBe(baselineToolAttempts + 1);
  });
});
