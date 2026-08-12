// owner: docs/engineering/testing/e2e/eval.md#eval-context
// rerun: pnpm e2e --repo eval -- --run test/context.test.ts

import { join } from "node:path";
import {
  assertionsProjector,
  attemptConversationProjector,
  attemptUsageProjector,
  verdictProjector,
  type UsageView,
} from "niceeval/projection";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import {
  projectAttemptAttachment,
  singleAvailableAttemptAttachment,
} from "./record-reader.ts";
import { evalArtifactStaging, evalProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
  attempts?: number;
  passed?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

function usageSummary(usage: UsageView) {
  const total = {
    inputTokens: 0,
    outputTokens: 0,
    costUSD: undefined as number | undefined,
  };
  for (const observation of usage.observations) {
    if (observation.kind === "token-bucket") {
      if (observation.bucket === "input") total.inputTokens += observation.tokens;
      if (observation.bucket === "output") total.outputTokens += observation.tokens;
    }
    if (observation.kind === "provider-cost" && observation.currency === "USD") {
      total.costUSD = (total.costUSD ?? 0) + Number(observation.amount);
    }
  }
  return total;
}

test("多轮和 newSession 的 Context 只在各自公开 scope 读取真实事件、usage 与输出", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "context", "--rerun", "all", "--json"], { cwd: root });
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
        attempts: 1,
      });

      const locator = attemptEvent.locator!;
      const shown = await niceeval.run(
        ["show", locator, "--record", ".niceeval/record", "--source", "--json"],
        { cwd: root },
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("context-main-first");
      expect(shown.stdout).toContain("context-branch-only");

      const verdict = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator, projector: verdictProjector }),
        "Verdict Attachment",
      );
      expect(verdict).toBe("passed");

      const assertions = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator, projector: assertionsProjector }),
      );
      expect(assertions.entries).toHaveLength(33);
      expect(assertions.entries.every(
        (entry) => entry.state === "available" && entry.entry.result.state === "matched",
      )).toBe(true);

      const conversation = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({
          root,
          locator,
          projector: attemptConversationProjector,
        }),
        "Attempt Conversation Attachment",
      );
      expect(
        conversation.items.filter(
          (item) => item.kind === "message" && item.role === "assistant",
        ),
      ).toHaveLength(3);

      const usage = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator, projector: attemptUsageProjector }),
        "Attempt Usage Attachment",
      );
      expect(usageSummary(usage)).toEqual({
        inputTokens: 6,
        outputTokens: 9,
        costUSD: 0,
      });
    },
    evalArtifactStaging("context"),
  );
});
