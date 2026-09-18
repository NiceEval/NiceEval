// rerun: pnpm e2e test --repo eval -- --run test/custom-application-lifecycle.test.ts

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { customLifecycleJournal } from "../fixtures/custom-applications.ts";
import { evalE2E } from "./context.ts";
import { inspectAttempt } from "./inspection.ts";

type JournalEntry = Readonly<{
  scenario: string;
  event: string;
  attempt: number;
}>;

async function journalEntries(projectRoot: string): Promise<readonly JournalEntry[]> {
  const text = await readFile(join(projectRoot, customLifecycleJournal), "utf8");
  return text.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as JournalEntry);
}

// @use-case docs/feature/eval/use-case/eval-native-operations.md

test.concurrent("Adapter 创建部分失败与 Attempt 取消均清理资源且拒绝迟到 Assertion", async () => {
  await evalE2E.case(
    "custom-application-lifecycle",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const createFailure = await niceeval.run([
        "exp", "custom-create-failure", "--rerun", "all", "--json",
      ]);
      expect(createFailure.exitCode, createFailure.diagnostic()).toBe(1);
      expect(createFailure.expReceipt(), createFailure.diagnostic()).toMatchObject({ completion: "completed" });
      const failedCreate = only(
        createFailure.expEvalEvents(),
        (event) => event.experimentId === "custom-create-failure" &&
          event.evalId === "custom-create-failure",
        createFailure.diagnostic(),
      );
      expect(failedCreate).toMatchObject({
        verdict: "errored",
        attempts: 1,
        passed: 0,
        locator: expect.any(String),
      });
      const afterCreateFailure = await journalEntries(projectRoot);
      expect(afterCreateFailure.filter(({ scenario }) => scenario === "create-failure")).toEqual([
        { scenario: "create-failure", event: "acquired", attempt: 0 },
        { scenario: "create-failure", event: "cleanup-inner", attempt: 0 },
        { scenario: "create-failure", event: "cleanup-outer", attempt: 0 },
      ]);

      const cancelled = await niceeval.run([
        "exp", "custom-timeout-cancel", "--rerun", "all", "--json",
      ]);
      expect(cancelled.exitCode, cancelled.diagnostic()).toBe(1);
      expect(cancelled.expReceipt(), cancelled.diagnostic()).toMatchObject({ completion: "completed" });
      const cancelledEvaluation = only(
        cancelled.expEvalEvents(),
        (event) => event.experimentId === "custom-timeout-cancel" &&
          event.evalId === "custom-timeout-cancel",
        cancelled.diagnostic(),
      );
      expect(cancelledEvaluation).toMatchObject({
        verdict: "errored",
        attempts: 1,
        passed: 0,
        locator: expect.any(String),
      });
      const locator = cancelledEvaluation.locator;
      if (locator === undefined) throw new Error("cancelled custom Attempt was not published");
      const attempt = await inspectAttempt(niceeval, projectRoot, locator, "attempt.get");
      expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
      expect(attempt.document.attempt).toMatchObject({
        core: { outcome: "errored" },
        assertions: { state: "available" },
      });
      expect(attempt.document.attempt.assertions.entries.map(({ display }) => display.label)).toEqual([
        "取消前登记的 Assertion",
      ]);

      const afterCancellation = await journalEntries(projectRoot);
      expect(afterCancellation.filter(({ scenario }) => scenario === "timeout")).toEqual([
        { scenario: "timeout", event: "acquired", attempt: 0 },
        { scenario: "timeout", event: "abort-check-rejected", attempt: 0 },
        { scenario: "timeout", event: "abort-handle-rejected", attempt: 0 },
        { scenario: "timeout", event: "abort-method-rejected", attempt: 0 },
        { scenario: "timeout", event: "cleanup-inner", attempt: 0 },
        { scenario: "timeout", event: "cleanup-outer", attempt: 0 },
        { scenario: "timeout", event: "late-assertion-rejected", attempt: 0 },
        { scenario: "timeout", event: "closed-registration-rejected", attempt: 0 },
      ]);

      const succeeded = await niceeval.run([
        "exp", "custom-success-cleanup", "--rerun", "all", "--json",
      ]);
      expect(succeeded.exitCode, succeeded.diagnostic()).toBe(0);
      const successfulEvaluation = only(succeeded.expEvalEvents(), (event) => event.evalId === "custom-success-cleanup", succeeded.diagnostic());
      expect(successfulEvaluation).toMatchObject({ verdict: "passed", attempts: 1, passed: 1 });
      expect((await journalEntries(projectRoot)).filter(({ scenario }) => scenario === "success")).toEqual([
        { scenario: "success", event: "cleanup-finished", attempt: 0 },
      ]);
      if (successfulEvaluation.locator === undefined) throw new Error("successful Adapter did not expose its locator");
      const successfulTrace = await inspectAttempt(niceeval, projectRoot, successfulEvaluation.locator, "attempt.trace");
      expect(successfulTrace.receipt.exitCode, successfulTrace.receipt.diagnostic()).toBe(0);
      expect(successfulTrace.document.trace.diagnostics.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "adapter-cleanup-failed" }),
      ]));
    },
  );
});
