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
  readonly trace: Record<string, {
    readonly state: string;
    readonly value?: { readonly "segments-data"?: readonly { readonly phase?: string; readonly label?: string }[] };
  }>;
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
      });
      const activities = Object.values(inspected.document.trace)
        .flatMap((attachment) => attachment.state === "available" ? (attachment.value?.["segments-data"] ?? []) : []);
      expect(activities).toEqual(expect.arrayContaining([
        expect.objectContaining({ phase: "agent.send", label: "session2/turn1" }),
        expect.objectContaining({ phase: "agent.send", label: "session2/turn2" }),
        expect.objectContaining({ phase: "agent.send", label: "session3/turn1" }),
      ]));
    },
  );
});
