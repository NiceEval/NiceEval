// owner: docs/engineering/testing/e2e/eval.md#eval-assertion-sandbox
// rerun: pnpm e2e --repo eval -- --run test/assertion-sandbox.test.ts

import { join } from "node:path";
import { Effect, Either } from "effect";
import { agentWorkspaceDiffProjectorV1 } from "niceeval";
import { selectLatestRuns } from "niceeval/analysis";
import {
  makeRecordRoot,
  NodeRecordLive,
  openRecordReader,
} from "niceeval/record";
import { attemptSlotProjection, projectAnalysisSample } from "niceeval/projection";
import { command, only, withProjectCopy } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { evalArtifactStaging, evalProjectCopy } from "./support.ts";

interface ExpEvent {
  event: string;
  evalId?: string;
  locator?: string;
  status?: string;
  passed?: number;
  failed?: number;
}

const niceeval = command([join(process.cwd(), "node_modules", ".bin", "niceeval")]);

test("Sandbox 的 agent 归因 endpoint Assertion 与中立 diff projector 由公开 API 判定", async () => {
  await withProjectCopy(
    evalProjectCopy,
    async ({ root }) => {
      const run = await niceeval.run(["exp", "assertion-sandbox", "--rerun", "all", "--json"], { cwd: root });
      expect(run.exitCode, run.diagnostic()).toBe(0);
      const result = only(run.ndjson<ExpEvent>(), (event) => event.event === "result", run.diagnostic());
      expect(result).toMatchObject({ event: "result", status: "passed", passed: 1, failed: 0 });
      const locator = only(
        run.ndjson<ExpEvent>(),
        (event) => event.event === "eval" && event.evalId === "assertion-sandbox" && event.locator !== undefined,
        run.diagnostic(),
      ).locator!;

      const shown = await niceeval.run(["show", locator, "--record", ".niceeval", "--execution"], { cwd: root });
      expect(shown.exitCode, shown.diagnostic()).toBe(0);
      expect(shown.stdout).toContain("workspace_edit");

      const diffByAttempt = attemptSlotProjection(agentWorkspaceDiffProjectorV1);
      const recordRoot = makeRecordRoot(join(root, ".niceeval", "record"));
      if (Either.isLeft(recordRoot)) {
        throw new Error(`Record root rejected the E2E run: ${recordRoot.left.code}`);
      }
      const projected = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const reader = yield* openRecordReader({ root: recordRoot.right });
            const sampleHandle = yield* selectLatestRuns(reader, {});
            return yield* projectAnalysisSample({ sampleHandle, projection: diffByAttempt });
          }),
        ).pipe(Effect.provide(NodeRecordLive)),
      );

      expect(projected.access).toBe("attempt-slot");
      expect(projected.entries).toHaveLength(1);
      const entry = projected.entries[0];
      if (entry === undefined || entry.state !== "attachment-result") {
        throw new Error("Sandbox run did not produce a projected Attempt Attachment");
      }
      if (entry.attachment.state !== "available") {
        throw new Error(`Workspace diff Attachment read as ${entry.attachment.state}`);
      }
      expect(entry.attachment.value.attribution).toBe("agent-send-window-endpoints/v1");
      expect(
        entry.attachment.value.windows.flatMap((window) => window.changes.map((change) => change.path)),
      ).toEqual(expect.arrayContaining([
        "fixture/changed.txt",
        "fixture/created.txt",
        "fixture/delete-me.txt",
      ]));
    },
    evalArtifactStaging("sandbox"),
  );
});
