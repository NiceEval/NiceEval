// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#timeout-owner
// rerun: pnpm e2e --repo adapter/local-protocol -- --run test/timeout.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";
import { withLocalProtocolFixture } from "./support.ts";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";

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
      await withLocalProtocolFixture(paths.projectRoot, async ({ baseUrl, waitForRequest }) => {
        const run = await niceeval.run(
          ["exp", "timeout", "--rerun", "all", "--json"],
          { env: { [FIXTURE_BASE_URL_ENV]: baseUrl }, timeoutMs: 30_000 },
        );
        await waitForRequest("hang");
        const events = run.expEvalEvents();
        const receipt = run.expReceipt();

        expect(run.exitCode, run.diagnostic()).not.toBe(0);
        expect(receipt.completion, run.diagnostic()).toBe("completed");
        expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
        assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());

        const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
        const shown = await niceeval.run(["show", event.locator, "--json"]);
        expect(shown.exitCode, shown.diagnostic()).toBe(0);
        expect(shown.stdout, shown.diagnostic()).toContain(event.locator);
      });
    },
  );
});
