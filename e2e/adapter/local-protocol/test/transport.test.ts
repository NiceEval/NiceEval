// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#transport-owner
// rerun: pnpm e2e test --repo adapter/local-protocol -- --run test/transport.test.ts

import { assertExpEvalOutcomes, exactEval } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";
import { withLocalProtocolFixture } from "./support.ts";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";

const EXPECTED = [{
  experimentId: "transport",
  evalId: "transport-ok",
  verdict: "passed",
  attempts: 1,
  passed: 1,
}] as const;

test("uiMessageStreamAgent 完整 SSE transport 交付 fixture 文本", async () => {
  await localProtocolE2E.case(
    "transport",
    localProtocolRecordArtifacts,
    async ({ commands: { niceeval }, paths }) => {
      await withLocalProtocolFixture(paths.projectRoot, async ({ baseUrl }) => {
        const run = await niceeval.run(
          ["exp", "transport", "--rerun", "all", "--json"],
          { env: { [FIXTURE_BASE_URL_ENV]: baseUrl }, timeoutMs: 60_000 },
        );
        const events = run.expEvalEvents();
        const receipt = run.expReceipt();

        expect(run.exitCode, run.diagnostic()).toBe(0);
        expect(receipt.completion, run.diagnostic()).toBe("completed");
        expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
        assertExpEvalOutcomes(events, EXPECTED, () => run.diagnostic());

        const event = exactEval(events, EXPECTED[0], () => run.diagnostic());
        const execution = await niceeval.run(["show", event.locator, "--execution"]);
        expect(execution.exitCode, execution.diagnostic()).toBe(0);
        expect(execution.stdout, execution.diagnostic()).toContain("local-protocol-ok");
      });
    },
  );
});
