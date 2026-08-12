// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-scopes
// rerun: pnpm e2e --repo eval -- --run test/assertion-scopes.test.ts

import { join } from "node:path";
import {
  assertionsProjector,
  attemptConversationProjector,
  verdictProjector,
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

test("turn、session 与 attempt scope 都以同一批真实工具事件完成断言", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-scopes", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-scopes" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-scopes",
        verdict: "passed",
        attempts: 1,
        passed: 1,
      });
      const locator = evaluation.locator!;

      const shown = await niceeval.run(
        ["show", locator, "--record", ".niceeval/record", "--execution"],
        { cwd: root },
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("scope_main_tool");
      expect(shown.stdout).toContain("scope_branch_tool");

      const verdict = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator, projector: verdictProjector }),
        "Verdict Attachment",
      );
      expect(verdict).toBe("passed");

      const assertions = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator, projector: assertionsProjector }),
      );
      expect(assertions.entries).toHaveLength(11);
      expect(assertions.entries.every(
        (entry) => entry.state === "available" && entry.entry.result.state === "matched",
      )).toBe(true);
      expect(assertions.entries.filter(
        (entry) =>
          entry.state === "available"
          && entry.entry.display.groupPath.length === 0,
      )).toHaveLength(2);
      expect(assertions.entries.filter(
        (entry) =>
          entry.state === "available"
          && entry.entry.display.groupPath.join("/") === "turn scope",
      )).toHaveLength(3);
      expect(assertions.entries.filter(
        (entry) =>
          entry.state === "available"
          && entry.entry.display.groupPath.join("/") === "session scope",
      )).toHaveLength(3);
      expect(assertions.entries.filter(
        (entry) =>
          entry.state === "available"
          && entry.entry.display.groupPath.join("/") === "attempt scope",
      )).toHaveLength(3);

      const conversation = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({
          root,
          locator,
          projector: attemptConversationProjector,
        }),
        "Attempt Conversation Attachment",
      );
      const toolCalls = conversation.items.filter((item) => item.kind === "tool-call");
      expect(toolCalls).toHaveLength(2);
      expect(toolCalls.map((call) => call.tool)).toEqual(expect.arrayContaining([
        "scope_main_tool",
        "scope_branch_tool",
      ]));
      const toolResults = conversation.items.filter((item) => item.kind === "tool-result");
      expect(toolResults).toHaveLength(2);
      expect(toolResults.every((result) => result.outcome === "completed")).toBe(true);
    },
    evalArtifactStaging("scopes"),
  );
});
