// rerun: pnpm e2e test --repo adapter/local-protocol -- --run test/approval.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";
import { withLocalProtocolFixture } from "./support.ts";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";
import { withInspectionRequest } from "@niceeval/testkit";

const EXPECTED = [{
  experimentId: "approval",
  evalId: "approval-lifecycle",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

test("uiMessageStreamAgent 审批等待、批准与拒绝保持同一 call 生命周期 [necase_M0WRF6Y287MN677Y]", async () => {
  await localProtocolE2E.case(
    "approval",
    localProtocolRecordArtifacts,
    async ({ commands: { niceeval }, paths }) => {
      await withLocalProtocolFixture(paths.projectRoot, async ({ baseUrl }) => {
        const run = await niceeval.run(
          ["exp", "approval", "--rerun", "all", "--json"],
          { env: { [FIXTURE_BASE_URL_ENV]: baseUrl }, timeoutMs: 60_000 },
        );
        const events = run.expEvalEvents();
        const receipt = run.expReceipt();

        expect(run.exitCode, run.diagnostic()).toBe(0);
        expect(receipt.completion, run.diagnostic()).toBe("completed");
        expect(receipt.createdRunIds, run.diagnostic()).toHaveLength(1);
        assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());

        const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
        const queried = await withInspectionRequest({
          kind: "attempt.trace",
          locator: event.locator,
        }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
        expect(queried.exitCode, queried.diagnostic()).toBe(0);
        const document = queried.attemptTrace();
        expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
        const trace = JSON.stringify(document.trace);
        expect(trace, queried.diagnostic()).toContain("local-approval-approved");
        expect(trace, queried.diagnostic()).toContain("local-approval-denied");
        expect(trace, queried.diagnostic()).toContain("calculate");
      });
    },
  );
});
