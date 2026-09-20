// rerun: pnpm e2e test --repo eval -- --run test/custom-application.test.ts

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { customIdentityJournal } from "../fixtures/custom-applications.ts";
import { evalE2E } from "./context.ts";
import {
  assertionEntry,
  inspectAssertion,
  inspectAssertionEntries,
  inspectAttempt,
  inspectRunSummary,
} from "./inspection.ts";

// @use-case docs/feature/eval/use-case/eval-compare-implementations.md

test.concurrent("同一 Adapter 契约的不同实现执行原生动作并公开缺失会话与费用", async () => {
  await evalE2E.case(
    "custom-application",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      for (const [experimentId, implementation, evalId] of [
        ["custom-native-alpha", "alpha", "custom-native-actions"],
        ["custom-native-beta", "beta", "custom-native-actions"],
        ["custom-native-alpha-score", "alpha", "custom-native-score"],
        ["custom-native-beta-score", "beta", "custom-native-score"],
      ] as const) {
        const run = await niceeval.run(["exp", experimentId, "--rerun", "all", "--json"]);
        expect(run.exitCode, run.diagnostic()).toBe(0);
        const receipt = run.expReceipt();
        expect(receipt, run.diagnostic()).toMatchObject({ completion: "completed" });
        const evaluation = only(
          run.expEvalEvents(),
          (event) => event.experimentId === experimentId && event.evalId === evalId,
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
          adapter: {
            name: `custom-${implementation}`,
            contract: "e2e/native-workflow/v1",
            behaviorRevision: "1",
          },
        });
        expect(execution?.adapter).toEqual({
          name: `custom-${implementation}`,
          contract: "e2e/native-workflow/v1",
          behaviorRevision: "1",
        });
        expect(execution?.adapter).not.toHaveProperty("kind");
        expect(execution).not.toHaveProperty("application");
        expect(execution).not.toHaveProperty("agentId");

        if (evalId === "custom-native-actions") {
          const identityEntries = (await readFile(join(projectRoot, customIdentityJournal), "utf8"))
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as {
              source: "event" | "result";
              experimentId: string;
              attempt: number;
              adapter: unknown;
            })
            .filter((entry) => entry.experimentId === experimentId);
          expect(identityEntries).toHaveLength(4);
          expect(identityEntries.map(({ source, attempt }) => `${source}:${attempt}`).sort()).toEqual([
            "event:0",
            "event:1",
            "result:0",
            "result:1",
          ]);
          for (const entry of identityEntries) {
            expect(entry.adapter).toEqual({
              name: `custom-${implementation}`,
              contract: "e2e/native-workflow/v1",
              behaviorRevision: "1",
            });
            expect(entry.adapter).not.toHaveProperty("kind");
          }
        }

        const summary = await inspectRunSummary(niceeval, projectRoot, runId);
        expect(summary.receipt.exitCode, summary.receipt.diagnostic()).toBe(0);
        expect(summary.document.summary.members).toHaveLength(2);
        for (const member of summary.document.summary.members) {
          expect(member).toMatchObject({
            runId,
            state: "executed",
            outcome: "completed",
          });
          const locator = member.locator;
          expect(locator, inspectedRun.diagnostic()).toEqual(expect.any(String));
          if (locator === undefined) throw new Error("custom Attempt did not expose its public locator");

          const attempt = await inspectAttempt(niceeval, projectRoot, locator, "attempt.get");
          expect(attempt.receipt.exitCode, attempt.receipt.diagnostic()).toBe(0);
          expect(attempt.document.attempt.assertions.state).toBe("available");
          if (member.evalId === "custom-native-score") {
            expect(member.verdict).toBe("passed");
            const details = await inspectAssertionEntries(
              niceeval, projectRoot, locator, attempt.document.attempt.assertions.entries,
            );
            const entries = details.map((detail) => {
              expect(detail.receipt.exitCode, detail.receipt.diagnostic()).toBe(0);
              return assertionEntry(detail.document, detail.receipt.diagnostic());
            });
            expect(entries.map(({ display, contribution }) => ({ label: display.label, contribution }))).toEqual([
              { label: "独立初始状态", contribution: { state: "earned", points: 1, earned: 1 } },
              { label: "调用时读取状态", contribution: { state: "earned", points: 4, earned: 2 } },
              { label: "未匹配只贡献零分", contribution: { state: "earned", points: 3, earned: 0 } },
            ]);
            expect(entries.map(({ decision }) => decision.gate)).toEqual(["satisfied", "satisfied", "not-gate"]);
            continue;
          }
          expect(member.evalId).toBe("custom-native-actions");
          const labels = attempt.document.attempt.assertions.entries.map(({ display }) => display.label);
          expect(labels).toEqual([
            "选中的实现创建实例",
            "Adapter 方法保留原生返回值",
            "多个 Adapter 动作共享本 Attempt 状态",
            "每个 Attempt 从独立实例完成",
            "解构方法绑定 Adapter 且根字段实时读取",
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
