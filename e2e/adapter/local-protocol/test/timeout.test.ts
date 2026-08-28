// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#timeout-owner
// rerun: pnpm e2e test --repo adapter/local-protocol -- --run test/timeout.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";
import { withLocalProtocolFixture } from "./support.ts";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";
import {
  inspectionRecords,
  runInspectionQuery,
} from "./query.ts";

const EXPECTED = [{
  experimentId: "timeout",
  evalId: "timeout",
  verdict: "errored",
  attempts: 1,
  passed: 0,
}] as const;

test("uiMessageStreamAgent 的挂起响应在 attempt deadline 后公开为 errored", async () => {
  await localProtocolE2E.case(
    "timeout",
    localProtocolRecordArtifacts,
    async ({ commands: { niceeval }, paths }) => {
      await withLocalProtocolFixture(paths.projectRoot, async ({ baseUrl, waitForRequest, waitForHangClosed }) => {
        const run = await niceeval.run(
          ["exp", "timeout", "--rerun", "all", "--json"],
          { env: { [FIXTURE_BASE_URL_ENV]: baseUrl }, timeoutMs: 30_000 },
        );
        const events = run.expEvalEvents();
        const receipt = run.expReceipt();

        expect(run.exitCode, run.diagnostic()).not.toBe(0);
        expect(receipt.completion, run.diagnostic()).toBe("completed");
        expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
        assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());

        const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
        const queried = await runInspectionQuery(niceeval, {
          kind: "attempt.trace",
          locator: event.locator,
        });
        expect(queried.exitCode, queried.diagnostic()).toBe(0);
        const document = queried.attemptTrace();
        expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
        const records = inspectionRecords(document.trace);
        expect(records, queried.diagnostic()).toContainEqual(expect.objectContaining({
          state: "complete",
          limitations: [],
        }));
        expect(records.filter((record) => record.code === "timeout"), queried.diagnostic()).toEqual([
          expect.objectContaining({
            code: "timeout",
            phase: "agent.send",
            summary: "attempt timed out (4000ms, from experiment)",
          }),
        ]);
        await waitForRequest("hang");
        await waitForHangClosed();
      });
    },
  );
});
