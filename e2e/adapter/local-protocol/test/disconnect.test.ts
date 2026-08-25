// owner: docs/engineering/testing/e2e/adapter/ui-message-stream.md#disconnect-owner
// regression: memory/ui-message-stream-missing-done-accepted.md
// rerun: pnpm e2e test --repo adapter/local-protocol -- --run test/disconnect.test.ts

import { assertExpEvalOutcomes } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";
import { withLocalProtocolFixture } from "./support.ts";
import { runInspectionQuery, type InspectionDocument } from "./query.ts";

const CASES = [
  {
    experimentId: "disconnect",
    evalId: "disconnect",
    fixtureMode: "disconnect",
    summary: "ended before the UI Message Stream [DONE] marker",
  },
  {
    experimentId: "done-then-late",
    evalId: "done-then-late",
    fixtureMode: "done-then-late",
    summary: "一条 assistant 消息都没归约出来",
  },
] as const;

test("uiMessageStreamAgent 只接受在协议终点前完整形成的 Turn", async () => {
  await localProtocolE2E.case(
    "disconnect",
    localProtocolRecordArtifacts,
    async ({ commands: { niceeval }, paths }) => {
      await withLocalProtocolFixture(paths.projectRoot, async ({ baseUrl, waitForRequest }) => {
        for (const fault of CASES) {
          const run = await niceeval.run(
            ["exp", fault.experimentId, "--rerun", "all", "--json"],
            { env: { [FIXTURE_BASE_URL_ENV]: baseUrl }, timeoutMs: 60_000 },
          );
          await waitForRequest(fault.fixtureMode);
          const receipt = run.expReceipt();

          expect(run.exitCode, run.diagnostic()).not.toBe(0);
          expect(receipt.completion, run.diagnostic()).toBe("completed");
          expect(receipt.runIds, run.diagnostic()).toHaveLength(1);
          const event = assertExpEvalOutcomes(
            run.expEvalEvents(),
            [{
              experimentId: fault.experimentId,
              evalId: fault.evalId,
              verdict: "errored",
              attempts: 1,
              passed: 0,
            }],
            () => run.diagnostic(),
          )[0]!;

          const queried = await runInspectionQuery(niceeval, {
            kind: "attempt.trace",
            locator: event.locator,
          });
          expect(queried.exitCode, queried.diagnostic()).toBe(0);
          const document = queried.json<InspectionDocument>();
          expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
          const trace = JSON.stringify(document.trace);
          expect(trace).toContain('"code":"agent-send-failed"');
          expect(trace).toContain('"kind":"execution-error"');
          expect(trace).toContain('"phase":"eval.run"');
          expect(trace).toContain(fault.summary);
        }
      });
    },
  );
});
