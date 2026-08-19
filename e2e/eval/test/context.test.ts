// owner: docs/engineering/testing/e2e/eval.md#eval-context
// rerun: pnpm e2e --repo eval -- --run test/context.test.ts

import { only } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalE2E } from "./context.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
}

test("多轮和 newSession 的 Context Eval 以 passed 终态完成", async () => {
  await evalE2E.case(
    "context",
    { artifacts: [{ source: ".niceeval", target: ".niceeval", optional: true }] },
    async ({ commands: { niceeval } }) => {
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
      const timing = await niceeval.run(["show", attemptEvent.locator!, "--timing"]);
      expect(timing.exitCode, timing.diagnostic()).toBe(0);
      expect(timing.stdout, timing.diagnostic()).toMatch(/agent\.send\s+session2\.turn1\b/);
      expect(timing.stdout, timing.diagnostic()).toMatch(/agent\.send\s+session2\.turn2\b/);
      expect(timing.stdout, timing.diagnostic()).toMatch(/agent\.send\s+session3\.turn1\b/);
    },
  );
});
