// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#http-error-owner
// rerun: pnpm e2e test --repo adapter/local-protocol -- --run test/http-error.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";
import { withLocalProtocolFixture } from "./support.ts";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";
import {
  inspectionRecords,
  runInspectionQuery,
  type InspectionDocument,
} from "./query.ts";

const EXPECTED = [{
  experimentId: "http-error",
  evalId: "http-error",
  verdict: "errored",
  attempts: 1,
  passed: 0,
}] as const;

test("uiMessageStreamAgent 将 HTTP 500 呈现为公开 errored 结果", async () => {
  await localProtocolE2E.case(
    "http-error",
    localProtocolRecordArtifacts,
    async ({ commands: { niceeval }, paths }) => {
      await withLocalProtocolFixture(paths.projectRoot, async ({ baseUrl }) => {
        const run = await niceeval.run(
          ["exp", "http-error", "--rerun", "all", "--json"],
          { env: { [FIXTURE_BASE_URL_ENV]: baseUrl }, timeoutMs: 60_000 },
        );
        const events = run.expEvalEvents();
        const receipt = run.expReceipt();

        expect(run.exitCode, run.diagnostic()).not.toBe(0);
        expect(receipt.completion, run.diagnostic()).toBe("completed");
        expect(receipt.createdRunIds, run.diagnostic()).toHaveLength(1);
        assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());

        const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
        const queried = await runInspectionQuery(niceeval, {
          kind: "attempt.trace",
          locator: event.locator,
        });
        expect(queried.exitCode, queried.diagnostic()).toBe(0);
        const document = queried.json<InspectionDocument>();
        expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
        const records = inspectionRecords(document.trace);
        expect(records, queried.diagnostic()).toContainEqual(expect.objectContaining({
          state: "complete",
          limitations: [],
        }));
        expect(
          records.filter((record) => record.code === "agent-send-failed"),
          queried.diagnostic(),
        ).toEqual([
          expect.objectContaining({
            code: "agent-send-failed",
            phase: "eval.run",
            summary: expect.stringMatching(
              /POST http:\/\/127\.0\.0\.1:\d+\/modes\/error\/api\/chat failed: 500 .*deliberate 500/,
            ),
          }),
        ]);
      });
    },
  );
});
