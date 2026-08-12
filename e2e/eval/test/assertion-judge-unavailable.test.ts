// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-judge-unavailable
// rerun: pnpm e2e --repo eval -- --run test/assertion-judge-unavailable.test.ts

import { join } from "node:path";
import {
  assertionsProjector,
  attemptDiagnosticsProjector,
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

test("未配置 Judge 时硬消费的 Judge Fact 以 unavailable errored，且不发起网络请求", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-judge", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(1);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) =>
          event.event === "eval" && event.evalId === "assertion-judge-unavailable" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-judge-unavailable",
        verdict: "errored",
        attempts: 1,
      });
      const locator = evaluation.locator!;

      const verdict = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator, projector: verdictProjector }),
        "Verdict Attachment",
      );
      expect(verdict).toBe("errored");

      const assertions = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({ root, locator, projector: assertionsProjector }),
      );
      expect(assertions.entries).toEqual(expect.arrayContaining([
        expect.objectContaining({
          state: "available",
          entry: expect.objectContaining({
            display: expect.objectContaining({ label: "Judge marker" }),
            result: expect.objectContaining({
              state: "unavailable",
              reason: "source-unavailable",
              gate: "unavailable",
            }),
          }),
        }),
      ]));

      const diagnostics = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({
          root,
          locator,
          projector: attemptDiagnosticsProjector,
        }),
        "Attempt Diagnostics Attachment",
      );
      const diagnosticCodes = diagnostics.diagnostics.map((diagnostic) => diagnostic.code);
      expect(diagnosticCodes).not.toContain("judge-precheck-failed");
      expect(diagnosticCodes).not.toContain("judge-call-failed");
    },
    evalArtifactStaging("judge-unavailable"),
  );
});
