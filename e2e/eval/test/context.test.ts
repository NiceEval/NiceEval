// rerun: pnpm e2e test --repo eval -- --run test/context.test.ts
// Regression note: memory/turn-label-plain-words.md

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { inspectAttempt } from "./inspection.ts";

test("多轮和 newSession 的 Context Eval 以 passed 终态完成 [necase_9PV0Q2PS6ZZ8E4XR]", async () => {
  await evalE2E.case(
    "context",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "context", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const attemptEvent = only(
        run.expEvalEvents(),
        (event) => event.event === "eval" && event.evalId === "context-scopes" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(attemptEvent).toMatchObject({
        event: "eval",
        evalId: "context-scopes",
        verdict: "passed",
      });
      const inspected = await inspectAttempt(niceeval, projectRoot, attemptEvent.locator!, "attempt.trace");
      expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
      const traceDocument = inspected.receipt.attemptTrace();
      expect(traceDocument).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.trace",
        issues: [],
        trace: {
          conversation: {
            state: "complete",
            turnsTruncated: false,
            omittedTurnCount: 0,
          },
        },
      });
      const turns = traceDocument.trace.conversation.turns;
      expect(turns).toEqual([
        expect.objectContaining({
          sequence: 1,
          sessionId: expect.any(String),
          outcome: "completed",
          terminal: expect.objectContaining({ state: "recorded", status: "completed" }),
          context: expect.objectContaining({ sessionIndex: 2, turnIndex: 1, sourceOrder: expect.any(Number) }),
        }),
        expect.objectContaining({
          sequence: 2,
          sessionId: expect.any(String),
          outcome: "completed",
          terminal: expect.objectContaining({ state: "recorded", status: "completed" }),
          context: expect.objectContaining({ sessionIndex: 2, turnIndex: 2, sourceOrder: expect.any(Number) }),
        }),
        expect.objectContaining({
          sequence: 3,
          sessionId: expect.any(String),
          outcome: "completed",
          terminal: expect.objectContaining({ state: "recorded", status: "completed" }),
          context: expect.objectContaining({ sessionIndex: 3, turnIndex: 1, sourceOrder: expect.any(Number) }),
        }),
      ]);
      expect(turns[0]!.sessionId).toBe(turns[1]!.sessionId);
      expect(turns[2]!.sessionId).not.toBe(turns[0]!.sessionId);
    },
  );
});
