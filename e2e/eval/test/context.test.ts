// owner: docs/engineering/testing/e2e/eval.md#eval-context
// rerun: pnpm e2e test --repo eval -- --run test/context.test.ts
// regression: memory/turn-label-plain-words.md

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";
import { inspectAttempt, type InspectionDocument } from "./inspection.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

interface TraceDocument extends InspectionDocument {
  readonly operation: "attempt.trace";
  readonly trace: {
    readonly format: "niceeval.inspection.trace/v1";
    readonly conversation: {
      readonly state: string;
      readonly turnsTruncated: boolean;
      readonly omittedTurnCount: number;
      readonly turns: readonly {
        readonly sequence: number;
        readonly sessionId: string;
        readonly outcome: string;
        readonly terminal: { readonly state: string; readonly status?: string };
        readonly context: {
          readonly state: string;
          readonly sessionIndex: number;
          readonly turnIndex: number;
          readonly sourceOrder: number | null;
        };
      }[];
    };
  };
}

test("多轮和 newSession 的 Context Eval 以 passed 终态完成", async () => {
  await evalE2E.case(
    "context",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ paths: { projectRoot }, commands: { niceeval } }) => {
      const run = await niceeval.run(["exp", "context", "--rerun", "all", "--json"]);
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const attemptEvent = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "context-scopes" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(attemptEvent).toMatchObject({
        event: "eval",
        evalId: "context-scopes",
        verdict: "passed",
      });
      const inspected = await inspectAttempt<TraceDocument>(niceeval, projectRoot, attemptEvent.locator!, "attempt.trace");
      expect(inspected.receipt.exitCode, inspected.receipt.diagnostic()).toBe(0);
      expect(inspected.document).toMatchObject({
        protocol: "niceeval.query/v1",
        operation: "attempt.trace",
        behaviorVersion: expect.any(String),
        issues: [],
        trace: {
          format: "niceeval.inspection.trace/v1",
          conversation: {
            state: "complete",
            turnsTruncated: false,
            omittedTurnCount: 0,
          },
        },
      });
      const turns = inspected.document.trace.conversation.turns;
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
