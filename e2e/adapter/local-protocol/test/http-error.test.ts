// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#http-error-owner
// rerun: pnpm e2e --repo adapter/local-protocol -- --run test/http-error.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";
import { withLocalProtocolFixture } from "./support.ts";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";

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
