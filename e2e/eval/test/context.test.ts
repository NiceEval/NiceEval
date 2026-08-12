// owner: docs/engineering/testing/e2e/eval.md#eval-context
// rerun: pnpm e2e --repo eval -- --run test/context.test.ts

import { join } from "node:path";
import { openRecord, resolveLocator } from "niceeval/record";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalArtifactStaging, evalProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  verdict?: string;
  attempts?: number;
  passed?: number;
}

interface ShowDocument {
  format: string;
  view: string;
  data: unknown;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

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

      const shown = await niceeval.run(
        ["show", attemptEvent.locator!, "--record", ".niceeval", "--json"],
        { cwd: root },
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      const document = shown.json<ShowDocument>();
      expect(document).toMatchObject({ format: "niceeval.show", view: "attempt" });
      const visible = JSON.stringify(document.data);
      expect(visible).toContain("context-main-first");
      expect(visible).toContain("context-branch-only");

      const record = await openRecord(join(root, ".niceeval"));
      const attempt = resolveLocator(record, attemptEvent.locator!);
      expect(attempt.result.verdict).toBe("passed");
      expect(attempt.result.usage).toMatchObject({ inputTokens: 6, outputTokens: 9, costUSD: 0 });
      const events = await attempt.events();
      expect(events?.filter((event) => event.type === "message" && event.role === "assistant")).toHaveLength(3);
    },
    evalArtifactStaging("context"),
  );
});
