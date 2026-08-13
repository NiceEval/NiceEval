// owner: docs/engineering/testing/e2e/cli.md#cli-failure-error-results
// rerun: pnpm e2e --repo cli -- --run test/failure-error-results.test.ts

import { only, type ExpEvent } from "@niceeval/testkit";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cliE2E } from "./context.ts";

test("failed 与 errored 在 NDJSON、JUnit 和退出码上保持可区分", async () => {
  await cliE2E.case(
    "failure-error-results",
    {
      artifacts: [
        { source: ".niceeval", target: ".niceeval", optional: true },
        { source: "junit", target: "junit" },
      ],
    },
    async ({ commands: { niceeval }, paths }) => {
      const root = paths.projectRoot;
      mkdirSync(join(root, "junit"), { recursive: true });

      const failed = await niceeval.run(
        ["exp", "deliberate-fail", "--rerun", "all", "--json", "--junit", "junit/failed.xml"],
      );
      expect(failed.exitCode, failed.diagnostic()).toBe(1);
      expect(failed.stderr).toBe("");
      expect(failed.stdout).not.toMatch(/[\x1b\x08]/);
      const failedEvents = failed.ndjson<ExpEvent>();
      expect(failedEvents).toContainEqual(expect.objectContaining({
        event: "eval",
        evalId: "deliberate-fail/broken",
        verdict: "failed",
        attempts: 1,
        passed: 0,
      }));
      expect(failedEvents).not.toContainEqual(expect.objectContaining({
        event: "eval",
        verdict: "errored",
      }));
      only(
        failedEvents,
        (event) => "event" in event && event.event === "eval" && event.evalId === "deliberate-fail/broken",
        failed.diagnostic(),
      );
      expect(failed.expReceipt()).toMatchObject({ completion: "completed" });
      const failedJunit = readFileSync(join(root, "junit", "failed.xml"), "utf8");
      expect(failedJunit).toContain("<failure");
      expect(failedJunit).not.toContain("<error");

      const errored = await niceeval.run(
        ["exp", "deliberate-error", "--rerun", "all", "--json", "--junit", "junit/errored.xml"],
      );
      expect(errored.exitCode, errored.diagnostic()).toBe(1);
      expect(errored.stderr).toBe("");
      expect(errored.stdout).not.toMatch(/[\x1b\x08]/);
      const erroredEvents = errored.ndjson<ExpEvent>();
      expect(erroredEvents).toContainEqual(expect.objectContaining({
        event: "eval",
        evalId: "deliberate-error/crash",
        verdict: "errored",
        attempts: 1,
        passed: 0,
      }));
      expect(erroredEvents).not.toContainEqual(expect.objectContaining({
        event: "eval",
        verdict: "failed",
      }));
      only(
        erroredEvents,
        (event) => "event" in event && event.event === "eval" && event.evalId === "deliberate-error/crash",
        errored.diagnostic(),
      );
      expect(errored.expReceipt()).toMatchObject({ completion: "completed" });
      const erroredJunit = readFileSync(join(root, "junit", "errored.xml"), "utf8");
      expect(erroredJunit).toContain("<error");
      expect(erroredJunit).not.toContain("<failure");
    },
  );
});
