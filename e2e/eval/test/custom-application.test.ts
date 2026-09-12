// rerun: pnpm e2e test --repo eval -- --run test/custom-application.test.ts

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import {
  assertionEntry,
  inspectAssertion,
  inspectAttempt,
  inspectRunSummary,
} from "./inspection.ts";

test.concurrent("同一应用契约的不同实现执行原生动作并公开缺失会话与费用 [necase_8QDV951NVHXK0G1W]", async () => {
  await evalE2E.case(
    "custom-application",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      for (const [experimentId, implementation] of [
        ["custom-native-alpha", "alpha"],
        ["custom-native-beta", "beta"],
      ] as const) {
        const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(run.exitCode, run.diagnostic()).toBe(0);
        const receipt = run.expReceipt();
        expect(receipt, run.diagnostic()).toMatchObject({ completion: "completed" });
        const evaluation = only(
          run.expEvalEvents(),
          (event) => event.experimentId === experimentId && event.evalId === "custom-native-actions",
          run.diagnostic(),
        );
        expect(evaluation).toMatchObject({
          verdict: "passed",
          attempts: 2,
          passed: 2,
          locator: expect.any(String),
        });

        const runId = only(receipt.createdRunIds, () => true, run.diagnostic());
        const runRequest = join(projectRoot, `custom-run-${implementation}.request.json`);
        await writeFile(runRequest, `${JSON.stringify({
          protocol: "niceeval.query/v1",
          operation: { kind: "run.get", runId },
        })}\n`, "utf8");
        const inspectedRun = await niceeval.run(["query", "run", "--request", runRequest]);
        expect(inspectedRun.exitCode, inspectedRun.diagnostic()).toBe(0);
        const runDocument = inspectedRun.querySuccess("run.get");
        const execution = runDocument.run.value.context?.execution;
        expect(execution).toMatchObject({
          application: {
            kind: "application",
            name: `custom-${implementation}`,
            contract: "e2e/native-workflow/v1",
            behaviorRevision: "1",
          },
        });
        expect(execution === undefined ? true : Object.hasOwn(execution, "agentId")).toBe(false);

        const summary = await inspectRunSummary(niceeval, projectRoot, runId);
        expect(summary.receipt.exitCode, summary.receipt.diagnostic()).toBe(0);
        expect(summary.document.summary.members).toHaveLength(2);
        for (const member of summary.document.summary.members) {
          expect(member).toMatchObject({
            runId,
            evalId: "custom-native-actions",
            state: "executed",
            outcome: "completed",
          });
          const locator = member.locator;
          expect(locator, inspectedRun.diagnostic()).toEqual(expect.any(String));
          if (locator === undefined) throw new Error("custom Attempt did not expose its public locator");

          const attempt = await inspectAttempt(niceeval, projectRoot, locator, "attempt.get");
          expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
          expect(attempt.document.attempt.assertions.state).toBe("available");
          const labels = attempt.document.attempt.assertions.entries.map(({ display }) => display.label);
          expect(labels).toEqual([
            "选中的实现创建实例",
            "应用方法保留原生返回值",
            "多个原生动作共享本 Attempt 状态",
            "每个 Attempt 从独立实例完成",
            "解构方法绑定应用且根字段实时读取",
          ]);
          const firstAssertion = attempt.document.attempt.assertions.entries[0];
          if (firstAssertion === undefined) throw new Error("custom Attempt did not publish Assertions");
          const detail = await inspectAssertion(
            niceeval,
            projectRoot,
            locator,
            firstAssertion.entryId,
          );
          expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
          expect(assertionEntry(detail.document, detail.receipt.diagnostic())).toMatchObject({
            decision: { result: "matched", gate: "satisfied" },
          });

          const trace = await inspectAttempt(niceeval, projectRoot, locator, "attempt.trace");
          expect(trace.receipt.exitCode, trace.receipt.diagnostic()).toBe(0);
          expect(trace.document.trace.conversation).toMatchObject({
            state: "not-recorded",
            turns: [],
            items: [],
          });

          const usageRequest = join(projectRoot, `custom-usage-${locator.slice(1)}.request.json`);
          await writeFile(usageRequest, `${JSON.stringify({
            protocol: "niceeval.query/v1",
            operation: { kind: "attempt.usage", locator },
          })}\n`, "utf8");
          const usageReceipt = await niceeval.run(["query", "run", "--request", usageRequest]);
          expect(usageReceipt.exitCode, usageReceipt.diagnostic()).toBe(0);
          const usage = usageReceipt.attemptUsage().usage;
          expect(usage.totals).toEqual({
            inputTokens: { state: "unavailable", value: null, observationCount: 0 },
            outputTokens: { state: "unavailable", value: null, observationCount: 0 },
            requests: { state: "unavailable", value: null, observationCount: 0 },
            providerCosts: { state: "unavailable", values: [], observationCount: 0 },
          });
        }
      }
    },
  );
});
