// Regression note: memory/ui-message-stream-missing-done-accepted.md
// rerun: pnpm e2e test --repo adapter/local-protocol -- --run test/disconnect.test.ts

import { assertExpEvalOutcomes } from "@niceeval/testkit";
import { expect, test } from "vitest";
import { FIXTURE_BASE_URL_ENV } from "../src/fixture/address.ts";
import { localProtocolE2E, localProtocolRecordArtifacts } from "./context.ts";
import { withLocalProtocolFixture } from "./support.ts";
import { withInspectionRequest } from "@niceeval/testkit";

const CASES = [
  {
    experimentId: "disconnect",
    evalId: "disconnect",
    fixtureMode: "disconnect",
    summary: "ended before the UI Message Stream [DONE] marker",
    fixtureOptions: {},
  },
  {
    experimentId: "done-then-late",
    evalId: "done-then-late",
    fixtureMode: "done-then-late",
    summary: "assistant",
    fixtureOptions: {},
  },
  {
    experimentId: "error-only",
    evalId: "error-only",
    fixtureMode: "error-only",
    summary: "local-protocol-error-frame-sentinel",
    fixtureOptions: { errorText: "local-protocol-error-frame-sentinel" },
  },
  {
    experimentId: "error-only",
    evalId: "error-only",
    fixtureMode: "error-only",
    summary: "assistant",
    fixtureOptions: { errorText: "" },
  },
  {
    experimentId: "error-only",
    evalId: "error-only",
    fixtureMode: "error-only",
    summary: "assistant",
    fixtureOptions: { errorText: " \t " },
  },
] as const;

test("uiMessageStreamAgent 只接受在协议终点前完整形成的 Turn [necase_2Q053XPZ22MT68HW]", async () => {
  await localProtocolE2E.case(
    "disconnect",
    localProtocolRecordArtifacts,
    async ({ commands: { niceeval }, paths }) => {
      for (const fault of CASES) {
        await withLocalProtocolFixture(paths.projectRoot, async ({ baseUrl, waitForRequest }) => {
          const run = await niceeval.run(
            ["exp", fault.experimentId, "--rerun", "all", "--json"],
            { env: { [FIXTURE_BASE_URL_ENV]: baseUrl }, timeoutMs: 60_000 },
          );
          await waitForRequest(fault.fixtureMode);
          const receipt = run.expReceipt();

          expect(run.exitCode, run.diagnostic()).not.toBe(0);
          expect(receipt.completion, run.diagnostic()).toBe("completed");
          expect(receipt.createdRunIds, run.diagnostic()).toHaveLength(1);
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

          const queried = await withInspectionRequest({
            kind: "attempt.trace",
            locator: event.locator,
          }, async (requestPath) => await niceeval.run(["query", "run", "--request", requestPath]));
          expect(queried.exitCode, queried.diagnostic()).toBe(0);
          const document = queried.attemptTrace();
          expect(document).toMatchObject({ protocol: "niceeval.query/v1", operation: "attempt.trace" });
          const trace = JSON.stringify(document.trace);
          expect(trace).toContain('"code":"agent-send-failed"');
          expect(trace).toContain('"kind":"execution-error"');
          expect(trace).toContain('"phase":"eval.run"');
          expect(trace).toContain(fault.summary);
          expect(trace).not.toContain("SendFailure message must be a non-empty string");
          expect(trace).not.toContain("TypeError");
        }, fault.fixtureOptions);
      }
    },
  );
});
