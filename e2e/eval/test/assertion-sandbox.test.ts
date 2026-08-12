// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-sandbox
// rerun: pnpm e2e --repo eval -- --run test/assertion-sandbox.test.ts

import { join } from "node:path";
import { agentWorkspaceDiffProjector } from "niceeval";
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

test("Sandbox 的 agent 归因 endpoint Assertion 与中立 diff projector 由公开 API 判定", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-sandbox", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      expect(run.expReceipt(), run.diagnostic()).toMatchObject({ completion: "completed" });
      const evaluation = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-sandbox" && event.locator !== undefined,
        run.diagnostic(),
      );
      expect(evaluation).toMatchObject({
        event: "eval",
        evalId: "assertion-sandbox",
        verdict: "passed",
        attempts: 1,
      });
      const locator = evaluation.locator!;

      const diff = singleAvailableAttemptAttachment(
        await projectAttemptAttachment({
          root,
          locator,
          projector: agentWorkspaceDiffProjector,
        }),
      );
      expect(diff.attribution).toBe("agent-send-window-endpoints/v1");
      expect(
        diff.windows.flatMap((window) => window.changes.map((change) => change.path)),
      ).toEqual(expect.arrayContaining([
        "fixture/changed.txt",
        "fixture/created.txt",
        "fixture/delete-me.txt",
      ]));

      const shown = await niceeval.run(
        ["show", locator, "--record", ".niceeval/record", "--execution"],
        { cwd: root },
      );
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("workspace_edit");
    },
    evalArtifactStaging("sandbox"),
  );
});
