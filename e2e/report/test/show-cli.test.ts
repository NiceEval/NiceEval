// owner: docs/engineering/testing/e2e/report.md#show-terminal-review
// rerun: pnpm e2e test --repo report -- --run test/show-cli.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { reportCaseArtifacts, reportE2E } from "./support.ts";

function expectHumanText(stdout: string): void {
  expect(stdout.trim()).not.toBe("");
  expect(() => JSON.parse(stdout)).toThrow();
}

function expectInOrder(stdout: string, values: readonly string[]): void {
  let cursor = 0;
  for (const value of values) {
    const position = stdout.indexOf(value, cursor);
    expect(
      position,
      `expected ${JSON.stringify(value)} after byte ${cursor} in:\n${stdout}`,
    ).toBeGreaterThanOrEqual(cursor);
    cursor = position + value.length;
  }
}

test("用户从 Experiment 收据进入终端总览，并沿稳定 Attempt locator 查看源码与执行事实", async () => {
  await reportE2E.case(
    "show-terminal-review",
    { artifacts: reportCaseArtifacts() },
    async ({ commands: { niceeval } }) => {
      const produced = await niceeval.run(["exp", "main", "--rerun", "all", "--json"]);
      expect(produced.exitCode, produced.diagnostic()).toBe(0);
      expect(produced.expReceipt(), produced.diagnostic()).toMatchObject({ completion: "completed" });
      const runId = only(produced.expReceipt().runIds, () => true, produced.diagnostic());
      const attempt = only(
        produced.expEvalEvents(),
        (event) => event.evalId === "inspection",
        produced.diagnostic(),
      );
      expect(attempt).toMatchObject({ verdict: "passed" });
      const locator = attempt.locator.startsWith("@") ? attempt.locator : `@${attempt.locator}`;

      const overview = await niceeval.run(["show"]);
      expect(overview.exitCode, overview.diagnostic()).toBe(0);
      expectHumanText(overview.stdout);
      expect(overview.stdout).toMatch(/totals?/iu);
      expectInOrder(overview.stdout, ["main", "inspection", locator]);

      const run = await niceeval.run(["show", "--run", runId]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expectHumanText(run.stdout);
      expect(run.stdout).toContain(runId);
      expectInOrder(run.stdout, ["main", "inspection", locator]);

      const attemptOverview = await niceeval.run(["show", locator]);
      expect(attemptOverview.exitCode, attemptOverview.diagnostic()).toBe(0);
      expectHumanText(attemptOverview.stdout);
      expect(attemptOverview.stdout).toContain(locator);
      expect(attemptOverview.stdout).toContain(`niceeval show ${locator} --source`);
      expect(attemptOverview.stdout).toContain(`niceeval show ${locator} --execution`);

      const source = await niceeval.run(["show", locator, "--source"]);
      expect(source.exitCode, source.diagnostic()).toBe(0);
      expectHumanText(source.stdout);
      expect(source.stdout).toContain("Captured source");
      expect(source.stdout).toContain("inspection.eval.ts");
      expect(source.stdout).toContain("Inspection tool occurrence");
      const sourceIdentity = source.stdout.match(/inspection\.eval\.ts · (\S+) · \d+ bytes/u)?.[1];
      expect(sourceIdentity, source.diagnostic()).toBeDefined();
      if (sourceIdentity === undefined) throw new Error("expected captured source identity");
      expect(source.stdout.split(sourceIdentity).length - 1).toBeGreaterThan(1);

      const execution = await niceeval.run(["show", locator, "--execution"]);
      expect(execution.exitCode, execution.diagnostic()).toBe(0);
      expectHumanText(execution.stdout);
      expect(execution.stdout).toContain(locator);
      expect(execution.stdout).toContain("Conversation · partial");
      expect(execution.stdout).toContain("Stable identities");
      const toolIdentity = execution.stdout.match(/tool occurrence  (\S+)/u)?.[1];
      expect(toolIdentity, execution.diagnostic()).toBeDefined();
      if (toolIdentity === undefined) throw new Error("expected stable tool occurrence identity");
      expect(execution.stdout.split(toolIdentity).length - 1).toBeGreaterThan(1);
    },
  );
});
