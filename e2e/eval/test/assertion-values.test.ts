// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-values
// rerun: pnpm e2e --repo eval -- --run test/assertion-values.test.ts

import { join } from "node:path";
import { assertionsProjector, verdictProjector } from "niceeval/projection";
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

test("值 Match 通过原生 Fact 消费折叠为 passed", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-values", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-values" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-values",
        verdict: "passed",
        attempts: 1,
      });
      const locator = evaluation.locator!;

      const shown = await niceeval.run(
        ["show", locator, "--record", ".niceeval/record", "--source", "--json"],
        { cwd: root },
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("assertion-values-marker");

      const verdict = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator, projector: verdictProjector }),
        "Verdict Attachment",
      );
      expect(verdict).toBe("passed");

      const assertions = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator, projector: assertionsProjector }),
      );
      expect(assertions.entries).toHaveLength(17);
      expect(assertions.entries.every(
        (entry) => entry.state === "available" && entry.entry.result.state === "matched",
      )).toBe(true);
    },
    evalArtifactStaging("values"),
  );
});
